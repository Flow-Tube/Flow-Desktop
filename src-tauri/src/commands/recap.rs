//! The recap ledger's commands. Nothing here uses the network.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::errors::{AppError, ErrorResponse};
use crate::music_brain::store::MusicBrainStore;
use crate::recap::model::{MusicMonth, RecapEntry, TOPICS_PER_VIEW, VideoMonth};
use crate::recap::store;
use crate::recap::summary::{RecapPeriod, RecapSource, RecapSummary, daily_time, summarize};
use crate::services::recommendation_service::RecommendationService;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) async fn seen_artists(music_brain: &MusicBrainStore) -> Vec<String> {
    music_brain
        .read()
        .await
        .seen_artists
        .iter()
        .cloned()
        .collect()
}

/// Saves a batch from the frontend's recap queue.
#[tauri::command]
pub async fn recap_record_batch(
    entries: Vec<RecapEntry>,
    pool: State<'_, SqlitePool>,
    recommendation: State<'_, RecommendationService>,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> Result<(), ErrorResponse> {
    let mut topics = HashMap::new();
    for entry in &entries {
        if let RecapEntry::View { event, .. } = entry
            && event.counted
            && !topics.contains_key(&event.video_id)
        {
            let read = recommendation
                .video_topics(
                    &event.title,
                    &event.channel_name,
                    event.description.as_deref(),
                    TOPICS_PER_VIEW,
                )
                .await;
            topics.insert(event.video_id.clone(), read);
        }
    }
    let seen = seen_artists(&music_brain).await;
    store::apply_batch(&pool, &entries, &topics, &seen, now_ms())
        .await
        .map_err(ErrorResponse::from)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapIndex {
    /// When the ledger started, Unix milliseconds. It holds only estimates from before then.
    pub started_at: i64,
    /// Every month it holds, newest first, with that month's views and plays.
    pub months: Vec<(String, i64)>,
    /// Distinct videos per channel in watch history: id, name, videos.
    pub history_channels: Vec<(String, String, i64)>,
}

const HISTORY_CHANNELS: i64 = 10;

/// What a recap page needs before it shows a period, starting the ledger if this is the first time.
#[tauri::command]
pub async fn recap_index(
    pool: State<'_, SqlitePool>,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> Result<RecapIndex, ErrorResponse> {
    let seen = seen_artists(&music_brain).await;
    let started_at = store::ensure_started(&pool, &seen, now_ms()).await?;
    Ok(RecapIndex {
        started_at,
        months: store::month_activity(&pool).await?,
        history_channels: store::history_channels(&pool, HISTORY_CHANNELS).await?,
    })
}

/// One period of the recap, folded from the ledger off the main thread.
#[tauri::command]
pub async fn recap_summary(
    period: String,
    source: RecapSource,
    pool: State<'_, SqlitePool>,
) -> Result<RecapSummary, ErrorResponse> {
    let period = RecapPeriod::parse(&period)
        .ok_or_else(|| AppError::Validation(format!("unknown recap period: {period}")))?;
    let video = store::read_months::<VideoMonth>(&pool, true).await?;
    let music = store::read_months::<MusicMonth>(&pool, false).await?;
    Ok(summarize(&period, source, &video, &music))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapWeek {
    /// The seven local days ending today, oldest first: date and time spent.
    pub days: Vec<(String, i64)>,
    pub started_at: i64,
}

const WEEK_DAYS: u32 = 7;

/// The last week of watching and listening, for the Wellbeing chart in Settings.
#[tauri::command]
pub async fn recap_week(
    pool: State<'_, SqlitePool>,
    music_brain: State<'_, Arc<MusicBrainStore>>,
) -> Result<RecapWeek, ErrorResponse> {
    let seen = seen_artists(&music_brain).await;
    let started_at = store::ensure_started(&pool, &seen, now_ms()).await?;
    let video = store::read_months::<VideoMonth>(&pool, true).await?;
    let music = store::read_months::<MusicMonth>(&pool, false).await?;
    let today = chrono::Local::now().date_naive();
    Ok(RecapWeek {
        days: daily_time(&video, &music, today, WEEK_DAYS),
        started_at,
    })
}
