//! Automatic backups, Flow for Android's `AutoBackupWorker` while Flow is open: one file per kind
//! in the chosen folder, replaced by each run, on a daily, weekly or monthly schedule.
//!
//! The list of settings a backup carries lives in the frontend's schema, which hands it over once
//! at launch, so the worker starts only after that, and a slow first backup never holds up startup.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

use crate::backup::build::{now_ms, write_backup};
use crate::commands::backup::flush_brains;
use crate::db::settings::{get_setting, set_setting};
use crate::services::profile_service::ProfileService;

pub const FREQUENCY_KEY: &str = "auto_backup_frequency";
pub const TYPE_KEY: &str = "auto_backup_type";
pub const FOLDER_KEY: &str = "auto_backup_folder";
pub const LAST_RUN_KEY: &str = "auto_backup_last_run";
pub const LAST_ERROR_KEY: &str = "auto_backup_last_error";

const FIRST_CHECK_AFTER: Duration = Duration::from_mins(1);
const CHECK_EVERY: Duration = Duration::from_mins(15);
/// A failing backup still writes most of a file each try, so it isn't tried at every check.
const RETRY_AFTER: Duration = Duration::from_hours(1);
const DAY_MS: u64 = 24 * 60 * 60 * 1000;

const ERROR_NO_FOLDER: &str = "folder_missing";
const ERROR_FAILED: &str = "failed";

/// Days between backups, or `None` when they are off.
#[must_use]
pub fn period_days(frequency: &str) -> Option<u64> {
    match frequency {
        "DAILY" => Some(1),
        "WEEKLY" => Some(7),
        "MONTHLY" => Some(30),
        _ => None,
    }
}

/// A clock set back leaves a last run in the future, which must not stop backups for good.
#[must_use]
pub fn is_due(frequency: &str, last_run_ms: u64, now: u64) -> bool {
    let Some(days) = period_days(frequency) else {
        return false;
    };
    last_run_ms == 0 || last_run_ms > now || now - last_run_ms >= days * DAY_MS
}

/// With two or more profiles only a master backup holds them all, so that is what the schedule
/// writes, whatever was chosen.
#[must_use]
pub fn effective_type(chosen: &str, profile_count: usize) -> &str {
    if profile_count >= 2 { "MASTER" } else { chosen }
}

/// The one file each kind keeps in the folder; a new run replaces it, as on Android.
#[must_use]
pub fn file_name(kind: &str) -> &'static str {
    match kind {
        "BRAIN" => "flow_brain_backup.zip",
        "MASTER" => "flow_master_backup.zip",
        _ => "flow_backup.json",
    }
}

#[derive(Default)]
pub struct AutoBackupState {
    /// The schema's backup settings and the worded failure notice, from the frontend.
    registration: Mutex<Option<(Vec<String>, String)>>,
    registered: Notify,
    running: tokio::sync::Mutex<()>,
}

impl AutoBackupState {
    pub fn register(&self, keys: Vec<String>, failure_title: String) {
        *self
            .registration
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((keys, failure_title));
        self.registered.notify_one();
    }

    fn registration(&self) -> Option<(Vec<String>, String)> {
        self.registration
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupStatus {
    pub last_run_ms: u64,
    pub last_error: Option<String>,
    pub running: bool,
}

async fn setting(pool: &SqlitePool, key: &str) -> Option<String> {
    get_setting(pool, key).await.ok().flatten()
}

pub async fn status(pool: &SqlitePool, state: &AutoBackupState) -> AutoBackupStatus {
    AutoBackupStatus {
        last_run_ms: setting(pool, LAST_RUN_KEY)
            .await
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        last_error: setting(pool, LAST_ERROR_KEY)
            .await
            .filter(|error| !error.is_empty()),
        running: state.running.try_lock().is_err(),
    }
}

fn usable_folder(folder: &str) -> Option<PathBuf> {
    let path = Path::new(folder);
    (path.is_absolute() && path.is_dir()).then(|| path.to_path_buf())
}

async fn record(pool: &SqlitePool, error: Option<&str>) {
    let saved = if let Some(error) = error {
        set_setting(pool, LAST_ERROR_KEY, error).await
    } else {
        let saved = set_setting(pool, LAST_RUN_KEY, &now_ms().to_string()).await;
        saved.and(set_setting(pool, LAST_ERROR_KEY, "").await)
    };
    if let Err(error) = saved {
        tracing::warn!(%error, "[backup] could not record the automatic backup");
    }
}

/// One backup into the chosen folder. `None` when another one is already running.
pub async fn run_now(app: &AppHandle, pool: &SqlitePool) -> Option<Result<(), String>> {
    let state = app.state::<AutoBackupState>();
    let _running = state.running.try_lock().ok()?;
    let outcome = write_to_folder(app, pool, &state).await;
    record(pool, outcome.as_ref().err().map(String::as_str)).await;
    Some(outcome)
}

async fn write_to_folder(
    app: &AppHandle,
    pool: &SqlitePool,
    state: &AutoBackupState,
) -> Result<(), String> {
    let folder = setting(pool, FOLDER_KEY)
        .await
        .and_then(|folder| usable_folder(&folder))
        .ok_or_else(|| ERROR_NO_FOLDER.to_string())?;
    let (keys, _) = state.registration().unwrap_or_default();
    let profiles = app.state::<ProfileService>();
    let count = profiles.list().map_or(1, |view| view.profiles.len());
    let chosen = setting(pool, TYPE_KEY)
        .await
        .unwrap_or_else(|| "APP_DATA".into());
    let kind = effective_type(&chosen, count).to_string();

    flush_brains(app, false).await;
    write_backup(
        pool,
        &profiles,
        &kind,
        &keys,
        &folder.join(file_name(&kind)),
    )
    .await
    .map_err(|error| {
        // The message can hold the folder's path, so it stays in the log.
        tracing::warn!(%error, "[backup] automatic backup failed");
        ERROR_FAILED.to_string()
    })
}

fn notify_failure(app: &AppHandle) {
    let Some((_, title)) = app.state::<AutoBackupState>().registration() else {
        return;
    };
    if let Err(error) = app.notification().builder().title(title).show() {
        tracing::debug!(%error, "[backup] could not show the failure notification");
    }
}

/// Whether a backup ran and failed. With no folder chosen yet there is nothing to do, and nothing
/// to warn about: the schedule simply waits for one.
async fn tick(app: &AppHandle, pool: &SqlitePool) -> bool {
    let Some(frequency) = setting(pool, FREQUENCY_KEY).await else {
        return false;
    };
    let has_folder = setting(pool, FOLDER_KEY)
        .await
        .is_some_and(|folder| !folder.is_empty());
    let last_run = setting(pool, LAST_RUN_KEY)
        .await
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if !has_folder || !is_due(&frequency, last_run, now_ms()) {
        return false;
    }
    let failed_before = setting(pool, LAST_ERROR_KEY)
        .await
        .is_some_and(|error| !error.is_empty());
    let failed = matches!(run_now(app, pool).await, Some(Err(_)));
    // Once is enough to say so, however many tries it takes.
    if failed && !failed_before {
        notify_failure(app);
    }
    failed
}

pub fn spawn(app: AppHandle, pool: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AutoBackupState>();
        while state.registration().is_none() {
            state.registered.notified().await;
        }
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            let failed = tick(&app, &pool).await;
            tokio::time::sleep(if failed { RETRY_AFTER } else { CHECK_EVERY }).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_schedule_comes_due_after_its_period() {
        let now = 100 * DAY_MS;
        assert!(!is_due("NONE", 0, now));
        assert!(is_due("DAILY", 0, now), "never backed up");
        assert!(!is_due("DAILY", now - DAY_MS + 1, now));
        assert!(is_due("DAILY", now - DAY_MS, now));
        assert!(!is_due("WEEKLY", now - 6 * DAY_MS, now));
        assert!(is_due("WEEKLY", now - 7 * DAY_MS, now));
        assert!(!is_due("MONTHLY", now - 29 * DAY_MS, now));
        assert!(is_due("MONTHLY", now - 30 * DAY_MS, now));
    }

    #[test]
    fn a_clock_set_back_does_not_stop_backups() {
        assert!(is_due("MONTHLY", 200 * DAY_MS, 100 * DAY_MS));
    }

    #[test]
    fn several_profiles_always_back_up_as_master() {
        assert_eq!(effective_type("APP_DATA", 1), "APP_DATA");
        assert_eq!(effective_type("BRAIN", 1), "BRAIN");
        assert_eq!(effective_type("BRAIN", 2), "MASTER");
    }

    #[test]
    fn each_kind_keeps_one_named_file() {
        assert_eq!(file_name("APP_DATA"), "flow_backup.json");
        assert_eq!(file_name("MASTER"), "flow_master_backup.zip");
        assert_eq!(file_name("BRAIN"), "flow_brain_backup.zip");
    }

    #[test]
    fn a_folder_must_exist_and_be_absolute() {
        let dir = std::env::temp_dir();
        assert!(usable_folder(dir.to_str().unwrap()).is_some());
        assert!(usable_folder("relative/path").is_none());
        let missing = dir.join(format!("flow-no-such-{}", uuid::Uuid::new_v4()));
        assert!(usable_folder(missing.to_str().unwrap()).is_none());
    }
}
