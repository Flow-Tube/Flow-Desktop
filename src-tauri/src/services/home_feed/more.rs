//! Load-more, from Flow for Android's `HomeViewModel.loadNextPrefetchPage` and
//! `HomeLoadMorePolicy`: a page of eight from channel memory, the reserve, a related pass, the next
//! discovery searches and deeper pages of productive ones, the subscription backlog, and a wider
//! related pass last. A page too small waits for the next attempt; three empty attempts end the
//! feed, and a failed request offers a retry instead.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::arrange::{TasteProfile, rhythm_by_source, space_by_channel, spread_across_searches};
use super::card::Card;
use super::filters::{RECENT_CHANNEL_WINDOW, keep_showable};
use super::inputs::Inputs;
use super::lanes;
use super::load::{inputs_disliked, related_graph, report_searches, seed_titles};
use super::mixer::Page;
use super::origin::{Origin, OriginKind, queries_by_id};
use super::seeds::{SeedInput, feed_seed_inputs};
use super::{HomeFeedService, cache, channel_memory, now_ms};
use crate::flow_neuro::scoring::classify_persona;
use crate::services::recommendation_service::{DiscoverySurface, RecommendationService};
use crate::services::youtube_service::YoutubeService;

/// Fewer cards than this wait for the run's next attempt instead of showing on their own.
const MIN_CARDS: usize = 4;
const MIN_PAGE_SIZE: usize = 8;
const ATTEMPTS: usize = 3;
const BACKOFF_MS: u64 = 400;
const RESERVE_PER_SOURCE: i64 = 16;
const LOAD_MORE_GRAPH_SEEDS: usize = 3;
const FALLBACK_SEEDS: usize = 4;
const FEED_SEED_POOL: usize = 30;
const DEEPER_SEARCH_PAGES: usize = 2;
const CHANNEL_GAP: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Appended,
    Held,
    Exhausted,
    Failed,
}

#[derive(Default)]
struct Held {
    cards: Vec<Card>,
    origins: HashMap<String, Origin>,
}

/// One attempt's page and where its cards came from.
struct Attempt {
    page: Page,
    origins: HashMap<String, Origin>,
    failed: bool,
}

impl Attempt {
    /// An attempt starting from the cards earlier attempts held. Channels the viewer just
    /// scrolled past count as used, so a page never repeats them.
    fn start(feed_cards: &[Card], held: Held) -> Self {
        let mut page = Page::default();
        for card in feed_cards
            .iter()
            .rev()
            .take(RECENT_CHANNEL_WINDOW)
            .chain(&held.cards)
        {
            if !card.channel_id().is_empty() {
                page.channel_counts.insert(card.channel_id().to_string(), 1);
            }
        }
        page.used_ids.extend(
            feed_cards
                .iter()
                .chain(&held.cards)
                .map(|c| c.id().to_string()),
        );
        page.cards = held.cards;
        Self {
            page,
            origins: held.origins,
            failed: false,
        }
    }

    fn add_all(&mut self, cards: &[Card], origin: impl Fn(&Card) -> Origin) -> Vec<String> {
        let start = self.page.cards.len();
        self.page.fill(cards, MIN_PAGE_SIZE);
        let added: Vec<String> = self.page.cards[start..]
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        for card in &self.page.cards[start..] {
            self.origins.insert(card.id().to_string(), origin(card));
        }
        added
    }

    fn full(&self) -> bool {
        self.page.cards.len() >= MIN_PAGE_SIZE
    }
}

/// How an attempt ends: enough cards (or any, on the last try) show; a few wait for the next
/// try; none, after a request failed, offers a retry; none otherwise means nothing is left.
fn outcome_of(attempt: &Attempt, last: bool) -> Outcome {
    let count = attempt.page.cards.len();
    if count >= MIN_CARDS || (last && count > 0) {
        Outcome::Appended
    } else if count > 0 {
        Outcome::Held
    } else if attempt.failed {
        Outcome::Failed
    } else {
        Outcome::Exhausted
    }
}

impl HomeFeedService {
    pub(super) async fn drain_prefetch(&self, app: &AppHandle, generation: u64) {
        let mut held: Option<Held> = None;
        for attempt in 1..=ATTEMPTS {
            let wanted = {
                let feed = self.inner.feed.lock().unwrap();
                let target = self.inner.prefetch.lock().unwrap().target;
                feed.snapshot.has_more && feed.snapshot.cards.len() < target
            };
            if !wanted || !self.prefetch_current(generation) {
                break;
            }
            let feed_generation = self.generation();
            self.update(app, feed_generation, |feed| {
                feed.snapshot.loading_more = true;
                feed.snapshot.load_more_failed = false;
            });
            let (outcome, next_held) = self
                .next_page(app, generation, held.take(), attempt == ATTEMPTS)
                .await;
            held = next_held;
            if !self.prefetch_current(generation) {
                break;
            }
            match outcome {
                Outcome::Appended => break,
                Outcome::Held => {}
                Outcome::Exhausted if attempt < ATTEMPTS => {
                    tokio::time::sleep(Duration::from_millis(BACKOFF_MS * attempt as u64)).await;
                }
                Outcome::Exhausted => {
                    // Only answered requests that found nothing end the feed.
                    self.update(app, feed_generation, |feed| feed.snapshot.has_more = false);
                    break;
                }
                Outcome::Failed => {
                    self.update(app, feed_generation, |feed| {
                        feed.snapshot.load_more_failed = true;
                    });
                    break;
                }
            }
        }
        let generation = self.generation();
        self.update(app, generation, |feed| feed.snapshot.loading_more = false);
    }

    async fn next_page(
        &self,
        app: &AppHandle,
        generation: u64,
        held: Option<Held>,
        last: bool,
    ) -> (Outcome, Option<Held>) {
        let yt = app.state::<YoutubeService>();
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let now = now_ms();
        let (Ok(brain), feed_cards) = (rec.get_brain_snapshot().await, self.snapshot().cards)
        else {
            return (Outcome::Failed, held);
        };
        let Ok(inputs) = Inputs::load(&pool, &brain, now).await else {
            return (Outcome::Failed, held);
        };
        let taste = TasteProfile::of(&brain, &classify_persona(&brain));
        let followed = inputs.subscriptions.ids();
        let mut attempt = Attempt::start(&feed_cards, held.unwrap_or_default());

        self.fill_from_memory(&rec, &pool, &inputs, &brain, &followed, now, &mut attempt)
            .await;
        self.fill_from_reserve(&rec, &pool, &inputs, &followed, now, &mut attempt)
            .await;
        if !attempt.full() {
            self.fill_from_related(
                &yt,
                &rec,
                &pool,
                &inputs,
                &feed_cards,
                &followed,
                &taste,
                now,
                LOAD_MORE_GRAPH_SEEDS,
                &mut attempt,
            )
            .await;
        }
        if !attempt.full() {
            self.fill_from_search(
                &yt,
                &rec,
                &pool,
                &inputs,
                &followed,
                &taste,
                now,
                &mut attempt,
            )
            .await;
        }
        if !attempt.full() {
            let backlog: Vec<Card> = {
                let mut feed = self.inner.feed.lock().unwrap();
                feed.subs_backlog.retain(|c| !inputs.exclusions.hides(c));
                feed.subs_backlog.clone()
            };
            let added = attempt.add_all(&backlog, |_| Origin::new(OriginKind::Subscription, None));
            self.inner
                .feed
                .lock()
                .unwrap()
                .subs_backlog
                .retain(|c| !added.contains(&c.id().to_string()));
        }
        // Never run dry: a wider related pass from saved interests and the feed itself.
        if !attempt.full() && self.prefetch_current(generation) {
            self.fill_from_related(
                &yt,
                &rec,
                &pool,
                &inputs,
                &feed_cards,
                &followed,
                &taste,
                now,
                FALLBACK_SEEDS,
                &mut attempt,
            )
            .await;
        }

        let outcome = outcome_of(&attempt, last);
        if outcome == Outcome::Appended {
            let appended = self
                .append_page(app, &pool, attempt, &followed, &inputs, now)
                .await;
            return (
                if appended {
                    Outcome::Appended
                } else {
                    Outcome::Exhausted
                },
                None,
            );
        }
        let held = (outcome == Outcome::Held).then_some(Held {
            cards: attempt.page.cards,
            origins: attempt.origins,
        });
        (outcome, held)
    }

    #[allow(clippy::too_many_arguments)]
    async fn fill_from_memory(
        &self,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        brain: &crate::flow_neuro::scoring::UserBrain,
        followed: &HashSet<String>,
        now: u64,
        attempt: &mut Attempt,
    ) {
        let entries = channel_memory::load(pool).await.unwrap_or_default();
        let remembered = channel_memory::remembered(
            &inputs.watches(),
            &inputs.liked_channels(),
            &entries,
            followed,
            &brain.blocked_channels,
            &brain.suppressed_channels,
            now,
        );
        let recently_shown = rec.recently_shown().await;
        let hidden = |c: &Card| inputs.exclusions.hides(c) || recently_shown.contains(c.id());
        let candidates: Vec<Card> = keep_showable(
            channel_memory::uploads(&remembered, &entries.entries, now),
            &inputs.watched,
            &hidden,
            now,
            false,
        )
        .collect();
        let on_page: HashSet<String> = attempt
            .page
            .cards
            .iter()
            .map(|c| c.channel_id().to_string())
            .collect();
        let pick = lanes::rank(rec, candidates, followed, false)
            .await
            .into_iter()
            .find(|c| {
                !attempt.page.used_ids.contains(c.id())
                    && !c.channel_id().is_empty()
                    && !on_page.contains(c.channel_id())
            });
        if let Some(card) = pick
            && attempt.page.add(&card, 1)
        {
            attempt.origins.insert(
                card.id().to_string(),
                Origin::new(OriginKind::ChannelMemory, None),
            );
        }
    }

    async fn fill_from_reserve(
        &self,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        followed: &HashSet<String>,
        now: u64,
        attempt: &mut Attempt,
    ) {
        let rows = cache::load_reserve(pool, RESERVE_PER_SOURCE, now)
            .await
            .unwrap_or_default();
        if rows.is_empty() {
            return;
        }
        let related: HashSet<String> = rows
            .iter()
            .filter(|r| r.related)
            .map(|r| r.card.id().to_string())
            .collect();
        let hidden = |c: &Card| inputs.exclusions.hides(c);
        let cards: Vec<Card> = keep_showable(
            rows.into_iter().map(|r| r.card),
            &inputs.watched,
            &hidden,
            now,
            true,
        )
        .collect();
        let ranked =
            lanes::share(rec, lanes::rank(rec, cards, followed, true).await, followed).await;
        let search_pages = &self.inner.search_pages;
        let served = attempt.add_all(&ranked, |card| {
            if related.contains(card.id()) {
                Origin::new(OriginKind::Related, None)
            } else {
                Origin::new(OriginKind::Search, search_pages.query_of(card.id()))
            }
        });
        let picks: Vec<String> = served
            .iter()
            .filter(|id| related.contains(*id))
            .cloned()
            .collect();
        self.inner.feed.lock().unwrap().related_picks.extend(picks);
        let _ = cache::consume_reserve(pool, &served).await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn fill_from_related(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        feed_cards: &[Card],
        followed: &HashSet<String>,
        taste: &TasteProfile,
        now: u64,
        max_seeds: usize,
        attempt: &mut Attempt,
    ) {
        let disliked = inputs_disliked(inputs);
        let related_picks = self.inner.feed.lock().unwrap().related_picks.clone();
        let mut seen = HashSet::new();
        let seeds: Vec<SeedInput> = inputs
            .saved_seeds(&disliked, &HashSet::new())
            .into_iter()
            .chain(feed_seed_inputs(
                feed_cards,
                now,
                FEED_SEED_POOL,
                &related_picks,
            ))
            .filter(|s| seen.insert(s.id.clone()))
            .collect();
        let long_term = inputs.long_term_seeds(&disliked);
        let ids = rec
            .select_related_seeds(&seeds, max_seeds, &long_term)
            .await;
        if ids.is_empty() {
            return;
        }
        let all: Vec<SeedInput> = seeds.into_iter().chain(long_term).collect();
        let candidates: Vec<_> = related_graph(self, yt, rec, pool, &all, &ids, now)
            .await
            .into_iter()
            .filter(|g| {
                g.card.is_valid()
                    && !inputs.watched.contains(g.card.id())
                    && super::filters::is_recent_suggestion(&g.card, now)
            })
            .collect();
        let ranked = lanes::rank_related(rec, &candidates, followed, taste).await;
        let added: HashSet<String> = attempt
            .add_all(&ranked, |_| Origin::new(OriginKind::Related, None))
            .into_iter()
            .collect();
        for (id, title) in seed_titles(&candidates, &all, &added) {
            attempt
                .origins
                .insert(id, Origin::new(OriginKind::Related, Some(title)));
        }
        self.inner.feed.lock().unwrap().related_picks.extend(added);
        let unused: Vec<Card> = ranked
            .into_iter()
            .filter(|c| !attempt.page.used_ids.contains(c.id()))
            .collect();
        let _ = cache::save_reserve(pool, &unused, true, now).await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn fill_from_search(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        followed: &HashSet<String>,
        taste: &TasteProfile,
        now: u64,
        attempt: &mut Attempt,
    ) {
        let needs_more = {
            let discovery = self.inner.discovery.lock().unwrap();
            discovery.next >= discovery.queries.len()
        };
        if needs_more {
            let generated = rec
                .generate_discovery_queries(DiscoverySurface::Home, false)
                .await
                .unwrap_or_default();
            let mut discovery = self.inner.discovery.lock().unwrap();
            for query in generated {
                if !discovery.queries.contains(&query) {
                    discovery.queries.push(query);
                }
            }
        }
        // The next page of a search already filling Home takes one of the two searches.
        let cards_by_query: HashMap<String, usize> = {
            let feed = self.inner.feed.lock().unwrap();
            let mut counts = HashMap::new();
            for origin in feed
                .snapshot
                .origins
                .values()
                .filter(|o| o.kind == OriginKind::Search)
            {
                if let Some(query) = &origin.detail {
                    *counts.entry(query.clone()).or_insert(0) += 1;
                }
            }
            counts
        };
        let mut searches: Vec<(String, Vec<Card>)> = Vec::new();
        let continued = match self
            .inner
            .search_pages
            .next_page_of_productive(yt, &cards_by_query, now)
            .await
        {
            Some(Ok(page)) => Some(page),
            Some(Err(())) => {
                attempt.failed = true;
                None
            }
            None => None,
        };
        let wanted = if continued.is_some() { 1 } else { 2 };
        searches.extend(continued);
        let queries: Vec<String> = {
            let mut discovery = self.inner.discovery.lock().unwrap();
            let from = discovery.next;
            let picked: Vec<String> = discovery
                .queries
                .iter()
                .skip(from)
                .take(wanted)
                .cloned()
                .collect();
            discovery.next += picked.len();
            picked
        };
        for query in queries {
            match self.inner.search_pages.first_page(yt, &query, now).await {
                Ok(cards) => searches.push((query, cards)),
                Err(()) => attempt.failed = true,
            }
        }
        report_searches(rec, &searches).await;
        self.add_discovery(rec, pool, inputs, followed, taste, now, &searches, attempt)
            .await;
        // Still short: the next pages of searches already made, before any wider related pass.
        for _ in 0..DEEPER_SEARCH_PAGES {
            if attempt.full() {
                break;
            }
            match self.inner.search_pages.next_page_of_any(yt, now).await {
                Some(Ok(page)) => {
                    self.add_discovery(rec, pool, inputs, followed, taste, now, &[page], attempt)
                        .await;
                }
                Some(Err(())) => attempt.failed = true,
                None => break,
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn add_discovery(
        &self,
        rec: &RecommendationService,
        pool: &SqlitePool,
        inputs: &Inputs,
        followed: &HashSet<String>,
        taste: &TasteProfile,
        now: u64,
        searches: &[(String, Vec<Card>)],
        attempt: &mut Attempt,
    ) {
        let hidden = |c: &Card| inputs.exclusions.hides(c);
        let cards: Vec<Card> = keep_showable(
            searches
                .iter()
                .flat_map(|(_, c)| c.iter().cloned())
                .collect::<Vec<_>>(),
            &inputs.watched,
            &hidden,
            now,
            true,
        )
        .collect();
        if cards.is_empty() {
            return;
        }
        let query_of = queries_by_id(searches);
        let ranked = lanes::share(
            rec,
            taste.demote(lanes::rank(rec, cards, followed, true).await),
            followed,
        )
        .await;
        let count = ranked.len();
        let ranked = spread_across_searches(ranked, &query_of, count);
        attempt.add_all(&ranked, |card| {
            Origin::new(OriginKind::Search, query_of.get(card.id()).cloned())
        });
        let unused: Vec<Card> = ranked
            .into_iter()
            .filter(|c| !attempt.page.used_ids.contains(c.id()))
            .collect();
        let _ = cache::save_reserve(pool, &unused, false, now).await;
    }

    async fn append_page(
        &self,
        app: &AppHandle,
        pool: &SqlitePool,
        attempt: Attempt,
        followed: &HashSet<String>,
        inputs: &Inputs,
        now: u64,
    ) -> bool {
        let generation = self.generation();
        let mut appended = false;
        let mut snapshot: Option<(Vec<Card>, HashMap<String, Origin>)> = None;
        self.update(app, generation, |feed| {
            let existing: HashSet<&str> = feed.snapshot.cards.iter().map(Card::id).collect();
            let page: Vec<Card> = attempt
                .page
                .cards
                .into_iter()
                .filter(|c| {
                    !existing.contains(c.id())
                        && !inputs.watched.contains(c.id())
                        && !inputs.exclusions.hides(c)
                })
                .collect();
            if page.is_empty() {
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
            let laid_out = space_by_channel(
                rhythm_by_source(
                    page,
                    &|c| followed.contains(c.channel_id()),
                    &|_| None,
                    0,
                    false,
                    0,
                ),
                CHANNEL_GAP,
                &tail,
            );
            for card in &laid_out {
                if let Some(origin) = attempt.origins.get(card.id()) {
                    feed.snapshot
                        .origins
                        .insert(card.id().to_string(), origin.clone());
                }
            }
            feed.snapshot.cards.extend(laid_out);
            feed.snapshot.has_more = true;
            appended = true;
            snapshot = Some((feed.snapshot.cards.clone(), feed.snapshot.origins.clone()));
        });
        if let Some((cards, origins)) = snapshot {
            let _ = cache::save_last_feed(pool, &cards, &origins, now).await;
        }
        appended
    }
}
