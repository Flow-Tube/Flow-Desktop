//! What Flow can be started with: the pages offered by the Dock menu and the Jump List, and a
//! `YouTube` link on the command line. A second launch reaches the running app through the
//! single-instance plugin; a cold start keeps its request until the main window asks, once, so
//! reloading the page doesn't repeat it. A restart runs with no arguments (see `relaunch`), so it
//! doesn't either. Only these fixed pages and validated links can be named this way.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Manager};

use crate::security::validation::is_openable_link;

pub const OPEN_PAGE_ARG: &str = "--open-page=";

/// The frontend's event for a page the main window should open.
const OPEN_ROUTE_EVENT: &str = "flow:open-route";

const PAGES: [(&str, &str); 4] = [
    ("search", "/search"),
    ("downloads", "/downloads"),
    ("history", "/history"),
    ("music", "/music"),
];

/// Menu text in the UI language, sent by the frontend so the backend holds no strings.
// Linux has no such menu to fill in.
#[cfg_attr(target_os = "linux", allow(dead_code))]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellLabels {
    pub search: String,
    pub downloads: String,
    pub history: String,
    pub music: String,
}

impl ShellLabels {
    /// Each page's name with its label, in menu order.
    #[cfg(any(windows, target_os = "macos"))]
    pub fn entries(&self) -> [(&'static str, &str); 4] {
        [
            (PAGES[0].0, self.search.as_str()),
            (PAGES[1].0, self.downloads.as_str()),
            (PAGES[2].0, self.history.as_str()),
            (PAGES[3].0, self.music.as_str()),
        ]
    }
}

/// What a launch was asked to open, kept until the main window takes it.
#[derive(Default)]
pub struct LaunchRequest {
    page: Mutex<Option<&'static str>>,
    link: Mutex<Option<String>>,
}

/// The process's arguments. `std::env::args` panics on one that isn't Unicode, which at startup
/// would stop the app opening at all.
pub fn lossy_args(args: impl IntoIterator<Item = std::ffi::OsString>) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

impl LaunchRequest {
    pub fn from_args<S: AsRef<str>>(args: impl IntoIterator<Item = S> + Clone) -> Self {
        Self {
            page: Mutex::new(route_from_args(args.clone())),
            link: Mutex::new(link_from_args(args)),
        }
    }

    pub fn take_page(&self) -> Option<&'static str> {
        self.page
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }

    pub fn take_link(&self) -> Option<String> {
        self.link
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

/// The route of the page at this place in the menu.
#[cfg(target_os = "macos")]
pub fn route_at(index: usize) -> Option<&'static str> {
    PAGES.get(index).map(|(_, route)| *route)
}

pub fn route_for_page(name: &str) -> Option<&'static str> {
    PAGES
        .iter()
        .find(|(page, _)| *page == name)
        .map(|(_, route)| *route)
}

pub fn route_from_args<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Option<&'static str> {
    args.into_iter()
        .find_map(|arg| route_for_page(arg.as_ref().strip_prefix(OPEN_PAGE_ARG)?))
}

/// The first link among the arguments Flow would open, as the `flow://open` link the frontend's
/// handoff reads. Anything else on the command line is ignored.
pub fn link_from_args<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Option<String> {
    let link = args
        .into_iter()
        .find(|arg| is_openable_link(arg.as_ref()))?;
    let mut handoff = reqwest::Url::parse("flow://open").ok()?;
    handoff.query_pairs_mut().append_pair("url", link.as_ref());
    Some(handoff.into())
}

/// Raises the main window on a link from a second launch.
pub fn open_link(app: &AppHandle, handoff: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to("main", "handoff://url", handoff) {
        tracing::warn!(%error, "Could not open a link from the command line");
    }
}

/// Raises the main window on `route`.
pub fn open_route(app: &AppHandle, route: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to("main", OPEN_ROUTE_EVENT, route) {
        tracing::warn!(%error, "Could not open a page from the system menu");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_listed_pages_can_be_opened() {
        assert_eq!(
            route_from_args(["flow", "--open-page=downloads"]),
            Some("/downloads")
        );
        assert_eq!(route_from_args(["--open-page=/settings"]), None);
        assert_eq!(route_from_args(["--open-page=https://evil.example"]), None);
        assert_eq!(route_from_args(["flow", "downloads"]), None);
    }

    #[test]
    fn what_a_launch_asked_for_is_taken_once() {
        let request =
            LaunchRequest::from_args(["flow", "--open-page=music", "https://youtu.be/dQw4w9WgXcQ"]);
        assert_eq!(request.take_page(), Some("/music"));
        assert_eq!(request.take_page(), None);
        assert!(request.take_link().is_some());
        assert_eq!(request.take_link(), None);
    }

    #[cfg(unix)]
    #[test]
    fn an_argument_that_isnt_unicode_doesnt_stop_the_launch() {
        use std::os::unix::ffi::OsStringExt;
        let args = lossy_args([
            std::ffi::OsString::from("flow"),
            std::ffi::OsString::from_vec(vec![0x66, 0xff]),
            std::ffi::OsString::from("--open-page=music"),
        ]);
        assert_eq!(
            LaunchRequest::from_args(args.iter()).take_page(),
            Some("/music")
        );
    }

    #[test]
    fn a_restart_has_no_arguments_so_it_opens_nothing() {
        let request = LaunchRequest::from_args(["flow"]);
        assert_eq!(request.take_page(), None);
        assert_eq!(request.take_link(), None);
    }

    #[test]
    fn a_link_is_wrapped_whole_for_the_handoff() {
        let handoff = link_from_args([
            "flow",
            "--new-window",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc",
        ])
        .unwrap();
        let parsed = reqwest::Url::parse(&handoff).unwrap();
        assert_eq!(parsed.scheme(), "flow");
        assert_eq!(parsed.host_str(), Some("open"));
        assert_eq!(
            parsed.query_pairs().next().unwrap().1,
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc"
        );
    }

    #[test]
    fn links_to_anywhere_else_are_ignored() {
        assert_eq!(link_from_args(["flow", "https://evil.example/watch"]), None);
        assert_eq!(link_from_args(["flow", "/tmp/file.mp4"]), None);
    }
}
