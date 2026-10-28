//! Native Windows toast notifications.
//!
//! The `tauri-plugin-notification` builder can only set a title/body and, on
//! Windows, only tags the toast with the app's `AppUserModelID` when running an
//! *installed* build. In development it falls back to the launching process, so
//! toasts show up as "PowerShell" with no icon and get squashed together.
//!
//! This module talks to `tauri-winrt-notification` directly so we can:
//!   * register a stable `AppUserModelID` (with a display name + logo) that makes
//!     Windows attribute every toast to **Flow** — in dev *and* installed builds;
//!   * attach the app logo as the toast icon and the video thumbnail as a hero
//!     image for a clean, professional card.
#![cfg(windows)]

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_winrt_notification::{Duration, IconCrop, Sound, Toast};

/// Stable `AppUserModelID` for Flow's toasts. Matches the app identifier so the
/// registry entry we write here and the Start-menu shortcut an installer creates
/// resolve to the same identity.
const AUMID: &str = "io.github.aedev.flow.desktop";
const DISPLAY_NAME: &str = "Flow";
/// Embedded so it is always available regardless of how the app was launched.
const LOGO_BYTES: &[u8] = include_bytes!("../../icons/icon.png");
const LOGO_FILE: &str = "flow-notify-logo.png";

/// Absolute path to the on-disk logo used for the toast icon and registry `IconUri`.
fn logo_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(LOGO_FILE))
}

/// Writes the embedded logo to disk (once) and registers the `AppUserModelID` so
/// Windows attributes toasts to "Flow" with our icon instead of PowerShell.
/// Idempotent and cheap; safe to call on every startup.
pub fn ensure_setup(app: &AppHandle) {
    // Bind the running process to our AUMID so Action Center groups Flow's toasts
    // under one identity instead of the launching shell.
    let wide: Vec<u16> = AUMID.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            windows::core::PCWSTR(wide.as_ptr()),
        );
    }

    let Some(logo) = logo_path(app) else {
        return;
    };
    if !logo.exists() {
        if let Some(parent) = logo.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(error) = std::fs::write(&logo, LOGO_BYTES) {
            tracing::warn!(%error, "Failed to write notification logo");
        }
    }

    if let Err(error) = register_aumid(&logo) {
        tracing::warn!(%error, "Failed to register notification AppUserModelID");
    }
}

/// Registers `HKCU\Software\Classes\AppUserModelId\{AUMID}` with a friendly name
/// and icon so the toast header reads "Flow" and shows our logo.
fn register_aumid(logo: &Path) -> windows_registry::Result<()> {
    let key = windows_registry::CURRENT_USER
        .create(format!("Software\\Classes\\AppUserModelId\\{AUMID}"))?;
    key.set_string("DisplayName", DISPLAY_NAME)?;
    if let Some(path) = logo.to_str() {
        key.set_string("IconUri", path)?;
    }
    Ok(())
}

/// A single toast card for one new video. `thumbnail` is an optional local image
/// path (a downloaded video thumbnail) shown as the large banner at the top.
pub struct ToastCard<'a> {
    pub video_id: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub thumbnail: Option<&'a Path>,
}

/// Shows a native toast attributed to Flow. Each new video gets its own toast
/// (its own pane), with the app logo, the video thumbnail as a hero banner, and
/// a click handler that plays the video in the app. Fails silently.
pub fn show(app: &AppHandle, card: &ToastCard<'_>) {
    let mut toast = Toast::new(AUMID)
        .title(card.title)
        .text1(card.body)
        .sound(Some(Sound::Default))
        .duration(Duration::Short);

    if let Some(logo) = logo_path(app).filter(|path| path.exists()) {
        toast = toast.icon(&logo, IconCrop::Square, DISPLAY_NAME);
    }
    if let Some(thumbnail) = card.thumbnail.filter(|path| path.exists()) {
        toast = toast.hero(thumbnail, "");
    }

    // Deep link: clicking the toast (while the app is running) plays this video.
    // We post one toast per video, so the closure can capture the exact id —
    // no dependency on the toast carrying a launch argument.
    let app = app.clone();
    let video_id = card.video_id.to_string();
    toast = toast.on_activated(move |_argument| {
        activate_video(&app, &video_id);
        Ok(())
    });

    if let Err(error) = toast.show() {
        tracing::warn!(%error, "Failed to show native Windows toast");
    }
}

/// Brings the main window forward and asks the frontend to play `video_id`.
fn activate_video(app: &AppHandle, video_id: &str) {
    use tauri::Emitter;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to(
        "main",
        crate::services::notification_service::ACTIVATE_NOTIFICATION_EVENT,
        video_id,
    ) {
        tracing::warn!(%error, "Failed to emit notification activation event");
    }
}
