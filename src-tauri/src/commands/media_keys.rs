use tauri::AppHandle;

use crate::errors::{AppError, ErrorResponse};
use crate::services::{media_keys, system_output};

/// Whether this desktop lets an app listen for keys outside its own window.
#[tauri::command]
pub async fn global_media_keys_supported() -> bool {
    media_keys::keys_supported()
}

/// Take or release the keyboard's media keys.
#[tauri::command]
pub async fn global_media_keys_set(app: AppHandle, enabled: bool) -> Result<(), ErrorResponse> {
    let (reply, answer) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = reply.send(media_keys::set_keys_enabled(&handle, enabled));
    })
    .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    answer
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result)
        .map_err(|error| ErrorResponse::from(AppError::Internal(error)))
}

/// Report the system output's silence to the windows, for "Pause music when muted". Returns
/// whether this desktop can report it at all.
#[tauri::command]
pub async fn system_output_watch(app: AppHandle, enabled: bool) -> bool {
    system_output::set_watching(&app, enabled);
    system_output::supported()
}
