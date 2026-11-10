//! "Remind me" on an upcoming video, from Flow for Android's `UpcomingVideoReminderWorker`. A reminder
//! is kept with the profile until the video's start, then lands in the inbox as a notification; one
//! that came due while the app was closed lands at the next launch.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db;
use crate::errors::{AppError, AppResult};
use crate::services::notification_service::{PendingNotification, deliver};

const KEY_REMINDERS: &str = "upcoming_video_reminders";
const KIND_UPCOMING: &str = "UPCOMING_LIVE";
const CHECK_EVERY: Duration = Duration::from_secs(30);
const STARTUP_DELAY: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingReminder {
    pub video_id: String,
    pub release_time_ms: i64,
    pub title: String,
    pub channel_name: String,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
}

/// Splits the reminders into those due now and those still waiting.
fn split_due(
    reminders: Vec<UpcomingReminder>,
    now_ms: i64,
) -> (Vec<UpcomingReminder>, Vec<UpcomingReminder>) {
    reminders
        .into_iter()
        .partition(|reminder| reminder.release_time_ms <= now_ms)
}

/// `reminder` replacing any earlier one for the same video.
fn with_reminder(
    mut reminders: Vec<UpcomingReminder>,
    reminder: UpcomingReminder,
) -> Vec<UpcomingReminder> {
    reminders.retain(|other| other.video_id != reminder.video_id);
    reminders.push(reminder);
    reminders
}

pub async fn load(pool: &sqlx::SqlitePool) -> AppResult<Vec<UpcomingReminder>> {
    Ok(db::settings::get_setting(pool, KEY_REMINDERS)
        .await?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

async fn save(pool: &sqlx::SqlitePool, reminders: &[UpcomingReminder]) -> AppResult<()> {
    let raw =
        serde_json::to_string(reminders).map_err(|error| AppError::Internal(error.to_string()))?;
    db::settings::set_setting(pool, KEY_REMINDERS, &raw).await
}

pub async fn set(pool: &sqlx::SqlitePool, reminder: UpcomingReminder) -> AppResult<()> {
    save(pool, &with_reminder(load(pool).await?, reminder)).await
}

pub async fn cancel(pool: &sqlx::SqlitePool, video_id: &str) -> AppResult<()> {
    let mut reminders = load(pool).await?;
    reminders.retain(|reminder| reminder.video_id != video_id);
    save(pool, &reminders).await
}

async fn deliver_due(app: &AppHandle, pool: &sqlx::SqlitePool) -> AppResult<()> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let (due, waiting) = split_due(load(pool).await?, now_ms);
    if due.is_empty() {
        return Ok(());
    }
    // Saved first: a reminder is never shown twice, even if the inbox write fails.
    save(pool, &waiting).await?;
    let pending: Vec<PendingNotification> = due
        .into_iter()
        .map(|reminder| PendingNotification {
            video_id: reminder.video_id,
            title: reminder.title,
            channel_id: reminder.channel_id,
            channel_name: reminder.channel_name,
            thumbnail_url: reminder.thumbnail_url,
            published_text: None,
            kind: KIND_UPCOMING,
        })
        .collect();
    deliver(app, pool, &pending).await.map(|_| ())
}

/// Reminders fall due at their own time, far more often than the subscription poll runs.
pub fn spawn_loop(app: AppHandle, pool: sqlx::SqlitePool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            if let Err(error) = deliver_due(&app, &pool).await {
                tracing::warn!(%error, "Upcoming reminder pass failed");
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(id: &str, at: i64) -> UpcomingReminder {
        UpcomingReminder {
            video_id: id.to_string(),
            release_time_ms: at,
            title: id.to_string(),
            channel_name: "Channel".to_string(),
            channel_id: None,
            thumbnail_url: None,
        }
    }

    #[test]
    fn what_came_due_while_closed_is_due_now() {
        let (due, waiting) = split_due(
            vec![
                reminder("past", 5),
                reminder("now", 10),
                reminder("later", 11),
            ],
            10,
        );
        assert_eq!(
            due.iter().map(|r| r.video_id.as_str()).collect::<Vec<_>>(),
            ["past", "now"]
        );
        assert_eq!(waiting.len(), 1);
    }

    #[test]
    fn a_new_time_replaces_the_old_reminder() {
        let reminders = with_reminder(vec![reminder("v", 5), reminder("w", 6)], reminder("v", 9));
        assert_eq!(reminders.len(), 2);
        assert_eq!(
            reminders
                .iter()
                .find(|r| r.video_id == "v")
                .unwrap()
                .release_time_ms,
            9
        );
    }

    #[test]
    fn a_reminder_survives_a_round_trip_through_settings() {
        let original = vec![reminder("v", 5)];
        let raw = serde_json::to_string(&original).unwrap();
        let back: Vec<UpcomingReminder> = serde_json::from_str(&raw).unwrap();
        assert_eq!(back, original);
    }
}
