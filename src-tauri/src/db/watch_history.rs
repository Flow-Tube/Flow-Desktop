use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WatchHistoryRecord {
    pub id: Option<i64>,
    pub video_id: String,
    pub title: String,
    pub channel_name: Option<String>,
    pub watch_date: String,
    pub watch_duration_seconds: i64,
    pub total_duration_seconds: Option<i64>,
    #[serde(default)]
    pub is_music: bool,
}

pub async fn upsert_watch_record(pool: &SqlitePool, record: &WatchHistoryRecord) -> AppResult<()> {
    // Check if record already exists for this video_id
    let existing = sqlx::query("SELECT id FROM watch_history WHERE video_id = ? LIMIT 1")
        .bind(&record.video_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)?;

    if let Some(row) = existing {
        let id: i64 = sqlx::Row::get(&row, 0);
        // Clearing the sync stamp makes it follow the new watch time, so a re-watch beats a
        // deletion synced from another device before it.
        sqlx::query(
            "UPDATE watch_history SET
                title = ?,
                channel_name = ?,
                watch_date = ?,
                watch_duration_seconds = ?,
                total_duration_seconds = ?,
                is_music = ?,
                updated_hlc = NULL
             WHERE id = ?",
        )
        .bind(&record.title)
        .bind(&record.channel_name)
        .bind(&record.watch_date)
        .bind(record.watch_duration_seconds)
        .bind(record.total_duration_seconds)
        .bind(record.is_music)
        .bind(id)
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    } else {
        sqlx::query(
            "INSERT INTO watch_history (video_id, title, channel_name, watch_date, watch_duration_seconds, total_duration_seconds, is_music)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&record.video_id)
        .bind(&record.title)
        .bind(&record.channel_name)
        .bind(&record.watch_date)
        .bind(record.watch_duration_seconds)
        .bind(record.total_duration_seconds)
        .bind(record.is_music)
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    }

    Ok(())
}

pub async fn upsert_watch_records_bulk(
    pool: &SqlitePool,
    records: &[WatchHistoryRecord],
) -> AppResult<()> {
    if records.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(AppError::from)?;

    for record in records {
        let existing = sqlx::query("SELECT id FROM watch_history WHERE video_id = ? LIMIT 1")
            .bind(&record.video_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(AppError::from)?;

        if let Some(row) = existing {
            let id: i64 = sqlx::Row::get(&row, 0);
            sqlx::query(
                "UPDATE watch_history SET
                    title = ?,
                    channel_name = ?,
                    watch_date = ?,
                    watch_duration_seconds = ?,
                    total_duration_seconds = ?,
                    is_music = ?,
                    updated_hlc = NULL
                 WHERE id = ?",
            )
            .bind(&record.title)
            .bind(&record.channel_name)
            .bind(&record.watch_date)
            .bind(record.watch_duration_seconds)
            .bind(record.total_duration_seconds)
            .bind(record.is_music)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;
        } else {
            sqlx::query(
                "INSERT INTO watch_history (video_id, title, channel_name, watch_date, watch_duration_seconds, total_duration_seconds, is_music)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&record.video_id)
            .bind(&record.title)
            .bind(&record.channel_name)
            .bind(&record.watch_date)
            .bind(record.watch_duration_seconds)
            .bind(record.total_duration_seconds)
            .bind(record.is_music)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from)?;
        }
    }

    tx.commit().await.map_err(AppError::from)?;

    Ok(())
}

pub async fn get_watch_history(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<WatchHistoryRecord>> {
    let records = sqlx::query_as::<_, WatchHistoryRecord>(
        "SELECT id, video_id, title, channel_name, watch_date, watch_duration_seconds, total_duration_seconds, is_music
         FROM watch_history
         ORDER BY watch_date DESC, created_at DESC
         LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;

    Ok(records)
}

pub async fn get_music_history(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<WatchHistoryRecord>> {
    let records = sqlx::query_as::<_, WatchHistoryRecord>(
        "SELECT id, video_id, title, channel_name, watch_date, watch_duration_seconds, total_duration_seconds, is_music
         FROM watch_history
         WHERE is_music = 1
         ORDER BY watch_date DESC, created_at DESC
         LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;

    Ok(records)
}

#[allow(dead_code)]
pub async fn get_watch_record(
    pool: &SqlitePool,
    video_id: &str,
) -> AppResult<Option<WatchHistoryRecord>> {
    let record = sqlx::query_as::<_, WatchHistoryRecord>(
        "SELECT id, video_id, title, channel_name, watch_date, watch_duration_seconds, total_duration_seconds, is_music
         FROM watch_history
         WHERE video_id = ?
         LIMIT 1"
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;

    Ok(record)
}

pub async fn delete_watch_record(pool: &SqlitePool, video_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM watch_history WHERE video_id = ?")
        .bind(video_id)
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(())
}

pub async fn clear_watch_history(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM watch_history")
        .execute(pool)
        .await
        .map_err(AppError::from)?;

    Ok(())
}
