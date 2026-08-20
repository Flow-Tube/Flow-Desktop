//! The **send** side of Flow Local Sync: project the local desktop database into the canonical
//! NDJSON payloads ([`OutgoingCollection`]) that the protocol streams to a peer.
//!
//! This is the mirror of [`apply`](crate::sync::apply): `apply` folds a received payload *into* the
//! DB; `export` reads the DB *out* into the wire model using the same [`mapping`] and [`brainmap`]
//! converters, so a round-trip is lossless and (for the brains) idempotent.
//!
//! The two recommendation brains are exported from their **merged CRDT state** (folding in this
//! device's freshest resident brain first), not from a single raw snapshot — this lets a device
//! relay everything it has converged from other devices, so a 3rd device converges transitively.
//! Callers MUST flush the resident brain stores to the DB before calling this (see the Phase  so the freshest learning is included.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::flow_neuro::scoring::UserBrain;
use crate::music_brain::model::MusicBrain;
use crate::sync::apply::{MUSIC_BRAIN_KEY, MUSIC_MERGED_KEY, NEURO_BRAIN_KEY, NEURO_MERGED_KEY};
use crate::sync::brainmap;
use crate::sync::canonical::{Collection, Hlc, Playlist, SettingEntry, WatchHistoryRecord};
use crate::sync::error::SyncError;
use crate::sync::mapping::{self, WatchRow};
use crate::sync::merge::{MergedFlowNeuroBrain, MergedMusicBrain};
use crate::sync::protocol::OutgoingCollection;

const WATCH_SELECT: &str = "SELECT video_id, title, channel_name, channel_id, watch_date, \
     watch_duration_seconds, total_duration_seconds, is_music, is_short, updated_hlc \
     FROM watch_history ORDER BY video_id";

/// Build the outgoing payloads for `collections`. Collections with no local table/data yield an
/// empty NDJSON body (the protocol ships an empty manifest, which the receiver treats as a no-op).
/// `Subscriptions` is skipped entirely — the desktop has no subscriptions table to export.
pub async fn export_collections(
    pool: &SqlitePool,
    device_id: &str,
    collections: &[Collection],
) -> Result<Vec<OutgoingCollection>, SyncError> {
    let mut out = Vec::with_capacity(collections.len());
    for &collection in collections {
        let ndjson = match collection {
            Collection::WatchHistory => export_watch_history(pool, device_id).await?,
            Collection::Likes => export_likes(pool, device_id).await?,
            Collection::Playlists => export_playlists(pool, device_id).await?,
            Collection::Settings => export_settings(pool, device_id).await?,
            Collection::FlowNeuroBrain => export_flow_neuro(pool, device_id).await?,
            Collection::MusicBrain => export_music(pool, device_id).await?,
            Collection::Subscriptions => export_subscriptions(pool, device_id).await?,
            Collection::SubscribedChannels => export_subscribed_channels(pool, device_id).await?,
        };
        out.push(OutgoingCollection { collection, ndjson });
    }
    Ok(out)
}

async fn export_watch_history(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let rows: Vec<WatchRow> = sqlx::query_as::<_, WatchRow>(WATCH_SELECT)
        .fetch_all(pool)
        .await?;
    let mut records: Vec<WatchHistoryRecord> =
        rows.iter().map(|r| r.to_canonical(device_id)).collect();
    records.sort_by(|a, b| a.video_id.cmp(&b.video_id));
    Ok(to_ndjson(&records))
}

async fn export_likes(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let mut likes = match get_setting(pool, mapping::LIKES_SETTING_KEY).await? {
        Some(raw) => mapping::parse_likes_blob(&raw, device_id),
        None => Vec::new(),
    };
    likes.sort_by(|a, b| mapping::like_key(a).cmp(&mapping::like_key(b)));
    Ok(to_ndjson(&likes))
}

async fn export_playlists(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let mut playlists = match get_setting(pool, mapping::PLAYLISTS_SETTING_KEY).await? {
        Some(raw) => mapping::parse_playlists_blob(&raw, device_id),
        None => Vec::new(),
    };
    if let Some(raw) = get_setting(pool, mapping::ALBUMS_SETTING_KEY).await? {
        playlists.extend(mapping::parse_albums_blob(&raw, device_id));
    }
    for p in &mut playlists {
        p.items.sort_by(|a, b| a.video_id.cmp(&b.video_id));
    }
    playlists.sort_by(|a, b| a.sync_id.cmp(&b.sync_id));
    Ok(to_ndjson(&playlists))
}

fn parse_all_playlists(ndjson: &[u8]) -> Option<Vec<Playlist>> {
    ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice::<Playlist>(l).ok())
        .collect()
}

fn album_needs_tracks(p: &Playlist) -> Option<String> {
    if mapping::is_album_playlist(p) && p.items.iter().all(|i| i.deleted) {
        p.youtube_id.clone().filter(|y| !y.is_empty())
    } else {
        None
    }
}

pub fn album_browse_ids_missing_tracks(ndjson: &[u8]) -> Vec<String> {
    let Some(playlists) = parse_all_playlists(ndjson) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for p in &playlists {
        if let Some(id) = album_needs_tracks(p) {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

pub fn fill_album_tracks(ndjson: &[u8], tracks: &BTreeMap<String, Vec<Value>>) -> Vec<u8> {
    let Some(mut playlists) = parse_all_playlists(ndjson) else {
        return ndjson.to_vec();
    };
    for p in &mut playlists {
        if album_needs_tracks(p).is_none() {
            continue;
        }
        let Some(songs) = p.youtube_id.as_ref().and_then(|y| tracks.get(y)) else {
            continue;
        };
        let hlc = p.updated_hlc.clone();
        let created = p.created_at_ms;
        let items: Vec<_> = songs
            .iter()
            .enumerate()
            .map(|(i, s)| mapping::song_to_item(s, i as i64, created, &hlc))
            .filter(|it| !it.video_id.is_empty())
            .collect();
        if items.is_empty() {
            continue;
        }
        if p.thumbnail_url.as_deref().unwrap_or("").is_empty() {
            p.thumbnail_url = items.iter().find_map(|it| it.thumbnail_url.clone());
        }
        p.items = items;
    }
    for p in &mut playlists {
        p.items.sort_by(|a, b| a.video_id.cmp(&b.video_id));
    }
    playlists.sort_by(|a, b| a.sync_id.cmp(&b.sync_id));
    to_ndjson(&playlists)
}

async fn export_subscriptions(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let hlc = Hlc::new(now_ms(), 0, device_id);
    let mut groups = match get_setting(pool, mapping::SUBSCRIPTION_GROUPS_SETTING_KEY).await? {
        Some(raw) => mapping::parse_subscription_groups_blob(&raw, &hlc),
        None => Vec::new(),
    };
    groups.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(to_ndjson(&groups))
}

/// Followed channels plus the unsubscribe tombstones we still remember (`FLOW-SYNC/1` §10.0).
/// Record stamps come from `subscribedAt` / the tombstone time, not from now, so subscribe and
/// unsubscribe resolve by when each actually happened.
async fn export_subscribed_channels(
    pool: &SqlitePool,
    device_id: &str,
) -> Result<Vec<u8>, SyncError> {
    let node = crate::sync::canonical::short_device_id(device_id);
    let tombstones = match get_setting(pool, mapping::SUBSCRIPTION_TOMBSTONES_SETTING_KEY).await? {
        Some(raw) => mapping::parse_subscription_tombstones(&raw),
        None => std::collections::BTreeMap::new(),
    };
    let channels = match get_setting(pool, mapping::SUBSCRIBED_CHANNELS_SETTING_KEY).await? {
        Some(raw) => mapping::parse_subscribed_channels_blob(&raw, &tombstones, &node),
        None => Vec::new(),
    };
    Ok(to_ndjson(&channels))
}

async fn export_settings(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let mut entries: Vec<SettingEntry> = Vec::new();
    for key in mapping::SYNCABLE_SETTINGS {
        if let Some((value, updated)) = get_setting_with_time(pool, key).await? {
            entries.push(SettingEntry {
                key: (*key).to_string(),
                value: serde_json::Value::String(value),
                hlc: Hlc::new(mapping::iso_to_ms(&updated), 0, device_id),
            });
        }
    }
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(to_ndjson(&entries))
}

async fn export_flow_neuro(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let merged = current_merged_flow(pool, device_id).await?;
    let mut snapshots = brainmap::merged_flow_to_snapshots(&merged);
    // Deterministic record order across platforms: by per-device snapshot id.
    snapshots.sort_by(|a, b| a.device_id.cmp(&b.device_id));
    Ok(to_ndjson(&snapshots))
}

async fn export_music(pool: &SqlitePool, device_id: &str) -> Result<Vec<u8>, SyncError> {
    let merged = current_merged_music(pool, device_id).await?;
    let snapshot =
        brainmap::merged_music_to_snapshot(&merged, device_id, Hlc::new(now_ms(), 0, device_id));
    Ok(to_ndjson(std::slice::from_ref(&snapshot)))
}

/// The merged FlowNeuro CRDT state with this device's current resident brain folded in (matches
/// the fold the apply path does, so export and apply agree on this device's contribution).
async fn current_merged_flow(
    pool: &SqlitePool,
    device_id: &str,
) -> Result<MergedFlowNeuroBrain, SyncError> {
    let mut merged: MergedFlowNeuroBrain = match get_setting(pool, NEURO_MERGED_KEY).await? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => MergedFlowNeuroBrain::default(),
    };
    if let Some(s) = get_setting(pool, NEURO_BRAIN_KEY).await? {
        if let Ok(ub) = serde_json::from_str::<UserBrain>(&s) {
            let snap =
                brainmap::userbrain_to_snapshot(&ub, device_id, Hlc::new(now_ms(), 0, device_id));
            merged.merge_snapshot(&snap);
        }
    }
    Ok(merged)
}

async fn current_merged_music(
    pool: &SqlitePool,
    device_id: &str,
) -> Result<MergedMusicBrain, SyncError> {
    let mut merged: MergedMusicBrain = match get_setting(pool, MUSIC_MERGED_KEY).await? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => MergedMusicBrain::default(),
    };
    if let Some(s) = get_setting(pool, MUSIC_BRAIN_KEY).await? {
        if let Ok(mb) = serde_json::from_str::<MusicBrain>(&s) {
            let snap =
                brainmap::musicbrain_to_snapshot(&mb, device_id, Hlc::new(now_ms(), 0, device_id));
            merged.merge_snapshot(&snap);
        }
    }
    Ok(merged)
}

/// Serialize records to **canonical** NDJSON: one compact JSON object per line (no trailing
/// newline), with **object keys sorted ascending by Unicode codepoint**. Routing
/// each record through `serde_json::Value` yields sorted keys *recursively* because this build has
/// serde_json's `preserve_order` feature off (`Value`'s object is a `BTreeMap`), so the desktop and
/// Android produce **byte-identical** lines for the same record. That makes the payload hash
/// cross-platform-stable, so the `sync_log` idempotency guard dedupes a re-sync from either side.
///
/// Callers MUST pre-sort `records` into the canonical record order for the collection so the
/// whole stream (not just each line) is canonical.
fn to_ndjson<T: Serialize>(records: &[T]) -> Vec<u8> {
    let lines: Vec<Vec<u8>> = records
        .iter()
        .map(crate::sync::canonical::to_canonical_json)
        .filter(|l| !l.is_empty())
        .collect();
    lines.join(&b'\n')
}

async fn get_setting(pool: &SqlitePool, key: &str) -> Result<Option<String>, SyncError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

async fn get_setting_with_time(
    pool: &SqlitePool,
    key: &str,
) -> Result<Option<(String, String)>, SyncError> {
    Ok(sqlx::query_as::<_, (String, String)>(
        "SELECT value, updated_at FROM settings WHERE key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?)
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}
