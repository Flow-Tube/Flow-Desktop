//! The theme file's commands: where it lives, what it holds, and a watch that
//! repaints Flow when a desktop shell rewrites it.

use crate::errors::{AppError, ErrorResponse};
use crate::services::theme_file::{self, ChangeGate, ThemeFileState};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const THEME_FILE_CHANGED_EVENT: &str = "theme-file://changed";

/// Polling a single file is cheaper than a watcher dependency, survives the
/// rename-over saves template tools use, and runs only while the theme is chosen.
const POLL_INTERVAL: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct ThemeFileWatch {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

fn theme_file_path(app: &AppHandle) -> Result<PathBuf, ErrorResponse> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(theme_file::FILE_NAME))
        .map_err(|error| {
            ErrorResponse::from(AppError::Internal(format!(
                "Could not find Flow's config folder: {error}"
            )))
        })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments.
pub fn theme_file_state(app: AppHandle) -> Result<ThemeFileState, ErrorResponse> {
    Ok(theme_file::read_theme_file(&theme_file_path(&app)?))
}

/// Writes the starter file unless one exists, and returns what is there now.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments.
pub fn create_theme_file(app: AppHandle) -> Result<ThemeFileState, ErrorResponse> {
    let path = theme_file_path(&app)?;
    match theme_file::create_starter(&path) {
        Ok(()) => tracing::info!("theme file created"),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(AppError::from(error).into()),
    }
    Ok(theme_file::read_theme_file(&path))
}

/// Shows the file in the file manager, or its folder when there is no file yet.
#[tauri::command]
pub async fn reveal_theme_file(app: AppHandle) -> Result<(), ErrorResponse> {
    let path = theme_file_path(&app)?;
    if path.exists() {
        return Ok(super::external::reveal_file(&app, &path).await?);
    }
    let Some(dir) = path.parent() else {
        return Err(AppError::Internal("The theme file has no folder".into()).into());
    };
    std::fs::create_dir_all(dir).map_err(AppError::from)?;
    Ok(super::external::open_folder(&app, dir).await?)
}

/// Starts or stops sending `theme-file://changed` with the file's new state
/// whenever it changes on disk.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned State.
pub fn watch_theme_file(
    app: AppHandle,
    watch: State<'_, ThemeFileWatch>,
    enabled: bool,
) -> Result<(), ErrorResponse> {
    let mut slot = watch.task.lock().map_err(|error| {
        ErrorResponse::from(AppError::Internal(format!(
            "Theme file watch lock failed: {error}"
        )))
    })?;
    if let Some(task) = slot.take() {
        task.abort();
    }
    if !enabled {
        return Ok(());
    }
    let path = theme_file_path(&app)?;
    *slot = Some(tauri::async_runtime::spawn(async move {
        let mut gate = ChangeGate::new(theme_file::fingerprint(&path));
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if !gate.observe(theme_file::fingerprint(&path)) {
                continue;
            }
            let state = theme_file::read_theme_file(&path);
            tracing::debug!(status = ?state.status, "theme file changed");
            if let Err(error) = app.emit(THEME_FILE_CHANGED_EVENT, &state) {
                tracing::warn!(error = %error, "theme file change not sent");
            }
        }
    }));
    Ok(())
}
