//! From raw fetches to ranked lanes to the first page, from Flow for Android's `HomeFeedAssembly`.

use std::collections::{HashMap, HashSet};

use super::arrange::{TasteProfile, spread_across_searches};
use super::card::Card;
use super::filters::{
    FRESH_SUB_WINDOW_MS, dynamic_fresh_sub_slots, is_fresh_subscribed, keep_showable,
};
use super::inputs::Inputs;
use super::mixer::{Blend, FeedSource, Page, blend, quotas};
use super::seeds::{GraphCandidate, apply_graph_boost};
use crate::flow_neuro::gates::LANE_RELEVANCE_FLOOR;
use crate::services::recommendation_service::RecommendationService;

pub const HOME_TARGET_SIZE: usize = 40;
const FRESH_SUBS_PIN_TOP: usize = 2;
/// Seen fresh uploads follow this many ranked subs.
const SHOWN_FRESH_AFTER_SUBS: usize = 3;
const BEST_SUBS_LIMIT: usize = 15;
const BEST_DISCOVERY_LIMIT: usize = 15;
const BEST_MEMORY_LIMIT: usize = 6;
const BEST_NEIGHBOUR_LIMIT: usize = 4;
const BEST_RELATED_LIMIT: usize = 12;

/// Ranks `cards` with the engine, keeping each card's publish time.
pub async fn rank(
    rec: &RecommendationService,
    cards: Vec<Card>,
    subs: &HashSet<String>,
    relevant_only: bool,
) -> Vec<Card> {
    if cards.is_empty() {
        return cards;
    }
    let published: HashMap<String, u64> = cards
        .iter()
        .map(|c| (c.id().to_string(), c.published_at_ms))
        .collect();
    let floor = if relevant_only {
        LANE_RELEVANCE_FLOOR
    } else {
        0.0
    };
    let videos = cards.into_iter().map(|c| c.video).collect();
    rec.rank_candidates(videos, subs.clone(), floor)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|video| Card {
            published_at_ms: published.get(&video.id).copied().unwrap_or(0),
            video,
        })
        .collect()
}

/// `cards` with their places shared between the viewer's interests.
pub async fn share(
    rec: &RecommendationService,
    cards: Vec<Card>,
    subs: &HashSet<String>,
) -> Vec<Card> {
    let mut by_id: HashMap<String, Card> = cards
        .iter()
        .map(|c| (c.id().to_string(), c.clone()))
        .collect();
    let videos = cards.into_iter().map(|c| c.video).collect();
    rec.share_by_interest(videos, subs)
        .await
        .into_iter()
        .filter_map(|video| by_id.remove(&video.id))
        .collect()
}

/// A related lane's cards ranked, demoted by fit, nudged by graph evidence and shared.
pub async fn rank_related(
    rec: &RecommendationService,
    candidates: &[GraphCandidate],
    subs: &HashSet<String>,
    taste: &TasteProfile,
) -> Vec<Card> {
    let metadata: HashMap<String, GraphCandidate> = candidates
        .iter()
        .map(|c| (c.card.id().to_string(), c.clone()))
        .collect();
    let ranked = rank(
        rec,
        candidates.iter().map(|c| c.card.clone()).collect(),
        subs,
        true,
    )
    .await;
    share(
        rec,
        taste.demote(apply_graph_boost(ranked, &metadata)),
        subs,
    )
    .await
}

/// What one load fetched or read.
pub struct Raw {
    pub subs: Vec<Card>,
    pub rss: Vec<Card>,
    pub discovery: Vec<Card>,
    pub memory: Vec<Card>,
    pub related: Vec<GraphCandidate>,
    pub neighbours: Vec<Card>,
    pub query_of: HashMap<String, String>,
}

impl Raw {
    #[must_use]
    pub fn new(
        store: &[Card],
        searches: &[(String, Vec<Card>)],
        memory: Vec<Card>,
        related: Vec<GraphCandidate>,
        neighbours: Vec<Card>,
        now_ms: u64,
    ) -> Self {
        Self {
            subs: super::filters::stored_subscription_videos(store, now_ms),
            rss: store.to_vec(),
            discovery: searches
                .iter()
                .flat_map(|(_, cards)| cards.iter().cloned())
                .collect(),
            memory,
            related,
            neighbours,
            query_of: super::origin::queries_by_id(searches),
        }
    }
}

pub struct Lanes {
    pub pinned_fresh: Vec<Card>,
    pub overflow_fresh: Vec<Card>,
    pub shown_fresh: Vec<Card>,
    pub best_subs: Vec<Card>,
    pub best_discovery: Vec<Card>,
    pub best_memory: Vec<Card>,
    pub best_neighbours: Vec<Card>,
    pub relevant_neighbour_channels: HashSet<String>,
    pub best_related: Vec<Card>,
    pub related: Vec<GraphCandidate>,
    pub subs_by_recency: Vec<Card>,
}

impl Lanes {
    fn fresh_candidates(&self) -> impl Iterator<Item = &Card> {
        self.pinned_fresh
            .iter()
            .chain(&self.overflow_fresh)
            .chain(&self.best_subs)
            .chain(&self.shown_fresh)
            .chain(&self.best_related)
            .chain(&self.best_discovery)
            .chain(&self.best_memory)
            .chain(&self.best_neighbours)
    }
}

fn with_avatar(mut card: Card, avatars: &HashMap<String, String>) -> Card {
    if card.video.channel_avatar_url.is_none()
        && let Some(avatar) = avatars.get(card.channel_id())
    {
        card.video.channel_avatar_url = Some(avatar.clone());
    }
    card
}

fn distinct_by<T>(items: Vec<T>, key: impl Fn(&T) -> String) -> Vec<T> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(key(item)))
        .collect()
}

/// The ranked lanes the blend draws from. Subscriptions and remembered channels rank plainly;
/// discovery, related and neighbours keep to the viewer's subjects and share their places.
pub async fn build(
    rec: &RecommendationService,
    raw: Raw,
    inputs: &Inputs,
    recently_shown: &HashSet<String>,
    taste: &TasteProfile,
    now_ms: u64,
) -> Lanes {
    let subs = inputs.subscriptions.ids();
    let hidden = |card: &Card| inputs.exclusions.hides(card);
    let avatars = &inputs.subscriptions.avatars;
    let subs_pool: Vec<Card> = distinct_by(
        keep_showable(raw.subs, &inputs.watched, &hidden, now_ms, false)
            .map(|c| with_avatar(c, avatars))
            .collect(),
        |c| c.id().to_string(),
    );
    let discovery_pool: Vec<Card> =
        keep_showable(raw.discovery, &inputs.watched, &hidden, now_ms, true).collect();
    let memory_pool: Vec<Card> =
        keep_showable(raw.memory, &inputs.watched, &hidden, now_ms, true).collect();
    let neighbour_pool: Vec<Card> =
        keep_showable(raw.neighbours, &inputs.watched, &hidden, now_ms, true).collect();

    let mut subs_by_recency = subs_pool.clone();
    subs_by_recency.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));

    let (shown_fresh, unshown_fresh) = fresh_lanes(
        raw.rss,
        &subs_by_recency,
        inputs,
        recently_shown,
        dynamic_fresh_sub_slots(subs.len()),
        now_ms,
    );
    let fresh_ids: HashSet<&str> = shown_fresh
        .iter()
        .chain(&unshown_fresh)
        .map(Card::id)
        .collect();

    let best_subs: Vec<Card> = rank(rec, subs_pool, &subs, false)
        .await
        .into_iter()
        .filter(|c| !fresh_ids.contains(c.id()))
        .take(BEST_SUBS_LIMIT)
        .collect();

    let related: Vec<GraphCandidate> = raw
        .related
        .into_iter()
        .filter(|g| {
            g.card.is_valid()
                && !inputs.watched.contains(g.card.id())
                && super::filters::is_recent_suggestion(&g.card, now_ms)
                && !hidden(&g.card)
        })
        .collect();

    // Neighbours are new to the viewer, so they meet the relevance floor like discovery does.
    let relevant_neighbours = rank(rec, neighbour_pool, &subs, true).await;
    let ranked_discovery = rank(rec, discovery_pool, &subs, true).await;
    let best_discovery = spread_across_searches(
        share(rec, taste.demote(ranked_discovery), &subs).await,
        &raw.query_of,
        BEST_DISCOVERY_LIMIT,
    );
    let best_memory = distinct_by(
        taste.demote(rank(rec, memory_pool, &subs, false).await),
        |c| c.channel_id().to_string(),
    )
    .into_iter()
    .take(BEST_MEMORY_LIMIT)
    .collect();
    let relevant_neighbour_channels = relevant_neighbours
        .iter()
        .map(|c| c.channel_id().to_string())
        .collect();
    let best_neighbours = distinct_by(taste.demote(relevant_neighbours), |c| {
        c.channel_id().to_string()
    })
    .into_iter()
    .take(BEST_NEIGHBOUR_LIMIT)
    .collect();
    let best_related = rank_related(rec, &related, &subs, taste)
        .await
        .into_iter()
        .take(BEST_RELATED_LIMIT)
        .collect();

    Lanes {
        pinned_fresh: unshown_fresh
            .iter()
            .take(FRESH_SUBS_PIN_TOP)
            .cloned()
            .collect(),
        overflow_fresh: unshown_fresh.into_iter().skip(FRESH_SUBS_PIN_TOP).collect(),
        shown_fresh,
        best_subs,
        best_discovery,
        best_memory,
        best_neighbours,
        relevant_neighbour_channels,
        best_related,
        related,
        subs_by_recency,
    }
}

/// Fresh uploads of followed channels, one per channel, newest first: those not shown lately to
/// pin on top, those shown lately to follow the first ranked subs.
fn fresh_lanes(
    rss: Vec<Card>,
    subs_by_recency: &[Card],
    inputs: &Inputs,
    recently_shown: &HashSet<String>,
    slots: usize,
    now_ms: u64,
) -> (Vec<Card>, Vec<Card>) {
    let hidden = |card: &Card| inputs.exclusions.hides(card);
    let avatars = &inputs.subscriptions.avatars;
    // The store covers every followed channel with real publish times, so a fresh upload shows
    // even when its channel missed this load's fetch window.
    let rss_fresh = rss.into_iter().filter(|card| {
        card.is_valid()
            && card
                .age_ms(now_ms)
                .is_some_and(|age| age <= FRESH_SUB_WINDOW_MS)
            && !hidden(card)
    });
    let mut fresh: Vec<Card> = distinct_by(
        rss_fresh
            .chain(
                subs_by_recency
                    .iter()
                    .filter(|c| is_fresh_subscribed(c, now_ms))
                    .cloned(),
            )
            .filter(|c| !inputs.watched.contains(c.id()))
            .map(|c| with_avatar(c, avatars))
            .collect(),
        |c| c.id().to_string(),
    );
    fresh.sort_by_key(|c| std::cmp::Reverse(c.published_at_ms));
    // One fresh slot per channel.
    let fresh = distinct_by(fresh, |c| {
        if c.channel_id().is_empty() {
            c.id().to_string()
        } else {
            c.channel_id().to_string()
        }
    });
    // An upload shown recently goes to the back of the subs lane, so it is not pinned on top of
    // every launch for three days.
    let (shown, unshown): (Vec<Card>, Vec<Card>) = fresh
        .into_iter()
        .partition(|c| recently_shown.contains(c.id()));
    (
        shown.into_iter().take(slots).collect(),
        unshown.into_iter().take(slots).collect(),
    )
}

/// The first page and what it left for later.
pub struct Mix {
    pub cards: Vec<Card>,
    pub source_of: HashMap<String, FeedSource>,
    pub fresh_added: usize,
    pub memory_quota: usize,
    pub subs_backlog: Vec<Card>,
}

/// Pinned fresh uploads first, then the quota blend. Cards on screen are left out so a refresh
/// looks different, while the lanes could still fill half the page without them.
#[must_use]
pub fn assemble(
    lanes: &Lanes,
    on_screen: &HashSet<String>,
    sub_count: usize,
    total_interactions: i32,
) -> Mix {
    let mut page = Page::default();
    if !on_screen.is_empty() {
        let fresh: HashSet<&str> = lanes
            .fresh_candidates()
            .map(Card::id)
            .filter(|id| !on_screen.contains(*id))
            .collect();
        if fresh.len() >= HOME_TARGET_SIZE / 2 {
            page.used_ids.extend(on_screen.iter().cloned());
        }
    }
    let mut source_of = HashMap::new();
    let mut fresh_added = 0;
    for card in &lanes.pinned_fresh {
        if page.add(card, 2) {
            fresh_added += 1;
            source_of.insert(card.id().to_string(), FeedSource::Subs);
        }
    }
    let remaining = HOME_TARGET_SIZE.saturating_sub(page.cards.len());
    let quotas = quotas(
        remaining,
        sub_count,
        total_interactions,
        !lanes.best_neighbours.is_empty(),
    );
    let subs_lane: Vec<Card> = lanes
        .overflow_fresh
        .iter()
        .chain(lanes.best_subs.iter().take(SHOWN_FRESH_AFTER_SUBS))
        .chain(&lanes.shown_fresh)
        .chain(lanes.best_subs.iter().skip(SHOWN_FRESH_AFTER_SUBS))
        .cloned()
        .collect();
    let lane_map = HashMap::from([
        (FeedSource::Subs, subs_lane),
        (FeedSource::Related, lanes.best_related.clone()),
        (FeedSource::Discovery, lanes.best_discovery.clone()),
        (FeedSource::ChannelMemory, lanes.best_memory.clone()),
        (FeedSource::Neighbours, lanes.best_neighbours.clone()),
    ]);
    let single: HashSet<String> = lanes
        .best_memory
        .iter()
        .chain(&lanes.best_neighbours)
        .map(|c| c.channel_id().to_string())
        .collect();
    let Blend { items, .. } = blend(&lane_map, &quotas, remaining, &mut page, &single);
    for (card, source) in &items {
        source_of.insert(card.id().to_string(), *source);
    }
    let cards: Vec<Card> = page.cards;
    let used: HashSet<&str> = cards.iter().map(Card::id).collect();
    let subs_backlog = lanes
        .subs_by_recency
        .iter()
        .filter(|c| !used.contains(c.id()) && !page.used_ids.contains(c.id()))
        .cloned()
        .collect();
    Mix {
        cards,
        source_of,
        fresh_added,
        memory_quota: quotas.get(&FeedSource::ChannelMemory).copied().unwrap_or(0),
        subs_backlog,
    }
}
