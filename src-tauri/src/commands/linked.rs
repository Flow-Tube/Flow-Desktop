//! Tauri commands for Linked devices (FLOW-SYNC/2). Thin wrappers over [`crate::sync2::actions`];
//! pairing progress arrives as `sync2://link` events and finished syncs as `sync2://synced`.

use tauri::AppHandle;

use crate::errors::ErrorResponse;
use crate::sync2::actions::{self, LinkedDevice, LinkedStatus};
use crate::sync2::engine::EngineError;
use crate::sync2::join_requests::JoinRequest;
use crate::sync2::link_task::{self, LinkPhase};
use crate::sync2::profile_actions::{self, LinkedProfiles};
use crate::sync2::service::{self, Received};
use crate::sync2::webdav::WebDavLogin;

pub(crate) fn err(e: &EngineError) -> ErrorResponse {
    ErrorResponse {
        message: e.to_string(),
        kind: e.kind().to_owned(),
        starts_at_ms: None,
    }
}

#[tauri::command]
pub async fn linked_status(app: AppHandle) -> Result<LinkedStatus, ErrorResponse> {
    actions::status(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_devices(app: AppHandle) -> Result<Vec<LinkedDevice>, ErrorResponse> {
    actions::devices(&app).await.map_err(|e| err(&e))
}

/// Returns the recovery words, shown once.
#[tauri::command]
pub async fn linked_create(
    app: AppHandle,
    url: String,
    admin_token: String,
    reset_server: bool,
) -> Result<String, ErrorResponse> {
    actions::create(&app, &url, &admin_token, reset_server)
        .await
        .map_err(|e| err(&e))
}

/// Returns the new recovery words, shown once.
#[tauri::command]
pub async fn linked_restore(
    app: AppHandle,
    url: String,
    words: String,
    login: Option<WebDavLogin>,
) -> Result<String, ErrorResponse> {
    actions::restore(&app, &url, &words, login)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_retry_keychain(app: AppHandle) -> Result<(), ErrorResponse> {
    actions::retry_keychain(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_recovery_saved(app: AppHandle) -> Result<(), ErrorResponse> {
    actions::recovery_saved(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_rename(app: AppHandle, id: String, name: String) -> Result<(), ErrorResponse> {
    actions::rename(&app, &id, &name).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_remove(app: AppHandle, id: String) -> Result<(), ErrorResponse> {
    actions::remove(&app, &id).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_leave(app: AppHandle) -> Result<(), ErrorResponse> {
    actions::leave(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_forget(app: AppHandle) -> Result<(), ErrorResponse> {
    actions::forget(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_sync_now(app: AppHandle) -> Result<Vec<Received>, ErrorResponse> {
    service::sync_now(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_link_phase(app: AppHandle) -> LinkPhase {
    link_task::phase(&app)
}

#[tauri::command]
pub async fn linked_add_device(app: AppHandle) -> Result<(), ErrorResponse> {
    link_task::start_adding(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_create_lan(app: AppHandle) -> Result<String, ErrorResponse> {
    actions::create_on_lan(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_create_webdav(
    app: AppHandle,
    url: String,
    user: String,
    password: String,
) -> Result<String, ErrorResponse> {
    actions::create_on_webdav(&app, &url, &user, &password)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_update_login(
    app: AppHandle,
    user: String,
    password: String,
) -> Result<(), ErrorResponse> {
    actions::update_login(&app, &user, &password)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_ask_to_join(
    app: AppHandle,
    url: String,
    admin_token: String,
) -> Result<(), ErrorResponse> {
    link_task::start_asking(&app, &url, &admin_token)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_join_requests(app: AppHandle) -> Result<Vec<JoinRequest>, ErrorResponse> {
    actions::join_requests(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_accept_join(app: AppHandle, id: String) -> Result<(), ErrorResponse> {
    link_task::start_accepting(&app, id)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_decline_join(app: AppHandle, id: String) -> Result<(), ErrorResponse> {
    actions::decline_join(&app, &id).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_show_code(app: AppHandle) -> Result<(), ErrorResponse> {
    link_task::start_showing(&app).await.map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_enter_code(
    app: AppHandle,
    code: String,
    folder: Option<link_task::FolderAccess>,
) -> Result<(), ErrorResponse> {
    link_task::start_with_code(&app, &code, folder)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_answer(app: AppHandle, accept: bool) {
    link_task::answer(&app, accept);
}

#[tauri::command]
pub async fn linked_cancel(app: AppHandle) {
    link_task::cancel(&app);
}

#[tauri::command]
pub async fn linked_profiles(app: AppHandle) -> Result<LinkedProfiles, ErrorResponse> {
    profile_actions::profiles(&app).await.map_err(|e| err(&e))
}

/// Syncs `profile` under its own link, or joining `link`.
#[tauri::command]
pub async fn linked_sync_profile(
    app: AppHandle,
    profile: String,
    link: Option<String>,
) -> Result<(), ErrorResponse> {
    profile_actions::sync_profile(&app, &profile, link.as_deref())
        .await
        .map_err(|e| err(&e))
}

/// Links `profile`, just created for `link`.
#[tauri::command]
pub async fn linked_sync_added_profile(
    app: AppHandle,
    profile: String,
    link: String,
) -> Result<(), ErrorResponse> {
    profile_actions::sync_added_profile(&app, &profile, &link)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_stop_profile(app: AppHandle, profile: String) -> Result<(), ErrorResponse> {
    profile_actions::stop_profile(&app, &profile)
        .await
        .map_err(|e| err(&e))
}

#[tauri::command]
pub async fn linked_delete_profile(app: AppHandle, link: String) -> Result<(), ErrorResponse> {
    profile_actions::delete_everywhere(&app, &link)
        .await
        .map_err(|e| err(&e))
}

/// A restored device's Default joins `link`, or starts its own when `None`.
#[tauri::command]
pub async fn linked_choose_profile(
    app: AppHandle,
    link: Option<String>,
) -> Result<(), ErrorResponse> {
    profile_actions::choose_for_default(&app, link.as_deref())
        .await
        .map_err(|e| err(&e))
}
