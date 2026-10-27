//! One Home load, from Flow for Android's `HomeViewModel.loadFlowFeed`: wave 1 (three discovery
//! searches and the related lane), the first page from local stores and those, then after paint
//! the remaining searches, saved-interest related videos, a subscription top-up, channel memory
//! and neighbour refreshes, each slipped in below what the viewer sees.

use std::collections::{HashMap, HashSet};

use futures_util::future::join_all;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::arrange::{TasteProfile, rhythm_by_source, space_by_channel};
use super::card::Card;
use super::filters::{RECENT_CHANNEL_WINDOW, insert_below_viewport};
use super::inputs::Inputs;
use super::lanes::{self, Raw};
use super::mixer::FeedSource;
use super::origin::{Origin, OriginKind, Provenance, queries_by_id};
use super::seeds::{GraphCandidate, SeedInput, SeedSource, merge_candidates};
use super::sources::{
    channel_uploads, refresh_subscription_store, rotating_window, subscription_window_size,
};
use super::{HomeFeedService, cache, channel_memory, neighbours, now_ms};
use crate::flow_neuro::scoring::classify_persona;
use crate::services::recommendation_service::{DiscoverySurface, RecommendationService};
use crate::services::youtube_service::YoutubeService;

const WAVE1_QUERIES: usize = 3;
const MAX_RELATED_SEEDS: usize = 4;
const MAX_SAVED_SEEDS: usize = 5;
const SAVED_RELATED_SLOTS: usize = 8;
const SAVED_SEED_COOLDOWN_MS: u64 = 3 * 3_600_000;
const WAVE2_LIMIT: usize = 15;
const LATE_SUBS_MAX: usize = 8;
const LATE_SUBS_PER_CHANNEL: usize = 5;
/// Before the page reports its viewport, the first screen is still in view.
const LATE_MIN_INDEX: usize = 5;
const CHANNEL_GAP: usize = 10;
/// Followed-channel cards past the first page's rhythm wait for later pages while it keeps this many.
const FIRST_PAGE_MIN_SIZE: usize = 30;
const SUBSCRIPTION_STORE_REFRESH_MS: u64 = 30 * 60_000;
const FOLLOWED_SOURCES_PER_LOAD: usize = 2;
const TOP_UP_CONCURRENCY: usize = 6;
const PRIORITY_RETRY_MS: u64 = 30 * 60_000;
const REFRESH_CONCURRENCY: usize = 3;

/// The related lists of `seed_ids`, merged into graph candidates. A watched or liked seed's list
/// also teaches co-watch.
pub(super) async fn related_graph(
    service: &HomeFeedService,
    yt: &YoutubeService,
    rec: &RecommendationService,
    pool: &SqlitePool,
    seeds: &[SeedInput],
    seed_ids: &[String],
    now: u64,
) -> Vec<GraphCandidate> {
    let by_id: HashMap<&str, &SeedInput> =
        seeds
            .iter()
            .filter(|s| seed_ids.contains(&s.id))
            .fold(HashMap::new(), |mut map, seed| {
                let better = map
                    .get(seed.id.as_str())
                    .is_none_or(|s: &&SeedInput| seed.score(now) > s.score(now));
                if better {
                    map.insert(&seed.id, seed);
                }
                map
            });
    let lists = join_all(seed_ids.iter().map(|seed_id| async move {
        (
            seed_id,
            service.inner.related.get(yt, pool, seed_id, now).await,
        )
    }))
    .await;
    let mut candidates = Vec::new();
    for (seed_id, cards) in lists {
        let seed = by_id.get(seed_id.as_str());
        if let Some(seed) = seed
            && matches!(seed.source, SeedSource::WatchHistory | SeedSource::Liked)
            && !cards.is_empty()
        {
            rec.note_related_of(&seed.id, &seed.channel_id, &cards)
                .await;
        }
        let seed_score = seed.map_or(0.0, |s| s.score(now));
        let count = cards.len();
        candidates.extend(
            cards
                .into_iter()
                .enumerate()
                .map(|(rank, card)| GraphCandidate {
                    card,
                    seed_id: seed_id.clone(),
                    seed_score,
                    graph_rank: rank,
                    seed_result_count: count,
                    hit_count: 1,
                }),
        );
    }
    merge_candidates(candidates)
}

/// The seed title each shown related card was found from, for its "Why you see this" line.
pub(super) fn seed_titles(
    candidates: &[GraphCandidate],
    seeds: &[SeedInput],
    shown: &HashSet<String>,
) -> HashMap<String, String> {
    let titles: HashMap<&str, &str> = seeds
        .iter()
        .map(|s| (s.id.as_str(), s.title.as_str()))
        .collect();
    candidates
        .iter()
        .filter(|c| shown.contains(c.card.id()))
        .filter_map(|c| {
            let title = titles.get(c.seed_id.as_str()).filter(|t| !t.is_empty())?;
            Some((c.card.id().to_string(), (*title).to_string()))
        })
        .collect()
}

/// Reports each search's results, so one that keeps returning shown videos rests.
pub(super) async fn report_searches(rec: &RecommendationService, searches: &[(String, Vec<Card>)]) {
    for (query, cards) in searches {
        let ids: Vec<String> = cards.iter().map(|c| c.id().to_string()).collect();
        rec.report_discovery_results(query, &ids).await;
    }
}

/// `HomeSnapshot::error` when the device's own data could not be read.
const LOCAL_DATA_FAILED: &str = "local";
/// `HomeSnapshot::error` when no source could be reached.
const NETWORK_FAILED: &str = "network";

impl HomeFeedService {
    /// Every search's first page, and whether each of them failed (no connection, not no results).
    async fn search_all(
        &self,
        yt: &YoutubeService,
        queries: &[String],
        now: u64,
    ) -> (Vec<(String, Vec<Card>)>, bool) {
        let pages = join_all(queries.iter().map(|query| async move {
            let page = self.inner.search_pages.first_page(yt, query, now).await;
            (query.clone(), page)
        }))
        .await;
        let all_failed = !pages.is_empty() && pages.iter().all(|(_, page)| page.is_err());
        let searches = pages
            .into_iter()
            .map(|(query, page)| (query, page.unwrap_or_default()))
            .collect();
        (searches, all_failed)
    }

    pub(super) async fn load(&self, app: &AppHandle, generation: u64) {
        let yt = app.state::<YoutubeService>();
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let now = now_ms();
        let wave1 = self.start_discovery(&rec).await;
        let Ok(brain) = rec.get_brain_snapshot().await else {
            self.settle_without_feed(app, generation, Some(LOCAL_DATA_FAILED));
            return;
        };
        let Ok(inputs) = Inputs::load(&pool, &brain, now).await else {
            self.settle_without_feed(app, generation, Some(LOCAL_DATA_FAILED));
            return;
        };
        self.inner
            .search_pages
            .set_upload_date(super::sources::upload_filter(inputs.max_video_age_ms));
        self.inner.feed.lock().unwrap().max_video_age_ms = inputs.max_video_age_ms;
        let ((searches, searches_failed), (related_seeds, related)) = tokio::join!(
            self.search_all(&yt, &wave1, now),
            self.related_lane(&yt, &rec, &pool, &inputs, now)
        );
        let nothing_reached = searches_failed && related.is_empty();
        report_searches(&rec, &searches).await;

        let taste = TasteProfile::of(&brain, &classify_persona(&brain));
        let recently_shown = rec.recently_shown().await;
        let followed = inputs.subscriptions.ids();
        let Local {
            store,
            memory_entries,
            remembered,
            raw_memory,
            neighbour_store,
            neighbour_list,
            raw_neighbours,
        } = local_sources(&rec, &pool, &inputs, &brain, &followed, now).await;
        let neighbour_channels_with_uploads: HashSet<String> = raw_neighbours
            .iter()
            .map(|c| c.channel_id().to_string())
            .collect();
        let query_of = queries_by_id(&searches);
        let lanes = lanes::build(
            &rec,
            Raw::new(&store, &searches, raw_memory, related, raw_neighbours, now),
            &inputs,
            &recently_shown,
            &taste,
            now,
        )
        .await;
        let on_screen: HashSet<String> = self
            .snapshot()
            .cards
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        let mix = lanes::assemble(&lanes, &on_screen, followed.len(), brain.total_interactions);
        if mix.cards.is_empty() {
            // Nothing to show because no search could be reached is a failure, not an empty feed.
            let error = nothing_reached.then_some(NETWORK_FAILED);
            self.settle_without_feed(app, generation, error);
            return;
        }
        let (laid_out, origins, related_picks) = layout(
            &mix,
            &followed,
            &neighbour_list,
            seed_titles_of(&lanes.related, &related_seeds, &mix),
            query_of,
        );
        // Shorts run to three minutes, so a card this long that no source called a Short is the
        // one place a Short could still get through.
        tracing::info!(
            cards = laid_out.len(),
            short_length_unflagged = laid_out
                .iter()
                .filter(|c| c
                    .video
                    .duration_seconds
                    .is_some_and(|seconds| (61..=180).contains(&seconds)))
                .count(),
            "Home feed built"
        );
        let paint = Paint {
            cards: &laid_out,
            origins: &origins,
            mix: &mix,
            related_picks: &related_picks,
            now,
        };
        if !self.paint(app, generation, &paint) {
            return;
        }
        let _ = cache::save_last_feed(&pool, &laid_out, &origins, now).await;
        save_unused(&pool, &lanes, &laid_out, now).await;

        let off_topic: HashSet<String> = neighbour_channels_with_uploads
            .difference(&lanes.relevant_neighbour_channels)
            .cloned()
            .collect();
        self.start_after_paint(
            app,
            AfterPaint {
                generation,
                taste,
                inputs,
                store,
                neighbours: neighbour_list
                    .into_iter()
                    .filter(|n| !off_topic.contains(&n.channel_id))
                    .collect(),
                off_topic,
                remembered,
                memory_entries,
                neighbour_store,
            },
        );
    }

    /// A refresh starts the discovery tree at its roots; returns the searches of wave 1.
    async fn start_discovery(&self, rec: &RecommendationService) -> Vec<String> {
        self.inner.search_pages.reset();
        let queries = rec
            .generate_discovery_queries(DiscoverySurface::Home, true)
            .await
            .unwrap_or_default();
        let wave1: Vec<String> = queries.iter().take(WAVE1_QUERIES).cloned().collect();
        let mut discovery = self.inner.discovery.lock().unwrap();
        discovery.queries = queries;
        discovery.next = wave1.len();
        wave1
    }

    /// The related lane: seeds from recent watches with one for a lasting interest, and their lists.
    async fn related_lane(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        now: u64,
    ) -> (Vec<SeedInput>, Vec<GraphCandidate>) {
        let disliked = inputs_disliked(inputs);
        let recent = inputs.recent_seeds(&disliked);
        let long_term = inputs.long_term_seeds(&disliked);
        let ids = rec
            .select_related_seeds(&recent, MAX_RELATED_SEEDS, &long_term)
            .await;
        let all: Vec<SeedInput> = recent.into_iter().chain(long_term).collect();
        let graph = related_graph(self, yt, rec, pool, &all, &ids, now).await;
        (all, graph)
    }

    /// Shows the first page, if this load is still the current one.
    fn paint(&self, app: &AppHandle, generation: u64, paint: &Paint) -> bool {
        self.update(app, generation, |feed| {
            feed.snapshot.cards.clone_from(paint.cards);
            feed.snapshot.origins.clone_from(paint.origins);
            feed.snapshot.loading = false;
            feed.snapshot.has_more = true;
            feed.snapshot.load_more_failed = false;
            feed.snapshot.error = None;
            feed.loaded_at = paint.now;
            feed.subs_backlog.clone_from(&paint.mix.subs_backlog);
            feed.memory_quota = paint.mix.memory_quota;
            feed.related_picks.clone_from(paint.related_picks);
        })
    }

    fn start_after_paint(&self, app: &AppHandle, after: AfterPaint) {
        let service = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move { service.after_paint(&app, after).await });
    }

    /// Ends a load that painted nothing; `error` says why when it failed rather than found nothing.
    fn settle_without_feed(&self, app: &AppHandle, generation: u64, error: Option<&str>) {
        self.update(app, generation, |feed| {
            feed.snapshot.loading = false;
            if feed.snapshot.cards.is_empty() {
                feed.snapshot.has_more = false;
                feed.snapshot.error = error.map(str::to_string);
            }
        });
    }

    /// Cards that arrived after paint, slipped in below the viewport.
    fn merge_late(
        &self,
        app: &AppHandle,
        generation: u64,
        late: &[Card],
        origin: impl Fn(&Card) -> Origin,
        grouped: &dyn Fn(&Card) -> bool,
    ) -> usize {
        let mut added = 0;
        self.update(app, generation, |feed| {
            if feed.snapshot.loading || feed.snapshot.cards.is_empty() {
                return;
            }
            let below = feed.last_visible.max(LATE_MIN_INDEX);
            let merged = insert_below_viewport(
                &feed.snapshot.cards,
                late,
                below,
                2,
                RECENT_CHANNEL_WINDOW,
                grouped,
            );
            added = merged.len() - feed.snapshot.cards.len();
            let on_screen: HashSet<String> = feed
                .snapshot
                .cards
                .iter()
                .map(|c| c.id().to_string())
                .collect();
            for card in merged.iter().filter(|c| !on_screen.contains(c.id())) {
                feed.snapshot
                    .origins
                    .insert(card.id().to_string(), origin(card));
            }
            feed.snapshot.cards = merged;
        });
        added
    }

    /// Cards appended after the feed's end (wave 2, saved interest), spaced from its tail.
    fn append(
        &self,
        app: &AppHandle,
        generation: u64,
        cards: Vec<Card>,
        origins: &HashMap<String, Origin>,
    ) {
        self.update(app, generation, |feed| {
            let on_screen: HashSet<&str> = feed.snapshot.cards.iter().map(Card::id).collect();
            let recent: HashSet<&str> = feed
                .snapshot
                .cards
                .iter()
                .rev()
                .take(RECENT_CHANNEL_WINDOW)
                .map(Card::channel_id)
                .collect();
            let mut seen_channels = HashSet::new();
            let fresh: Vec<Card> = cards
                .into_iter()
                .filter(|c| !on_screen.contains(c.id()))
                .filter(|c| c.channel_id().is_empty() || !recent.contains(c.channel_id()))
                .filter(|c| {
                    seen_channels.insert(if c.channel_id().is_empty() {
                        c.id().to_string()
                    } else {
                        c.channel_id().to_string()
                    })
                })
                .collect();
            if fresh.is_empty() {
                return;
            }
            let tail: Vec<String> = feed
                .snapshot
                .cards
                .iter()
                .rev()
                .take(CHANNEL_GAP)
                .rev()
                .map(|c| c.channel_id().to_string())
                .collect();
            for card in &fresh {
                if let Some(origin) = origins.get(card.id()) {
                    feed.snapshot
                        .origins
                        .insert(card.id().to_string(), origin.clone());
                }
            }
            feed.snapshot
                .cards
                .extend(space_by_channel(fresh, CHANNEL_GAP, &tail));
        });
    }

    async fn after_paint(&self, app: &AppHandle, after: AfterPaint) {
        let yt = app.state::<YoutubeService>();
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let followed = after.inputs.subscriptions.ids();
        // A newer load replaces this one, and its late work with it.
        let current = || self.generation() == after.generation;
        self.saved_interest(app, &yt, &rec, &pool, &after, &followed)
            .await;
        if current() {
            self.wave2(app, &yt, &rec, &after, &followed).await;
        }
        if current() {
            self.subscription_top_up(app, &yt, &rec, &pool, &after, &followed)
                .await;
        }
        if current() {
            self.channel_memory_refresh(app, &yt, &rec, &pool, &after, &followed)
                .await;
        }
        if current() {
            self.neighbour_refresh(&yt, &rec, &pool, &after).await;
        }
    }

    async fn saved_interest(
        &self,
        app: &AppHandle,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        after: &AfterPaint,
        followed: &HashSet<String>,
    ) {
        let now = now_ms();
        let cooled: HashSet<String> = {
            let mut cooldown = self.inner.saved_cooldown.lock().unwrap();
            cooldown.retain(|_, at| now.saturating_sub(*at) <= SAVED_SEED_COOLDOWN_MS);
            cooldown.keys().cloned().collect()
        };
        let disliked = inputs_disliked(&after.inputs);
        let seeds = after.inputs.saved_seeds(&disliked, &cooled);
        let long_term: Vec<SeedInput> = after
            .inputs
            .long_term_seeds(&disliked)
            .into_iter()
            .filter(|s| !cooled.contains(&s.id))
            .collect();
        let ids = rec
            .select_related_seeds(&seeds, MAX_SAVED_SEEDS, &long_term)
            .await;
        if ids.is_empty() {
            return;
        }
        {
            let mut cooldown = self.inner.saved_cooldown.lock().unwrap();
            for id in &ids {
                cooldown.insert(id.clone(), now);
            }
        }
        let all: Vec<SeedInput> = seeds.iter().chain(&long_term).cloned().collect();
        let on_screen: HashSet<String> = self
            .snapshot()
            .cards
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        let candidates: Vec<GraphCandidate> = related_graph(self, yt, rec, pool, &all, &ids, now)
            .await
            .into_iter()
            .filter(|g| {
                g.card.is_valid()
                    && !after.inputs.watched.contains(g.card.id())
                    && !after.inputs.exclusions.hides(&g.card)
            })
            .filter(|g| {
                super::filters::is_recent_suggestion(&g.card, now)
                    && !on_screen.contains(g.card.id())
            })
            .collect();
        let enriched: Vec<Card> = lanes::rank_related(rec, &candidates, followed, &after.taste)
            .await
            .into_iter()
            .take(SAVED_RELATED_SLOTS)
            .collect();
        if enriched.is_empty() {
            return;
        }
        let shown: HashSet<String> = enriched.iter().map(|c| c.id().to_string()).collect();
        let titles = seed_titles(&candidates, &all, &shown);
        let origins = shown
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    Origin::new(OriginKind::Related, titles.get(id).cloned()),
                )
            })
            .collect();
        self.inner.feed.lock().unwrap().related_picks.extend(shown);
        self.append(app, after.generation, enriched, &origins);
    }

    async fn wave2(
        &self,
        app: &AppHandle,
        yt: &YoutubeService,
        rec: &RecommendationService,
        after: &AfterPaint,
        followed: &HashSet<String>,
    ) {
        let queries: Vec<String> = {
            let mut discovery = self.inner.discovery.lock().unwrap();
            let rest = discovery
                .queries
                .iter()
                .skip(discovery.next)
                .cloned()
                .collect();
            // Asked once whatever they return: load-more must not search them again.
            discovery.next = discovery.queries.len();
            rest
        };
        if queries.is_empty() {
            return;
        }
        let now = now_ms();
        let (searches, _) = self.search_all(yt, &queries, now).await;
        report_searches(rec, &searches).await;
        let on_screen: HashSet<String> = self
            .snapshot()
            .cards
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        let hidden = |c: &Card| after.inputs.exclusions.hides(c);
        let valid: Vec<Card> = super::filters::keep_showable(
            searches
                .iter()
                .flat_map(|(_, cards)| cards.iter().cloned())
                .collect::<Vec<_>>(),
            &after.inputs.watched,
            &hidden,
            now,
            false,
        )
        .filter(|c| !on_screen.contains(c.id()))
        .collect();
        if valid.is_empty() {
            return;
        }
        let ranked = lanes::share(
            rec,
            after
                .taste
                .demote(lanes::rank(rec, valid, followed, true).await),
            followed,
        )
        .await;
        let picks: Vec<Card> = ranked.into_iter().take(WAVE2_LIMIT).collect();
        let query_of = queries_by_id(&searches);
        let origins = picks
            .iter()
            .map(|c| {
                (
                    c.id().to_string(),
                    Origin::new(OriginKind::Search, query_of.get(c.id()).cloned()),
                )
            })
            .collect();
        self.append(app, after.generation, picks, &origins);
    }

    async fn subscription_top_up(
        &self,
        app: &AppHandle,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        after: &AfterPaint,
        followed: &HashSet<String>,
    ) {
        if followed.is_empty() {
            return;
        }
        let now = now_ms();
        let mut channels: Vec<String> = followed
            .iter()
            .filter(|c| c.starts_with("UC"))
            .cloned()
            .collect();
        channels.sort();
        // The store is local; its RSS refresh runs at most twice an hour.
        if now.saturating_sub(
            cache::subscription_store_updated_at(pool)
                .await
                .unwrap_or(0),
        ) > SUBSCRIPTION_STORE_REFRESH_MS
        {
            refresh_subscription_store(yt, pool, &channels, now).await;
        }
        let window = self.top_up_window(&channels, &after.store, now);
        let uploads: Vec<Card> =
            crate::api::http::bounded_join(window, TOP_UP_CONCURRENCY, |channel| async move {
                channel_uploads(yt, &channel, now).await.unwrap_or_default()
            })
            .await
            .into_iter()
            .flatten()
            .collect();
        if uploads.is_empty() {
            return;
        }
        let _ = rec
            .observe_channel_uploads(uploads.iter().map(|c| c.video.clone()).collect())
            .await;
        let _ = cache::merge_subscription_uploads(
            pool,
            &uploads
                .iter()
                .filter(|c| c.published_at_ms > 0)
                .cloned()
                .collect::<Vec<_>>(),
            now,
        )
        .await;
        let on_screen: HashSet<String> = self
            .snapshot()
            .cards
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        let hidden = |c: &Card| after.inputs.exclusions.hides(c);
        let mut by_channel: HashMap<String, Vec<Card>> = HashMap::new();
        for card in
            super::filters::keep_showable(uploads, &after.inputs.watched, &hidden, now, false)
        {
            if !on_screen.contains(card.id()) {
                by_channel
                    .entry(card.channel_id().to_string())
                    .or_default()
                    .push(card);
            }
        }
        let candidates: Vec<Card> = by_channel
            .into_values()
            .flat_map(|mut cards| {
                cards.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
                cards.into_iter().take(LATE_SUBS_PER_CHANNEL)
            })
            .collect();
        let mut seen = HashSet::new();
        let late: Vec<Card> = lanes::rank(rec, candidates, followed, false)
            .await
            .into_iter()
            .filter(|c| seen.insert(c.channel_id().to_string()))
            .take(LATE_SUBS_MAX)
            .collect();
        self.merge_late(
            app,
            after.generation,
            &late,
            |_| Origin::new(OriginKind::Subscription, None),
            &|c| followed.contains(c.channel_id()),
        );
    }

    /// The channels one top-up asks: those whose fresh uploads still lack a length first, then a
    /// rotating window of the rest.
    fn top_up_window(&self, channels: &[String], store: &[Card], now: u64) -> Vec<String> {
        let missing: Vec<String> = {
            let mut missing: Vec<&Card> = store
                .iter()
                .filter(|c| {
                    !c.is_short() && !c.video.is_live && c.video.duration_seconds.unwrap_or(0) == 0
                })
                .filter(|c| {
                    c.age_ms(now)
                        .is_some_and(|age| age <= super::filters::FRESH_SUB_WINDOW_MS)
                })
                .collect();
            missing.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
            let mut seen = HashSet::new();
            missing
                .into_iter()
                .map(|c| c.channel_id().to_string())
                .filter(|c| seen.insert(c.clone()))
                .collect()
        };
        let size = subscription_window_size(channels.len());
        // A channel its Videos tab could not fill a length for is not asked again every load.
        let priority: Vec<String> = {
            let mut asked = self.inner.priority_asked.lock().unwrap();
            let picked: Vec<String> = missing
                .into_iter()
                .filter(|c| channels.contains(c))
                .filter(|c| {
                    asked
                        .get(c)
                        .is_none_or(|at| now.saturating_sub(*at) > PRIORITY_RETRY_MS)
                })
                .take(size / 2)
                .collect();
            for channel in &picked {
                asked.insert(channel.clone(), now);
            }
            picked
        };
        let pool_channels: Vec<String> = channels
            .iter()
            .filter(|c| !priority.contains(c))
            .cloned()
            .collect();
        let cursor = *self.inner.subs_cursor.lock().unwrap();
        let rotation = rotating_window(&pool_channels, cursor, size.saturating_sub(priority.len()));
        if !pool_channels.is_empty() {
            *self.inner.subs_cursor.lock().unwrap() =
                (cursor.min(pool_channels.len() - 1) + rotation.len()) % pool_channels.len();
        }
        priority.into_iter().chain(rotation).collect()
    }

    async fn channel_memory_refresh(
        &self,
        app: &AppHandle,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        after: &AfterPaint,
        followed: &HashSet<String>,
    ) {
        let now = now_ms();
        let queue =
            channel_memory::refresh_queue(&after.remembered, &after.memory_entries.entries, now);
        if queue.is_empty() {
            return;
        }
        let queue: Vec<channel_memory::Remembered> = queue.into_iter().cloned().collect();
        let fetched: Vec<(String, String, Vec<Card>)> =
            crate::api::http::bounded_join(queue, REFRESH_CONCURRENCY, |channel| async move {
                let uploads = channel_uploads(yt, &channel.channel_id, now).await;
                (channel.channel_id.clone(), channel.name.clone(), uploads)
            })
            .await
            .into_iter()
            .filter_map(|(id, name, uploads)| Some((id, name, uploads?)))
            .collect();
        let mut fresh = Vec::new();
        for (channel, name, uploads) in fetched {
            let kept = channel_memory::keep_uploads(uploads, now);
            let _ = channel_memory::save_uploads(pool, &channel, &name, &kept, now).await;
            fresh.extend(kept);
        }
        let recently_shown = rec.recently_shown().await;
        let hidden = |c: &Card| after.inputs.exclusions.hides(c) || recently_shown.contains(c.id());
        let showable: Vec<Card> =
            super::filters::keep_showable(fresh, &after.inputs.watched, &hidden, now, false)
                .collect();
        let ranked = lanes::rank(rec, showable, followed, false).await;
        let late: Vec<Card> = {
            let feed = self.inner.feed.lock().unwrap();
            let on_screen: HashSet<&str> = feed.snapshot.cards.iter().map(Card::id).collect();
            let memory_channels: HashSet<String> = feed
                .snapshot
                .cards
                .iter()
                .filter(|c| {
                    feed.snapshot
                        .origins
                        .get(c.id())
                        .is_some_and(|o| o.kind == OriginKind::ChannelMemory)
                })
                .map(|c| c.channel_id().to_string())
                .collect();
            let room = feed.memory_quota.saturating_sub(memory_channels.len());
            let mut channels = memory_channels;
            ranked
                .into_iter()
                .filter(|c| {
                    !on_screen.contains(c.id())
                        && !c.channel_id().is_empty()
                        && channels.insert(c.channel_id().to_string())
                })
                .take(room)
                .collect()
        };
        self.merge_late(
            app,
            after.generation,
            &late,
            |_| Origin::new(OriginKind::ChannelMemory, None),
            &|_| false,
        );
    }

    async fn neighbour_refresh(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        after: &AfterPaint,
    ) {
        let now = now_ms();
        let _ = neighbours::drop_off_topic(pool, &after.off_topic).await;
        let queue = neighbours::refresh_queue(&after.neighbours, &after.neighbour_store, now);
        let queue: Vec<neighbours::Neighbour> = queue.into_iter().cloned().collect();
        let fetched = crate::api::http::bounded_join(queue, REFRESH_CONCURRENCY, |n| async move {
            (
                n.channel_id.clone(),
                n.name.clone(),
                channel_uploads(yt, &n.channel_id, now).await,
            )
        })
        .await;
        for (channel, name, uploads) in fetched {
            if let Some(uploads) = uploads {
                let mut kept: Vec<Card> = uploads
                    .into_iter()
                    .filter(|c| !c.is_short() && !c.video.is_live)
                    .filter(|c| {
                        c.age_ms(now)
                            .is_some_and(|age| age <= neighbours::UPLOAD_WINDOW_MS)
                    })
                    .collect();
                kept.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
                kept.truncate(neighbours::UPLOADS_PER_CHANNEL);
                let _ = neighbours::save_uploads(pool, &channel, &name, &kept, now).await;
            }
        }
        // The related lists of two recent uploads of followed channels, each used once, teach which
        // channels sit beside the viewer's own.
        let known = rec.co_watch_source_ids();
        let mut seen = HashSet::new();
        let mut recent: Vec<&Card> = after
            .store
            .iter()
            .filter(|c| !known.contains(c.id()) && !c.is_short() && !c.video.is_live)
            .filter(|c| {
                c.age_ms(now)
                    .is_some_and(|age| age <= neighbours::UPLOAD_WINDOW_MS)
            })
            .collect();
        recent.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
        for upload in recent
            .into_iter()
            .filter(|c| seen.insert(c.channel_id().to_string()))
            .take(FOLLOWED_SOURCES_PER_LOAD)
        {
            let related = self.inner.related.get(yt, pool, upload.id(), now).await;
            if !related.is_empty() {
                rec.note_related_of(upload.id(), upload.channel_id(), &related)
                    .await;
            }
        }
    }
}

/// What one load reads from local stores: followed channels' uploads, remembered channels and
/// their uploads, and neighbour channels with theirs.
pub(super) struct Local {
    pub(super) store: Vec<Card>,
    pub(super) memory_entries: channel_memory::State,
    pub(super) remembered: Vec<channel_memory::Remembered>,
    pub(super) raw_memory: Vec<Card>,
    pub(super) neighbour_store: HashMap<String, neighbours::Stored>,
    pub(super) neighbour_list: Vec<neighbours::Neighbour>,
    pub(super) raw_neighbours: Vec<Card>,
}

pub(super) async fn local_sources(
    rec: &RecommendationService,
    pool: &SqlitePool,
    inputs: &Inputs,
    brain: &crate::flow_neuro::scoring::UserBrain,
    followed: &HashSet<String>,
    now: u64,
) -> Local {
    let store = if followed.is_empty() {
        Vec::new()
    } else {
        cache::subscription_uploads(pool).await.unwrap_or_default()
    };
    let store: Vec<Card> = store
        .into_iter()
        .filter(|c| followed.contains(c.channel_id()))
        .collect();
    let memory_entries = channel_memory::load(pool).await.unwrap_or_default();
    let remembered = channel_memory::remembered(
        &inputs.watches(),
        &inputs.liked_channels(),
        &memory_entries,
        followed,
        &brain.blocked_channels,
        &brain.suppressed_channels,
        now,
    );
    let raw_memory = channel_memory::uploads(&remembered, &memory_entries.entries, now);
    let neighbour_store = neighbours::load(pool).await.unwrap_or_default();
    let neighbour_list: Vec<neighbours::Neighbour> = rec
        .neighbour_channels(&inputs.subscriptions.names)
        .await
        .into_iter()
        .filter(|n| {
            !neighbour_store
                .get(&n.channel_id)
                .is_some_and(|s| s.dropped)
        })
        .collect();
    let raw_neighbours: Vec<Card> = neighbour_list
        .iter()
        .filter_map(|n| neighbour_store.get(&n.channel_id))
        .flat_map(|s| s.uploads.iter())
        .filter(|c| {
            c.age_ms(now)
                .is_some_and(|age| age <= neighbours::UPLOAD_WINDOW_MS)
        })
        .cloned()
        .collect();
    Local {
        store,
        memory_entries,
        remembered,
        raw_memory,
        neighbour_store,
        neighbour_list,
        raw_neighbours,
    }
}

/// Ranked related and discovery cards the first page did not use, for load-more.
async fn save_unused(pool: &SqlitePool, lanes: &lanes::Lanes, page: &[Card], now: u64) {
    let rendered: HashSet<&str> = page.iter().map(Card::id).collect();
    for (cards, related) in [(&lanes.best_related, true), (&lanes.best_discovery, false)] {
        let unused: Vec<Card> = cards
            .iter()
            .filter(|c| !rendered.contains(c.id()))
            .cloned()
            .collect();
        let _ = cache::save_reserve(pool, &unused, related, now).await;
    }
}

/// The seed titles of the related cards the page placed.
fn seed_titles_of(
    candidates: &[GraphCandidate],
    seeds: &[SeedInput],
    mix: &lanes::Mix,
) -> HashMap<String, String> {
    let picks: HashSet<String> = mix
        .source_of
        .iter()
        .filter(|(_, s)| **s == FeedSource::Related)
        .map(|(id, _)| id.clone())
        .collect();
    seed_titles(candidates, seeds, &picks)
}

/// The first page laid out in runs by source with channels spaced, each card's origin, and the
/// related cards it placed.
fn layout(
    mix: &lanes::Mix,
    followed: &HashSet<String>,
    neighbour_list: &[neighbours::Neighbour],
    seed_titles: HashMap<String, String>,
    query_of: HashMap<String, String>,
) -> (Vec<Card>, HashMap<String, Origin>, HashSet<String>) {
    let source_of = &mix.source_of;
    let laid_out = space_by_channel(
        rhythm_by_source(
            mix.cards.clone(),
            &|c| followed.contains(c.channel_id()),
            &|c| source_of.get(c.id()).copied(),
            mix.fresh_added,
            true,
            FIRST_PAGE_MIN_SIZE,
        ),
        CHANNEL_GAP,
        &[],
    );
    let related_picks: HashSet<String> = source_of
        .iter()
        .filter(|(_, s)| **s == FeedSource::Related)
        .map(|(id, _)| id.clone())
        .collect();
    let pointers: HashMap<String, String> = neighbour_list
        .iter()
        .filter(|n| !n.pointer_names.is_empty())
        .map(|n| {
            (
                n.channel_id.clone(),
                n.pointer_names
                    .iter()
                    .take(2)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("|"),
            )
        })
        .collect();
    let origins = Provenance {
        source_of: source_of.clone(),
        seed_titles,
        queries: query_of,
        followed: Some(followed),
        neighbour_pointers: pointers,
    }
    .origins(&laid_out);
    (laid_out, origins, related_picks)
}

/// The first page as it is shown.
struct Paint<'a> {
    cards: &'a Vec<Card>,
    origins: &'a HashMap<String, Origin>,
    mix: &'a lanes::Mix,
    related_picks: &'a HashSet<String>,
    now: u64,
}

/// What the work after paint reads from the load.
pub(super) struct AfterPaint {
    generation: u64,
    taste: TasteProfile,
    inputs: Inputs,
    store: Vec<Card>,
    neighbours: Vec<neighbours::Neighbour>,
    off_topic: HashSet<String>,
    remembered: Vec<channel_memory::Remembered>,
    memory_entries: channel_memory::State,
    neighbour_store: HashMap<String, neighbours::Stored>,
}

/// Videos the viewer hid never open a related lane.
pub(super) fn inputs_disliked(inputs: &Inputs) -> HashSet<String> {
    inputs.exclusions.hidden_videos().clone()
}
