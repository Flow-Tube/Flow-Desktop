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
//! The receiver validates each collection's payload hash, stages the NDJSON, hands it to the
//! caller's `apply` step and only then reports `APPLY_RESULT`, so the sender's "done" means the
//! data was saved. A failure on either side is reported to the peer with an `ERROR` frame before
//! the socket closes.

#![allow(clippy::must_use_candidate)]

use std::collections::BTreeMap;
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
    ApplyResultFrame, CapabilitiesFrame, ChunkAckFrame, ChunkHeader, CompleteFrame, ConsentFrame,
    ErrorFrame, FrameType, HelloAckFrame, HelloFrame, ManifestEntry, ManifestFrame, SelectionFrame,
    collection_from_key,
};
use crate::sync::transport::WsChannel;

/// Records per chunk when streaming a collection.
pub const CHUNK_RECORDS: usize = 1000;

/// A frame the peer sends straight back without involving its user.
const NETWORK_WAIT: Duration = Duration::from_secs(60);
/// A chunk mid-stream: the sender may be reading a large collection from disk.
const CHUNK_WAIT: Duration = Duration::from_secs(90);
/// A frame the peer sends only after its user confirms the code and the merge (Android asks both).
const USER_WAIT: Duration = Duration::from_secs(600);
/// `APPLY_RESULT`: the receiver merges everything into its database first.
const APPLY_WAIT: Duration = Duration::from_secs(600);

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

/// Result on the receiver: the peer identity and whatever the caller's apply step returned.
#[derive(Debug, Clone)]
pub struct ReceivedPayload<R> {
    pub peer: HelloFrame,
    pub applied: R,
}

/// What a receiver's apply step returns: the counts reported to the sender in `APPLY_RESULT`, plus
/// anything the caller wants back (the full merge report, or the staged data in tests).
pub type ApplyOutput<R> = Result<(ApplyResultFrame, R), SyncError>;

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
pub enum ClientOutcome<R> {
    Declined,
    Completed(ReceivedPayload<R>),
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
            let err: ErrorFrame = serde_json::from_slice(&plaintext)?;
            return Err(SyncError::Peer {
                code: err.code,
                message: err.message,
            });
        }
        Ok((ft, plaintext))
    }

    /// [`recv_bytes`](Self::recv_bytes) with a deadline; `waiting_for` names the wait in the error.
    async fn recv_bytes_within(
        &mut self,
        wait: Duration,
        waiting_for: &'static str,
    ) -> Result<(FrameType, Vec<u8>), SyncError> {
        timeout(wait, self.recv_bytes())
            .await
            .map_err(|_| SyncError::Timeout(waiting_for))?
    }

    async fn send_frame<T: Serialize>(
        &mut self,
        ft: FrameType,
        value: &T,
    ) -> Result<(), SyncError> {
        let bytes = serde_json::to_vec(value)?;
        self.send_bytes(ft, &bytes).await
    }

    async fn recv_frame<T: DeserializeOwned>(
        &mut self,
        want: FrameType,
        deadline: Duration,
        waiting_for: &'static str,
    ) -> Result<T, SyncError> {
        let (ft, plaintext) = self.recv_bytes_within(deadline, waiting_for).await?;
        if ft != want {
            return Err(SyncError::Protocol(format!(
                "expected {want:?}, got {ft:?}"
            )));
        }
        Ok(serde_json::from_slice(&plaintext)?)
    }

    async fn recv_chunk(
        &mut self,
        waiting_for: &'static str,
    ) -> Result<(ChunkHeader, Vec<u8>), SyncError> {
        let (ft, plaintext) = self.recv_bytes_within(CHUNK_WAIT, waiting_for).await?;
        if ft != FrameType::Chunk {
            return Err(SyncError::Protocol(format!("expected Chunk, got {ft:?}")));
        }
        let (header, body) = codec::decode_chunk(&plaintext)?;
        Ok((header, body.to_vec()))
    }

    /// Tell the peer why the session is ending (when it doesn't already know), then close. The
    /// result passes through unchanged.
    async fn finish<T>(&mut self, result: Result<T, SyncError>) -> Result<T, SyncError> {
        if let Err(e) = &result {
            if let Some(code) = e.wire_code() {
                let frame = ErrorFrame {
                    code: code.to_string(),
                    message: e.to_string(),
                };
                if let Err(send_err) = self.send_frame(FrameType::Error, &frame).await {
                    tracing::debug!(target: "flow::sync::protocol", %send_err, "couldn't send ERROR frame");
                }
            }
            self.close().await;
        }
        result
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
    let result = async {
        // Decrypting HELLO authenticates the client (valid GCM tag = proof of key).
        let client_hello = handshake_host(&mut peer, &our_hello, sas_confirm_required).await?;
        let their_caps = exchange_caps(&mut peer, &our_caps, "sender").await?;
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
    .await;
    peer.finish(result).await
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
    let result = async {
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
    .await;
    peer.finish(result).await
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
    let client_hello: HelloFrame = peer
        .recv_frame(
            FrameType::Hello,
            NETWORK_WAIT,
            "the other device to say hello",
        )
        .await?;
    if client_hello.protocol != PROTOCOL_VERSION {
        return Err(SyncError::UnsupportedVersion(client_hello.protocol));
    }
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
    let ack: HelloAckFrame = peer
        .recv_frame(
            FrameType::HelloAck,
            NETWORK_WAIT,
            "the other device to answer hello",
        )
        .await?;
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
    let their: CapabilitiesFrame = peer
        .recv_frame(
            FrameType::Capabilities,
            NETWORK_WAIT,
            "the other device's capabilities",
        )
        .await?;
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
    // Sort by key so SELECTION, MANIFEST and the stream agree: released desktops route chunks by
    // SELECTION order and Android by MANIFEST order, so any other order misroutes on one of them.
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
    let _their_selection: SelectionFrame = peer
        .recv_frame(
            FrameType::Selection,
            NETWORK_WAIT,
            "the other device's selection",
        )
        .await?;

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
    let their_consent: ConsentFrame = peer
        .recv_frame(
            FrameType::Consent,
            USER_WAIT,
            "the other device to accept the sync",
        )
        .await?;
    tracing::info!(target: "flow::sync::protocol", role = "sender", peer_accepted = their_consent.accepted, "consent (receiver merge)");
    if !their_consent.accepted {
        peer.close().await;
        return Ok(HostOutcome::Declined);
    }
    // Consent received — let the caller advance its UI (verify → syncing) in step with the peer.
    on_accepted().await;

    // Stream each collection: CHUNK*↔CHUNK_ACK, then COMPLETE.
    for p in &prepared {
        let name = p.collection.key().to_string();
        let mut chunks = chunk_lines(&p.lines, CHUNK_RECORDS);
        if chunks.is_empty() {
            chunks.push(Vec::new());
        }
        let n = chunks.len();
        for (i, chunk) in chunks.iter().enumerate() {
            let header = ChunkHeader {
                collection: Some(name.clone()),
                seq: i as u64,
                last: i == n - 1,
            };
            peer.send_bytes(FrameType::Chunk, &codec::encode_chunk(&header, chunk))
                .await?;
            let _ack: ChunkAckFrame = peer
                .recv_frame(FrameType::ChunkAck, NETWORK_WAIT, "a chunk acknowledgement")
                .await?;
        }
        peer.send_frame(
            FrameType::Complete,
            &CompleteFrame {
                collection: Some(name),
                records_sent: p.count,
                hash: p.hash.clone(),
            },
        )
        .await?;
        tracing::info!(target: "flow::sync::protocol", role = "sender", collection = p.collection.key(), records = p.count, "collection streamed (COMPLETE sent)");
    }

    // One aggregate APPLY_RESULT back from the receiver.
    let results: ApplyResultFrame = peer
        .recv_frame(
            FrameType::ApplyResult,
            APPLY_WAIT,
            "the other device to save the data",
        )
        .await?;
    tracing::info!(target: "flow::sync::protocol", role = "sender", collections = results.collections.len(), "received APPLY_RESULT — transfer complete");
    peer.close().await;
    Ok(HostOutcome::Completed(SendOutcome {
        peer: peer_hello,
        results,
    }))
}

/// Drive the **receiver/client** side (this device scanned the host's QR). `allow_merge` is invoked
/// with the peer identity and the aggregate manifest so the UI can show "incoming: N playlists…";
/// `apply` saves the staged collections before `APPLY_RESULT` goes back.
pub async fn run_receiver<S, F, Fut, A, AFut, R>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    allow_merge: F,
    apply: A,
) -> Result<ClientOutcome<R>, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
    A: FnOnce(HelloFrame, Vec<StagedCollection>) -> AFut,
    AFut: Future<Output = ApplyOutput<R>>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "receiver", "session started, sending HELLO");
    let result = async {
        let host_hello = handshake_client(&mut peer, &our_hello).await?;
        let _their_caps = exchange_caps(&mut peer, &our_caps, "receiver").await?;
        recv_data(&mut peer, host_hello, &our_caps, allow_merge, apply).await
    }
    .await;
    peer.finish(result).await
}

/// Drive the **host that receives**: this device shows a QR whose `role:"receiver"` tells the scanner
/// to SEND. This is how a camera-less desktop receives — it hosts + accepts, the phone scans + sends.
pub async fn run_host_receiver<S, F, Fut, A, AFut, R>(
    ch: WsChannel<S>,
    cipher: SessionCipher,
    our_hello: HelloFrame,
    our_caps: CapabilitiesFrame,
    sas_confirm_required: bool,
    allow_merge: F,
    apply: A,
) -> Result<ClientOutcome<R>, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
    A: FnOnce(HelloFrame, Vec<StagedCollection>) -> AFut,
    AFut: Future<Output = ApplyOutput<R>>,
{
    let mut peer = FramedPeer::new(ch, cipher);
    tracing::info!(target: "flow::sync::protocol", role = "host-receiver", "session started, awaiting HELLO");
    let result = async {
        let client_hello = handshake_host(&mut peer, &our_hello, sas_confirm_required).await?;
        let _their_caps = exchange_caps(&mut peer, &our_caps, "host-receiver").await?;
        recv_data(&mut peer, client_hello, &our_caps, allow_merge, apply).await
    }
    .await;
    peer.finish(result).await
}

/// The receive-data choreography: `SELECTION` exchange → recv `MANIFEST` → send `CONSENT` → recv
/// stream → apply → send `APPLY_RESULT`. Identical whether this side is the WebSocket host or
/// client.
async fn recv_data<S, F, Fut, A, AFut, R>(
    peer: &mut FramedPeer<S>,
    peer_hello: HelloFrame,
    our_caps: &CapabilitiesFrame,
    allow_merge: F,
    apply: A,
) -> Result<ClientOutcome<R>, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
    F: FnOnce(HelloFrame, ManifestFrame) -> Fut,
    Fut: Future<Output = bool>,
    A: FnOnce(HelloFrame, Vec<StagedCollection>) -> AFut,
    AFut: Future<Output = ApplyOutput<R>>,
{
    let selection = exchange_selection_as_receiver(peer, our_caps).await?;

    // Aggregate MANIFEST (preview totals before consent). An Android sender asks its user to
    // confirm the code first.
    let manifest: ManifestFrame = peer
        .recv_frame(
            FrameType::Manifest,
            USER_WAIT,
            "the other device to confirm the code",
        )
        .await?;
    tracing::info!(
        target: "flow::sync::protocol", role = "receiver",
        selection = ?selection.send.iter().map(|c| c.key()).collect::<Vec<_>>(),
        manifest_collections = manifest.collections.len(),
        "received SELECTION + MANIFEST"
    );

    // CONSENT — one-way (receiver → sender only): send our merge decision, then go straight to the
    // stream. The sender sends no CONSENT back (it would desync the per-direction seq → the classic
    // "expected CHUNK, got CONSENT" / "expected CONSENT, got CHUNK" mismatch).
    let accepted = peer
        .ch
        .keepalive_while(allow_merge(peer_hello.clone(), manifest.clone()))
        .await?;
    tracing::info!(target: "flow::sync::protocol", role = "receiver", accepted, "consent (merge?) sent");
    peer.send_frame(FrameType::Consent, &ConsentFrame { accepted })
        .await?;
    if !accepted {
        return Ok(ClientOutcome::Declined);
    }

    let staged = recv_stream(peer, &manifest, our_caps).await?;
    let (result, applied) = peer
        .ch
        .keepalive_while(apply(peer_hello.clone(), staged))
        .await??;

    peer.send_frame(FrameType::ApplyResult, &result).await?;
    tracing::info!(target: "flow::sync::protocol", role = "receiver", collections = result.collections.len(), "sent APPLY_RESULT — transfer complete");
    Ok(ClientOutcome::Completed(ReceivedPayload {
        peer: peer_hello,
        applied,
    }))
}

/// Send our accept list, then read the sender's `SELECTION`. Sending first matters: an Android
/// host reads first (the spec's client-first order), so reading first here left both sides waiting
/// forever whenever this desktop scanned a phone's "send" code. Each direction has its own sequence
/// counter, so sending first is safe against every peer.
async fn exchange_selection_as_receiver<S>(
    peer: &mut FramedPeer<S>,
    our_caps: &CapabilitiesFrame,
) -> Result<SelectionFrame, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
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
    peer.recv_frame(
        FrameType::Selection,
        NETWORK_WAIT,
        "the other device's selection",
    )
    .await
}

/// Receive every collection the MANIFEST lists, routing each by the name in its chunk headers.
/// Senders disagree on stream order (released desktops follow their selection, Android its own
/// insertion order), so position says nothing; the name every chunk carries does.
async fn recv_stream<S>(
    peer: &mut FramedPeer<S>,
    manifest: &ManifestFrame,
    our_caps: &CapabilitiesFrame,
) -> Result<Vec<StagedCollection>, SyncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut remaining: BTreeMap<&str, &ManifestEntry> = manifest
        .collections
        .iter()
        .map(|(name, entry)| (name.as_str(), entry))
        .collect();
    let mut staged = Vec::with_capacity(remaining.len());

    while !remaining.is_empty() {
        let (mut header, mut body) = peer.recv_chunk("the next collection").await?;
        let name = header.collection.clone().ok_or_else(|| {
            SyncError::Protocol("received a chunk that names no collection".into())
        })?;
        let entry = remaining.remove(name.as_str()).ok_or_else(|| {
            SyncError::Protocol(format!(
                "received {name}, which the manifest doesn't list or which already arrived"
            ))
        })?;

        let mut acc: Vec<u8> = Vec::new();
        loop {
            if header.collection.as_deref() != Some(name.as_str()) {
                return Err(SyncError::Protocol(format!(
                    "a chunk for {:?} arrived in the middle of {name}",
                    header.collection
                )));
            }
            if !acc.is_empty() && !body.is_empty() {
                acc.push(b'\n');
            }
            acc.extend_from_slice(&body);
            peer.send_frame(
                FrameType::ChunkAck,
                &ChunkAckFrame {
                    collection: Some(name.clone()),
                    seq: header.seq,
                },
            )
            .await?;
            if header.last {
                break;
            }
            (header, body) = peer.recv_chunk("the rest of a collection").await?;
        }

        let complete: CompleteFrame = peer
            .recv_frame(FrameType::Complete, NETWORK_WAIT, "the end of a collection")
            .await?;
        if complete.collection.as_deref().is_some_and(|c| c != name) {
            return Err(SyncError::Protocol(format!(
                "COMPLETE for {:?} ended {name}",
                complete.collection
            )));
        }
        let hash = codec::sha256_hex(&acc);
        if hash != complete.hash || hash != entry.hash {
            tracing::warn!(
                target: "flow::sync::protocol", role = "receiver", collection = %name,
                computed = %hash, complete_hash = %complete.hash, manifest_hash = %entry.hash,
                "payload hash mismatch — data corrupted in transit or canonicalization differs \
                 between platforms"
            );
            return Err(SyncError::HashMismatch { collection: name });
        }
        let count = if acc.is_empty() {
            0
        } else {
            acc.split(|&b| b == b'\n').filter(|l| !l.is_empty()).count() as u64
        };

        let Some(collection) = collection_from_key(&name).filter(|c| consumes(our_caps, *c)) else {
            tracing::info!(
                target: "flow::sync::protocol", role = "receiver", collection = %name, records = count,
                "received a collection this device cannot consume — discarding after drain"
            );
            continue;
        };
        tracing::info!(target: "flow::sync::protocol", role = "receiver", collection = %name, records = count, "collection received + staged");
        staged.push(StagedCollection {
            collection,
            ndjson: acc,
            record_count: count,
            hash,
        });
    }
    Ok(staged)
}
