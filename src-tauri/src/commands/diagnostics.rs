//! Frontend → backend diagnostics bridge + log file access for the Diagnostics
//! page.
//!
//! The WebView console is invisible in a packaged build, so uncaught render
//! errors and unhandled promise rejections would otherwise leave no trace. The
//! forwarding command routes them into `tracing`, where they land in the same
//! rolling file log as backend events (see `lib.rs::init_tracing`). Never send
//! secrets through here — the caller controls the payload.

use tauri::Manager;

use crate::errors::{AppError, ErrorResponse};

/// Cap on the number of trailing log lines returned to the UI, so the viewer and
/// the clipboard payload stay bounded even after long sessions.
const MAX_LOG_LINES: usize = 4000;

fn logs_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, ErrorResponse> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(format!("No app data dir: {error}")))?
        .join("logs");
    Ok(dir)
}

fn is_log_file(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("flow") && name.contains("log"))
}

/// Records a frontend diagnostic event in the backend log under the
/// `flow::frontend` target. `level` is one of `error` | `warn` | `info`
/// (anything else is treated as `info`); `context` is an optional JSON blob.
#[tauri::command]
pub fn log_frontend_event(level: String, message: String, context: Option<String>) {
    let context = context.unwrap_or_default();
    match level.as_str() {
        "error" => {
            tracing::error!(target: "flow::frontend", context = %context, message = %message, "frontend_event")
        }
        "warn" => {
            tracing::warn!(target: "flow::frontend", context = %context, message = %message, "frontend_event")
        }
        _ => {
            tracing::info!(target: "flow::frontend", context = %context, message = %message, "frontend_event")
        }
    }
}

/// Returns the tail of the persisted rolling log files (oldest-rolled first, then
/// today's), concatenated and capped to the last `MAX_LOG_LINES` lines. The
/// non-blocking appender buffers writes, so the very latest lines may not appear
/// yet — the frontend augments this with its in-memory event buffer.
#[tauri::command]
pub fn read_logs(app: tauri::AppHandle) -> Result<String, ErrorResponse> {
    let dir = logs_dir(&app)?;
    if !dir.exists() {
        return Ok(String::new());
    }

    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .map_err(AppError::from)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_log_file(path))
        .collect();
    files.sort();

    let mut lines: Vec<String> = Vec::new();
    for path in files {
        if let Ok(contents) = std::fs::read_to_string(&path) {
            lines.extend(contents.lines().map(ToOwned::to_owned));
        }
    }

    if lines.len() > MAX_LOG_LINES {
        lines.drain(0..lines.len() - MAX_LOG_LINES);
    }
    Ok(lines.join("\n"))
}

/// Clears the persisted logs. Rolled files are deleted; the active file (held
/// open in append mode by the running appender, so undeletable on Windows) is
/// truncated instead — safe, since append writes always target end-of-file.
#[tauri::command]
pub fn clear_logs(app: tauri::AppHandle) -> Result<(), ErrorResponse> {
    let dir = logs_dir(&app)?;
    if !dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(&dir)
        .map_err(AppError::from)?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !is_log_file(&path) {
            continue;
        }
        if std::fs::remove_file(&path).is_err() {
            let _ = std::fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn logs_dir_path(app: tauri::AppHandle) -> Result<String, ErrorResponse> {
    let dir = logs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Opens the rolling log directory in the OS file manager. A reliable fallback
/// on Linux/WebKitGTK, where `navigator.clipboard` copy can silently fail — the
/// user can always grab the `flow*.log` files directly and attach them.
#[tauri::command]
pub fn reveal_logs_folder(app: tauri::AppHandle) -> Result<(), ErrorResponse> {
    use tauri_plugin_opener::OpenerExt;
    let dir = logs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| AppError::Internal(format!("Failed to open logs folder: {error}")))?;
    Ok(())
}

/// Signals that the webview mounted and rendered successfully, clearing the
/// Linux startup-crash sentinel so the next launch starts at tier 0 (see
/// `linux_startup`). No-op on other platforms and when the sentinel is absent.
#[tauri::command]
pub fn startup_render_ok(app: tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    crate::linux_startup::clear(&app.config().identifier);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}
