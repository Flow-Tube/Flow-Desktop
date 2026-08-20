//! Canonical wire model for Flow Local Sync (`FLOW-SYNC/1`).

#![allow(
    clippy::must_use_candidate,
    clippy::missing_panics_doc,
    clippy::module_name_repetitions
)]

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Collection {
    WatchHistory,
    Playlists,
    Likes,
    Settings,
    FlowNeuroBrain,
    MusicBrain,
    Subscriptions,
}

impl Collection {
    /// Every collection, in a stable order (used to iterate capabilities/selection).
    pub const ALL: [Collection; 7] = [
        Collection::WatchHistory,
        Collection::Playlists,
        Collection::Likes,
        Collection::Settings,
        Collection::FlowNeuroBrain,
        Collection::MusicBrain,
        Collection::Subscriptions,
    ];

    /// The stable wire key (matches the `snake_case` serde form), e.g. `"watch_history"`.
    pub fn key(self) -> &'static str {
        match self {
            Collection::WatchHistory => "watch_history",
            Collection::Playlists => "playlists",
            Collection::Likes => "likes",
            Collection::Settings => "settings",
            Collection::FlowNeuroBrain => "flow_neuro_brain",
            Collection::MusicBrain => "music_brain",
            Collection::Subscriptions => "subscriptions",
        }
    }
}

/// Serialize a value to **canonical compact JSON**: object keys sorted ascending by
/// Unicode codepoint, recursively, no insignificant whitespace. Works because this build has
/// serde_json's `preserve_order` feature off, so `Value`'s object is a `BTreeMap` and re-serializing
/// it emits sorted keys. Both platforms produce byte-identical output for the same value, which is
/// what makes payload hashes cross-platform-stable. Returns `[]`-empty on the (unreachable for
/// our records) serialize failure rather than panicking.
pub fn to_canonical_json<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_value(value)
        .and_then(|v| serde_json::to_vec(&v))
        .unwrap_or_default()
}

// ===========================================================================================
// CRDT primitive: Hybrid Logical Clock
// ===========================================================================================

/// A Hybrid Logical Clock stamp. Provides a **total order** that respects causality even when
/// device wall-clocks disagree — the documented fix for naive last-write-wins data loss.
///
/// Order is `(physical_ms, counter, device_id)`. The `device_id` is the final tiebreaker so two
/// independent writes that land on the same `(physical_ms, counter)` never compare equal.
///
/// Wire form: the string `"<physical_ms>:<counter>:<device_id>"`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct Hlc {
    pub physical_ms: u64,
    pub counter: u32,
    pub device_id: String,
}

/// The short device-id used inside HLC strings: the lowercase, hyphen-stripped deviceId
/// UUID truncated to 8 chars. It is **only an HLC tiebreaker** (it need not be globally unique — the
/// full deviceId lives in the per-device CRDT blocks). Both platforms normalize to this form so the
/// `physicalMs == counter` tiebreak is byte-for-byte identical cross-platform. Idempotent: applying
/// it to an already-short value returns the same 8 chars.
pub fn short_device_id(device_id: &str) -> String {
    device_id
        .chars()
        .filter(|c| *c != '-')
        .flat_map(char::to_lowercase)
        .take(8)
        .collect()
}

impl Hlc {
    pub fn new(physical_ms: u64, counter: u32, device_id: impl Into<String>) -> Self {
        Self {
            physical_ms,
            counter,
            device_id: short_device_id(&device_id.into()),
        }
    }

    /// Return whichever stamp is greater under the total order (clones the winner).
    pub fn max(a: &Hlc, b: &Hlc) -> Hlc {
        if a >= b { a.clone() } else { b.clone() }
    }
}

impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.physical_ms
            .cmp(&other.physical_ms)
            .then(self.counter.cmp(&other.counter))
            .then_with(|| self.device_id.cmp(&other.device_id))
    }
}

impl PartialOrd for Hlc {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for Hlc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}",
            self.physical_ms, self.counter, self.device_id
        )
    }
}

impl FromStr for Hlc {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // device_id is a UUID (no colons); splitn(3) keeps it intact even defensively.
        let mut parts = s.splitn(3, ':');
        let physical = parts.next().ok_or("hlc: missing physical_ms")?;
        let counter = parts.next().ok_or("hlc: missing counter")?;
        let device_id = parts.next().ok_or("hlc: missing device_id")?;
        Ok(Hlc {
            physical_ms: physical
                .parse()
                .map_err(|_| format!("hlc: bad physical_ms `{physical}`"))?,
            counter: counter
                .parse()
                .map_err(|_| format!("hlc: bad counter `{counter}`"))?,
            device_id: short_device_id(device_id),
        })
    }
}

impl Serialize for Hlc {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Hlc {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Hlc::from_str(&s).map_err(serde::de::Error::custom)
    }
}

// ===========================================================================================
// CRDT primitive: G-Counter (grow-only counter)
// ===========================================================================================

/// A grow-only counter: a map of `device_id -> sub-count`. The logical value is the **sum** of
/// sub-counts; the merge is the **per-device max**. This makes additive counters (IDF document
/// counts, interaction totals, play counts) **idempotent on re-sync** while still summing the
/// genuinely-disjoint history of distinct devices — the precise fix for the double-counting bug
/// in a naive weighted-average merge.
///
/// Wire form is the map itself (`{"<device>": 12}`). `Deserialize` is hand-written in
/// [`crate::sync::compat`] so a peer that wraps it differently is still understood.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct GCounter(pub BTreeMap<String, u64>);

impl GCounter {
    pub fn single(device_id: &str, value: u64) -> Self {
        let mut m = BTreeMap::new();
        m.insert(device_id.to_string(), value);
        GCounter(m)
    }

    /// Logical value = sum of all device sub-counts (saturating).
    pub fn total(&self) -> u64 {
        self.0.values().fold(0u64, |acc, &v| acc.saturating_add(v))
    }

    pub fn get(&self, device_id: &str) -> u64 {
        self.0.get(device_id).copied().unwrap_or(0)
    }

    /// Set this device's sub-count (a device only ever advances its own entry).
    pub fn set(&mut self, device_id: &str, value: u64) {
        self.0.insert(device_id.to_string(), value);
    }

    /// Merge = per-device max. Commutative, associative, idempotent.
    pub fn merge(&mut self, other: &GCounter) {
        for (k, &v) in &other.0 {
            let e = self.0.entry(k.clone()).or_insert(0);
            if v > *e {
                *e = v;
            }
        }
    }
}

// ===========================================================================================
// CRDT primitive: OR-Set (observed-remove set, add-wins on tie)
// ===========================================================================================

/// An observed-remove set. Each element carries the `Hlc` of its latest add and (optionally) its
/// latest remove. An element is a **member** iff it has an add whose stamp is `>=` its remove
/// stamp (add-wins on tie). Union of two OR-Sets keeps the max stamp per element on each side.
///
/// Used for blocklists / preferences / seen-sets, where "blocked on either device ⇒ blocked"
/// but an explicit unblock must still propagate.
///
/// `Deserialize` is hand-written in [`crate::sync::compat`] so a peer that sends a bare member
/// array (no stamps) is still understood.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct OrSet {
    pub adds: BTreeMap<String, Hlc>,
    pub removes: BTreeMap<String, Hlc>,
}

impl OrSet {
    pub fn contains(&self, key: &str) -> bool {
        match (self.adds.get(key), self.removes.get(key)) {
            (Some(a), Some(r)) => a >= r, // add-wins on tie
            (Some(_), None) => true,
            _ => false,
        }
    }

    pub fn add(&mut self, key: impl Into<String>, hlc: Hlc) {
        let key = key.into();
        let entry = self.adds.entry(key).or_insert_with(|| hlc.clone());
        if hlc > *entry {
            *entry = hlc;
        }
    }

    pub fn remove(&mut self, key: impl Into<String>, hlc: Hlc) {
        let key = key.into();
        let entry = self.removes.entry(key).or_insert_with(|| hlc.clone());
        if hlc > *entry {
            *entry = hlc;
        }
    }

    /// Current members, sorted (deterministic).
    pub fn members(&self) -> Vec<String> {
        self.adds
            .keys()
            .filter(|k| self.contains(k))
            .cloned()
            .collect()
    }

    /// Union merge: keep the max stamp per element in both `adds` and `removes`.
    pub fn merge(&mut self, other: &OrSet) {
        for (k, h) in &other.adds {
            self.add(k.clone(), h.clone());
        }
        for (k, h) in &other.removes {
            self.remove(k.clone(), h.clone());
        }
    }
}

// ===========================================================================================
// CRDT primitive: LWW register (Hlc-ordered)
// ===========================================================================================

/// A last-write-wins register keyed by `Hlc`. The higher stamp wins; the `device_id` tiebreaker
/// inside `Hlc` makes the resolution deterministic and loss-free under clock skew.
/// `Deserialize` is hand-written in [`crate::sync::compat`] so a peer that sends an unstamped bare
/// value is still understood.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Lww<T> {
    pub value: T,
    pub hlc: Hlc,
}

impl<T: Clone> Lww<T> {
    pub fn new(value: T, hlc: Hlc) -> Self {
        Self { value, hlc }
    }

    /// Adopt `other` iff its stamp is strictly greater (idempotent: equal stamps are no-ops).
    pub fn merge(&mut self, other: &Lww<T>) {
        if other.hlc > self.hlc {
            *self = other.clone();
        }
    }
}

// ===========================================================================================
// Collection: watch history
// ===========================================================================================

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WatchHistoryRecord {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub channel_id: Option<String>,
    /// Epoch ms when last watched.
    pub watched_at_ms: u64,
    /// Fraction watched, 0..1.
    pub progress: f32,
    pub duration_seconds: Option<u64>,
    pub is_music: bool,
    pub is_short: bool,
    pub hlc: Hlc,
    /// Tombstone — a deleted record is shipped, never silently omitted.
    pub deleted: bool,
}

// ===========================================================================================
// Collection: playlists
// ===========================================================================================

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistOrigin {
    #[default]
    Local,
    Youtube,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Playlist {
    /// Stable cross-device identity (UUID v4). Backfilled once on existing playlists.
    pub sync_id: String,
    pub origin: PlaylistOrigin,
    pub youtube_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub is_music: bool,
    pub is_user_created: bool,
    pub is_protected: bool,
    pub created_at_ms: u64,
    pub updated_hlc: Hlc,
    pub deleted: bool,
    pub items: Vec<PlaylistItem>,
    /// Lossless passthrough of the source platform's native playlist extras (fields not covered by
    /// the structured columns). Ignored by platforms that don't understand it.
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaylistItem {
    pub video_id: String,
    /// Custom ordering within the playlist (LWW-resolved, then stable sort).
    pub position: i64,
    pub added_at_ms: u64,
    pub deleted: bool,
    pub title: Option<String>,
    pub channel_name: Option<String>,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    pub is_music: bool,
    pub hlc: Hlc,
    /// Lossless passthrough of the source platform's native track object.
    pub raw: Option<serde_json::Value>,
}

// ===========================================================================================
// Collection: likes
// ===========================================================================================

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LikeKind {
    #[default]
    Video,
    Music,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LikeState {
    Liked,
    Disliked,
    /// The unlike tombstone.
    #[default]
    None,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Like {
    pub kind: LikeKind,
    pub id: String,
    pub state: LikeState,
    pub updated_at_ms: u64,
    pub hlc: Hlc,
    /// Minimal display metadata (free-form; the receiver tolerates whatever it understands).
    pub meta: Option<serde_json::Value>,
}

// ===========================================================================================
// Collection: settings (curated cross-platform subset)
// ===========================================================================================

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SettingEntry {
    /// Canonical key.
    pub key: String,
    pub value: serde_json::Value,
    pub hlc: Hlc,
}

// ===========================================================================================
// Collection: FlowNeuro brain snapshot
// ===========================================================================================

/// A topic vector plus optional scalar "dimensions" (duration/pacing/complexity/isLive on some
/// platforms). Kept flexible so both the desktop and Android `ContentVector` shapes map in — the
/// hand-written `Deserialize` in [`crate::sync::compat`] is what accepts Android's inline dims.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentVectorWire {
    pub topics: BTreeMap<String, f64>,
    pub dims: BTreeMap<String, f64>,
}

/// `Deserialize` is hand-written in [`crate::sync::compat`], which rewrites `time_vectors` keys
/// into this platform's bucket spelling.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainVectors {
    pub global_vector: ContentVectorWire,
    pub time_vectors: BTreeMap<String, ContentVectorWire>,
    pub shorts_vector: Option<ContentVectorWire>,
    pub topic_affinities: BTreeMap<String, f64>,
    pub channel_scores: BTreeMap<String, f64>,
    pub channel_topic_profiles: BTreeMap<String, BTreeMap<String, f64>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BrainCounters {
    pub idf_total_documents: GCounter,
    pub total_interactions: GCounter,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BrainPerVideo {
    /// Max-register merge per key.
    pub watch_history_map: BTreeMap<String, f32>,
    pub watch_signal_progress: BTreeMap<String, f32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BrainSets {
    pub blocked_topics: OrSet,
    pub blocked_channels: OrSet,
    pub preferred_topics: OrSet,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RejectionSignalWire {
    pub count: i32,
    pub last_rejected_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ChannelStrikeWire {
    pub count: i32,
    pub first_at: u64,
    pub last_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FeedEntryWire {
    pub last_shown: u64,
    pub show_count: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TopicEvidenceWire {
    pub positive_signals: i32,
    pub negative_signals: i32,
    pub watch_signals: i32,
    pub explicit_signals: i32,
    pub positive_score: f64,
    pub video_ids: BTreeSet<String>,
    pub channel_ids: BTreeSet<String>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BrainLwwMaps {
    pub suppressed_video_ids: BTreeMap<String, Lww<u64>>,
    pub suppressed_channels: BTreeMap<String, Lww<u64>>,
    pub rejection_patterns: BTreeMap<String, Lww<RejectionSignalWire>>,
    pub topic_evidence: BTreeMap<String, Lww<TopicEvidenceWire>>,
    pub feed_history: BTreeMap<String, Lww<FeedEntryWire>>,
    pub channel_strikes: BTreeMap<String, Lww<ChannelStrikeWire>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BrainFlags {
    pub has_completed_onboarding: bool,
}

/// One device's FlowNeuro brain contribution. The effective merged brain is derived
/// deterministically across all known device snapshots.
/// Device-local/derived fields (`consecutive_skips`, `last_persona`, `persona_stability`,
/// `recent_query_tokens`) are intentionally **not** part of the wire model.
///
/// `Deserialize` is hand-written in [`crate::sync::compat`]: it accepts this grouped layout and the
/// flat one Flow for Android sends.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNeuroBrainSnapshot {
    pub schema: i32,
    pub device_id: String,
    pub hlc: Hlc,
    pub vectors: BrainVectors,
    pub counters: BrainCounters,
    /// word -> per-device G-Counter of document frequency.
    pub idf_word_frequency: BTreeMap<String, GCounter>,
    pub per_video: BrainPerVideo,
    pub sets: BrainSets,
    pub lww_maps: BrainLwwMaps,
    pub flags: BrainFlags,
}

// ===========================================================================================
// Collection: Music brain snapshot
// ===========================================================================================

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AffinityWire {
    /// Counted listens as a G-Counter (idempotent across re-syncs).
    pub plays: GCounter,
    /// EMA of completion-weighted listens, LWW-resolved via `hlc`.
    pub score: f64,
    pub last_played: u64,
    pub liked: bool,
    pub hlc: Hlc,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackMetaWire {
    pub title: String,
    pub artist: String,
    pub artist_key: String,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MusicBrainSnapshot {
    pub schema: i32,
    pub device_id: String,
    pub hlc: Hlc,
    pub artist_affinity: BTreeMap<String, AffinityWire>,
    pub genre_affinity: BTreeMap<String, f64>,
    pub artist_cooc: BTreeMap<String, f64>,
    pub recent_rotation: BTreeMap<String, f64>,
    pub time_buckets: BTreeMap<String, BTreeMap<String, f64>>,
    /// track -> recent play timestamps (ms). Merge = set-union then truncate to newest N.
    pub track_plays: BTreeMap<String, Vec<u64>>,
    pub track_meta: BTreeMap<String, TrackMetaWire>,
    pub total_plays: GCounter,
    pub seen_artists: OrSet,
    pub blocked_artists: OrSet,
    pub disliked_artists: BTreeMap<String, Lww<u64>>,
    pub discovery_appetite: Option<Lww<f64>>,
}

// ===========================================================================================
// Collection: subscription groups
// ===========================================================================================

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SubscriptionGroup {
    pub channel_ids: Vec<String>,
    pub deleted: bool,
    pub hlc: Hlc,
    pub name: String,
    pub sort_order: i32,
}
