//! The `FLOW-SYNC/1` session state machine.
//!
//! v1 is **one-way per session** (locked decision): the **host** shows the QR and is the
//! **sender**; the **client** scans and is the **receiver**. The choreography is a fixed,
//! deadlock-free lockstep (each side's sends are matched by the other's receives in order), so a
//! single monotonic sequence number per direction stays aligned and is authenticated into every
//! frame's AAD.
//!
//! ```text
//!   handshake → capability exchange → selection exchange → MANIFEST
//!            → consent (ONE-WAY: only the receiver sends CONSENT; the sender reads it then streams)
//!            → per-collection stream (CHUNK*↔CHUNK_ACK; COMPLETE) → APPLY_RESULT
//! ```
//!
//! implements transport + negotiation + streaming and the **staged** receive (the
//! receiver validates each collection's payload hash and stages the NDJSON). Mapping the staged
//! NDJSON into the database and the atomic merge are Phases 3–4; here the receiver returns the
//! staged payload and reports placeholder apply counts.

#![allow(clippy::must_use_candidate)]

use std::future::Future;

use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::time::{Duration, timeout};

use crate::sync::PROTOCOL_VERSION;
use crate::sync::canonical::Collection;
use crate::sync::codec;
use crate::sync::crypto::SessionCipher;
use crate::sync::error::SyncError;
use crate::sync::frames::{
    ApplyResultEntry, ApplyResultFrame, CapabilitiesFrame, ChunkAckFrame, ChunkHeader,
    CompleteFrame, ConsentFrame, FrameType, HelloAckFrame, HelloFrame, ManifestEntry,
    ManifestFrame, SelectionFrame,
};
use crate::sync::transport::WsChannel;

/// Records per chunk when streaming a collection.
pub const CHUNK_RECORDS: usize = 1000;

const RECV_STALL_TIMEOUT: Duration = Duration::from_secs(90);

/// One collection's data the sender will offer, as canonical NDJSON (one record per line).
#[derive(Debug, Clone)]
pub struct OutgoingCollection {
    pub collection: Collection,
    pub ndjson: Vec<u8>,
}

/// A received collection, validated against its manifest hash and staged for merge.
#[derive(Debug, Clone)]
pub struct StagedCollection {
    pub collection: Collection,
    pub ndjson: Vec<u8>,
    pub record_count: u64,
    pub hash: String,
}

/// Result on the receiver: the peer identity and every staged collection.
#[derive(Debug, Clone)]
pub struct ReceivedPayload {
    pub peer: HelloFrame,
    pub collections: Vec<StagedCollection>,
}

/// Result on the sender: the peer identity and the aggregate apply result it reported.
#[derive(Debug, Clone)]
pub struct SendOutcome {
    pub peer: HelloFrame,
    pub results: ApplyResultFrame,
}

#[derive(Debug, Clone)]
pub enum HostOutcome {
    /// Either side declined consent; nothing was transferred.
    Declined,
    Completed(SendOutcome),
}

#[derive(Debug, Clone)]
pub enum ClientOutcome {
    Declined,
    Completed(ReceivedPayload),
}

// --------------------------------------------------------------------------------------------
// Framed peer: a WsChannel + SessionCipher with per-direction sequence numbers.
// --------------------------------------------------------------------------------------------

struct FramedPeer<S> {
    ch: WsChannel<S>,
    cipher: SessionCipher,
    send_seq: u64,
    recv_seq: u64,
}

impl<S> FramedPeer<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    fn new(ch: WsChannel<S>, cipher: SessionCipher) -> Self {
        Self {
            ch,
            cipher,
            send_seq: 0,
            recv_seq: 0,
        }
    }

    async fn send_bytes(&mut self, ft: FrameType, plaintext: &[u8]) -> Result<(), SyncError> {
        let wire = codec::encode_message(&self.cipher, ft.to_u8(), self.send_seq, plaintext)?;
        self.send_seq += 1;
        self.ch.send_binary(wire).await
    }

    async fn recv_bytes(&mut self) -> Result<(FrameType, Vec<u8>), SyncError> {
        let wire = self.ch.recv_binary().await?;
        let (ft_u8, seq, plaintext) = codec::decode_message(&self.cipher, &wire)?;
        if seq != self.recv_seq {
            return Err(SyncError::SeqMismatch {
                expected: self.recv_seq,
                got: seq,
            });
        }
        self.recv_seq += 1;
        let ft = FrameType::from_u8(ft_u8)
            .ok_or_else(|| SyncError::Protocol(format!("unknown frame type 0x{ft_u8:02x}")))?;
        if ft == FrameType::Error {
            let err: crate::sync::frames::ErrorFrame = serde_json::from_slice(&plaintext)?;
            return Err(SyncError::Protocol(format!(
                "peer error [{}]: {}",
                err.code, err.message
            )));
        }
        Ok((ft, plaintext))
    }

    async fn send_frame<T: Serialize>(
        &mut self,
        ft: FrameType,
        value: &T,
    ) -> Result<(), SyncError> {
        let bytes = serde_json::to_vec(value)?;
        self.send_bytes(ft, &bytes).await
    }

    async fn recv_frame<T: DeserializeOwned>(&mut self, want: FrameType) -> Result<T, SyncError> {
        let (ft, plaintext) = self.recv_bytes().await?;
        if ft != want {
            return Err(SyncError::Protocol(format!(
                "expected {want:?}, got {ft:?}"
            )));
        }
        Ok(serde_json::from_slice(&plaintext)?)
    }

    async fn close(&mut self) {
        self.ch.close().await;
    }
}

// --------------------------------------------------------------------------------------------
// Capability helpers
// --------------------------------------------------------------------------------------------

fn produces(caps: &CapabilitiesFrame, c: Collection) -> bool {
    caps.collections.get(c.key()).is_some_and(|x| x.produce)
}

fn consumes(caps: &CapabilitiesFrame, c: Collection) -> bool {
    caps.collections.get(c.key()).is_some_and(|x| x.consume)
}

struct Prepared {
    collection: Collection,
    lines: Vec<Vec<u8>>,
    hash: String,
    count: u64,
    byte_size: u64,
}

/// Normalize an NDJSON blob into trimmed lines + the canonical hash both sides agree on.
fn prepare(collection: Collection, ndjson: &[u8]) -> Prepared {
    let lines: Vec<Vec<u8>> = ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(<[u8]>::to_vec)
        .collect();
    let norm = join_lines(&lines);
    Prepared {
        collection,
        hash: codec::sha256_hex(&norm),
        count: lines.len() as u64,
        byte_size: norm.len() as u64,
        lines,
    }
}

/// Join lines with `'\n'` (no trailing newline) — the canonical form that gets hashed.
fn join_lines(lines: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        out.extend_from_slice(l);
    }
    out
}

fn chunk_lines(lines: &[Vec<u8>], per: usize) -> Vec<Vec<u8>> {
    lines.chunks(per).map(join_lines).collect()
}

// --------------------------------------------------------------------------------------------
// Sender (host) and receiver (client)
// --------------------------------------------------------------------------------------------

/// Drive the **sender/host** side of a one-way session.
///
/// Consent is **one-way** (receiver → sender only): only the *receiver* sends a `CONSENT` frame (its
/// merge decision). The sender does not send one — the user verifies the SAS on this device's screen
/// and the receiver is the control point (it can decline). `chosen` is the collection selection,
/// intersected with what this device can *produce* and what the peer can *consume*.
#[allow(clippy::too_many_arguments)]
pub async fn run_sender<S, G, GFut>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    outgoing: Vec<OutgoingCollection>,
    chosen: Vec<Collection>,
    sas_confirm_required: bool,
    on_accepted: G,
) -> Result<HostOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    G: FnOnce() -> GFut,
    GFut: Future<Output = ()>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "sender", "session started, awaiting HELLO");

    // 1. Handshake. Decrypting HELLO authenticates the client (valid GCM tag = proof of key).
    let client_hello = handshake_host(&mut peer, &our_hello, sas_confirm_required).await?;

    // 2. Capability exchange.
    let their_caps = exchange_caps(&mut peer, &our_caps, "sender").await?;

    // 3+. Drive the data-send phase (transport-role-independent).
    send_data(
        &mut peer,
        client_hello,
        &our_caps,
        &their_caps,
        outgoing,
        chosen,
        on_accepted,
    )
    .await
}

/// Drive the **client that sends** (it scanned a QR whose host wants to *receive*). Same data path
/// as [`run_sender`], but this side opened the connection and so speaks first (`HELLO`).
pub async fn run_client_sender<S, G, GFut>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    outgoing: Vec<OutgoingCollection>,
    chosen: Vec<Collection>,
    on_accepted: G,
) -> Result<HostOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    G: FnOnce() -> GFut,
    GFut: Future<Output = ()>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "client-sender", "session started, sending HELLO");
    let host_hello = handshake_client(&mut peer, &our_hello).await?;
    let their_caps = exchange_caps(&mut peer, &our_caps, "client-sender").await?;
    send_data(
        &mut peer,
        host_hello,
        &our_caps,
        &their_caps,
        outgoing,
        chosen,
        on_accepted,
    )
    .await
}

// --------------------------------------------------------------------------------------------
// Shared handshake + data-phase helpers (transport-role-independent where possible)
// --------------------------------------------------------------------------------------------

/// Host-side handshake: read `HELLO` (its valid GCM tag proves the peer has the key), reply
/// `HELLO_ACK`; returns the connecting peer's identity.
async fn handshake_host<S>(
    peer: &mut FramedPeer<S>,
    our_hello: &HelloFrame,
    sas_confirm_required: bool,
) -> Result<HelloFrame, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let client_hello: HelloFrame = peer.recv_frame(FrameType::Hello).await?;
    tracing::info!(
        target: "flow::sync::protocol",
        peer_device = %client_hello.device_id, peer_name = %client_hello.device_name,
        peer_platform = ?client_hello.platform, peer_protocol = client_hello.protocol,
        "received HELLO (key + envelope verified by successful decrypt)"
    );
    let ack = HelloAckFrame {
        device_id: our_hello.device_id.clone(),
        device_name: our_hello.device_name.clone(),
        platform: our_hello.platform,
        app_version: our_hello.app_version.clone(),
        sas_confirm_required,
    };
    peer.send_frame(FrameType::HelloAck, &ack).await?;
    Ok(client_hello)
}

/// Client→host handshake: send `HELLO`, read `HELLO_ACK`; returns the host's identity.
async fn handshake_client<S>(
    peer: &mut FramedPeer<S>,
    our_hello: &HelloFrame,
) -> Result<HelloFrame, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    peer.send_frame(FrameType::Hello, our_hello).await?;
    let ack: HelloAckFrame = peer.recv_frame(FrameType::HelloAck).await?;
    let host_hello = HelloFrame {
        device_id: ack.device_id,
        device_name: ack.device_name,
        platform: ack.platform,
        app_version: ack.app_version,
        protocol: PROTOCOL_VERSION,
    };
    tracing::info!(
        target: "flow::sync::protocol",
        peer_device = %host_hello.device_id, peer_name = %host_hello.device_name,
        peer_platform = ?host_hello.platform, "received HELLO_ACK (handshake ok)"
    );
    Ok(host_hello)
}

/// Both sides advertise capabilities (send then recv — deadlock-free, order-independent).
async fn exchange_caps<S>(
    peer: &mut FramedPeer<S>,
    our_caps: &CapabilitiesFrame,
    role: &'static str,
) -> Result<CapabilitiesFrame, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    peer.send_frame(FrameType::Capabilities, our_caps).await?;
    let their: CapabilitiesFrame = peer.recv_frame(FrameType::Capabilities).await?;
    tracing::info!(target: "flow::sync::protocol", role, peer_collections = their.collections.len(), "capabilities exchanged");
    Ok(their)
}

/// The send-data choreography: SELECTION exchange → MANIFEST → recv CONSENT → stream → recv
/// APPLY_RESULT. Identical whether this side is the WebSocket host or client.
async fn send_data<S, G, GFut>(
    peer: &mut FramedPeer<S>,
    peer_hello: HelloFrame,
    our_caps: &CapabilitiesFrame,
    their_caps: &CapabilitiesFrame,
    outgoing: Vec<OutgoingCollection>,
    chosen: Vec<Collection>,
    on_accepted: G,
) -> Result<HostOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    G: FnOnce() -> GFut,
    GFut: Future<Output = ()>,
{
    // Selection exchange (we declare `send`; read the peer's SELECTION to stay frame-aligned).
    // Sort by key so SELECTION, MANIFEST and the stream agree: we route chunks by SELECTION order,
    // Android by the sorted-BTreeMap MANIFEST — any other order misroutes on one side.
    let mut selection: Vec<Collection> = chosen
        .into_iter()
        .filter(|c| produces(our_caps, *c) && consumes(their_caps, *c))
        .collect();
    selection.sort_by(|a, b| a.key().cmp(b.key()));
    tracing::info!(
        target: "flow::sync::protocol", role = "sender",
        selection = ?selection.iter().map(|c| c.key()).collect::<Vec<_>>(),
        "negotiated selection (chosen ∩ produce ∩ consume)"
    );
    peer.send_frame(
        FrameType::Selection,
        &SelectionFrame {
            send: selection.clone(),
            accept: Vec::new(),
        },
    )
    .await?;
    let _their_selection: SelectionFrame = peer.recv_frame(FrameType::Selection).await?;

    // Aggregate MANIFEST so the receiver can preview totals before consenting.
    let mut prepared = Vec::with_capacity(selection.len());
    let mut manifest = ManifestFrame::default();
    for col in &selection {
        let out = outgoing
            .iter()
            .find(|o| o.collection == *col)
            .ok_or_else(|| {
                SyncError::Protocol(format!("no data provided for selected collection {col:?}"))
            })?;
        let p = prepare(*col, &out.ndjson);
        manifest.collections.insert(
            col.key().to_string(),
            ManifestEntry {
                records: p.count,
                bytes: p.byte_size,
                hash: p.hash.clone(),
            },
        );
        prepared.push(p);
    }
    tracing::info!(target: "flow::sync::protocol", role = "sender", collections = manifest.collections.len(), "sending MANIFEST");
    peer.send_frame(FrameType::Manifest, &manifest).await?;

    // CONSENT — one-way (receiver → sender only): wait for the RECEIVER's merge decision; the sender
    // sends no CONSENT frame. The user verifies the SAS on this device's screen and the receiver is
    // the sole control point. (Matches Android: sender reads CONSENT at recv-seq, then streams.)
    let their_consent: ConsentFrame = peer.recv_frame(FrameType::Consent).await?;
    tracing::info!(target: "flow::sync::protocol", role = "sender", peer_accepted = their_consent.accepted, "consent (receiver merge)");
    if !their_consent.accepted {
        peer.close().await;
        return Ok(HostOutcome::Declined);
    }
    // Consent received — let the caller advance its UI (verify → syncing) in step with the peer.
    on_accepted().await;

    // Stream each collection: CHUNK*↔CHUNK_ACK, then COMPLETE.
    for p in &prepared {
        let chunks = chunk_lines(&p.lines, CHUNK_RECORDS);
        if chunks.is_empty() {
            let header = ChunkHeader {
                collection: Some(p.collection),
                seq: 0,
                last: true,
            };
            peer.send_bytes(FrameType::Chunk, &codec::encode_chunk(&header, &[]))
                .await?;
            let _ack: ChunkAckFrame = peer.recv_frame(FrameType::ChunkAck).await?;
        } else {
            let n = chunks.len();
            for (i, chunk) in chunks.iter().enumerate() {
                let header = ChunkHeader {
                    collection: Some(p.collection),
                    seq: i as u64,
                    last: i == n - 1,
                };
                peer.send_bytes(FrameType::Chunk, &codec::encode_chunk(&header, chunk))
                    .await?;
                let _ack: ChunkAckFrame = peer.recv_frame(FrameType::ChunkAck).await?;
            }
        }
        peer.send_frame(
            FrameType::Complete,
            &CompleteFrame {
                collection: Some(p.collection),
                records_sent: p.count,
                hash: p.hash.clone(),
            },
        )
        .await?;
        tracing::info!(target: "flow::sync::protocol", role = "sender", collection = p.collection.key(), records = p.count, "collection streamed (COMPLETE sent)");
    }

    // One aggregate APPLY_RESULT back from the receiver.
    let results: ApplyResultFrame = peer.recv_frame(FrameType::ApplyResult).await?;
    tracing::info!(target: "flow::sync::protocol", role = "sender", collections = results.collections.len(), "received APPLY_RESULT — transfer complete");
    peer.close().await;
    Ok(HostOutcome::Completed(SendOutcome {
        peer: peer_hello,
        results,
    }))
}

/// Drive the **receiver/client** side (this device scanned the host's QR). `allow_merge` is invoked
/// with the peer identity and the aggregate manifest so the UI can show "incoming: N playlists…".
pub async fn run_receiver<S, F, Fut>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    allow_merge: F,
) -> Result<ClientOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "receiver", "session started, sending HELLO");
    let host_hello = handshake_client(&mut peer, &our_hello).await?;
    let _their_caps = exchange_caps(&mut peer, &our_caps, "receiver").await?;
    recv_data(&mut peer, host_hello, &our_caps, allow_merge).await
}

/// Drive the **host that receives**: this device shows a QR whose `role:"receiver"` tells the scanner
/// to SEND. This is how a camera-less desktop receives — it hosts + accepts, the phone scans + sends.
pub async fn run_host_receiver<S, F, Fut>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    sas_confirm_required: bool,
    allow_merge: F,
) -> Result<ClientOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "host-receiver", "session started, awaiting HELLO");
    let client_hello = handshake_host(&mut peer, &our_hello, sas_confirm_required).await?;
    let _their_caps = exchange_caps(&mut peer, &our_caps, "host-receiver").await?;
    recv_data(&mut peer, client_hello, &our_caps, allow_merge).await
}

/// The receive-data choreography: SELECTION exchange → recv MANIFEST → send CONSENT → recv stream
/// → send APPLY_RESULT. Identical whether this side is the WebSocket host or client.
async fn recv_data<S, F, Fut>(
    peer: &mut FramedPeer<S>,
    peer_hello: HelloFrame,
    our_caps: &CapabilitiesFrame,
    allow_merge: F,
) -> Result<ClientOutcome, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
{
    // Selection exchange: read the sender's SELECTION (what it will send), send our accept list.
    let selection: SelectionFrame = peer.recv_frame(FrameType::Selection).await?;
    let accept: Vec<Collection> = Collection::ALL
        .into_iter()
        .filter(|c| consumes(our_caps, *c))
        .collect();
    peer.send_frame(
        FrameType::Selection,
        &SelectionFrame {
            send: Vec::new(),
            accept,
        },
    )
    .await?;

    // Aggregate MANIFEST (preview totals before consent).
    let manifest: ManifestFrame = peer.recv_frame(FrameType::Manifest).await?;
    tracing::info!(
        target: "flow::sync::protocol", role = "receiver",
        selection = ?selection.send.iter().map(|c| c.key()).collect::<Vec<_>>(),
        manifest_collections = manifest.collections.len(),
        "received SELECTION + MANIFEST"
    );

    // CONSENT — one-way (receiver → sender only): send our merge decision, then go straight to the
    // stream. The sender sends no CONSENT back (it would desync the per-direction seq → the classic
    // "expected CHUNK, got CONSENT" / "expected CONSENT, got CHUNK" mismatch).
    let accepted = allow_merge(peer_hello.clone(), manifest.clone()).await;
    tracing::info!(target: "flow::sync::protocol", role = "receiver", accepted, "consent (merge?) sent");
    peer.send_frame(FrameType::Consent, &ConsentFrame { accepted })
        .await?;
    if !accepted {
        return Ok(ClientOutcome::Declined);
    }

    // Receive + stage each collection, validating the payload hash against the manifest.
    let mut staged = Vec::with_capacity(selection.send.len());
    let mut result = ApplyResultFrame::default();
    for col in selection.send.iter() {
        let key = col.key();

        if !manifest.collections.contains_key(key) {
            tracing::info!(
                target: "flow::sync::protocol", role = "receiver", collection = key,
                "collection declared in SELECTION but absent from MANIFEST — skipping (nothing to receive)"
            );
            continue;
        }

        let mut acc: Vec<u8> = Vec::new();
        loop {
            let (ft, plaintext) = timeout(RECV_STALL_TIMEOUT, peer.recv_bytes())
                .await
                .map_err(|_| {
                    SyncError::Protocol(format!("timed out waiting for data of {key}"))
                })??;
            if ft != FrameType::Chunk {
                return Err(SyncError::Protocol(format!(
                    "expected Chunk during transfer of {key}, got {ft:?}"
                )));
            }
            let (header, body) = codec::decode_chunk(&plaintext)?;
            if !acc.is_empty() && !body.is_empty() {
                acc.push(b'\n');
            }
            acc.extend_from_slice(body);
            peer.send_frame(
                FrameType::ChunkAck,
                &ChunkAckFrame {
                    collection: Some(*col),
                    seq: header.seq,
                },
            )
            .await?;
            if header.last {
                break;
            }
        }

        let complete: CompleteFrame = peer.recv_frame(FrameType::Complete).await?;
        let hash = codec::sha256_hex(&acc);
        let manifest_hash = manifest.collections.get(key).map(|m| m.hash.as_str());
        if hash != complete.hash || manifest_hash != Some(hash.as_str()) {
            tracing::warn!(
                target: "flow::sync::protocol", role = "receiver", collection = key,
                computed = %hash, complete_hash = %complete.hash, manifest_hash = ?manifest_hash,
                "payload hash mismatch — data corrupted in transit or canonicalization differs \
                 between platforms"
            );
            return Err(SyncError::HashMismatch {
                collection: key.to_string(),
            });
        }
        let count = if acc.is_empty() {
            0
        } else {
            acc.split(|&b| b == b'\n').filter(|l| !l.is_empty()).count() as u64
        };

        if !consumes(our_caps, *col) {
            tracing::info!(
                target: "flow::sync::protocol", role = "receiver", collection = key, records = count,
                "received a collection this device cannot consume — discarding after drain"
            );
            continue;
        }

        tracing::info!(target: "flow::sync::protocol", role = "receiver", collection = key, records = count, "collection received + staged");

        // The protocol-level ack reports what was received; the real merge stats are computed
        // locally during apply (see `session.rs`).
        result.collections.insert(
            key.to_string(),
            ApplyResultEntry {
                added: count,
                ..ApplyResultEntry::default()
            },
        );
        staged.push(StagedCollection {
            collection: *col,
            ndjson: acc,
            record_count: count,
            hash,
        });
    }

    peer.send_frame(FrameType::ApplyResult, &result).await?;
    tracing::info!(target: "flow::sync::protocol", role = "receiver", collections = staged.len(), "sent APPLY_RESULT — transfer complete");
    Ok(ClientOutcome::Completed(ReceivedPayload {
        peer: peer_hello,
        collections: staged,
    }))
}
