use tauri::State;

use crate::errors::ErrorResponse;
use crate::models::shorts::ShortsFeed;
use crate::services::recommendation_service::RecommendationService;
use crate::services::shorts_engine::ShortView;
use crate::services::shorts_service::ShortsService;
use crate::services::youtube_service::YoutubeService;

/// Open the Shorts feed. With `seed_id` it returns a collaborative sequence
/// anchored on that video; otherwise the personalised home feed.
#[tauri::command]
pub async fn get_shorts_feed(
    seed_id: Option<String>,
    user_subs: Vec<String>,
    region: Option<String>,
    shorts_service: State<'_, ShortsService>,
    youtube_service: State<'_, YoutubeService>,
    recommendation_service: State<'_, RecommendationService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<ShortsFeed, ErrorResponse> {
    let feed = shorts_service
        .get_feed(
            &youtube_service,
            &recommendation_service,
            seed_id,
            user_subs,
            region,
        )
        .await
        .map_err(ErrorResponse::from)?;
    remember_shorts(&pool, &feed).await;
    Ok(feed)
}

/// Fetch the next page of Shorts, served instantly from the prefetch buffer.
#[tauri::command]
pub async fn load_more_shorts(
    continuation: Option<String>,
    user_subs: Vec<String>,
    region: Option<String>,
    shorts_service: State<'_, ShortsService>,
    youtube_service: State<'_, YoutubeService>,
    recommendation_service: State<'_, RecommendationService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<ShortsFeed, ErrorResponse> {
    let feed = shorts_service
        .load_more(
            &youtube_service,
            &recommendation_service,
            continuation,
            user_subs,
            region,
        )
        .await
        .map_err(ErrorResponse::from)?;
    remember_shorts(&pool, &feed).await;
    Ok(feed)
}

/// Every reel the Shorts feed serves is a Short wherever it turns up next.
async fn remember_shorts(pool: &sqlx::SqlitePool, feed: &ShortsFeed) {
    let ids: Vec<String> = feed.items.iter().map(|item| item.id.clone()).collect();
    let _ =
        crate::db::known_shorts::remember(pool, &ids, chrono::Utc::now().timestamp_millis()).await;
}

/// Clear the session's prefetch buffer and seen-set so the feed starts fresh.
#[tauri::command]
pub async fn reset_shorts_feed(
    shorts_service: State<'_, ShortsService>,
) -> Result<(), ErrorResponse> {
    shorts_service.reset();
    Ok(())
}

/// Learns from one viewing of a Short, once it was swiped away or played to its end.
#[tauri::command]
pub async fn report_short_view(
    view: ShortView,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .report_short_view(view)
        .await
        .map_err(ErrorResponse::from)
}

/// Shorts that stayed on screen a moment; ranking holds them back for a week.
#[tauri::command]
pub async fn record_seen_shorts(
    ids: Vec<String>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service.record_seen_shorts(&ids).await;
    Ok(())
}
