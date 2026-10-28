//! Videos the viewer was shown in a recommendation list, kept so "Hide videos you've already seen"
//! can leave them out for good.

use std::collections::HashSet;

use sqlx::SqlitePool;

use crate::errors::AppResult;

const MAX_IDS: i64 = 100_000;

/// Records `ids` as seen at `now_ms`, keeping the newest hundred thousand.
pub async fn remember(pool: &SqlitePool, ids: &[String], now_ms: i64) -> AppResult<()> {
    if ids.iter().all(String::is_empty) {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for id in ids.iter().filter(|id| !id.is_empty()) {
        sqlx::query("INSERT OR REPLACE INTO seen_videos (video_id, seen_at) VALUES (?, ?)")
            .bind(id)
            .bind(now_ms)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "DELETE FROM seen_videos WHERE seen_at < (
             SELECT seen_at FROM seen_videos ORDER BY seen_at DESC LIMIT 1 OFFSET ?)",
    )
    .bind(MAX_IDS - 1)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Every video seen.
pub async fn all(pool: &SqlitePool) -> AppResult<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT video_id FROM seen_videos")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Which of `ids` were seen.
pub async fn among(pool: &SqlitePool, ids: &[String]) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT video_id FROM seen_videos WHERE video_id IN (SELECT value FROM json_each(?))",
    )
    .bind(serde_json::to_string(ids).unwrap_or_default())
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seen_videos_are_found_among_a_list() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let ids = |list: &[&str]| list.iter().map(ToString::to_string).collect::<Vec<_>>();
        remember(&pool, &ids(&["a", "b", ""]), 1).await.unwrap();
        let mut found = among(&pool, &ids(&["b", "c", "a"])).await.unwrap();
        found.sort();
        assert_eq!(found, ["a", "b"]);
        assert_eq!(all(&pool).await.unwrap().len(), 2);
    }
}
