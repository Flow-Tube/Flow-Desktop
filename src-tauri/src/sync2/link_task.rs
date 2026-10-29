//! A pairing in progress, driven from the page: the code to show, the six digits to confirm, and
//! the outcome, each sent as a `sync2://link` event.

use std::future::Future;
use std::sync::Mutex;

use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::actions::{ensure_unlinked, local, open_session};
use super::engine::{EngineError, Result};
use super::linking::{add_device, join, new_offer, read_offer};
use super::server::ServerStore;
use super::service::sync_soon;
use super::state::load_group;

pub const EVENT_LINK: &str = "sync2://link";

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum LinkPhase {
    #[default]
    Idle,
    /// Waiting for the other device; a member shows `code` once its slot is open.
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

/// This device, already in a group, shows a code for a new device to scan.
pub async fn start_adding(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    let record = load_group(&local.pool)
        .await?
        .ok_or(EngineError::NotLinked)?;
    let task = app.clone();
    start(app, async move {
        let session = open_session(&local.pool, &record, &local.device).await?;
        let offer = new_offer(&record.store_url, &local.meta.name);
        set_phase(
            &task,
            LinkPhase::Waiting {
                code: Some(offer.qr.clone()),
            },
        );
        add_device(&session, offer, &local.device, |sas| {
            confirm(task.clone(), sas)
        })
        .await?;
        Ok(())
    });
    Ok(())
}

/// This device joins the group of the member that shows `code`.
pub async fn start_joining(app: &AppHandle, code: &str) -> Result<()> {
    let offer = read_offer(code.trim())?;
    let local = local(app).await?;
    ensure_unlinked(&local.pool).await?;
    let (task, code) = (app.clone(), code.trim().to_owned());
    start(app, async move {
        let store = ServerStore::connect(&offer.s.u, local.device.clone(), None, None).await?;
        join(
            &local.pool,
            &store,
            &code,
            &local.device,
            local.meta,
            |sas| confirm(task.clone(), sas),
        )
        .await
    });
    Ok(())
}
