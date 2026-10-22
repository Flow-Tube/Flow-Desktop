//! Home's network sources, from Flow for Android's `HomeFeedSources`, `HomeSearchPages` and
//! `HomeSubscriptionUploads`: search pages kept half an hour with their next pages, related lists
//! cached per seed, channel Videos tabs, and the RSS refresh of the subscription store.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::sync::Semaphore;
use tokio::time::timeout;

use super::cache;
use super::card::Card;
use crate::api::innertube::renderers::lockup::related_to_video;
use crate::commands::youtube::{fetch_rss_channel_batch, populate_video_durations};
use crate::models::channel::ChannelItem;
use crate::models::search::SearchVideosRequest;
use crate::services::youtube_service::YoutubeService;

const SEARCH_TIMEOUT: Duration = Duration::from_secs(6);
const SEARCH_CACHE_TTL_MS: u64 = 30 * 60_000;
const SEARCH_CACHE_MAX: usize = 20;
/// A search proves itself with this many cards on Home before load-more asks for its next page.
const PRODUCTIVE_CARDS: usize = 3;
const RELATED_MEMORY_TTL_MS: u64 = 45 * 60_000;
const RELATED_TIMEOUT: Duration = Duration::from_secs(4);
const RELATED_CONCURRENCY: usize = 3;
const CHANNEL_TAB_TIMEOUT: Duration = Duration::from_secs(15);
const VIDEOS_TAB: &str = "EgZ2aWRlb3PyBgQKAjoA";
const DURATION_FILL_MAX: usize = 100;

/// A search for `query` from its first page or a kept continuation; errors when the request failed.
async fn search(
    yt: &YoutubeService,
    query: &str,
    token: Option<String>,
    now_ms: u64,
) -> Result<(Vec<Card>, Option<String>), ()> {
    let request = SearchVideosRequest {
        query: query.to_string(),
        page_token: token,
        ..SearchVideosRequest::default()
    };
    match timeout(SEARCH_TIMEOUT, yt.search_videos(request)).await {
        Ok(Ok(response)) => Ok((
            response
                .items
                .into_iter()
                .map(|video| Card::from_summary(video, now_ms))
                .collect(),
            response.next_page_token.filter(|t| !t.is_empty()),
        )),
        _ => Err(()),
    }
}

struct Page {
    cards: Vec<Card>,
    next: Option<String>,
    at_ms: u64,
}

/// Discovery search pages: each fetched once per half hour, and the next page of a search that
/// already filled Home kept at hand, so load-more digs into a subject that works.
#[derive(Default)]
pub struct SearchPages {
    state: Mutex<SearchState>,
}

#[derive(Default)]
struct SearchState {
    pages: VecDeque<(String, Page)>,
    next_page: Vec<(String, String)>,
}

impl SearchPages {
    fn remember(&self, query: &str, next: Option<String>) {
        let mut state = self.state.lock().unwrap();
        state.next_page.retain(|(q, _)| q != query);
        if let Some(next) = next {
            state.next_page.push((query.to_string(), next));
        }
    }

    async fn fetch(
        &self,
        yt: &YoutubeService,
        query: &str,
        token: Option<String>,
        now_ms: u64,
    ) -> Result<Vec<Card>, ()> {
        let key = format!("{query}\u{0}{}", token.as_deref().unwrap_or(""));
        let cached = {
            let state = self.state.lock().unwrap();
            state
                .pages
                .iter()
                .find(|(k, page)| {
                    *k == key && now_ms.saturating_sub(page.at_ms) < SEARCH_CACHE_TTL_MS
                })
                .map(|(_, page)| (page.cards.clone(), page.next.clone()))
        };
        if let Some((cards, next)) = cached {
            self.remember(query, next);
            return Ok(cards);
        }
        let Ok((cards, next)) = search(yt, query, token.clone(), now_ms).await else {
            // The next page was spent on this request; keep it for another try.
            if token.is_some() {
                self.remember(query, token);
            }
            return Err(());
        };
        if !cards.is_empty() {
            let mut state = self.state.lock().unwrap();
            state.pages.retain(|(k, _)| *k != key);
            state.pages.push_back((
                key,
                Page {
                    cards: cards.clone(),
                    next: next.clone(),
                    at_ms: now_ms,
                },
            ));
            while state.pages.len() > SEARCH_CACHE_MAX {
                state.pages.pop_front();
            }
        }
        self.remember(query, next);
        Ok(cards)
    }

    pub async fn first_page(
        &self,
        yt: &YoutubeService,
        query: &str,
        now_ms: u64,
    ) -> Result<Vec<Card>, ()> {
        self.fetch(yt, query, None, now_ms).await
    }

    /// The next page of the search with the most cards in `origins_by_query`, once it has three.
    pub async fn next_page_of_productive(
        &self,
        yt: &YoutubeService,
        cards_by_query: &HashMap<String, usize>,
        now_ms: u64,
    ) -> Option<Result<(String, Vec<Card>), ()>> {
        let (query, token) = {
            let mut state = self.state.lock().unwrap();
            let query = cards_by_query
                .iter()
                .filter(|(q, count)| {
                    **count >= PRODUCTIVE_CARDS && state.next_page.iter().any(|(k, _)| k == *q)
                })
                .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
                .map(|(q, _)| q.clone())?;
            let index = state.next_page.iter().position(|(k, _)| *k == query)?;
            state.next_page.remove(index)
        };
        Some(
            self.fetch(yt, &query, Some(token), now_ms)
                .await
                .map(|cards| (query, cards)),
        )
    }

    /// The next page of the search whose next page was kept longest.
    pub async fn next_page_of_any(
        &self,
        yt: &YoutubeService,
        now_ms: u64,
    ) -> Option<Result<(String, Vec<Card>), ()>> {
        let (query, token) = {
            let mut state = self.state.lock().unwrap();
            if state.next_page.is_empty() {
                return None;
            }
            state.next_page.remove(0)
        };
        Some(
            self.fetch(yt, &query, Some(token), now_ms)
                .await
                .map(|cards| (query, cards)),
        )
    }

    /// The search a kept page returned `video_id` in.
    pub fn query_of(&self, video_id: &str) -> Option<String> {
        let state = self.state.lock().unwrap();
        state
            .pages
            .iter()
            .find(|(_, page)| page.cards.iter().any(|c| c.id() == video_id))
            .and_then(|(key, _)| key.split('\u{0}').next().map(str::to_string))
    }

    /// A refresh starts the searches over.
    pub fn reset(&self) {
        *self.state.lock().unwrap() = SearchState::default();
    }
}

/// Related lists per seed: in memory for 45 minutes, in SQLite for 90, three requests at a time.
pub struct RelatedLists {
    memory: Mutex<HashMap<String, (Vec<Card>, u64)>>,
    permits: Semaphore,
}

impl Default for RelatedLists {
    fn default() -> Self {
        Self {
            memory: Mutex::new(HashMap::new()),
            permits: Semaphore::new(RELATED_CONCURRENCY),
        }
    }
}

impl RelatedLists {
    pub async fn get(
        &self,
        yt: &YoutubeService,
        pool: &SqlitePool,
        seed_id: &str,
        now_ms: u64,
    ) -> Vec<Card> {
        if let Some((cards, at)) = self.memory.lock().unwrap().get(seed_id)
            && now_ms.saturating_sub(*at) < RELATED_MEMORY_TTL_MS
        {
            return cards.clone();
        }
        if let Ok(stored) = cache::load_related(pool, seed_id, now_ms).await
            && !stored.is_empty()
        {
            self.memory
                .lock()
                .unwrap()
                .insert(seed_id.to_string(), (stored.clone(), now_ms));
            return stored;
        }
        let Ok(_permit) = self.permits.acquire().await else {
            return Vec::new();
        };
        let fetched = match timeout(RELATED_TIMEOUT, yt.get_related_videos(seed_id)).await {
            Ok(Ok(items)) => items
                .into_iter()
                .filter(|item| item.item_type == "video" && !item.is_mix)
                .map(|item| Card::from_summary(related_to_video(item), now_ms))
                .collect(),
            _ => Vec::new(),
        };
        // A timeout returns nothing; caching that would blank the seed's lane for the whole TTL.
        if !fetched.is_empty() {
            self.memory
                .lock()
                .unwrap()
                .insert(seed_id.to_string(), (fetched.clone(), now_ms));
            let _ = cache::save_related(pool, seed_id, &fetched, now_ms).await;
        }
        fetched
    }

    pub fn clear(&self) {
        self.memory.lock().unwrap().clear();
    }
}

/// The newest uploads on a channel's Videos tab.
pub async fn channel_uploads(
    yt: &YoutubeService,
    channel_id: &str,
    now_ms: u64,
) -> Option<Vec<Card>> {
    let response = timeout(
        CHANNEL_TAB_TIMEOUT,
        yt.get_channel_tab(channel_id, Some(VIDEOS_TAB.to_string()), None, None),
    )
    .await
    .ok()?
    .ok()?;
    Some(
        response
            .items
            .into_iter()
            .filter_map(|item| match item {
                ChannelItem::Video(mut video) => {
                    video
                        .channel_id
                        .get_or_insert_with(|| channel_id.to_string());
                    Some(Card::from_summary(video, now_ms))
                }
                _ => None,
            })
            .collect(),
    )
}

/// Every followed channel's RSS feed into the subscription store, with lengths for the newest.
pub async fn refresh_subscription_store(
    yt: &YoutubeService,
    pool: &SqlitePool,
    channel_ids: &[String],
    now_ms: u64,
) {
    let mut videos = Vec::new();
    for (_, channel_videos) in
        fetch_rss_channel_batch(crate::api::http::shared_client(), channel_ids).await
    {
        videos.extend(channel_videos);
    }
    store_rss_uploads(yt, pool, videos, now_ms).await;
}

/// RSS uploads into the subscription store; the newest hundred get their length looked up.
async fn store_rss_uploads(
    yt: &YoutubeService,
    pool: &SqlitePool,
    mut videos: Vec<(i64, crate::models::video::VideoSummary)>,
    now_ms: u64,
) {
    videos.sort_by_key(|(published, _)| std::cmp::Reverse(*published));
    let mut seen = HashSet::new();
    videos.retain(|(_, video)| seen.insert(video.id.clone()));
    let (published, mut summaries): (Vec<i64>, Vec<_>) = videos.into_iter().unzip();
    let fill = summaries.len().min(DURATION_FILL_MAX);
    populate_video_durations(&mut summaries[..fill], yt, pool).await;
    let cards: Vec<Card> = summaries
        .into_iter()
        .zip(published)
        .map(|(video, seconds)| Card {
            video,
            published_at_ms: u64::try_from(seconds).unwrap_or(0).saturating_mul(1000),
        })
        .collect();
    let _ = cache::merge_subscription_uploads(pool, &cards, now_ms).await;
}

/// How many followed channels one load asks: all of a small list, a rotating slice of a big one.
#[must_use]
pub fn subscription_window_size(channel_count: usize) -> usize {
    match channel_count {
        n if n <= 10 => n,
        n if n <= 60 => 14,
        _ => 18,
    }
}

/// `count` items of `items` from `start`, wrapping around.
#[must_use]
pub fn rotating_window<T: Clone>(items: &[T], start: usize, count: usize) -> Vec<T> {
    if items.is_empty() || count == 0 {
        return Vec::new();
    }
    if items.len() <= count {
        return items.to_vec();
    }
    let first = start.min(items.len() - 1);
    (0..count)
        .map(|i| items[(first + i) % items.len()].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_subscription_window_rotates_and_wraps() {
        let channels: Vec<u32> = (0..20).collect();
        assert_eq!(subscription_window_size(8), 8);
        assert_eq!(subscription_window_size(20), 14);
        assert_eq!(subscription_window_size(100), 18);
        assert_eq!(rotating_window(&channels, 18, 4), [18, 19, 0, 1]);
    }
}
