//! Unfinished downloads. A row exists from the moment a download is queued until it
//! completes or is cancelled; a failed one stays so it can be retried.

use crate::errors::{AppError, AppResult};
use sqlx::SqlitePool;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct DownloadJobRow {
    pub id: String,
    pub request_json: String,
    pub file_path: String,
    pub status: String,
    pub error: Option<String>,
}

pub async fn insert_job(
    pool: &SqlitePool,
    id: &str,
    request_json: &str,
    file_path: &str,
) -> AppResult<()> {
    let pool = crate::db::device::pool(pool);
    sqlx::query(
        "INSERT OR REPLACE INTO download_jobs (id, request_json, file_path, status) VALUES (?, ?, ?, 'queued')",
    )
    .bind(id)
    .bind(request_json)
    .bind(file_path)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

pub async fn set_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    error: Option<&str>,
) -> AppResult<()> {
    let pool = crate::db::device::pool(pool);
    sqlx::query(
        "UPDATE download_jobs SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(status)
    .bind(error)
    .bind(id)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

pub async fn delete_job(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let pool = crate::db::device::pool(pool);
    sqlx::query("DELETE FROM download_jobs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(AppError::from)?;
    Ok(())
}

pub async fn job(pool: &SqlitePool, id: &str) -> AppResult<Option<DownloadJobRow>> {
    let pool = crate::db::device::pool(pool);
    sqlx::query_as::<_, DownloadJobRow>(
        "SELECT id, request_json, file_path, status, error FROM download_jobs WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)
}

pub async fn list_jobs(pool: &SqlitePool) -> AppResult<Vec<DownloadJobRow>> {
    let pool = crate::db::device::pool(pool);
    sqlx::query_as::<_, DownloadJobRow>(
        "SELECT id, request_json, file_path, status, error FROM download_jobs ORDER BY created_at, id",
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
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

    #[tokio::test]
    async fn a_job_moves_through_its_states_until_deleted() {
        let pool = pool().await;
        insert_job(&pool, "j1", "{}", "/v/a.mp4").await.unwrap();
        set_status(&pool, "j1", "failed", Some("HTTP 403"))
            .await
            .unwrap();
        let row = job(&pool, "j1").await.unwrap().unwrap();
        assert_eq!(row.status, "failed");
        assert_eq!(row.error.as_deref(), Some("HTTP 403"));
        assert_eq!(list_jobs(&pool).await.unwrap().len(), 1);
        delete_job(&pool, "j1").await.unwrap();
        assert!(job(&pool, "j1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn unknown_statuses_are_refused() {
        let pool = pool().await;
        insert_job(&pool, "j2", "{}", "/v/b.mp4").await.unwrap();
        assert!(set_status(&pool, "j2", "downloading", None).await.is_err());
    }
}
