//! Backup/restore commands: full-fidelity export/import that reuses the Flow Local Sync
//! collection serialization ([`crate::sync::export`]) and the atomic CRDT apply pipeline
//! ([`crate::sync::apply`]). A backup file therefore round-trips through the exact wire
//! representation the sync test suite already covers, instead of a second ad hoc format.
//!
//! The desktop's flat `subscriptions` settings blob (the channel list the frontend store
//! uses) is not covered by any sync collection — `Collection::Subscriptions` carries only
//! the channel *groups* — so backups carry it as the extra `subscription_channels` entry
//! and imports union-merge it by channel id.

use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, ErrorResponse};
use crate::music_brain::store::MusicBrainStore;
use crate::services::recommendation_service::RecommendationService;
use crate::sync::apply;
use crate::sync::canonical::{
    Collection, FlowNeuroBrainSnapshot, Like, MusicBrainSnapshot, Playlist, SettingEntry,
    SubscriptionGroup, WatchHistoryRecord,
};
use crate::sync::codec;
use crate::sync::error::SyncError;
use crate::sync::export;
use crate::sync::ledger;
use crate::sync::protocol::StagedCollection;

/// Extra backup entry (not a sync collection): the frontend's flat subscribed-channel list.
pub const SUBSCRIPTION_CHANNELS_KEY: &str = "subscription_channels";
const SUBSCRIPTIONS_SETTING_KEY: &str = "subscriptions";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExport {
    pub device_id: String,
    pub scope: String,
    /// One entry per exported collection, keyed by the sync wire key (`watch_history`, …),
    /// each an array of canonical records; plus `subscription_channels`.
    pub collections: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionImportSummary {
    pub collection: String,
    pub added: u64,
    pub updated: u64,
    pub skipped: u64,
    pub tombstoned: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub collections: Vec<CollectionImportSummary>,
}

fn sync_err(e: SyncError) -> ErrorResponse {
    ErrorResponse {
        message: e.to_string(),
        kind: "sync".to_string(),
    }
}

/// Map a backup scope to the sync collections it covers. `None` for an unknown scope.
fn scope_collections(scope: &str) -> Option<Vec<Collection>> {
    match scope {
        "BRAIN" => Some(vec![Collection::FlowNeuroBrain, Collection::MusicBrain]),
        "APP_DATA" => Some(vec![
            Collection::Playlists,
            Collection::Likes,
            Collection::Settings,
            Collection::Subscriptions,
        ]),
        "MASTER" => Some(Collection::ALL.to_vec()),
        _ => None,
    }
}

fn scope_includes_channel_list(scope: &str) -> bool {
    matches!(scope, "APP_DATA" | "MASTER")
}

fn ndjson_to_values(ndjson: &[u8]) -> Result<Vec<Value>, SyncError> {
    ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|line| serde_json::from_slice::<Value>(line).map_err(SyncError::from))
        .collect()
}

/// Serialize records back to the canonical NDJSON the apply pipeline expects. Re-serializing
/// through `Value` reproduces the exporter's byte-exact lines (sorted keys, compact).
fn values_to_ndjson(values: &[Value]) -> Vec<u8> {
    let lines: Vec<Vec<u8>> = values
        .iter()
        .filter_map(|v| serde_json::to_vec(v).ok())
        .collect();
    lines.join(&b'\n')
}

/// Keep only records that parse as the collection's canonical type **and** carry a non-empty
/// record identity (the canonical structs are `#[serde(default)]`, so any object "parses"),
/// so one malformed record in a hand-edited file skips that record instead of failing (or
/// polluting) the whole atomic apply.
fn filter_parseable(collection: Collection, values: &[Value]) -> (Vec<Value>, u64) {
    fn ok<T: serde::de::DeserializeOwned>(v: &Value, identity: impl Fn(&T) -> bool) -> bool {
        serde_json::from_value::<T>(v.clone()).is_ok_and(|r| identity(&r))
    }
    let parses = |v: &Value| match collection {
        Collection::WatchHistory => ok::<WatchHistoryRecord>(v, |r| !r.video_id.is_empty()),
        Collection::Likes => ok::<Like>(v, |l| !l.id.is_empty()),
        Collection::Playlists => ok::<Playlist>(v, |p| !p.sync_id.is_empty()),
        Collection::Settings => ok::<SettingEntry>(v, |s| !s.key.is_empty()),
        Collection::FlowNeuroBrain => ok::<FlowNeuroBrainSnapshot>(v, |s| !s.device_id.is_empty()),
        Collection::MusicBrain => ok::<MusicBrainSnapshot>(v, |s| !s.device_id.is_empty()),
        Collection::Subscriptions => ok::<SubscriptionGroup>(v, |g| !g.name.is_empty()),
    };
    let kept: Vec<Value> = values.iter().filter(|v| parses(v)).cloned().collect();
    let dropped = (values.len() - kept.len()) as u64;
    (kept, dropped)
}

async fn get_setting_value(pool: &SqlitePool, key: &str) -> Result<Option<String>, SyncError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

async fn set_setting_value(pool: &SqlitePool, key: &str, value: &str) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await?;
    Ok(())
}

/// Build the backup payload for `scope`. Callers must flush the resident brains first (the
/// commands below do) so the freshest learning is exported.
pub async fn export_backup(pool: &SqlitePool, scope: &str) -> Result<BackupExport, SyncError> {
    let collections = scope_collections(scope)
        .ok_or_else(|| SyncError::Protocol(format!("unknown backup scope: {scope}")))?;
    let device_id = ledger::get_or_create_device_id(pool).await?;
    let outgoing = export::export_collections(pool, &device_id, &collections).await?;

    let mut map = serde_json::Map::new();
    for oc in outgoing {
        map.insert(
            oc.collection.key().to_string(),
            Value::Array(ndjson_to_values(&oc.ndjson)?),
        );
    }

    if scope_includes_channel_list(scope) {
        if let Some(raw) = get_setting_value(pool, SUBSCRIPTIONS_SETTING_KEY).await? {
            if let Ok(parsed @ Value::Array(_)) = serde_json::from_str::<Value>(&raw) {
                map.insert(SUBSCRIPTION_CHANNELS_KEY.to_string(), parsed);
            }
        }
    }

    Ok(BackupExport {
        device_id,
        scope: scope.to_string(),
        collections: map,
    })
}

/// Union-merge the flat subscribed-channel list by channel `id` (local entries win).
async fn import_channel_list(
    pool: &SqlitePool,
    incoming: &[Value],
) -> Result<CollectionImportSummary, SyncError> {
    let mut summary = CollectionImportSummary {
        collection: SUBSCRIPTION_CHANNELS_KEY.to_string(),
        ..Default::default()
    };

    let mut local: Vec<Value> = match get_setting_value(pool, SUBSCRIPTIONS_SETTING_KEY).await? {
        Some(raw) => serde_json::from_str::<Vec<Value>>(&raw).unwrap_or_default(),
        None => Vec::new(),
    };
    let channel_id = |v: &Value| -> Option<String> {
        v.get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let existing: std::collections::BTreeSet<String> =
        local.iter().filter_map(|v| channel_id(v)).collect();

    for record in incoming {
        match channel_id(record) {
            Some(id) if !existing.contains(&id) => {
                local.push(record.clone());
                summary.added += 1;
            }
            _ => summary.skipped += 1,
        }
    }

    if summary.added > 0 {
        set_setting_value(
            pool,
            SUBSCRIPTIONS_SETTING_KEY,
            &serde_json::to_string(&local)?,
        )
        .await?;
    }
    Ok(summary)
}

/// Restore a backup payload: stage every recognized collection and run it through the sync
/// apply pipeline (atomic CRDT merge), then union-merge the flat channel list. Unknown keys
/// are ignored and malformed records are skipped, so partial or hand-edited files degrade
/// gracefully instead of failing the restore.
pub async fn import_backup(pool: &SqlitePool, payload: &Value) -> Result<ImportSummary, SyncError> {
    let collections = payload
        .get("collections")
        .and_then(Value::as_object)
        .or_else(|| payload.as_object())
        .ok_or_else(|| SyncError::Protocol("backup payload is not a JSON object".into()))?;

    let mut staged = Vec::new();
    let mut dropped_by_key: Vec<(String, u64)> = Vec::new();
    for collection in Collection::ALL {
        let Some(Value::Array(records)) = collections.get(collection.key()) else {
            continue;
        };
        let (kept, dropped) = filter_parseable(collection, records);
        if dropped > 0 {
            dropped_by_key.push((collection.key().to_string(), dropped));
        }
        if kept.is_empty() {
            continue;
        }
        let ndjson = values_to_ndjson(&kept);
        let hash = codec::sha256_hex(&ndjson);
        staged.push(StagedCollection {
            collection,
            record_count: kept.len() as u64,
            ndjson,
            hash,
        });
    }

    let device_id = ledger::get_or_create_device_id(pool).await?;
    let mut summary = ImportSummary::default();

    if !staged.is_empty() {
        // A unique per-import peer id keeps the sync_log idempotency guard from silently
        // skipping a deliberate re-restore (e.g. restore, clear data, restore again).
        let peer_id = format!(
            "backup-restore-{}",
            chrono::Utc::now().timestamp_millis().max(0)
        );
        let report = apply::apply_payload(pool, &device_id, &peer_id, &staged).await?;
        for stat in report.stats {
            summary.collections.push(CollectionImportSummary {
                collection: stat.collection_key,
                added: stat.added,
                updated: stat.updated,
                skipped: stat.skipped,
                tombstoned: stat.tombstoned,
            });
        }
    }

    for (key, dropped) in dropped_by_key {
        match summary.collections.iter_mut().find(|s| s.collection == key) {
            Some(entry) => entry.skipped += dropped,
            None => summary.collections.push(CollectionImportSummary {
                collection: key,
                skipped: dropped,
                ..Default::default()
            }),
        }
    }

    if let Some(Value::Array(channels)) = collections.get(SUBSCRIPTION_CHANNELS_KEY) {
        summary
            .collections
            .push(import_channel_list(pool, channels).await?);
    }

    Ok(summary)
}

// Mirror the sync session's flush/reload choreography: flush the resident brains so the
// export/merge sees the freshest learning, and reload them after a merge wrote the DB so
// the next debounced flush can't clobber the merged result.
async fn flush_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>() {
        if let Err(e) = svc.flush_brain().await {
            tracing::warn!(%e, "[backup] flush flow_neuro brain failed");
        }
    }
    if let Some(store) = app.try_state::<std::sync::Arc<MusicBrainStore>>() {
        if let Err(e) = store.flush().await {
            tracing::warn!(%e, "[backup] flush music brain failed");
        }
    }
}

async fn reload_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>() {
        if let Err(e) = svc.reload_brain().await {
            tracing::warn!(%e, "[backup] reload flow_neuro brain failed");
        }
    }
    if let Some(store) = app.try_state::<std::sync::Arc<MusicBrainStore>>() {
        if let Err(e) = store.reload().await {
            tracing::warn!(%e, "[backup] reload music brain failed");
        }
    }
}

#[tauri::command]
pub async fn export_backup_data(
    scope: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<BackupExport, ErrorResponse> {
    if scope_collections(&scope).is_none() {
        return Err(AppError::Validation(format!("unknown backup scope: {scope}")).into());
    }
    flush_brains(&app).await;
    export_backup(&pool, &scope).await.map_err(sync_err)
}

#[tauri::command]
pub async fn import_backup_data(
    payload: Value,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<ImportSummary, ErrorResponse> {
    flush_brains(&app).await;
    let summary = import_backup(&pool, &payload).await.map_err(sync_err)?;
    reload_brains(&app).await;
    Ok(summary)
}

// The pool-backed round-trip tests live in `tests/backup_roundtrip.rs` (the same integration
// harness as `tests/sync_*.rs`); only the pure scope mapping is unit-tested here.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_mapping_matches_the_selector() {
        assert_eq!(
            scope_collections("BRAIN").unwrap(),
            vec![Collection::FlowNeuroBrain, Collection::MusicBrain]
        );
        let app_data = scope_collections("APP_DATA").unwrap();
        assert!(app_data.contains(&Collection::Settings));
        assert!(app_data.contains(&Collection::Likes));
        assert!(app_data.contains(&Collection::Subscriptions));
        assert!(app_data.contains(&Collection::Playlists));
        assert!(!app_data.contains(&Collection::WatchHistory));
        assert_eq!(
            scope_collections("MASTER").unwrap().len(),
            Collection::ALL.len()
        );
        assert!(scope_collections("bogus").is_none());
        assert!(scope_includes_channel_list("MASTER"));
        assert!(scope_includes_channel_list("APP_DATA"));
        assert!(!scope_includes_channel_list("BRAIN"));
    }
}
