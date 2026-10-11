//! Tauri command surface for Flow Local Sync.
//!
//! Thin wrappers over [`crate::sync::session`]: they translate the frontend's requests into
//! [`SyncManager`] calls and surface [`SyncError`] as the app's standard [`ErrorResponse`]. All
//! progress is pushed to the UI via the `sync://status` / `sync://refresh` events (see
//! `session.rs`); these commands are request/response only.

use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::errors::ErrorResponse;
use crate::sync::canonical::Collection;
use crate::sync::error::SyncError;
use crate::sync::ledger;
use crate::sync::session::{HostStartInfo, SyncManager, SyncStatus};

fn err(e: SyncError) -> ErrorResponse {
    ErrorResponse {
        message: e.to_string(),
        kind: e.kind().to_string(),
    }
}

/// Map a wire collection key (e.g. `"watch_history"`) to its [`Collection`]; unknown keys are
/// dropped (defends against a stale frontend).
fn parse_collections(keys: &[String]) -> Vec<Collection> {
    Collection::ALL
        .into_iter()
        .filter(|c| keys.iter().any(|k| k == c.key()))
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
}

/// This device's stable sync identity (created on first call).
#[tauri::command]
pub async fn sync_device_info(pool: State<'_, SqlitePool>) -> Result<DeviceInfo, ErrorResponse> {
    let device_id = ledger::get_or_create_device_id(&pool).await.map_err(err)?;
    let device_name = ledger::device_name(&pool).await.map_err(err)?;
    Ok(DeviceInfo {
        device_id,
        device_name,
    })
}

/// Current session status (also pushed live via the `sync://status` event).
#[tauri::command]
pub async fn sync_status(
    manager: State<'_, Arc<SyncManager>>,
) -> Result<SyncStatus, ErrorResponse> {
    Ok(manager.status().await)
}

/// Start hosting (this device shows a QR and **sends** the chosen collections). Returns the QR
/// payload + 6-digit SAS for the UI to render immediately while the accept/send task runs.
#[tauri::command]
pub async fn sync_start_host(
    collections: Vec<String>,
    app: AppHandle,
    manager: State<'_, Arc<SyncManager>>,
) -> Result<HostStartInfo, ErrorResponse> {
    let selection = parse_collections(&collections);
    if selection.is_empty() {
        return Err(err(SyncError::Protocol(
            "select at least one thing to sync".into(),
        )));
    }
    crate::sync::session::start_host(app, manager.inner().clone(), selection, false)
        .await
        .map_err(err)
}

/// Start hosting to **receive** (this device shows a QR; the other device scans it and **sends**).
/// This lets a camera-less desktop receive without scanning anything.
#[tauri::command]
pub async fn sync_host_receive(
    app: AppHandle,
    manager: State<'_, Arc<SyncManager>>,
) -> Result<HostStartInfo, ErrorResponse> {
    crate::sync::session::start_host(app, manager.inner().clone(), Vec::new(), true)
        .await
        .map_err(err)
}

/// Join a session from a scanned/pasted QR payload (this device **receives** and merges).
#[tauri::command]
pub async fn sync_scan_join(
    qr: String,
    app: AppHandle,
    manager: State<'_, Arc<SyncManager>>,
) -> Result<(), ErrorResponse> {
    crate::sync::session::scan_join(app, manager.inner().clone(), qr)
        .await
        .map_err(err)
}

/// Answer the active consent prompt (the user compared the SAS and tapped Allow/Deny). Returns
/// `true` if a prompt was waiting.
#[tauri::command]
pub async fn sync_respond_consent(
    accept: bool,
    manager: State<'_, Arc<SyncManager>>,
) -> Result<bool, ErrorResponse> {
    Ok(manager.resolve_consent(accept).await)
}

/// Cancel/abort the current session and return to idle.
#[tauri::command]
pub async fn sync_cancel(
    app: AppHandle,
    manager: State<'_, Arc<SyncManager>>,
) -> Result<(), ErrorResponse> {
    manager.reset(&app).await;
    Ok(())
}
