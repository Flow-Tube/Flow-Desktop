//! Videos whose kind was read from their player response. Each is looked up once, and a Short
//! found this way joins the known Shorts.

use std::collections::HashSet;

use sqlx::SqlitePool;

use crate::errors::AppResult;

/// A check this old is let go; by then the upload is past the window that asks.
const KEEP_MS: i64 = 30 * 86_400_000;

/// Records each `(video id, is a Short)` as checked at `now_ms`, and the Shorts as known Shorts.
pub async fn record(pool: &SqlitePool, kinds: &[(String, bool)], now_ms: i64) -> AppResult<()> {
    if kinds.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for (id, is_short) in kinds {
        sqlx::query(
            "INSERT OR REPLACE INTO video_kind_checks (video_id, is_short, checked_at) VALUES (?, ?, ?)",
        )
        .bind(id)
        .bind(is_short)
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("DELETE FROM video_kind_checks WHERE checked_at < ?")
        .bind(now_ms.saturating_sub(KEEP_MS))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let shorts: Vec<String> = kinds
        .iter()
        .filter(|(_, is_short)| *is_short)
        .map(|(id, _)| id.clone())
        .collect();
    crate::db::known_shorts::remember(pool, &shorts, now_ms).await
}

/// Which of `ids` were checked already.
pub async fn checked_among(pool: &SqlitePool, ids: &[String]) -> AppResult<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT video_id FROM video_kind_checks WHERE video_id IN (SELECT value FROM json_each(?))",
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
    async fn a_checked_short_becomes_a_known_short_and_old_checks_go() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        record(&pool, &[("old".into(), false)], 0).await.unwrap();
        record(
            &pool,
            &[("s".into(), true), ("v".into(), false)],
            KEEP_MS + 1,
        )
        .await
        .unwrap();
        let ids = ["old", "s", "v", "x"].map(String::from);
        let checked = checked_among(&pool, &ids).await.unwrap();
        assert_eq!(checked, HashSet::from(["s".into(), "v".into()]));
        let shorts = crate::db::known_shorts::all(&pool).await.unwrap();
        assert_eq!(shorts, HashSet::from(["s".into()]));
    }
}
