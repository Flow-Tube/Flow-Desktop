use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::info;

use crate::db::recommendations;
use crate::errors::{AppError, AppResult};
use crate::flow_neuro::bootstrap::{
    ImportedVideo, bootstrap_from_history, bootstrap_from_subscriptions,
};
use crate::flow_neuro::brain_store::BrainStore;
use crate::flow_neuro::categories;
use crate::flow_neuro::channel_knowledge::{learn_from_uploads, subscription_changed};
use crate::flow_neuro::co_watch::{RelatedChannel, neighbours};
use crate::flow_neuro::deep_flow::learning_paused;
use crate::flow_neuro::discovery::{SurfaceState, next_queries, note_query_novelty, stale_key};
use crate::flow_neuro::display_forms::with_pick_spellings;
use crate::flow_neuro::language::system_language;
use crate::flow_neuro::learning::{Interaction, apply_interaction};
use crate::flow_neuro::rank::{RankContext, SessionState, rank};
use crate::flow_neuro::ranker::MomentumEntry;
use crate::flow_neuro::scoring::{
    FeedEntry, FlowPersona, IMPRESSION_CACHE_MAX, SESSION_TOPIC_HISTORY_MAX, TimeBucket, UserBrain,
    classify_persona, is_known_short,
};
use crate::flow_neuro::search_learning::learn_search;
use crate::flow_neuro::side_stores::SideStores;
use crate::flow_neuro::signals::InteractionType;
use crate::flow_neuro::watch_session::{WatchReport, WatchSession};
use crate::models::video::{RelatedContentItem, VideoSummary};
use crate::services::youtube_service::YoutubeService;

/// A channel above its starting score is one the viewer has watched.
const NEUTRAL_CHANNEL_SCORE: f64 = 0.5;
const SESSION_RESET_IDLE_MINUTES: u64 = 120;
const SESSION_RESET_EMPTY_MINUTES: u64 = 30;
const MOMENTUM_WINDOW: usize = 10;
/// Results shown within this window make a discovery search stale.
const RECENTLY_SHOWN_MS: u64 = 48 * 3_600_000;

/// Which feed asks for discovery searches; each keeps its own rotation.
#[derive(Debug, Clone, Copy)]
pub enum DiscoverySurface {
    Home,
    Shorts,
}

/// Home's load-more depth (its rotation lives in the brain) and all of Shorts' discovery memory.
#[derive(Default)]
struct DiscoveryMemory {
    home_depth: usize,
    shorts: SurfaceState,
}

pub struct RecommendationService {
    pub(crate) pool: SqlitePool,
    pub(crate) brain_store: Arc<BrainStore>,
    pub(crate) stores: Arc<SideStores>,
    impression_cache: Mutex<HashMap<String, (i32, u64)>>, // video_id -> (seen_count, last_seen_timestamp)
    session_topic_history: Mutex<Vec<String>>,
    session_video_count: Mutex<i32>,
    watch: Mutex<WatchSlot>,
    /// Channels whose upload titles were already read this session.
    profiled_channels: Mutex<HashSet<String>>,
    #[allow(dead_code)]
    discovery: Mutex<DiscoveryMemory>,
    /// When the viewer last ranked or watched anything, for the idle session reset.
    last_activity_ms: Mutex<u64>,
    /// The last few interactions' topics and whether they were positive.
    momentum: Mutex<Vec<MomentumEntry>>,
}

#[derive(Default)]
struct WatchSlot {
    session: Option<WatchSession>,
    generation: u64,
}

impl RecommendationService {
    fn has_meaningful_brain_data(brain: &UserBrain) -> bool {
        brain.has_completed_onboarding
            || brain.total_interactions > 0
            || brain.idf_total_documents > 0
            || !brain.preferred_topics.is_empty()
            || !brain.global_vector.topics.is_empty()
            || !brain.watch_history_map.is_empty()
            || !brain.channel_scores.is_empty()
            || !brain.topic_evidence.is_empty()
    }

    pub fn new(pool: SqlitePool, brain_store: Arc<BrainStore>, stores: Arc<SideStores>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self {
            pool,
            brain_store,
            stores,
            impression_cache: Mutex::new(HashMap::new()),
            session_topic_history: Mutex::new(Vec::new()),
            session_video_count: Mutex::new(0),
            watch: Mutex::new(WatchSlot::default()),
            profiled_channels: Mutex::new(HashSet::new()),
            discovery: Mutex::new(DiscoveryMemory::default()),
            last_activity_ms: Mutex::new(now),
            momentum: Mutex::new(Vec::new()),
        }
    }

    /// Best-effort persistence of the resident brain; called on the debounce timer and on exit.
    pub async fn flush_brain(&self) -> AppResult<()> {
        self.brain_store.flush().await
    }

    /// The language the brain's keys are stemmed for, which sync advertises.
    pub async fn key_language(&self) -> String {
        self.brain_store.read().await.key_spec().key_language
    }

    /// Reload the resident brain from the database after a sync merge wrote it directly.
    /// Saves the brain and holds saves until [`Self::reload_brain`], around a sync merge.
    pub async fn flush_and_hold_brain(&self) -> AppResult<()> {
        self.brain_store.flush_and_hold().await
    }

    pub async fn reload_brain(&self) -> AppResult<()> {
        self.brain_store.reload().await
    }

    /// Deep Flow keeps a session out of the profile: nothing learns while it runs.
    pub(crate) async fn learning_paused(&self) -> bool {
        learning_paused(&self.pool, self.get_current_time_ms())
            .await
            .unwrap_or(false)
    }

    pub(crate) fn get_current_time_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// The searches a surface runs next; `reset_depth` starts a refresh, otherwise each call digs
    /// one level deeper into every served interest.
    pub async fn generate_discovery_queries(
        &self,
        surface: DiscoverySurface,
        reset_depth: bool,
    ) -> AppResult<Vec<String>> {
        let now_ms = self.get_current_time_ms();
        let brain = self.brain_store.read().await;
        let is_watched = |channel: &str| is_watched_channel(&brain, channel);
        let channel_edges = self.stores.co_watch.edges(&is_watched, now_ms);
        let persona = classify_persona(&brain);
        let bucket = TimeBucket::current();
        let queries = match surface {
            DiscoverySurface::Home => {
                let mut state = SurfaceState {
                    depth: self.discovery.lock().unwrap().home_depth,
                    recent_query_tokens: brain.recent_query_tokens.clone(),
                    cluster_rotation: brain.cluster_rotation.clone(),
                };
                let queries = next_queries(
                    &brain,
                    &mut state,
                    reset_depth,
                    persona,
                    bucket,
                    now_ms,
                    &channel_edges,
                );
                self.discovery.lock().unwrap().home_depth = state.depth;
                drop(brain);
                let mut brain = self.brain_store.write().await;
                brain.recent_query_tokens = state.recent_query_tokens;
                brain.cluster_rotation = state.cluster_rotation;
                queries
            }
            DiscoverySurface::Shorts => next_queries(
                &brain,
                &mut self.discovery.lock().unwrap().shorts,
                reset_depth,
                persona,
                bucket,
                now_ms,
                &channel_edges,
            ),
        };
        info!(
            count = queries.len(),
            ?surface,
            "[discovery] queries generated"
        );
        Ok(queries)
    }

    /// A Home discovery search came back: when most of its results were shown in the last two
    /// days, the search waits a day before it runs again.
    pub async fn report_discovery_results(&self, query: &str, video_ids: &[String]) {
        let now_ms = self.get_current_time_ms();
        let mut brain = self.brain_store.write().await;
        let cutoff = now_ms.saturating_sub(RECENTLY_SHOWN_MS);
        if !brain
            .feed_history
            .values()
            .any(|entry| entry.last_shown >= cutoff)
        {
            return;
        }
        let Some(key) = stale_key(query, &brain.key_spec()) else {
            return;
        };
        let novel = video_ids
            .iter()
            .filter(|id| {
                brain
                    .feed_history
                    .get(*id)
                    .is_none_or(|entry| entry.last_shown < cutoff)
            })
            .count();
        #[allow(clippy::cast_precision_loss)]
        let ratio = novel as f64 / video_ids.len().max(1) as f64;
        note_query_novelty(
            &mut brain.stale_queries,
            key,
            video_ids.len(),
            ratio,
            now_ms,
        );
    }

    /// Ranks feed candidates; above 0, `min_relevance` leaves out what shares less than that with
    /// the viewer's interests.
    pub async fn rank_candidates(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
        min_relevance: f64,
    ) -> AppResult<Vec<VideoSummary>> {
        self.rank_candidates_inner(candidates, user_subs, min_relevance, None)
            .await
    }

    /// Shorts ranking: against the Shorts taste, with Shorts seen this week held back and
    /// channel-level suppression skipped so the high-volume feed isn't starved.
    /// `like_counts` are the reels' own, which the engagement term reads.
    pub async fn rank_shorts_candidates(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
        like_counts: &HashMap<String, u64>,
    ) -> AppResult<Vec<VideoSummary>> {
        self.rank_candidates_inner(candidates, user_subs, 0.0, Some(like_counts))
            .await
    }

    /// Keeps the related list shown beside `video_id` until the viewer watches or likes the video,
    /// when it becomes a co-watch source. Music never counts.
    pub fn note_related(&self, video_id: &str, related: &[RelatedContentItem]) {
        let channels = related
            .iter()
            .filter(|item| item.item_type == "video")
            .filter_map(|item| {
                Some(RelatedChannel {
                    channel_id: item.channel_id.clone()?,
                    channel_name: item.channel_name.clone(),
                })
            })
            .collect();
        self.stores.co_watch.note_related(video_id, channels);
    }

    async fn rank_candidates_inner(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
        min_relevance: f64,
        shorts: Option<&HashMap<String, u64>>,
    ) -> AppResult<Vec<VideoSummary>> {
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .with_rank_context(&user_subs, min_relevance, shorts, |ctx| {
                rank(ctx, candidates)
            })
            .await)
    }

    /// Runs `f` with what one ranking pass reads: the brain, the session and the side stores.
    /// `shorts` makes it the Shorts feed's pass, with the reels' like counts.
    pub(crate) async fn with_rank_context<R>(
        &self,
        user_subs: &HashSet<String>,
        min_relevance: f64,
        shorts: Option<&HashMap<String, u64>>,
        f: impl FnOnce(&RankContext) -> R,
    ) -> R {
        self.reset_idle_session();
        let now_ms = self.get_current_time_ms();
        let session_topics = self.session_topic_history.lock().unwrap().clone();
        let session_video_count = *self.session_video_count.lock().unwrap();
        let momentum = self.momentum.lock().unwrap().clone();
        let brain = self.brain_store.read().await;
        let is_watched = |channel: &str| is_watched_channel(&brain, channel);
        let channel_edges = self.stores.co_watch.edges(&is_watched, now_ms);
        let co_watch_prior = neighbours(&channel_edges, &is_watched);
        let category_of = |channel: &str| self.stores.categories.category_of(channel);
        let stored_topics = |video_id: &str| self.stores.content.topics_for(video_id);
        let no_likes = HashMap::new();
        let ctx = RankContext {
            brain: &brain,
            user_subs,
            now_ms,
            min_relevance,
            shorts_feed: shorts.is_some(),
            like_counts: shorts.unwrap_or(&no_likes),
            session: SessionState {
                topics: &session_topics,
                video_count: session_video_count,
                momentum: &momentum,
            },
            category_of: &category_of,
            co_watch_prior: &co_watch_prior,
            channel_edges: &channel_edges,
            stored_topics: &stored_topics,
            seed: now_ms,
        };
        f(&ctx)
    }

    /// A session idle for two hours, or half an hour without a video, starts over (Android A16:
    /// measured from the last activity, not from when the app opened).
    fn reset_idle_session(&self) {
        let now_ms = self.get_current_time_ms();
        let mut last = self.last_activity_ms.lock().unwrap();
        let idle_minutes = now_ms.saturating_sub(*last) / 60_000;
        let empty = *self.session_video_count.lock().unwrap() == 0;
        if idle_minutes > SESSION_RESET_IDLE_MINUTES
            || (empty && idle_minutes > SESSION_RESET_EMPTY_MINUTES)
        {
            self.session_topic_history.lock().unwrap().clear();
            *self.session_video_count.lock().unwrap() = 0;
            self.momentum.lock().unwrap().clear();
            self.impression_cache.lock().unwrap().clear();
        }
        *last = now_ms;
    }

    /// What a viewing says about its channel: a finished one which category it posts in, and a
    /// rejection that Home's channel memory stops offering it until the viewer watches it again.
    async fn note_channel_verdict(
        &self,
        interaction_type: InteractionType,
        channel_id: &str,
        channel_name: &str,
        category: Option<&str>,
        now_ms: u64,
    ) -> AppResult<()> {
        if matches!(
            interaction_type,
            InteractionType::Watched | InteractionType::Skipped
        ) && let Some(category) = categories::id_of(category)
        {
            #[allow(clippy::cast_possible_wrap)]
            self.stores
                .categories
                .record(channel_id, category, now_ms as i64)
                .await?;
        }
        if matches!(
            interaction_type,
            InteractionType::NotInterested | InteractionType::Disliked
        ) {
            crate::services::home_feed::channel_memory::record_rejection(
                &self.pool,
                channel_id,
                channel_name,
                now_ms,
            )
            .await?;
        }
        Ok(())
    }

    pub async fn log_video_interaction(
        &self,
        video_id: &str,
        title: &str,
        channel_name: &str,
        channel_id: &str,
        description: Option<&str>,
        duration_sec: Option<u64>,
        is_live: bool,
        is_short: bool,
        interaction_type: InteractionType,
        percent_watched: f32,
        category: Option<&str>,
    ) -> AppResult<()> {
        if self.learning_paused().await {
            return Ok(());
        }
        let channel_id = channel_id.trim().trim_start_matches("channel:");
        let now_ms = self.get_current_time_ms();
        #[allow(clippy::cast_precision_loss)]
        let seconds_since_impression = self
            .impression_cache
            .lock()
            .unwrap()
            .get(video_id)
            .map(|(_, shown_at)| now_ms.saturating_sub(*shown_at) as f64 / 1000.0);
        let outcome = {
            let mut brain = self.brain_store.write().await;
            apply_interaction(
                &mut brain,
                &Interaction {
                    video_id,
                    title,
                    channel_name,
                    channel_id,
                    description,
                    duration_sec,
                    is_live,
                    is_short,
                    kind: interaction_type,
                    percent_watched,
                    seconds_since_impression,
                    category,
                },
            )
        };
        self.note_channel_verdict(interaction_type, channel_id, channel_name, category, now_ms)
            .await?;
        *self.last_activity_ms.lock().unwrap() = now_ms;
        let learned = outcome.learning_rate.is_some_and(|rate| rate > 0.0);
        if learned && !is_short && is_strong_signal(interaction_type, percent_watched) {
            self.stores
                .co_watch
                .record_pending(video_id, channel_id, now_ms)
                .await?;
        }
        // Feeds carry titles alone; a video watched with its description is scored on that later.
        if learned && description.is_some_and(|text| !text.trim().is_empty()) {
            #[allow(clippy::cast_possible_wrap)]
            self.stores
                .content
                .put(video_id, &outcome.topics, now_ms as i64)
                .await?;
        }
        if let (Some(topic), Some(rate)) = (&outcome.primary_topic, outcome.learning_rate) {
            let mut momentum = self.momentum.lock().unwrap();
            momentum.push(MomentumEntry {
                topic: topic.clone(),
                positive: rate > 0.0,
            });
            if momentum.len() > MOMENTUM_WINDOW {
                momentum.remove(0);
            }
        }
        if outcome.learning_rate.is_some_and(|rate| rate > 0.0) {
            self.impression_cache.lock().unwrap().remove(video_id);
        }

        let Some(learning_rate) = outcome.learning_rate else {
            return Ok(());
        };

        recommendations::log_recommendation_event(
            &self.pool,
            interaction_type.as_str(),
            Some(video_id),
            Some(channel_name),
            None,
            Some(learning_rate),
        )
        .await?;

        if matches!(
            interaction_type,
            InteractionType::Click | InteractionType::Watched
        ) {
            if let Some(primary_topic) = outcome.primary_topic {
                let mut history = self.session_topic_history.lock().unwrap();
                history.push(primary_topic);
                if history.len() > SESSION_TOPIC_HISTORY_MAX {
                    history.remove(0);
                }
                let mut count = self.session_video_count.lock().unwrap();
                *count += 1;
            }
        }

        Ok(())
    }

    /// Folds a progress report into the open watch session. A report for another video
    /// finishes the previous session and opens a new one, which counts as the click.
    pub async fn report_watch_progress(&self, report: WatchReport) -> AppResult<()> {
        if report.is_music || self.learning_paused().await {
            return Ok(());
        }
        let (finished, click) = {
            let mut slot = self.watch.lock().unwrap();
            let finished = match slot.session.as_mut() {
                Some(session) if session.report.video_id == report.video_id => {
                    session.ended = false;
                    session.absorb(report);
                    None
                }
                _ => {
                    slot.generation += 1;
                    let session = WatchSession::start(report, slot.generation);
                    slot.session.replace(session)
                }
            };
            let click = slot
                .session
                .as_mut()
                .and_then(|session| session.take_click().then(|| session.report.clone()));
            (finished, click)
        };
        if let Some(previous) = finished {
            self.finish_watch(previous).await?;
        }
        if let Some(report) = click {
            self.log_watch_event(&report, InteractionType::Click, 0.0)
                .await?;
        }
        Ok(())
    }

    /// Ends the open session for this video. A natural end is final at once; any other end
    /// waits for the same video to come back, and returns the generation to settle later.
    pub async fn end_watch_session(
        &self,
        report: WatchReport,
        natural: bool,
    ) -> AppResult<Option<u64>> {
        let finished = {
            let mut slot = self.watch.lock().unwrap();
            let Some(session) = slot.session.as_mut() else {
                return Ok(None);
            };
            if session.report.video_id != report.video_id {
                return Ok(None);
            }
            session.absorb(report);
            if !natural {
                session.ended = true;
                return Ok(Some(session.generation));
            }
            slot.session.take()
        };
        if let Some(session) = finished {
            self.finish_watch(session).await?;
        }
        Ok(None)
    }

    /// Finishes an ended session that nothing resumed. `None` finishes whatever is open, ended
    /// or not, which is what quitting the app means.
    pub async fn settle_watch_session(&self, generation: Option<u64>) -> AppResult<()> {
        let finished = {
            let mut slot = self.watch.lock().unwrap();
            let settles = slot
                .session
                .as_ref()
                .is_some_and(|session| match generation {
                    Some(generation) => session.ended && session.generation == generation,
                    None => true,
                });
            if settles { slot.session.take() } else { None }
        };
        if let Some(session) = finished {
            self.finish_watch(session).await?;
        }
        Ok(())
    }

    async fn finish_watch(&self, mut session: WatchSession) -> AppResult<()> {
        // Without a title the session cannot say what was watched, so it teaches nothing.
        if session.report.title.trim().is_empty() {
            return Ok(());
        }
        if session.take_click() {
            self.log_watch_event(&session.report, InteractionType::Click, 0.0)
                .await?;
        }
        let Some(verdict) = session.verdict() else {
            return Ok(());
        };
        self.log_watch_event(
            &session.report,
            verdict.interaction,
            verdict.percent_watched,
        )
        .await
    }

    async fn log_watch_event(
        &self,
        report: &WatchReport,
        interaction: InteractionType,
        percent_watched: f32,
    ) -> AppResult<()> {
        let duration = (report.duration > 0.0)
            .then(|| std::time::Duration::from_secs_f64(report.duration + 0.5).as_secs());
        let channel_id = if report.channel_id.is_empty() {
            &report.video_id
        } else {
            &report.channel_id
        };
        self.log_video_interaction(
            &report.video_id,
            &report.title,
            &report.channel_name,
            channel_id,
            report.description.as_deref(),
            duration,
            report.is_live,
            is_known_short(duration),
            interaction,
            percent_watched,
            report.category.as_deref(),
        )
        .await
    }

    pub async fn record_feed_impressions(&self, videos: Vec<VideoSummary>) -> AppResult<()> {
        if videos.is_empty() || self.learning_paused().await {
            return Ok(());
        }

        let now_ms = self.get_current_time_ms();
        let mut unique_videos = Vec::new();
        let mut seen = HashSet::new();
        for video in videos {
            if seen.insert(video.id.clone()) {
                unique_videos.push(video);
            }
        }

        {
            let mut cache = self.impression_cache.lock().unwrap();
            for video in &unique_videos {
                let entry = cache.entry(video.id.clone()).or_insert((0, now_ms));
                entry.0 += 1;
                entry.1 = now_ms;
            }

            if cache.len() > IMPRESSION_CACHE_MAX {
                if let Some(oldest_key) = cache
                    .iter()
                    .min_by_key(|(_, (_, shown_at))| *shown_at)
                    .map(|(id, _)| id.clone())
                {
                    cache.remove(&oldest_key);
                }
            }
        }

        let mut brain = self.brain_store.write().await;
        for video in &unique_videos {
            let entry = brain
                .feed_history
                .entry(video.id.clone())
                .or_insert(FeedEntry {
                    last_shown: now_ms,
                    show_count: 0,
                });
            entry.last_shown = now_ms;
            entry.show_count += 1;
        }

        crate::flow_neuro::caps::prune_feed_history(&mut brain, now_ms);

        Ok(())
    }

    pub async fn get_personality(&self) -> AppResult<FlowPersona> {
        let brain = self.brain_store.read().await;
        Ok(classify_persona(&brain))
    }

    pub async fn complete_onboarding(&self, topics: Vec<String>) -> AppResult<()> {
        let mut brain = self.brain_store.write().await;

        let mut preferred = HashSet::new();
        for (index, topic) in topics.into_iter().enumerate() {
            let trimmed = topic.trim();
            if trimmed.is_empty() {
                continue;
            }

            let weight = if index < 3 {
                0.55
            } else if index < 6 {
                0.40
            } else {
                0.30
            };
            for token in brain.key_spec().keys_of(trimmed) {
                brain.global_vector.topics.insert(token, weight);
            }
            preferred.insert(trimmed.to_string());
        }

        brain.display_forms =
            with_pick_spellings(&brain.display_forms, &preferred, &brain.key_spec());
        brain.preferred_topics = preferred;
        brain.has_completed_onboarding = true;
        Ok(())
    }

    pub async fn get_onboarding_status(&self) -> AppResult<bool> {
        let (completed, needs_flag) = {
            let brain = self.brain_store.read().await;
            let completed = Self::has_meaningful_brain_data(&brain);
            (completed, completed && !brain.has_completed_onboarding)
        };
        if needs_flag {
            self.brain_store.write().await.has_completed_onboarding = true;
        }
        Ok(completed)
    }

    pub async fn get_subscription_rotation_feed(
        &self,
        youtube_service: &YoutubeService,
    ) -> AppResult<Vec<VideoSummary>> {
        #[derive(serde::Deserialize)]
        struct SubscribedChannel {
            id: String,
        }

        let subs_json = match crate::db::settings::get_setting(&self.pool, "subscriptions").await? {
            Some(s) => s,
            None => return Ok(Vec::new()),
        };

        let mut channel_ids = Vec::new();
        if let Ok(channels) = serde_json::from_str::<Vec<SubscribedChannel>>(&subs_json) {
            channel_ids = channels.into_iter().map(|c| c.id).collect();
        } else if let Ok(ids) = serde_json::from_str::<Vec<String>>(&subs_json) {
            channel_ids = ids;
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&subs_json) {
            if let Some(arr) = val.as_array() {
                for item in arr {
                    if let Some(id) = item.as_str() {
                        channel_ids.push(id.to_string());
                    } else if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        channel_ids.push(id.to_string());
                    }
                }
            }
        }

        if channel_ids.is_empty() {
            return Ok(Vec::new());
        }

        let cursor_str = crate::db::settings::get_setting(&self.pool, "homeSubsRotationCursor")
            .await?
            .unwrap_or_else(|| "0".to_string());
        let mut cursor: usize = cursor_str.parse().unwrap_or(0);

        let total_subs = channel_ids.len();
        if cursor >= total_subs {
            cursor = 0;
        }

        let batch_size = 5;
        let mut batch_channels = Vec::new();
        for i in 0..batch_size {
            let idx = (cursor + i) % total_subs;
            let cid = &channel_ids[idx];
            if !batch_channels.contains(cid) {
                batch_channels.push(cid.clone());
            }
        }

        let mut futures = Vec::new();
        for cid in &batch_channels {
            futures.push(youtube_service.get_channel_tab(
                cid,
                Some(crate::api::innertube::extractors::channel::VIDEOS_TAB_PARAMS.to_string()),
                None,
                None,
            ));
        }

        let results = futures_util::future::join_all(futures).await;
        let mut candidates = Vec::new();
        let mut seen_ids = HashSet::new();

        for res in results {
            if let Ok(resp) = res {
                for item in resp.items {
                    if let crate::models::channel::ChannelItem::Video(video) = item {
                        if seen_ids.insert(video.id.clone()) {
                            candidates.push(video);
                        }
                    }
                }
            }
        }

        if !candidates.is_empty() {
            let mut lcg_seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u32;
            for i in (1..candidates.len()).rev() {
                lcg_seed = lcg_seed.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fffffff;
                let j = (lcg_seed as usize) % (i + 1);
                candidates.swap(i, j);
            }
        }

        let next_cursor = (cursor + batch_channels.len()) % total_subs;
        crate::db::settings::set_setting(
            &self.pool,
            "homeSubsRotationCursor",
            &next_cursor.to_string(),
        )
        .await?;

        Ok(candidates)
    }

    pub async fn get_brain_snapshot(&self) -> AppResult<UserBrain> {
        Ok(self.brain_store.read().await.clone())
    }

    pub async fn get_recommendation_log(
        &self,
        limit: i64,
    ) -> AppResult<Vec<recommendations::RecommendationEvent>> {
        recommendations::get_recommendation_events(&self.pool, limit).await
    }

    pub async fn unblock_topic(&self, topic: String) -> AppResult<()> {
        let mut brain = self.brain_store.write().await;
        let topic_lower = topic.trim().to_lowercase();
        brain
            .blocked_topics
            .retain(|t| t.to_lowercase() != topic_lower);
        Ok(())
    }

    pub async fn add_blocked_topic(&self, topic: String) -> AppResult<()> {
        let normalized = topic.trim().to_lowercase();
        if normalized.is_empty() {
            return Ok(());
        }
        let mut brain = self.brain_store.write().await;
        let lemma = brain.key_spec().key_of(&normalized);
        brain.blocked_topics.insert(normalized.clone());
        brain
            .preferred_topics
            .retain(|preferred| preferred.to_lowercase() != normalized);
        brain.global_vector.topics.retain(|key, _| {
            let key_lower = key.to_lowercase();
            !key_lower.contains(&lemma) && !key_lower.contains(&normalized)
        });
        let brain = &mut *brain;
        for vector in brain
            .time_vectors
            .values_mut()
            .chain([&mut brain.recent_vector, &mut brain.shorts_vector])
        {
            vector.topics.retain(|key, _| {
                let key_lower = key.to_lowercase();
                !key_lower.contains(&lemma) && !key_lower.contains(&normalized)
            });
        }
        Ok(())
    }

    pub async fn add_preferred_topic(&self, topic: String) -> AppResult<()> {
        let trimmed = topic.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let normalized = trimmed.to_lowercase();
        let mut brain = self.brain_store.write().await;
        brain
            .blocked_topics
            .retain(|blocked| blocked.to_lowercase() != normalized);
        brain.preferred_topics.insert(trimmed.to_string());
        brain.display_forms = with_pick_spellings(
            &brain.display_forms,
            &[trimmed.to_string()],
            &brain.key_spec(),
        );
        for token in brain.key_spec().keys_of(trimmed) {
            let current = *brain.global_vector.topics.get(&token).unwrap_or(&0.0);
            brain.global_vector.topics.insert(token, current.max(0.5));
        }
        brain.has_completed_onboarding = true;
        Ok(())
    }

    pub async fn remove_preferred_topic(&self, topic: String) -> AppResult<()> {
        let topic_lower = topic.trim().to_lowercase();
        if topic_lower.is_empty() {
            return Ok(());
        }
        let mut brain = self.brain_store.write().await;
        brain
            .preferred_topics
            .retain(|preferred| preferred.to_lowercase() != topic_lower);
        Ok(())
    }

    pub async fn unblock_channel(&self, channel_id: String) -> AppResult<()> {
        let channel_id = channel_id.trim().trim_start_matches("channel:").to_string();
        let mut brain = self.brain_store.write().await;
        brain.blocked_channels.remove(&channel_id);
        brain.channel_strikes.remove(&channel_id);
        brain.suppressed_channels.remove(&channel_id);
        Ok(())
    }

    /// Explicit user "don't show this channel": permanent block plus scrubbed channel memory so
    /// stale affinity cannot survive beside the block.
    pub async fn block_channel(&self, channel_id: String) -> AppResult<()> {
        let channel_id = channel_id.trim().trim_start_matches("channel:").to_string();
        if channel_id.trim().is_empty() {
            return Ok(());
        }
        let mut brain = self.brain_store.write().await;
        brain.blocked_channels.insert(channel_id.clone());
        brain.channel_scores.remove(&channel_id);
        brain.suppressed_channels.remove(&channel_id);
        brain.channel_strikes.remove(&channel_id);
        Ok(())
    }

    /// Learns from a typed search; returns whether the query held a usable topic.
    pub async fn learn_from_search(&self, query: String) -> AppResult<bool> {
        if self.learning_paused().await {
            return Ok(false);
        }
        let now_ms = self.get_current_time_ms();
        Ok(learn_search(
            &mut *self.brain_store.write().await,
            &query,
            now_ms,
        ))
    }

    pub async fn note_subscription(
        &self,
        channel_id: String,
        channel_name: String,
        subscribed: bool,
    ) -> AppResult<()> {
        if self.learning_paused().await {
            return Ok(());
        }
        let channel_id = channel_id.trim().trim_start_matches("channel:");
        subscription_changed(
            &mut *self.brain_store.write().await,
            channel_id,
            &channel_name,
            subscribed,
        );
        Ok(())
    }

    /// Reads what channels are about from upload titles a feed already fetched, once per channel
    /// per session.
    pub async fn observe_channel_uploads(&self, uploads: Vec<VideoSummary>) -> AppResult<()> {
        if self.learning_paused().await {
            return Ok(());
        }
        let mut by_channel: HashMap<String, Vec<String>> = HashMap::new();
        {
            let profiled = self.profiled_channels.lock().unwrap();
            for video in uploads {
                let Some(channel_id) = video
                    .channel_id
                    .as_deref()
                    .map(|id| id.trim().trim_start_matches("channel:").to_string())
                    .filter(|id| !id.is_empty() && !profiled.contains(id))
                else {
                    continue;
                };
                by_channel.entry(channel_id).or_default().push(video.title);
            }
        }
        if by_channel.is_empty() {
            return Ok(());
        }
        self.profiled_channels
            .lock()
            .unwrap()
            .extend(by_channel.keys().cloned());
        learn_from_uploads(&mut *self.brain_store.write().await, &by_channel);
        Ok(())
    }

    /// Learns gently from an imported watch history; returns how many videos it learned from.
    pub async fn bootstrap_from_history(&self, videos: Vec<ImportedVideo>) -> AppResult<usize> {
        let learned = bootstrap_from_history(&mut *self.brain_store.write().await, videos);
        info!(learned, "[FlowNeuro] bootstrapped from imported history");
        Ok(learned)
    }

    /// Seeds topics from imported subscription names; returns how many topics it seeded.
    pub async fn bootstrap_from_subscriptions(
        &self,
        channel_names: Vec<String>,
    ) -> AppResult<usize> {
        let seeded =
            bootstrap_from_subscriptions(&mut *self.brain_store.write().await, &channel_names);
        info!(
            seeded,
            "[FlowNeuro] bootstrapped from imported subscriptions"
        );
        Ok(seeded)
    }

    /// Replaces the resident brain with an imported one, after checking it reads as a brain.
    pub async fn import_brain(&self, brain: serde_json::Value) -> AppResult<()> {
        let brain: UserBrain = serde_json::from_value(brain)
            .map_err(|error| AppError::Validation(format!("Not a FlowNeuro brain: {error}")))?;
        self.brain_store.replace(brain).await
    }

    /// Forgets everything learned but keeps what the viewer hid: blocks and "not interested"
    /// marks are choices, not learning (Android `keepingHiddenContent`).
    pub async fn reset_brain(&self) -> AppResult<()> {
        {
            let mut brain = self.brain_store.write().await;
            *brain = brain.keeping_hidden_content();
            brain.settle_languages(&system_language());
        }
        self.impression_cache.lock().unwrap().clear();
        self.session_topic_history.lock().unwrap().clear();
        *self.session_video_count.lock().unwrap() = 0;
        self.watch.lock().unwrap().session = None;
        self.momentum.lock().unwrap().clear();
        self.stores.clear().await?;
        recommendations::clear_recommendation_events(&self.pool).await
    }
}

/// A channel a watch raised above its starting score.
pub(crate) fn is_watched_channel(brain: &UserBrain, channel: &str) -> bool {
    brain.channel_scores.get(channel).copied().unwrap_or(0.0) > NEUTRAL_CHANNEL_SCORE
}

/// A real watch, a like or a save, as learning counts it.
fn is_strong_signal(kind: InteractionType, percent_watched: f32) -> bool {
    matches!(kind, InteractionType::Liked | InteractionType::Saved)
        || (kind == InteractionType::Watched && percent_watched >= 0.40)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_imported_non_empty_brain_as_onboarded() {
        let mut brain = UserBrain::default();
        brain.has_completed_onboarding = false;
        brain.total_interactions = 0;
        brain.global_vector.topics.insert("game".to_string(), 0.75);

        assert!(RecommendationService::has_meaningful_brain_data(&brain));

        let empty_brain = UserBrain::default();
        assert!(!RecommendationService::has_meaningful_brain_data(
            &empty_brain
        ));
    }
}
