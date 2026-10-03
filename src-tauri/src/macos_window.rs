use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

pub fn install_close_handler(window: &WebviewWindow) {
    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            // Keep playback, downloads, and the webview alive until explicit Quit.
            api.prevent_close();
            if let Err(error) = main_window.hide() {
                tracing::warn!(%error, "Could not hide the main window");
            }
        }
    });
}

pub fn reopen(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
        {
            tracing::warn!(%error, "Could not reopen the main window");
        }
    }
}
