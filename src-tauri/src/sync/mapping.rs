//! Mapping between the desktop database and the canonical wire model.
//!
//! wires **watch_history** (a real `sqlx` table) through the apply pipeline. The other
//! collections plug into the same pipeline as follow-on increments:
//! * `settings` — needs the finalized cross-platform key whitelist
//! * `flow_neuro_brain` / `music_brain` — Rust structs exist (`flow_neuro::scoring::UserBrain`,
//!   `music_brain::model::MusicBrain`) but their idempotent apply needs the per-device merged-state
//!   persistence plus resident-store flush/reload coordination
//! * `playlists` / `likes` — stored as frontend-authored JSON blobs in `settings`
//!   (`user_playlists`, `liked_items`); they need lossless Rust mirrors of the TS shapes.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sync::canonical::{
    Hlc, Like, LikeKind, LikeState, Playlist, PlaylistItem, PlaylistOrigin, SubscribedChannel,
    SubscriptionGroup, WatchHistoryRecord,
};

/// Frontend settings key holding the liked-items JSON array.
pub const LIKES_SETTING_KEY: &str = "liked_items";
/// Frontend settings key holding the playlists JSON array.
pub const PLAYLISTS_SETTING_KEY: &str = "user_playlists";
pub const ALBUMS_SETTING_KEY: &str = "saved_albums";
pub const SUBSCRIPTION_GROUPS_SETTING_KEY: &str = "subscription_groups";
/// Frontend settings key holding the followed-channel JSON array (the channels themselves, as
/// opposed to the folders in [`SUBSCRIPTION_GROUPS_SETTING_KEY`]).
pub const SUBSCRIBED_CHANNELS_SETTING_KEY: &str = "subscriptions";
/// Unsubscribe tombstones, `{channelId: epochMs}`. Persisted rather than derived: a channel that is
/// simply absent is indistinguishable from one this device never followed, so without this the peer
/// would re-add everything the user just unsubscribed from (`FLOW-SYNC/1` §10.0).
pub const SUBSCRIPTION_TOMBSTONES_SETTING_KEY: &str = "subscription_tombstones";
/// How long an unsubscribe tombstone is retained before pruning. Matches Android so the two sides
/// forget at the same rate.
pub const TOMBSTONE_TTL_MS: u64 = 365 * 24 * 60 * 60 * 1000;
/// Reserved cross-device id for the protected "Watch Later" playlist.
pub const WATCH_LATER_SYNC_ID: &str = "reserved:watch-later";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupBlobIn {
    #[serde(default)]
    name: String,
    #[serde(default)]
    channel_ids: Vec<String>,
    #[serde(default)]
    sort_order: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupBlobOut<'a> {
    name: &'a str,
    channel_ids: &'a [String],
    sort_order: i32,
}

pub fn parse_subscription_groups_blob(raw: &str, hlc: &Hlc) -> Vec<SubscriptionGroup> {
    let entries: Vec<GroupBlobIn> = serde_json::from_str(raw).unwrap_or_default();
    entries
        .into_iter()
        .filter(|e| !e.name.trim().is_empty())
        .map(|e| {
            let mut channel_ids: Vec<String> = e
                .channel_ids
                .into_iter()
                .filter(|c| !c.trim().is_empty())
                .collect();
            channel_ids.sort();
            channel_ids.dedup();
            SubscriptionGroup {
                channel_ids,
                deleted: false,
                hlc: hlc.clone(),
                name: e.name,
                sort_order: e.sort_order,
            }
        })
        .collect()
}

fn channel_str(entry: &Value, key: &str) -> String {
    entry
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Read the frontend's followed-channel array into canonical records, appending a tombstone for
/// every unsubscribe we still remember. A tombstone for a channel that is live again is dropped —
/// the live record is the newer truth.
pub fn parse_subscribed_channels_blob(
    raw: &str,
    tombstones: &BTreeMap<String, u64>,
    node: &str,
) -> Vec<SubscribedChannel> {
    let entries: Vec<Value> = serde_json::from_str(raw).unwrap_or_default();
    let mut out: Vec<SubscribedChannel> = Vec::with_capacity(entries.len() + tombstones.len());
    let mut live: BTreeSet<String> = BTreeSet::new();

    for entry in &entries {
        let channel_id = channel_str(entry, "id");
        if channel_id.trim().is_empty() {
            continue;
        }
        let subscribed_at_ms = entry
            .get("subscribedAt")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        live.insert(channel_id.clone());
        out.push(SubscribedChannel {
            hlc: Hlc::new(subscribed_at_ms, 0, node),
            channel_id,
            name: channel_str(entry, "name"),
            avatar_url: channel_str(entry, "avatarUrl"),
            subscribed_at_ms,
            is_music: entry
                .get("isMusic")
                .and_then(Value::as_bool)
                .unwrap_or_default(),
            deleted: false,
        });
    }

    for (channel_id, &at) in tombstones {
        if live.contains(channel_id) {
            continue;
        }
        out.push(SubscribedChannel {
            channel_id: channel_id.clone(),
            hlc: Hlc::new(at, 0, node),
            deleted: true,
            ..SubscribedChannel::default()
        });
    }

    out.sort_by(|a, b| a.channel_id.cmp(&b.channel_id));
    out
}

pub fn parse_subscription_tombstones(raw: &str) -> BTreeMap<String, u64> {
    serde_json::from_str::<BTreeMap<String, u64>>(raw).unwrap_or_default()
}

/// Project merged channels back into the frontend blob plus the tombstone map.
///
/// `existing_raw` is the blob being replaced: entries are patched in place rather than rebuilt, so
/// device-local fields the wire does not carry (`subscriberCountText`, and anything the frontend
/// adds later) survive a sync instead of being silently reset.
pub fn subscribed_channels_to_blob(
    merged: &[SubscribedChannel],
    existing_raw: Option<&str>,
    now_ms: u64,
) -> (String, String) {
    let existing: BTreeMap<String, Value> = existing_raw
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| {
            let id = channel_str(&e, "id");
            (!id.is_empty()).then_some((id, e))
        })
        .collect();

    let mut live: Vec<Value> = Vec::new();
    let mut tombstones: BTreeMap<String, u64> = BTreeMap::new();

    for channel in merged {
        if channel.channel_id.trim().is_empty() {
            continue;
        }
        if channel.deleted {
            // Keep a tombstone even for a channel this device never had, so the unsubscribe still
            // reaches a third device that does have it. Prune once it is older than the TTL.
            if now_ms.saturating_sub(channel.hlc.physical_ms) <= TOMBSTONE_TTL_MS {
                tombstones.insert(channel.channel_id.clone(), channel.hlc.physical_ms);
            }
            continue;
        }
        let mut entry = existing
            .get(&channel.channel_id)
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("id".into(), Value::String(channel.channel_id.clone()));
            if !channel.name.is_empty() {
                obj.insert("name".into(), Value::String(channel.name.clone()));
            }
            if !channel.avatar_url.is_empty() {
                obj.insert(
                    "avatarUrl".into(),
                    Value::String(channel.avatar_url.clone()),
                );
            }
            if channel.subscribed_at_ms > 0 {
                obj.insert("subscribedAt".into(), Value::from(channel.subscribed_at_ms));
            }
            if channel.is_music {
                obj.insert("isMusic".into(), Value::Bool(true));
            }
        }
        live.push(entry);
    }

    (
        serde_json::to_string(&live).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string(&tombstones).unwrap_or_else(|_| "{}".to_string()),
    )
}

pub fn subscription_groups_to_blob(groups: &[SubscriptionGroup]) -> String {
    let live: Vec<GroupBlobOut> = groups
        .iter()
        .filter(|g| !g.deleted && !g.name.trim().is_empty())
        .map(|g| GroupBlobOut {
            name: &g.name,
            channel_ids: &g.channel_ids,
            sort_order: g.sort_order,
        })
        .collect();
    serde_json::to_string(&live).unwrap_or_else(|_| "[]".to_string())
}

/// The curated set of settings that sync across devices: **player, content/UI, and quality**
/// preferences plus the SponsorBlock/DeArrow feature toggles — i.e. behavior that should feel the
/// same on every device. Deliberately EXCLUDED: download paths, proxy host/credentials, network
/// buffer tuning, media-cache size, auto-backup config, private ids, internal counters, and
/// transient Deep-Flow runtime state. (Cross-platform: Android maps its DataStore keys to these.)
pub const SYNCABLE_SETTINGS: &[&str] = &[
    // --- player ---
    "autoplay_enabled",
    "video_loop_enabled",
    "skip_silence_enabled",
    "stable_volume_enabled",
    "allow_volume_boost",
    "remember_playback_speed",
    "playback_speed",
    "custom_speeds_enabled",
    "custom_speed_presets",
    "long_press_playback_speed",
    "speed_slider_enabled",
    "double_tap_seek_seconds",
    "subtitles_enabled",
    "preferred_subtitle_language",
    "subtitle_font_size",
    "subtitle_bold",
    "mini_player_show_skip_controls",
    "mini_player_show_next_prev_controls",
    "show_fullscreen_title",
    "adaptive_player_size_enabled",
    "auto_pip_enabled",
    "manual_pip_button_enabled",
    "lyrics_provider_order",
    "lyrics_provider_enabled_states",
    // --- content / UI ---
    "video_title_max_lines",
    "download_dialog_style",
    "home_feed_enabled",
    "show_app_logo_icon",
    "shorts_shelf_enabled",
    "home_shorts_shelf_enabled",
    "continue_watching_enabled",
    "comments_enabled",
    "show_related_videos",
    "hide_watched_videos",
    "disable_shorts_player",
    "shorts_navigation_enabled",
    "shorts_playback_mode",
    "shorts_auto_scroll_seconds",
    "music_navigation_enabled",
    "categories_nav_tab_enabled",
    "subscription_refresh_on_startup",
    "subscription_show_videos",
    "subscription_show_shorts",
    "subscription_show_live",
    "show_region_picker_in_explore",
    "trending_region",
    "deep_flow_expire_hours",
    "deep_flow_save_history",
    // --- quality ---
    "default_quality_wifi",
    "default_video_codec",
    "shorts_quality_wifi",
    "music_audio_quality",
    "preferred_audio_language",
    // --- extensions (feature toggles, not ids/counters) ---
    "sponsorblock_enabled",
    "dearrow_enabled",
    "dearrow_badge_enabled",
    "rytd_enabled",
    "sb_submit_enabled",
    "sponsorblock_server",
    "sponsorblock_colors",
    "sponsorblock_categories",
];

/// Whether a setting key is allowed to sync (defends against a peer pushing excluded keys).
pub fn is_syncable_setting(key: &str) -> bool {
    SYNCABLE_SETTINGS.contains(&key)
}

/// Convert epoch milliseconds to the RFC-3339 string the `watch_history.watch_date` column uses.
pub fn ms_to_iso(ms: u64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms as i64)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

/// Parse an RFC-3339 (or similar) timestamp into epoch milliseconds; `0` if unparseable.
pub fn iso_to_ms(s: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis().max(0) as u64)
        .unwrap_or(0)
}

/// A row read from `watch_history` (with the sync columns added by migration `0010`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct WatchRow {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub channel_id: Option<String>,
    pub watch_date: String,
    pub watch_duration_seconds: i64,
    pub total_duration_seconds: Option<i64>,
    pub is_music: bool,
    pub is_short: bool,
    pub updated_hlc: Option<String>,
}

impl WatchRow {
    /// Project a DB row into a canonical record. `device_id` seeds a synthetic HLC for legacy rows
    /// that predate the `updated_hlc` column.
    pub fn to_canonical(&self, device_id: &str) -> WatchHistoryRecord {
        let watched_at_ms = iso_to_ms(&self.watch_date);
        let total = self.total_duration_seconds.unwrap_or(0);
        let progress = if total > 0 {
            (self.watch_duration_seconds as f32 / total as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let hlc = self
            .updated_hlc
            .as_deref()
            .and_then(|s| s.parse::<Hlc>().ok())
            .unwrap_or_else(|| Hlc::new(watched_at_ms, 0, device_id));

        WatchHistoryRecord {
            video_id: self.video_id.clone(),
            title: self.title.clone(),
            channel_name: self.channel_name.clone(),
            channel_id: self.channel_id.clone(),
            watched_at_ms,
            progress,
            duration_seconds: self.total_duration_seconds.map(|t| t.max(0) as u64),
            is_music: self.is_music,
            is_short: self.is_short,
            hlc,
            deleted: false,
        }
    }
}

/// The DB column values for a canonical record, ready to bind into an INSERT.
pub struct WatchInsert {
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub channel_id: Option<String>,
    pub watch_date: String,
    pub watch_duration_seconds: i64,
    pub total_duration_seconds: Option<i64>,
    pub is_music: bool,
    pub is_short: bool,
    pub updated_hlc: String,
}

impl WatchInsert {
    pub fn from_canonical(rec: &WatchHistoryRecord) -> Self {
        let total = rec.duration_seconds.unwrap_or(0);
        let watch_duration_seconds = (f64::from(rec.progress) * total as f64).round() as i64;
        WatchInsert {
            video_id: rec.video_id.clone(),
            title: rec.title.clone(),
            channel_name: rec.channel_name.clone(),
            channel_id: rec.channel_id.clone(),
            watch_date: ms_to_iso(rec.watched_at_ms),
            watch_duration_seconds,
            total_duration_seconds: rec.duration_seconds.map(|d| d as i64),
            is_music: rec.is_music,
            is_short: rec.is_short,
            updated_hlc: rec.hlc.to_string(),
        }
    }
}

// ===========================================================================================
// Likes  (frontend `liked_items` JSON blob  ⇄  canonical)
// ===========================================================================================

/// The merge key for a like (`kind:id`).
pub fn like_key(l: &Like) -> String {
    let kind = match l.kind {
        LikeKind::Video => "video",
        LikeKind::Music => "music",
    };
    format!("{kind}:{}", l.id)
}

/// Parse the `liked_items` blob into canonical likes. The whole original item object is kept in
/// `meta` for lossless round-tripping; the HLC is derived from the stable `likedAt` timestamp.
pub fn parse_likes_blob(json: &str, device_id: &str) -> Vec<Like> {
    let arr: Vec<Value> = serde_json::from_str(json).unwrap_or_default();
    arr.into_iter()
        .filter_map(|v| like_from_value(v, device_id))
        .collect()
}

fn like_from_value(v: Value, device_id: &str) -> Option<Like> {
    let kind = match v.get("kind").and_then(Value::as_str) {
        Some("music") => LikeKind::Music,
        Some("video") => LikeKind::Video,
        _ => return None,
    };
    let id = v.get("id").and_then(Value::as_str)?.to_string();
    let ms = v
        .get("likedAt")
        .and_then(Value::as_str)
        .map(iso_to_ms)
        .unwrap_or(0);
    Some(Like {
        kind,
        id,
        state: LikeState::Liked,
        updated_at_ms: ms,
        hlc: Hlc::new(ms, 0, device_id),
        meta: Some(v),
    })
}

/// Serialize canonical likes back to the `liked_items` blob (newest first, tombstones dropped).
///
/// Every item is normalized into the exact shape the desktop frontend (`useLikesStore`/`useLikes`)
/// expects: a top-level `{kind,id,likedAt}` plus a nested `song` object (music) or `video` object
/// (video). Desktop-origin items already carry that nested object and pass through losslessly;
/// **cross-platform items** (e.g. Android, whose like `meta` is flatter / differently keyed) get the
/// nested object **synthesized** from whatever fields the meta provides — so the frontend never
/// crashes with "Cannot read properties of undefined (reading 'videoId')" on a missing `song`.
pub fn likes_to_blob(likes: &[Like]) -> String {
    let mut live: Vec<&Like> = likes
        .iter()
        .filter(|l| l.state == LikeState::Liked)
        .collect();
    live.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms).then(a.id.cmp(&b.id)));
    let arr: Vec<Value> = live.iter().map(|l| like_to_frontend_value(l)).collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

/// Build a frontend-valid liked item, keeping any fields the source item already had (so a
/// desktop→android→desktop round-trip stays lossless) and guaranteeing the nested `song`/`video`.
fn like_to_frontend_value(l: &Like) -> Value {
    let mut obj = match l.meta.clone() {
        Some(Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    let kind = match l.kind {
        LikeKind::Video => "video",
        LikeKind::Music => "music",
    };
    obj.insert("kind".to_string(), Value::String(kind.to_string()));
    if obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .is_none()
    {
        obj.insert("id".to_string(), Value::String(l.id.clone()));
    }
    if obj.get("likedAt").and_then(Value::as_str).is_none() {
        obj.insert(
            "likedAt".to_string(),
            Value::String(ms_to_iso(l.updated_at_ms)),
        );
    }
    match l.kind {
        LikeKind::Music => {
            let song = build_song(&obj, &l.id);
            obj.insert("song".to_string(), song);
        }
        LikeKind::Video if !obj.get("video").is_some_and(Value::is_object) => {
            let video = build_video(&obj, &l.id);
            obj.insert("video".to_string(), video);
        }
        _ => {}
    }
    Value::Object(obj)
}

/// First non-empty string among `keys`.
fn first_str(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        obj.get(*k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// First numeric value among `keys` (accepts ints or floats), truncated to i64.
fn first_num(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|k| {
        obj.get(*k)
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
    })
}

fn normalize_artists_value(v: &Value) -> Vec<Value> {
    match v {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|a| match a {
                Value::String(s) if !s.is_empty() => {
                    Some(serde_json::json!({ "name": s, "id": Value::Null }))
                }
                Value::Object(m) => {
                    let name = m
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| m.get("text").and_then(Value::as_str))
                        .filter(|s| !s.is_empty())?;
                    Some(serde_json::json!({
                        "name": name,
                        "id": m.get("id").cloned().unwrap_or(Value::Null),
                    }))
                }
                _ => None,
            })
            .collect(),
        Value::String(s) if !s.is_empty() => {
            vec![serde_json::json!({ "name": s, "id": Value::Null })]
        }
        _ => Vec::new(),
    }
}

/// Build an `Artist[]`-shaped value from an `artists` field (objects or strings), a nested
/// container that carries one, or a flat artist/author string. Empty if nothing usable is found.
fn build_artists(obj: &serde_json::Map<String, Value>) -> Value {
    // 1. an explicit `artists` field (array of objects/strings, or a single string).
    if let Some(v) = obj.get("artists") {
        let norm = normalize_artists_value(v);
        if !norm.is_empty() {
            return Value::Array(norm);
        }
    }
    // 2. a nested container (`song`/`track`/…) that itself carries the artists.
    for nk in ["song", "track", "item", "content"] {
        if let Some(inner) = obj.get(nk).and_then(Value::as_object) {
            let a = build_artists(inner);
            if a.as_array().is_some_and(|x| !x.is_empty()) {
                return a;
            }
        }
    }
    // 3. a flat single-string field (kept as ONE name; the UI joins multiple names with ", ").
    match first_str(
        obj,
        &[
            "artist",
            "artistsText",
            "artistText",
            "author",
            "byline",
            "subtitle",
            "uploaderName",
            "channelName",
            "channel_name",
            "channel",
        ],
    ) {
        Some(name) => serde_json::json!([{ "name": name, "id": Value::Null }]),
        None => serde_json::json!([]),
    }
}

fn build_song(parent: &serde_json::Map<String, Value>, fallback_id: &str) -> Value {
    let mut song: serde_json::Map<String, Value> = parent
        .get("song")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let artists = {
        let existing = song
            .get("artists")
            .map(normalize_artists_value)
            .unwrap_or_default();
        if existing.is_empty() {
            let from_song = build_artists(&song);
            if from_song.as_array().is_some_and(|a| !a.is_empty()) {
                from_song
            } else {
                build_artists(parent)
            }
        } else {
            Value::Array(existing)
        }
    };
    song.insert("artists".to_string(), artists);

    if first_str(&song, &["id"]).is_none() {
        let id = first_str(parent, &["id", "videoId"]).unwrap_or_else(|| fallback_id.to_string());
        song.insert("id".to_string(), Value::String(id));
    }
    if first_str(&song, &["videoId"]).is_none() {
        if let Some(v) =
            first_str(parent, &["videoId", "videoID"]).or_else(|| first_str(&song, &["id"]))
        {
            song.insert("videoId".to_string(), Value::String(v));
        }
    }
    if song.get("title").and_then(Value::as_str).is_none() {
        let t = first_str(&song, &["name"])
            .or_else(|| first_str(parent, &["title", "name"]))
            .unwrap_or_default();
        song.insert("title".to_string(), Value::String(t));
    }
    if first_str(&song, &["thumbnail"]).is_none() {
        if let Some(th) = first_str(&song, &["thumbnailUrl", "thumbnail_url", "artworkUrl"])
            .or_else(|| {
                first_str(
                    parent,
                    &["thumbnail", "thumbnailUrl", "thumbnail_url", "artworkUrl"],
                )
            })
        {
            song.insert("thumbnail".to_string(), Value::String(th));
        }
    }
    if song.get("duration").is_none() {
        if let Some(d) = first_num(&song, &["durationSeconds", "duration_seconds"])
            .or_else(|| first_num(parent, &["duration", "durationSeconds", "duration_seconds"]))
        {
            song.insert("duration".to_string(), Value::Number(d.into()));
        }
    }
    Value::Object(song)
}

/// Synthesize a `VideoSummary`-shaped object from a flat/foreign like meta (best-effort).
fn build_video(obj: &serde_json::Map<String, Value>, fallback_id: &str) -> Value {
    let id = first_str(obj, &["id", "videoId"]).unwrap_or_else(|| fallback_id.to_string());
    serde_json::json!({
        "id": id,
        "title": first_str(obj, &["title", "name"]).unwrap_or_default(),
        "channelName": first_str(obj, &["channelName", "channel_name", "author", "artist", "channel"]).unwrap_or_default(),
        "channelId": obj.get("channelId").cloned().unwrap_or(Value::Null),
        "thumbnailUrl": first_str(obj, &["thumbnailUrl", "thumbnail_url", "thumbnail"]),
        "durationSeconds": first_num(obj, &["durationSeconds", "duration_seconds", "duration"]),
        "viewCountText": obj.get("viewCountText").cloned().unwrap_or(Value::Null),
    })
}

// ===========================================================================================
// Playlists  (frontend `user_playlists` JSON blob  ⇄  canonical)
// ===========================================================================================

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoSummaryMirror {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    channel_name: String,
    #[serde(default)]
    channel_id: Option<String>,
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    duration_seconds: Option<i64>,
    #[serde(default)]
    is_live: Option<bool>,
    /// Any other VideoSummary fields (publishedText, viewCountText, …) preserved verbatim.
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPlaylistMirror {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    source_title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tracks: Vec<VideoSummaryMirror>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    thumbnail_url: Option<String>,
    #[serde(default)]
    video_count_text: Option<String>,
    #[serde(default)]
    video_count: Option<i64>,
    #[serde(default)]
    is_protected: Option<bool>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

/// Parse the `user_playlists` blob into canonical playlists, deriving a stable `sync_id` and HLC.
pub fn parse_playlists_blob(json: &str, device_id: &str) -> Vec<Playlist> {
    let arr: Vec<StoredPlaylistMirror> = serde_json::from_str(json).unwrap_or_default();
    arr.into_iter()
        .map(|m| playlist_from_mirror(m, device_id))
        .collect()
}

fn playlist_from_mirror(m: StoredPlaylistMirror, device_id: &str) -> Playlist {
    let created_ms = m.created_at.as_deref().map(iso_to_ms).unwrap_or(0);
    let (sync_id, origin, youtube_id, is_user_created, is_protected) =
        if m.is_protected == Some(true) || m.id == "watch-later" {
            (
                WATCH_LATER_SYNC_ID.to_string(),
                PlaylistOrigin::Local,
                None,
                false,
                true,
            )
        } else if m.source.as_deref() == Some("Saved") {
            (
                format!("yt:{}", m.id),
                PlaylistOrigin::Youtube,
                Some(m.id.clone()),
                false,
                false,
            )
        } else {
            (m.id.clone(), PlaylistOrigin::Local, None, true, false)
        };

    let hlc = Hlc::new(created_ms, 0, device_id);
    let items = m
        .tracks
        .iter()
        .enumerate()
        .map(|(i, t)| PlaylistItem {
            video_id: t.id.clone(),
            position: i as i64,
            added_at_ms: created_ms,
            deleted: false,
            title: Some(t.title.clone()),
            channel_name: Some(t.channel_name.clone()),
            channel_id: t.channel_id.clone(),
            thumbnail_url: t.thumbnail_url.clone(),
            duration_seconds: t.duration_seconds.map(|d| d.max(0) as u64),
            is_music: false,
            hlc: hlc.clone(),
            raw: serde_json::to_value(t).ok(),
        })
        .collect();

    let raw = serde_json::json!({
        "sourceTitle": m.source_title,
        "thumbnailUrl": m.thumbnail_url,
        "videoCountText": m.video_count_text,
        "videoCount": m.video_count,
        "extra": m.extra,
    });

    let thumbnail_url = m
        .thumbnail_url
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            m.tracks
                .iter()
                .find_map(|t| t.thumbnail_url.clone().filter(|s| !s.is_empty()))
        });

    Playlist {
        sync_id,
        origin,
        youtube_id,
        title: m.name,
        description: m.description,
        thumbnail_url,
        is_music: false,
        is_user_created,
        is_protected,
        created_at_ms: created_ms,
        updated_hlc: hlc,
        deleted: false,
        items,
        raw: Some(raw),
    }
}

/// Serialize canonical playlists back to the `user_playlists` blob (tombstones dropped).
pub fn playlists_to_blob(playlists: &[Playlist]) -> String {
    let arr: Vec<StoredPlaylistMirror> = playlists
        .iter()
        .filter(|p| !p.deleted)
        .map(playlist_to_mirror)
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

fn playlist_to_mirror(p: &Playlist) -> StoredPlaylistMirror {
    let id = if let Some(yt) = &p.youtube_id {
        yt.clone()
    } else if p.sync_id == WATCH_LATER_SYNC_ID {
        "watch-later".to_string()
    } else {
        p.sync_id.clone()
    };

    let raw = p.raw.clone().unwrap_or(Value::Null);
    let str_field = |k: &str| raw.get(k).and_then(Value::as_str).map(String::from);
    let extra = raw
        .get("extra")
        .and_then(Value::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let mut tracks: Vec<&PlaylistItem> = p.items.iter().filter(|i| !i.deleted).collect();
    tracks.sort_by(|a, b| {
        a.position
            .cmp(&b.position)
            .then(a.video_id.cmp(&b.video_id))
    });
    let tracks = tracks.into_iter().map(item_to_mirror).collect();

    StoredPlaylistMirror {
        id,
        name: p.title.clone(),
        source_title: str_field("sourceTitle"),
        description: p.description.clone(),
        tracks,
        created_at: Some(ms_to_iso(p.created_at_ms)),
        source: Some(
            if p.origin == PlaylistOrigin::Youtube {
                "Saved"
            } else {
                "Owned"
            }
            .to_string(),
        ),
        thumbnail_url: p
            .thumbnail_url
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| str_field("thumbnailUrl")),
        video_count_text: str_field("videoCountText"),
        video_count: raw.get("videoCount").and_then(Value::as_i64),
        is_protected: if p.is_protected { Some(true) } else { None },
        extra,
    }
}

fn item_to_mirror(i: &PlaylistItem) -> VideoSummaryMirror {
    if let Some(raw) = &i.raw {
        if let Ok(m) = serde_json::from_value::<VideoSummaryMirror>(raw.clone()) {
            return m;
        }
    }
    VideoSummaryMirror {
        id: i.video_id.clone(),
        title: i.title.clone().unwrap_or_default(),
        channel_name: i.channel_name.clone().unwrap_or_default(),
        channel_id: i.channel_id.clone(),
        thumbnail_url: i.thumbnail_url.clone(),
        duration_seconds: i.duration_seconds.map(|d| d as i64),
        is_live: None,
        extra: BTreeMap::new(),
    }
}

// ===========================================================================================
// Albums  (frontend `saved_albums` JSON blob  ⇄  canonical playlists, tagged `is_music`)
// ===========================================================================================

/// A `StoredAlbum` (desktop `useAlbumLibraryStore`) ⇄ canonical mirror.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAlbumMirror {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    source: Option<String>, // "Owned" | "Saved"
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    artists: Option<Value>, // Artist[] | null
    #[serde(default)]
    year: Option<i64>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    explicit: Option<bool>,
    #[serde(default)]
    browse_id: Option<String>,
    #[serde(default)]
    playlist_id: Option<String>,
    #[serde(default)]
    tracks: Option<Vec<Value>>, // SongItem[]
    #[serde(default)]
    created_at: Option<String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}
#[must_use]
pub fn is_album_playlist(p: &Playlist) -> bool {
    if p.is_music {
        return true;
    }
    if p.sync_id.starts_with("album:") {
        return true;
    }
    if let Some(y) = p.youtube_id.as_deref() {
        if y.starts_with("OLAK5uy_") || y.starts_with("MPRE") {
            return true;
        }
    }
    p.raw
        .as_ref()
        .and_then(|r| r.get("album"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The comma-joined artist display string for a song value (frontend `artistsText` shape).
fn song_artists_text(song: &Value) -> Option<String> {
    let obj = song.as_object()?;
    let names: Vec<String> = build_artists(obj)
        .as_array()?
        .iter()
        .filter_map(|a| a.get("name").and_then(Value::as_str).map(String::from))
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

/// A `SongItem` value → canonical playlist item (the full song is kept in `raw` for a lossless trip).
pub fn song_to_item(song: &Value, position: i64, added_ms: u64, hlc: &Hlc) -> PlaylistItem {
    let obj = song.as_object().cloned().unwrap_or_default();
    PlaylistItem {
        video_id: first_str(&obj, &["videoId", "id"]).unwrap_or_default(),
        position,
        added_at_ms: added_ms,
        deleted: false,
        title: first_str(&obj, &["title", "name"]),
        channel_name: song_artists_text(song),
        channel_id: None,
        thumbnail_url: first_str(
            &obj,
            &["thumbnail", "thumbnailUrl", "thumbnail_url", "artworkUrl"],
        ),
        duration_seconds: first_num(&obj, &["duration", "durationSeconds", "duration_seconds"])
            .map(|d| d.max(0) as u64),
        is_music: true,
        hlc: hlc.clone(),
        raw: Some(song.clone()),
    }
}

/// A canonical playlist item → `SongItem` value (prefers the lossless `raw`, else synthesizes).
fn item_to_song(i: &PlaylistItem) -> Value {
    if let Some(raw) = &i.raw {
        if raw.is_object() {
            let mut song = raw.clone();
            let has_thumb = song
                .get("thumbnail")
                .and_then(Value::as_str)
                .is_some_and(|t| !t.is_empty());
            if !has_thumb {
                if let Some(t) = i.thumbnail_url.clone().filter(|s| !s.is_empty()) {
                    if let Some(obj) = song.as_object_mut() {
                        obj.insert("thumbnail".to_string(), Value::String(t));
                    }
                }
            }
            return song;
        }
    }
    let artists = i
        .channel_name
        .as_deref()
        .filter(|s| !s.is_empty())
        .map_or_else(
            || serde_json::json!([]),
            |n| serde_json::json!([{ "name": n, "id": Value::Null }]),
        );
    serde_json::json!({
        "id": i.video_id,
        "videoId": i.video_id,
        "title": i.title.clone().unwrap_or_default(),
        "artists": artists,
        "album": Value::Null,
        "duration": i.duration_seconds.map(|d| d as i64),
        "musicVideoType": Value::Null,
        "thumbnail": i.thumbnail_url.clone().unwrap_or_default(),
        "explicit": false,
        "playlistId": Value::Null,
        "params": Value::Null,
    })
}

fn album_to_playlist(m: StoredAlbumMirror, device_id: &str) -> Playlist {
    let browse = m
        .browse_id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| m.id.clone());
    let created_ms = m.created_at.as_deref().map(iso_to_ms).unwrap_or(0);
    let hlc = Hlc::new(created_ms, 0, device_id);

    // A "Saved" album is a YouTube-Music album (a globally stable id, so it dedupes by `yt:`);
    // an "Owned" album is a local user collection (keyed by normalized title, like an owned playlist).
    let saved = m.source.as_deref() == Some("Saved")
        || m.playlist_id.as_deref().is_some_and(|p| !p.is_empty())
        || browse.starts_with("MPRE")
        || browse.starts_with("OLAK5uy_");

    let (origin, youtube_id, sync_id, is_user_created) = if saved {
        (
            PlaylistOrigin::Youtube,
            Some(browse.clone()),
            format!("album:{browse}"),
            false,
        )
    } else {
        (PlaylistOrigin::Local, None, format!("album:{}", m.id), true)
    };

    let items: Vec<PlaylistItem> = m
        .tracks
        .clone()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, t)| song_to_item(t, i as i64, created_ms, &hlc))
        .collect();

    let thumbnail_url = m.thumbnail.clone().filter(|s| !s.is_empty()).or_else(|| {
        items
            .iter()
            .find_map(|t| t.thumbnail_url.clone().filter(|s| !s.is_empty()))
    });

    let raw = serde_json::json!({
        "album": true,
        "albumId": m.id,
        "browseId": m.browse_id,
        "playlistId": m.playlist_id,
        "albumArtists": m.artists,
        "year": m.year,
        "explicit": m.explicit,
        "thumbnail": m.thumbnail,
        "source": m.source,
        "extra": m.extra,
    });

    Playlist {
        sync_id,
        origin,
        youtube_id,
        title: m.title,
        description: m.description,
        thumbnail_url,
        is_music: true,
        is_user_created,
        is_protected: false,
        created_at_ms: created_ms,
        updated_hlc: hlc,
        deleted: false,
        items,
        raw: Some(raw),
    }
}

fn playlist_to_album(p: &Playlist) -> StoredAlbumMirror {
    let raw = p.raw.clone().unwrap_or(Value::Null);
    let raw_str = |k: &str| {
        raw.get(k)
            .and_then(Value::as_str)
            .map(String::from)
            .filter(|s| !s.is_empty())
    };

    let browse = raw_str("browseId")
        .or_else(|| p.youtube_id.clone())
        .or_else(|| p.sync_id.strip_prefix("album:").map(String::from))
        .unwrap_or_else(|| p.sync_id.clone());
    let id = raw_str("albumId").unwrap_or_else(|| browse.clone());

    // Album artists: explicit passthrough, else lifted from the first track's artist list.
    let artists = raw
        .get("albumArtists")
        .cloned()
        .filter(|v| !v.is_null())
        .or_else(|| {
            p.items
                .iter()
                .find_map(|i| i.raw.as_ref().and_then(|s| s.get("artists").cloned()))
        });

    let thumbnail = p
        .thumbnail_url
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| raw_str("thumbnail"))
        .or_else(|| {
            p.items
                .iter()
                .find_map(|i| i.thumbnail_url.clone().filter(|s| !s.is_empty()))
        });

    let tracks: Vec<Value> = p
        .items
        .iter()
        .filter(|i| !i.deleted)
        .map(item_to_song)
        .collect();

    let extra = raw
        .get("extra")
        .and_then(Value::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    StoredAlbumMirror {
        id,
        title: p.title.clone(),
        source: Some(if p.is_user_created { "Owned" } else { "Saved" }.to_string()),
        description: p.description.clone(),
        artists,
        year: raw.get("year").and_then(Value::as_i64),
        thumbnail,
        explicit: raw.get("explicit").and_then(Value::as_bool),
        browse_id: Some(browse),
        playlist_id: raw_str("playlistId").or_else(|| p.youtube_id.clone()),
        tracks: Some(tracks),
        created_at: Some(ms_to_iso(p.created_at_ms)),
        extra,
    }
}

/// Parse the `saved_albums` blob into canonical playlists (tagged `is_music`).
pub fn parse_albums_blob(json: &str, device_id: &str) -> Vec<Playlist> {
    let arr: Vec<StoredAlbumMirror> = serde_json::from_str(json).unwrap_or_default();
    arr.into_iter()
        .map(|m| album_to_playlist(m, device_id))
        .collect()
}

/// Serialize canonical album-playlists back to the `saved_albums` blob (tombstones dropped).
pub fn albums_to_blob(albums: &[Playlist]) -> String {
    let arr: Vec<StoredAlbumMirror> = albums
        .iter()
        .filter(|p| !p.deleted)
        .map(playlist_to_album)
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}
