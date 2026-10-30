//! Live messages while the app is open (spec/live.md, Live messages): sealing what this device
//! sends for every transport (the server's live socket and LAN sessions), opening what arrives,
//! and keeping each device's presence and latest `now` for the page.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

use super::actions::{local, open_session};
use super::engine::{EngineError, Result, now_ms};
use super::lan_runtime::nearby;
use super::live_message::{Ability, Answer, DeviceKind, LiveMessage, Now};
use super::live_seal::{LiveKeys, Received};
use super::live_state::{accept_live_seq, consents, next_live_seq};
use super::state::load_group;

/// The devices' presence and what they play, whenever either changes.
pub const EVENT_LIVE: &str = "sync2://live";
/// A `play`, `cmd` or `result` addressed to this device.
pub const EVENT_LIVE_REQUEST: &str = "sync2://live-request";

/// A message for this device to act on, and whether the user must first be asked (spec/live.md,
/// Consent).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    #[serde(flatten)]
    pub received: Received,
    pub ask: bool,
}

/// What this device accepts, and the icon it shows elsewhere.
const PRESENCE: (&[Ability], DeviceKind) = (&[Ability::Play, Ability::Remote], DeviceKind::Desktop);

/// Another device as the live channel knows it.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDevice {
    pub kind: Option<DeviceKind>,
    pub can: Vec<Ability>,
    pub now: Option<Now>,
    /// When `now` arrived, so its position can advance while it plays.
    pub now_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    /// Whether any device can be reached: the server's live socket is open, or a member is on the
    /// LAN.
    pub available: bool,
    pub devices: BTreeMap<String, LiveDevice>,
    /// The devices connected to the server's live socket or met on the LAN.
    pub online: BTreeSet<String>,
}

pub struct LiveHub {
    keys: tokio::sync::Mutex<Option<LiveKeys>>,
    outgoing: broadcast::Sender<Vec<u8>>,
    devices: Mutex<BTreeMap<String, LiveDevice>>,
    /// The server's latest `peers`, or `None` while its live socket is closed.
    server_online: Mutex<Option<BTreeSet<String>>>,
    /// What this device last said it plays, repeated to devices that connect later.
    mine: Mutex<Option<Now>>,
}

impl Default for LiveHub {
    fn default() -> Self {
        Self {
            keys: tokio::sync::Mutex::new(None),
            outgoing: broadcast::channel(64).0,
            devices: Mutex::new(BTreeMap::new()),
            server_online: Mutex::new(None),
            mine: Mutex::new(None),
        }
    }
}

fn hub(app: &AppHandle) -> &LiveHub {
    app.state::<LiveHub>().inner()
}

/// The sealed messages to send, for each transport to forward.
pub fn subscribe(app: &AppHandle) -> broadcast::Receiver<Vec<u8>> {
    hub(app).outgoing.subscribe()
}

/// Drops the keys taken from the last session, after the roster may have changed.
pub async fn forget_keys(app: &AppHandle) {
    *hub(app).keys.lock().await = None;
}

async fn keys(app: &AppHandle) -> Result<(LiveKeys, SqlitePool)> {
    let mut cached = hub(app).keys.lock().await;
    let pool = app.state::<SqlitePool>().inner().clone();
    if let Some(keys) = cached.as_ref() {
        return Ok((keys.clone(), pool));
    }
    let local = local(app).await?;
    let record = load_group(&pool).await?.ok_or(EngineError::NotLinked)?;
    let session = open_session(&pool, &record, &local.device).await?;
    let keys = LiveKeys::of(&session);
    *cached = Some(keys.clone());
    Ok((keys, pool))
}

/// Seals `message` under the next counter and hands it to every transport. Returns the counter,
/// which a `result` names.
pub async fn send(app: &AppHandle, message: &LiveMessage) -> Result<u64> {
    let (keys, pool) = keys(app).await?;
    let seq = next_live_seq(&pool).await?;
    // No transport being open is not an error: the message just reaches nobody.
    let _ = hub(app).outgoing.send(keys.seal(seq, message)?);
    Ok(seq)
}

/// Says this device is here, and what it plays, to devices that just connected.
pub async fn announce(app: &AppHandle) -> Result<()> {
    let (can, kind) = PRESENCE;
    send(
        app,
        &LiveMessage::Presence {
            can: can.to_vec(),
            kind,
        },
    )
    .await?;
    let mine = hub(app).mine.lock().ok().and_then(|mine| mine.clone());
    if let Some(now) = mine {
        send(app, &LiveMessage::Now(now)).await?;
    }
    Ok(())
}

/// The profile link this device syncs, which `now` and `play` name.
async fn own_link(app: &AppHandle) -> Result<Option<String>> {
    let pool = app.state::<SqlitePool>().inner().clone();
    Ok(load_group(&pool)
        .await?
        .map(|record| record.link)
        .filter(|link| !link.is_empty()))
}

/// Sends a `play`, `cmd` or `result` from the player, and returns its counter.
pub async fn send_request(app: &AppHandle, mut message: LiveMessage) -> Result<u64> {
    match &mut message {
        LiveMessage::Play(play) => play.link = own_link(app).await?,
        LiveMessage::Cmd(_) | LiveMessage::Result(_) => {}
        LiveMessage::Presence { .. } | LiveMessage::Now(_) => return Err(EngineError::Unexpected),
    }
    if !message.is_valid() {
        return Err(EngineError::Unexpected);
    }
    send(app, &message).await
}

/// Tells the other devices what this one plays now, in the profile link it syncs.
pub async fn publish_now(app: &AppHandle, mut now: Now) -> Result<()> {
    if now.video.is_some() {
        now.link = own_link(app).await?;
    }
    if let Ok(mut mine) = hub(app).mine.lock() {
        *mine = Some(now.clone());
    }
    send(app, &LiveMessage::Now(now)).await.map(drop)
}

/// Opens a message from any transport and acts on it. A message this device can't open, or
/// has already seen, is dropped.
pub async fn receive(app: &AppHandle, bytes: &[u8]) {
    if let Err(error) = take(app, bytes).await {
        tracing::debug!(target: "flow::sync2", kind = error.kind(), "live message dropped");
    }
}

async fn take(app: &AppHandle, bytes: &[u8]) -> Result<()> {
    let (keys, pool) = keys(app).await?;
    let received = match keys.open(bytes) {
        Ok(received) => received,
        Err(error) => {
            // Another device may already be in a newer epoch, or a new device may have joined.
            forget_keys(app).await;
            return Err(error);
        }
    };
    if !accept_live_seq(&pool, &received.from, received.seq).await? {
        return Ok(());
    }
    let Received { from, message, .. } = &received;
    match message {
        LiveMessage::Presence { can, kind } => update(app, from, |device| {
            device.kind = Some(*kind);
            device.can.clone_from(can);
        }),
        LiveMessage::Now(now) => update(app, from, |device| {
            device.now = now.video.is_some().then(|| now.clone());
            device.now_at_ms = now_ms();
        }),
        _ if message.to() == Some(keys.me().as_str()) => {
            let answer = match message {
                LiveMessage::Result(_) => Some(true),
                _ => consents(&pool).await?.get(from).copied(),
            };
            if answer == Some(false) {
                let declined = Answer {
                    to: from.clone(),
                    reference: received.seq,
                    ok: false,
                    reason: Some("declined".to_owned()),
                };
                send(app, &LiveMessage::Result(declined)).await?;
            } else {
                let request = Request {
                    ask: answer.is_none(),
                    received: received.clone(),
                };
                let _ = app.emit(EVENT_LIVE_REQUEST, &request);
            }
        }
        _ => {}
    }
    Ok(())
}

fn update(app: &AppHandle, did: &str, change: impl FnOnce(&mut LiveDevice)) {
    if let Ok(mut devices) = hub(app).devices.lock() {
        change(devices.entry(did.to_owned()).or_default());
    }
    changed(app);
}

/// Records which devices the server says are connected; `None` once its socket closed.
pub fn set_server_online(app: &AppHandle, online: Option<BTreeSet<String>>) {
    if let Ok(mut server) = hub(app).server_online.lock() {
        *server = online;
    }
    changed(app);
}

pub fn status(app: &AppHandle) -> LiveStatus {
    let server = hub(app)
        .server_online
        .lock()
        .ok()
        .and_then(|online| online.clone());
    let lan = nearby(app);
    let available = server.is_some() || !lan.is_empty();
    LiveStatus {
        available,
        devices: hub(app)
            .devices
            .lock()
            .map(|devices| devices.clone())
            .unwrap_or_default(),
        online: server.unwrap_or_default().into_iter().chain(lan).collect(),
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit(EVENT_LIVE, status(app));
}
