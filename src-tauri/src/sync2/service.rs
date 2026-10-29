//! Syncing with the group's store in the background: shortly after start, then on a timer, one
//! run at a time. Merged changes reach the open pages through the same refresh event as
//! FLOW-SYNC/1.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::batches::{IncomingBatch, apply_batches};
use super::device::{device_keys, keychain};
use super::engine::{Result, Session, now_ms};
use super::server::ServerStore;
use super::state::load_group;
use crate::sync::canonical::Collection;
use crate::sync::export::export_collections;
use crate::sync::ledger;
use crate::sync::runtime::{
    enrich_outgoing_albums, flush_and_hold_brains, flush_brains, reload_brains,
};
use crate::sync::session::EVENT_REFRESH;

const FIRST_RUN_DELAY: Duration = Duration::from_secs(15);
const INTERVAL: Duration = Duration::from_mins(5);

/// Keeps a timer run and a run the user asked for from overlapping.
#[derive(Default)]
pub struct SyncLock(Mutex<()>);

/// Syncs once when this device is in a group, and returns the collections that changed here.
pub async fn sync_now(app: &AppHandle) -> Result<Vec<String>> {
    let lock = app.state::<SyncLock>();
    let _running = lock.0.lock().await;
    let pool = app.state::<SqlitePool>().inner().clone();
    let Some(record) = load_group(&pool).await? else {
        return Ok(Vec::new());
    };
    let device = device_keys(&keychain())?;
    let app_id = ledger::get_or_create_device_id(&pool).await?;
    let store = ServerStore::connect(
        &record.store_url,
        device.clone(),
        record.instance.clone(),
        Some(record.group_id.clone()),
    )
    .await?;
    let mut session = Session::open(&pool, store, &device).await?;

    flush_brains(app).await;
    let mut exported = export_collections(&pool, &app_id, &Collection::ALL).await?;
    enrich_outgoing_albums(app, &mut exported).await;
    session.push(&pool, exported).await?;

    let pulled = session.pull(&pool).await?;
    let changed = if pulled.batches.is_empty() {
        Vec::new()
    } else {
        apply(app, &pool, &app_id, &pulled.batches).await?
    };
    if !changed.is_empty() {
        let _ = app.emit(EVENT_REFRESH, &changed);
    }
    session.finish(&pool, pulled).await?;
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

/// Runs [`sync_now`] shortly after start and then every few minutes for the app's lifetime.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_RUN_DELAY).await;
        let mut timer = tokio::time::interval(INTERVAL);
        loop {
            timer.tick().await;
            if let Err(error) = sync_now(&app).await {
                tracing::warn!(target: "flow::sync2", %error, "background sync failed");
            }
        }
    });
}
