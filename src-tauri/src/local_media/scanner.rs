//! Runs one scan at a time in the background. A new request cancels the one under way, so
//! changing the folders twice can't leave two walks on the same disk.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};

use super::scan::{self, ScanStatus};

pub const SCAN_EVENT: &str = "local-media-scan";

#[derive(Default)]
pub struct LocalMediaScanner {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// Held for the length of a pass; the next one waits until the cancelled one has stopped.
    running: tokio::sync::Mutex<()>,
    status: Mutex<ScanStatus>,
}

impl LocalMediaScanner {
    pub fn status(&self) -> ScanStatus {
        *self
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn set_status(&self, app: &AppHandle, status: ScanStatus) {
        *self
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = status;
        let _ = app.emit(SCAN_EVENT, status);
    }

    pub fn cancel(&self) {
        if let Some(cancel) = self
            .cancel
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Starts a pass over the folders as they are now, off the main thread.
    pub fn request(self: &Arc<Self>, app: AppHandle, device_pool: SqlitePool) {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut current = self
                .cancel
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(previous) = current.replace(Arc::clone(&cancel)) {
                previous.store(true, Ordering::Relaxed);
            }
        }
        let scanner = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let _pass = scanner.running.lock().await;
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            scanner.set_status(
                &app,
                ScanStatus {
                    running: true,
                    ..ScanStatus::default()
                },
            );
            let finished = scan::run(&device_pool, &cancel, |status| {
                scanner.set_status(&app, status);
            })
            .await;
            let status = finished.unwrap_or_else(|error| {
                tracing::warn!(%error, "local media scan failed");
                ScanStatus {
                    failed: true,
                    ..ScanStatus::default()
                }
            });
            scanner.set_status(&app, status);
        });
    }
}

/// How long after launch the first pass starts, so it never competes with the first page.
const LAUNCH_SCAN_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// Picks up what changed while Flow was closed. With no folders chosen it costs one small read.
pub fn scan_at_launch(scanner: Arc<LocalMediaScanner>, app: AppHandle, device_pool: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LAUNCH_SCAN_DELAY).await;
        let has_folders = crate::db::local_media::folders(&device_pool)
            .await
            .is_ok_and(|folders| !folders.is_empty());
        if has_folders {
            scanner.request(app, device_pool);
        }
    });
}
