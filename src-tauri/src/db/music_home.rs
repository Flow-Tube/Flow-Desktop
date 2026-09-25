use sqlx::{Row, SqlitePool};

use crate::errors::{AppError, AppResult};
use crate::models::music_pages::{CachedMusicHomePage, MusicHomePage};

pub async fn get_cached(
    pool: &SqlitePool,
    locale_stamp: &str,
) -> AppResult<Option<CachedMusicHomePage>> {
    let row = sqlx::query(
        "SELECT page_json, fetched_at FROM music_home_typed_cache WHERE locale_stamp = ?",
    )
    .bind(locale_stamp)
    .fetch_optional(pool)
    .await
    .map_err(AppError::from)?;
    let Some(row) = row else { return Ok(None) };
    let json: String = row.try_get("page_json").map_err(AppError::from)?;
    let fetched_at: i64 = row.try_get("fetched_at").map_err(AppError::from)?;
    let page = serde_json::from_str(&json).map_err(AppError::from)?;
    Ok(Some(CachedMusicHomePage { page, fetched_at }))
}

pub async fn save(pool: &SqlitePool, locale_stamp: &str, page: &MusicHomePage) -> AppResult<()> {
    let json = serde_json::to_string(page).map_err(AppError::from)?;
    sqlx::query(
        "INSERT INTO music_home_typed_cache (locale_stamp, page_json, fetched_at) \
         VALUES (?, ?, unixepoch()) \
         ON CONFLICT(locale_stamp) DO UPDATE SET page_json = excluded.page_json, fetched_at = excluded.fetched_at",
    )
    .bind(locale_stamp)
    .bind(json)
    .execute(pool)
    .await
    .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn typed_home_cache_is_locale_scoped() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let page = MusicHomePage {
            chips: Vec::new(),
            sections: Vec::new(),
            continuation: Some("next".into()),
        };
        save(&pool, "en-US", &page).await.unwrap();
        assert!(get_cached(&pool, "fr-FR").await.unwrap().is_none());
        let cached = get_cached(&pool, "en-US").await.unwrap().unwrap();
        assert_eq!(cached.page.continuation.as_deref(), Some("next"));
        assert!(cached.fetched_at > 0);
    }
}
