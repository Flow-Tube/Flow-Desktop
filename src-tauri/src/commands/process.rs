use tauri::AppHandle;

/// Exits normally (brains flush, the single-instance lock is released) and starts Flow again
/// with no arguments; see `relaunch`.
#[tauri::command]
pub fn relaunch_app(app: AppHandle) {
    crate::relaunch::request();
    app.exit(0);
}
