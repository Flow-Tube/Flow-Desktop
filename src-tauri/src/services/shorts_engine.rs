//! What the Shorts surface tells the recommendation engine: each viewing's verdict, the Shorts
//! that were on screen, and the Shorts that open related reel chains.

use std::collections::HashSet;

use serde::Deserialize;

use crate::db::library;
use crate::db::watch_history::get_watch_history;
use crate::errors::AppResult;
use crate::flow_neuro::scoring::{CHANNEL_SUPPRESSION_DAYS, is_known_short};
use crate::flow_neuro::shorts::{
    ShortSeed, ShortSeedSource, classify, classify_abandon, mark_seen, select_seeds,
};
use crate::services::recommendation_service::RecommendationService;

const SEED_HISTORY_LOOKBACK: i64 = 200;

/// One viewing of a Short, from the moment it became active until it was swiped away or ended.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortView {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    /// The furthest point reached.
    pub position_ms: u64,
    pub duration_ms: u64,
    /// Played to its end (or looped) rather than swiped away.
    pub completed: bool,
}

impl RecommendationService {
    /// Learns from one viewing of a Short, at the Shorts rate, as Flow for Android classifies it.
    pub async fn report_short_view(&self, view: ShortView) -> AppResult<()> {
        let signal = if view.completed {
            Some(classify(view.duration_ms, view.duration_ms))
        } else {
            classify_abandon(view.position_ms, view.duration_ms)
        };
        let Some(signal) = signal else {
            return Ok(());
        };
        let duration_seconds = Some(view.duration_ms.div_ceil(1000)).filter(|s| *s > 0);
        self.log_video_interaction(
            &view.video_id,
            &view.title,
            &view.channel_name,
            view.channel_id.as_deref().unwrap_or(""),
            None,
            duration_seconds,
            false,
            true,
            signal.kind,
            signal.percent,
            None,
        )
        .await
    }

    /// Shorts that stayed on screen a moment; ranking holds them back for a week.
    pub async fn record_seen_shorts(&self, ids: &[String]) {
        if ids.is_empty() || self.learning_paused().await {
            return;
        }
        let now_ms = self.get_current_time_ms();
        mark_seen(&mut *self.brain_store.write().await, ids, now_ms);
    }

    /// Up to `max` Shorts the viewer liked, saved or watched through, to open related reel chains.
    pub async fn short_seeds(&self, max: usize, cooled: &HashSet<String>) -> Vec<String> {
        let now_ms = self.get_current_time_ms();
        let history = get_watch_history(&self.pool, SEED_HISTORY_LOOKBACK, 0)
            .await
            .unwrap_or_default();
        let mut candidates: Vec<ShortSeed> = history
            .iter()
            .filter(|r| !r.is_music)
            .filter(|r| {
                is_known_short(r.total_duration_seconds.and_then(|s| u64::try_from(s).ok()))
            })
            .map(|r| {
                let total = r.total_duration_seconds.unwrap_or(0).max(1);
                #[allow(clippy::cast_precision_loss)]
                let percent =
                    (r.watch_duration_seconds as f64 * 100.0 / total as f64).clamp(0.0, 100.0);
                ShortSeed {
                    id: r.video_id.clone(),
                    channel_id: r.channel_id.clone().unwrap_or_default(),
                    source: ShortSeedSource::Watched,
                    timestamp_ms: library::iso_ms(&r.watch_date),
                    percent_watched: percent,
                }
            })
            .collect();
        candidates.extend(self.library_short_seeds().await);
        let brain = self.brain_store.read().await;
        let cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * 86_400_000);
        let excluded: HashSet<String> = brain
            .blocked_channels
            .iter()
            .cloned()
            .chain(
                brain
                    .suppressed_channels
                    .iter()
                    .filter(|(_, at)| **at > cutoff)
                    .map(|(id, _)| id.clone()),
            )
            .collect();
        select_seeds(&candidates, max, now_ms, &excluded, cooled)
    }

    async fn library_short_seeds(&self) -> Vec<ShortSeed> {
        let liked = library::liked_videos(&self.pool).await.unwrap_or_default();
        let saved = library::saved_videos(&self.pool).await.unwrap_or_default();
        liked
            .into_iter()
            .map(|entry| (entry, ShortSeedSource::Liked))
            .chain(
                saved
                    .into_iter()
                    .map(|entry| (entry, ShortSeedSource::Saved)),
            )
            .filter(|((video, _), _)| is_known_short(video.duration_seconds))
            .map(|((video, at), source)| ShortSeed {
                id: video.id,
                channel_id: video.channel_id.unwrap_or_default(),
                source,
                timestamp_ms: at,
                percent_watched: 0.0,
            })
            .collect()
    }
}
