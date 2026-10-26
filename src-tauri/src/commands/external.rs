//! Opening links and folders outside Flow.
//!
//! The opener plugin starts `xdg-open` with Flow's own environment. Inside the
//! `AppImage` that environment points into the bundle: `PATH` finds the bundled
//! launcher first, and the loader paths hand host programs libraries built for
//! another distro (issue #141, as #74 was for the shell). The plugin starts the
//! launcher detached, so that failure never reached Flow and nothing opened.
//! There the host's own launcher runs through `host_tokio_command` and its exit
//! status is checked. Everywhere else the plugin is right.

use crate::errors::{AppError, AppResult, ErrorResponse};
use crate::security::validation::validate_external_url;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Opens a web or mail link in the system's handler for it.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<(), ErrorResponse> {
    validate_external_url(&url).map_err(ErrorResponse::from)?;
    #[cfg(target_os = "linux")]
    if crate::appimage::in_appimage() {
        return host_open(url.trim()).await.map_err(ErrorResponse::from);
    }
    app.opener()
        .open_url(url.trim(), None::<&str>)
        .map_err(|error| AppError::Internal(format!("Could not open the link: {error}")).into())
}

/// Opens a folder in the file manager.
#[cfg_attr(not(target_os = "linux"), allow(clippy::unused_async))] // Awaits the host launcher on Linux.
pub async fn open_folder(app: &AppHandle, dir: &Path) -> AppResult<()> {
    #[cfg(target_os = "linux")]
    if crate::appimage::in_appimage() {
        return host_open(&dir.to_string_lossy()).await;
    }
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|error| AppError::Internal(format!("Could not open the folder: {error}")))
}

/// Shows a file in the file manager. On Linux this asks the file manager over
/// `D-Bus`, which works from the `AppImage` too; opening the folder is the fallback.
pub async fn reveal_file(app: &AppHandle, file: &Path) -> AppResult<()> {
    match tauri_plugin_opener::reveal_item_in_dir(file) {
        Ok(()) => Ok(()),
        Err(error) => {
            let Some(dir) = file.parent() else {
                return Err(AppError::Internal(format!(
                    "Could not show the file: {error}"
                )));
            };
            tracing::warn!(error = %error, "revealing a file failed; opening its folder instead");
            open_folder(app, dir).await
        }
    }
}

/// The host's launchers, in the order tried: `xdg-open` picks the user's
/// handler on every desktop, and `gio open` covers hosts without it.
#[cfg(target_os = "linux")]
const HOST_LAUNCHERS: &[(&str, &[&str])] = &[("xdg-open", &[]), ("gio", &["open"])];

/// Some `xdg-open` fallbacks run the browser itself and only return when it
/// closes. One still running after this has started what it was asked to.
#[cfg(target_os = "linux")]
const LAUNCHER_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(target_os = "linux")]
async fn host_open(target: &str) -> AppResult<()> {
    let mut failures = Vec::new();
    for (program, args) in HOST_LAUNCHERS {
        let spawned = crate::appimage::host_tokio_command(program)
            .args(*args)
            .arg(target)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                failures.push(format!("{program}: {error}"));
                continue;
            }
        };
        match tokio::time::timeout(LAUNCHER_WAIT, child.wait()).await {
            Ok(Ok(status)) if status.success() => return Ok(()),
            Ok(Ok(status)) => failures.push(format!("{program} exited with {status}")),
            Ok(Err(error)) => failures.push(format!("{program}: {error}")),
            Err(_) => return Ok(()),
        }
    }
    let failures = failures.join("; ");
    tracing::warn!(failures = %failures, "no host launcher could open a link");
    Err(AppError::Internal(format!(
        "No program could open it ({failures})"
    )))
}
