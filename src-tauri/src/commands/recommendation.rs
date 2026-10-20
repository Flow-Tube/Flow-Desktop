use serde::Serialize;
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

use crate::errors::ErrorResponse;
use crate::flow_neuro::bootstrap::ImportedVideo;
use crate::flow_neuro::gates::LANE_RELEVANCE_FLOOR;
use crate::flow_neuro::signals::InteractionType;
use crate::flow_neuro::watch_session::{END_GRACE_SECONDS, WatchReport};
use crate::models::video::VideoSummary;
use crate::services::recommendation_service::{FeedQuotas, RecommendationService};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDetails {
    pub name: String,
    pub title: String,
    pub description: String,
    pub icon: String,
}

#[tauri::command]
pub async fn rank_videos(
    candidates: Vec<VideoSummary>,
    user_subs: Vec<String>,
    relevant_only: Option<bool>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<Vec<VideoSummary>, ErrorResponse> {
    let subs_set = user_subs.into_iter().collect::<HashSet<String>>();
    let min_relevance = if relevant_only.unwrap_or(false) {
        LANE_RELEVANCE_FLOOR
    } else {
        0.0
    };
    recommendation_service
        .rank_candidates(candidates, subs_set, min_relevance)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn log_interaction(
    video_id: String,
    title: String,
    channel_name: String,
    channel_id: String,
    description: Option<String>,
    duration_seconds: Option<u64>,
    is_live: bool,
    is_short: bool,
    interaction_type: String,
    percent_watched: f32,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    let interaction = match interaction_type.to_uppercase().as_str() {
        "CLICK" => InteractionType::Click,
        "LIKED" => InteractionType::Liked,
        "WATCHED" => InteractionType::Watched,
        "SKIPPED" => InteractionType::Skipped,
        "DISLIKED" => InteractionType::Disliked,
        "SAVED" => InteractionType::Saved,
        _ => {
            return Err(ErrorResponse::from(crate::errors::AppError::Validation(
                "Invalid interaction type provided".to_string(),
            )));
        }
    };

    recommendation_service
        .log_video_interaction(
            &video_id,
            &title,
            &channel_name,
            &channel_id,
            description.as_deref(),
            duration_seconds,
            is_live,
            is_short,
            interaction,
            percent_watched,
            None,
        )
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn report_watch_progress(
    report: WatchReport,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .report_watch_progress(report)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn end_watch_session(
    report: WatchReport,
    natural: bool,
    app: AppHandle,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    let pending = recommendation_service
        .end_watch_session(report, natural)
        .await
        .map_err(ErrorResponse::from)?;
    if let Some(generation) = pending {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(END_GRACE_SECONDS)).await;
            let service = app.state::<RecommendationService>();
            if let Err(error) = service.settle_watch_session(Some(generation)).await {
                tracing::warn!(%error, "[FlowNeuro] failed to settle a watch session");
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn mark_not_interested(
    video_id: String,
    title: String,
    channel_name: String,
    channel_id: String,
    description: Option<String>,
    duration_seconds: Option<u64>,
    is_live: bool,
    is_short: bool,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .log_video_interaction(
            &video_id,
            &title,
            &channel_name,
            &channel_id,
            description.as_deref(),
            duration_seconds,
            is_live,
            is_short,
            InteractionType::NotInterested,
            0.0,
            None,
        )
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn record_feed_impressions(
    videos: Vec<VideoSummary>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .record_feed_impressions(videos)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn complete_onboarding(
    topics: Vec<String>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .complete_onboarding(topics)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_onboarding_status(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<bool, ErrorResponse> {
    recommendation_service
        .get_onboarding_status()
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn generate_discovery_queries(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<Vec<String>, ErrorResponse> {
    recommendation_service
        .generate_discovery_queries()
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_flow_persona(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<PersonaDetails, ErrorResponse> {
    let persona = recommendation_service
        .get_personality()
        .await
        .map_err(ErrorResponse::from)?;

    Ok(PersonaDetails {
        name: persona.name().to_string(),
        title: persona.title().to_string(),
        description: persona.description().to_string(),
        icon: persona.icon().to_string(),
    })
}

#[tauri::command]
pub async fn get_brain_snapshot(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<crate::flow_neuro::scoring::UserBrain, ErrorResponse> {
    recommendation_service
        .get_brain_snapshot()
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_feed_quotas(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<FeedQuotas, ErrorResponse> {
    recommendation_service
        .get_feed_quotas()
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_recommendation_events(
    limit: i64,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<Vec<crate::db::recommendations::RecommendationEvent>, ErrorResponse> {
    recommendation_service
        .get_recommendation_log(limit)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn unblock_topic(
    topic: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .unblock_topic(topic)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn add_blocked_topic(
    topic: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .add_blocked_topic(topic)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn add_preferred_topic(
    topic: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .add_preferred_topic(topic)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn remove_preferred_topic(
    topic: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .remove_preferred_topic(topic)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn unblock_channel(
    channel_id: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .unblock_channel(channel_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn block_channel(
    channel_id: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .block_channel(channel_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn learn_from_search(
    query: String,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<bool, ErrorResponse> {
    recommendation_service
        .learn_from_search(query)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn note_subscription(
    channel_id: String,
    channel_name: String,
    subscribed: bool,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .note_subscription(channel_id, channel_name, subscribed)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn observe_channel_uploads(
    uploads: Vec<VideoSummary>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .observe_channel_uploads(uploads)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn bootstrap_from_history(
    videos: Vec<ImportedVideo>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<usize, ErrorResponse> {
    recommendation_service
        .bootstrap_from_history(videos)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn bootstrap_from_subscriptions(
    channel_names: Vec<String>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<usize, ErrorResponse> {
    recommendation_service
        .bootstrap_from_subscriptions(channel_names)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn import_brain(
    brain: serde_json::Value,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .import_brain(brain)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn reset_brain(
    recommendation_service: State<'_, RecommendationService>,
) -> Result<(), ErrorResponse> {
    recommendation_service
        .reset_brain()
        .await
        .map_err(ErrorResponse::from)
}
