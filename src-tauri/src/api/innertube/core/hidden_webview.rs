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

/// Forgets a job and runs `close` when dropped. A caller that stops waiting
/// drops the job's future mid-await (a timeout around a whole resolve does
/// this), so cleanup that ran after the await was skipped then, and the hidden
/// window with the page's script heap stayed until Flow quit.
struct Job<F: FnOnce()> {
    id: String,
    close: Option<F>,
}

impl<F: FnOnce()> Drop for Job<F> {
    fn drop(&mut self) {
        pending()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
        if let Some(close) = self.close.take() {
            close();
        }
    }
}

/// Registers job `id`, runs `open`, and waits up to `timeout` for its result.
/// `close` runs once the wait ends, however it ends.
async fn wait_for_result(
    id: &str,
    timeout: Duration,
    open: impl FnOnce() -> bool,
    close: impl FnOnce(),
) -> Option<JobResult> {
    let (sender, receiver) = oneshot::channel();
    pending()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(id.to_owned(), sender);
    let _job = Job {
        id: id.to_owned(),
        close: Some(close),
    };
    if !open() {
        return None;
    }
    tokio::time::timeout(timeout, receiver).await.ok()?.ok()
}

/// Open `page` (a proxy path) with `params` in a hidden window labelled
/// `label_prefix-<id>`, and wait up to `timeout` for its result. The window is
/// closed afterwards whatever happened, including when the caller stops
/// waiting. None without a GUI, a running proxy, or a result in time.
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

    let open = {
        let app = app.clone();
        let label = label.clone();
        move || {
            let app_for_build = app.clone();
            app.run_on_main_thread(move || {
                let builder = tauri::WebviewWindowBuilder::new(
                    &app_for_build,
                    &label,
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
                    Ok(_) => debug!(label = %label, "Opened hidden WebView job"),
                    Err(error) => warn!(%error, "Failed to open hidden WebView job"),
                }
            })
            .is_ok()
        }
    };
    // Queued behind the build on the main thread, so it finds the window even
    // when the caller gives up before the window exists.
    let close = move || {
        let app_for_close = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = app_for_close.get_webview_window(&label) {
                let _ = window.close();
            }
        });
    };

    wait_for_result(&id, timeout, open, close).await
}

#[cfg(test)]
mod tests {
    use super::{JobResult, pending, resolve, wait_for_result};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    fn is_pending(id: &str) -> bool {
        pending().lock().unwrap().contains_key(id)
    }

    fn closer() -> (Arc<AtomicBool>, impl FnOnce()) {
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        (closed, move || flag.store(true, Ordering::SeqCst))
    }

    /// The leak: a caller's own timeout drops the job while it waits.
    #[tokio::test(start_paused = true)]
    async fn a_caller_that_stops_waiting_still_closes_the_window() {
        let (closed, close) = closer();
        let job = wait_for_result("gave-up", Duration::from_secs(15), || true, close);
        let waited = tokio::time::timeout(Duration::from_secs(3), job).await;

        assert!(waited.is_err(), "the caller's budget ran out first");
        assert!(closed.load(Ordering::SeqCst));
        assert!(!is_pending("gave-up"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_job_that_times_out_closes_the_window() {
        let (closed, close) = closer();
        let result = wait_for_result("timed-out", Duration::from_secs(8), || true, close).await;

        assert_eq!(result, None);
        assert!(closed.load(Ordering::SeqCst));
        assert!(!is_pending("timed-out"));
    }

    #[tokio::test]
    async fn a_result_resolves_the_job_and_closes_the_window() {
        let (closed, close) = closer();
        let open = || {
            let mut query = JobResult::new();
            query.insert("id".into(), "answered".into());
            query.insert("results".into(), "ok".into());
            resolve(query);
            true
        };
        let result = wait_for_result("answered", Duration::from_secs(8), open, close).await;

        assert_eq!(
            result.and_then(|result| result.get("results").cloned()),
            Some("ok".into())
        );
        assert!(closed.load(Ordering::SeqCst));
        assert!(!is_pending("answered"));
    }

    #[tokio::test]
    async fn a_window_that_cannot_open_ends_the_job() {
        let (closed, close) = closer();
        let result = wait_for_result("no-window", Duration::from_secs(8), || false, close).await;

        assert_eq!(result, None);
        assert!(closed.load(Ordering::SeqCst));
        assert!(!is_pending("no-window"));
    }
}
