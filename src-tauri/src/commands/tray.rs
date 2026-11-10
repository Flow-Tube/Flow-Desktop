use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::errors::{AppError, ErrorResponse};
use crate::services::music_tray::{MusicTray, TrayUpdate};
use crate::services::shell_pages::{LaunchRequest, ShellLabels};

/// Whether the system can show tray icons (false on Linux without an `AppIndicator` library).
#[tauri::command]
pub async fn music_tray_supported() -> bool {
    MusicTray::supported()
}

/// Report what this window plays, for the tray to show.
#[tauri::command]
pub async fn music_tray_update(
    app: AppHandle,
    window: WebviewWindow,
    update: TrayUpdate,
    tray: State<'_, MusicTray>,
) -> Result<(), ErrorResponse> {
    tray.update(&app, window.label(), update)
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

/// Fill in the Dock menu or the Jump List, in the UI language. Nothing to do on Linux, whose
/// desktop files list their actions when installed.
#[tauri::command]
pub async fn set_shell_pages(app: AppHandle, labels: ShellLabels) -> Result<(), ErrorResponse> {
    #[cfg(windows)]
    {
        let _ = app;
        crate::services::jump_list::set(labels);
    }
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || crate::macos_dock::install(&handle, &labels))
            .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = (app, labels);
    Ok(())
}

/// The page this launch was asked to open, once.
#[tauri::command]
#[must_use]
pub fn take_launch_page(request: State<'_, LaunchRequest>) -> Option<&'static str> {
    request.take_page()
}

/// The `flow://open` link for a URL on this launch's command line, once.
#[tauri::command]
#[must_use]
pub fn take_launch_link(request: State<'_, LaunchRequest>) -> Option<String> {
    request.take_link()
}

/// Show download progress on the taskbar or Dock icon. `percent` is null when a size is unknown,
/// and `count` is zero once nothing is running.
#[tauri::command]
pub async fn set_download_progress(
    app: AppHandle,
    percent: Option<u64>,
    count: u32,
    paused: bool,
) -> Result<(), ErrorResponse> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let status = match (count, paused, percent) {
        (0, _, _) => ProgressBarStatus::None,
        (_, true, _) => ProgressBarStatus::Paused,
        (_, false, None) => ProgressBarStatus::Indeterminate,
        (_, false, Some(_)) => ProgressBarStatus::Normal,
    };
    window
        .set_progress_bar(ProgressBarState {
            status: Some(status),
            progress: percent.map(|value| value.min(100)),
        })
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    // Windows has no badge count, and its progress bar says enough.
    #[cfg(not(windows))]
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    Ok(())
}
