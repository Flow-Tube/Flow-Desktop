//! What the Linked devices page asks for, on this app's database, keychain and device name.

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::device::DEVICE_KEYS;
use super::engine::{EngineError, Result, Session};
use super::forks::{Settlement, settle_roster};
use super::group_store::GroupStore;
use super::held::HeldStore;
use super::hybrid::HybridStore;
use super::join_requests::JoinRequest;
use super::keys::MemberSecrets;
use super::lan_peers::{met, nearby};
use super::lan_runtime::spread_leave;
use super::linking::DeviceMeta;
use super::membership::{leave_group, remove_devices, rename_device};
use super::names::device_names;
use super::profile_links::{link_profile, reading};
use super::recovery_flow::{RestoreDevice, replace_recovery_key};
use super::recovery_notice::{RecoveryNotice, forget_recovery_notice, recovery_notice};
use super::restore_removal::take_replaced_words;
use super::roster::{Role, devices_added_by, entry_hash, recovery_member, replay_roster};
use super::server::{ServerStore, StoreError};
use super::service::{LastSync, is_syncing, last_sync, sync_now, sync_soon};
use super::setup::{
    create_group, create_lan_group, create_webdav_group, preview_restore_group,
    preview_restore_webdav_group, restore_group, restore_webdav_group,
};
use super::snapshot::snapshot_soon;
use super::state::{
    GroupRecord, StoreKind, add_roster_pin, forget_group, load_group, roster_entries, roster_pins,
};
use super::store::Store;
use super::store_login::{forget_login_change, forget_login_sent, login_due, login_waiting};
use super::webdav::{WebDavLogin, WebDavStore};
use super::webdav_login::{
    forget_login, forget_pending_login, load_login, load_pending_login, save_login,
    save_pending_login,
};
use crate::db::settings::{get_setting, set_setting};
use crate::services::profile_service::ProfileService;
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
    /// The group's state on this device, in Default's database whichever profile runs.
    pub pool: SqlitePool,
    /// The running profile's database, which batches are exported from and applied to.
    pub data: SqlitePool,
    pub running_profile: String,
    pub default_profile: String,
    pub device: MemberSecrets,
    pub meta: DeviceMeta,
}

/// The database holding the group's state: Default's, whichever profile runs.
pub fn state_pool(app: &AppHandle) -> SqlitePool {
    crate::db::device::pool(app.state::<SqlitePool>().inner()).clone()
}

pub async fn local(app: &AppHandle) -> Result<Local> {
    let profiles = app.state::<ProfileService>();
    let (running_profile, default_profile) = (
        profiles.running_profile_id()?,
        profiles.default_profile_id()?,
    );
    let pool = state_pool(app);
    let meta = DeviceMeta {
        app: ledger::get_or_create_device_id(&pool).await?,
        name: ledger::device_name(&pool).await?,
        platform: std::env::consts::OS.to_owned(),
    };
    Ok(Local {
        device: DEVICE_KEYS.get().await?,
        data: app.state::<SqlitePool>().inner().clone(),
        running_profile,
        default_profile,
        pool,
        meta,
    })
}

/// The group's Flow server, signed in as this device, without reading the roster.
async fn server_store(local: &Local, record: &GroupRecord) -> Result<ServerStore> {
    Ok(ServerStore::connect(
        &record.store_url,
        local.device.clone(),
        record.instance.clone(),
        Some(record.group_id.clone()),
    )
    .await?)
}

/// A session for this device, reading the links its profiles sync.
async fn store_of(local: &Local, record: &GroupRecord) -> Result<GroupStore> {
    let (pool, device) = (&local.pool, &local.device);
    Ok(match record.kind {
        StoreKind::Server => {
            let server = server_store(local, record).await?;
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
    })
}

pub async fn open_session<'a>(
    local: &'a Local,
    record: &GroupRecord,
) -> Result<Session<'a, GroupStore>> {
    let (pool, device) = (&local.pool, &local.device);
    let store = store_of(local, record).await?;
    let mut session = Session::open(pool, store, device).await?;
    let (running, default) = (&local.running_profile, &local.default_profile);
    session.set_reading(reading(pool, &record.link, running, default).await?);
    Ok(session)
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
/// extends the applied one and no longer lists it also forgets the group and its keys. A server
/// that refuses it a token, or a roster that replaces entries it had applied, leaves that to the
/// user.
pub async fn stop_if_shut_out(pool: &SqlitePool, error: &EngineError) -> Result<()> {
    match error {
        EngineError::Removed => forget_with_keys(pool).await?,
        EngineError::Store(StoreError::SignInRefused) | EngineError::RemovalUnconfirmed => {}
        _ => return Ok(()),
    }
    Ok(set_setting(pool, STOPPED, error.kind()).await?)
}

async fn linked(pool: &SqlitePool) -> Result<GroupRecord> {
    load_group(pool).await?.ok_or(EngineError::NotLinked)
}

/// A group this device just started syncs the running profile under its own id, and its
/// recovery words are still to be confirmed.
async fn started(local: &Local, words: String) -> Result<String> {
    let profile = &local.running_profile;
    link_profile(&local.pool, profile, profile).await?;
    set_recovery_saved(&local.pool, false).await?;
    Ok(words)
}

pub(super) async fn set_recovery_saved(pool: &SqlitePool, saved: bool) -> Result<()> {
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
    /// A removed device can still reach the `WebDAV` folder until its login changes.
    pub login_due: bool,
    /// The devices yet to read the login this device sent, while that change is under way.
    pub login_waiting: Option<Vec<String>>,
    /// The keychain hasn't given this device's keys: a read waits for access, or it was refused.
    pub keychain_blocked: bool,
    pub recovery_saved: bool,
    /// Words the end of a restore had to make, to show once.
    pub replaced_words: Option<String>,
    pub recovery_notice: Option<RecoveryNotice>,
    /// The device that set the recovery key left: nothing is written until it is replaced.
    pub recovery_due: bool,
    pub last_sync: Option<LastSync>,
    pub syncing: bool,
}

/// One side of a contested roster: keeping it keeps this device, which removed those.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContestSide {
    pub entry: String,
    pub device: String,
    pub removes: Vec<String>,
}

/// The sides the user chooses between while the roster is contested.
pub async fn contest(app: &AppHandle) -> Result<Vec<ContestSide>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let store = store_of(&local, &record).await?;
    let pins = roster_pins(&local.pool).await?;
    let mut session = Session::on_applied(&local.pool, store, &local.device).await?;
    let Settlement::Contested { sides, .. } = settle_roster(
        &record.group_id,
        session.entries(),
        &session.store().roster_view().await?,
        &pins,
        session.store().is_linear(),
    )?
    else {
        return Ok(Vec::new());
    };
    let _ = session.prepare_names().await;
    let names = device_names(&mut session).await.unwrap_or_default();
    let name = |did: &str| {
        names
            .get(did)
            .map_or_else(|| did[..8].to_owned(), |m| m.name.clone())
    };
    Ok(sides
        .iter()
        .map(|side| ContestSide {
            entry: entry_hash(side),
            device: name(&side.signer),
            removes: side.remove.iter().flatten().map(|did| name(did)).collect(),
        })
        .collect())
}

/// Keeps one side of a contested roster on this device. The next sync settles from it.
pub async fn keep_side(app: &AppHandle, entry: &str) -> Result<()> {
    if !contest(app).await?.iter().any(|side| side.entry == entry) {
        return Err(EngineError::Unexpected);
    }
    add_roster_pin(&state_pool(app), entry).await?;
    sync_soon(app);
    Ok(())
}

/// What can be shown without reaching the server.
pub async fn status(app: &AppHandle) -> Result<LinkedStatus> {
    let pool = state_pool(app);
    let saved = get_setting(&pool, RECOVERY_SAVED).await?;
    let record = load_group(&pool).await?;
    let roster = replay_roster(&roster_entries(&pool).await?).ok();
    Ok(LinkedStatus {
        kind: record.as_ref().map(|r| r.kind),
        stopped: stopped(&pool).await?,
        store_url: record
            .filter(|r| r.kind != StoreKind::Lan)
            .map(|r| r.store_url),
        login_refused: login_refused(&pool).await?,
        login_due: login_due(&pool).await?,
        login_waiting: login_waiting(&pool).await?,
        keychain_blocked: DEVICE_KEYS.blocked(),
        // Only a device that created or restored the group was shown words to confirm.
        recovery_saved: saved.as_deref() != Some("0"),
        replaced_words: take_replaced_words(),
        recovery_notice: recovery_notice(&pool).await?,
        recovery_due: roster.is_some_and(|state| state.recovery_due),
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
    /// It set the current recovery key, so its leaving stops the others writing.
    pub set_recovery_key: bool,
    /// Met on this network in the last few minutes.
    pub nearby: bool,
    /// When the device last synced: as the server saw it, or for a LAN group when this device
    /// last met it (or, for this device, its own last run).
    pub last_sync_ms: Option<i64>,
}

pub async fn devices(app: &AppHandle) -> Result<Vec<LinkedDevice>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let mut session = open_session(&local, &record).await?;
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
    let installer = recovery_member(&session.roster().members)
        .and_then(|(_, member)| member.installer.as_ref());
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
                set_recovery_key: installer == Some(id),
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
        &local.running_profile,
    )
    .await?;
    started(&local, words).await
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
    let link = &local.running_profile;
    let words =
        create_webdav_group(&local.pool, &store, url, &local.device, &local.meta, link).await?;
    started(&local, words).await
}

/// Checks that the folder takes `login` and still holds this group.
pub async fn check_login(record: &GroupRecord, me: String, login: &WebDavLogin) -> Result<()> {
    let store = WebDavStore::connect(&record.store_url, login.clone(), me).await?;
    store.probe().await?;
    if store.group().await?.as_deref() != Some(record.group_id.as_str()) {
        return Err(EngineError::Unexpected);
    }
    Ok(())
}

/// Saves a login the folder took, in place of whatever came before.
async fn adopt_login(pool: &SqlitePool, login: &WebDavLogin) -> Result<()> {
    save_login(login).await?;
    forget_pending_login().await?;
    forget_login_change(pool).await?;
    set_login_refused(pool, false).await
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
    check_login(&record, hex::encode(local.device.did), &login).await?;
    adopt_login(&local.pool, &login).await?;
    sync_soon(app);
    Ok(())
}

/// Sends the other devices a new login for the folder, before the user sets it there (spec/protocol.md,
/// Replacing a store's login). Opening the session re-reads the roster, and fails while it is contested.
pub async fn start_login_change(app: &AppHandle, user: &str, password: &str) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    if record.kind != StoreKind::WebDav {
        return Err(EngineError::Unexpected);
    }
    let login = WebDavLogin {
        user: user.trim().to_owned(),
        password: password.to_owned(),
    };
    let mut session = open_session(&local, &record).await?;
    session.write_login(&local.pool, &login).await?;
    save_pending_login(&login).await?;
    sync_soon(app);
    Ok(())
}

/// The user set the new login at the provider: checks it, and uses it from now on.
pub async fn finish_login_change(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let login = load_pending_login().await?.ok_or(EngineError::Unexpected)?;
    check_login(&record, hex::encode(local.device.did), &login).await?;
    adopt_login(&local.pool, &login).await?;
    sync_soon(app);
    Ok(())
}

/// Stops a login change this device started. A device that read the login still holds it, and only
/// tries it if the folder refuses the current one.
pub async fn cancel_login_change(app: &AppHandle) -> Result<()> {
    forget_pending_login().await?;
    forget_login_sent(&state_pool(app)).await
}

/// The folder refused the login: tries the pending one once. False when there is none, or it fails.
pub async fn try_pending_login(app: &AppHandle) -> Result<bool> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let Some(login) = load_pending_login().await? else {
        return Ok(false);
    };
    if check_login(&record, hex::encode(local.device.did), &login)
        .await
        .is_err()
    {
        return Ok(false);
    }
    adopt_login(&local.pool, &login).await?;
    Ok(true)
}

/// Starts a group that lives on this network's devices, with no server, and returns the recovery
/// words to show once.
pub async fn create_on_lan(app: &AppHandle) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    let link = &local.running_profile;
    let words = create_lan_group(&local.pool, &local.device, &local.meta, link).await?;
    started(&local, words).await
}

/// Restores the group from its recovery words, on a Flow server or, with `login`, in a `WebDAV`
/// folder, and returns the new words to show once.
pub async fn preview_restore(
    app: &AppHandle,
    url: &str,
    words: &str,
    login: Option<WebDavLogin>,
) -> Result<Vec<RestoreDevice>> {
    let local = local(app).await?;
    if load_group(&local.pool).await?.is_some() {
        return Err(EngineError::AlreadyLinked);
    }
    let url = url.trim();
    match login {
        Some(login) => {
            let store = WebDavStore::connect(url, login, hex::encode(local.device.did)).await?;
            preview_restore_webdav_group(&store, words).await
        }
        None => preview_restore_group(url, words).await,
    }
}

pub async fn restore(
    app: &AppHandle,
    url: &str,
    words: &str,
    login: Option<WebDavLogin>,
    kept: &[String],
) -> Result<String> {
    let mut local = local(app).await?;
    start_membership(&mut local).await?;
    let (pool, url, device, meta) = (&local.pool, url.trim(), &local.device, &local.meta);
    let next = match login {
        Some(login) => {
            let store = WebDavStore::connect(url, login.clone(), hex::encode(device.did)).await?;
            save_login(&login).await?;
            restore_webdav_group(pool, &store, url, words, device, meta, kept).await?
        }
        None => restore_group(pool, url, words, device, meta, kept).await?,
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
    set_recovery_saved(&state_pool(app), true).await
}

/// Replaces the recovery words from this device, so the old ones stop working, and returns the new
/// words to show once.
pub async fn replace_recovery(app: &AppHandle) -> Result<String> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local, &record).await?;
    let words = replace_recovery_key(&session, &local.device).await?;
    set_recovery_saved(&local.pool, false).await?;
    snapshot_soon(&local.pool).await?;
    sync_soon(app);
    Ok(words)
}

pub async fn rename(app: &AppHandle, id: &str, name: &str) -> Result<()> {
    let name: String = name.trim().chars().take(NAME_LIMIT).collect();
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let mut session = open_session(&local, &record).await?;
    let current = device_names(&mut session)
        .await?
        .remove(id)
        .ok_or(EngineError::Unexpected)?;
    let meta = DeviceMeta { name, ..current };
    rename_device(&session, &local.device, id, &meta).await
}

/// Removes `id` and the devices in `also`, and returns the new recovery words to show once when
/// they had to be replaced with it.
pub async fn remove(app: &AppHandle, id: &str, also: &[String]) -> Result<Option<String>> {
    let local = local(app).await?;
    // The cut names what this device has read, so read what it can first (spec/protocol.md, Removal).
    if let Err(error) = sync_now(app).await {
        tracing::warn!(target: "flow::sync2", kind = error.kind(), "removing without a last sync");
    }
    let record = linked(&local.pool).await?;
    let session = open_session(&local, &record).await?;
    let mut removed = also.to_vec();
    removed.push(id.to_owned());
    let words = remove_devices(&local.pool, &session, &local.device, &removed).await?;
    if words.is_some() {
        set_recovery_saved(&local.pool, false).await?;
    }
    snapshot_soon(&local.pool).await?;
    sync_soon(app);
    Ok(words)
}

/// The current devices `id` added, for the user to remove with it if they don't recognise them.
pub async fn added_by(app: &AppHandle, id: &str) -> Result<Vec<String>> {
    let entries = roster_entries(&state_pool(app)).await?;
    Ok(devices_added_by(&entries, id))
}

/// The user answered the notice that the recovery key changed.
pub async fn answer_recovery_notice(app: &AppHandle) -> Result<()> {
    forget_recovery_notice(&state_pool(app)).await
}

/// Devices asking to join this device's server group; none for a LAN group.
pub async fn join_requests(app: &AppHandle) -> Result<Vec<JoinRequest>> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    if record.kind != StoreKind::Server {
        return Ok(Vec::new());
    }
    Ok(server_store(&local, &record).await?.join_requests().await?)
}

pub async fn decline_join(app: &AppHandle, id: &str) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    if record.kind != StoreKind::Server {
        return Err(EngineError::Unexpected);
    }
    Ok(server_store(&local, &record)
        .await?
        .decline_join(id)
        .await?)
}

/// Leaves the group (spec/protocol.md, Leaving): appends a `leave` entry, then forgets the group
/// and this device's keys.
pub async fn leave(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    let record = linked(&local.pool).await?;
    let session = open_session(&local, &record).await?;
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
    match load_group(&state_pool(app)).await? {
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
    forget_with_keys(&state_pool(app)).await
}

/// Clears history, subscriptions and playlists. When this profile syncs, the caller first leaves
/// the group ([`leave_if_linked`]), and the deletions recorded here are dropped, so a reset never
/// reaches the other devices; linking again brings their data back.
pub async fn reset_local_data(pool: &SqlitePool, syncs: bool) -> Result<()> {
    if syncs && load_group(crate::db::device::pool(pool)).await?.is_some() {
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
    super::error_log::clear(pool).await?;
    set_setting(pool, STOPPED, "").await?;
    set_login_refused(pool, false).await?;
    forget_login_change(pool).await?;
    set_recovery_saved(pool, true).await
}
