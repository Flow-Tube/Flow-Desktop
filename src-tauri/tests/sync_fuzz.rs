//! hardening: the frame parser must never panic on hostile input, and must reject malformed
//! frames with a clean error. The decode path runs on bytes a (key-holding) peer controls, so a
//! panic = a remote crash. These tests feed undersized, wrong-version, garbage, and randomized wire
//! bytes, plus a gzip-bomb, and assert graceful failures.

use flow_desktop_lib::sync::codec::{
    decode_chunk, decode_message, encode_message, gunzip, gunzip_limited, gzip,
};
use flow_desktop_lib::sync::crypto::{
    Role, SessionCipher, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::frames::{ChunkHeader, FrameType};

fn cipher_pair() -> (SessionCipher, SessionCipher) {
    let master = generate_master_secret();
    let sid = generate_session_id();
    (
        SessionCipher::new(&master, sid, Role::Host),
        SessionCipher::new(&master, sid, Role::Client),
    )
}

/// Tiny deterministic PRNG (xorshift64*) so the fuzz corpus is reproducible without `rand` and
/// without the forbidden `Math.random`/wall-clock seeds.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn byte(&mut self) -> u8 {
        (self.next() & 0xff) as u8
    }
}

#[test]
fn undersized_and_wrong_version_frames_are_rejected_cleanly() {
    let (_h, client) = cipher_pair();
    // Anything shorter than the 10-byte header.
    for len in 0..10usize {
        let wire = vec![0u8; len];
        assert!(
            decode_message(&client, &wire).is_err(),
            "len {len} must error"
        );
    }
    // Header-length but wrong version byte.
    let mut wire = vec![0u8; 10];
    wire[0] = 0xFE; // not PROTOCOL_VERSION
    assert!(decode_message(&client, &wire).is_err());
    // Correct version, header only, no AEAD body → too short for nonce+tag.
    let mut wire = vec![0u8; 10];
    wire[0] = 0x01;
    assert!(decode_message(&client, &wire).is_err());
}

#[test]
fn garbage_body_fails_aead_not_panics() {
    let (_h, client) = cipher_pair();
    let mut wire = vec![0u8; 10 + 12 + 16 + 5]; // header + nonce + tag + slack
    wire[0] = 0x01;
    wire[1] = FrameType::Manifest.to_u8();
    // seq stays 0; body is all zeros → GCM tag won't verify.
    assert!(decode_message(&client, &wire).is_err());
}

#[test]
fn a_tampered_valid_frame_fails_to_open() {
    let (host, client) = cipher_pair();
    let mut wire = encode_message(
        &host,
        FrameType::Manifest.to_u8(),
        0,
        b"{\"collections\":{}}",
    )
    .unwrap();
    // Flip a byte in the ciphertext region (after the 10-byte header).
    let i = wire.len() - 1;
    wire[i] ^= 0xff;
    assert!(
        decode_message(&client, &wire).is_err(),
        "tampered tag must fail"
    );
}

#[test]
fn random_bytes_never_panic_the_decoder() {
    let (_h, client) = cipher_pair();
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for _ in 0..20_000 {
        let len = (rng.next() % 64) as usize;
        let wire: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
        // The contract: returns Result, never unwinds. (A panic here fails the test.)
        let _ = decode_message(&client, &wire);
        let _ = decode_chunk(&wire);
    }
}

#[test]
fn decode_chunk_handles_edge_shapes() {
    // Not a newline in sight and not JSON either → error, no panic.
    assert!(decode_chunk(b"no-newline-here").is_err());
    let header = ChunkHeader {
        collection: None,
        seq: 0,
        last: true,
    };
    let header_json = serde_json::to_vec(&header).unwrap();
    // Valid header then empty ndjson (newline is the last byte).
    let mut body = header_json.clone();
    body.push(b'\n');
    let (h, nd) = decode_chunk(&body).unwrap();
    assert!(h.last);
    assert!(nd.is_empty());
    // Header with no separator at all: Flow for Android ≤ 2.2.0 frames a zero-record collection
    // this way, so it must decode as an empty chunk rather than fail the session (issues #30/#49).
    let (h, nd) = decode_chunk(&header_json).unwrap();
    assert!(h.last);
    assert!(nd.is_empty());
    // Garbage header JSON before the newline → error.
    assert!(decode_chunk(b"{not json}\nrecords").is_err());
}

#[test]
fn gzip_bomb_is_rejected_by_the_size_cap() {
    // 1 MiB of zeros compresses to a few KB; with a tiny cap it must be refused, not buffered.
    let payload = vec![0u8; 1024 * 1024];
    let bomb = gzip(&payload);
    assert!(bomb.len() < payload.len(), "sanity: zeros compress well");
    assert!(
        gunzip_limited(&bomb, 4096).is_err(),
        "over-cap decompression must error"
    );
    // Under a sufficient cap it still works, byte-for-byte.
    assert_eq!(gunzip_limited(&bomb, 2 * 1024 * 1024).unwrap(), payload);
    // The default `gunzip` happily handles normal payloads.
    assert_eq!(gunzip(&gzip(b"hello flow")).unwrap(), b"hello flow");
}
