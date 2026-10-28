//! Videos known to be Shorts, by id. A source that offers one again without saying so (a related
//! list, an upload whose feed has moved on) cannot slip it back into Home.

use std::collections::HashSet;

use sqlx::SqlitePool;

use crate::errors::AppResult;

/// Ids not seen as a Short for this long are let go.
const KEEP_MS: i64 = 90 * 86_400_000;
const MAX_IDS: i64 = 20_000;

/// Records `ids` as Shorts seen at `now_ms`, then lets go of the stale and the oldest past the cap.
pub async fn remember(pool: &SqlitePool, ids: &[String], now_ms: i64) -> AppResult<()> {
    if ids.iter().all(String::is_empty) {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for id in ids.iter().filter(|id| !id.is_empty()) {
        sqlx::query("INSERT OR REPLACE INTO known_shorts (video_id, seen_at) VALUES (?, ?)")
            .bind(id)
            .bind(now_ms)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM known_shorts WHERE seen_at < ?")
        .bind(now_ms.saturating_sub(KEEP_MS))
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM known_shorts WHERE video_id NOT IN (
             SELECT video_id FROM known_shorts ORDER BY seen_at DESC LIMIT ?)",
    )
    .bind(MAX_IDS)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Every id known to be a Short.
pub async fn all(pool: &SqlitePool) -> AppResult<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT video_id FROM known_shorts")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
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
    async fn a_short_is_kept_until_it_goes_unseen_for_ninety_days() {
        let pool = pool().await;
        let ids = |list: &[&str]| list.iter().map(ToString::to_string).collect::<Vec<_>>();
        remember(&pool, &ids(&["old", "seen-again"]), 0)
            .await
            .unwrap();
        remember(&pool, &ids(&["seen-again", ""]), KEEP_MS - 1)
            .await
            .unwrap();
        remember(&pool, &ids(&["new"]), KEEP_MS + 1).await.unwrap();
        let ids = all(&pool).await.unwrap();
        assert_eq!(ids, HashSet::from(["seen-again".into(), "new".into()]));
    }
}
