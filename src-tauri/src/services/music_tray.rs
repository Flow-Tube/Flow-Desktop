//! Playback controls in the system tray, for music and video. The frontend owns playback, so the
//! tray only shows what it is told and hands its clicks back as events. Every window reports what
//! it plays; the tray shows the window that last started playing.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager};

use super::media_keys::{self, COMMAND_NEXT, COMMAND_PREVIOUS, COMMAND_TOGGLE};

/// Event the main window listens on for the Continue watching item.
const CONTINUE_WATCHING_EVENT: &str = "flow:tray-continue-watching";
const MAIN_WINDOW: &str = "main";

const TRAY_ID: &str = "flow-music";
const ID_SHOW: &str = "show";
const ID_CONTINUE: &str = "continue-watching";
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
    pub continue_watching: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUpdate {
    pub now_playing: String,
    pub has_track: bool,
    pub playing: bool,
    /// What the item says when there is something to resume; only the main window sends it.
    pub continue_watching: Option<String>,
    pub labels: TrayLabels,
}

struct TrayParts {
    tray: TrayIcon,
    now_playing: MenuItem<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    previous: MenuItem<tauri::Wry>,
    next: MenuItem<tauri::Wry>,
    continue_watching: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub struct MusicTray {
    parts: Mutex<Option<TrayParts>>,
    /// The latest report from each window. The main window's is there while the tray is wanted.
    latest: Mutex<HashMap<String, TrayUpdate>>,
}

impl MusicTray {
    /// Whether this system can show a tray icon at all.
    pub fn supported() -> bool {
        indicator_library_present()
    }

    /// Takes a window's report and shows the tray, creating it on first use.
    pub fn update(&self, app: &AppHandle, window: &str, update: TrayUpdate) -> tauri::Result<()> {
        if !Self::supported() {
            return Ok(());
        }
        self.latest
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(window.to_owned(), update);
        self.show_latest(app)
    }

    /// Shows the report of the window that last started playing.
    pub fn show_latest(&self, app: &AppHandle) -> tauri::Result<()> {
        let latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
        // The main window alone decides whether there is a tray at all.
        let Some(main) = latest.get(MAIN_WINDOW) else {
            return Ok(());
        };
        let update = latest
            .get(media_keys::playback_window(app).as_str())
            .unwrap_or(main);
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
        parts.continue_watching.set_text(menu_title(
            main.continue_watching
                .as_deref()
                .unwrap_or(&main.labels.continue_watching),
        ))?;
        parts
            .continue_watching
            .set_enabled(main.continue_watching.is_some())?;
        parts.tray.set_tooltip(Some(&update.now_playing))?;
        Ok(())
    }

    /// Removes the tray icon, for when the setting is off.
    pub fn hide(&self, app: &AppHandle) -> tauri::Result<()> {
        self.latest
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(MAIN_WINDOW);
        let Some(parts) = self
            .parts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        else {
            return Ok(());
        };
        // Dropping the last handle removes the NSStatusItem, and AppKit traps when that happens
        // off the main thread, so both the removal and the drop run there.
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let removed = handle.remove_tray_by_id(TRAY_ID);
            drop(parts);
            drop(removed);
        })
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
    let toggle = MenuItem::with_id(app, COMMAND_TOGGLE, &update.labels.play, true, None::<&str>)?;
    let previous = MenuItem::with_id(
        app,
        COMMAND_PREVIOUS,
        &update.labels.previous,
        true,
        None::<&str>,
    )?;
    let next = MenuItem::with_id(app, COMMAND_NEXT, &update.labels.next, true, None::<&str>)?;
    let continue_watching = MenuItem::with_id(
        app,
        ID_CONTINUE,
        &update.labels.continue_watching,
        false,
        None::<&str>,
    )?;
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
            &continue_watching,
            &show,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            ID_SHOW => show_main_window(app),
            ID_CONTINUE => {
                show_main_window(app);
                if let Err(error) = app.emit_to(MAIN_WINDOW, CONTINUE_WATCHING_EVENT, ()) {
                    tracing::warn!(%error, "Could not resume a video from the tray");
                }
            }
            command @ (COMMAND_TOGGLE | COMMAND_PREVIOUS | COMMAND_NEXT) => {
                media_keys::send_media_command(app, command);
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
        continue_watching,
        show,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW)
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
