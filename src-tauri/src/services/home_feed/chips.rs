//! Home's chips, from Flow for Android's `HomeChipFeeds`: one per heavy interest, "New to you",
//! "Recently uploaded", "Mixes", "Live" and "Watched". Each is its own list, fetched when the chip
//! is chosen and kept for as long as it stays true.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use futures_util::future::join_all;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tokio::time::timeout;

use super::card::Card;
use super::chips_rewatch::{
    HomeMix, MIX_LENGTH, MIX_MIN_VIDEOS, MIXES_MIN, WATCHED_MIN, history_card, mix_candidates,
    mix_of, mix_seeds, watch_again,
};
use super::inputs::Inputs;
use super::lanes;
use super::load::{inputs_disliked, local_sources};
use super::{HomeFeedService, now_ms};
use crate::flow_neuro::interest_chips::{InterestChip, interest_queries};
use crate::models::search::SearchVideosRequest;
use crate::services::recommendation_service::RecommendationService;
use crate::services::youtube_service::YoutubeService;

pub const NEW_TO_YOU: &str = "new";
pub const RECENTLY_UPLOADED: &str = "recent";
pub const MIXES: &str = "mixes";
pub const LIVE: &str = "live";
pub const WATCHED: &str = "watched";
const INTEREST_PREFIX: &str = "interest:";
const MAX_VIDEOS: usize = 40;
const EXPLORATION_QUERIES: usize = 3;
/// Watches whose related lists New to you also draws on.
const RELATED_SEEDS: usize = 2;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(6);
const RECENT_WINDOW_MS: u64 = 7 * 86_400_000;
const HOUR_MS: u64 = 3_600_000;
const MINUTE_MS: u64 = 60_000;
const LIVE_FALLBACK_QUERY: &str = "live";

/// One chip's videos or mixes, or that fetching them failed.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChipFeed {
    pub cards: Vec<Card>,
    pub mixes: Vec<HomeMix>,
    pub failed: bool,
}

impl ChipFeed {
    fn is_empty(&self) -> bool {
        self.cards.is_empty() && self.mixes.is_empty()
    }
}

/// The chips to offer beside the fixed ones. A chip whose latest result was empty stays away until
/// that result expires, and Mixes and Watched only appear once there is enough to fill them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeChips {
    pub interests: Vec<InterestChip>,
    pub has_mixes: bool,
    pub has_watched: bool,
    pub empty: Vec<String>,
}

#[derive(Clone)]
enum Chip {
    Interest(InterestChip),
    NewToYou,
    RecentlyUploaded,
    Mixes,
    Live,
    Watched,
}

impl Chip {
    fn ttl_ms(&self) -> u64 {
        match self {
            Self::Interest(_) | Self::NewToYou => 2 * HOUR_MS,
            Self::RecentlyUploaded => HOUR_MS,
            Self::Mixes => 6 * HOUR_MS,
            Self::Live => 10 * MINUTE_MS,
            Self::Watched => 15 * MINUTE_MS,
        }
    }
}

/// What a chip's list draws on besides searches: uploads already stored from followed and
/// often-watched channels, and the channels the viewer already knows.
struct Known {
    inputs: Inputs,
    uploads: Vec<Card>,
    channels: HashSet<String>,
}

async fn search(yt: &YoutubeService, request: SearchVideosRequest, now: u64) -> Option<Vec<Card>> {
    match timeout(SEARCH_TIMEOUT, yt.search_videos(request)).await {
        Ok(Ok(response)) => Some(
            response
                .items
                .into_iter()
                .map(|video| Card::from_summary(video, now))
                .collect(),
        ),
        _ => None,
    }
}

/// Every search's results together; `None` when each of them failed. `template` carries the filters
/// all the searches share.
async fn search_all(
    yt: &YoutubeService,
    queries: &[String],
    template: &SearchVideosRequest,
    now: u64,
) -> Option<Vec<Card>> {
    let results = join_all(queries.iter().map(|query| {
        search(
            yt,
            SearchVideosRequest {
                query: query.clone(),
                ..template.clone()
            },
            now,
        )
    }))
    .await;
    if !queries.is_empty() && results.iter().all(Option::is_none) {
        return None;
    }
    Some(results.into_iter().flatten().flatten().collect())
}

/// The ranked order, nudged by age: down the list a fresh upload moves past an older one ranked
/// just above it.
fn freshness_order(ranked: Vec<Card>, now: u64) -> Vec<Card> {
    let mut indexed: Vec<(f64, Card)> = ranked
        .into_iter()
        .enumerate()
        .map(|(index, card)| {
            #[allow(clippy::cast_precision_loss)]
            let age = card.age_ms(now).map_or(1.0, |age| {
                (age as f64 / RECENT_WINDOW_MS as f64).clamp(0.0, 1.0)
            });
            #[allow(clippy::cast_precision_loss)]
            (index as f64 * (0.8 + 0.2 * age), card)
        })
        .collect();
    indexed.sort_by(|a, b| a.0.total_cmp(&b.0));
    indexed.into_iter().map(|(_, card)| card).collect()
}

impl HomeFeedService {
    /// The chips to offer, worked out from local state alone: no chip's content is fetched here.
    pub async fn chips(&self, app: &AppHandle) -> HomeChips {
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let interests = rec.interest_chips().await;
        self.inner.chips.lock().unwrap().clone_from(&interests);
        let now = now_ms();
        let (has_mixes, has_watched) = match known_inputs(&rec, &pool, now).await {
            Some(inputs) => (
                rewatch_seeds(&rec, &inputs, now).await.len() >= MIXES_MIN,
                watched_cards(&rec, &inputs, WATCHED_MIN, now).await.len() >= WATCHED_MIN,
            ),
            None => (false, false),
        };
        let results: Vec<(String, bool, u64)> = self
            .inner
            .chip_results
            .lock()
            .unwrap()
            .iter()
            .map(|(key, (feed, at))| (key.clone(), feed.is_empty(), *at))
            .collect();
        let empty = results
            .into_iter()
            .filter(|(key, is_empty, at)| {
                *is_empty
                    && self
                        .chip(key)
                        .is_some_and(|chip| now.saturating_sub(*at) < chip.ttl_ms())
            })
            .map(|(key, _, _)| key)
            .collect();
        HomeChips {
            interests,
            has_mixes,
            has_watched,
            empty,
        }
    }

    /// The videos of the chip `key`, from memory while fresh unless `refresh`.
    pub async fn chip_feed(&self, app: &AppHandle, key: &str, refresh: bool) -> ChipFeed {
        let Some(chip) = self.chip(key) else {
            return ChipFeed::default();
        };
        let now = now_ms();
        if !refresh
            && let Some((feed, at)) = self.inner.chip_results.lock().unwrap().get(key)
            && now.saturating_sub(*at) < chip.ttl_ms()
        {
            return feed.clone();
        }
        let Some(feed) = self.fetch_chip(app, &chip, now).await else {
            return ChipFeed {
                failed: true,
                ..ChipFeed::default()
            };
        };
        self.inner
            .chip_results
            .lock()
            .unwrap()
            .insert(key.to_string(), (feed.clone(), now));
        feed
    }

    fn chip(&self, key: &str) -> Option<Chip> {
        match key {
            NEW_TO_YOU => Some(Chip::NewToYou),
            RECENTLY_UPLOADED => Some(Chip::RecentlyUploaded),
            MIXES => Some(Chip::Mixes),
            LIVE => Some(Chip::Live),
            WATCHED => Some(Chip::Watched),
            _ => {
                let representative = key.strip_prefix(INTEREST_PREFIX)?;
                self.inner
                    .chips
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|chip| chip.key == representative)
                    .cloned()
                    .map(Chip::Interest)
            }
        }
    }

    async fn fetch_chip(&self, app: &AppHandle, chip: &Chip, now: u64) -> Option<ChipFeed> {
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        match chip {
            Chip::Mixes => {
                let inputs = known_inputs(&rec, &pool, now).await?;
                let mixes = self.fetch_mixes(app, &rec, &inputs, now).await?;
                return Some(ChipFeed {
                    mixes,
                    ..ChipFeed::default()
                });
            }
            Chip::Watched => {
                let inputs = known_inputs(&rec, &pool, now).await?;
                let cards = watched_cards(&rec, &inputs, MAX_VIDEOS, now).await;
                return Some(ChipFeed {
                    cards,
                    ..ChipFeed::default()
                });
            }
            _ => {}
        }
        let cards = self.fetch_videos(app, chip, now).await?;
        Some(ChipFeed {
            cards,
            ..ChipFeed::default()
        })
    }

    /// A mix for each seed: the seed, then what its related list offers. A mix too short to be one
    /// is left out; none at all from seeds there were means the lists could not be fetched.
    async fn fetch_mixes(
        &self,
        app: &AppHandle,
        rec: &RecommendationService,
        inputs: &Inputs,
        now: u64,
    ) -> Option<Vec<HomeMix>> {
        let yt = app.state::<YoutubeService>();
        let pool = app.state::<SqlitePool>();
        let seeds = rewatch_seeds(rec, inputs, now).await;
        let disliked = inputs_disliked(inputs);
        let lists = join_all(
            seeds
                .iter()
                .map(|seed| self.inner.related.get(&yt, &pool, &seed.video.id, now)),
        )
        .await;
        let mixes: Vec<HomeMix> = seeds
            .iter()
            .zip(lists)
            .filter_map(|(seed, related)| {
                let next = related
                    .into_iter()
                    .filter(|card| card.is_valid() && !disliked.contains(card.id()))
                    .filter(|card| !inputs.exclusions.hides_rewatch(card))
                    .map(|card| card.video);
                let mix = mix_of(seed.video.clone(), next, MIX_LENGTH);
                (mix.videos.len() >= MIX_MIN_VIDEOS).then_some(mix)
            })
            .collect();
        (!mixes.is_empty() || seeds.is_empty()).then_some(mixes)
    }

    async fn fetch_videos(&self, app: &AppHandle, chip: &Chip, now: u64) -> Option<Vec<Card>> {
        let yt = app.state::<YoutubeService>();
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let known = known(&rec, &pool, now).await?;
        match chip {
            Chip::Mixes | Chip::Watched => None,
            Chip::Live => self.live_videos(&yt, &rec, &known, now).await,
            Chip::Interest(interest) => interest_videos(&yt, &rec, &known, interest, now).await,
            Chip::NewToYou => self.new_to_you_videos(&yt, &rec, &pool, &known, now).await,
            Chip::RecentlyUploaded => self.recent_videos(&yt, &rec, &known, now).await,
        }
    }

    async fn live_videos(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        known: &Known,
        now: u64,
    ) -> Option<Vec<Card>> {
        let queries = {
            let chips = self.inner.chips.lock().unwrap();
            live_queries(&chips)
        };
        let found = search_all(
            yt,
            &queries,
            &SearchVideosRequest {
                content_type: Some("video".to_string()),
                features: vec!["live".to_string()],
                ..SearchVideosRequest::default()
            },
            now,
        )
        .await;
        let stored: Vec<Card> = known
            .uploads
            .iter()
            .filter(|c| c.video.is_live)
            .cloned()
            .collect();
        if found.is_none() && stored.is_empty() {
            return None;
        }
        let live: Vec<Card> = stored
            .into_iter()
            .chain(found.unwrap_or_default())
            .filter(|c| c.video.is_live && !c.video.is_upcoming)
            .collect();
        Some(ranked(rec, known, live).await)
    }

    async fn new_to_you_videos(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        pool: &SqlitePool,
        known: &Known,
        now: u64,
    ) -> Option<Vec<Card>> {
        let queries = rec.exploration_queries(EXPLORATION_QUERIES).await;
        let disliked = inputs_disliked(&known.inputs);
        let seeds = rec
            .select_related_seeds(&known.inputs.recent_seeds(&disliked), RELATED_SEEDS, &[])
            .await;
        let plain = SearchVideosRequest::default();
        let (found, related) = tokio::join!(
            search_all(yt, &queries, &plain, now),
            join_all(
                seeds
                    .iter()
                    .map(|id| self.inner.related.get(yt, pool, id, now))
            )
        );
        let related: Vec<Card> = related.into_iter().flatten().collect();
        if found.is_none() && related.is_empty() {
            return None;
        }
        let mut channels = HashSet::new();
        Some(
            ranked(
                rec,
                known,
                found
                    .unwrap_or_default()
                    .into_iter()
                    .chain(related)
                    .collect(),
            )
            .await
            .into_iter()
            .filter(|c| !c.channel_id().is_empty() && !known.channels.contains(c.channel_id()))
            .filter(|c| channels.insert(c.channel_id().to_string()))
            .collect(),
        )
    }

    async fn recent_videos(
        &self,
        yt: &YoutubeService,
        rec: &RecommendationService,
        known: &Known,
        now: u64,
    ) -> Option<Vec<Card>> {
        let queries: Vec<String> = self
            .inner
            .chips
            .lock()
            .unwrap()
            .iter()
            .take(2)
            .filter_map(|chip| interest_queries(chip).into_iter().next())
            .collect();
        let found = search_all(
            yt,
            &queries,
            &SearchVideosRequest {
                upload_date: Some("week".to_string()),
                ..SearchVideosRequest::default()
            },
            now,
        )
        .await
        .unwrap_or_default();
        let this_week: Vec<Card> = known
            .uploads
            .iter()
            .cloned()
            .chain(found)
            .filter(|c| !c.video.is_live)
            .filter(|c| c.age_ms(now).is_some_and(|age| age <= RECENT_WINDOW_MS))
            .collect();
        Some(freshness_order(ranked(rec, known, this_week).await, now))
    }
}

async fn interest_videos(
    yt: &YoutubeService,
    rec: &RecommendationService,
    known: &Known,
    interest: &InterestChip,
    now: u64,
) -> Option<Vec<Card>> {
    let found = search_all(
        yt,
        &interest_queries(interest),
        &SearchVideosRequest::default(),
        now,
    )
    .await?;
    let topics: HashSet<String> = interest.topics.iter().cloned().collect();
    let stored = rec
        .about(
            known.uploads.iter().map(|c| c.video.clone()).collect(),
            &topics,
        )
        .await;
    let stored_ids: HashSet<String> = stored.into_iter().map(|v| v.id).collect();
    let mut pool: Vec<Card> = found
        .into_iter()
        .chain(
            known
                .uploads
                .iter()
                .filter(|c| stored_ids.contains(c.id()))
                .cloned(),
        )
        .collect();
    // A theme stays in its category: a "Gaming" chip shows no cooking channel.
    if let Some(category) = &interest.category {
        let videos: Vec<_> = pool.iter().map(|c| c.video.clone()).collect();
        let outside = rec.outside_category(&videos, category);
        pool.retain(|c| !outside.contains(c.id()));
    }
    Some(ranked(rec, known, pool).await)
}

/// The searches behind the Live chip: the top interests', or a plain one without any.
fn live_queries(interests: &[InterestChip]) -> Vec<String> {
    let queries: Vec<String> = interests
        .iter()
        .take(2)
        .filter_map(|chip| interest_queries(chip).into_iter().next())
        .collect();
    if queries.is_empty() {
        vec![LIVE_FALLBACK_QUERY.to_string()]
    } else {
        queries
    }
}

async fn known_inputs(rec: &RecommendationService, pool: &SqlitePool, now: u64) -> Option<Inputs> {
    let brain = rec.get_brain_snapshot().await.ok()?;
    Inputs::load(pool, &brain, now).await.ok()
}

/// Watched videos worth seeing again, best first, with what the device already knows of them.
async fn watched_cards(
    rec: &RecommendationService,
    inputs: &Inputs,
    limit: usize,
    now: u64,
) -> Vec<Card> {
    let disliked = inputs_disliked(inputs);
    let videos = inputs
        .history
        .iter()
        .map(|record| history_card(record).video)
        .collect::<Vec<_>>();
    let taste = rec.taste_affinity(&videos).await;
    let known: HashMap<&str, &crate::models::video::VideoSummary> = inputs
        .likes
        .iter()
        .chain(&inputs.saved)
        .map(|(video, _)| (video.id.as_str(), video))
        .collect();
    watch_again(&inputs.history, &taste, &disliked, now)
        .into_iter()
        .map(history_card)
        .filter(|card| !inputs.exclusions.hides_rewatch(card))
        .take(limit)
        .map(|mut card| {
            if let Some(stored) = known.get(card.id()) {
                card.video
                    .view_count_text
                    .clone_from(&stored.view_count_text);
                card.video.published_text.clone_from(&stored.published_text);
            }
            card.video.channel_avatar_url =
                inputs.subscriptions.avatars.get(card.channel_id()).cloned();
            card
        })
        .collect()
}

/// The seeds of the mixes: strong watches and likes, one per interest, nothing rejected.
async fn rewatch_seeds(
    rec: &RecommendationService,
    inputs: &Inputs,
    now: u64,
) -> Vec<super::chips_rewatch::MixSeed> {
    let candidates = mix_candidates(&inputs.history, &inputs.likes, now);
    let clusters = rec
        .interest_keys(
            &candidates
                .iter()
                .map(|candidate| candidate.video.clone())
                .collect::<Vec<_>>(),
        )
        .await;
    let hidden = |video: &crate::models::video::VideoSummary| {
        inputs.exclusions.hides_rewatch(&Card {
            video: video.clone(),
            published_at_ms: 0,
        })
    };
    mix_seeds(candidates, &clusters, &hidden)
}

async fn known(rec: &RecommendationService, pool: &SqlitePool, now: u64) -> Option<Known> {
    let inputs = known_inputs(rec, pool, now).await?;
    let brain = rec.get_brain_snapshot().await.ok()?;
    let followed = inputs.subscriptions.ids();
    let local = local_sources(rec, pool, &inputs, &brain, &followed, now).await;
    let mut channels: HashSet<String> = inputs
        .history
        .iter()
        .filter_map(|record| record.channel_id.clone())
        .collect();
    channels.extend(followed);
    channels.extend(brain.blocked_channels.iter().cloned());
    channels.extend(brain.suppressed_channels.keys().cloned());
    channels.extend(local.remembered.iter().map(|r| r.channel_id.clone()));
    channels.extend(
        local
            .memory_entries
            .entries
            .iter()
            .filter(|(_, entry)| entry.rejected_at > 0)
            .map(|(id, _)| id.clone()),
    );
    let mut uploads = local.store;
    uploads.extend(local.raw_memory);
    Some(Known {
        inputs,
        uploads,
        channels,
    })
}

/// The chip's hygiene, then the engine's ranking: no Shorts, nothing watched or hidden.
async fn ranked(rec: &RecommendationService, known: &Known, cards: Vec<Card>) -> Vec<Card> {
    let mut seen = HashSet::new();
    let pool: Vec<Card> = cards
        .into_iter()
        .filter(|c| seen.insert(c.id().to_string()))
        .filter(Card::is_valid)
        .filter(|c| !known.inputs.watched.contains(c.id()))
        .filter(|c| !known.inputs.exclusions.hides(c))
        .collect();
    let avatars: HashMap<String, String> = known.inputs.subscriptions.avatars.clone();
    let mut ranked = lanes::rank(rec, pool, &known.inputs.boosted_channels(), false).await;
    ranked.truncate(MAX_VIDEOS);
    for card in &mut ranked {
        if card.video.channel_avatar_url.is_none()
            && let Some(avatar) = avatars.get(card.channel_id())
        {
            card.video.channel_avatar_url = Some(avatar.clone());
        }
    }
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;

    #[test]
    fn live_searches_follow_the_top_interests_and_fall_back_to_a_plain_one() {
        assert_eq!(live_queries(&[]), [LIVE_FALLBACK_QUERY]);
        let chip = |key: &str| InterestChip {
            key: key.to_string(),
            label: key.to_string(),
            topics: vec![key.to_string()],
            category: None,
            parts: Vec::new(),
        };
        assert_eq!(
            live_queries(&[chip("chess"), chip("bread"), chip("rust")]),
            ["chess", "bread"]
        );
    }

    #[test]
    fn down_the_list_a_fresh_upload_passes_an_older_one_ranked_just_above() {
        let now = 30 * 86_400_000;
        let aged = |id: &str, age_ms: u64| {
            let mut c = card(id, id, "");
            c.published_at_ms = now - age_ms;
            c
        };
        let ids = |cards: Vec<Card>| -> Vec<String> {
            freshness_order(cards, now)
                .iter()
                .map(|c| c.id().to_string())
                .collect()
        };
        assert_eq!(
            ids(vec![aged("old", 6 * 86_400_000), aged("new", 3_600_000)]),
            ["old", "new"]
        );
        let mut list: Vec<Card> = (0..8).map(|i| aged(&format!("f{i}"), 3_600_000)).collect();
        list.push(aged("old", 6 * 86_400_000));
        list.push(aged("new", 3_600_000));
        let order = ids(list);
        assert_eq!(order[8], "new");
        assert_eq!(order[9], "old");
    }
}
