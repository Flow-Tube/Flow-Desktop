use crate::errors::{AppError, AppResult};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecord {
    pub id: i64,
    pub video_id: String,
    pub title: String,
    pub channel_id: Option<String>,
    pub channel_name: String,
    pub thumbnail_url: Option<String>,
    pub published_text: Option<String>,
    pub kind: String,
    pub is_read: bool,
    pub created_at: i64,
}

pub struct NewNotification {
    pub video_id: String,
    pub title: String,
    pub channel_id: Option<String>,
    pub channel_name: String,
    pub thumbnail_url: Option<String>,
    pub published_text: Option<String>,
    pub kind: &'static str,
    pub created_at: i64,
}

pub async fn insert_notification(
    pool: &SqlitePool,
    notification: &NewNotification,
) -> AppResult<i64> {
    let result = sqlx::query(
        "INSERT INTO notifications
            (video_id, title, channel_id, channel_name, thumbnail_url, published_text, kind, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(&notification.video_id)
    .bind(&notification.title)
    .bind(&notification.channel_id)
    .bind(&notification.channel_name)
    .bind(&notification.thumbnail_url)
    .bind(&notification.published_text)
    .bind(notification.kind)
    .bind(notification.created_at)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(result.last_insert_rowid())
}

pub async fn list_notifications(
    pool: &SqlitePool,
    limit: i64,
) -> AppResult<Vec<NotificationRecord>> {
    let rows = sqlx::query(
        "SELECT id, video_id, title, channel_id, channel_name, thumbnail_url, published_text, kind, is_read, created_at
         FROM notifications
         ORDER BY created_at DESC, id DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;

    Ok(rows
        .into_iter()
        .map(|r| NotificationRecord {
            id: r.get::<i64, _>("id"),
            video_id: r.get::<String, _>("video_id"),
            title: r.get::<String, _>("title"),
            channel_id: r.get::<Option<String>, _>("channel_id"),
            channel_name: r.get::<String, _>("channel_name"),
            thumbnail_url: r.get::<Option<String>, _>("thumbnail_url"),
            published_text: r.get::<Option<String>, _>("published_text"),
            kind: r.get::<String, _>("kind"),
            is_read: r.get::<i64, _>("is_read") != 0,
            created_at: r.get::<i64, _>("created_at"),
        })
        .collect())
}

pub async fn unread_count(pool: &SqlitePool) -> AppResult<i64> {
    let row = sqlx::query("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0")
        .fetch_one(pool)
        .await
        .map_err(AppError::from)?;
    Ok(row.get::<i64, _>("count"))
}

pub async fn mark_all_read(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("UPDATE notifications SET is_read = 1 WHERE is_read = 0")
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_notification(pool: &SqlitePool, id: i64) -> AppResult<()> {
    sqlx::query("DELETE FROM notifications WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// Puts a removed notification back as it was, for Undo.
pub async fn restore_notification(pool: &SqlitePool, record: &NotificationRecord) -> AppResult<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO notifications
            (id, video_id, title, channel_id, channel_name, thumbnail_url, published_text, kind, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(record.id)
    .bind(&record.video_id)
    .bind(&record.title)
    .bind(&record.channel_id)
    .bind(&record.channel_name)
    .bind(&record.thumbnail_url)
    .bind(&record.published_text)
    .bind(&record.kind)
    .bind(record.is_read)
    .bind(record.created_at)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

pub async fn clear_notifications(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM notifications")
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// The per-channel watermark: the last-seen latest video id. `None` means the
/// channel has never been checked (first-ever check must stay silent).
pub async fn get_watermark(pool: &SqlitePool, channel_id: &str) -> AppResult<Option<String>> {
    let row = sqlx::query(
        "SELECT last_video_id FROM subscription_watermarks WHERE channel_id = ? LIMIT 1",
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;

    Ok(row.and_then(|r| r.get::<Option<String>, _>("last_video_id")))
}

pub async fn set_watermark(
    pool: &SqlitePool,
    channel_id: &str,
    latest_video_id: &str,
    checked_at: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO subscription_watermarks (channel_id, last_video_id, last_check_time)
         VALUES (?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET
            last_video_id = excluded.last_video_id,
            last_check_time = excluded.last_check_time",
    )
    .bind(channel_id)
    .bind(latest_video_id)
    .bind(checked_at)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}
