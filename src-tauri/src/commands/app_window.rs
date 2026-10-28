use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::commands::pip::{PIP_WINDOW_LABEL, PipState};
use crate::errors::{AppError, ErrorResponse};
use crate::security::validation::validate_app_route;

/// Every extra app window's label starts with this; `capabilities/default.json`
/// grants them the main window's permissions through the matching `flow-*` glob.
pub const APP_WINDOW_PREFIX: &str = "flow-";

/// How far a new window sits from the one that opened it, so both stay visible.
const CASCADE_OFFSET: f64 = 32.0;

/// What a new window opens on: a page, and optionally a video handed over from
/// the window that opened it. The handoff is passed through untouched; only the
/// frontend understands its shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppWindowSession {
    pub route: String,
    pub handoff: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct AppWindowState {
    sessions: Mutex<HashMap<String, AppWindowSession>>,
    next_id: AtomicU32,
}

impl AppWindowState {
    fn next_label(&self) -> String {
        format!(
            "{APP_WINDOW_PREFIX}{}",
            self.next_id.fetch_add(1, Ordering::Relaxed) + 1
        )
    }

    fn store(&self, label: &str, session: AppWindowSession) -> Result<(), ErrorResponse> {
        self.sessions
            .lock()
            .map_err(|error| internal(format!("Window session lock failed: {error}")))?
            .insert(label.to_owned(), session);
        Ok(())
    }

    fn take(&self, label: &str) -> Result<Option<AppWindowSession>, ErrorResponse> {
        Ok(self
            .sessions
            .lock()
            .map_err(|error| internal(format!("Window session lock failed: {error}")))?
            .remove(label))
    }
}

fn internal(message: String) -> ErrorResponse {
    ErrorResponse::from(AppError::Internal(message))
}

/// The opener's size and a cascaded position, kept inside its monitor's work area.
fn placement<R: Runtime>(opener: &WebviewWindow<R>) -> Option<(f64, f64, f64, f64)> {
    let monitor = opener.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return None;
    }
    let area = monitor.work_area();
    let (area_x, area_y) = (
        f64::from(area.position.x) / scale,
        f64::from(area.position.y) / scale,
    );
    let (area_w, area_h) = (
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    );

    let size = opener.inner_size().ok()?.to_logical::<f64>(scale);
    let position = opener.outer_position().ok()?.to_logical::<f64>(scale);
    let width = size.width.min(area_w - CASCADE_OFFSET * 2.0);
    let height = size.height.min(area_h - CASCADE_OFFSET * 2.0);
    let x = (position.x + CASCADE_OFFSET).clamp(area_x, area_x + area_w - width);
    let y = (position.y + CASCADE_OFFSET).clamp(area_y, area_y + area_h - height);
    Some((x, y, width, height))
}

/// Opens another full Flow window. Built from the main window's own config, so
/// it gets the same decorations, size limits and webview arguments on every
/// platform (`WebView2` refuses a second environment with different arguments).
/// Must not run on the main thread; see `open_app_window`.
pub fn open_app_window_with<R: Runtime>(
    app: &AppHandle<R>,
    opener: Option<&WebviewWindow<R>>,
    session: AppWindowSession,
) -> Result<String, ErrorResponse> {
    validate_app_route(&session.route).map_err(ErrorResponse::from)?;
    let state = app.state::<AppWindowState>();
    let label = state.next_label();

    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or_else(|| internal("The main window has no config to copy".into()))?;
    config.label.clone_from(&label);
    config.maximized = false;

    let mut builder = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| internal(format!("Failed to prepare a new window: {error}")))?;
    if let Some((x, y, width, height)) = opener.and_then(placement) {
        builder = builder.inner_size(width, height).position(x, y);
    }

    state.store(&label, session)?;
    let window = builder.build().map_err(|error| {
        let _ = state.take(&label);
        internal(format!("Failed to open a new window: {error}"))
    })?;

    #[cfg(target_os = "linux")]
    crate::web_process::watch(&window);
    #[cfg(target_os = "macos")]
    crate::macos_window::allow_full_frame_rate(&window);

    let handle = app.clone();
    let closed_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(state) = handle.try_state::<AppWindowState>() {
                let _ = state.take(&closed_label);
            }
            // A pop-out has nowhere to hand its video back to once its window is gone.
            let pip_source = handle
                .try_state::<PipState>()
                .and_then(|state| state.source_window());
            if pip_source.as_deref() == Some(closed_label.as_str())
                && let Some(pip) = handle.get_webview_window(PIP_WINDOW_LABEL)
            {
                let _ = pip.destroy();
            }
            quit_if_only_hidden_main_remains(&handle, &closed_label);
        }
    });

    let _ = window.set_focus();
    tracing::info!(window = %label, "app_window_opened");
    Ok(label)
}

/// Deliberately `async`, for the same `WebView2` reason as `open_pip_window`: a
/// sync command builds the webview on the main thread and deadlocks on Windows.
#[tauri::command]
pub async fn open_app_window<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    session: AppWindowSession,
) -> Result<String, ErrorResponse> {
    open_app_window_with(&app, Some(&window), session)
}

/// The page and handoff this window was opened with, handed out once.
#[tauri::command]
pub fn app_window_session<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, AppWindowState>,
) -> Result<Option<AppWindowSession>, ErrorResponse> {
    state.take(window.label())
}

fn other_visible_app_window<R: Runtime>(app: &AppHandle<R>, except: &str) -> bool {
    app.webview_windows().iter().any(|(label, window)| {
        label != except
            && label.starts_with(APP_WINDOW_PREFIX)
            && window.is_visible().unwrap_or(false)
    })
}

/// Closing the main window while another app window is open only hides it, so
/// music, downloads and the extension bridge keep running. Returns whether the
/// close was turned into a hide.
pub fn hide_main_instead_of_closing<R: Runtime>(main: &WebviewWindow<R>) -> bool {
    if !other_visible_app_window(main.app_handle(), "main") {
        return false;
    }
    if let Err(error) = main.hide() {
        tracing::warn!(%error, "Could not hide the main window");
        return false;
    }
    true
}

/// Flow quits when its last visible window closes, even while the main window
/// is hidden behind it. macOS keeps running in the Dock, as it already does.
fn quit_if_only_hidden_main_remains<R: Runtime>(app: &AppHandle<R>, closed: &str) {
    if cfg!(target_os = "macos") || other_visible_app_window(app, closed) {
        return;
    }
    let main_hidden = app
        .get_webview_window("main")
        .is_none_or(|main| !main.is_visible().unwrap_or(true));
    if main_hidden {
        app.exit(0);
    }
}
