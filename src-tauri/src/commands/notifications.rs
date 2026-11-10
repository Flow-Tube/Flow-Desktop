use tauri::{AppHandle, State};

use crate::db;
use crate::db::notifications::NotificationRecord;
use crate::errors::ErrorResponse;
use crate::services::notification_service;
use crate::services::upcoming_reminders::{self, UpcomingReminder};

const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;

#[tauri::command]
pub async fn get_notifications(
    limit: Option<i64>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<Vec<NotificationRecord>, ErrorResponse> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    db::notifications::list_notifications(&pool, limit)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_unread_notification_count(
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<i64, ErrorResponse> {
    db::notifications::unread_count(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn mark_notifications_read(
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    db::notifications::mark_all_read(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_notification(
    id: i64,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    db::notifications::delete_notification(&pool, id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn restore_notification(
    notification: NotificationRecord,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    db::notifications::restore_notification(&pool, &notification)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_upcoming_reminders(
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<Vec<UpcomingReminder>, ErrorResponse> {
    upcoming_reminders::load(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn set_upcoming_reminder(
    reminder: UpcomingReminder,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    upcoming_reminders::set(&pool, reminder)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn cancel_upcoming_reminder(
    video_id: String,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    upcoming_reminders::cancel(&pool, &video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_notifications(pool: State<'_, sqlx::SqlitePool>) -> Result<(), ErrorResponse> {
    db::notifications::clear_notifications(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn check_subscriptions_now(
    app: AppHandle,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<usize, ErrorResponse> {
    notification_service::poll_subscriptions(&app, &pool)
        .await
        .map_err(ErrorResponse::from)
}
