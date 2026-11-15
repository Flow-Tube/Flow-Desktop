//! This device's "Sync automatically" switch, as on Flow for Android. It is a device setting: it
//! never syncs and is the same whichever profile is open. Off, only Sync now and the syncs a
//! user's own change needs run; Play on and the live channel carry on.

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::db::settings::get_setting;

/// The setting's key, a device key (`profiles::device_keys`).
pub const AUTO_SYNC_KEY: &str = "linked_auto_sync";

/// What asked for a sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncTrigger {
    /// Sync now.
    Manual,
    /// A change the user just made that only takes effect once synced, such as which profiles sync.
    FollowUp,
    /// The first run after the app opens.
    Open,
    /// The timer while the app stays open.
    Interval,
    /// A LAN member brought something.
    LanMeeting,
    /// The server said the group changed.
    ServerChange,
    /// A change to a synced collection made on this device.
    LocalChange,
}

impl SyncTrigger {
    /// Whether a sync for this reason runs when this device does (`auto`) or doesn't sync on its own.
    #[must_use]
    pub fn runs(self, auto: bool) -> bool {
        auto || matches!(self, Self::Manual | Self::FollowUp)
    }
}

/// Whether this device syncs on its own: on unless the user turned it off.
pub async fn enabled(pool: &SqlitePool) -> bool {
    !matches!(get_setting(pool, AUTO_SYNC_KEY).await, Ok(Some(value)) if value == "false")
}

/// Whether a sync for `trigger` runs now.
pub async fn allows(app: &AppHandle, trigger: SyncTrigger) -> bool {
    trigger.runs(enabled(app.state::<SqlitePool>().inner()).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_runs_only_what_the_user_asked_for() {
        for trigger in [
            SyncTrigger::Open,
            SyncTrigger::Interval,
            SyncTrigger::LanMeeting,
            SyncTrigger::ServerChange,
            SyncTrigger::LocalChange,
        ] {
            assert!(trigger.runs(true), "{trigger:?} on");
            assert!(!trigger.runs(false), "{trigger:?} off");
        }
        assert!(SyncTrigger::Manual.runs(false));
        assert!(SyncTrigger::FollowUp.runs(false));
    }

    #[tokio::test]
    async fn on_until_turned_off() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        assert!(enabled(&pool).await);
        crate::db::settings::set_setting(&pool, AUTO_SYNC_KEY, "false")
            .await
            .unwrap();
        assert!(!enabled(&pool).await);
        crate::db::settings::set_setting(&pool, AUTO_SYNC_KEY, "true")
            .await
            .unwrap();
        assert!(enabled(&pool).await);
    }
}
