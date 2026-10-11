//! `FLOW-SYNC/1` control-frame schema and capability negotiation types.
//!
//! lock the typed payloads exchanged over the encrypted WebSocket. Each
//! decrypted frame is one of these payloads; the `FrameType` byte is carried in the transport
//! header / AEAD additional-authenticated-data. The transport, crypto,
//! and the state-machine driver are implemented in later phases — here we only fix the shapes so
//! both platforms serialize them identically.

#![allow(clippy::must_use_candidate, clippy::module_name_repetitions)]

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::sync::canonical::Collection;

/// The collection with this wire name, if this build knows it.
pub fn collection_from_key(name: &str) -> Option<Collection> {
    Collection::ALL.into_iter().find(|c| c.key() == name)
}

/// Decode a list of collection names, dropping any this build doesn't know. A newer peer adds
/// collections (Android's `notes`); failing the whole frame on one unknown name ended the session.
fn known_collections<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Collection>, D::Error> {
    let names = Vec::<String>::deserialize(d)?;
    Ok(names
        .iter()
        .filter_map(|n| collection_from_key(n))
        .collect())
}

/// Protocol version negotiated end-to-end.
pub const PROTOCOL_VERSION: u8 = 1;

/// Wire frame discriminator. Values are stable and part of the protocol (do not renumber).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    Hello = 0x01,
    HelloAck = 0x02,
    Capabilities = 0x03,
    Selection = 0x04,
    Consent = 0x05,
    Manifest = 0x10,
    Chunk = 0x11,
    ChunkAck = 0x12,
    Complete = 0x13,
    ApplyResult = 0x20,
    Ping = 0x7E,
    Error = 0x7F,
}

impl FrameType {
    pub fn to_u8(self) -> u8 {
        self as u8
    }

    pub fn from_u8(v: u8) -> Option<FrameType> {
        Some(match v {
            0x01 => FrameType::Hello,
            0x02 => FrameType::HelloAck,
            0x03 => FrameType::Capabilities,
            0x04 => FrameType::Selection,
            0x05 => FrameType::Consent,
            0x10 => FrameType::Manifest,
            0x11 => FrameType::Chunk,
            0x12 => FrameType::ChunkAck,
            0x13 => FrameType::Complete,
            0x20 => FrameType::ApplyResult,
            0x7E => FrameType::Ping,
            0x7F => FrameType::Error,
            _ => return None,
        })
    }
}

/// Platform identifier advertised in the handshake.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    #[default]
    Desktop,
    Android,
    Ios,
    Web,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HelloFrame {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
    pub app_version: String,
    pub protocol: u8,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HelloAckFrame {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
    pub app_version: String,
    pub sas_confirm_required: bool,
}

/// What a device can produce/consume for one collection, with its schema version.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Capability {
    pub schema: i32,
    pub produce: bool,
    pub consume: bool,
}

/// Advertised capabilities keyed by the collection's wire name (e.g. `"watch_history"`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CapabilitiesFrame {
    pub collections: BTreeMap<String, Capability>,
}

/// The agreed transfer plan for this side: which collections it will send and which it accepts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SelectionFrame {
    #[serde(deserialize_with = "known_collections")]
    pub send: Vec<Collection>,
    #[serde(deserialize_with = "known_collections")]
    pub accept: Vec<Collection>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConsentFrame {
    pub accepted: bool,
}

/// One collection's totals in the aggregate [`ManifestFrame`] (wire-format `0x10`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ManifestEntry {
    pub records: u64,
    pub bytes: u64,
    /// Hex SHA-256 of the full (uncompressed, canonical) collection payload, for apply validation.
    pub hash: String,
}

/// The single MANIFEST frame the sender emits up front: one entry per offered collection, keyed by
/// the collection's wire name. Matches the Android contract `{"collections":{<name>:{...}}}`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ManifestFrame {
    pub collections: BTreeMap<String, ManifestEntry>,
}

/// Header for a streamed NDJSON chunk (the records follow in the same decrypted frame body).
/// Collection names on the stream stay raw strings so a collection this build doesn't know can
/// still be routed and drained rather than failing the decode.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChunkHeader {
    pub collection: Option<String>,
    pub seq: u64,
    pub last: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChunkAckFrame {
    pub collection: Option<String>,
    pub seq: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompleteFrame {
    pub collection: Option<String>,
    pub records_sent: u64,
    pub hash: String,
}

/// One collection's apply counts in the aggregate [`ApplyResultFrame`] (wire-format `0x20`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApplyResultEntry {
    pub added: u64,
    pub updated: u64,
    pub skipped: u64,
    pub tombstoned: u64,
}

/// The single APPLY_RESULT frame the receiver sends once all collections are staged/applied.
/// Matches the Android contract `{"collections":{<name>:{added,updated,skipped,tombstoned}}}`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApplyResultFrame {
    pub collections: BTreeMap<String, ApplyResultEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ErrorFrame {
    pub code: String,
    pub message: String,
}

// Tests for frame byte-values and collection serialization live in `tests/sync_crdt.rs` (an
// integration test) — see the note in `canonical.rs` on why in-crate unit tests can't run here.
