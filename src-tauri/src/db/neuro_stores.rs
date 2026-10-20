//! The video engine's side stores: channel categories, co-watch sources and watch-time topics.

use sqlx::SqlitePool;

use crate::errors::AppResult;

/// One channel's count of watched videos in one category.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ChannelCategoryRow {
    pub channel_id: String,
    pub category: String,
    pub count: i64,
    pub seen_at: i64,
}

pub async fn load_categories(pool: &SqlitePool) -> AppResult<Vec<ChannelCategoryRow>> {
    Ok(sqlx::query_as::<_, ChannelCategoryRow>(
        "SELECT channel_id, category, count, seen_at FROM neuro_channel_categories",
    )
    .fetch_all(pool)
    .await?)
}

/// Counts one more watched video of `channel_id` in `category`.
pub async fn record_category(
    pool: &SqlitePool,
    channel_id: &str,
    category: &str,
    seen_at: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO neuro_channel_categories (channel_id, category, count, seen_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(channel_id, category) DO UPDATE SET count = count + 1, seen_at = excluded.seen_at",
    )
    .bind(channel_id)
    .bind(category)
    .bind(seen_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Keeps the `keep` channels seen most recently.
pub async fn prune_categories(pool: &SqlitePool, keep: i64) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM neuro_channel_categories WHERE channel_id NOT IN (
             SELECT channel_id FROM neuro_channel_categories
             GROUP BY channel_id ORDER BY MAX(seen_at) DESC LIMIT ?
         )",
    )
    .bind(keep)
    .execute(pool)
    .await?;
    Ok(())
}

/// One related list seen beside a video the viewer took to.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CoWatchRow {
    pub video_id: String,
    pub channel_id: String,
    pub related: String,
    pub names: String,
    pub seen_at: i64,
}

pub async fn load_cowatch(pool: &SqlitePool) -> AppResult<Vec<CoWatchRow>> {
    Ok(sqlx::query_as::<_, CoWatchRow>(
        "SELECT video_id, channel_id, related, names, seen_at FROM neuro_cowatch_sources",
    )
    .fetch_all(pool)
    .await?)
}

/// Stores `row` and keeps the `keep` most recent sources.
pub async fn save_cowatch(pool: &SqlitePool, row: &CoWatchRow, keep: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO neuro_cowatch_sources (video_id, channel_id, related, names, seen_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&row.video_id)
    .bind(&row.channel_id)
    .bind(&row.related)
    .bind(&row.names)
    .bind(row.seen_at)
    .execute(pool)
    .await?;
    sqlx::query(
        "DELETE FROM neuro_cowatch_sources WHERE video_id NOT IN (
             SELECT video_id FROM neuro_cowatch_sources ORDER BY seen_at DESC LIMIT ?
         )",
    )
    .bind(keep)
    .execute(pool)
    .await?;
    Ok(())
}

/// A watched video's topics as JSON, under the key spec they were read with.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ContentRow {
    pub video_id: String,
    pub topics: String,
    pub key_spec: i64,
    pub seen_at: i64,
}

pub async fn load_content(pool: &SqlitePool) -> AppResult<Vec<ContentRow>> {
    Ok(sqlx::query_as::<_, ContentRow>(
        "SELECT video_id, topics, key_spec, seen_at FROM neuro_content_topics",
    )
    .fetch_all(pool)
    .await?)
}

/// Stores `row` and keeps the `keep` most recently watched videos.
pub async fn save_content(pool: &SqlitePool, row: &ContentRow, keep: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO neuro_content_topics (video_id, topics, key_spec, seen_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&row.video_id)
    .bind(&row.topics)
    .bind(row.key_spec)
    .bind(row.seen_at)
    .execute(pool)
    .await?;
    sqlx::query(
        "DELETE FROM neuro_content_topics WHERE video_id NOT IN (
             SELECT video_id FROM neuro_content_topics ORDER BY seen_at DESC LIMIT ?
         )",
    )
    .bind(keep)
    .execute(pool)
    .await?;
    Ok(())
}

/// Forgets every side store, as a brain reset does.
pub async fn clear_all(pool: &SqlitePool) -> AppResult<()> {
    for statement in [
        "DELETE FROM neuro_channel_categories",
        "DELETE FROM neuro_cowatch_sources",
        "DELETE FROM neuro_content_topics",
    ] {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}
