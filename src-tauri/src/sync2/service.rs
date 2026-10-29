//! Syncing with the group's store in the background: shortly after start, then on a timer, one
//! run at a time. Merged changes reach the open pages through the same refresh event as
//! FLOW-SYNC/1.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::actions::{default_link, local, open_session};
use super::batches::{IncomingBatch, apply_batches};
use super::engine::{Result, now_ms};
use super::snapshot::snapshot_due;
use super::state::load_group;
use crate::sync::canonical::Collection;
use crate::sync::export::export_collections;
use crate::sync::runtime::{
    enrich_outgoing_albums, flush_and_hold_brains, flush_brains, reload_brains,
};
use crate::sync::session::EVENT_REFRESH;

pub const EVENT_SYNCED: &str = "sync2://synced";
const FIRST_RUN_DELAY: Duration = Duration::from_secs(15);
const INTERVAL: Duration = Duration::from_mins(5);

/// When the last run ended, and the kind of error it ended with, if any.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastSync {
    pub at_ms: i64,
    pub error: Option<String>,
}

/// Keeps a timer run and a run the user asked for from overlapping.
#[derive(Default)]
pub struct BackgroundSync {
    running: Mutex<()>,
    last: std::sync::Mutex<Option<LastSync>>,
}

pub fn last_sync(app: &AppHandle) -> Option<LastSync> {
    app.state::<BackgroundSync>()
        .last
        .lock()
        .ok()
        .and_then(|last| last.clone())
}

/// Syncs once when this device is in a group, and returns the collections that changed here.
pub async fn sync_now(app: &AppHandle) -> Result<Vec<String>> {
    let state = app.state::<BackgroundSync>();
    let _running = state.running.lock().await;
    let pool = app.state::<SqlitePool>().inner().clone();
    if load_group(&pool).await?.is_none() {
        return Ok(Vec::new());
    }
    let result = run(app).await;
    let last = LastSync {
        at_ms: now_ms(),
        error: result.as_ref().err().map(|e| e.kind().to_owned()),
    };
    if let Ok(mut slot) = state.last.lock() {
        *slot = Some(last.clone());
    }
    let _ = app.emit(EVENT_SYNCED, last);
    result
}

async fn run(app: &AppHandle) -> Result<Vec<String>> {
    let local = local(app).await?;
    let Some(record) = load_group(&local.pool).await? else {
        return Ok(Vec::new());
    };
    let pool = &local.pool;
    let mut session = open_session(pool, &record, &local.device).await?;
    if !session.adopt_link(pool, &default_link(app)).await? {
        return Ok(Vec::new());
    }

    flush_brains(app).await;
    let mut exported = export_collections(pool, &local.meta.app, &Collection::ALL).await?;
    enrich_outgoing_albums(app, &mut exported).await;
    session.push(pool, exported).await?;

    let pulled = session.pull(pool).await?;
    let changed = if pulled.batches.is_empty() {
        Vec::new()
    } else {
        apply(app, pool, &local.meta.app, &pulled.batches).await?
    };
    if !changed.is_empty() {
        let _ = app.emit(EVENT_REFRESH, &changed);
    }
    session.finish(pool, pulled).await?;
    if snapshot_due(pool, &session.record().link).await? {
        let exported = export_collections(pool, &local.meta.app, &Collection::ALL).await?;
        session.write_snapshot(pool, exported).await?;
    }
    session.collect_garbage(pool).await?;
    Ok(changed)
}

async fn apply(
    app: &AppHandle,
    pool: &SqlitePool,
    app_id: &str,
    batches: &BTreeMap<String, Vec<IncomingBatch>>,
) -> Result<Vec<String>> {
    flush_and_hold_brains(app).await;
    let mut changed = BTreeSet::new();
    let mut result = Ok(());
    for (sender, batches) in batches {
        match apply_batches(pool, app_id, sender, batches, now_ms()).await {
            Ok(report) => changed.extend(report.stats.into_iter().map(|s| s.collection_key)),
            Err(error) => {
                result = Err(error);
                break;
            }
        }
    }
    // Also after a failed apply, which releases the held brain.
    reload_brains(app).await;
    result?;
    Ok(changed.into_iter().collect())
}

/// Syncs once without waiting, for example right after this device joined a group.
pub fn sync_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { log_failure(sync_now(&app).await) });
}

fn log_failure<T>(result: Result<T>) {
    if let Err(error) = result {
        tracing::warn!(target: "flow::sync2", kind = error.kind(), "sync failed");
    }
}

/// Runs [`sync_now`] shortly after start and then every few minutes for the app's lifetime.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_RUN_DELAY).await;
        let mut timer = tokio::time::interval(INTERVAL);
        loop {
            timer.tick().await;
            log_failure(sync_now(&app).await);
        }
    });
}
