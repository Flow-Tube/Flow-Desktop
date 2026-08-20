//! The atomic apply pipeline for Flow Local Sync.
//!
//! Given the staged canonical payload from a received session ([`protocol::ReceivedPayload`]), this:
//!  1. takes a **pre-merge backup snapshot** of the affected collections (the safety net for a
//!     logic bug — `apply` itself is atomic, but the backup lets a human recover even from a bad
//!     merge result);
//!  2. opens **one transaction**;
//!  3. for each collection: skips it if this exact payload was already applied (the `sync_log`
//!     idempotency guard), else loads the local canonical state, merges (CRDT), and writes the
//!     result back — collecting per-collection stats;
//!  4. records the apply in `sync_log` and **commits**. Any error drops the transaction →
//!     full rollback, leaving the database untouched and the backup intact.
//!

use std::collections::BTreeMap;

use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::flow_neuro::scoring::UserBrain;
use crate::music_brain::model::MusicBrain;
use crate::sync::brainmap;
use crate::sync::canonical::{
    Collection, FlowNeuroBrainSnapshot, Hlc, Like, MusicBrainSnapshot, Playlist, SettingEntry,
    SubscribedChannel, SubscriptionGroup, WatchHistoryRecord,
};
use crate::sync::error::SyncError;
use crate::sync::mapping::{self, WatchInsert, WatchRow};
use crate::sync::merge::{self, MergedFlowNeuroBrain, MergedMusicBrain};
use crate::sync::protocol::StagedCollection;

pub(crate) const NEURO_BRAIN_KEY: &str = "user_neuro_brain";
pub(crate) const NEURO_MERGED_KEY: &str = "sync_neuro_merged";
pub(crate) const MUSIC_BRAIN_KEY: &str = "user_music_brain";
pub(crate) const MUSIC_MERGED_KEY: &str = "sync_music_merged";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApplyStats {
    pub collection_key: String,
    pub added: u64,
    pub updated: u64,
    pub skipped: u64,
    pub tombstoned: u64,
}

#[derive(Debug, Clone)]
pub struct ApplyReport {
    pub stats: Vec<ApplyStats>,
    /// A JSON snapshot of the affected collections taken before the merge (for recovery).
    pub backup: String,
}

const WATCH_SELECT: &str = "SELECT video_id, title, channel_name, channel_id, watch_date, \
     watch_duration_seconds, total_duration_seconds, is_music, is_short, updated_hlc \
     FROM watch_history";

/// Apply a received payload atomically. See the module docs for the guarantees.
pub async fn apply_payload(
    pool: &SqlitePool,
    our_device_id: &str,
    peer_device_id: &str,
    staged: &[StagedCollection],
) -> Result<ApplyReport, SyncError> {
    let backup = backup_snapshot(pool, staged).await?;

    let mut tx = pool.begin().await?;
    let mut stats = Vec::with_capacity(staged.len());

    for sc in staged {
        let key = sc.collection.key();

        // Idempotency guard: identical (peer, collection, payload) is applied at most once.
        let already: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM sync_log WHERE peer_device_id = ? AND collection = ? AND payload_hash = ? LIMIT 1",
        )
        .bind(peer_device_id)
        .bind(key)
        .bind(&sc.hash)
        .fetch_optional(&mut *tx)
        .await?;
        if already.is_some() {
            stats.push(ApplyStats {
                collection_key: key.to_string(),
                skipped: sc.record_count,
                ..Default::default()
            });
            continue;
        }

        let (stat, applied) = match sc.collection {
            Collection::WatchHistory => (
                apply_watch_history(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),
            Collection::Likes => (apply_likes(&mut tx, our_device_id, &sc.ndjson).await?, true),
            Collection::Playlists => (
                apply_playlists(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),
            Collection::Settings => (
                apply_settings(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),
            Collection::FlowNeuroBrain => (
                apply_flow_neuro(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),
            Collection::MusicBrain => {
                (apply_music(&mut tx, our_device_id, &sc.ndjson).await?, true)
            }
            Collection::Subscriptions => (
                apply_subscriptions(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),
            Collection::SubscribedChannels => (
                apply_subscribed_channels(&mut tx, our_device_id, &sc.ndjson).await?,
                true,
            ),

            #[allow(unreachable_patterns)]
            _ => (
                ApplyStats {
                    collection_key: key.to_string(),
                    skipped: sc.record_count,
                    ..Default::default()
                },
                false,
            ),
        };

        if applied {
            sqlx::query(
                "INSERT OR IGNORE INTO sync_log (peer_device_id, collection, payload_hash, applied_at, hwm_hlc)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(peer_device_id)
            .bind(key)
            .bind(&sc.hash)
            .bind(now_iso())
            .bind(Option::<String>::None)
            .execute(&mut *tx)
            .await?;
        }

        stats.push(stat);
    }

    tx.commit().await?;
    Ok(ApplyReport { stats, backup })
}

async fn apply_watch_history(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let incoming = parse_ndjson::<WatchHistoryRecord>(ndjson)?;

    let rows: Vec<WatchRow> = sqlx::query_as::<_, WatchRow>(WATCH_SELECT)
        .fetch_all(&mut **tx)
        .await?;
    let local: Vec<WatchHistoryRecord> = rows.iter().map(|r| r.to_canonical(device_id)).collect();
    let local_map: BTreeMap<String, WatchHistoryRecord> = local
        .iter()
        .map(|r| (r.video_id.clone(), r.clone()))
        .collect();

    let merged = merge::merge_watch_history(local.clone(), incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::WatchHistory.key().to_string(),
        ..Default::default()
    };

    for rec in &merged {
        match local_map.get(&rec.video_id) {
            Some(existing) if existing == rec => stat.skipped += 1,
            Some(_) => {
                if rec.deleted {
                    delete_watch(tx, &rec.video_id).await?;
                    stat.tombstoned += 1;
                } else {
                    delete_watch(tx, &rec.video_id).await?;
                    insert_watch(tx, rec).await?;
                    stat.updated += 1;
                }
            }
            None => {
                if rec.deleted {
                    stat.skipped += 1; // tombstone for a row we never had — nothing to do
                } else {
                    insert_watch(tx, rec).await?;
                    stat.added += 1;
                }
            }
        }
    }

    Ok(stat)
}

async fn apply_likes(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let local = match get_setting(tx, mapping::LIKES_SETTING_KEY).await? {
        Some(raw) => mapping::parse_likes_blob(&raw, device_id),
        None => Vec::new(),
    };
    let incoming = parse_ndjson::<Like>(ndjson)?;
    let local_map: BTreeMap<String, Like> = local
        .iter()
        .map(|l| (mapping::like_key(l), l.clone()))
        .collect();

    let merged = merge::merge_likes(local, incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::Likes.key().to_string(),
        ..Default::default()
    };
    for rec in &merged {
        let liked = matches!(rec.state, crate::sync::canonical::LikeState::Liked);
        match local_map.get(&mapping::like_key(rec)) {
            Some(existing) if existing == rec => stat.skipped += 1,
            Some(_) if liked => stat.updated += 1,
            Some(_) => stat.tombstoned += 1,
            None if liked => stat.added += 1,
            None => stat.skipped += 1,
        }
    }

    set_setting(
        tx,
        mapping::LIKES_SETTING_KEY,
        &mapping::likes_to_blob(&merged),
    )
    .await?;
    Ok(stat)
}

async fn apply_playlists(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let mut local = match get_setting(tx, mapping::PLAYLISTS_SETTING_KEY).await? {
        Some(raw) => mapping::parse_playlists_blob(&raw, device_id),
        None => Vec::new(),
    };
    if let Some(raw) = get_setting(tx, mapping::ALBUMS_SETTING_KEY).await? {
        local.extend(mapping::parse_albums_blob(&raw, device_id));
    }
    let incoming = parse_ndjson::<Playlist>(ndjson)?;
    let local_map: BTreeMap<String, Playlist> = local
        .iter()
        .map(|p| (merge::playlist_merge_key(p), p.clone()))
        .collect();

    let merged = merge::merge_playlists(local, incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::Playlists.key().to_string(),
        ..Default::default()
    };
    for rec in &merged {
        match local_map.get(&merge::playlist_merge_key(rec)) {
            Some(existing) if existing == rec => stat.skipped += 1,
            Some(_) if rec.deleted => stat.tombstoned += 1,
            Some(_) => stat.updated += 1,
            None if rec.deleted => stat.skipped += 1,
            None => stat.added += 1,
        }
    }

    let (albums, playlists): (Vec<Playlist>, Vec<Playlist>) =
        merged.into_iter().partition(mapping::is_album_playlist);

    set_setting(
        tx,
        mapping::PLAYLISTS_SETTING_KEY,
        &mapping::playlists_to_blob(&playlists),
    )
    .await?;
    set_setting(
        tx,
        mapping::ALBUMS_SETTING_KEY,
        &mapping::albums_to_blob(&albums),
    )
    .await?;
    Ok(stat)
}

async fn apply_settings(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    // Only whitelisted keys are accepted, even if a peer sends others.
    let incoming: Vec<SettingEntry> = parse_ndjson::<SettingEntry>(ndjson)?
        .into_iter()
        .filter(|s| mapping::is_syncable_setting(&s.key))
        .collect();

    let mut local: Vec<SettingEntry> = Vec::new();
    for key in mapping::SYNCABLE_SETTINGS {
        if let Some((value, updated)) = get_setting_with_time(tx, key).await? {
            local.push(SettingEntry {
                key: (*key).to_string(),
                value: serde_json::Value::String(value),
                hlc: Hlc::new(mapping::iso_to_ms(&updated), 0, device_id),
            });
        }
    }
    let local_map: BTreeMap<String, SettingEntry> =
        local.iter().map(|s| (s.key.clone(), s.clone())).collect();

    let merged = merge::merge_settings(local, incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::Settings.key().to_string(),
        ..Default::default()
    };
    for rec in &merged {
        match local_map.get(&rec.key) {
            Some(existing) if existing == rec => stat.skipped += 1,
            Some(_) => {
                write_setting_value(tx, rec).await?;
                stat.updated += 1;
            }
            None => {
                write_setting_value(tx, rec).await?;
                stat.added += 1;
            }
        }
    }
    Ok(stat)
}

async fn apply_flow_neuro(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let incoming = parse_ndjson::<FlowNeuroBrainSnapshot>(ndjson)?;

    let mut merged: MergedFlowNeuroBrain = match get_setting(tx, NEURO_MERGED_KEY).await? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => MergedFlowNeuroBrain::default(),
    };

    // Fold in this device's current brain so local learning isn't lost (idempotent re-fold).
    if let Some(s) = get_setting(tx, NEURO_BRAIN_KEY).await? {
        if let Ok(ub) = serde_json::from_str::<UserBrain>(&s) {
            let snap =
                brainmap::userbrain_to_snapshot(&ub, device_id, Hlc::new(now_ms(), 0, device_id));
            merged.merge_snapshot(&snap);
        }
    }
    for snap in &incoming {
        merged.merge_snapshot(snap);
    }
    set_setting(tx, NEURO_MERGED_KEY, &serde_json::to_string(&merged)?).await?;

    // Derive the effective brain for the engine, preserving device-local fields.
    let base = get_setting(tx, NEURO_BRAIN_KEY)
        .await?
        .and_then(|s| serde_json::from_str::<UserBrain>(&s).ok())
        .unwrap_or_default();
    let effective = brainmap::merged_flow_to_userbrain(&merged, &base);
    set_setting(tx, NEURO_BRAIN_KEY, &serde_json::to_string(&effective)?).await?;

    Ok(ApplyStats {
        collection_key: Collection::FlowNeuroBrain.key().to_string(),
        updated: incoming.len() as u64,
        ..Default::default()
    })
}

async fn apply_music(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let incoming = parse_ndjson::<MusicBrainSnapshot>(ndjson)?;

    let mut merged: MergedMusicBrain = match get_setting(tx, MUSIC_MERGED_KEY).await? {
        Some(s) => serde_json::from_str(&s).unwrap_or_default(),
        None => MergedMusicBrain::default(),
    };
    if let Some(s) = get_setting(tx, MUSIC_BRAIN_KEY).await? {
        if let Ok(mb) = serde_json::from_str::<MusicBrain>(&s) {
            let snap =
                brainmap::musicbrain_to_snapshot(&mb, device_id, Hlc::new(now_ms(), 0, device_id));
            merged.merge_snapshot(&snap);
        }
    }
    for snap in &incoming {
        merged.merge_snapshot(snap);
    }
    set_setting(tx, MUSIC_MERGED_KEY, &serde_json::to_string(&merged)?).await?;

    let base = get_setting(tx, MUSIC_BRAIN_KEY)
        .await?
        .and_then(|s| serde_json::from_str::<MusicBrain>(&s).ok())
        .unwrap_or_default();
    let effective = brainmap::merged_music_to_musicbrain(&merged, &base);
    set_setting(tx, MUSIC_BRAIN_KEY, &serde_json::to_string(&effective)?).await?;

    Ok(ApplyStats {
        collection_key: Collection::MusicBrain.key().to_string(),
        updated: incoming.len() as u64,
        ..Default::default()
    })
}

async fn apply_subscriptions(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let incoming = parse_ndjson::<SubscriptionGroup>(ndjson)?;
    let stamp = Hlc::new(now_ms(), 0, device_id);
    let local = match get_setting(tx, mapping::SUBSCRIPTION_GROUPS_SETTING_KEY).await? {
        Some(raw) => mapping::parse_subscription_groups_blob(&raw, &stamp),
        None => Vec::new(),
    };
    let local_map: BTreeMap<String, SubscriptionGroup> =
        local.iter().map(|g| (g.name.clone(), g.clone())).collect();

    let merged = merge::merge_subscriptions(local, incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::Subscriptions.key().to_string(),
        ..Default::default()
    };
    for rec in &merged {
        match local_map.get(&rec.name) {
            Some(existing)
                if existing.channel_ids == rec.channel_ids && existing.deleted == rec.deleted =>
            {
                stat.skipped += 1
            }
            Some(_) if rec.deleted => stat.tombstoned += 1,
            Some(_) => stat.updated += 1,
            None if rec.deleted => stat.skipped += 1,
            None => stat.added += 1,
        }
    }

    set_setting(
        tx,
        mapping::SUBSCRIPTION_GROUPS_SETTING_KEY,
        &mapping::subscription_groups_to_blob(&merged),
    )
    .await?;
    Ok(stat)
}

async fn apply_subscribed_channels(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    ndjson: &[u8],
) -> Result<ApplyStats, SyncError> {
    let incoming = parse_ndjson::<SubscribedChannel>(ndjson)?;
    let now = now_ms();
    let node = crate::sync::canonical::short_device_id(device_id);

    let existing_raw = get_setting(tx, mapping::SUBSCRIBED_CHANNELS_SETTING_KEY).await?;
    let tombstones = match get_setting(tx, mapping::SUBSCRIPTION_TOMBSTONES_SETTING_KEY).await? {
        Some(raw) => mapping::parse_subscription_tombstones(&raw),
        None => BTreeMap::new(),
    };
    let local = mapping::parse_subscribed_channels_blob(
        existing_raw.as_deref().unwrap_or("[]"),
        &tombstones,
        &node,
    );
    let local_map: BTreeMap<String, SubscribedChannel> = local
        .iter()
        .map(|c| (c.channel_id.clone(), c.clone()))
        .collect();

    let merged = merge::merge_subscribed_channels(local, incoming);

    let mut stat = ApplyStats {
        collection_key: Collection::SubscribedChannels.key().to_string(),
        ..Default::default()
    };
    for channel in &merged {
        match local_map.get(&channel.channel_id) {
            Some(before) if before == channel => stat.skipped += 1,
            Some(before) if channel.deleted && !before.deleted => stat.tombstoned += 1,
            Some(_) => stat.updated += 1,
            None if channel.deleted => stat.skipped += 1,
            None => stat.added += 1,
        }
    }

    let (live_blob, tombstone_blob) =
        mapping::subscribed_channels_to_blob(&merged, existing_raw.as_deref(), now);
    set_setting(tx, mapping::SUBSCRIBED_CHANNELS_SETTING_KEY, &live_blob).await?;
    set_setting(
        tx,
        mapping::SUBSCRIPTION_TOMBSTONES_SETTING_KEY,
        &tombstone_blob,
    )
    .await?;
    Ok(stat)
}

async fn get_setting_with_time(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
) -> Result<Option<(String, String)>, SyncError> {
    Ok(sqlx::query_as::<_, (String, String)>(
        "SELECT value, updated_at FROM settings WHERE key = ?",
    )
    .bind(key)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn write_setting_value(
    tx: &mut Transaction<'_, Sqlite>,
    entry: &SettingEntry,
) -> Result<(), SyncError> {
    let value = match &entry.value {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let updated = mapping::ms_to_iso(entry.hlc.physical_ms);
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(&entry.key)
    .bind(value)
    .bind(updated)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn get_setting(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
) -> Result<Option<String>, SyncError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&mut **tx)
            .await?,
    )
}

async fn set_setting(
    tx: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: &str,
) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(now_iso())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_watch(
    tx: &mut Transaction<'_, Sqlite>,
    rec: &WatchHistoryRecord,
) -> Result<(), SyncError> {
    let v = WatchInsert::from_canonical(rec);
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(v.video_id)
    .bind(v.title)
    .bind(v.channel_name)
    .bind(v.channel_id)
    .bind(v.watch_date)
    .bind(v.watch_duration_seconds)
    .bind(v.total_duration_seconds)
    .bind(v.is_music)
    .bind(v.is_short)
    .bind(v.updated_hlc)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_watch(tx: &mut Transaction<'_, Sqlite>, video_id: &str) -> Result<(), SyncError> {
    sqlx::query("DELETE FROM watch_history WHERE video_id = ?")
        .bind(video_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Snapshot the affected collections to a JSON string before merging (recovery aid).
async fn backup_snapshot(
    pool: &SqlitePool,
    staged: &[StagedCollection],
) -> Result<String, SyncError> {
    let mut obj = serde_json::Map::new();
    for sc in staged {
        match sc.collection {
            Collection::WatchHistory => {
                let rows: Vec<WatchRow> = sqlx::query_as::<_, WatchRow>(WATCH_SELECT)
                    .fetch_all(pool)
                    .await?;
                let canon: Vec<WatchHistoryRecord> =
                    rows.iter().map(|r| r.to_canonical("")).collect();
                obj.insert("watch_history".to_string(), serde_json::to_value(canon)?);
            }
            Collection::Likes => {
                let raw = setting_value(pool, mapping::LIKES_SETTING_KEY).await?;
                obj.insert("liked_items".to_string(), serde_json::json!(raw));
            }
            Collection::Playlists => {
                let raw = setting_value(pool, mapping::PLAYLISTS_SETTING_KEY).await?;
                obj.insert("user_playlists".to_string(), serde_json::json!(raw));
                let albums = setting_value(pool, mapping::ALBUMS_SETTING_KEY).await?;
                obj.insert("saved_albums".to_string(), serde_json::json!(albums));
            }
            Collection::Settings => {
                let mut map = serde_json::Map::new();
                for key in mapping::SYNCABLE_SETTINGS {
                    if let Some(v) = setting_value(pool, key).await? {
                        map.insert((*key).to_string(), serde_json::json!(v));
                    }
                }
                obj.insert("settings".to_string(), serde_json::Value::Object(map));
            }
            Collection::FlowNeuroBrain => {
                let raw = setting_value(pool, NEURO_BRAIN_KEY).await?;
                obj.insert("user_neuro_brain".to_string(), serde_json::json!(raw));
            }
            Collection::MusicBrain => {
                let raw = setting_value(pool, MUSIC_BRAIN_KEY).await?;
                obj.insert("user_music_brain".to_string(), serde_json::json!(raw));
            }
            Collection::Subscriptions => {
                let raw = setting_value(pool, mapping::SUBSCRIPTION_GROUPS_SETTING_KEY).await?;
                obj.insert("subscription_groups".to_string(), serde_json::json!(raw));
            }
            Collection::SubscribedChannels => {
                let raw = setting_value(pool, mapping::SUBSCRIBED_CHANNELS_SETTING_KEY).await?;
                obj.insert("subscriptions".to_string(), serde_json::json!(raw));
                let tombs =
                    setting_value(pool, mapping::SUBSCRIPTION_TOMBSTONES_SETTING_KEY).await?;
                obj.insert(
                    "subscription_tombstones".to_string(),
                    serde_json::json!(tombs),
                );
            }
            #[allow(unreachable_patterns)]
            _ => {}
        }
    }
    Ok(serde_json::Value::Object(obj).to_string())
}

async fn setting_value(pool: &SqlitePool, key: &str) -> Result<Option<String>, SyncError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

fn parse_ndjson<T: serde::de::DeserializeOwned>(ndjson: &[u8]) -> Result<Vec<T>, SyncError> {
    ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|line| serde_json::from_slice::<T>(line).map_err(SyncError::from))
        .collect()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}
