use crate::errors::{AppError, AppResult};
use crate::models::video::VideoSummary;
use sqlx::SqlitePool;

#[allow(dead_code)]
pub async fn cache_video_summary(
    pool: &SqlitePool,
    video: &VideoSummary,
    expires_in_seconds: i64,
) -> AppResult<()> {
    let duration_secs = video.duration_seconds.map(|d| d as i64);

    // Calculate expiration timestamp using SQLite string formatting
    sqlx::query(
        "INSERT INTO video_cache (video_id, title, channel_name, thumbnail_url, duration_seconds, description, cached_at, expires_at)
         VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, datetime('now', '+' || ? || ' seconds'))
         ON CONFLICT(video_id) DO UPDATE SET
            title = excluded.title,
            channel_name = excluded.channel_name,
            thumbnail_url = excluded.thumbnail_url,
            duration_seconds = excluded.duration_seconds,
            cached_at = CURRENT_TIMESTAMP,
            expires_at = excluded.expires_at"
    )
    .bind(&video.id)
    .bind(&video.title)
    .bind(&video.channel_name)
    .bind(&video.thumbnail_url)
    .bind(duration_secs)
    .bind(expires_in_seconds)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(())
}

#[allow(dead_code)]
pub async fn get_cached_video_summary(
    pool: &SqlitePool,
    video_id: &str,
) -> AppResult<Option<VideoSummary>> {
    // Delete expired cache items first
    sqlx::query("DELETE FROM video_cache WHERE datetime(expires_at) < datetime('now')")
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    let row = sqlx::query(
        "SELECT video_id, title, channel_name, thumbnail_url, duration_seconds
         FROM video_cache
         WHERE video_id = ? AND datetime(expires_at) >= datetime('now')
         LIMIT 1",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;

    if let Some(r) = row {
        let id: String = sqlx::Row::get(&r, 0);
        let title: String = sqlx::Row::get(&r, 1);
        let channel_name: Option<String> = sqlx::Row::get(&r, 2);
        let thumbnail_url: Option<String> = sqlx::Row::get(&r, 3);
        let duration_seconds: Option<i64> = sqlx::Row::get(&r, 4);

        Ok(Some(VideoSummary {
            id,
            title,
            channel_name: channel_name.unwrap_or_default(),
            channel_id: None,
            thumbnail_url,
            duration_seconds: duration_seconds.map(|d| d as u64),
            published_text: None,
            view_count_text: None,
            channel_avatar_url: None,
            is_live: false,
            ..Default::default()
        }))
    } else {
        Ok(None)
    }
}

#[allow(dead_code)]
pub async fn clear_cache(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM video_cache")
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

pub async fn get_cached_dearrow(
    pool: &SqlitePool,
    video_id: &str,
) -> AppResult<Option<crate::api::dearrow::DeArrowOverride>> {
    let row = sqlx::query(
        "SELECT title, thumbnail_url
         FROM dearrow_cache
         WHERE video_id = ? AND datetime(cached_at) >= datetime('now', '-7 days')
         LIMIT 1",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;

    if let Some(r) = row {
        let title: Option<String> = sqlx::Row::get(&r, 0);
        let thumbnail_url: Option<String> = sqlx::Row::get(&r, 1);
        Ok(Some(crate::api::dearrow::DeArrowOverride {
            title,
            thumbnail_url,
        }))
    } else {
        Ok(None)
    }
}

pub async fn cache_dearrow(
    pool: &SqlitePool,
    video_id: &str,
    override_data: &crate::api::dearrow::DeArrowOverride,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO dearrow_cache (video_id, title, thumbnail_url, cached_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(video_id) DO UPDATE SET
            title = excluded.title,
            thumbnail_url = excluded.thumbnail_url,
            cached_at = CURRENT_TIMESTAMP",
    )
    .bind(video_id)
    .bind(&override_data.title)
    .bind(&override_data.thumbnail_url)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(())
}

pub async fn cleanup_dearrow_cache(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM dearrow_cache WHERE datetime(cached_at) < datetime('now', '-7 days')")
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}
