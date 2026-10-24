use tauri::{AppHandle, State};

use crate::errors::{AppError, ErrorResponse};
use crate::services::music_tray::{MusicTray, TrayUpdate};

/// Whether the system can show tray icons (false on Linux without an `AppIndicator` library).
#[tauri::command]
pub async fn music_tray_supported() -> bool {
    MusicTray::supported()
}

/// Show the music tray with the current song and play state.
#[tauri::command]
pub async fn music_tray_update(
    app: AppHandle,
    update: TrayUpdate,
    tray: State<'_, MusicTray>,
) -> Result<(), ErrorResponse> {
    tray.update(&app, &update)
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))
}

/// Remove the music tray icon.
#[tauri::command]
pub async fn music_tray_hide(
    app: AppHandle,
    tray: State<'_, MusicTray>,
) -> Result<(), ErrorResponse> {
    tray.hide(&app)
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))
}
