use std::sync::Mutex;

use tauri::{State, WebviewWindow};

use crate::errors::{AppError, ErrorResponse};

#[derive(Default)]
pub struct PlayerFullscreenState {
    restore_maximized: Mutex<bool>,
}

trait FullscreenWindowOps {
    fn is_fullscreen(&self) -> Result<bool, String>;
    fn is_maximized(&self) -> Result<bool, String>;
    fn unmaximize(&self) -> Result<(), String>;
    fn set_fullscreen(&self, fullscreen: bool) -> Result<(), String>;
    fn maximize(&self) -> Result<(), String>;
}

impl FullscreenWindowOps for WebviewWindow {
    fn is_fullscreen(&self) -> Result<bool, String> {
        WebviewWindow::is_fullscreen(self).map_err(|error| error.to_string())
    }

    fn is_maximized(&self) -> Result<bool, String> {
        WebviewWindow::is_maximized(self).map_err(|error| error.to_string())
    }

    fn unmaximize(&self) -> Result<(), String> {
        WebviewWindow::unmaximize(self).map_err(|error| error.to_string())
    }

    fn set_fullscreen(&self, fullscreen: bool) -> Result<(), String> {
        WebviewWindow::set_fullscreen(self, fullscreen).map_err(|error| error.to_string())
    }

    fn maximize(&self) -> Result<(), String> {
        WebviewWindow::maximize(self).map_err(|error| error.to_string())
    }
}

fn apply_player_fullscreen<W: FullscreenWindowOps>(
    window: &W,
    restore_maximized: &mut bool,
    fullscreen: bool,
    clear_maximized_before_enter: bool,
) -> Result<(), String> {
    let currently_fullscreen = window.is_fullscreen()?;

    if fullscreen {
        if currently_fullscreen {
            return Ok(());
        }

        let was_maximized = clear_maximized_before_enter && window.is_maximized()?;
        *restore_maximized = was_maximized;

        if was_maximized {
            window.unmaximize()?;
        }

        if let Err(error) = window.set_fullscreen(true) {
            if was_maximized {
                let _ = window.maximize();
            }
            *restore_maximized = false;
            return Err(error);
        }

        return Ok(());
    }

    if currently_fullscreen {
        window.set_fullscreen(false)?;
    }

    if std::mem::take(restore_maximized) {
        window.maximize()?;
    }

    Ok(())
}

/// Keeps the Windows maximize workaround and the native fullscreen transition
/// in one backend call. Tao otherwise retains `WS_MAXIMIZE` while applying its
/// fullscreen style, which makes Windows preserve the taskbar work area for an
/// undecorated maximized window.
#[tauri::command]
pub fn set_player_fullscreen(
    window: WebviewWindow,
    state: State<'_, PlayerFullscreenState>,
    fullscreen: bool,
) -> Result<(), ErrorResponse> {
    let mut restore_maximized = state.restore_maximized.lock().map_err(|error| {
        ErrorResponse::from(AppError::Internal(format!(
            "Player fullscreen state lock failed: {error}"
        )))
    })?;

    apply_player_fullscreen(
        &window,
        &mut restore_maximized,
        fullscreen,
        cfg!(target_os = "windows"),
    )
    .map_err(|error| {
        ErrorResponse::from(AppError::Internal(format!(
            "Native player fullscreen transition failed: {error}"
        )))
    })?;

    tracing::info!(fullscreen, "native_player_fullscreen_changed");
    Ok(())
}

#[tauri::command]
pub fn set_window_background(
    window: WebviewWindow,
    color: tauri::window::Color,
) -> Result<(), ErrorResponse> {
    window.set_background_color(Some(color)).map_err(|error| {
        ErrorResponse::from(AppError::Internal(format!(
            "Native window background failed: {error}"
        )))
    })
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    struct FakeWindow {
        fullscreen: Cell<bool>,
        maximized: Cell<bool>,
        calls: RefCell<Vec<String>>,
    }

    impl FakeWindow {
        fn new(maximized: bool) -> Self {
            Self {
                fullscreen: Cell::new(false),
                maximized: Cell::new(maximized),
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl FullscreenWindowOps for FakeWindow {
        fn is_fullscreen(&self) -> Result<bool, String> {
            self.calls.borrow_mut().push("is_fullscreen".into());
            Ok(self.fullscreen.get())
        }

        fn is_maximized(&self) -> Result<bool, String> {
            self.calls.borrow_mut().push("is_maximized".into());
            Ok(self.maximized.get())
        }

        fn unmaximize(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("unmaximize".into());
            self.maximized.set(false);
            Ok(())
        }

        fn set_fullscreen(&self, fullscreen: bool) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("set_fullscreen:{fullscreen}"));
            self.fullscreen.set(fullscreen);
            Ok(())
        }

        fn maximize(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("maximize".into());
            self.maximized.set(true);
            Ok(())
        }
    }

    #[test]
    fn windows_maximized_transition_clears_maximize_before_fullscreen_and_restores_on_exit() {
        let window = FakeWindow::new(true);
        let mut restore_maximized = false;

        apply_player_fullscreen(&window, &mut restore_maximized, true, true).unwrap();
        assert!(restore_maximized);
        assert_eq!(
            *window.calls.borrow(),
            [
                "is_fullscreen",
                "is_maximized",
                "unmaximize",
                "set_fullscreen:true",
            ]
        );

        window.calls.borrow_mut().clear();
        apply_player_fullscreen(&window, &mut restore_maximized, false, true).unwrap();
        assert!(!restore_maximized);
        assert_eq!(
            *window.calls.borrow(),
            ["is_fullscreen", "set_fullscreen:false", "maximize"]
        );
    }

    #[test]
    fn windowed_transition_never_changes_maximize_state() {
        let window = FakeWindow::new(false);
        let mut restore_maximized = false;

        apply_player_fullscreen(&window, &mut restore_maximized, true, true).unwrap();
        apply_player_fullscreen(&window, &mut restore_maximized, false, true).unwrap();

        assert_eq!(
            *window.calls.borrow(),
            [
                "is_fullscreen",
                "is_maximized",
                "set_fullscreen:true",
                "is_fullscreen",
                "set_fullscreen:false",
            ]
        );
    }
}
