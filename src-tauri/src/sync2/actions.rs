//! What the Linked devices page asks for, on this app's database, keychain and device name.

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::device::DEVICE_KEYS;
use super::engine::{EngineError, Result, Session};
use super::group_store::GroupStore;
use super::held::HeldStore;
use super::hybrid::HybridStore;
use super::join_requests::JoinRequest;
use super::keys::MemberSecrets;
use super::lan_peers::{met, nearby};
use super::lan_runtime::spread_leave;
use super::linking::DeviceMeta;
use super::membership::{leave_group, remove_device, rename_device};
use super::names::device_names;
use super::roster::Role;
use super::server::{ServerStore, StoreError};
use super::service::{LastSync, is_syncing, last_sync, sync_soon};
use super::setup::{
    create_group, create_lan_group, create_webdav_group, restore_group, restore_webdav_group,
};
use super::snapshot::snapshot_soon;
use super::state::{GroupRecord, StoreKind, forget_group, load_group};
use super::store::Store;
use super::webdav::{WebDavLogin, WebDavStore};
use super::webdav_login::{forget_login, load_login, save_login};
use crate::db::settings::{get_setting, set_setting};
use crate::profiles::ActiveProfile;
use crate::sync::error::SyncError;
use crate::sync::{changes, ledger};

const RECOVERY_SAVED: &str = "sync2_recovery_saved";
const STOPPED: &str = "sync2_stopped";
/// Set once the `WebDAV` folder refused its login: nothing is sent until the user enters a new
/// one, because Nextcloud bans an address after repeated failures.
const LOGIN_REFUSED: &str = "sync2_login_refused";
const NAME_LIMIT: usize = 64;

/// This installation as the group sees it.
#[derive(Clone)]
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
        device: DEVICE_KEYS.get().await?,
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
        StoreKind::Server => {
            let server = ServerStore::connect(
                &record.store_url,
                device.clone(),
                record.instance.clone(),
                Some(record.group_id.clone()),
            )
            .await?;
            let me = hex::encode(device.did);
            GroupStore::Server(Box::new(HybridStore::new(server, pool.clone(), me).await?))
        }
        StoreKind::WebDav => GroupStore::WebDav(Box::new(
            WebDavStore::connect(
                &record.store_url,
                load_login().await?,
                hex::encode(device.did),
            )
            .await?,
        )),
        StoreKind::Lan => GroupStore::Held(HeldStore::new(pool.clone())),
    };
    Session::open(pool, store, device).await
}

/// Checks that this device is in no group, and gives it fresh keys for the one it is about to
/// create or join.
pub async fn start_membership(local: &mut Local) -> Result<()> {
    if load_group(&local.pool).await?.is_some() {
        return Err(EngineError::AlreadyLinked);
    }
    local.device = DEVICE_KEYS.renew().await?;
    Ok(())
}

/// Why syncing stopped by itself: the kind of the error that shut this device out.
pub async fn stopped(pool: &SqlitePool) -> Result<Option<String>> {
    Ok(get_setting(pool, STOPPED)
        .await?
        .filter(|kind| !kind.is_empty()))
}

/// Stops syncing once the group shut this device out (spec/protocol.md, Removal). A roster that
/// no longer lists it also forgets the group and its keys; a server that refuses it a token
/// leaves that to the user, because the roster can't be read then.
pub async fn stop_if_shut_out(pool: &SqlitePool, error: &EngineError) -> Result<()> {
    match error {
        EngineError::Removed => forget_with_keys(pool).await?,
        EngineError::Store(StoreError::SignInRefused) => {}
        _ => return Ok(()),
    }
    Ok(set_setting(pool, STOPPED, error.kind()).await?)
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

pub async fn login_refused(pool: &SqlitePool) -> Result<bool> {
    Ok(get_setting(pool, LOGIN_REFUSED).await?.as_deref() == Some("1"))
}

pub async fn set_login_refused(pool: &SqlitePool, refused: bool) -> Result<()> {
    Ok(set_setting(pool, LOGIN_REFUSED, if refused { "1" } else { "0" }).await?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct LinkedStatus {
    /// The group this device is in: on a server, in a `WebDAV` folder or on its devices; `None`
    /// when in no group.
    pub kind: Option<StoreKind>,
    /// Set when syncing stopped because the group shut this device out.
    pub stopped: Option<String>,
    /// The server or folder the group syncs through.
    pub store_url: Option<String>,
    /// The `WebDAV` folder refused its login, so nothing syncs until a new one is entered.
    pub login_refused: bool,
    /// The keychain hasn't given this device's keys: a read waits for access, or it was refused.
    pub keychain_blocked: bool,
    pub recovery_saved: bool,
    pub last_sync: Option<LastSync>,
    pub syncing: bool,
}

/// What can be shown without reaching the server.
pub async fn status(app: &AppHandle) -> Result<LinkedStatus> {
    let pool = app.state::<SqlitePool>().inner().clone();
    let saved = get_setting(&pool, RECOVERY_SAVED).await?;
    let record = load_group(&pool).await?;
    Ok(LinkedStatus {
        kind: record.as_ref().map(|r| r.kind),
        stopped: stopped(&pool).await?,
        store_url: record
            .filter(|r| r.kind != StoreKind::Lan)
            .map(|r| r.store_url),
        login_refused: login_refused(&pool).await?,
        keychain_blocked: DEVICE_KEYS.blocked(),
        // Only a device that created or restored the group was shown words to confirm.
        recovery_saved: saved.as_deref() != Some("0"),
        last_sync: last_sync(app),
        syncing: is_syncing(app),
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
    /// When the device last synced: as the server saw it, or for a LAN group when this device
    /// last met it (or, for this device, its own last run).
    pub last_sync_ms: Option<i64>,
}

pub async fn devices(app: &AppHandle) -> Result<Vec<LinkedDevice>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let mut session = open_session(&local.pool, &record, &local.device).await?;
    let names = device_names(&mut session).await?;
    let me = hex::encode(local.device.did);
    let nearby = nearby(app);
    // Best effort: the list still shows when the server can't be asked.
    let last_synced = if let Some(server) = session.store().server() {
        server.last_seen().await.unwrap_or_default()
    } else {
        let mut met = met(app);
        met.extend(last_sync(app).map(|last| (me.clone(), last.at_ms)));
        met
    };
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
                last_sync_ms: last_synced.get(id).copied(),
            }
        })
        .collect())
}

/// Starts a group on a fresh Flow server, after resetting it when `reset_server` (which deletes the
/// group it holds for every device), and returns the recovery words to show once.
pub async fn create(
    app: &AppHandle,
    url: &str,
    admin_token: &str,
    reset_server: bool,
) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    if reset_server {
        ServerStore::connect(url.trim(), local.device.clone(), None, None)
            .await?
            .reset_server(admin_token.trim())
            .await?;
    }
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

/// Starts a group in a `WebDAV` folder and returns the recovery words to show once.
pub async fn create_on_webdav(
    app: &AppHandle,
    url: &str,
    user: &str,
    password: &str,
) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    let url = url.trim();
    let login = WebDavLogin {
        user: user.trim().to_owned(),
        password: password.to_owned(),
    };
    let store = WebDavStore::connect(url, login.clone(), hex::encode(local.device.did)).await?;
    save_login(&login).await?;
    let link = default_link(app);
    let words =
        create_webdav_group(&local.pool, &store, url, &local.device, &local.meta, &link).await?;
    set_recovery_saved(&local.pool, false).await?;
    Ok(words)
}

/// Replaces a `WebDAV` login the folder refused, once the folder takes the new one and still
/// holds this group.
pub async fn update_login(app: &AppHandle, user: &str, password: &str) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let login = WebDavLogin {
        user: user.trim().to_owned(),
        password: password.to_owned(),
    };
    let store = WebDavStore::connect(
        &record.store_url,
        login.clone(),
        hex::encode(local.device.did),
    )
    .await?;
    store.probe().await?;
    if store.group().await?.as_deref() != Some(record.group_id.as_str()) {
        return Err(EngineError::Unexpected);
    }
    save_login(&login).await?;
    set_login_refused(&local.pool, false).await?;
    sync_soon(app);
    Ok(())
}

/// Starts a group that lives on this network's devices, with no server, and returns the recovery
/// words to show once.
pub async fn create_on_lan(app: &AppHandle) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    let words =
        create_lan_group(&local.pool, &local.device, &local.meta, &default_link(app)).await?;
    set_recovery_saved(&local.pool, false).await?;
    Ok(words)
}

/// Restores the group from its recovery words, on a Flow server or, with `login`, in a `WebDAV`
/// folder, and returns the new words to show once.
pub async fn restore(
    app: &AppHandle,
    url: &str,
    words: &str,
    login: Option<WebDavLogin>,
) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    let (pool, url, device, meta) = (&local.pool, url.trim(), &local.device, &local.meta);
    let next = match login {
        Some(login) => {
            let store = WebDavStore::connect(url, login.clone(), hex::encode(device.did)).await?;
            save_login(&login).await?;
            restore_webdav_group(pool, &store, url, words, device, meta).await?
        }
        None => restore_group(pool, url, words, device, meta).await?,
    };
    set_recovery_saved(&local.pool, false).await?;
    sync_soon(app);
    Ok(next)
}

/// Asks the keychain again after it refused, and syncs once it answered.
pub async fn retry_keychain(app: &AppHandle) -> Result<()> {
    DEVICE_KEYS.retry();
    local(app).await?;
    sync_soon(app);
    Ok(())
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

/// Leaves the group (spec/protocol.md, Leaving): appends a `leave` entry, then forgets the group
/// and this device's keys.
pub async fn leave(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local.pool, &record, &local.device).await?;
    let spread = async {
        if record.kind == StoreKind::Lan {
            spread_leave(app, &session, &local).await;
        }
    };
    depart(&local.pool, &session, &local.device, spread).await?;
    forget_keys().await
}

/// [`leave`], when this device is in a group.
pub async fn leave_if_linked(app: &AppHandle) -> Result<()> {
    match load_group(app.state::<SqlitePool>().inner()).await? {
        Some(_) => leave(app).await,
        None => Ok(()),
    }
}

/// Appends `leave` unless this is the group's last device, which can only forget it, waits for
/// `spread` to pass it on, then forgets the group here.
pub async fn depart<S: Store>(
    pool: &SqlitePool,
    session: &Session<'_, S>,
    device: &MemberSecrets,
    spread: impl Future<Output = ()>,
) -> Result<()> {
    let devices = session
        .roster()
        .members
        .values()
        .filter(|m| m.role == Role::Device)
        .count();
    if devices > 1 {
        leave_group(session, device).await?;
        spread.await;
    }
    forget_here(pool).await
}

/// Forgets the group and this device's keys without telling the group, for a device it already
/// shut out.
pub async fn forget(app: &AppHandle) -> Result<()> {
    forget_with_keys(app.state::<SqlitePool>().inner()).await
}

/// Clears history, subscriptions and playlists. When this profile syncs, the caller first leaves
/// the group ([`leave_if_linked`]), and the deletions recorded here are dropped, so a reset never
/// reaches the other devices; linking again brings their data back.
pub async fn reset_local_data(pool: &SqlitePool, syncs: bool) -> Result<()> {
    if syncs && load_group(pool).await?.is_some() {
        return Err(EngineError::AlreadyLinked);
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

/// Forgets the device keys and the `WebDAV` login kept for the group.
async fn forget_keys() -> Result<()> {
    DEVICE_KEYS.forget().await?;
    Ok(forget_login().await?)
}

/// Forgets the group here, with its keys.
async fn forget_with_keys(pool: &SqlitePool) -> Result<()> {
    forget_here(pool).await?;
    forget_keys().await
}

/// Forgets the group on a database, keeping this device's keys.
async fn forget_here(pool: &SqlitePool) -> Result<()> {
    forget_group(pool).await?;
    set_setting(pool, STOPPED, "").await?;
    set_login_refused(pool, false).await?;
    set_recovery_saved(pool, true).await
}
