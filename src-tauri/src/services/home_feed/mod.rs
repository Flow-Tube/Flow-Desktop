//! Home's feed, built in the backend as Flow for Android builds it (`HomeViewModel` and the
//! `HomeFeed*` files): a first page mixed from subscriptions, related videos, discovery searches,
//! channels the viewer keeps watching and neighbour channels; late arrivals slipped in below the
//! viewport; and load-more pages that end, retry or report failure. The page renders snapshots:
//! commands return one, and every later change is emitted as `home-feed`.

mod arrange;
pub(crate) mod cache;
pub mod card;
pub(crate) mod channel_memory;
pub mod chips;
mod filters;
pub(crate) mod inputs;
mod lanes;
mod load;
mod mixer;
mod more;
pub mod neighbours;
mod origin;
pub mod seeds;
mod sources;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use card::Card;
use origin::{Origin, OriginKind};
use sources::{RelatedLists, SearchPages};

/// Keeps a fetched subscription feed in the store Home reads; `published` holds each video's RSS
/// publish time in seconds.
pub async fn remember_subscription_feed(
    pool: &sqlx::SqlitePool,
    videos: &[crate::models::video::VideoSummary],
    published: &HashMap<String, i64>,
) {
    let cards: Vec<Card> = videos
        .iter()
        .filter_map(|video| {
            let seconds = u64::try_from(*published.get(&video.id)?).ok()?;
            Some(Card {
                video: video.clone(),
                published_at_ms: seconds.saturating_mul(1000),
            })
        })
        .collect();
    let _ = cache::merge_subscription_uploads(pool, &cards, now_ms()).await;
}

/// A feed shown this recently comes back without a reload.
const FRESH_FEED_MS: u64 = 30 * 60_000;
const PREFETCH_AHEAD: usize = 24;
const PREFETCH_TRIGGER_REMAINING: usize = 8;
const EVENT: &str = "home-feed";

/// What the page renders; its flags are the page's states, sent as they are.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HomeSnapshot {
    pub generation: u64,
    pub cards: Vec<Card>,
    pub origins: HashMap<String, Origin>,
    pub loading: bool,
    pub loading_more: bool,
    pub has_more: bool,
    pub load_more_failed: bool,
    /// The error kind when nothing could be loaded at all.
    pub error: Option<String>,
}

#[derive(Default)]
struct Feed {
    snapshot: HomeSnapshot,
    loaded_at: u64,
    subs_backlog: Vec<Card>,
    memory_quota: usize,
    related_picks: HashSet<String>,
    last_visible: usize,
}

#[derive(Default)]
struct Prefetch {
    visible: bool,
    generation: u64,
    target: usize,
    running: bool,
}

#[derive(Default)]
struct Discovery {
    queries: Vec<String>,
    next: usize,
}

#[derive(Default)]
struct Inner {
    feed: Mutex<Feed>,
    prefetch: Mutex<Prefetch>,
    discovery: Mutex<Discovery>,
    search_pages: SearchPages,
    related: RelatedLists,
    /// Saved-interest seeds used lately: video id to when.
    saved_cooldown: Mutex<HashMap<String, u64>>,
    subs_cursor: Mutex<usize>,
    /// Followed channels asked for a missing length lately: channel id to when.
    priority_asked: Mutex<HashMap<String, u64>>,
    /// The interest chips last shown, so a chip's key finds its topics.
    chips: Mutex<Vec<crate::flow_neuro::interest_chips::InterestChip>>,
    /// Each chip's videos with when they were fetched.
    chip_results: Mutex<HashMap<String, (Vec<Card>, u64)>>,
}

/// The Home feed service; cheap to clone into background work.
#[derive(Clone, Default)]
pub struct HomeFeedService {
    inner: Arc<Inner>,
}

fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0)
}

impl HomeFeedService {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn snapshot(&self) -> HomeSnapshot {
        self.inner.feed.lock().unwrap().snapshot.clone()
    }

    fn emit(&self, app: &AppHandle) {
        let _ = app.emit(EVENT, self.snapshot());
    }

    fn generation(&self) -> u64 {
        self.inner.feed.lock().unwrap().snapshot.generation
    }

    /// Changes the feed if `generation` is still the current one, then tells the page.
    fn update(&self, app: &AppHandle, generation: u64, change: impl FnOnce(&mut Feed)) -> bool {
        {
            let mut feed = self.inner.feed.lock().unwrap();
            if feed.snapshot.generation != generation {
                return false;
            }
            change(&mut feed);
        }
        self.emit(app);
        true
    }

    /// Home opened: a feed from the last half hour comes back as it was; otherwise the feed as last
    /// shown (up to eight hours old) paints at once while a new one loads.
    pub async fn open(&self, app: &AppHandle) -> HomeSnapshot {
        let now = now_ms();
        {
            let feed = self.inner.feed.lock().unwrap();
            let fresh = !feed.snapshot.cards.is_empty()
                && now.saturating_sub(feed.loaded_at) < FRESH_FEED_MS;
            if fresh || feed.snapshot.loading {
                return feed.snapshot.clone();
            }
        }
        let pool = app.state::<sqlx::SqlitePool>();
        if let Ok((cards, origins)) = cache::load_last_feed(&pool, now).await
            && !cards.is_empty()
        {
            let mut feed = self.inner.feed.lock().unwrap();
            if feed.snapshot.cards.is_empty() {
                feed.snapshot.cards = cards;
                feed.snapshot.origins = origins;
            }
        }
        self.start_load(app);
        self.snapshot()
    }

    /// The viewer's refresh; a load already running is the refresh.
    pub fn refresh(&self, app: &AppHandle) -> HomeSnapshot {
        if !self.inner.feed.lock().unwrap().snapshot.loading {
            self.inner.feed.lock().unwrap().loaded_at = 0;
            self.start_load(app);
        }
        self.snapshot()
    }

    fn start_load(&self, app: &AppHandle) {
        let generation = {
            let mut feed = self.inner.feed.lock().unwrap();
            feed.snapshot.generation += 1;
            feed.snapshot.loading = true;
            feed.snapshot.error = None;
            feed.snapshot.generation
        };
        {
            let mut prefetch = self.inner.prefetch.lock().unwrap();
            prefetch.generation += 1;
            prefetch.target = 0;
        }
        self.emit(app);
        let service = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            service.load(&app, generation).await;
        });
    }

    /// Home shown or hidden: hiding stops load-more work in flight.
    pub fn set_visible(&self, app: &AppHandle, visible: bool) {
        {
            let mut prefetch = self.inner.prefetch.lock().unwrap();
            prefetch.visible = visible;
            if !visible {
                prefetch.generation += 1;
            }
        }
        if visible {
            self.maybe_prefetch(app);
        } else {
            let generation = self.generation();
            self.update(app, generation, |feed| feed.snapshot.loading_more = false);
        }
    }

    /// The last card in view changed; within eight cards of the end, the next page is fetched.
    pub fn viewport(&self, app: &AppHandle, last_visible: usize) {
        let count = {
            let mut feed = self.inner.feed.lock().unwrap();
            feed.last_visible = last_visible;
            feed.snapshot.cards.len()
        };
        {
            let mut prefetch = self.inner.prefetch.lock().unwrap();
            if !prefetch.visible
                || count == 0
                || count.saturating_sub(last_visible + 1) > PREFETCH_TRIGGER_REMAINING
            {
                return;
            }
            prefetch.target = prefetch.target.max(last_visible + 1 + PREFETCH_AHEAD);
        }
        self.maybe_prefetch(app);
    }

    /// The viewer's retry after a load-more that failed.
    pub fn retry_more(&self, app: &AppHandle) {
        let generation = self.generation();
        self.update(app, generation, |feed| {
            feed.snapshot.load_more_failed = false;
        });
        self.maybe_prefetch(app);
    }

    fn maybe_prefetch(&self, app: &AppHandle) {
        let (ready, count) = {
            let feed = self.inner.feed.lock().unwrap();
            let s = &feed.snapshot;
            (
                !s.cards.is_empty() && !s.loading && s.has_more && !s.load_more_failed,
                s.cards.len(),
            )
        };
        let generation = {
            let mut prefetch = self.inner.prefetch.lock().unwrap();
            if !ready || !prefetch.visible || prefetch.running || count >= prefetch.target {
                return;
            }
            prefetch.running = true;
            prefetch.generation
        };
        let service = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            service.drain_prefetch(&app, generation).await;
            service.inner.prefetch.lock().unwrap().running = false;
        });
    }

    fn prefetch_current(&self, generation: u64) -> bool {
        let prefetch = self.inner.prefetch.lock().unwrap();
        prefetch.visible && prefetch.generation == generation
    }

    /// Counts showings of neighbour cards; a neighbour shown six times without a watch is dropped.
    pub async fn note_impressions(&self, app: &AppHandle, ids: &[String]) {
        let channels: HashSet<String> = {
            let feed = self.inner.feed.lock().unwrap();
            ids.iter()
                .filter(|id| {
                    feed.snapshot
                        .origins
                        .get(*id)
                        .is_some_and(|o| o.kind == OriginKind::Neighbour)
                })
                .filter_map(|id| feed.snapshot.cards.iter().find(|c| c.id() == id))
                .map(|card| card.channel_id().to_string())
                .collect()
        };
        if !channels.is_empty() {
            let pool = app.state::<sqlx::SqlitePool>();
            let _ = neighbours::note_shown(&pool, &channels).await;
        }
    }

    /// A card the viewer hid leaves the feed at once.
    pub fn remove(&self, app: &AppHandle, video_id: Option<&str>, channel_id: Option<&str>) {
        let generation = self.generation();
        self.update(app, generation, |feed| {
            feed.snapshot.cards.retain(|card| {
                video_id != Some(card.id())
                    && (channel_id.is_none() || channel_id != Some(card.channel_id()))
            });
        });
    }

    /// Forgets the feed and its caches, as a taste reset does, so the next open is ranked anew.
    pub async fn clear(&self, app: &AppHandle) {
        {
            let mut feed = self.inner.feed.lock().unwrap();
            let generation = feed.snapshot.generation + 1;
            *feed = Feed::default();
            feed.snapshot.generation = generation;
        }
        self.inner.search_pages.reset();
        self.inner.related.clear();
        self.inner.chip_results.lock().unwrap().clear();
        let pool = app.state::<sqlx::SqlitePool>();
        let _ = cache::clear(&pool).await;
        self.emit(app);
    }
}
