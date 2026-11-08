//! Live messages for the player and the Linked devices page: what this device plays, what the
//! others play, and which devices may control this one.

use std::collections::BTreeMap;

use tauri::AppHandle;

use super::linked::err;
use crate::errors::ErrorResponse;
use crate::sync2::actions::state_pool;
use crate::sync2::live_hub::{self, LiveStatus};
use crate::sync2::live_message::{LiveMessage, Now};
use crate::sync2::live_state;

/// Tells the other devices what this one plays now.
#[tauri::command]
pub async fn live_now(app: AppHandle, now: Now) -> Result<(), ErrorResponse> {
    live_hub::publish_now(&app, now).await.map_err(|e| err(&e))
}

/// Sends a `play`, `cmd` or `result`, and returns its counter, which the answer names.
#[tauri::command]
pub async fn live_send(app: AppHandle, message: LiveMessage) -> Result<u64, ErrorResponse> {
    live_hub::send_request(&app, message)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn live_status(app: AppHandle) -> LiveStatus {
    live_hub::status(&app)
}

/// The remembered answers by device: `true` to allow always, `false` to decline.
#[tauri::command]
pub async fn live_consents(app: AppHandle) -> Result<BTreeMap<String, bool>, ErrorResponse> {
    live_state::consents(&state_pool(&app))
        .await
        .map_err(|e| err(&e.into()))
}

/// Remembers whether `did` may control this device, or forgets it so it is asked again.
#[tauri::command]
pub async fn live_set_consent(
    app: AppHandle,
    did: String,
    allowed: Option<bool>,
) -> Result<(), ErrorResponse> {
    live_state::set_consent(&state_pool(&app), &did, allowed)
        .await
        .map_err(|e| err(&e.into()))
}
