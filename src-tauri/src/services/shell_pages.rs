//! The pages offered by the Dock menu and the Jump List. A Jump List task can only start Flow
//! again with arguments, so the single-instance plugin hands them to the running app, and a cold
//! start keeps them until the main window asks. Only these fixed pages can be named this way.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Manager};

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

/// The page a launch was asked to open, kept until the main window takes it.
#[derive(Default)]
pub struct LaunchPage(Mutex<Option<&'static str>>);

impl LaunchPage {
    pub fn new(route: Option<&'static str>) -> Self {
        Self(Mutex::new(route))
    }

    pub fn take(&self) -> Option<&'static str> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).take()
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
    fn a_launch_page_is_taken_once() {
        let page = LaunchPage::new(route_for_page("music"));
        assert_eq!(page.take(), Some("/music"));
        assert_eq!(page.take(), None);
    }
}
