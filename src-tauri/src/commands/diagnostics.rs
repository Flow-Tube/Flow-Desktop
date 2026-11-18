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
use crate::services::crash_report::{CrashReport, CrashReports};
use tauri::State;

/// Cap on the number of trailing log lines returned to the UI, so the viewer and
/// the clipboard payload stay bounded even after long sessions.
const MAX_LOG_LINES: usize = 4000;
/// The most one log file contributes. A day spent in a warning loop writes far more than
/// the last `MAX_LOG_LINES` lines the page keeps.
const MAX_LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;

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

/// The report the last backend crash left, if any.
#[tauri::command]
#[must_use]
pub fn crash_report_read(reports: State<'_, CrashReports>) -> Option<CrashReport> {
    reports.read()
}

/// Stop offering the report at launch; it stays on the Diagnostics page.
#[tauri::command]
pub fn crash_report_dismiss(reports: State<'_, CrashReports>) -> Result<(), ErrorResponse> {
    reports.dismiss().map_err(|error| {
        AppError::Internal(format!("Could not dismiss the report: {error}")).into()
    })
}

/// Delete the kept report.
#[tauri::command]
pub fn crash_report_delete(reports: State<'_, CrashReports>) -> Result<(), ErrorResponse> {
    reports
        .delete()
        .map_err(|error| AppError::Internal(format!("Could not delete the report: {error}")).into())
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
pub async fn read_logs(app: tauri::AppHandle) -> Result<String, ErrorResponse> {
    let dir = logs_dir(&app)?;
    // File reads, kept off the main thread: as a plain command this froze the window for as
    // long as a week of logs took to read.
    tauri::async_runtime::spawn_blocking(move || {
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
        Ok(last_log_lines(&files, MAX_LOG_LINES, MAX_LOG_TAIL_BYTES))
    })
    .await
    .map_err(|error| AppError::Internal(format!("Reading the logs failed: {error}")))?
}

/// The end of `path` as text, at most `max_bytes` of it, starting on a whole line.
fn read_tail(path: &std::path::Path, max_bytes: u64) -> std::io::Result<String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)?;
    let start = file.metadata()?.len().saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(if start > 0 {
        // A read that starts inside the file starts inside a line.
        text.split_once('\n')
            .map_or_else(String::new, |(_, rest)| rest.to_owned())
    } else {
        text.into_owned()
    })
}

/// The last `max_lines` lines of `files`, which are oldest first. Reads the newest file
/// first and stops once it has enough, so older days are not read just to be dropped.
fn last_log_lines(files: &[std::path::PathBuf], max_lines: usize, max_file_bytes: u64) -> String {
    let mut newest_first: Vec<String> = Vec::new();
    let mut found = 0;
    for path in files.iter().rev() {
        if found >= max_lines {
            break;
        }
        if let Ok(text) = read_tail(path, max_file_bytes) {
            found += text.lines().count();
            newest_first.push(text);
        }
    }
    let lines: Vec<&str> = newest_first
        .iter()
        .rev()
        .flat_map(|text| text.lines())
        .collect();
    lines[lines.len().saturating_sub(max_lines)..].join("\n")
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
pub async fn reveal_logs_folder(app: tauri::AppHandle) -> Result<(), ErrorResponse> {
    let dir = logs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    super::external::open_folder(&app, &dir).await?;
    Ok(())
}

/// Forgets the anonymous visitor identity Flow sends with every request, so the next
/// request starts under a new one.
#[tauri::command]
pub fn reset_visitor_identity(
    client: tauri::State<'_, std::sync::Arc<crate::api::innertube::InnertubeClient>>,
) {
    client.reset_visitor_identity();
    tracing::info!("visitor identity reset from Diagnostics");
}

/// Signals that the webview mounted and rendered, so the next Linux launch
/// starts from this launch's workaround tier (see `linux_startup`). No-op on
/// other platforms.
#[tauri::command]
pub fn startup_render_ok(app: tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    crate::linux_startup::confirm_render(
        &app.config().identifier,
        &app.package_info().version.to_string(),
    );
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

/// Whether this install updates itself, and if not, what updates it instead.
#[tauri::command]
pub fn updates_supported(
    support: tauri::State<'_, crate::update_support::UpdateSupport>,
) -> crate::update_support::UpdateSupport {
    *support
}

/// The Linux graphics compatibility mode chosen in Settings: "automatic",
/// "compatible" or "safe". Always "automatic" on other platforms.
#[tauri::command]
pub fn get_graphics_mode(app: tauri::AppHandle) -> &'static str {
    #[cfg(target_os = "linux")]
    {
        crate::linux_startup::graphics_mode(&app.config().identifier).as_str()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        "automatic"
    }
}

/// How this Linux system installs video decoders ("apt", "dnf", "pacman",
/// "appimage", "flatpak" or "other"), for the no-picture banner's steps.
/// Always "other" on other platforms.
#[tauri::command]
#[must_use]
pub fn linux_codec_source() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        use crate::linux_system::CodecSource;
        match crate::linux_system::detect_codec_source() {
            CodecSource::Apt => "apt",
            CodecSource::Dnf => "dnf",
            CodecSource::Pacman => "pacman",
            CodecSource::Appimage => "appimage",
            CodecSource::Flatpak => "flatpak",
            CodecSource::Other => "other",
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        "other"
    }
}

/// Graphics facts of this Linux launch for the About tab and bug reports;
/// `None` on other platforms.
#[tauri::command]
#[must_use]
pub fn graphics_report() -> Option<crate::linux_system::GraphicsReport> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_system::graphics_report()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Stores the Linux graphics compatibility mode for the next launch.
#[tauri::command]
pub fn set_graphics_mode(app: tauri::AppHandle, mode: String) -> Result<(), ErrorResponse> {
    #[cfg(target_os = "linux")]
    {
        let parsed = crate::linux_startup::GraphicsMode::parse(&mode)
            .ok_or_else(|| AppError::Validation(format!("Unknown graphics mode: {mode}")))?;
        crate::linux_startup::set_graphics_mode(&app.config().identifier, parsed)
            .map_err(AppError::from)?;
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (app, mode);
    Ok(())
}

/// Restarts Flow on a faster graphics tier that the user then keeps or lets
/// lapse (see `linux_startup`). False when there is no faster tier to try, and
/// always on other platforms.
#[tauri::command]
#[must_use]
pub fn start_graphics_trial(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        if !crate::linux_startup::request_trial(&app.config().identifier) {
            return false;
        }
        crate::relaunch::request();
        app.exit(0);
        true
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        false
    }
}

/// The trial's question is on screen: starts its countdown and returns the
/// seconds left. `None` when this launch is not a trial.
#[tauri::command]
#[must_use]
pub fn graphics_trial_shown() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_startup::trial_shown()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Keeps the graphics tier this trial launch runs on.
#[tauri::command]
#[must_use]
pub fn keep_graphics_trial(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::linux_startup::keep_trial(
            &app.config().identifier,
            &app.package_info().version.to_string(),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        false
    }
}

/// Ends the trial and restarts Flow on the tier it had before.
#[tauri::command]
pub fn revert_graphics_trial(app: tauri::AppHandle) {
    #[cfg(target_os = "linux")]
    if crate::linux_startup::end_trial(&app.config().identifier) {
        crate::relaunch::request();
        app.exit(0);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{last_log_lines, read_tail};

    fn logs(days: &[&str]) -> (std::path::PathBuf, Vec<std::path::PathBuf>) {
        let dir = std::env::temp_dir().join(format!(
            "flow-read-logs-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let files = days
            .iter()
            .enumerate()
            .map(|(day, contents)| {
                let path = dir.join(format!("flow.2026-11-{:02}.log", day + 1));
                std::fs::write(&path, contents).unwrap();
                path
            })
            .collect();
        (dir, files)
    }

    #[test]
    fn the_last_lines_come_back_in_order_across_days() {
        let (dir, files) = logs(&["a1\na2\n", "b1\nb2\n", "c1\nc2\n"]);
        assert_eq!(last_log_lines(&files, 3, 1024), "b2\nc1\nc2");
        assert_eq!(last_log_lines(&files, 100, 1024), "a1\na2\nb1\nb2\nc1\nc2");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Older days used to be read in full and then thrown away.
    #[test]
    fn older_files_are_not_read_once_there_are_enough_lines() {
        let (dir, mut files) = logs(&["b1\nb2\n", "c1\nc2\n"]);
        files.insert(0, dir.join("flow.2026-10-31.log"));
        std::fs::create_dir(&files[0]).unwrap();
        assert_eq!(last_log_lines(&files, 2, 1024), "c1\nc2");
        // A file that can't be read is skipped.
        assert_eq!(last_log_lines(&files, 100, 1024), "b1\nb2\nc1\nc2");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_large_file_gives_its_end_from_a_whole_line() {
        let (dir, files) = logs(&["first line\nsecond line\nthird\n"]);
        assert_eq!(read_tail(&files[0], 14).unwrap(), "third\n");
        assert_eq!(
            read_tail(&files[0], 1024).unwrap(),
            "first line\nsecond line\nthird\n"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
