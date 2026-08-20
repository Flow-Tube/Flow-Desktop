//! The CRDT merge engine for Flow Local Sync.
//!
//! Every function here operates purely on the canonical wire model (`canonical.rs`) — no DB, no
//! IO — so the merge laws can be property-tested in isolation. Each collection merge is
//! **commutative, associative, and idempotent**, which together guarantee that two devices
//! exchanging state converge to the *same* result regardless of direction or how many times they
//! sync (the formal backbone of "no conflict / no loss / no double-count";
//!
//! Merge rules by collection:
//! * watch_history — key `video_id`; `watched_at`/`progress` = max, `is_music`/`is_short` = OR,
//!   metadata + `deleted` = LWW(hlc).
//! * likes — key `(kind,id)`; whole record LWW(hlc) (`state:none` is the unlike tombstone).
//! * playlists — key `playlist_merge_key` (reserved id / `yt:<id>` / `owned:<title>`) so the
//!   "same" entry on two devices coalesces; metadata LWW; items OR-Map keyed by `video_id`, each LWW.
//! * settings — key `key`; LWW(hlc).
//! * subscriptions — key `name`; `channel_ids` OR-Set union, `sort_order` LWW, `deleted` LWW.
//! * flow_neuro_brain — additive counters as G-Counters, sets as OR-Sets, per-video maps as
//!   max-registers, LWW-maps per key, flags OR, and learned **vectors via per-device snapshots
//!   recomputed deterministically**
//! * music_brain — analogous; scalar affinity maps use max-register (idempotent) for v1.

#![allow(clippy::must_use_candidate)]

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::sync::canonical::{
    AffinityWire, BrainCounters, BrainFlags, BrainLwwMaps, BrainPerVideo, BrainSets, BrainVectors,
    ContentVectorWire, FlowNeuroBrainSnapshot, GCounter, Hlc, Like, LikeKind, Lww,
    MusicBrainSnapshot, OrSet, Playlist, PlaylistItem, PlaylistOrigin, SettingEntry,
    SubscribedChannel, SubscriptionGroup, TrackMetaWire, WatchHistoryRecord,
};

// ===========================================================================================
// Generic primitive helpers
// ===========================================================================================

/// Canonical bytes for a deterministic value tiebreak.
fn ser<T: Serialize>(v: &T) -> Vec<u8> {
    serde_json::to_vec(v).unwrap_or_default()
}

/// Total-order LWW: `a` wins on a strictly-greater HLC, and on an exact HLC tie it wins iff its
/// canonical bytes are `>=` `b`'s. Real per-device HLCs are unique, but this makes the merge
/// commutative/associative even against a malformed peer that reuses an HLC — so two devices can
/// never diverge.
fn a_wins<T: Serialize>(a: &T, ha: &Hlc, b: &T, hb: &Hlc) -> bool {
    use std::cmp::Ordering;
    match ha.cmp(hb) {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => ser(a) >= ser(b),
    }
}

fn max_into_f32(dst: &mut BTreeMap<String, f32>, src: &BTreeMap<String, f32>) {
    for (k, &v) in src {
        let e = dst.entry(k.clone()).or_insert(v);
        if v > *e {
            *e = v;
        }
    }
}

fn max_into_f64(dst: &mut BTreeMap<String, f64>, src: &BTreeMap<String, f64>) {
    for (k, &v) in src {
        let e = dst.entry(k.clone()).or_insert(v);
        if v > *e {
            *e = v;
        }
    }
}

fn merge_lww_map<T: Clone + Serialize>(
    dst: &mut BTreeMap<String, Lww<T>>,
    src: &BTreeMap<String, Lww<T>>,
) {
    for (k, v) in src {
        match dst.get_mut(k) {
            Some(e) => {
                if !a_wins(&e.value, &e.hlc, &v.value, &v.hlc) {
                    *e = v.clone();
                }
            }
            None => {
                dst.insert(k.clone(), v.clone());
            }
        }
    }
}

fn merge_gcounter_map(dst: &mut BTreeMap<String, GCounter>, src: &BTreeMap<String, GCounter>) {
    for (k, v) in src {
        dst.entry(k.clone()).or_default().merge(v);
    }
}

fn merge_opt_lww<T: Clone + Serialize>(a: Option<Lww<T>>, b: &Option<Lww<T>>) -> Option<Lww<T>> {
    match (a, b) {
        (Some(x), Some(y)) => {
            if a_wins(&x.value, &x.hlc, &y.value, &y.hlc) {
                Some(x)
            } else {
                Some(y.clone())
            }
        }
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y.clone()),
        (None, None) => None,
    }
}

/// Weighted mean of several `key -> value` maps (absent key counts as 0; weights floored at 1).
fn blend_maps(contribs: &[(u64, &BTreeMap<String, f64>)]) -> BTreeMap<String, f64> {
    let mut numerator: BTreeMap<String, f64> = BTreeMap::new();
    let mut denominator = 0.0_f64;
    for (w, m) in contribs {
        let wf = (*w).max(1) as f64;
        denominator += wf;
        for (k, &v) in *m {
            *numerator.entry(k.clone()).or_insert(0.0) += v * wf;
        }
    }
    if denominator == 0.0 {
        denominator = 1.0;
    }
    numerator
        .into_iter()
        .map(|(k, v)| (k, v / denominator))
        .collect()
}

fn blend_vectors(contribs: &[(u64, &ContentVectorWire)]) -> ContentVectorWire {
    let topics: Vec<(u64, &BTreeMap<String, f64>)> =
        contribs.iter().map(|(w, v)| (*w, &v.topics)).collect();
    let dims: Vec<(u64, &BTreeMap<String, f64>)> =
        contribs.iter().map(|(w, v)| (*w, &v.dims)).collect();
    ContentVectorWire {
        topics: blend_maps(&topics),
        dims: blend_maps(&dims),
    }
}

// ===========================================================================================
// Watch history
// ===========================================================================================

pub fn merge_watch_history(
    a: Vec<WatchHistoryRecord>,
    b: Vec<WatchHistoryRecord>,
) -> Vec<WatchHistoryRecord> {
    let mut map: BTreeMap<String, WatchHistoryRecord> =
        a.into_iter().map(|r| (r.video_id.clone(), r)).collect();
    for r in b {
        match map.get_mut(&r.video_id) {
            Some(e) => *e = merge_one_watch(e, &r),
            None => {
                map.insert(r.video_id.clone(), r);
            }
        }
    }
    map.into_values().collect()
}

fn merge_one_watch(a: &WatchHistoryRecord, b: &WatchHistoryRecord) -> WatchHistoryRecord {
    let hi = if a_wins(a, &a.hlc, b, &b.hlc) { a } else { b };
    WatchHistoryRecord {
        video_id: a.video_id.clone(),
        title: hi.title.clone(),
        channel_name: hi.channel_name.clone(),
        channel_id: hi.channel_id.clone(),
        duration_seconds: hi.duration_seconds,
        watched_at_ms: a.watched_at_ms.max(b.watched_at_ms),
        progress: a.progress.max(b.progress),
        is_music: a.is_music || b.is_music,
        is_short: a.is_short || b.is_short,
        deleted: hi.deleted,
        hlc: Hlc::max(&a.hlc, &b.hlc),
    }
}

// ===========================================================================================
// Likes
// ===========================================================================================

fn like_key(l: &Like) -> String {
    let kind = match l.kind {
        LikeKind::Video => "video",
        LikeKind::Music => "music",
    };
    format!("{kind}:{}", l.id)
}

pub fn merge_likes(a: Vec<Like>, b: Vec<Like>) -> Vec<Like> {
    let mut map: BTreeMap<String, Like> = a.into_iter().map(|l| (like_key(&l), l)).collect();
    for l in b {
        let k = like_key(&l);
        match map.get_mut(&k) {
            Some(e) => {
                if !a_wins(e, &e.hlc, &l, &l.hlc) {
                    *e = l;
                }
            }
            None => {
                map.insert(k, l);
            }
        }
    }
    map.into_values().collect()
}

// ===========================================================================================
// Playlists
// ===========================================================================================

#[must_use]
pub fn normalize_title(title: &str) -> String {
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[must_use]
pub fn playlist_merge_key(p: &Playlist) -> String {
    if p.is_protected {
        return p.sync_id.clone();
    }
    if p.origin == PlaylistOrigin::Youtube {
        if let Some(y) = p.youtube_id.as_deref() {
            if !y.is_empty() {
                return format!("yt:{y}");
            }
        }
    }
    if p.is_user_created {
        let t = normalize_title(&p.title);
        if !t.is_empty() {
            return if p.is_music {
                format!("owned-music:{t}")
            } else {
                format!("owned:{t}")
            };
        }
    }
    p.sync_id.clone()
}

pub fn merge_playlists(a: Vec<Playlist>, b: Vec<Playlist>) -> Vec<Playlist> {
    let mut map: BTreeMap<String, Playlist> = BTreeMap::new();
    for p in a.into_iter().chain(b) {
        let k = playlist_merge_key(&p);
        match map.get_mut(&k) {
            Some(e) => *e = merge_one_playlist(e, &p),
            None => {
                map.insert(k, p);
            }
        }
    }
    // Canonicalize item order for every playlist (including those that appeared on only one
    // side) so the output is a deterministic normal form — required for idempotency.
    let mut out: Vec<Playlist> = map.into_values().collect();
    for pl in &mut out {
        pl.items.sort_by(|x, y| {
            x.position
                .cmp(&y.position)
                .then(x.video_id.cmp(&y.video_id))
        });
    }
    out
}

fn merge_one_playlist(a: &Playlist, b: &Playlist) -> Playlist {
    let hi = if a_wins(a, &a.updated_hlc, b, &b.updated_hlc) {
        a
    } else {
        b
    };

    let mut items: BTreeMap<String, PlaylistItem> = a
        .items
        .iter()
        .map(|i| (i.video_id.clone(), i.clone()))
        .collect();
    for item in &b.items {
        match items.get_mut(&item.video_id) {
            Some(e) => {
                if !a_wins(e, &e.hlc, item, &item.hlc) {
                    *e = item.clone();
                }
            }
            None => {
                items.insert(item.video_id.clone(), item.clone());
            }
        }
    }
    let mut items: Vec<PlaylistItem> = items.into_values().collect();
    items.sort_by(|x, y| {
        x.position
            .cmp(&y.position)
            .then(x.video_id.cmp(&y.video_id))
    });

    let sync_id = if a.sync_id <= b.sync_id {
        a.sync_id.clone()
    } else {
        b.sync_id.clone()
    };

    Playlist {
        sync_id,
        origin: hi.origin,
        youtube_id: hi.youtube_id.clone(),
        title: hi.title.clone(),
        description: hi.description.clone(),
        thumbnail_url: hi.thumbnail_url.clone(),
        is_music: hi.is_music,
        is_user_created: hi.is_user_created,
        is_protected: hi.is_protected,
        created_at_ms: a.created_at_ms.min(b.created_at_ms),
        updated_hlc: Hlc::max(&a.updated_hlc, &b.updated_hlc),
        deleted: hi.deleted,
        items,
        raw: hi.raw.clone(),
    }
}

// ===========================================================================================
// Settings
// ===========================================================================================

pub fn merge_settings(a: Vec<SettingEntry>, b: Vec<SettingEntry>) -> Vec<SettingEntry> {
    let mut map: BTreeMap<String, SettingEntry> =
        a.into_iter().map(|s| (s.key.clone(), s)).collect();
    for s in b {
        match map.get_mut(&s.key) {
            Some(e) => {
                if !a_wins(e, &e.hlc, &s, &s.hlc) {
                    *e = s;
                }
            }
            None => {
                map.insert(s.key.clone(), s);
            }
        }
    }
    map.into_values().collect()
}

// ===========================================================================================
// Subscriptions
// ===========================================================================================

pub fn merge_subscriptions(
    a: Vec<SubscriptionGroup>,
    b: Vec<SubscriptionGroup>,
) -> Vec<SubscriptionGroup> {
    let mut map: BTreeMap<String, SubscriptionGroup> = BTreeMap::new();
    for mut g in a.into_iter().chain(b) {
        normalize_channel_ids(&mut g.channel_ids);
        match map.remove(&g.name) {
            Some(existing) => {
                map.insert(g.name.clone(), merge_one_subscription(&existing, &g));
            }
            None => {
                map.insert(g.name.clone(), g);
            }
        }
    }
    map.into_values().collect()
}

fn normalize_channel_ids(ids: &mut Vec<String>) {
    let set: BTreeSet<String> = ids.drain(..).filter(|c| !c.is_empty()).collect();
    *ids = set.into_iter().collect();
}

fn merge_one_subscription(a: &SubscriptionGroup, b: &SubscriptionGroup) -> SubscriptionGroup {
    let mut set: BTreeSet<String> = a.channel_ids.iter().cloned().collect();
    set.extend(b.channel_ids.iter().cloned());
    let channel_ids: Vec<String> = set.into_iter().collect();

    let sort_order = match a.hlc.cmp(&b.hlc) {
        std::cmp::Ordering::Greater => a.sort_order,
        std::cmp::Ordering::Less => b.sort_order,
        std::cmp::Ordering::Equal => {
            if a.sort_order.to_string() >= b.sort_order.to_string() {
                a.sort_order
            } else {
                b.sort_order
            }
        }
    };

    SubscriptionGroup {
        channel_ids,
        deleted: tombstone_wins(a.deleted, &a.hlc, b.deleted, &b.hlc),
        hlc: Hlc::max(&a.hlc, &b.hlc),
        name: a.name.clone(),
        sort_order,
    }
}

/// Tombstone resolution for two records with the same key: when exactly one side is a tombstone it
/// wins iff its stamp is `>=` the live record's. That is what makes a later delete remove the record
/// on the peer while a later re-create restores it.
fn tombstone_wins(a_deleted: bool, a_hlc: &Hlc, b_deleted: bool, b_hlc: &Hlc) -> bool {
    match (a_deleted, b_deleted) {
        (true, true) => true,
        (false, false) => false,
        (true, false) => a_hlc >= b_hlc,
        (false, true) => b_hlc >= a_hlc,
    }
}

// ===========================================================================================
// Subscribed channels
// ===========================================================================================

/// Merge the followed-channel lists (`FLOW-SYNC/1` §10.0). Per-record LWW by `hlc` with tombstones.
pub fn merge_subscribed_channels(
    a: Vec<SubscribedChannel>,
    b: Vec<SubscribedChannel>,
) -> Vec<SubscribedChannel> {
    let mut map: BTreeMap<String, SubscribedChannel> = a
        .into_iter()
        .filter(|c| !c.channel_id.is_empty())
        .map(|c| (c.channel_id.clone(), c))
        .collect();
    for c in b.into_iter().filter(|c| !c.channel_id.is_empty()) {
        match map.get_mut(&c.channel_id) {
            Some(e) => *e = merge_one_channel(e, &c),
            None => {
                map.insert(c.channel_id.clone(), c);
            }
        }
    }
    map.into_values().collect()
}

fn merge_one_channel(a: &SubscribedChannel, b: &SubscribedChannel) -> SubscribedChannel {
    let (win, lose) = if a_wins(a, &a.hlc, b, &b.hlc) {
        (a, b)
    } else {
        (b, a)
    };
    let pick = |w: &String, l: &String| if w.is_empty() { l.clone() } else { w.clone() };
    SubscribedChannel {
        channel_id: a.channel_id.clone(),
        // A tombstone carries no display metadata, so the winner may legitimately be blank — take
        // the other side's value rather than blanking the channel on a re-subscribe.
        name: pick(&win.name, &lose.name),
        avatar_url: pick(&win.avatar_url, &lose.avatar_url),
        subscribed_at_ms: a.subscribed_at_ms.max(b.subscribed_at_ms),
        is_music: a.is_music || b.is_music,
        hlc: Hlc::max(&a.hlc, &b.hlc),
        deleted: tombstone_wins(a.deleted, &a.hlc, b.deleted, &b.hlc),
    }
}

// ===========================================================================================
// FlowNeuro brain
// ===========================================================================================

/// One device's learned-vector contribution, kept verbatim so the effective brain can be
/// recomputed deterministically (idempotent on re-sync — replacing a device snapshot is a no-op
/// if unchanged).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct DeviceVectors {
    pub hlc: Hlc,
    pub weight: u64,
    pub vectors: BrainVectors,
}

/// The merged FlowNeuro brain across all known devices.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct MergedFlowNeuroBrain {
    pub schema: i32,
    pub counters: BrainCounters,
    pub idf_word_frequency: BTreeMap<String, GCounter>,
    pub per_video: BrainPerVideo,
    pub sets: BrainSets,
    pub lww_maps: BrainLwwMaps,
    pub flags: BrainFlags,
    /// device_id -> that device's latest vector snapshot.
    pub device_vectors: BTreeMap<String, DeviceVectors>,
}

impl MergedFlowNeuroBrain {
    /// Fold one device's snapshot into the merged brain. Commutative, associative, idempotent.
    pub fn merge_snapshot(&mut self, snap: &FlowNeuroBrainSnapshot) {
        self.schema = self.schema.max(snap.schema);

        self.counters
            .idf_total_documents
            .merge(&snap.counters.idf_total_documents);
        self.counters
            .total_interactions
            .merge(&snap.counters.total_interactions);

        merge_gcounter_map(&mut self.idf_word_frequency, &snap.idf_word_frequency);

        max_into_f32(
            &mut self.per_video.watch_history_map,
            &snap.per_video.watch_history_map,
        );
        max_into_f32(
            &mut self.per_video.watch_signal_progress,
            &snap.per_video.watch_signal_progress,
        );

        self.sets.blocked_topics.merge(&snap.sets.blocked_topics);
        self.sets
            .blocked_channels
            .merge(&snap.sets.blocked_channels);
        self.sets
            .preferred_topics
            .merge(&snap.sets.preferred_topics);

        merge_lww_map(
            &mut self.lww_maps.suppressed_video_ids,
            &snap.lww_maps.suppressed_video_ids,
        );
        merge_lww_map(
            &mut self.lww_maps.suppressed_channels,
            &snap.lww_maps.suppressed_channels,
        );
        merge_lww_map(
            &mut self.lww_maps.rejection_patterns,
            &snap.lww_maps.rejection_patterns,
        );
        merge_lww_map(
            &mut self.lww_maps.topic_evidence,
            &snap.lww_maps.topic_evidence,
        );
        merge_lww_map(&mut self.lww_maps.feed_history, &snap.lww_maps.feed_history);
        merge_lww_map(
            &mut self.lww_maps.channel_strikes,
            &snap.lww_maps.channel_strikes,
        );

        self.flags.has_completed_onboarding |= snap.flags.has_completed_onboarding;

        // Per-device vectors: keep the snapshot with the higher hlc for that device.
        let weight = {
            let w = snap.counters.idf_total_documents.get(&snap.device_id);
            if w > 0 {
                w
            } else {
                snap.counters.idf_total_documents.total()
            }
        };
        let incoming = DeviceVectors {
            hlc: snap.hlc.clone(),
            weight,
            vectors: snap.vectors.clone(),
        };
        match self.device_vectors.get(&snap.device_id) {
            Some(existing) if existing.hlc >= incoming.hlc => {}
            _ => {
                self.device_vectors.insert(snap.device_id.clone(), incoming);
            }
        }
    }

    /// Deterministically recompute the effective learned vectors, weighting each device by its
    /// experience (idf document count). Order-independent.
    pub fn effective_vectors(&self) -> BrainVectors {
        let devices: Vec<&DeviceVectors> = self.device_vectors.values().collect();

        let global = {
            let c: Vec<(u64, &ContentVectorWire)> = devices
                .iter()
                .map(|d| (d.weight, &d.vectors.global_vector))
                .collect();
            blend_vectors(&c)
        };

        let topic_affinities = {
            let c: Vec<(u64, &BTreeMap<String, f64>)> = devices
                .iter()
                .map(|d| (d.weight, &d.vectors.topic_affinities))
                .collect();
            blend_maps(&c)
        };
        let channel_scores = {
            let c: Vec<(u64, &BTreeMap<String, f64>)> = devices
                .iter()
                .map(|d| (d.weight, &d.vectors.channel_scores))
                .collect();
            blend_maps(&c)
        };

        let shorts_vector = {
            let c: Vec<(u64, &ContentVectorWire)> = devices
                .iter()
                .filter_map(|d| d.vectors.shorts_vector.as_ref().map(|v| (d.weight, v)))
                .collect();
            if c.is_empty() {
                None
            } else {
                Some(blend_vectors(&c))
            }
        };

        // time_vectors: blend per bucket.
        let mut buckets: BTreeSet<&String> = BTreeSet::new();
        for d in &devices {
            for k in d.vectors.time_vectors.keys() {
                buckets.insert(k);
            }
        }
        let mut time_vectors = BTreeMap::new();
        for bucket in buckets {
            let c: Vec<(u64, &ContentVectorWire)> = devices
                .iter()
                .filter_map(|d| d.vectors.time_vectors.get(bucket).map(|v| (d.weight, v)))
                .collect();
            time_vectors.insert(bucket.clone(), blend_vectors(&c));
        }

        // channel_topic_profiles: blend the inner per-channel maps.
        let mut channels: BTreeSet<&String> = BTreeSet::new();
        for d in &devices {
            for k in d.vectors.channel_topic_profiles.keys() {
                channels.insert(k);
            }
        }
        let mut channel_topic_profiles = BTreeMap::new();
        for ch in channels {
            let c: Vec<(u64, &BTreeMap<String, f64>)> = devices
                .iter()
                .filter_map(|d| {
                    d.vectors
                        .channel_topic_profiles
                        .get(ch)
                        .map(|m| (d.weight, m))
                })
                .collect();
            channel_topic_profiles.insert(ch.clone(), blend_maps(&c));
        }

        BrainVectors {
            global_vector: global,
            time_vectors,
            shorts_vector,
            topic_affinities,
            channel_scores,
            channel_topic_profiles,
        }
    }
}

/// Fold a list of FlowNeuro snapshots (from any number of devices) into one merged brain.
pub fn merge_flow_neuro(snapshots: &[FlowNeuroBrainSnapshot]) -> MergedFlowNeuroBrain {
    let mut merged = MergedFlowNeuroBrain::default();
    for snap in snapshots {
        merged.merge_snapshot(snap);
    }
    merged
}

// ===========================================================================================
// Music brain
// ===========================================================================================

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct MergedMusicBrain {
    pub schema: i32,
    pub total_plays: GCounter,
    pub artist_affinity: BTreeMap<String, AffinityWire>,
    pub genre_affinity: BTreeMap<String, f64>,
    pub artist_cooc: BTreeMap<String, f64>,
    pub recent_rotation: BTreeMap<String, f64>,
    pub time_buckets: BTreeMap<String, BTreeMap<String, f64>>,
    pub track_plays: BTreeMap<String, Vec<u64>>,
    pub track_meta: BTreeMap<String, TrackMetaWire>,
    pub seen_artists: OrSet,
    pub blocked_artists: OrSet,
    pub disliked_artists: BTreeMap<String, Lww<u64>>,
    pub discovery_appetite: Option<Lww<f64>>,
}

impl MergedMusicBrain {
    pub fn merge_snapshot(&mut self, snap: &MusicBrainSnapshot) {
        self.schema = self.schema.max(snap.schema);
        self.total_plays.merge(&snap.total_plays);

        for (artist, aff) in &snap.artist_affinity {
            match self.artist_affinity.get_mut(artist) {
                Some(e) => *e = merge_affinity(e, aff),
                None => {
                    self.artist_affinity.insert(artist.clone(), aff.clone());
                }
            }
        }

        max_into_f64(&mut self.genre_affinity, &snap.genre_affinity);
        max_into_f64(&mut self.artist_cooc, &snap.artist_cooc);
        max_into_f64(&mut self.recent_rotation, &snap.recent_rotation);

        for (bucket, hist) in &snap.time_buckets {
            let e = self.time_buckets.entry(bucket.clone()).or_default();
            max_into_f64(e, hist);
        }

        for (track, plays) in &snap.track_plays {
            let e = self.track_plays.entry(track.clone()).or_default();
            merge_play_timestamps(e, plays);
        }

        for (track, meta) in &snap.track_meta {
            match self.track_meta.get(track) {
                // deterministic tie-break: keep the lexicographically greater (title, artist)
                Some(existing)
                    if (existing.title.as_str(), existing.artist.as_str())
                        >= (meta.title.as_str(), meta.artist.as_str()) => {}
                _ => {
                    self.track_meta.insert(track.clone(), meta.clone());
                }
            }
        }

        self.seen_artists.merge(&snap.seen_artists);
        self.blocked_artists.merge(&snap.blocked_artists);
        merge_lww_map(&mut self.disliked_artists, &snap.disliked_artists);
        self.discovery_appetite =
            merge_opt_lww(self.discovery_appetite.take(), &snap.discovery_appetite);
    }
}

fn merge_affinity(a: &AffinityWire, b: &AffinityWire) -> AffinityWire {
    let hi = if a_wins(a, &a.hlc, b, &b.hlc) { a } else { b };
    let mut plays = a.plays.clone();
    plays.merge(&b.plays);
    AffinityWire {
        plays,
        score: hi.score,
        last_played: a.last_played.max(b.last_played),
        liked: a.liked || b.liked,
        hlc: Hlc::max(&a.hlc, &b.hlc),
    }
}

/// Union play timestamps, dedupe, keep the newest 8 (matches the ACT-R ring size). Idempotent.
const PLAY_RING: usize = 8;
fn merge_play_timestamps(dst: &mut Vec<u64>, src: &[u64]) {
    let mut set: BTreeSet<u64> = dst.iter().copied().collect();
    set.extend(src.iter().copied());
    let mut all: Vec<u64> = set.into_iter().collect(); // ascending, deduped
    if all.len() > PLAY_RING {
        all = all.split_off(all.len() - PLAY_RING);
    }
    *dst = all;
}

pub fn merge_music(snapshots: &[MusicBrainSnapshot]) -> MergedMusicBrain {
    let mut merged = MergedMusicBrain::default();
    for snap in snapshots {
        merged.merge_snapshot(snap);
    }
    merged
}
