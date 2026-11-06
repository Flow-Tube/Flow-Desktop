//! Global media keys, and the window they and the tray act on. The plugin goes in only when the setting is
//! turned on, so nobody who left it off runs a key hook or, on macOS, an event tap.

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Listener, Manager, Wry};
use tauri_plugin_global_shortcut::{
    Builder, Code, GlobalShortcut, GlobalShortcutExt, Shortcut, ShortcutState,
};

use super::music_tray::MusicTray;

/// Every window listens on its own label; the payload is one of the commands below.
pub const MEDIA_COMMAND_EVENT: &str = "flow:media-command";
pub const COMMAND_TOGGLE: &str = "toggle";
pub const COMMAND_NEXT: &str = "next";
pub const COMMAND_PREVIOUS: &str = "previous";

/// What the frontend's media session arbiter announces when a player starts.
const PLAYBACK_CLAIMED_EVENT: &str = "flow:playback-claimed";
const MAIN_WINDOW: &str = "main";

// The X11 backend has no key for the combined play/pause media code; XF86AudioPlay is that key.
#[cfg(target_os = "linux")]
const PLAY_PAUSE: Code = Code::MediaPlay;
#[cfg(not(target_os = "linux"))]
const PLAY_PAUSE: Code = Code::MediaPlayPause;

/// The window that last started playing.
#[derive(Default)]
pub struct PlaybackTarget(Mutex<Option<String>>);

#[derive(serde::Deserialize)]
struct PlaybackClaim {
    source: String,
}

/// Keeps `PlaybackTarget` on whichever window last started playing.
pub fn watch_playback_claims(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any(PLAYBACK_CLAIMED_EVENT, move |event| {
        let Ok(claim) = serde_json::from_str::<PlaybackClaim>(event.payload()) else {
            return;
        };
        let target = handle.state::<PlaybackTarget>();
        *target.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(claim.source);
        if let Err(error) = handle.state::<MusicTray>().show_latest(&handle) {
            tracing::warn!(%error, "Could not update the tray");
        }
    });
}

/// The window that last started playing, or the main window once that one has closed.
pub fn playback_window(app: &AppHandle) -> String {
    let claimed = app
        .state::<PlaybackTarget>()
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    target_window(claimed.as_deref(), |label| {
        app.get_webview_window(label).is_some()
    })
    .to_owned()
}

/// Sends a command to the window that last started playing.
pub fn send_media_command(app: &AppHandle, command: &str) {
    let label = playback_window(app);
    if let Err(error) = app.emit_to(label.as_str(), MEDIA_COMMAND_EVENT, command) {
        tracing::warn!(%error, "Could not send a media command to the player");
    }
}

fn target_window(claimed: Option<&str>, exists: impl Fn(&str) -> bool) -> &str {
    claimed.filter(|label| exists(label)).unwrap_or(MAIN_WINDOW)
}

fn command_for(key: Code) -> Option<&'static str> {
    match key {
        Code::MediaPlay | Code::MediaPlayPause => Some(COMMAND_TOGGLE),
        Code::MediaTrackNext => Some(COMMAND_NEXT),
        Code::MediaTrackPrevious => Some(COMMAND_PREVIOUS),
        _ => None,
    }
}

/// False on Wayland, which has no way for an app to listen for keys outside its own window.
pub fn keys_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        !is_wayland_session(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

#[cfg(any(target_os = "linux", test))]
fn is_wayland_session(session_type: Option<&str>, wayland_display: Option<&str>) -> bool {
    session_type.is_some_and(|kind| kind.eq_ignore_ascii_case("wayland"))
        || wayland_display.is_some_and(|display| !display.is_empty())
}

/// Takes or releases the keys. Runs on the main thread, as macOS needs for registering them.
pub fn set_keys_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let installed = app.try_state::<GlobalShortcut<Wry>>().is_some();
    if !enabled {
        return if installed {
            app.global_shortcut()
                .unregister_all()
                .map_err(|error| error.to_string())
        } else {
            Ok(())
        };
    }
    if !keys_supported() {
        return Err("global keys are not available in a Wayland session".to_string());
    }
    if !installed {
        app.plugin(
            Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed
                        && let Some(command) = command_for(shortcut.key)
                    {
                        send_media_command(app, command);
                    }
                })
                .build(),
        )
        .map_err(|error| error.to_string())?;
    }
    let shortcuts = app.global_shortcut();
    shortcuts
        .unregister_all()
        .map_err(|error| error.to_string())?;
    shortcuts
        .register_multiple(
            [PLAY_PAUSE, Code::MediaTrackNext, Code::MediaTrackPrevious]
                .map(|key| Shortcut::new(None, key)),
        )
        .map_err(|error| {
            // A partial set would leave next working without play, which reads as a bug.
            let _ = shortcuts.unregister_all();
            error.to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_window_to_play_gets_the_command() {
        assert_eq!(target_window(Some("flow-2"), |_| true), "flow-2");
    }

    #[test]
    fn a_closed_window_falls_back_to_main() {
        assert_eq!(target_window(Some("pip"), |_| false), "main");
        assert_eq!(target_window(None, |_| true), "main");
    }

    #[test]
    fn only_the_three_transport_keys_are_commands() {
        assert_eq!(command_for(Code::MediaPlayPause), Some(COMMAND_TOGGLE));
        assert_eq!(command_for(Code::MediaPlay), Some(COMMAND_TOGGLE));
        assert_eq!(command_for(Code::MediaTrackNext), Some(COMMAND_NEXT));
        assert_eq!(
            command_for(Code::MediaTrackPrevious),
            Some(COMMAND_PREVIOUS)
        );
        assert_eq!(command_for(Code::KeyK), None);
    }

    #[test]
    fn wayland_is_read_from_either_variable() {
        assert!(is_wayland_session(Some("wayland"), None));
        assert!(is_wayland_session(Some("tty"), Some("wayland-0")));
        assert!(!is_wayland_session(Some("x11"), Some("")));
        assert!(!is_wayland_session(None, None));
    }
}
