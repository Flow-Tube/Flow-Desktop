//! A pairing in progress, driven from the page: the code to show, the six digits to confirm, and
//! the outcome, each sent as a `sync2://link` event.

use std::future::Future;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::actions::{Local, ensure_unlinked, local, open_session};
use super::codes::{Code, StoreLocation, new_offer, read_code};
use super::device::keychain;
use super::engine::{EngineError, Result};
use super::join_requests::wait_for_code;
use super::linking::{
    WelcomeStore, Welcomed, add_device, add_scanned, answer_shown, finish_join, finish_lan_join,
    join, join_on_lan,
};
use super::pipe::{Pipe, listen};
use super::server::ServerStore;
use super::service::sync_soon;
use super::state::{GroupRecord, StoreKind, load_group};
use super::webdav::{WebDavLogin, WebDavStore};
use super::webdav_login::{load_login, save_login};

pub const EVENT_LINK: &str = "sync2://link";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum LinkPhase {
    #[default]
    Idle,
    /// Waiting for a linked device to accept this device's request to join.
    Asking,
    /// Waiting for the other device, with the `code` this device shows, if any.
    Waiting {
        code: Option<String>,
    },
    Confirm {
        sas: String,
    },
    Linking,
    Done,
    Failed {
        kind: String,
        message: String,
    },
}

#[derive(Default)]
pub struct LinkTask {
    phase: Mutex<LinkPhase>,
    answer: Mutex<Option<oneshot::Sender<bool>>>,
    running: Mutex<Option<JoinHandle<()>>>,
}

pub fn phase(app: &AppHandle) -> LinkPhase {
    app.state::<LinkTask>()
        .phase
        .lock()
        .map(|p| p.clone())
        .unwrap_or_default()
}

fn set_phase(app: &AppHandle, phase: LinkPhase) {
    if let Ok(mut slot) = app.state::<LinkTask>().phase.lock() {
        *slot = phase.clone();
    }
    let _ = app.emit(EVENT_LINK, phase);
}

/// Shows the six digits and waits for the user; closing or cancelling counts as a no.
async fn confirm(app: AppHandle, sas: String) -> bool {
    let (sender, receiver) = oneshot::channel();
    if let Ok(mut slot) = app.state::<LinkTask>().answer.lock() {
        *slot = Some(sender);
    }
    set_phase(&app, LinkPhase::Confirm { sas });
    let accepted = receiver.await.unwrap_or(false);
    if accepted {
        set_phase(&app, LinkPhase::Linking);
    }
    accepted
}

pub fn answer(app: &AppHandle, accept: bool) {
    let sender = app
        .state::<LinkTask>()
        .answer
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    if let Some(sender) = sender {
        let _ = sender.send(accept);
    }
}

pub fn cancel(app: &AppHandle) {
    let handle = app
        .state::<LinkTask>()
        .running
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());
    if let Some(handle) = handle {
        handle.abort();
    }
    answer(app, false);
    set_phase(app, LinkPhase::Idle);
}

fn show(app: &AppHandle, code: &str) {
    set_phase(
        app,
        LinkPhase::Waiting {
            code: Some(code.to_owned()),
        },
    );
}

fn start(app: &AppHandle, work: impl Future<Output = Result<()>> + Send + 'static) {
    cancel(app);
    set_phase(app, LinkPhase::Waiting { code: None });
    let finished = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let phase = match work.await {
            Ok(()) => {
                sync_soon(&finished);
                LinkPhase::Done
            }
            Err(error) => LinkPhase::Failed {
                kind: error.kind().to_owned(),
                message: error.to_string(),
            },
        };
        set_phase(&finished, phase);
    });
    if let Ok(mut slot) = app.state::<LinkTask>().running.lock() {
        *slot = Some(handle);
    }
}

/// This device, already in a group, shows a code for a new device to scan: over the LAN, and
/// through the server's mailbox for a server group.
pub async fn start_adding(app: &AppHandle) -> Result<()> {
    add(app, None).await
}

/// Accepts a device's request to join (spec/protocol.md, Joining with the admin token): answers
/// it with the code this device would have shown, then pairs as the shower.
pub async fn start_accepting(app: &AppHandle, request: String) -> Result<()> {
    add(app, Some(request)).await
}

async fn add(app: &AppHandle, request: Option<String>) -> Result<()> {
    let local = local(app).await?;
    let record = load_group(&local.pool)
        .await?
        .ok_or(EngineError::NotLinked)?;
    // Only a server's mailbox needs no login, so other groups pair over the LAN.
    let (store, listening) = match record.kind {
        StoreKind::Server => (
            StoreLocation::server(&record.store_url),
            listen().await.unwrap_or_default(),
        ),
        StoreKind::WebDav => (
            StoreLocation::webdav(&record.store_url),
            Some(listen().await?.ok_or(EngineError::LanUnreachable)?),
        ),
        StoreKind::Lan => (
            StoreLocation::lan(),
            Some(listen().await?.ok_or(EngineError::LanUnreachable)?),
        ),
    };
    let welcome = welcome_store(&record)?;
    let task = app.clone();
    start(app, async move {
        let session = open_session(&local.pool, &record, &local.device).await?;
        let offer = new_offer(Some(store), &local.meta.name, listening);
        match &request {
            Some(id) => {
                let server = session.store().server().ok_or(EngineError::Unexpected)?;
                server.answer_join(id, &offer.qr).await?;
            }
            None => show(&task, &offer.qr),
        }
        add_device(&session, offer, &local.device, welcome, |sas| {
            confirm(task.clone(), sas)
        })
        .await?;
        Ok(())
    });
    Ok(())
}

/// Where this device's group lives, as a welcome names it to a new device.
fn welcome_store(record: &GroupRecord) -> Result<WelcomeStore> {
    Ok(match record.kind {
        StoreKind::Server => WelcomeStore::Server {
            u: record.store_url.clone(),
            i: record.instance.clone().unwrap_or_default(),
        },
        StoreKind::WebDav => {
            let login = load_login(&keychain())?;
            WelcomeStore::WebDav {
                u: record.store_url.clone(),
                n: login.user,
                w: login.password,
            }
        }
        StoreKind::Lan => WelcomeStore::Lan,
    })
}

/// Saves the group a welcome names, once its roster checks out. A `WebDAV` login is kept first,
/// so a saved group never lacks one.
async fn finish_welcomed(local: &Local, welcomed: Welcomed<impl Pipe>) -> Result<()> {
    let group = welcomed.welcome.group.clone();
    match welcomed.welcome.store.clone() {
        WelcomeStore::Server { u, i } => {
            let store =
                ServerStore::connect(&u, local.device.clone(), Some(i), Some(group)).await?;
            finish_join(&local.pool, &store, welcomed).await
        }
        WelcomeStore::WebDav { u, n, w } => {
            let login = WebDavLogin {
                user: n,
                password: w,
            };
            let store =
                WebDavStore::connect(&u, login.clone(), hex::encode(local.device.did)).await?;
            if store.group().await?.as_deref() != Some(group.as_str()) {
                return Err(EngineError::Unexpected);
            }
            save_login(&keychain(), &login)?;
            finish_join(&local.pool, &store, welcomed).await
        }
        WelcomeStore::Lan => finish_lan_join(&local.pool, &local.device, welcomed).await,
    }
}

/// This device, in no group yet, asks a server group to let it join with the operator's admin
/// token, and pairs once a linked device accepts.
pub async fn start_asking(app: &AppHandle, url: &str, admin_token: &str) -> Result<()> {
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let (url, admin_token) = (url.trim().to_owned(), admin_token.trim().to_owned());
    let task = app.clone();
    start(app, async move {
        set_phase(&task, LinkPhase::Asking);
        let store = ServerStore::connect(&url, local.device.clone(), None, None).await?;
        let code = wait_for_code(&store, &admin_token, &local.meta.name).await?;
        set_phase(&task, LinkPhase::Waiting { code: None });
        let confirm = |sas| confirm(task.clone(), sas);
        join(
            &local.pool,
            &store,
            &code,
            &local.device,
            local.meta,
            confirm,
        )
        .await
    });
    Ok(())
}

/// This device, in no group yet, shows a code for a member on the same network to scan.
pub async fn start_showing(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let listening = listen().await?.ok_or(EngineError::LanUnreachable)?;
    let task = app.clone();
    start(app, async move {
        let offer = new_offer(None, &local.meta.name, Some(listening));
        show(&task, &offer.qr);
        let welcomed = answer_shown(offer, &local.device, local.meta.clone(), |sas| {
            confirm(task.clone(), sas)
        })
        .await?;
        finish_welcomed(&local, welcomed).await
    });
    Ok(())
}

/// A `WebDAV` folder and its login, entered before scanning so pairing can go through the
/// folder's mailbox when no LAN address answers (spec/protocol.md, Pairing).
#[derive(Debug, Deserialize)]
pub struct FolderAccess {
    pub url: String,
    #[serde(flatten)]
    pub login: WebDavLogin,
}

fn same_folder(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// Answers a code from another device: a member's code joins its group, and a new device's code
/// adds that device to this one's group.
pub async fn start_with_code(
    app: &AppHandle,
    text: &str,
    folder: Option<FolderAccess>,
) -> Result<()> {
    let code = read_code(text)?;
    let local = local(app).await?;
    let task = app.clone();
    match &code {
        Code::Member { store, .. } => {
            ensure_unlinked(&local.pool).await?;
            let (kind, url) = (store.k.clone(), store.u.clone().unwrap_or_default());
            if let Some(folder) = &folder
                && kind == "webdav"
                && !same_folder(&folder.url, &url)
            {
                return Err(EngineError::OtherFolder);
            }
            start(app, async move {
                let confirm = |sas| confirm(task.clone(), sas);
                let (pool, device, meta) = (&local.pool, &local.device, local.meta.clone());
                match (kind.as_str(), folder) {
                    ("server", _) => {
                        let store = ServerStore::connect(&url, device.clone(), None, None).await?;
                        join(pool, &store, &code, device, meta, confirm).await
                    }
                    ("webdav", Some(folder)) => {
                        let did = hex::encode(device.did);
                        let store = WebDavStore::connect(&url, folder.login.clone(), did).await?;
                        store.probe().await?;
                        save_login(&keychain(), &folder.login)?;
                        join(pool, &store, &code, device, meta, confirm).await
                    }
                    _ => {
                        let welcomed = join_on_lan(&code, device, meta, confirm).await?;
                        finish_welcomed(&local, welcomed).await
                    }
                }
            });
        }
        Code::New { .. } => {
            let record = load_group(&local.pool)
                .await?
                .ok_or(EngineError::NotLinked)?;
            let welcome = welcome_store(&record)?;
            start(app, async move {
                let session = open_session(&local.pool, &record, &local.device).await?;
                add_scanned(&session, &code, &local.device, welcome, |sas| {
                    confirm(task.clone(), sas)
                })
                .await?;
                Ok(())
            });
        }
    }
    Ok(())
}
