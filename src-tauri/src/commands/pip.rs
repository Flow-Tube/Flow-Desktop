use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    window::Color,
};

use crate::errors::{AppError, ErrorResponse};

/// Label of the pop-out player window. `capabilities/pip.json` scopes that
/// window's permissions to this exact label, and the frontend picks its root
/// component by comparing the current window label against it.
pub const PIP_WINDOW_LABEL: &str = "pip";

/// Tells an already-open pop-out that a new handoff replaced its session, so it
/// re-reads `pip_session` instead of being torn down and rebuilt.
const SESSION_CHANGED_EVENT: &str = "flow:pip-session-changed";

/// 16:9 at a size that stays readable without covering real work.
const DEFAULT_WIDTH: f64 = 480.0;
const DEFAULT_HEIGHT: f64 = 270.0;
const MIN_WIDTH: f64 = 256.0;
const MIN_HEIGHT: f64 = 144.0;
/// Gap kept from the work-area edges when the pop-out is first placed.
const SCREEN_MARGIN: f64 = 24.0;

/// The playback handoff the main window gives the pop-out player (and that the
/// pop-out reads back on startup). Queue entries are `VideoSummary` values
/// passed through verbatim — the pop-out hydrates its own player store from
/// them, so the backend never has to understand their shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipSession {
    pub queue: Vec<serde_json::Value>,
    pub current_index: usize,
    pub position_seconds: f64,
    pub playing: bool,
    pub always_on_top: bool,
    /// Settings snapshot and the already-resolved stream, both passed through so
    /// the pop-out can start playing without re-reading SQLite or re-running the
    /// extractor for a video the main window has already resolved.
    pub settings: serde_json::Value,
    pub stream: Option<serde_json::Value>,
    pub silent_until_takeover: bool,
}

#[derive(Default)]
pub struct PipState {
    session: Mutex<Option<PipSession>>,
}

impl PipState {
    fn store(&self, session: Option<PipSession>) -> Result<(), ErrorResponse> {
        let mut slot = self.session.lock().map_err(|error| {
            ErrorResponse::from(AppError::Internal(format!(
                "PiP session lock failed: {error}"
            )))
        })?;
        *slot = session;
        Ok(())
    }

    fn read(&self) -> Result<Option<PipSession>, ErrorResponse> {
        let slot = self.session.lock().map_err(|error| {
            ErrorResponse::from(AppError::Internal(format!(
                "PiP session lock failed: {error}"
            )))
        })?;
        Ok(slot.clone())
    }
}

/// Bottom-right of the work area on the monitor the main window is on, so the
/// pop-out lands where the user is looking and clears the taskbar/dock.
fn pip_origin<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;

    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return None;
    }

    let area = monitor.work_area();
    let left = f64::from(area.position.x) / scale;
    let top = f64::from(area.position.y) / scale;
    let width = f64::from(area.size.width) / scale;
    let height = f64::from(area.size.height) / scale;

    Some((
        left + (width - DEFAULT_WIDTH - SCREEN_MARGIN).max(0.0),
        top + (height - DEFAULT_HEIGHT - SCREEN_MARGIN).max(0.0),
    ))
}

/// Hands playback to a real top-level OS window: independently movable and
/// resizable, optionally always-on-top, and free to live on another monitor or
/// virtual desktop. Re-invoking this while the pop-out is open replaces its
/// session in place rather than spawning a second window.
///
/// Deliberately `async`: a sync command runs on the main thread, and building a
/// webview there deadlocks on Windows — WebView2 finishes creation through the
/// message loop this call would be blocking. Async moves it to a worker thread
/// that dispatches the build to a main thread still free to pump messages.
#[tauri::command]
pub async fn open_pip_window<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PipState>,
    session: PipSession,
) -> Result<(), ErrorResponse> {
    let always_on_top = session.always_on_top;
    let video_count = session.queue.len();
    state.store(Some(session))?;

    if let Some(window) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let _ = window.set_always_on_top(always_on_top);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        app.emit_to(PIP_WINDOW_LABEL, SESSION_CHANGED_EVENT, ())
            .map_err(|error| {
                ErrorResponse::from(AppError::Internal(format!(
                    "Failed to notify the pop-out player of a new session: {error}"
                )))
            })?;
        tracing::info!(video_count, "pip_window_session_replaced");
        return Ok(());
    }

    let mut builder =
        WebviewWindowBuilder::new(&app, PIP_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("Flow - Mini player")
            .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
            .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
            .resizable(true)
            .maximizable(false)
            .decorations(false)
            .always_on_top(always_on_top)
            // Painted before the webview has anything to show, so the pop-out
            // never flashes white over whatever the user is working in.
            .background_color(Color(0, 0, 0, 255));

    if let Some((x, y)) = pip_origin(&app) {
        builder = builder.position(x, y);
    }

    // WebView2 shares one environment per user-data folder, so these must match
    // the main window's `additionalBrowserArgs`; the pop-out also has to start
    // playing without a user gesture of its own.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args("--autoplay-policy=no-user-gesture-required");
    }

    let window = builder.build().map_err(|error| {
        ErrorResponse::from(AppError::Internal(format!(
            "Failed to open the pop-out player window: {error}"
        )))
    })?;

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(state) = handle.try_state::<PipState>() {
                let _ = state.store(None);
            }
        }
    });

    tracing::info!(video_count, always_on_top, "pip_window_opened");
    Ok(())
}

/// The handoff the pop-out window boots from. `None` once the pop-out has been
/// closed, which is also how the pop-out detects a session that went stale
/// while it was starting up.
#[tauri::command]
pub fn pip_session(state: State<'_, PipState>) -> Result<Option<PipSession>, ErrorResponse> {
    state.read()
}

/// Closes the pop-out. The window's own close handler still runs, so the
/// playback position is handed back to the main window first.
#[tauri::command]
pub fn close_pip_window<R: Runtime>(app: AppHandle<R>) -> Result<(), ErrorResponse> {
    if let Some(window) = app.get_webview_window(PIP_WINDOW_LABEL) {
        window.close().map_err(|error| {
            ErrorResponse::from(AppError::Internal(format!(
                "Failed to close the pop-out player window: {error}"
            )))
        })?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_pip_always_on_top<R: Runtime>(
    app: AppHandle<R>,
    always_on_top: bool,
) -> Result<(), ErrorResponse> {
    if let Some(window) = app.get_webview_window(PIP_WINDOW_LABEL) {
        window.set_always_on_top(always_on_top).map_err(|error| {
            ErrorResponse::from(AppError::Internal(format!(
                "Failed to change the pop-out player's always-on-top state: {error}"
            )))
        })?;
    }
    Ok(())
}

/// Makes sure the pop-out is on screen once its player has mounted. It
/// deliberately does not take focus: this also fires when Flow was minimized to
/// keep watching, and stealing the keyboard from whatever the user switched to
/// would be worse than not being frontmost. Always-on-top keeps it visible.
#[tauri::command]
pub fn pip_window_ready<R: Runtime>(app: AppHandle<R>) -> Result<(), ErrorResponse> {
    if let Some(window) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let _ = window.show();
    }
    Ok(())
}

/// Raises the main window when the pop-out hands playback back to it.
#[tauri::command]
pub fn focus_main_window<R: Runtime>(app: AppHandle<R>) -> Result<(), ErrorResponse> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}
