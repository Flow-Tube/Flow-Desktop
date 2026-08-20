//! Session orchestration for Flow Local Sync — the bridge between the `FLOW-SYNC/1` protocol
//! drivers ([`protocol`](crate::sync::protocol)) and the Tauri app (DB, resident brains, UI).
//!
//! One [`SyncManager`] is held in Tauri state. It runs **one session at a time**: either *hosting*
//! (this device shows a QR and **sends**) or *joining* (this device scans a QR and **receives**).
//! Each session runs in a spawned task; the task pushes [`SyncStatus`] updates to the UI via the
//! `sync://status` event and, when it needs the user's go-ahead, parks on an interactive consent
//! gate that the frontend answers with [`resolve_consent`](SyncManager::resolve_consent).
//!
//! Receive-side coordination: before applying we
//! **flush** the resident FlowNeuro/Music brains to the DB so the merge folds in the freshest
//! learning; after applying we **reload** them so the next debounced flush can't clobber the merge;
//! then we emit `sync://refresh` so the Zustand-cached frontend stores (likes/playlists/settings)
//! reload.

#![allow(clippy::too_many_arguments)]

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, oneshot};
use tokio::time::timeout;

use crate::music_brain::store::MusicBrainStore;
use crate::services::music_service::MusicService;
use crate::services::recommendation_service::RecommendationService;
use crate::sync::PROTOCOL_VERSION;
use crate::sync::apply;
use crate::sync::canonical::Collection;
use crate::sync::crypto::{
    Role, SessionCipher, compute_sas, generate_master_secret, generate_session_id, key_fingerprints,
};
use crate::sync::error::SyncError;
use crate::sync::export;
use crate::sync::frames::{CapabilitiesFrame, Capability, HelloFrame, ManifestFrame, Platform};
use crate::sync::ledger;
use crate::sync::protocol::{
    ClientOutcome, HostOutcome, OutgoingCollection, run_client_sender, run_host_receiver,
    run_receiver, run_sender,
};
use crate::sync::qr::QrPayload;
use crate::sync::transport;
use serde_json::Value;

/// Per-collection schema version this build advertises in its capabilities.
const CAP_SCHEMA: i32 = 1;
/// How long the QR / host listener stays open waiting for a peer.
const HOST_TTL: Duration = Duration::from_secs(180);
/// How long to wait for the TCP/WebSocket connect when joining.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// How long a consent prompt waits for the user before auto-declining.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(180);

/// The `sync://status` event name (full status snapshot on every change).
pub const EVENT_STATUS: &str = "sync://status";
/// The `sync://refresh` event name (collections whose local store should reload after a merge).
pub const EVENT_REFRESH: &str = "sync://refresh";

// --------------------------------------------------------------------------------------------
// Serializable status model (mirrored by the frontend `useSyncStore`)
// --------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInfo {
    pub collection: String,
    pub record_count: u64,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatInfo {
    pub collection: String,
    pub added: u64,
    pub updated: u64,
    pub skipped: u64,
    pub tombstoned: u64,
}

/// A flat status snapshot the UI renders directly. `phase` drives the screen; the optional fields
/// carry whatever that phase needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// `idle` | `hosting` | `connecting` | `awaitingConsent` | `transferring` | `completed`
    /// | `declined` | `error`.
    pub phase: String,
    pub role: Option<String>, // "host" | "client"
    pub message: Option<String>,
    pub sas: Option<String>,
    pub peer: Option<PeerInfo>,
    /// For `awaitingConsent`: `hostAllow` (sender approves the peer) or `clientMerge` (receiver
    /// approves the incoming merge).
    pub consent_kind: Option<String>,
    pub manifests: Option<Vec<ManifestInfo>>,
    pub stats: Option<Vec<StatInfo>>,
    pub expires_at: Option<u64>,
    pub device_name: Option<String>,
}

impl SyncStatus {
    fn idle() -> Self {
        Self {
            phase: "idle".into(),
            role: None,
            message: None,
            sas: None,
            peer: None,
            consent_kind: None,
            manifests: None,
            stats: None,
            expires_at: None,
            device_name: None,
        }
    }

    fn simple(phase: &str, role: Option<&str>) -> Self {
        Self {
            phase: phase.into(),
            role: role.map(String::from),
            ..Self::idle()
        }
    }

    fn error(msg: impl Into<String>, role: Option<&str>) -> Self {
        Self {
            phase: "error".into(),
            role: role.map(String::from),
            message: Some(msg.into()),
            ..Self::idle()
        }
    }
}

/// What `start_host` returns to the UI so it can render the QR + SAS immediately.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStartInfo {
    pub qr: String,
    pub sas: String,
    pub ip: String,
    pub port: u16,
    pub expires_at: u64,
    pub device_name: String,
    /// True when this host will **receive** (the QR carries `role:"receiver"`, so the scanner sends).
    pub receive: bool,
}

// --------------------------------------------------------------------------------------------
// SyncManager
// --------------------------------------------------------------------------------------------

#[derive(Default)]
struct Inner {
    status: SyncStatus,
    consent_tx: Option<oneshot::Sender<bool>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        SyncStatus::idle()
    }
}

pub struct SyncManager {
    inner: Mutex<Inner>,
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
        }
    }

    pub async fn status(&self) -> SyncStatus {
        self.inner.lock().await.status.clone()
    }

    /// True while a session is mid-flight (a new one would collide).
    async fn is_busy(&self) -> bool {
        matches!(
            self.inner.lock().await.status.phase.as_str(),
            "hosting" | "connecting" | "awaitingConsent" | "transferring"
        )
    }

    /// Abort any running session, drop a pending consent, and return to idle (emitting the change).
    pub async fn reset(&self, app: &AppHandle) {
        {
            let mut g = self.inner.lock().await;
            if let Some(handle) = g.task.take() {
                handle.abort();
            }
            g.consent_tx = None;
            g.status = SyncStatus::idle();
        }
        self.emit(app).await;
    }

    /// Answer the currently-armed consent prompt. Returns `false` if nothing was waiting.
    pub async fn resolve_consent(&self, accept: bool) -> bool {
        let tx = self.inner.lock().await.consent_tx.take();
        match tx {
            Some(tx) => tx.send(accept).is_ok(),
            None => false,
        }
    }

    async fn set_status(&self, app: &AppHandle, status: SyncStatus) {
        self.inner.lock().await.status = status;
        self.emit(app).await;
    }

    async fn set_task(&self, handle: tauri::async_runtime::JoinHandle<()>) {
        let mut g = self.inner.lock().await;
        if let Some(prev) = g.task.replace(handle) {
            prev.abort();
        }
    }

    async fn emit(&self, app: &AppHandle) {
        let status = self.inner.lock().await.status.clone();
        let _ = app.emit(EVENT_STATUS, status);
    }

    /// Park on an interactive consent gate: publish an `awaitingConsent` status and await the
    /// frontend's answer (auto-declining after [`CONSENT_TIMEOUT`]).
    async fn request_consent(&self, app: &AppHandle, status: SyncStatus) -> bool {
        let rx = {
            let mut g = self.inner.lock().await;
            let (tx, rx) = oneshot::channel();
            g.consent_tx = Some(tx);
            g.status = status;
            rx
        };
        self.emit(app).await;
        matches!(timeout(CONSENT_TIMEOUT, rx).await, Ok(Ok(true)))
    }
}

// --------------------------------------------------------------------------------------------
// Identity / capability helpers
// --------------------------------------------------------------------------------------------

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn our_hello(device_id: &str, device_name: &str) -> HelloFrame {
    HelloFrame {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        platform: Platform::Desktop,
        app_version: app_version(),
        protocol: PROTOCOL_VERSION,
    }
}

/// What the desktop can produce/consume. Subscriptions are neither (no desktop table).
pub fn desktop_capabilities() -> CapabilitiesFrame {
    let mut collections = BTreeMap::new();
    for c in Collection::ALL {
        // The desktop produces and consumes every collection.
        collections.insert(
            c.key().to_string(),
            Capability {
                schema: CAP_SCHEMA,
                produce: true,
                consume: true,
            },
        );
    }
    CapabilitiesFrame { collections }
}

fn platform_str(p: Platform) -> String {
    match p {
        Platform::Desktop => "desktop",
        Platform::Android => "android",
        Platform::Ios => "ios",
        Platform::Web => "web",
    }
    .to_string()
}

fn peer_info(h: &HelloFrame) -> PeerInfo {
    PeerInfo {
        device_id: h.device_id.clone(),
        device_name: h.device_name.clone(),
        platform: platform_str(h.platform),
        app_version: h.app_version.clone(),
    }
}

fn manifest_infos(m: &ManifestFrame) -> Vec<ManifestInfo> {
    m.collections
        .iter()
        .map(|(name, entry)| ManifestInfo {
            collection: name.clone(),
            record_count: entry.records,
            byte_size: entry.bytes,
        })
        .collect()
}

fn now_s() -> u64 {
    chrono::Utc::now().timestamp().max(0) as u64
}

// --------------------------------------------------------------------------------------------
// Resident-brain flush / reload around apply
// --------------------------------------------------------------------------------------------

async fn flush_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>() {
        if let Err(e) = svc.flush_brain().await {
            tracing::warn!(%e, "[sync] flush flow_neuro brain before merge failed");
        }
    }
    if let Some(store) = app.try_state::<Arc<MusicBrainStore>>() {
        if let Err(e) = store.flush().await {
            tracing::warn!(%e, "[sync] flush music brain before merge failed");
        }
    }
}

async fn reload_brains(app: &AppHandle) {
    if let Some(svc) = app.try_state::<RecommendationService>() {
        if let Err(e) = svc.reload_brain().await {
            tracing::warn!(%e, "[sync] reload flow_neuro brain after merge failed");
        }
    }
    if let Some(store) = app.try_state::<Arc<MusicBrainStore>>() {
        if let Err(e) = store.reload().await {
            tracing::warn!(%e, "[sync] reload music brain after merge failed");
        }
    }
}

fn pool_of(app: &AppHandle) -> SqlitePool {
    app.state::<SqlitePool>().inner().clone()
}

async fn enrich_outgoing_albums(app: &AppHandle, outgoing: &mut [OutgoingCollection]) {
    let Some(pl) = outgoing
        .iter_mut()
        .find(|o| o.collection == Collection::Playlists)
    else {
        return;
    };
    let browse_ids = export::album_browse_ids_missing_tracks(&pl.ndjson);
    if browse_ids.is_empty() {
        return;
    }
    let Some(music) = app.try_state::<MusicService>() else {
        return;
    };
    let mut tracks: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for id in browse_ids {
        match music.album(&id).await {
            Ok(page) => {
                let cover = page.album.thumbnail.clone();
                let songs: Vec<Value> = page
                    .songs
                    .iter()
                    .filter_map(|s| {
                        let mut v = serde_json::to_value(s).ok()?;
                        if !cover.is_empty() {
                            if let Some(obj) = v.as_object_mut() {
                                let has = obj
                                    .get("thumbnail")
                                    .and_then(Value::as_str)
                                    .is_some_and(|t| !t.is_empty());
                                if !has {
                                    obj.insert(
                                        "thumbnail".to_string(),
                                        Value::String(cover.clone()),
                                    );
                                }
                            }
                        }
                        Some(v)
                    })
                    .collect();
                if !songs.is_empty() {
                    tracks.insert(id, songs);
                }
            }
            Err(error) => {
                tracing::warn!(target: "flow::sync::session", album = %id, %error, "album track fetch failed; album sent without tracks");
            }
        }
    }
    if !tracks.is_empty() {
        pl.ndjson = export::fill_album_tracks(&pl.ndjson, &tracks);
    }
}

// --------------------------------------------------------------------------------------------
// Host (sender) entry + task
// --------------------------------------------------------------------------------------------

/// Begin hosting: bind a port, mint session material, publish `hosting` status, and spawn the
/// accept task. Returns the QR/SAS for the UI to render immediately.
///
/// `receive = false` ⇒ this host **sends** `selection` (the scanner receives). `receive = true` ⇒
/// this host **receives** (the QR is `role:"receiver"`, the scanner sends) — this is how a
/// camera-less desktop receives; `selection` is ignored.
pub async fn start_host(
    app: AppHandle,
    manager: Arc<SyncManager>,
    selection: Vec<Collection>,
    receive: bool,
) -> Result<HostStartInfo, SyncError> {
    if manager.is_busy().await {
        return Err(SyncError::Protocol(
            "a sync session is already active".into(),
        ));
    }

    let pool = pool_of(&app);
    let device_id = ledger::get_or_create_device_id(&pool).await?;
    let device_name = ledger::device_name(&pool).await?;

    let master = generate_master_secret();
    let session_id = generate_session_id();
    let sas = compute_sas(&master, &session_id);

    let (listener, port) = transport::bind().await?;
    // Log every candidate, not just the winner: when a pairing fails with "connection error" and no
    // inbound TCP on this side, the address we advertised is the first thing to check (issue #41).
    let candidates = transport::lan_ip_candidates();
    tracing::info!(
        target: "flow::sync::session",
        candidates = ?candidates.iter().map(|c| format!("{}={}{}", c.interface, c.ip, if c.virtual_iface { " (virtual)" } else { "" })).collect::<Vec<_>>(),
        "LAN address candidates, best first"
    );
    let ip = candidates.into_iter().next().map(|c| c.ip).ok_or_else(|| {
        SyncError::Transport("no usable LAN IPv4 address found (are you on Wi-Fi/LAN?)".into())
    })?;
    let expires_at = now_s() + HOST_TTL.as_secs();
    let qr = if receive {
        QrPayload::new_receiving(
            &session_id,
            &master,
            ip.clone(),
            port,
            &device_name,
            expires_at,
        )
    } else {
        QrPayload::new(
            &session_id,
            &master,
            ip.clone(),
            port,
            &device_name,
            expires_at,
        )
    }
    .to_json();

    let (h2c_fp, c2h_fp) = key_fingerprints(&master, &session_id);
    tracing::info!(
        target: "flow::sync::session", role = "host", receive, ip = %ip, port, sas = %sas,
        key_h2c = %h2c_fp, key_c2h = %c2h_fp, expires_at,
        "hosting armed — compare SAS + key fingerprints with the other device's log if it fails"
    );

    manager
        .set_status(
            &app,
            SyncStatus {
                phase: "hosting".into(),
                role: Some("host".into()),
                sas: Some(sas.clone()),
                expires_at: Some(expires_at),
                device_name: Some(device_name.clone()),
                message: Some(if receive {
                    "Scan this on the other device, then pick what to send to this PC.".into()
                } else {
                    "Scan this on the other device to receive your data.".into()
                }),
                ..SyncStatus::idle()
            },
        )
        .await;

    let task = {
        let app = app.clone();
        let manager = manager.clone();
        let sas = sas.clone();
        let device_name = device_name.clone();
        tauri::async_runtime::spawn(async move {
            if receive {
                if let Err(e) =
                    host_receive_session(&app, &manager, listener, master, session_id, &device_id)
                        .await
                {
                    tracing::error!(target: "flow::sync::session", role = "host-receiver", "session failed: {e}");
                    manager
                        .set_status(&app, SyncStatus::error(e.to_string(), Some("host")))
                        .await;
                }
            } else {
                host_session(
                    app,
                    manager,
                    listener,
                    master,
                    session_id,
                    selection,
                    device_id,
                    device_name,
                    sas,
                )
                .await;
            }
        })
    };
    manager.set_task(task).await;

    Ok(HostStartInfo {
        qr,
        sas,
        ip,
        port,
        expires_at,
        device_name,
        receive,
    })
}

/// Host that **receives**: accept the scanner's connection, run the receive choreography (with the
/// merge-consent gate), then apply.
async fn host_receive_session(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    listener: tokio::net::TcpListener,
    master: crate::sync::crypto::MasterSecret,
    session_id: crate::sync::crypto::SessionId,
    device_id: &str,
) -> Result<(), SyncError> {
    let ch = match timeout(HOST_TTL, transport::accept(&listener)).await {
        Ok(ch) => ch?,
        Err(_) => {
            manager
                .set_status(
                    app,
                    SyncStatus::error("timed out waiting for a device to connect", Some("host")),
                )
                .await;
            return Ok(());
        }
    };

    let sas = compute_sas(&master, &session_id);
    let cipher = SessionCipher::new(&master, session_id, Role::Host);
    let device_name = ledger::device_name(&pool_of(app)).await?;
    let hello = our_hello(device_id, &device_name);
    let caps = desktop_capabilities();

    let outcome = run_host_receiver(
        ch,
        cipher,
        hello,
        caps,
        true,
        merge_consent(app, manager, sas, "host"),
    )
    .await?;

    finish_receive(app, manager, "host", &pool_of(app), device_id, outcome).await
}

async fn host_session(
    app: AppHandle,
    manager: Arc<SyncManager>,
    listener: tokio::net::TcpListener,
    master: crate::sync::crypto::MasterSecret,
    session_id: crate::sync::crypto::SessionId,
    selection: Vec<Collection>,
    device_id: String,
    device_name: String,
    sas: String,
) {
    // Send the freshest data: flush the resident brains to the DB before exporting them.
    flush_brains(&app).await;

    let result = host_run(
        &app,
        &manager,
        listener,
        master,
        session_id,
        &selection,
        &device_id,
        &device_name,
        sas,
    )
    .await;

    if let Err(e) = result {
        tracing::error!(target: "flow::sync::session", role = "host", "session failed: {e}");
        manager
            .set_status(&app, SyncStatus::error(e.to_string(), Some("host")))
            .await;
    }
}

async fn host_run(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    listener: tokio::net::TcpListener,
    master: crate::sync::crypto::MasterSecret,
    session_id: crate::sync::crypto::SessionId,
    selection: &[Collection],
    device_id: &str,
    device_name: &str,
    sas: String,
) -> Result<(), SyncError> {
    let ch = match timeout(HOST_TTL, transport::accept(&listener)).await {
        Ok(ch) => ch?,
        Err(_) => {
            manager
                .set_status(
                    app,
                    SyncStatus::error("timed out waiting for a device to connect", Some("host")),
                )
                .await;
            return Ok(());
        }
    };

    let cipher = SessionCipher::new(&master, session_id, Role::Host);
    let pool = pool_of(app);
    let mut outgoing = export::export_collections(&pool, device_id, selection).await?;
    enrich_outgoing_albums(app, &mut outgoing).await;
    let hello = our_hello(device_id, device_name);
    let caps = desktop_capabilities();

    // The host shows the SAS on its screen for the user to verify; the receiver is the consent
    // gate (one-way consent). We surface "waiting for the other device to accept".
    manager
        .set_status(
            app,
            SyncStatus {
                phase: "transferring".into(),
                role: Some("host".into()),
                sas: Some(sas.clone()),
                message: Some("Waiting for the other device to accept…".into()),
                ..SyncStatus::idle()
            },
        )
        .await;

    let outcome = run_sender(ch, cipher, hello, caps, outgoing, selection.to_vec(), true).await?;
    finish_send(app, manager, "host", &pool, outcome).await
}

// --------------------------------------------------------------------------------------------
// Client (receiver) entry + task
// --------------------------------------------------------------------------------------------

/// Begin joining from a scanned/pasted QR payload: validate it, publish `connecting`, and spawn the
/// connect task. The QR's `role` field decides the direction: a normal QR ⇒ we **receive**; a
/// `role:"receiver"` QR (the host wants to receive) ⇒ we **send**.
pub async fn scan_join(
    app: AppHandle,
    manager: Arc<SyncManager>,
    qr_text: String,
) -> Result<(), SyncError> {
    if manager.is_busy().await {
        return Err(SyncError::Protocol(
            "a sync session is already active".into(),
        ));
    }
    let payload = QrPayload::from_json(&qr_text)?;
    if payload.is_expired(now_s()) {
        return Err(SyncError::Protocol(
            "this sync code has expired — generate a new one".into(),
        ));
    }

    manager
        .set_status(&app, SyncStatus::simple("connecting", Some("client")))
        .await;

    let task = {
        let app = app.clone();
        let manager = manager.clone();
        tauri::async_runtime::spawn(async move {
            let res = if payload.host_receives() {
                client_send_session(&app, &manager, payload).await
            } else {
                client_recv_session(&app, &manager, payload).await
            };
            if let Err(e) = res {
                tracing::error!(target: "flow::sync::session", role = "client", "session failed: {e}");
                manager
                    .set_status(&app, SyncStatus::error(e.to_string(), Some("client")))
                    .await;
            }
        })
    };
    manager.set_task(task).await;
    Ok(())
}

/// Connect as the WebSocket client and **receive** (the host is sending).
async fn client_recv_session(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    payload: QrPayload,
) -> Result<(), SyncError> {
    let master = payload.master()?;
    let session_id = payload.session_id()?;
    let sas = compute_sas(&master, &session_id);

    let (h2c_fp, c2h_fp) = key_fingerprints(&master, &session_id);
    tracing::info!(
        target: "flow::sync::session", role = "client", ip = %payload.ip, port = payload.p,
        sas = %sas, key_h2c = %h2c_fp, key_c2h = %c2h_fp,
        "joining to receive — SAS + key fingerprints should match the host's log"
    );

    let pool = pool_of(app);
    let device_id = ledger::get_or_create_device_id(&pool).await?;
    let device_name = ledger::device_name(&pool).await?;

    let ch = match timeout(CONNECT_TIMEOUT, transport::connect(&payload.ip, payload.p)).await {
        Ok(ch) => ch?,
        Err(_) => return Err(SyncError::Transport("connection timed out".into())),
    };
    let cipher = SessionCipher::new(&master, session_id, Role::Client);
    let hello = our_hello(&device_id, &device_name);
    let caps = desktop_capabilities();

    let outcome = run_receiver(
        ch,
        cipher,
        hello,
        caps,
        merge_consent(app, manager, sas, "client"),
    )
    .await?;

    finish_receive(app, manager, "client", &pool, &device_id, outcome).await
}

/// Connect as the WebSocket client and **send** (we scanned a `role:"receiver"` QR — the host wants our
/// data). We offer everything this device can produce; the host consents to the merge on its end.
async fn client_send_session(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    payload: QrPayload,
) -> Result<(), SyncError> {
    let master = payload.master()?;
    let session_id = payload.session_id()?;
    let sas = compute_sas(&master, &session_id);
    let (h2c_fp, c2h_fp) = key_fingerprints(&master, &session_id);
    tracing::info!(
        target: "flow::sync::session", role = "client-sender", ip = %payload.ip, port = payload.p,
        sas = %sas, key_h2c = %h2c_fp, key_c2h = %c2h_fp,
        "joining to send (host wants to receive) — verify the SAS matches the other device"
    );

    let pool = pool_of(app);
    let device_id = ledger::get_or_create_device_id(&pool).await?;
    let device_name = ledger::device_name(&pool).await?;

    // Send the freshest data: flush resident brains before exporting.
    flush_brains(app).await;
    let selection = producible_collections();
    let mut outgoing = export::export_collections(&pool, &device_id, &selection).await?;
    enrich_outgoing_albums(app, &mut outgoing).await;

    let ch = match timeout(CONNECT_TIMEOUT, transport::connect(&payload.ip, payload.p)).await {
        Ok(ch) => ch?,
        Err(_) => return Err(SyncError::Transport("connection timed out".into())),
    };
    let cipher = SessionCipher::new(&master, session_id, Role::Client);
    let hello = our_hello(&device_id, &device_name);
    let caps = desktop_capabilities();

    manager
        .set_status(
            app,
            SyncStatus {
                phase: "transferring".into(),
                role: Some("client".into()),
                sas: Some(sas),
                message: Some("Waiting for the other device to accept…".into()),
                ..SyncStatus::idle()
            },
        )
        .await;

    let outcome = run_client_sender(ch, cipher, hello, caps, outgoing, selection).await?;
    finish_send(app, manager, "client", &pool, outcome).await
}

/// Build the receiver-side merge-consent callback (publishes `awaitingConsent` and parks on it).
fn merge_consent(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    sas: String,
    role: &'static str,
) -> impl FnOnce(
    HelloFrame,
    ManifestFrame,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send>> {
    let app = app.clone();
    let manager = manager.clone();
    move |peer: HelloFrame, manifest: ManifestFrame| {
        let app = app.clone();
        let manager = manager.clone();
        let sas = sas.clone();
        Box::pin(async move {
            let accepted = manager
                .request_consent(
                    &app,
                    SyncStatus {
                        phase: "awaitingConsent".into(),
                        role: Some(role.to_string()),
                        consent_kind: Some("clientMerge".into()),
                        peer: Some(peer_info(&peer)),
                        sas: Some(sas),
                        manifests: Some(manifest_infos(&manifest)),
                        ..SyncStatus::idle()
                    },
                )
                .await;
            if accepted {
                manager
                    .set_status(&app, SyncStatus::simple("transferring", Some(role)))
                    .await;
            }
            accepted
        })
    }
}

/// Shared apply pipeline for any receive (scan-receive or host-receive): consent already handled by
/// the protocol; here we flush brains → atomic merge → reload brains → backup → peer → refresh UI.
async fn finish_receive(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    role: &'static str,
    pool: &SqlitePool,
    device_id: &str,
    outcome: ClientOutcome,
) -> Result<(), SyncError> {
    let received = match outcome {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => {
            manager
                .set_status(app, SyncStatus::simple("declined", Some(role)))
                .await;
            return Ok(());
        }
    };

    manager
        .set_status(app, SyncStatus::simple("transferring", Some(role)))
        .await;

    flush_brains(app).await;
    let report = apply::apply_payload(
        pool,
        device_id,
        &received.peer.device_id,
        &received.collections,
    )
    .await?;
    reload_brains(app).await;
    for s in &report.stats {
        tracing::info!(
            target: "flow::sync::session", role, collection = %s.collection_key,
            added = s.added, updated = s.updated, skipped = s.skipped, tombstoned = s.tombstoned,
            "merged collection"
        );
    }

    let _ = crate::db::settings::set_setting(pool, "sync_last_backup", &report.backup).await;
    ledger::upsert_peer(
        pool,
        &received.peer.device_id,
        &received.peer.device_name,
        &platform_str(received.peer.platform),
    )
    .await?;

    let collections: Vec<String> = received
        .collections
        .iter()
        .map(|c| c.collection.key().to_string())
        .collect();
    let _ = app.emit(EVENT_REFRESH, collections);

    let stats = report
        .stats
        .iter()
        .map(|s| StatInfo {
            collection: s.collection_key.clone(),
            added: s.added,
            updated: s.updated,
            skipped: s.skipped,
            tombstoned: s.tombstoned,
        })
        .collect();
    manager
        .set_status(
            app,
            SyncStatus {
                phase: "completed".into(),
                role: Some(role.to_string()),
                peer: Some(peer_info(&received.peer)),
                stats: Some(stats),
                ..SyncStatus::idle()
            },
        )
        .await;
    Ok(())
}

/// Shared completion for any send (host-send or client-send): record the peer + report stats.
async fn finish_send(
    app: &AppHandle,
    manager: &Arc<SyncManager>,
    role: &'static str,
    pool: &SqlitePool,
    outcome: HostOutcome,
) -> Result<(), SyncError> {
    match outcome {
        HostOutcome::Completed(send) => {
            ledger::upsert_peer(
                pool,
                &send.peer.device_id,
                &send.peer.device_name,
                &platform_str(send.peer.platform),
            )
            .await?;
            let stats = send
                .results
                .collections
                .iter()
                .map(|(name, e)| StatInfo {
                    collection: name.clone(),
                    added: e.added,
                    updated: e.updated,
                    skipped: e.skipped,
                    tombstoned: e.tombstoned,
                })
                .collect();
            manager
                .set_status(
                    app,
                    SyncStatus {
                        phase: "completed".into(),
                        role: Some(role.to_string()),
                        peer: Some(peer_info(&send.peer)),
                        stats: Some(stats),
                        ..SyncStatus::idle()
                    },
                )
                .await;
        }
        HostOutcome::Declined => {
            manager
                .set_status(app, SyncStatus::simple("declined", Some(role)))
                .await;
        }
    }
    Ok(())
}

/// Every collection this desktop can produce (all except subscriptions, which has no table).
fn producible_collections() -> Vec<Collection> {
    Collection::ALL
        .into_iter()
        .filter(|c| !matches!(c, Collection::Subscriptions))
        .collect()
}
