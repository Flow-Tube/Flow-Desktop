//! What the Linked devices page asks for, on this app's database, keychain and device name.

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::device::{device_keys, keychain};
use super::engine::{EngineError, Result, Session};
use super::group_store::GroupStore;
use super::held::HeldStore;
use super::join_requests::JoinRequest;
use super::keys::MemberSecrets;
use super::lan_runtime::nearby;
use super::linking::DeviceMeta;
use super::membership::{remove_device, rename_device};
use super::names::device_names;
use super::roster::Role;
use super::server::ServerStore;
use super::service::{LastSync, last_sync, sync_soon};
use super::setup::{create_group, create_lan_group, restore_group};
use super::snapshot::snapshot_soon;
use super::state::{GroupRecord, StoreKind, forget_group, load_group};
use crate::db::settings::{get_setting, set_setting};
use crate::profiles::ActiveProfile;
use crate::sync::error::SyncError;
use crate::sync::{changes, ledger};

const RECOVERY_SAVED: &str = "sync2_recovery_saved";
const NAME_LIMIT: usize = 64;

/// This installation as the group sees it.
pub struct Local {
    pub pool: SqlitePool,
    pub device: MemberSecrets,
    pub meta: DeviceMeta,
}

/// Like FLOW-SYNC/1, only the Default profile syncs until profiles get their own links.
pub async fn local(app: &AppHandle) -> Result<Local> {
    let profile = app.state::<ActiveProfile>();
    if !profile.is_default {
        return Err(SyncError::NotDefaultProfile(profile.default_name.clone()).into());
    }
    let pool = app.state::<SqlitePool>().inner().clone();
    let meta = DeviceMeta {
        app: ledger::get_or_create_device_id(&pool).await?,
        name: ledger::device_name(&pool).await?,
        platform: std::env::consts::OS.to_owned(),
    };
    Ok(Local {
        device: device_keys(&keychain())?,
        pool,
        meta,
    })
}

pub async fn open_session<'a>(
    pool: &SqlitePool,
    record: &GroupRecord,
    device: &'a MemberSecrets,
) -> Result<Session<'a, GroupStore>> {
    let store = match record.kind {
        StoreKind::Server => GroupStore::Server(Box::new(
            ServerStore::connect(
                &record.store_url,
                device.clone(),
                record.instance.clone(),
                Some(record.group_id.clone()),
            )
            .await?,
        )),
        StoreKind::Lan => GroupStore::Held(HeldStore::new(pool.clone())),
    };
    Session::open(pool, store, device).await
}

pub async fn ensure_unlinked(pool: &SqlitePool) -> Result<()> {
    match load_group(pool).await? {
        Some(_) => Err(EngineError::AlreadyLinked),
        None => Ok(()),
    }
}

async fn linked(pool: &SqlitePool) -> Result<GroupRecord> {
    load_group(pool).await?.ok_or(EngineError::NotLinked)
}

/// The profile link this device's Default profile publishes under when it starts one: its own id.
pub fn default_link(app: &AppHandle) -> String {
    app.state::<ActiveProfile>().id.clone()
}

async fn set_recovery_saved(pool: &SqlitePool, saved: bool) -> Result<()> {
    Ok(set_setting(pool, RECOVERY_SAVED, if saved { "1" } else { "0" }).await?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedStatus {
    pub linked: bool,
    /// The group lives on its devices, with no server.
    pub on_lan: bool,
    pub store_url: Option<String>,
    pub recovery_saved: bool,
    pub last_sync: Option<LastSync>,
}

/// What can be shown without reaching the server.
pub async fn status(app: &AppHandle) -> Result<LinkedStatus> {
    let pool = app.state::<SqlitePool>().inner().clone();
    let saved = get_setting(&pool, RECOVERY_SAVED).await?;
    let record = load_group(&pool).await?;
    Ok(LinkedStatus {
        linked: record.is_some(),
        on_lan: record.as_ref().is_some_and(|r| r.kind == StoreKind::Lan),
        store_url: record
            .filter(|r| r.kind == StoreKind::Server)
            .map(|r| r.store_url),
        // Only a device that created or restored the group was shown words to confirm.
        recovery_saved: saved.as_deref() != Some("0"),
        last_sync: last_sync(app),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub this_device: bool,
    /// Met on this network in the last few minutes.
    pub nearby: bool,
}

pub async fn devices(app: &AppHandle) -> Result<Vec<LinkedDevice>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let mut session = open_session(&local.pool, &record, &local.device).await?;
    let names = device_names(&mut session).await?;
    let me = hex::encode(local.device.did);
    let nearby = nearby(app);
    Ok(session
        .roster()
        .members
        .iter()
        .filter(|(_, member)| member.role == Role::Device)
        .map(|(id, _)| {
            let meta = names.get(id);
            LinkedDevice {
                id: id.clone(),
                name: meta.map(|m| m.name.clone()).unwrap_or_default(),
                platform: meta.map(|m| m.platform.clone()).unwrap_or_default(),
                this_device: *id == me,
                nearby: nearby.contains(id),
            }
        })
        .collect())
}

/// Starts a group on a fresh Flow server and returns the recovery words to show once.
pub async fn create(app: &AppHandle, url: &str, admin_token: &str) -> Result<String> {
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let words = create_group(
        &local.pool,
        url.trim(),
        admin_token.trim(),
        &local.device,
        &local.meta,
        &default_link(app),
    )
    .await?;
    set_recovery_saved(&local.pool, false).await?;
    Ok(words)
}

/// Starts a group that lives on this network's devices, with no server, and returns the recovery
/// words to show once.
pub async fn create_on_lan(app: &AppHandle) -> Result<String> {
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let words =
        create_lan_group(&local.pool, &local.device, &local.meta, &default_link(app)).await?;
    set_recovery_saved(&local.pool, false).await?;
    Ok(words)
}

/// Restores the group from its recovery words and returns the new words to show once.
pub async fn restore(app: &AppHandle, url: &str, words: &str) -> Result<String> {
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let next = restore_group(&local.pool, url.trim(), words, &local.device, &local.meta).await?;
    set_recovery_saved(&local.pool, false).await?;
    sync_soon(app);
    Ok(next)
}

pub async fn recovery_saved(app: &AppHandle) -> Result<()> {
    set_recovery_saved(app.state::<SqlitePool>().inner(), true).await
}

pub async fn rename(app: &AppHandle, id: &str, name: &str) -> Result<()> {
    let name: String = name.trim().chars().take(NAME_LIMIT).collect();
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let mut session = open_session(&local.pool, &record, &local.device).await?;
    let current = device_names(&mut session)
        .await?
        .remove(id)
        .ok_or(EngineError::Unexpected)?;
    let meta = DeviceMeta { name, ..current };
    rename_device(&session, &local.device, id, &meta).await
}

pub async fn remove(app: &AppHandle, id: &str) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local.pool, &record, &local.device).await?;
    remove_device(&session, &local.device, id).await?;
    snapshot_soon(&local.pool).await?;
    sync_soon(app);
    Ok(())
}

/// Devices asking to join this device's server group; none for a LAN group.
pub async fn join_requests(app: &AppHandle) -> Result<Vec<JoinRequest>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local.pool, &record, &local.device).await?;
    match session.store().server() {
        Some(server) => Ok(server.join_requests().await?),
        None => Ok(Vec::new()),
    }
}

pub async fn decline_join(app: &AppHandle, id: &str) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local.pool, &record, &local.device).await?;
    let server = session.store().server().ok_or(EngineError::Unexpected)?;
    Ok(server.decline_join(id).await?)
}

/// Stops syncing on this device. The group keeps it as a member until another device removes it.
pub async fn forget(app: &AppHandle) -> Result<()> {
    leave(app.state::<SqlitePool>().inner()).await
}

/// Clears history, subscriptions and playlists. When this profile syncs, the device first leaves
/// its group and afterwards drops the deletions it recorded, so a reset never reaches the other
/// devices; linking again brings their data back.
pub async fn reset_local_data(pool: &SqlitePool, syncs: bool) -> Result<()> {
    if syncs {
        leave(pool).await?;
    }
    crate::db::watch_history::clear_watch_history(pool).await?;
    for key in ["subscriptions", "user_playlists"] {
        set_setting(pool, key, "[]").await?;
    }
    if syncs {
        changes::clear_all(pool).await?;
    }
    Ok(())
}

/// [`forget`] on a database, for a reset that must not reach the other devices.
pub async fn leave(pool: &SqlitePool) -> Result<()> {
    forget_group(pool).await?;
    set_recovery_saved(pool, true).await
}
