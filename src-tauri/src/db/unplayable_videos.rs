//! Videos that failed to play for a reason that belongs to the video, so feeds stop offering them.
//! Ported from Flow for Android's `unplayable_video_ids`.

use std::collections::HashSet;

use sqlx::SqlitePool;

use crate::errors::AppResult;

const MAX_IDS: i64 = 1_000;

/// Records `video_id` as refused for `reason`, keeping the newest thousand.
pub async fn mark(pool: &SqlitePool, video_id: &str, reason: &str, now_ms: i64) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT OR REPLACE INTO unplayable_videos (video_id, reason, marked_at) VALUES (?, ?, ?)",
    )
    .bind(video_id)
    .bind(reason)
    .bind(now_ms)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM unplayable_videos WHERE video_id NOT IN (
             SELECT video_id FROM unplayable_videos ORDER BY marked_at DESC LIMIT ?)",
    )
    .bind(MAX_IDS)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// A video that played is no longer unplayable.
pub async fn clear(pool: &SqlitePool, video_id: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM unplayable_videos WHERE video_id = ?")
        .bind(video_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn all(pool: &SqlitePool) -> AppResult<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT video_id FROM unplayable_videos")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_refused_video_stays_listed_until_it_plays() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        mark(&pool, "members", "membersOnly", 1).await.unwrap();
        mark(&pool, "region", "geographicRestriction", 2)
            .await
            .unwrap();
        clear(&pool, "region").await.unwrap();
        assert_eq!(
            all(&pool).await.unwrap(),
            HashSet::from(["members".to_string()])
        );
    }
}
