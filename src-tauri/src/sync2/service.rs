//! Syncing with the group's store in the background: shortly after start, then on a timer, one
//! run at a time. Merged changes reach the open pages through the same refresh event as
//! FLOW-SYNC/1.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::actions::{
    Local, local, login_refused, open_session, set_login_refused, state_pool, stop_if_shut_out,
    stopped,
};
use super::batches::{IncomingBatch, apply_batches};
use super::engine::{EngineError, Result, Session, now_ms};
use super::group_store::GroupStore;
use super::kept::{applied as applied_kept, has_kept, keep, kept};
use super::live_hub::forget_keys;
use super::names::device_names;
use super::profile_actions::name_linked;
use super::profile_links::reading;
use super::server::StoreError;
use super::snapshot::{PROFILES_KEY, note_merged, snapshot_due};
use super::state::{link_read, links_to_read, load_group, save_floors};
use crate::sync::canonical::Collection;
use crate::sync::export::export_collections;
use crate::sync::runtime::{
    enrich_outgoing_albums, flush_and_hold_brains, flush_brains, reload_brains,
};
use crate::sync::session::EVENT_REFRESH;

pub const EVENT_SYNCED: &str = "sync2://synced";
/// A run started; [`EVENT_SYNCED`] says when it ended.
pub const EVENT_SYNCING: &str = "sync2://syncing";
/// Devices asking to join, seen during a sync, so the app can tell the user on any page.
pub const EVENT_JOIN_REQUESTS: &str = "sync2://join-requests";
const FIRST_RUN_DELAY: Duration = Duration::from_secs(15);
const INTERVAL: Duration = Duration::from_mins(5);
const LOCAL_EDIT_DELAY: Duration = Duration::from_secs(10);

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
    /// Counts [`sync_after`] calls, so only the latest one runs.
    scheduled: AtomicU64,
}

/// Records applied from one device in one run.
#[derive(Debug, Clone, Serialize)]
pub struct Received {
    pub name: String,
    pub count: u64,
}

pub fn is_syncing(app: &AppHandle) -> bool {
    app.state::<BackgroundSync>().running.try_lock().is_err()
}

pub fn last_sync(app: &AppHandle) -> Option<LastSync> {
    app.state::<BackgroundSync>()
        .last
        .lock()
        .ok()
        .and_then(|last| last.clone())
}

/// Syncs once when this device is in a group, and returns what it applied from each device. Only
/// a sync the user asked for shows that; background runs show just the indicator.
pub async fn sync_now(app: &AppHandle) -> Result<Vec<Received>> {
    let state = app.state::<BackgroundSync>();
    let _running = state.running.lock().await;
    let pool = state_pool(app);
    if load_group(&pool).await?.is_none()
        || stopped(&pool).await?.is_some()
        || login_refused(&pool).await?
    {
        return Ok(Vec::new());
    }
    let _ = app.emit(EVENT_SYNCING, ());
    let result = run(app).await;
    forget_keys(app).await;
    if let Err(error) = &result
        && let Err(failed) = stop_if_shut_out(&pool, error).await
    {
        tracing::warn!(target: "flow::sync2", kind = failed.kind(), "could not stop syncing");
    }
    if matches!(result, Err(EngineError::Store(StoreError::Unauthorized))) {
        set_login_refused(&pool, true).await?;
    }
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

async fn run(app: &AppHandle) -> Result<Vec<Received>> {
    let local = local(app).await?;
    let Some(record) = load_group(&local.pool).await? else {
        return Ok(Vec::new());
    };
    let mut session = open_session(&local, &record).await?;
    let Some(received) = exchange(app, &local, &mut session).await? else {
        return Ok(Vec::new());
    };
    session.collect_garbage(&local.pool).await?;
    // A server without join requests (older than flow-sync#41) shouldn't fail the sync.
    if let Some(server) = session.store().server()
        && let Ok(requests) = server.join_requests().await
        && !requests.is_empty()
    {
        let _ = app.emit(EVENT_JOIN_REQUESTS, requests);
    }
    Ok(received)
}

/// Pushes the running profile's changes, applies everyone else's to it, and keeps the batches of
/// linked profiles that aren't running. `None` while a restored device can't choose its link yet.
async fn exchange(
    app: &AppHandle,
    local: &Local,
    session: &mut Session<'_, GroupStore>,
) -> Result<Option<Vec<Received>>> {
    let (pool, data) = (&local.pool, &local.data);
    if !session.adopt_link(pool, &local.default_profile).await? {
        return Ok(None);
    }
    let reading = reading(
        pool,
        &session.record().link,
        &local.running_profile,
        &local.default_profile,
    )
    .await?;
    session.set_reading(reading.clone());
    let mut applied = Applied::default();
    if let Some(link) = &reading.active {
        apply_kept(app, local, link, &mut applied).await?;
    }
    read_joined_links(app, local, session, &mut applied).await?;

    let exported = if reading.active.is_some() {
        flush_brains(app).await;
        let mut exported = export_collections(data, &local.meta.app, &Collection::ALL).await?;
        enrich_outgoing_albums(app, &mut exported).await;
        exported
    } else {
        Vec::new()
    };
    session.store().upload_pending().await?;
    session.push(pool, exported).await?;
    name_linked(app, pool, &local.meta.app).await?;
    session.push_profiles(pool).await?;

    let pulled = session.pull(pool).await?;
    let groups: Vec<_> = pulled
        .batches
        .iter()
        .map(|(sender, batches)| (sender.as_str(), batches.as_slice()))
        .collect();
    apply(app, local, &groups, &mut applied).await?;
    if !applied.changed.is_empty() {
        let _ = app.emit(EVENT_REFRESH, &applied.changed);
    }
    session.finish(pool, pulled).await?;
    let received = applied.received(session).await;
    if let Some(link) = &reading.active
        && snapshot_due(pool, link).await?
        && !has_kept(pool, link).await?
        && !links_to_read(pool).await?.contains(link)
    {
        let exported = export_collections(data, &local.meta.app, &Collection::ALL).await?;
        session.write_snapshot(pool, exported).await?;
    }
    if snapshot_due(pool, PROFILES_KEY).await? {
        session.write_profiles_snapshot(pool).await?;
    }
    Ok(Some(received))
}

/// The collections a run changed, and how many records each sender changed here.
#[derive(Default)]
struct Applied {
    changed: BTreeSet<String>,
    counts: BTreeMap<String, u64>,
}

impl Applied {
    async fn received(self, session: &mut Session<'_, GroupStore>) -> Vec<Received> {
        let names = if self.counts.is_empty() {
            BTreeMap::new()
        } else {
            device_names(session).await.unwrap_or_default()
        };
        self.counts
            .into_iter()
            .map(|(sender, count)| Received {
                name: names
                    .get(&sender)
                    .map(|m| m.name.clone())
                    .unwrap_or_default(),
                count,
            })
            .collect()
    }
}

/// Applies the batches kept for `link` while its profile wasn't running, in the order they were
/// read, one transaction each.
async fn apply_kept(
    app: &AppHandle,
    local: &Local,
    link: &str,
    applied: &mut Applied,
) -> Result<()> {
    let kept = kept(&local.pool, link).await?;
    if kept.is_empty() {
        return Ok(());
    }
    let groups: Vec<_> = kept
        .iter()
        .map(|(_, sender, batch)| (sender.as_str(), std::slice::from_ref(batch)))
        .collect();
    apply(app, local, &groups, applied).await?;
    let ids: Vec<i64> = kept.iter().map(|(id, _, _)| *id).collect();
    applied_kept(&local.pool, &ids).await?;
    let bytes = kept.iter().map(|(_, _, batch)| batch.size).sum();
    note_merged(&local.pool, link, bytes).await
}

/// Reads the links profiles joined from their snapshots: applied for the running profile, kept
/// for the others. A link the store can't give in full yet is tried again next run.
async fn read_joined_links(
    app: &AppHandle,
    local: &Local,
    session: &mut Session<'_, GroupStore>,
    applied: &mut Applied,
) -> Result<()> {
    let pool = &local.pool;
    for link in links_to_read(pool).await? {
        if !session.reading().reads(&link) {
            link_read(pool, &link).await?;
            continue;
        }
        let Some(read) = session.read_link(pool, &link).await? else {
            continue;
        };
        if session.reading().active.as_deref() == Some(link.as_str()) {
            let groups: Vec<_> = read
                .batches
                .iter()
                .map(|k| (k.sender.as_str(), std::slice::from_ref(&k.batch)))
                .collect();
            apply(app, local, &groups, applied).await?;
        } else {
            keep(pool, &read.batches).await?;
        }
        save_floors(pool, &read.floors).await?;
        link_read(pool, &link).await?;
    }
    Ok(())
}

/// Applies batches to the running profile, each group in one transaction.
async fn apply(
    app: &AppHandle,
    local: &Local,
    groups: &[(&str, &[IncomingBatch])],
    applied: &mut Applied,
) -> Result<()> {
    if groups.is_empty() {
        return Ok(());
    }
    flush_and_hold_brains(app).await;
    let mut result = Ok(());
    for &(sender, batches) in groups {
        match apply_batches(&local.data, &local.meta.app, sender, batches, now_ms()).await {
            Ok(report) => {
                let count = report
                    .stats
                    .iter()
                    .map(|s| s.added + s.updated + s.tombstoned)
                    .sum::<u64>();
                if count > 0 {
                    *applied.counts.entry((*sender).to_owned()).or_default() += count;
                }
                applied
                    .changed
                    .extend(report.stats.into_iter().map(|s| s.collection_key));
            }
            Err(error) => {
                result = Err(error.into());
                break;
            }
        }
    }
    // Also after a failed apply, which releases the held brain.
    reload_brains(app).await;
    result
}

/// Syncs once without waiting, for example right after this device joined a group.
pub fn sync_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { log_failure(sync_now(&app).await) });
}

/// Sends a local edit soon, once edits stop for a few seconds.
pub fn push_soon(app: &AppHandle) {
    sync_after(app, LOCAL_EDIT_DELAY);
}

/// Syncs once `delay` after the last of several calls in a row, such as a burst of edits or of
/// changes announced by the server. A run already under way is never interrupted.
pub fn sync_after(app: &AppHandle, delay: Duration) {
    let mine = app
        .state::<BackgroundSync>()
        .scheduled
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if app
            .state::<BackgroundSync>()
            .scheduled
            .load(Ordering::SeqCst)
            == mine
        {
            log_failure(sync_now(&app).await);
        }
    });
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
