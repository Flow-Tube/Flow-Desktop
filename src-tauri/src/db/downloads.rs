use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sqlx::{AssertSqlSafe, Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: Option<i64>,
    pub video_id: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub media_kind: String,
    pub file_path: String,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<i64>,
    pub quality_label: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub collection_db_id: Option<i64>,
    pub loudness_db: Option<f64>,
    #[serde(default)]
    pub created_at: String,
}

// Dynamic queries here only splice this constant and `?` placeholders, never input, so they
// are safe to pass through `AssertSqlSafe`.
const SELECT_COLUMNS: &str = "id, video_id, title, author, media_kind, file_path, thumbnail_url, duration_seconds, quality_label, file_size_bytes, collection_db_id, loudness_db, created_at";

/// Inserts a completed download, replacing any prior entry for the same `video_id`
/// (re-downloading a video updates its library entry rather than duplicating it).
pub async fn upsert_download(pool: &SqlitePool, record: &DownloadRecord) -> AppResult<()> {
    if let Some(video_id) = record.video_id.as_deref() {
        match record.collection_db_id {
            Some(collection_db_id) => {
                sqlx::query("DELETE FROM downloads WHERE video_id = ? AND collection_db_id = ?")
                    .bind(video_id)
                    .bind(collection_db_id)
                    .execute(pool)
                    .await
                    .map_err(AppError::from)?;
            }
            None => {
                sqlx::query(
                    "DELETE FROM downloads WHERE video_id = ? AND collection_db_id IS NULL",
                )
                .bind(video_id)
                .execute(pool)
                .await
                .map_err(AppError::from)?;
            }
        }
    }

    sqlx::query(
        "INSERT INTO downloads (video_id, title, author, media_kind, file_path, thumbnail_url, duration_seconds, quality_label, file_size_bytes, collection_db_id, loudness_db)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&record.video_id)
    .bind(&record.title)
    .bind(&record.author)
    .bind(&record.media_kind)
    .bind(&record.file_path)
    .bind(&record.thumbnail_url)
    .bind(record.duration_seconds)
    .bind(&record.quality_label)
    .bind(record.file_size_bytes)
    .bind(record.collection_db_id)
    .bind(record.loudness_db)
    .execute(pool)
    .await
    .map_err(AppError::from)?;

    Ok(())
}

pub async fn downloads_for_collection(
    pool: &SqlitePool,
    collection_db_id: i64,
) -> AppResult<Vec<DownloadRecord>> {
    let query = format!("SELECT {SELECT_COLUMNS} FROM downloads WHERE collection_db_id = ?");
    sqlx::query_as::<_, DownloadRecord>(AssertSqlSafe(query))
        .bind(collection_db_id)
        .fetch_all(pool)
        .await
        .map_err(AppError::from)
}

pub async fn list_downloads(pool: &SqlitePool) -> AppResult<Vec<DownloadRecord>> {
    let query = format!("SELECT {SELECT_COLUMNS} FROM downloads ORDER BY created_at DESC, id DESC");
    sqlx::query_as::<_, DownloadRecord>(AssertSqlSafe(query))
        .fetch_all(pool)
        .await
        .map_err(AppError::from)
}

/// The saved download for a `video_id`, if any. There is at most one (upsert
/// replaces by `video_id`); offline playback resolves the file path from it.
pub async fn download_by_video_id(
    pool: &SqlitePool,
    video_id: &str,
) -> AppResult<Option<DownloadRecord>> {
    let query = format!("SELECT {SELECT_COLUMNS} FROM downloads WHERE video_id = ? LIMIT 1");
    sqlx::query_as::<_, DownloadRecord>(AssertSqlSafe(query))
        .bind(video_id)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)
}

pub async fn downloads_by_ids(pool: &SqlitePool, ids: &[i64]) -> AppResult<Vec<DownloadRecord>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query = format!("SELECT {SELECT_COLUMNS} FROM downloads WHERE id IN ({placeholders})");
    let mut statement = sqlx::query_as::<_, DownloadRecord>(AssertSqlSafe(query));
    for id in ids {
        statement = statement.bind(id);
    }
    statement.fetch_all(pool).await.map_err(AppError::from)
}

pub async fn delete_downloads(pool: &SqlitePool, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query = format!("DELETE FROM downloads WHERE id IN ({placeholders})");
    let mut statement = sqlx::query(AssertSqlSafe(query));
    for id in ids {
        statement = statement.bind(id);
    }
    statement.execute(pool).await.map_err(AppError::from)?;
    Ok(())
}

pub async fn clear_downloads(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM downloads")
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// All distinct `video_id`s with a saved download, for fast "is this downloaded?" checks.
pub async fn downloaded_video_ids(pool: &SqlitePool) -> AppResult<Vec<String>> {
    let rows = sqlx::query("SELECT DISTINCT video_id FROM downloads WHERE video_id IS NOT NULL")
        .fetch_all(pool)
        .await
        .map_err(AppError::from)?;
    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn song(loudness_db: Option<f64>) -> DownloadRecord {
        DownloadRecord {
            id: None,
            video_id: Some("abc123def45".into()),
            title: "Song".into(),
            author: None,
            media_kind: "music".into(),
            file_path: "/music/Song.m4a".into(),
            thumbnail_url: None,
            duration_seconds: Some(200),
            quality_label: None,
            file_size_bytes: None,
            collection_db_id: None,
            loudness_db,
            created_at: String::new(),
        }
    }

    #[tokio::test]
    async fn a_downloaded_song_keeps_its_loudness() {
        let pool = pool().await;
        upsert_download(&pool, &song(Some(4.5))).await.unwrap();
        let saved = download_by_video_id(&pool, "abc123def45")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.loudness_db, Some(4.5));

        upsert_download(&pool, &song(None)).await.unwrap();
        let replaced = download_by_video_id(&pool, "abc123def45")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(replaced.loudness_db, None);
    }
}
