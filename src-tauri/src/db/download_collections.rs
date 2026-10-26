use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sqlx::{AssertSqlSafe, SqlitePool};

/// A downloaded playlist/album: a named folder of items tracked together so the
/// Downloads page can show "X of N downloaded".
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DownloadCollectionRecord {
    pub id: Option<i64>,
    pub collection_id: String,
    pub kind: String,
    pub title: String,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
    pub folder_path: String,
    pub total_count: i64,
    #[serde(default)]
    pub created_at: String,
    /// Items of this collection already saved (computed, not a stored column).
    #[serde(default)]
    #[sqlx(default)]
    pub downloaded_count: i64,
    /// The first saved item's stored cover, so the card has art offline.
    #[serde(default)]
    #[sqlx(skip)]
    pub cover_url: Option<String>,
}

// Dynamic queries here only splice this constant and `?` placeholders, never input, so they
// are safe to pass through `AssertSqlSafe`.
const SELECT_COLUMNS: &str =
    "id, collection_id, kind, title, author, thumbnail_url, folder_path, total_count, created_at";

/// Inserts a new collection row and returns its database id.
pub async fn insert_collection(
    pool: &SqlitePool,
    record: &DownloadCollectionRecord,
) -> AppResult<i64> {
    let result = sqlx::query(
        "INSERT INTO download_collections (collection_id, kind, title, author, thumbnail_url, folder_path, total_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&record.collection_id)
    .bind(&record.kind)
    .bind(&record.title)
    .bind(&record.author)
    .bind(&record.thumbnail_url)
    .bind(&record.folder_path)
    .bind(record.total_count)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(result.last_insert_rowid())
}

/// The existing collection for a `(collection_id, kind)`, if one was already saved —
/// re-downloading reuses it (and its folder) rather than duplicating.
pub async fn find_collection(
    pool: &SqlitePool,
    collection_id: &str,
    kind: &str,
) -> AppResult<Option<DownloadCollectionRecord>> {
    let query = format!(
        "SELECT {SELECT_COLUMNS} FROM download_collections WHERE collection_id = ? AND kind = ? LIMIT 1"
    );
    sqlx::query_as::<_, DownloadCollectionRecord>(AssertSqlSafe(query))
        .bind(collection_id)
        .bind(kind)
        .fetch_optional(pool)
        .await
        .map_err(AppError::from)
}

pub async fn set_total_count(pool: &SqlitePool, id: i64, total_count: i64) -> AppResult<()> {
    sqlx::query("UPDATE download_collections SET total_count = ? WHERE id = ?")
        .bind(total_count)
        .bind(id)
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

/// All collections with their live downloaded-item counts, newest first.
pub async fn list_collections(pool: &SqlitePool) -> AppResult<Vec<DownloadCollectionRecord>> {
    let query = format!(
        "SELECT {SELECT_COLUMNS},
            (SELECT COUNT(*) FROM downloads d WHERE d.collection_db_id = c.id) AS downloaded_count
         FROM download_collections c
         ORDER BY created_at DESC, id DESC"
    );
    sqlx::query_as::<_, DownloadCollectionRecord>(AssertSqlSafe(query))
        .fetch_all(pool)
        .await
        .map_err(AppError::from)
}

pub async fn collections_by_ids(
    pool: &SqlitePool,
    ids: &[i64],
) -> AppResult<Vec<DownloadCollectionRecord>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query =
        format!("SELECT {SELECT_COLUMNS} FROM download_collections WHERE id IN ({placeholders})");
    let mut statement = sqlx::query_as::<_, DownloadCollectionRecord>(AssertSqlSafe(query));
    for id in ids {
        statement = statement.bind(id);
    }
    statement.fetch_all(pool).await.map_err(AppError::from)
}

/// The video ids already saved for a collection, used to skip re-downloading them.
pub async fn collection_video_ids(pool: &SqlitePool, id: i64) -> AppResult<Vec<String>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT DISTINCT video_id FROM downloads WHERE collection_db_id = ? AND video_id IS NOT NULL",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)?;
    Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
}

/// Removes the `downloads` rows that belong to the given collections.
pub async fn delete_collection_items(pool: &SqlitePool, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query = format!("DELETE FROM downloads WHERE collection_db_id IN ({placeholders})");
    let mut statement = sqlx::query(AssertSqlSafe(query));
    for id in ids {
        statement = statement.bind(id);
    }
    statement.execute(pool).await.map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_collections(pool: &SqlitePool, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query = format!("DELETE FROM download_collections WHERE id IN ({placeholders})");
    let mut statement = sqlx::query(AssertSqlSafe(query));
    for id in ids {
        statement = statement.bind(id);
    }
    statement.execute(pool).await.map_err(AppError::from)?;
    Ok(())
}
