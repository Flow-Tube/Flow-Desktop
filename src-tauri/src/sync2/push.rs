//! Sending what changes on this device soon after it changes, while the app is open and another
//! device of the group can be reached over the server's live channel or the LAN, as on Flow for
//! Android: once nothing changed for [`PUSH_QUIET`], at most one push per [`PUSH_SPACING`], one at
//! a time. The timer sync and Sync now send everything else, as before.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::auto_sync::{SyncTrigger, allows};
use super::device::DEVICE_KEYS;
use super::live_hub::until_another_online;
use super::service::sync_now;

/// A push waits until nothing changed for this long, so a burst of edits leaves as one.
pub const PUSH_QUIET: Duration = Duration::from_secs(10);
/// Pushes start at most this often.
pub const PUSH_SPACING: Duration = Duration::from_mins(1);

/// Changes waiting to go out.
#[derive(Default)]
pub struct LocalPushes {
    last_change: Mutex<Option<Instant>>,
    changed: Notify,
}

/// When a push of changes last made at `last_change` may start: once nothing changed for `quiet`,
/// and `spacing` after the push before it started.
#[must_use]
pub fn push_due(
    last_change: Instant,
    last_push: Option<Instant>,
    quiet: Duration,
    spacing: Duration,
) -> Instant {
    let settled = last_change + quiet;
    last_push.map_or(settled, |pushed| settled.max(pushed + spacing))
}

impl LocalPushes {
    /// A change to a synced collection made on this device.
    pub fn changed(&self, at: Instant) {
        if let Ok(mut last) = self.last_change.lock() {
            *last = Some(at);
        }
        self.changed.notify_one();
    }

    fn waiting(&self) -> Option<Instant> {
        self.last_change.lock().ok().and_then(|last| *last)
    }

    /// Takes what waits, unless something changed after `seen`.
    fn take(&self, seen: Instant) -> bool {
        let Ok(mut last) = self.last_change.lock() else {
            return false;
        };
        if *last != Some(seen) {
            return false;
        }
        *last = None;
        true
    }
}

/// Sends a change made on this device soon, while another device can be reached.
pub fn push_soon(app: &AppHandle) {
    app.state::<LocalPushes>().changed(Instant::now());
}

/// Pushes the changes made on this device for the app's lifetime. A run already under way, a
/// timer one or Sync now, is waited for, so two never overlap.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let pushes = app.state::<LocalPushes>();
        let mut last_push = None;
        loop {
            let Some(seen) = pushes.waiting() else {
                pushes.changed.notified().await;
                continue;
            };
            // The keys are read only once there is something to send; without them the timer
            // sync sends it.
            let Ok(device) = DEVICE_KEYS.get().await else {
                pushes.take(seen);
                continue;
            };
            until_another_online(&app, &hex::encode(device.did)).await;
            let due = push_due(seen, last_push, PUSH_QUIET, PUSH_SPACING);
            if Instant::now() < due {
                tokio::select! {
                    () = tokio::time::sleep_until(due) => {}
                    () = pushes.changed.notified() => {}
                }
                continue;
            }
            if !pushes.take(seen) {
                continue;
            }
            // With automatic sync off, a change waits for Sync now.
            if !allows(&app, SyncTrigger::LocalChange).await {
                continue;
            }
            let started = Instant::now();
            if let Err(error) = sync_now(&app).await {
                tracing::warn!(target: "flow::sync2", kind = error.kind(), "push failed");
            }
            last_push = Some(started);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUIET: Duration = Duration::from_secs(10);
    const SPACING: Duration = Duration::from_secs(60);

    #[test]
    fn waits_for_quiet_after_the_last_change() {
        let start = Instant::now();
        assert_eq!(push_due(start, None, QUIET, SPACING), start + QUIET);
        let later = start + Duration::from_secs(7);
        assert_eq!(push_due(later, None, QUIET, SPACING), later + QUIET);
    }

    #[test]
    fn starts_at_most_once_a_minute() {
        let pushed = Instant::now();
        let change = pushed + Duration::from_secs(5);
        assert_eq!(
            push_due(change, Some(pushed), QUIET, SPACING),
            pushed + SPACING
        );
        let late = pushed + Duration::from_secs(70);
        assert_eq!(push_due(late, Some(pushed), QUIET, SPACING), late + QUIET);
    }

    #[test]
    fn a_change_after_the_wait_began_keeps_its_push() {
        let pushes = LocalPushes::default();
        let first = Instant::now();
        pushes.changed(first);
        let second = first + Duration::from_secs(3);
        pushes.changed(second);
        assert!(!pushes.take(first));
        assert_eq!(pushes.waiting(), Some(second));
        assert!(pushes.take(second));
        assert_eq!(pushes.waiting(), None);
    }
}
