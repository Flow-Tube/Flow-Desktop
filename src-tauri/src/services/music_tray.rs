//! Music controls in the system tray. The frontend owns playback, so the tray only shows what it
//! is told and hands its clicks back to the main window as events.

use std::sync::{Mutex, PoisonError};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager};

/// Event the main window listens on; the payload is one of the action ids below.
pub const ACTION_EVENT: &str = "music-tray-action";

const TRAY_ID: &str = "flow-music";
const ID_TOGGLE: &str = "toggle";
const ID_PREVIOUS: &str = "previous";
const ID_NEXT: &str = "next";
const ID_SHOW: &str = "show";
const TITLE_MAX_CHARS: usize = 64;

/// Menu text in the UI language, sent with every update so the backend holds no strings.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub play: String,
    pub pause: String,
    pub previous: String,
    pub next: String,
    pub show: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUpdate {
    pub now_playing: String,
    pub has_track: bool,
    pub playing: bool,
    pub labels: TrayLabels,
}

struct TrayParts {
    tray: TrayIcon,
    now_playing: MenuItem<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    previous: MenuItem<tauri::Wry>,
    next: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub struct MusicTray {
    parts: Mutex<Option<TrayParts>>,
}

impl MusicTray {
    /// Whether this system can show a tray icon at all.
    pub fn supported() -> bool {
        indicator_library_present()
    }

    /// Shows the tray with this state, creating it on first use.
    pub fn update(&self, app: &AppHandle, update: &TrayUpdate) -> tauri::Result<()> {
        if !Self::supported() {
            return Ok(());
        }
        let mut guard = self.parts.lock().unwrap_or_else(PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(build(app, update)?);
        }
        let parts = guard.as_ref().expect("tray built above");
        let title = menu_title(&update.now_playing);
        parts.now_playing.set_text(&title)?;
        parts.toggle.set_text(if update.playing {
            &update.labels.pause
        } else {
            &update.labels.play
        })?;
        parts.previous.set_text(&update.labels.previous)?;
        parts.next.set_text(&update.labels.next)?;
        parts.show.set_text(&update.labels.show)?;
        for item in [&parts.toggle, &parts.previous, &parts.next] {
            item.set_enabled(update.has_track)?;
        }
        parts.tray.set_tooltip(Some(&update.now_playing))?;
        Ok(())
    }

    /// Removes the tray icon, for when the setting is off.
    pub fn hide(&self, app: &AppHandle) {
        let mut guard = self.parts.lock().unwrap_or_else(PoisonError::into_inner);
        if guard.take().is_some() {
            app.remove_tray_by_id(TRAY_ID);
        }
    }
}

fn build(app: &AppHandle, update: &TrayUpdate) -> tauri::Result<TrayParts> {
    let now_playing = MenuItem::with_id(
        app,
        "now-playing",
        menu_title(&update.now_playing),
        false,
        None::<&str>,
    )?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, &update.labels.play, true, None::<&str>)?;
    let previous = MenuItem::with_id(
        app,
        ID_PREVIOUS,
        &update.labels.previous,
        true,
        None::<&str>,
    )?;
    let next = MenuItem::with_id(app, ID_NEXT, &update.labels.next, true, None::<&str>)?;
    let show = MenuItem::with_id(app, ID_SHOW, &update.labels.show, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &now_playing,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &previous,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &show,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            ID_SHOW => show_main_window(app),
            action @ (ID_TOGGLE | ID_PREVIOUS | ID_NEXT) => {
                if let Err(error) = app.emit_to("main", ACTION_EVENT, action) {
                    tracing::warn!(%error, "Could not send a tray action to the player");
                }
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    Ok(TrayParts {
        tray,
        now_playing,
        toggle,
        previous,
        next,
        show,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main")
        && let Err(error) = window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
    {
        tracing::warn!(%error, "Could not show the main window from the tray");
    }
}

/// A single line short enough for a menu, with `&` doubled so menus don't read it as a mnemonic.
fn menu_title(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let clipped: String = if line.chars().count() > TITLE_MAX_CHARS {
        let mut cut: String = line.chars().take(TITLE_MAX_CHARS - 1).collect();
        cut.push('\u{2026}');
        cut
    } else {
        line
    };
    clipped.replace('&', "&&")
}

/// Tauri loads the AppIndicator library lazily and panics when it is missing, which the release
/// profile turns into an abort, so probe for it before building a tray on Linux.
#[cfg(target_os = "linux")]
fn indicator_library_present() -> bool {
    use std::sync::OnceLock;
    static PRESENT: OnceLock<bool> = OnceLock::new();
    *PRESENT.get_or_init(|| {
        let present = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"]
            .iter()
            // SAFETY: both are plain shared libraries with no load-time side effects we rely on.
            .any(|name| unsafe { libloading::Library::new(*name) }.is_ok());
        if !present {
            tracing::info!("No AppIndicator library found; music tray controls are unavailable");
        }
        present
    })
}

#[cfg(not(target_os = "linux"))]
fn indicator_library_present() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::menu_title;

    #[test]
    fn titles_are_one_escaped_line() {
        assert_eq!(
            menu_title("Simon &  Garfunkel\nLive"),
            "Simon && Garfunkel Live"
        );
    }

    #[test]
    fn long_titles_are_clipped_with_an_ellipsis() {
        let title = menu_title(&"a".repeat(100));
        assert_eq!(title.chars().count(), 64);
        assert!(title.ends_with('\u{2026}'));
    }
}
