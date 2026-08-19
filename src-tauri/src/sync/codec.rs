//! Framing, compression, and hashing for Flow Local Sync.
//!
//! On-wire layout of one WebSocket binary message:
//! ```text
//! ver(1) ∥ frame_type(1) ∥ seq(8, big-endian) ∥ AES-256-GCM( gzip(plaintext) )
//! ```
//! `ver`, `frame_type` and `seq` form the 10-byte cleartext header. They are sent in the clear but
//! bound into the AEAD's AAD (see `crypto.rs`), so tampering with the header fails authentication.
//! `ver` is the leading byte the Android decoder reads first to reject a wrong-version frame before
//! GCM-open. The plaintext is gzipped before encryption (codec locked to GZIP/Deflate for byte
//! parity with Android's `java.util.zip`).
//!
//! For a streamed CHUNK frame the (decrypted, decompressed) plaintext is itself
//! `chunk_header_json ∥ '\n' ∥ ndjson_records` — see [`encode_chunk`] / [`decode_chunk`].

#![allow(clippy::must_use_candidate)]

use std::io::{Read, Write};

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use sha2::{Digest, Sha256};

use crate::sync::PROTOCOL_VERSION;
use crate::sync::crypto::SessionCipher;
use crate::sync::error::SyncError;
use crate::sync::frames::ChunkHeader;

/// Cleartext header bytes preceding the encrypted body: `ver(1) ∥ frame_type(1) ∥ seq(8)`.
pub const HEADER_LEN: usize = 1 + 1 + 8;

pub fn gzip(data: &[u8]) -> Vec<u8> {
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(data)
        .expect("gzip write to Vec is infallible");
    enc.finish().expect("gzip finish to Vec is infallible")
}

/// Hard ceiling on a single frame's **decompressed** size — a gzip-bomb guard. gzip can expand a few
/// KB into gigabytes; without a cap a malicious (but key-holding) peer could OOM us after a valid
/// AEAD open. 256 MiB is far above any legitimate single-collection payload yet bounds the blast
/// radius. The streaming chunk size (≈1000 records/frame) keeps real frames orders of magnitude
/// smaller than this.
pub const MAX_DECOMPRESSED: u64 = 256 * 1024 * 1024;

pub fn gunzip(data: &[u8]) -> Result<Vec<u8>, SyncError> {
    gunzip_limited(data, MAX_DECOMPRESSED)
}

/// `gunzip` with an explicit decompressed-size cap (see [`MAX_DECOMPRESSED`]). Reads at most
/// `max + 1` bytes so an over-limit stream is detected and rejected rather than fully buffered.
pub fn gunzip_limited(data: &[u8], max: u64) -> Result<Vec<u8>, SyncError> {
    let mut dec = GzDecoder::new(data).take(max.saturating_add(1));
    let mut out = Vec::new();
    dec.read_to_end(&mut out)
        .map_err(|e| SyncError::Codec(format!("gunzip: {e}")))?;
    if out.len() as u64 > max {
        return Err(SyncError::Codec(format!(
            "decompressed payload exceeds {max} bytes — refusing (possible gzip bomb)"
        )));
    }
    Ok(out)
}

/// Lowercase hex SHA-256 of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    let mut s = String::with_capacity(digest.len() * 2);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Build a full wire message: `ver ∥ frame_type ∥ seq ∥ seal(gzip(plaintext))`.
pub fn encode_message(
    cipher: &SessionCipher,
    frame_type: u8,
    seq: u64,
    plaintext: &[u8],
) -> Result<Vec<u8>, SyncError> {
    let body = gzip(plaintext);
    let sealed = cipher.seal(frame_type, seq, &body)?;
    let mut msg = Vec::with_capacity(HEADER_LEN + sealed.len());
    msg.push(PROTOCOL_VERSION);
    msg.push(frame_type);
    msg.extend_from_slice(&seq.to_be_bytes());
    msg.extend_from_slice(&sealed);
    tracing::debug!(
        target: "flow::sync::codec",
        frame_type = format_args!("0x{frame_type:02x}"),
        seq,
        plaintext_len = plaintext.len(),
        wire_len = msg.len(),
        "encoded frame"
    );
    Ok(msg)
}

/// Parse and authenticate a wire message, returning `(frame_type, seq, plaintext)`.
pub fn decode_message(
    cipher: &SessionCipher,
    wire: &[u8],
) -> Result<(u8, u64, Vec<u8>), SyncError> {
    if wire.len() < HEADER_LEN {
        tracing::warn!(
            target: "flow::sync::codec",
            wire_len = wire.len(),
            min = HEADER_LEN,
            "rejected undersized frame"
        );
        return Err(SyncError::Codec(format!(
            "message too short: {} bytes (need at least {HEADER_LEN})",
            wire.len()
        )));
    }
    let ver = wire[0];
    if ver != PROTOCOL_VERSION {
        tracing::warn!(
            target: "flow::sync::codec",
            got = format_args!("0x{ver:02x}"),
            expected = format_args!("0x{PROTOCOL_VERSION:02x}"),
            wire_head = format_args!("{:02x?}", &wire[..wire.len().min(12)]),
            "frame version mismatch — peer is speaking a different FLOW-SYNC version or a \
             misaligned envelope (check the 10-byte header: ver∥type∥seq8)"
        );
        return Err(SyncError::Codec(format!(
            "unsupported frame version 0x{ver:02x} (expected 0x{PROTOCOL_VERSION:02x})"
        )));
    }
    let frame_type = wire[1];
    let mut seq_bytes = [0u8; 8];
    seq_bytes.copy_from_slice(&wire[2..HEADER_LEN]);
    let seq = u64::from_be_bytes(seq_bytes);

    let body = cipher.open(frame_type, seq, &wire[HEADER_LEN..]).map_err(|e| {
        tracing::warn!(
            target: "flow::sync::codec",
            frame_type = format_args!("0x{frame_type:02x}"),
            seq,
            wire_len = wire.len(),
            "AEAD open failed while decoding frame ({e}) — this means the directional key or the \
             AAD (ver∥sid∥type∥seq) does not match the peer. Check HKDF salt/labels, the session \
             id from the QR, and the envelope layout."
        );
        e
    })?;
    let plaintext = gunzip(&body).map_err(|e| {
        tracing::warn!(target: "flow::sync::codec", frame_type = format_args!("0x{frame_type:02x}"), seq, "gunzip failed after a successful AEAD open ({e}) — payload is not a valid gzip stream");
        e
    })?;
    tracing::debug!(
        target: "flow::sync::codec",
        frame_type = format_args!("0x{frame_type:02x}"),
        seq,
        plaintext_len = plaintext.len(),
        "decoded frame"
    );
    Ok((frame_type, seq, plaintext))
}

/// Encode a CHUNK plaintext body: `chunk_header_json ∥ '\n' ∥ ndjson`.
pub fn encode_chunk(header: &ChunkHeader, ndjson: &[u8]) -> Vec<u8> {
    let mut v = serde_json::to_vec(header).expect("serialize ChunkHeader");
    v.push(b'\n');
    v.extend_from_slice(ndjson);
    v
}

/// Decode a CHUNK plaintext body into `(header, ndjson_slice)`.
///
/// A frame with **no** newline is read as a header-only chunk (empty body) rather than rejected:
/// Flow for Android through v2.2.0 builds an empty collection's chunk as `StringBuilder(header)`
/// and only appends `'\n'` *before each record*, so a zero-record collection arrives as bare header
/// JSON. Rejecting it killed every phone→desktop sync where any selected collection was empty
/// (issues #30/#49). `encode_chunk` still always writes the separator, so what we emit stays
/// spec-exact (`FLOW-SYNC/1` §7); only what we accept is widened.
pub fn decode_chunk(plaintext: &[u8]) -> Result<(ChunkHeader, &[u8]), SyncError> {
    let (header_bytes, body) = match plaintext.iter().position(|&b| b == b'\n') {
        Some(nl) => (&plaintext[..nl], &plaintext[nl + 1..]),
        None => (plaintext, &plaintext[plaintext.len()..]),
    };
    let header: ChunkHeader = serde_json::from_slice(header_bytes)?;
    if body.is_empty() {
        tracing::debug!(
            target: "flow::sync::codec",
            seq = header.seq,
            last = header.last,
            separator_present = plaintext.len() != header_bytes.len(),
            "decoded an empty chunk body"
        );
    }
    Ok((header, body))
}
