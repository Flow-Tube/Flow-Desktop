//! A pairing in progress, driven from the page: the code to show, the six digits to confirm, and
//! the outcome, each sent as a `sync2://link` event.

use std::future::Future;
use std::sync::Mutex;

use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::actions::{ensure_unlinked, local, open_session};
use super::codes::{Code, StoreLocation, new_offer, read_code};
use super::engine::{EngineError, Result};
use super::linking::{
    WelcomeStore, add_device, add_scanned, answer_shown, finish_join, finish_lan_join, join,
    join_lan,
};
use super::pipe::listen;
use super::server::ServerStore;
use super::service::sync_soon;
use super::state::{StoreKind, load_group};

pub const EVENT_LINK: &str = "sync2://link";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum LinkPhase {
    #[default]
    Idle,
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
    let local = local(app).await?;
    let record = load_group(&local.pool)
        .await?
        .ok_or(EngineError::NotLinked)?;
    let (store, listening) = match record.kind {
        StoreKind::Server => (
            StoreLocation::server(&record.store_url),
            listen().await.unwrap_or_default(),
        ),
        StoreKind::Lan => (
            StoreLocation::lan(),
            Some(listen().await?.ok_or(EngineError::LanUnreachable)?),
        ),
    };
    let task = app.clone();
    start(app, async move {
        let session = open_session(&local.pool, &record, &local.device).await?;
        let offer = new_offer(Some(store), &local.meta.name, listening);
        show(&task, &offer.qr);
        add_device(&session, offer, &local.device, |sas| {
            confirm(task.clone(), sas)
        })
        .await?;
        Ok(())
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
        let welcomed = answer_shown(offer, &local.device, local.meta, |sas| {
            confirm(task.clone(), sas)
        })
        .await?;
        let WelcomeStore::Server { u, i } = welcomed.welcome.store.clone() else {
            return finish_lan_join(&local.pool, &local.device, welcomed).await;
        };
        let group = welcomed.welcome.group.clone();
        let store = ServerStore::connect(&u, local.device.clone(), Some(i), Some(group)).await?;
        finish_join(&local.pool, &store, welcomed).await
    });
    Ok(())
}

/// Answers a code from another device: a member's code joins its group, and a new device's code
/// adds that device to this one's group.
pub async fn start_with_code(app: &AppHandle, text: &str) -> Result<()> {
    let code = read_code(text)?;
    let local = local(app).await?;
    let task = app.clone();
    match &code {
        Code::Member { store_url, .. } => {
            ensure_unlinked(&local.pool).await?;
            let store_url = store_url.clone();
            start(app, async move {
                let confirm = |sas| confirm(task.clone(), sas);
                let Some(store_url) = store_url else {
                    return join_lan(&local.pool, &code, &local.device, local.meta, confirm).await;
                };
                let store =
                    ServerStore::connect(&store_url, local.device.clone(), None, None).await?;
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
        }
        Code::New { .. } => {
            let record = load_group(&local.pool)
                .await?
                .ok_or(EngineError::NotLinked)?;
            start(app, async move {
                let session = open_session(&local.pool, &record, &local.device).await?;
                add_scanned(&session, &code, &local.device, |sas| {
                    confirm(task.clone(), sas)
                })
                .await?;
                Ok(())
            });
        }
    }
    Ok(())
}
