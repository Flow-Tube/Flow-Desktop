//! Home's SQLite caches, from Flow for Android's `HomeFeedCacheRepository`: the feed as last shown
//! with each card's origin, a reserve of ranked candidates load-more serves first, each seed's
//! related list, and the store of followed channels' uploads.

use std::collections::HashMap;

use sqlx::SqlitePool;

use super::card::Card;
use super::origin::Origin;
use crate::errors::AppResult;

const LAST_FEED: &str = "LAST_FEED";
const RESERVE: &str = "RESERVE";
const RELATED: &str = "RELATED";
const LAST_FEED_CAP: usize = 60;
const RESERVE_CAP: i64 = 200;
const RELATED_PER_SEED_CAP: usize = 20;
const RELATED_SEED_CAP: i64 = 50;
const LAST_FEED_TTL_MS: u64 = 8 * 3_600_000;
const RESERVE_TTL_MS: u64 = 12 * 3_600_000;
const RELATED_TTL_MS: u64 = 90 * 60_000;
const SUBSCRIPTION_STORE_MAX: i64 = 3000;

/// A reserve row: a ranked candidate a page did not use, and the lane it came from.
pub struct ReserveRow {
    pub card: Card,
    pub related: bool,
}

fn ms(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

async fn delete_expired(pool: &SqlitePool, now_ms: u64) -> AppResult<()> {
    sqlx::query("DELETE FROM home_feed_cache WHERE expires_at <= ?")
        .bind(ms(now_ms))
        .execute(pool)
        .await?;
    Ok(())
}

async fn insert(
    pool: &SqlitePool,
    bucket: &str,
    seed_id: &str,
    source: &str,
    rows: &[(&Card, Option<&Origin>)],
    now_ms: u64,
    ttl_ms: u64,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for (index, (card, origin)) in rows.iter().enumerate() {
        sqlx::query(
            "INSERT OR REPLACE INTO home_feed_cache
                 (bucket, seed_id, video_id, source, video, origin, order_index, cached_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(bucket)
        .bind(seed_id)
        .bind(card.id())
        .bind(source)
        .bind(serde_json::to_string(card).unwrap_or_default())
        .bind(origin.and_then(|o| serde_json::to_string(o).ok()))
        .bind(i64::try_from(index).unwrap_or(0))
        .bind(ms(now_ms))
        .bind(ms(now_ms + ttl_ms))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The feed as last shown with its origins, while under eight hours old.
pub async fn load_last_feed(
    pool: &SqlitePool,
    now_ms: u64,
) -> AppResult<(Vec<Card>, HashMap<String, Origin>)> {
    delete_expired(pool, now_ms).await?;
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT video, origin FROM home_feed_cache WHERE bucket = ? ORDER BY order_index",
    )
    .bind(LAST_FEED)
    .fetch_all(pool)
    .await?;
    let mut cards = Vec::new();
    let mut origins = HashMap::new();
    for (video, origin) in rows {
        let Ok(card) = serde_json::from_str::<Card>(&video) else {
            continue;
        };
        if let Some(origin) = origin.and_then(|o| serde_json::from_str::<Origin>(&o).ok()) {
            origins.insert(card.id().to_string(), origin);
        }
        cards.push(card);
    }
    Ok((cards, origins))
}

/// Replaces the last feed with `cards`, at most 60, with their origins (A13: they survive restart).
pub async fn save_last_feed(
    pool: &SqlitePool,
    cards: &[Card],
    origins: &HashMap<String, Origin>,
    now_ms: u64,
) -> AppResult<()> {
    sqlx::query("DELETE FROM home_feed_cache WHERE bucket = ?")
        .bind(LAST_FEED)
        .execute(pool)
        .await?;
    let rows: Vec<(&Card, Option<&Origin>)> = cards
        .iter()
        .take(LAST_FEED_CAP)
        .map(|card| (card, origins.get(card.id())))
        .collect();
    insert(
        pool,
        LAST_FEED,
        "",
        "LAST_FEED",
        &rows,
        now_ms,
        LAST_FEED_TTL_MS,
    )
    .await
}

/// Adds ranked candidates a page did not use to the reserve.
pub async fn save_reserve(
    pool: &SqlitePool,
    cards: &[Card],
    related: bool,
    now_ms: u64,
) -> AppResult<()> {
    if cards.is_empty() {
        return Ok(());
    }
    let source = if related { "RELATED" } else { "DISCOVERY" };
    let rows: Vec<(&Card, Option<&Origin>)> = cards.iter().map(|card| (card, None)).collect();
    insert(pool, RESERVE, "", source, &rows, now_ms, RESERVE_TTL_MS).await?;
    sqlx::query(
        "DELETE FROM home_feed_cache WHERE bucket = ? AND video_id NOT IN (
             SELECT video_id FROM home_feed_cache WHERE bucket = ? ORDER BY cached_at DESC, order_index LIMIT ?)",
    )
    .bind(RESERVE)
    .bind(RESERVE)
    .bind(RESERVE_CAP)
    .execute(pool)
    .await?;
    Ok(())
}

/// Up to `per_source` related and `per_source` discovery rows of the reserve, newest first.
pub async fn load_reserve(
    pool: &SqlitePool,
    per_source: i64,
    now_ms: u64,
) -> AppResult<Vec<ReserveRow>> {
    delete_expired(pool, now_ms).await?;
    let mut out = Vec::new();
    for (source, related) in [("RELATED", true), ("DISCOVERY", false)] {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT video FROM home_feed_cache WHERE bucket = ? AND source = ?
             ORDER BY cached_at DESC, order_index LIMIT ?",
        )
        .bind(RESERVE)
        .bind(source)
        .bind(per_source)
        .fetch_all(pool)
        .await?;
        out.extend(
            rows.into_iter()
                .filter_map(|(video,)| serde_json::from_str::<Card>(&video).ok())
                .map(|card| ReserveRow { card, related }),
        );
    }
    Ok(out)
}

/// Removes served reserve rows, so a later refresh cannot serve them again.
pub async fn consume_reserve(pool: &SqlitePool, ids: &[String]) -> AppResult<()> {
    for id in ids {
        sqlx::query("DELETE FROM home_feed_cache WHERE bucket = ? AND video_id = ?")
            .bind(RESERVE)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// One seed's related list, while under 90 minutes old.
pub async fn load_related(pool: &SqlitePool, seed_id: &str, now_ms: u64) -> AppResult<Vec<Card>> {
    delete_expired(pool, now_ms).await?;
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT video FROM home_feed_cache WHERE bucket = ? AND seed_id = ? ORDER BY order_index",
    )
    .bind(RELATED)
    .bind(seed_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(video,)| serde_json::from_str(&video).ok())
        .collect())
}

pub async fn save_related(
    pool: &SqlitePool,
    seed_id: &str,
    cards: &[Card],
    now_ms: u64,
) -> AppResult<()> {
    if seed_id.is_empty() || cards.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM home_feed_cache WHERE bucket = ? AND seed_id = ?")
        .bind(RELATED)
        .bind(seed_id)
        .execute(pool)
        .await?;
    let rows: Vec<(&Card, Option<&Origin>)> = cards
        .iter()
        .take(RELATED_PER_SEED_CAP)
        .map(|card| (card, None))
        .collect();
    insert(
        pool,
        RELATED,
        seed_id,
        "RELATED",
        &rows,
        now_ms,
        RELATED_TTL_MS,
    )
    .await?;
    sqlx::query(
        "DELETE FROM home_feed_cache WHERE bucket = ? AND seed_id NOT IN (
             SELECT seed_id FROM home_feed_cache WHERE bucket = ?
             GROUP BY seed_id ORDER BY MAX(cached_at) DESC LIMIT ?)",
    )
    .bind(RELATED)
    .bind(RELATED)
    .bind(RELATED_SEED_CAP)
    .execute(pool)
    .await?;
    Ok(())
}

/// Forgets every Home cache, as a refresh after a taste reset does.
pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM home_feed_cache")
        .execute(pool)
        .await?;
    Ok(())
}

/// The stored uploads of followed channels, newest first.
pub async fn subscription_uploads(pool: &SqlitePool) -> AppResult<Vec<Card>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT card FROM subscription_uploads ORDER BY published_at DESC")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(card,)| serde_json::from_str(&card).ok())
        .collect())
}

/// Merges uploads into the store; a known length is never replaced by an unknown one.
pub async fn merge_subscription_uploads(
    pool: &SqlitePool,
    cards: &[Card],
    now_ms: u64,
) -> AppResult<()> {
    if cards.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for card in cards
        .iter()
        .filter(|c| c.published_at_ms > 0 && !c.channel_id().is_empty())
    {
        let existing: Option<(String,)> =
            sqlx::query_as("SELECT card FROM subscription_uploads WHERE video_id = ?")
                .bind(card.id())
                .fetch_optional(&mut *tx)
                .await?;
        let mut merged = card.clone();
        if let Some(old) = existing.and_then(|(json,)| serde_json::from_str::<Card>(&json).ok())
            && merged.video.duration_seconds.unwrap_or(0) == 0
        {
            merged.video.duration_seconds = old.video.duration_seconds;
        }
        sqlx::query(
            "INSERT OR REPLACE INTO subscription_uploads (video_id, channel_id, published_at, card, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(merged.id())
        .bind(merged.channel_id())
        .bind(ms(merged.published_at_ms))
        .bind(serde_json::to_string(&merged).unwrap_or_default())
        .bind(ms(now_ms))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "DELETE FROM subscription_uploads WHERE video_id NOT IN (
             SELECT video_id FROM subscription_uploads ORDER BY published_at DESC LIMIT ?)",
    )
    .bind(SUBSCRIPTION_STORE_MAX)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// When the store last took an RSS refresh; 0 when never.
pub async fn subscription_store_updated_at(pool: &SqlitePool) -> AppResult<u64> {
    let at: Option<i64> = sqlx::query_scalar("SELECT MAX(updated_at) FROM subscription_uploads")
        .fetch_one(pool)
        .await?;
    Ok(at.and_then(|v| u64::try_from(v).ok()).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;
    use crate::services::home_feed::origin::OriginKind;

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
    async fn the_last_feed_keeps_its_order_and_origins_for_eight_hours() {
        let pool = pool().await;
        let cards = vec![card("b", "c1", ""), card("a", "c2", "")];
        let origins = HashMap::from([(
            "a".to_string(),
            Origin::new(OriginKind::Search, Some("chess".into())),
        )]);
        save_last_feed(&pool, &cards, &origins, 1_000)
            .await
            .unwrap();
        let (loaded, loaded_origins) = load_last_feed(&pool, 2_000).await.unwrap();
        assert_eq!(loaded.iter().map(Card::id).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(loaded_origins["a"].detail.as_deref(), Some("chess"));
        assert!(
            load_last_feed(&pool, 1_000 + LAST_FEED_TTL_MS)
                .await
                .unwrap()
                .0
                .is_empty()
        );
    }

    #[tokio::test]
    async fn served_reserve_rows_are_gone() {
        let pool = pool().await;
        save_reserve(
            &pool,
            &[card("r1", "c", ""), card("r2", "d", "")],
            true,
            1_000,
        )
        .await
        .unwrap();
        consume_reserve(&pool, &["r1".to_string()]).await.unwrap();
        let rows = load_reserve(&pool, 16, 2_000).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].related);
    }

    #[tokio::test]
    async fn a_known_length_survives_an_rss_merge() {
        let pool = pool().await;
        let mut timed = card("v", "UC1", "");
        timed.published_at_ms = 500;
        merge_subscription_uploads(&pool, &[timed.clone()], 1_000)
            .await
            .unwrap();
        timed.video.duration_seconds = None;
        merge_subscription_uploads(&pool, &[timed], 2_000)
            .await
            .unwrap();
        let stored = subscription_uploads(&pool).await.unwrap();
        assert_eq!(stored[0].video.duration_seconds, Some(600));
    }
}
