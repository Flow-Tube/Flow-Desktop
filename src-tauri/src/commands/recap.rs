//! The recap ledger's commands. Nothing here uses the network.

use std::collections::HashMap;
use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::State;

use crate::errors::ErrorResponse;
use crate::music_brain::store::MusicBrainStore;
use crate::recap::model::{RecapEntry, TOPICS_PER_VIEW};
use crate::recap::store;
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
