//! Home's chips, from Flow for Android's `HomeChipFeeds`: one per heavy interest, "New to you" and
//! "Recently uploaded". Each is its own ranked list, fetched when the chip is chosen and kept for an
//! hour or two.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use futures_util::future::join_all;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tokio::time::timeout;

use super::card::Card;
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
const INTEREST_PREFIX: &str = "interest:";
const MAX_VIDEOS: usize = 40;
const EXPLORATION_QUERIES: usize = 3;
/// Watches whose related lists New to you also draws on.
const RELATED_SEEDS: usize = 2;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(6);
const RECENT_WINDOW_MS: u64 = 7 * 86_400_000;
const HOUR_MS: u64 = 3_600_000;

/// One chip's videos, or that fetching them failed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChipFeed {
    pub cards: Vec<Card>,
    pub failed: bool,
}

#[derive(Clone)]
enum Chip {
    Interest(InterestChip),
    NewToYou,
    RecentlyUploaded,
}

impl Chip {
    fn ttl_ms(&self) -> u64 {
        match self {
            Self::Interest(_) | Self::NewToYou => 2 * HOUR_MS,
            Self::RecentlyUploaded => HOUR_MS,
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

/// Every search's results together; `None` when each of them failed.
async fn search_all(
    yt: &YoutubeService,
    queries: &[String],
    upload_date: Option<&str>,
    now: u64,
) -> Option<Vec<Card>> {
    let results = join_all(queries.iter().map(|query| {
        search(
            yt,
            SearchVideosRequest {
                query: query.clone(),
                upload_date: upload_date.map(str::to_string),
                ..SearchVideosRequest::default()
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
    /// The interest chips to show next to the fixed ones.
    pub async fn interest_chips(&self, app: &AppHandle) -> Vec<InterestChip> {
        let chips = app.state::<RecommendationService>().interest_chips().await;
        self.inner.chips.lock().unwrap().clone_from(&chips);
        chips
    }

    /// The videos of the chip `key`, from memory while fresh unless `refresh`.
    pub async fn chip_feed(&self, app: &AppHandle, key: &str, refresh: bool) -> ChipFeed {
        let Some(chip) = self.chip(key) else {
            return ChipFeed {
                cards: Vec::new(),
                failed: false,
            };
        };
        let now = now_ms();
        if !refresh
            && let Some((cards, at)) = self.inner.chip_results.lock().unwrap().get(key)
            && now.saturating_sub(*at) < chip.ttl_ms()
        {
            return ChipFeed {
                cards: cards.clone(),
                failed: false,
            };
        }
        let Some(cards) = self.fetch_chip(app, &chip, now).await else {
            return ChipFeed {
                cards: Vec::new(),
                failed: true,
            };
        };
        self.inner
            .chip_results
            .lock()
            .unwrap()
            .insert(key.to_string(), (cards.clone(), now));
        ChipFeed {
            cards,
            failed: false,
        }
    }

    fn chip(&self, key: &str) -> Option<Chip> {
        match key {
            NEW_TO_YOU => Some(Chip::NewToYou),
            RECENTLY_UPLOADED => Some(Chip::RecentlyUploaded),
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

    async fn fetch_chip(&self, app: &AppHandle, chip: &Chip, now: u64) -> Option<Vec<Card>> {
        let yt = app.state::<YoutubeService>();
        let rec = app.state::<RecommendationService>();
        let pool = app.state::<SqlitePool>();
        let known = known(&rec, &pool, now).await?;
        match chip {
            Chip::Interest(interest) => {
                let found = search_all(&yt, &interest_queries(interest), None, now).await?;
                let topics: HashSet<String> = interest.topics.iter().cloned().collect();
                let stored = rec
                    .about(
                        known.uploads.iter().map(|c| c.video.clone()).collect(),
                        &topics,
                    )
                    .await;
                let stored_ids: HashSet<String> = stored.into_iter().map(|v| v.id).collect();
                let pool: Vec<Card> = found
                    .into_iter()
                    .chain(
                        known
                            .uploads
                            .iter()
                            .filter(|c| stored_ids.contains(c.id()))
                            .cloned(),
                    )
                    .collect();
                Some(ranked(&rec, &known, pool).await)
            }
            Chip::NewToYou => {
                let queries = rec.exploration_queries(EXPLORATION_QUERIES).await;
                let disliked = inputs_disliked(&known.inputs);
                let seeds = rec
                    .select_related_seeds(&known.inputs.recent_seeds(&disliked), RELATED_SEEDS, &[])
                    .await;
                let (found, related) = tokio::join!(
                    search_all(&yt, &queries, None, now),
                    join_all(
                        seeds
                            .iter()
                            .map(|id| self.inner.related.get(&yt, &pool, id, now))
                    )
                );
                let related: Vec<Card> = related.into_iter().flatten().collect();
                if found.is_none() && related.is_empty() {
                    return None;
                }
                let mut channels = HashSet::new();
                Some(
                    ranked(
                        &rec,
                        &known,
                        found
                            .unwrap_or_default()
                            .into_iter()
                            .chain(related)
                            .collect(),
                    )
                    .await
                    .into_iter()
                    .filter(|c| {
                        !c.channel_id().is_empty() && !known.channels.contains(c.channel_id())
                    })
                    .filter(|c| channels.insert(c.channel_id().to_string()))
                    .collect(),
                )
            }
            Chip::RecentlyUploaded => {
                let queries: Vec<String> = self
                    .inner
                    .chips
                    .lock()
                    .unwrap()
                    .iter()
                    .take(2)
                    .filter_map(|chip| interest_queries(chip).into_iter().next())
                    .collect();
                let found = search_all(&yt, &queries, Some("week"), now)
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
                Some(freshness_order(ranked(&rec, &known, this_week).await, now))
            }
        }
    }
}

async fn known(rec: &RecommendationService, pool: &SqlitePool, now: u64) -> Option<Known> {
    let brain = rec.get_brain_snapshot().await.ok()?;
    let inputs = Inputs::load(pool, &brain, now).await.ok()?;
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
    let mut ranked = lanes::rank(rec, pool, &known.inputs.subscriptions.ids(), false).await;
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
