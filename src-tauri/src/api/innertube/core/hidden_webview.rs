//! One-shot jobs run in a hidden web view: the window opens a page the local
//! proxy serves, the page does its work in a real browser engine, and it reports
//! back by requesting `/webviewresult?id=…` from the same proxy, which resolves
//! the job here. The proxy doubles as page host and result sink, so no remote IPC
//! is granted to these pages.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::Manager;
use tokio::sync::oneshot;
use tracing::{debug, warn};

/// The proxy path a job page reports its result to.
pub const RESULT_PATH: &str = "/webviewresult";

type JobResult = HashMap<String, String>;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<JobResult>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<JobResult>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record the app handle so jobs can open windows. Until then every job returns
/// None and callers use their headless fallback.
pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// Resolve a job from the query its page sent to [`RESULT_PATH`]. A query with
/// an `error` fails the job.
pub fn resolve(mut query: JobResult) {
    let Some(id) = query.remove("id") else {
        return;
    };
    let Some(sender) = pending()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&id)
    else {
        return;
    };
    if let Some(error) = query.get("error") {
        warn!(%error, "Hidden WebView job failed");
        // Dropping `sender` resolves the waiting job to None.
        return;
    }
    let _ = sender.send(query);
}

/// Open `page` (a proxy path) with `params` in a hidden window labelled
/// `label_prefix-<id>`, and wait up to `timeout` for its result. The window is
/// closed afterwards whatever happened. None without a GUI, a running proxy, or
/// a result in time.
pub async fn run(
    label_prefix: &str,
    page: &str,
    params: &[(&str, &str)],
    timeout: Duration,
) -> Option<JobResult> {
    let app = APP_HANDLE.get()?.clone();
    let port = app
        .try_state::<crate::streaming::proxy::StreamingManager>()?
        .get_port();

    let id = uuid::Uuid::new_v4().simple().to_string();
    let mut url = tauri::Url::parse(&format!("http://127.0.0.1:{port}{page}")).ok()?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("id", &id);
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    // Each job has its own window, so concurrent jobs never close each other's.
    let label = format!("{label_prefix}-{id}");

    let (sender, receiver) = oneshot::channel();
    pending()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(id.clone(), sender);

    let app_for_build = app.clone();
    let label_for_build = label.clone();
    let build = app.run_on_main_thread(move || {
        let builder = tauri::WebviewWindowBuilder::new(
            &app_for_build,
            &label_for_build,
            tauri::WebviewUrl::External(url),
        )
        .visible(false)
        .skip_taskbar(true)
        .focused(false);
        // WebView2 won't open a second webview on the main window's data
        // directory with different arguments (see `webview2`).
        #[cfg(windows)]
        let builder = builder.additional_browser_args(crate::webview2::BROWSER_ARGS);
        match builder.build() {
            Ok(_) => debug!(label = %label_for_build, "Opened hidden WebView job"),
            Err(error) => warn!(%error, "Failed to open hidden WebView job"),
        }
    });
    if build.is_err() {
        pending()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id);
        return None;
    }

    let outcome = tokio::time::timeout(timeout, receiver).await;
    pending()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&id);

    let app_for_close = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_close.get_webview_window(&label) {
            let _ = window.close();
        }
    });

    outcome.ok()?.ok()
}
