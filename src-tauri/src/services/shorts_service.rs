use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::future::join_all;
use tokio::time::timeout;

use crate::api::innertube::extractors::shorts::encode_reel_seed_params;
use crate::errors::AppResult;
use crate::models::channel::ChannelItem;
use crate::models::search::SearchVideosRequest;
use crate::models::shorts::{ShortItem, ShortsFeed};
use crate::models::video::VideoSummary;
use crate::services::recommendation_service::{DiscoverySurface, RecommendationService};
use crate::services::youtube_service::YoutubeService;

/// Channel "Shorts" tab browse params — the videos-tab token with `videos`
/// swapped for `shorts` (`EgZ2aWRlb3PyBgQKAjoA` → `EgZzaG9ydHPyBgQKAjoA`).
const SHORTS_TAB_PARAMS: &str = "EgZzaG9ydHPyBgQKAjoA";
const FLOW_DISCOVERY_CONTINUATION: &str = "flow:shorts:discovery";

/// Shorts handed back per page.
const PAGE_SIZE: usize = 10;
/// Refill the buffer once it drops below this so swiping never blocks on the network.
const BUFFER_LOW_WATERMARK: usize = 20;
/// Topic-discovery searches per gather (each is one engine-generated query).
const MAX_DISCOVERY_QUERIES: usize = 3;
/// Results kept from each discovery search.
const SHORTS_PER_SEARCH: usize = 12;
/// Subscribed channels probed for fresh Shorts per gather.
const MAX_SUB_CHANNELS: usize = 6;
/// Upper bound (seconds) for a discovery-search result to count as a Short.
const SHORTS_DISCOVERY_MAX_DURATION: u64 = 180;
/// Reels kept from one page of a seed chain.
const SHORTS_PER_SEED_CHAIN: usize = 10;
/// Seed chains a fresh feed opens at once (Android `ShortsFeedPager.OPENING_SEEDS`).
const OPENING_SEEDS: usize = 2;
/// Pages one chain serves before the next seed takes over (Android `PAGES_PER_CHAIN`).
const PAGES_PER_CHAIN: usize = 3;
/// Seeds used lately rest while enough others qualify.
const SEED_COOLDOWN_MAX: usize = 12;
/// Session de-dup memory cap (prevents re-showing within a session).
const MAX_RECENTLY_SHOWN: usize = 300;
/// Reel browse sometimes needs a little longer, but should not dominate startup.
const REEL_LANE_TIMEOUT: Duration = Duration::from_secs(10);
/// Discovery is useful for filling the pool, but it must stay fast.
const DISCOVERY_LANE_TIMEOUT: Duration = Duration::from_secs(5);
const SUBS_LANE_TIMEOUT: Duration = Duration::from_secs(5);
/// Recommendation query generation can block behind local state writes.
const DISCOVERY_QUERY_TIMEOUT: Duration = Duration::from_millis(800);
/// Per-search ceiling; discovery searches run in parallel.
const DISCOVERY_SEARCH_TIMEOUT: Duration = Duration::from_millis(3_500);

/// Which sources a single gather pass should draw from.
/// A reel chain opened from a Short the viewer liked, saved or watched through, followed for a few
/// pages (Android `ShortsFeedPager.SeedChain`).
#[derive(Debug, Clone)]
struct SeedChain {
    seed_id: String,
    continuation: Option<String>,
    opened: bool,
    pages_served: usize,
    failed: bool,
}

impl SeedChain {
    fn new(seed_id: String) -> Self {
        Self {
            seed_id,
            continuation: None,
            opened: false,
            pages_served: 0,
            failed: false,
        }
    }

    fn has_more(&self) -> bool {
        !self.failed
            && (!self.opened || self.continuation.is_some())
            && self.pages_served < PAGES_PER_CHAIN
    }
}

struct GatherSpec {
    include_reel: bool,
    reel_sequence_params: Option<String>,
    include_discovery: bool,
    include_subs: bool,
}

impl GatherSpec {
    /// A fresh personalised feed, where seed chains open rather than continue.
    fn is_opening(&self) -> bool {
        self.include_reel && self.include_subs && self.reel_sequence_params.is_none()
    }

    /// Personalised home feed: reel feed + topic discovery + subscription Shorts.
    fn home() -> Self {
        Self {
            include_reel: true,
            reel_sequence_params: None,
            include_discovery: true,
            include_subs: true,
        }
    }

    /// The feed opened from a specific Short: that Short's reel sequence first, with the
    /// personalised sources beside it, since some reels have no sequence of their own.
    fn seeded(video_id: &str) -> Self {
        Self {
            include_reel: true,
            reel_sequence_params: Some(encode_reel_seed_params(video_id)),
            include_discovery: true,
            include_subs: true,
        }
    }

    /// Next page: continue the reel sequence and refresh topic discovery.
    fn continuation(token: Option<String>) -> Self {
        let flow_discovery = token
            .as_deref()
            .is_some_and(|value| value.starts_with(FLOW_DISCOVERY_CONTINUATION));
        Self {
            include_reel: !flow_discovery,
            reel_sequence_params: token
                .filter(|value| !value.starts_with(FLOW_DISCOVERY_CONTINUATION)),
            include_discovery: true,
            include_subs: flow_discovery,
        }
    }
}

/// One page of `chain`, and the chain moved on by it; a failed request ends the chain.
async fn advance(
    yt: &YoutubeService,
    mut chain: SeedChain,
    region: Option<String>,
) -> (SeedChain, Vec<ShortItem>) {
    let sequence = if chain.opened {
        chain.continuation.clone()
    } else {
        Some(encode_reel_seed_params(&chain.seed_id))
    };
    match yt.get_shorts_sequence(sequence, region).await {
        Ok(feed) => {
            chain.opened = true;
            chain.continuation = feed.continuation.filter(|token| !token.is_empty());
            chain.pages_served += 1;
            let seed = chain.seed_id.clone();
            let items = feed
                .items
                .into_iter()
                .filter(|item| item.id != seed)
                .take(SHORTS_PER_SEED_CHAIN)
                .collect();
            (chain, items)
        }
        Err(error) => {
            tracing::warn!("[shorts] seed chain {} failed: {error}", chain.seed_id);
            chain.failed = true;
            (chain, Vec::new())
        }
    }
}

/// A reel's like count from its overlay text ("12K", "1,234 likes"): the number and its suffix
/// only, since a word like "likes" would read as a thousands mark.
fn like_count_of(text: &str) -> u64 {
    crate::flow_neuro::rank::view_count_of(text.split_whitespace().next())
}

/// Builds and serves the personalised Shorts feed. Candidates come from three
/// sources (reel sequence, topic discovery, subscription Shorts), then are ranked
/// by the shared `RecommendationService` — the same brain as the video feed,
/// which is where blocked topics, watched penalties and channel/topic diversity
/// get enforced. Ranked overflow is buffered so `load_more` serves instantly.
pub struct ShortsService {
    recently_shown: Mutex<HashSet<String>>,
    /// Seeds whose reel chains opened lately, oldest first.
    recent_seeds: Mutex<VecDeque<String>>,
    /// Seed chains still serving pages, the one being followed first.
    chains: tokio::sync::Mutex<VecDeque<SeedChain>>,
    buffer: Mutex<VecDeque<ShortItem>>,
    last_continuation: Mutex<Option<String>>,
    // Serializes feed operations so overlapping calls (e.g. React StrictMode's
    // dev double-invoke) can't race on the shared session state and deplete it.
    op_lock: tokio::sync::Mutex<()>,
}

impl ShortsService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            recently_shown: Mutex::new(HashSet::new()),
            recent_seeds: Mutex::new(VecDeque::new()),
            chains: tokio::sync::Mutex::new(VecDeque::new()),
            buffer: Mutex::new(VecDeque::new()),
            last_continuation: Mutex::new(None),
            op_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Open (or re-open) the feed. A `seed_video_id` switches to a collaborative
    /// sequence anchored on that video; otherwise the personalised home feed is built.
    pub async fn get_feed(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        seed_video_id: Option<String>,
        user_subs: Vec<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        // A fresh open serializes against any in-flight call and starts clean, so a
        // re-fetch can never deplete its own candidates via the seen-set.
        let _guard = self.op_lock.lock().await;
        self.reset();

        let spec = match seed_video_id.as_deref() {
            Some(seed) if !seed.is_empty() => GatherSpec::seeded(seed),
            _ => GatherSpec::home(),
        };

        let (mut items, mut continuation) = self
            .gather_and_rank(yt, rec, &spec, &user_subs, region.clone())
            .await?;

        if items.len() < PAGE_SIZE && continuation.is_some() {
            let spec = GatherSpec::continuation(continuation.clone());
            match self
                .gather_and_rank(yt, rec, &spec, &user_subs, region)
                .await
            {
                Ok((mut more, next_continuation)) => {
                    tracing::info!("[shorts] startup supplemental gathered: {}", more.len());
                    items.append(&mut more);
                    if next_continuation.is_some() {
                        continuation = next_continuation;
                    }
                }
                Err(error) => {
                    tracing::warn!("[shorts] startup supplemental failed: {}", error);
                }
            }
        }

        self.last_continuation
            .lock()
            .unwrap()
            .clone_from(&continuation);

        let mut deque: VecDeque<ShortItem> = items.into();
        let page = drain(&mut deque, PAGE_SIZE);
        *self.buffer.lock().unwrap() = deque;

        Ok(ShortsFeed {
            items: page,
            continuation,
        })
    }

    /// Serve the next page from the prefetch buffer, refilling once it runs low so
    /// swiping never waits on the network.
    pub async fn load_more(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        continuation: Option<String>,
        user_subs: Vec<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        let _guard = self.op_lock.lock().await;
        if continuation.is_some() {
            *self.last_continuation.lock().unwrap() = continuation;
        }

        let mut page = drain(&mut self.buffer.lock().unwrap(), PAGE_SIZE);

        if self.buffer.lock().unwrap().len() < BUFFER_LOW_WATERMARK {
            let token = self.last_continuation.lock().unwrap().clone();
            let spec = GatherSpec::continuation(token);
            if let Ok((items, new_continuation)) = self
                .gather_and_rank(yt, rec, &spec, &user_subs, region)
                .await
            {
                if new_continuation.is_some() {
                    *self.last_continuation.lock().unwrap() = new_continuation;
                }
                self.buffer.lock().unwrap().extend(items);
            }
        }

        if page.is_empty() {
            page = drain(&mut self.buffer.lock().unwrap(), PAGE_SIZE);
        }

        Ok(ShortsFeed {
            items: page,
            continuation: self.last_continuation.lock().unwrap().clone(),
        })
    }

    /// Drop session state so the next `get_feed` starts fresh.
    pub fn reset(&self) {
        self.recently_shown.lock().unwrap().clear();
        self.buffer.lock().unwrap().clear();
        *self.last_continuation.lock().unwrap() = None;
        if let Ok(mut chains) = self.chains.try_lock() {
            chains.clear();
        }
    }

    /// Gather candidates from the spec's sources, de-dup, then rank through the engine.
    async fn gather_and_rank(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        spec: &GatherSpec,
        user_subs: &[String],
        region: Option<String>,
    ) -> AppResult<(Vec<ShortItem>, Option<String>)> {
        let seed_region = region.clone();
        let reel_fut = timeout(REEL_LANE_TIMEOUT, async {
            if spec.include_reel {
                yt.get_shorts_sequence(spec.reel_sequence_params.clone(), region)
                    .await
            } else {
                Ok(ShortsFeed::default())
            }
        });
        let discovery_fut = timeout(DISCOVERY_LANE_TIMEOUT, async {
            if spec.include_discovery {
                gather_discovery(yt, rec).await
            } else {
                Vec::new()
            }
        });
        // Discovery passes also follow one Short the viewer liked or watched through.
        let seed_fut = timeout(REEL_LANE_TIMEOUT, async {
            if spec.include_discovery {
                self.gather_seed_chains(yt, rec, spec.is_opening(), seed_region)
                    .await
            } else {
                Vec::new()
            }
        });
        let subs_fut = timeout(SUBS_LANE_TIMEOUT, async {
            if spec.include_subs {
                gather_subscription_shorts(yt, user_subs).await
            } else {
                Vec::new()
            }
        });

        let (reel_res, discovery_res, subs_res, seed_res) =
            tokio::join!(reel_fut, discovery_fut, subs_fut, seed_fut);
        let seeded = seed_res.unwrap_or_else(|_| {
            tracing::warn!("[shorts] seed chain timed out");
            Vec::new()
        });

        let reel_res = reel_res.unwrap_or_else(|_| {
            tracing::warn!("[shorts] reel lane timed out");
            Ok(ShortsFeed::default())
        });
        let discovery = discovery_res.unwrap_or_else(|_| {
            tracing::warn!("[shorts] discovery lane timed out");
            Vec::new()
        });
        let subs = subs_res.unwrap_or_else(|_| {
            tracing::warn!("[shorts] subscription lane timed out");
            Vec::new()
        });

        if let Err(error) = &reel_res {
            tracing::warn!("[shorts] reel lane error: {}", error);
        }
        tracing::info!(
            "[shorts] gather lanes: reel={} discovery={} subs={} seeded={}",
            reel_res.as_ref().map(|feed| feed.items.len()).unwrap_or(0),
            discovery.len(),
            subs.len(),
            seeded.len(),
        );

        // Reel items carry rich overlay metadata (avatar, likes); keep it so the
        // ranked result is reassembled with that detail intact.
        let mut rich: HashMap<String, ShortItem> = HashMap::new();
        let mut candidates: Vec<VideoSummary> = Vec::new();
        let mut continuation = None;

        if let Ok(feed) = reel_res {
            continuation = feed.continuation;
            for item in feed.items {
                candidates.push(item.to_video_summary());
                rich.insert(item.id.clone(), item);
            }
        }
        for item in seeded {
            candidates.push(item.to_video_summary());
            rich.entry(item.id.clone()).or_insert(item);
        }
        candidates.extend(discovery);
        candidates.extend(subs);

        if candidates.is_empty() && spec.include_discovery {
            tracing::warn!("[shorts] all lanes empty; trying fast discovery fallback");
            candidates.extend(gather_fast_discovery_fallback(yt).await);
        }

        let candidates = self.dedup_unseen(candidates);
        tracing::info!("[shorts] candidates after dedup: {}", candidates.len());
        if candidates.is_empty() {
            return Ok((Vec::new(), continuation));
        }

        let subs_set: HashSet<String> = user_subs.iter().cloned().collect();
        let like_counts: HashMap<String, u64> = rich
            .iter()
            .filter_map(|(id, item)| {
                let likes = like_count_of(item.like_count_text.as_deref()?);
                (likes > 0).then(|| (id.clone(), likes))
            })
            .collect();
        let ranked = rec
            .rank_shorts_candidates(candidates, subs_set, &like_counts)
            .await?;
        tracing::info!("[shorts] ranked: {}", ranked.len());
        if ranked.is_empty() {
            return Ok((Vec::new(), continuation));
        }

        self.mark_shown(ranked.iter().map(|video| video.id.clone()));

        let items: Vec<_> = ranked
            .into_iter()
            .map(|video| {
                rich.remove(&video.id)
                    .unwrap_or_else(|| ShortItem::from_video_summary(video))
            })
            .collect();

        let continuation = continuation.or_else(|| {
            if spec.include_discovery || spec.include_subs {
                Some(FLOW_DISCOVERY_CONTINUATION.to_string())
            } else {
                None
            }
        });

        Ok((items, continuation))
    }

    /// New seeds for chains, resting the ones used lately unless too few others qualify.
    async fn next_seeds(&self, rec: &RecommendationService, count: usize) -> Vec<String> {
        let cooled: HashSet<String> = self.recent_seeds.lock().unwrap().iter().cloned().collect();
        let seeds = rec.short_seeds(count, &cooled).await;
        let mut recent = self.recent_seeds.lock().unwrap();
        for seed in &seeds {
            recent.retain(|id| id != seed);
            recent.push_back(seed.clone());
        }
        while recent.len() > SEED_COOLDOWN_MAX {
            recent.pop_front();
        }
        seeds
    }

    /// Reels from the seed chains: a fresh feed opens two at once; later passes follow the first
    /// chain one page further and open a new seed once every chain has served its pages.
    async fn gather_seed_chains(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        opening: bool,
        region: Option<String>,
    ) -> Vec<ShortItem> {
        let mut chains = self.chains.lock().await;
        if opening {
            chains.clear();
        }
        chains.retain(SeedChain::has_more);
        if chains.is_empty() {
            let wanted = if opening { OPENING_SEEDS } else { 1 };
            chains.extend(
                self.next_seeds(rec, wanted)
                    .await
                    .into_iter()
                    .map(SeedChain::new),
            );
        }
        let advancing = if opening {
            chains.len()
        } else {
            chains.len().min(1)
        };
        let pages = futures_util::future::join_all(
            chains
                .iter()
                .take(advancing)
                .map(|chain| advance(yt, chain.clone(), region.clone())),
        )
        .await;
        let mut items = Vec::new();
        for (index, (chain, page)) in pages.into_iter().enumerate() {
            chains[index] = chain;
            items.extend(page);
        }
        items
    }

    /// Remove blank/duplicate ids and anything already shown this session.
    fn dedup_unseen(&self, candidates: Vec<VideoSummary>) -> Vec<VideoSummary> {
        let shown = self.recently_shown.lock().unwrap();
        let mut seen = HashSet::new();
        candidates
            .into_iter()
            .filter(|video| {
                !video.id.is_empty() && !shown.contains(&video.id) && seen.insert(video.id.clone())
            })
            .collect()
    }

    fn mark_shown(&self, ids: impl Iterator<Item = String>) {
        let mut shown = self.recently_shown.lock().unwrap();
        shown.extend(ids);
        if shown.len() > MAX_RECENTLY_SHOWN {
            let excess = shown.len() - MAX_RECENTLY_SHOWN;
            let stale: Vec<String> = shown.iter().take(excess).cloned().collect();
            for id in stale {
                shown.remove(&id);
            }
        }
    }
}

impl Default for ShortsService {
    fn default() -> Self {
        Self::new()
    }
}

/// Pop up to `count` items off the front of a deque.
fn drain(buffer: &mut VecDeque<ShortItem>, count: usize) -> Vec<ShortItem> {
    let take = count.min(buffer.len());
    buffer.drain(..take).collect()
}

/// Topic discovery: search the engine's learned-interest queries for on-topic
/// Shorts so the pool is taste-aligned before ranking.
async fn gather_discovery(yt: &YoutubeService, rec: &RecommendationService) -> Vec<VideoSummary> {
    let mut queries = timeout(
        DISCOVERY_QUERY_TIMEOUT,
        rec.generate_discovery_queries(DiscoverySurface::Shorts, false),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .unwrap_or_default();
    if queries.is_empty() {
        queries = fallback_discovery_queries();
    }
    tracing::info!(
        discovery_queries = queries.len(),
        "[shorts] gathered discovery queries"
    );
    tracing::debug!("[shorts] discovery queries: {:?}", queries);

    let queries: Vec<String> = queries.into_iter().take(MAX_DISCOVERY_QUERIES).collect();
    run_discovery_searches(yt, queries, "discovery").await
}

async fn gather_fast_discovery_fallback(yt: &YoutubeService) -> Vec<VideoSummary> {
    run_discovery_searches(yt, fallback_discovery_queries(), "fallback").await
}

async fn run_discovery_searches(
    yt: &YoutubeService,
    queries: Vec<String>,
    lane: &'static str,
) -> Vec<VideoSummary> {
    let searches = queries.into_iter().map(|query| {
        let request = SearchVideosRequest {
            query,
            duration: Some("short".to_string()),
            ..SearchVideosRequest::default()
        };
        async move {
            timeout(DISCOVERY_SEARCH_TIMEOUT, yt.search_videos(request))
                .await
                .ok()
                .and_then(Result::ok)
        }
    });

    let mut returned = 0usize;
    let mut kept: Vec<VideoSummary> = Vec::new();
    for response in join_all(searches).await.into_iter().flatten() {
        returned += response.items.len();
        kept.extend(
            response
                .items
                .into_iter()
                .filter(is_short_candidate)
                .take(SHORTS_PER_SEARCH),
        );
    }

    tracing::info!(
        lane,
        returned,
        kept = kept.len(),
        "[shorts] discovery search results"
    );
    kept
}

fn fallback_discovery_queries() -> Vec<String> {
    ["shorts", "music shorts", "trending shorts"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// Subscription Shorts: pull the Shorts tab for a slice of the user's subs; these
/// earn the subscription boost during ranking.
async fn gather_subscription_shorts(
    yt: &YoutubeService,
    user_subs: &[String],
) -> Vec<VideoSummary> {
    if user_subs.is_empty() {
        return Vec::new();
    }

    let fetches = user_subs.iter().take(MAX_SUB_CHANNELS).map(|channel_id| {
        let channel_id = channel_id.clone();
        async move {
            let response = yt
                .get_channel_tab(&channel_id, Some(SHORTS_TAB_PARAMS.to_string()), None, None)
                .await;
            (channel_id, response)
        }
    });

    let mut shorts = Vec::new();
    for (channel_id, response) in join_all(fetches).await {
        let Ok(tab) = response else { continue };
        for item in tab.items {
            if let ChannelItem::Short(short) = item {
                if short.id.is_empty() {
                    continue;
                }
                shorts.push(VideoSummary {
                    id: short.id,
                    title: short.title,
                    channel_name: String::new(),
                    channel_id: Some(channel_id.clone()),
                    thumbnail_url: short.thumbnail_url,
                    duration_seconds: None,
                    published_text: None,
                    view_count_text: short.view_count_text,
                    channel_avatar_url: None,
                    is_live: false,
                });
            }
        }
    }
    shorts
}

/// A search result counts as a Short when it is a real video id under the ceiling.
fn is_short_candidate(video: &VideoSummary) -> bool {
    video.id.len() == 11
        && !video.id.starts_with("channel:")
        && !video.is_live
        && video
            .duration_seconds
            .is_none_or(|seconds| (1..=SHORTS_DISCOVERY_MAX_DURATION).contains(&seconds))
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_seed_chain_serves_three_pages_unless_it_runs_out_or_fails() {
        let mut chain = SeedChain::new("seed".into());
        assert!(
            chain.has_more(),
            "an unopened chain has its first page to give"
        );
        chain.opened = true;
        chain.continuation = Some("next".into());
        chain.pages_served = 2;
        assert!(chain.has_more());
        chain.pages_served = PAGES_PER_CHAIN;
        assert!(!chain.has_more());
        chain.pages_served = 1;
        chain.continuation = None;
        assert!(!chain.has_more(), "no continuation, no next page");
        chain.continuation = Some("next".into());
        chain.failed = true;
        assert!(!chain.has_more());
    }

    #[test]
    fn a_reel_like_count_reads_its_number_and_suffix_only() {
        assert_eq!(like_count_of("12K"), 12_000);
        assert_eq!(like_count_of("1.2M likes"), 1_200_000);
        assert_eq!(like_count_of("123 likes"), 123);
    }
    use super::*;

    fn video(id: &str, duration: Option<u64>) -> VideoSummary {
        VideoSummary {
            id: id.to_string(),
            title: String::new(),
            channel_name: String::new(),
            channel_id: None,
            thumbnail_url: None,
            duration_seconds: duration,
            published_text: None,
            view_count_text: None,
            channel_avatar_url: None,
            is_live: false,
        }
    }

    #[test]
    fn drain_pops_up_to_count_and_stops_at_empty() {
        let mut deque: VecDeque<ShortItem> = (0..3)
            .map(|i| ShortItem::from_video_summary(video(&format!("id{i}"), None)))
            .collect();
        assert_eq!(drain(&mut deque, 2).len(), 2);
        assert_eq!(deque.len(), 1);
        assert_eq!(drain(&mut deque, 10).len(), 1);
        assert!(deque.is_empty());
        assert!(drain(&mut deque, 5).is_empty());
    }

    #[test]
    fn dedup_unseen_drops_blank_duplicate_and_already_shown() {
        let service = ShortsService::new();
        service.mark_shown(std::iter::once("seen1".to_string()));
        let unseen = service.dedup_unseen(vec![
            video("", None),
            video("a", None),
            video("a", None),
            video("seen1", None),
            video("b", None),
        ]);
        let ids: Vec<_> = unseen.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn mark_shown_caps_session_memory() {
        let service = ShortsService::new();
        service.mark_shown((0..MAX_RECENTLY_SHOWN + 50).map(|i| format!("id{i}")));
        assert!(service.recently_shown.lock().unwrap().len() <= MAX_RECENTLY_SHOWN);
    }

    #[test]
    fn is_short_candidate_requires_real_id_and_bounded_duration() {
        assert!(is_short_candidate(&video("01234567890", Some(30))));
        assert!(!is_short_candidate(&video("too_short", Some(30))));
        assert!(!is_short_candidate(&video("01234567890", Some(600))));
    }

    #[test]
    fn is_short_candidate_keeps_results_without_a_duration() {
        assert!(is_short_candidate(&video("01234567890", None)));
    }

    #[test]
    fn is_short_candidate_rejects_live_streams() {
        let mut live = video("01234567890", None);
        live.is_live = true;
        assert!(!is_short_candidate(&live));
    }

    #[test]
    fn continuation_spec_routes_reel_and_flow_tokens() {
        let reel = GatherSpec::continuation(Some("reelToken".to_string()));
        assert!(reel.include_reel);
        assert_eq!(reel.reel_sequence_params.as_deref(), Some("reelToken"));
        assert!(!reel.include_subs);

        let flow = GatherSpec::continuation(Some(FLOW_DISCOVERY_CONTINUATION.to_string()));
        assert!(!flow.include_reel);
        assert!(flow.reel_sequence_params.is_none());
        assert!(flow.include_subs);
        assert!(flow.include_discovery);
    }
}
