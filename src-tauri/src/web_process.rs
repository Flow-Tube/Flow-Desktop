//! Recovery when the Linux webview's web process dies.
//!
//! WebKitGTK runs each page in a separate web process. When that process
//! crashes (issue #70: an abort in the COLRv1 emoji code), the window keeps its
//! last frame and stops responding, and the single-instance plugin hands every
//! new launch to that frozen window, so restarting Flow doesn't help either.
//! Reloading brings the page back. A page that keeps crashing quits the app
//! instead, which releases the single-instance lock so the next launch, with
//! the startup tiers in `linux_startup`, starts clean.

use std::time::{Duration, Instant};

const CRASH_WINDOW: Duration = Duration::from_secs(60);
const MAX_CRASHES: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Recovery {
    Reload,
    Quit,
}

#[derive(Default)]
struct CrashHistory {
    recent: Vec<Instant>,
}

impl CrashHistory {
    fn record(&mut self, now: Instant) -> Recovery {
        self.recent
            .retain(|at| now.duration_since(*at) < CRASH_WINDOW);
        self.recent.push(now);
        if self.recent.len() >= MAX_CRASHES {
            Recovery::Quit
        } else {
            Recovery::Reload
        }
    }
}

/// Reloads `window` when its web process dies, and quits after
/// [`MAX_CRASHES`] deaths within [`CRASH_WINDOW`].
#[cfg(target_os = "linux")]
pub fn watch<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use std::cell::RefCell;
    use std::rc::Rc;
    use tauri::Manager;
    use webkit2gtk::WebViewExt;

    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    let result = window.with_webview(move |webview| {
        // The signal fires on the GTK main thread, where this closure runs.
        let history = Rc::new(RefCell::new(CrashHistory::default()));
        webview
            .inner()
            .connect_web_process_terminated(move |view, reason| {
                let recovery = history.borrow_mut().record(Instant::now());
                tracing::error!(
                    window = %label,
                    reason = ?reason,
                    recovery = ?recovery,
                    "web_process_terminated"
                );
                match recovery {
                    Recovery::Reload => view.reload(),
                    Recovery::Quit => app.exit(1),
                }
            });
    });
    if let Err(error) = result {
        tracing::warn!(%error, "web_process_watch_failed");
    }
}

#[cfg(test)]
mod tests {
    use super::{CRASH_WINDOW, CrashHistory, Recovery};
    use std::time::{Duration, Instant};

    #[test]
    fn the_first_crashes_reload() {
        let mut history = CrashHistory::default();
        let start = Instant::now();
        assert_eq!(history.record(start), Recovery::Reload);
        assert_eq!(
            history.record(start + Duration::from_secs(5)),
            Recovery::Reload
        );
    }

    #[test]
    fn three_crashes_within_a_minute_quit() {
        let mut history = CrashHistory::default();
        let start = Instant::now();
        history.record(start);
        history.record(start + Duration::from_secs(20));
        assert_eq!(
            history.record(start + Duration::from_secs(40)),
            Recovery::Quit
        );
    }

    #[test]
    fn crashes_older_than_the_window_are_forgotten() {
        let mut history = CrashHistory::default();
        let start = Instant::now();
        history.record(start);
        history.record(start + Duration::from_secs(10));
        let later = start + CRASH_WINDOW + Duration::from_secs(11);
        assert_eq!(history.record(later), Recovery::Reload);
    }
}
