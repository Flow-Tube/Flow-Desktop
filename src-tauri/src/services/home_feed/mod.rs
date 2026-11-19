//! Home's feed, built in the backend as Flow for Android builds it (`HomeViewModel` and the
//! `HomeFeed*` files): a first page mixed from subscriptions, related videos, discovery searches,
//! channels the viewer keeps watching and neighbour channels; late arrivals slipped in below the
//! viewport; and load-more pages that end, retry or report failure. The page renders snapshots:
//! commands return one, and every later change is emitted. A change that moved no card sends
//! only the flags (`home-feed-status`) and a load-more page sends only its new cards
//! (`home-feed-append`), so a feed that grows all session does not resend every card it holds
//! several times per page. Anything else sends the whole snapshot (`home-feed`).

mod arrange;
pub(crate) mod cache;
pub mod card;
pub(crate) mod channel_memory;
pub mod chips;
mod chips_rewatch;
mod filters;
pub(crate) mod inputs;
mod kind_checks;
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
const STATUS_EVENT: &str = "home-feed-status";
const APPEND_EVENT: &str = "home-feed-append";

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

/// The snapshot's flags without its cards.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HomeStatus {
    pub generation: u64,
    pub loading: bool,
    pub loading_more: bool,
    pub has_more: bool,
    pub load_more_failed: bool,
    pub error: Option<String>,
}

impl HomeStatus {
    fn of(snapshot: &HomeSnapshot) -> Self {
        Self {
            generation: snapshot.generation,
            loading: snapshot.loading,
            loading_more: snapshot.loading_more,
            has_more: snapshot.has_more,
            load_more_failed: snapshot.load_more_failed,
            error: snapshot.error.clone(),
        }
    }
}

/// Cards added at the end of the feed, with the flags as they stand after them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeAppend {
    #[serde(flatten)]
    pub status: HomeStatus,
    /// How many cards the feed held before these. A page that holds a different number has
    /// missed something and asks for the whole snapshot.
    pub start: usize,
    pub cards: Vec<Card>,
    pub origins: HashMap<String, Origin>,
}

/// What a change to the feed has to tell the page.
enum Changed {
    Nothing,
    /// Flags only.
    Status,
    /// Cards were added after the first `start`, and nothing before them moved.
    Appended {
        start: usize,
    },
    /// Cards were added in the middle, removed or replaced.
    Cards,
}

enum Notice {
    Status(HomeStatus),
    Append(HomeAppend),
    Snapshot(HomeSnapshot),
}

impl Notice {
    fn of(snapshot: &HomeSnapshot, changed: &Changed) -> Option<Self> {
        match *changed {
            Changed::Nothing => None,
            Changed::Status => Some(Self::Status(HomeStatus::of(snapshot))),
            Changed::Appended { start } => {
                let cards = snapshot.cards.get(start..)?.to_vec();
                let origins = cards
                    .iter()
                    .filter_map(|card| {
                        let origin = snapshot.origins.get(card.id())?;
                        Some((card.id().to_string(), origin.clone()))
                    })
                    .collect();
                Some(Self::Append(HomeAppend {
                    status: HomeStatus::of(snapshot),
                    start,
                    cards,
                    origins,
                }))
            }
            Changed::Cards => Some(Self::Snapshot(snapshot.clone())),
        }
    }

    fn emit(self, app: &AppHandle) {
        let _ = match self {
            Self::Status(status) => app.emit(STATUS_EVENT, status),
            Self::Append(append) => app.emit(APPEND_EVENT, append),
            Self::Snapshot(snapshot) => app.emit(EVENT, snapshot),
        };
    }
}

#[derive(Default)]
struct Feed {
    snapshot: HomeSnapshot,
    loaded_at: u64,
    /// The viewer's video age limit this feed was built under.
    max_video_age_ms: Option<u64>,
    /// Whether this feed was built leaving out videos already seen.
    hides_seen: bool,
    /// Whether this feed was built keeping followed channels off Home.
    subscriptions_kept_off: bool,
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
    /// Each chip's result with when it was fetched.
    chip_results: Mutex<HashMap<String, (chips::ChipFeed, u64)>>,
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

    /// Changes the feed if `generation` is still the current one, then tells the page as much
    /// as `change` says it changed.
    fn apply(
        &self,
        app: &AppHandle,
        generation: u64,
        change: impl FnOnce(&mut Feed) -> Changed,
    ) -> bool {
        let notice = {
            let mut feed = self.inner.feed.lock().unwrap();
            if feed.snapshot.generation != generation {
                return false;
            }
            let changed = change(&mut feed);
            Notice::of(&feed.snapshot, &changed)
        };
        if let Some(notice) = notice {
            notice.emit(app);
        }
        true
    }

    /// A change to the cards themselves: the page gets the whole snapshot.
    fn update(&self, app: &AppHandle, generation: u64, change: impl FnOnce(&mut Feed)) -> bool {
        self.apply(app, generation, |feed| {
            change(feed);
            Changed::Cards
        })
    }

    /// A change to the flags only: the page gets them without the cards.
    fn update_status(
        &self,
        app: &AppHandle,
        generation: u64,
        change: impl FnOnce(&mut Feed),
    ) -> bool {
        self.apply(app, generation, |feed| {
            change(feed);
            Changed::Status
        })
    }

    /// Home opened: a feed from the last half hour comes back as it was; otherwise the feed as last
    /// shown (up to eight hours old) paints at once while a new one loads. Either leaves out what
    /// is known by now to be a Short or to never play. A changed video age limit drops what is now
    /// too old at once and builds the feed anew, and so does turning on "Hide videos you've already
    /// seen", which also never paints the last feed: it was all seen. Turning "Subscriptions on
    /// Home" off drops the followed channels' cards at once and builds anew too.
    pub async fn open(&self, app: &AppHandle) -> HomeSnapshot {
        let now = now_ms();
        let pool = app.state::<sqlx::SqlitePool>();
        let max_video_age_ms = inputs::max_video_age_ms(&pool).await;
        let hides_seen = inputs::hides_seen_videos(&pool).await;
        let subscriptions_kept_off = !inputs::subscriptions_on_home(&pool).await;
        let kept_off_home = if subscriptions_kept_off {
            inputs::subscriptions(&pool)
                .await
                .map(|subscriptions| subscriptions.ids())
                .unwrap_or_default()
        } else {
            HashSet::new()
        };
        let shorts = crate::db::known_shorts::all(&pool)
            .await
            .unwrap_or_default();
        let unplayable = crate::db::unplayable_videos::all(&pool)
            .await
            .unwrap_or_default();
        let within_limit = |card: &Card| {
            max_video_age_ms.is_none_or(|max_age_ms| filters::is_within(card, now, max_age_ms))
        };
        let showable = |card: &Card| {
            within_limit(card)
                && !shorts.contains(card.id())
                && !unplayable.contains(card.id())
                && !kept_off_home.contains(card.channel_id())
        };
        let choices_changed = {
            let feed = self.inner.feed.lock().unwrap();
            feed.max_video_age_ms != max_video_age_ms
                || feed.hides_seen != hides_seen
                || feed.subscriptions_kept_off != subscriptions_kept_off
        };
        if choices_changed {
            self.inner.chip_results.lock().unwrap().clear();
        }
        {
            let mut feed = self.inner.feed.lock().unwrap();
            feed.snapshot.cards.retain(showable);
            if choices_changed {
                if hides_seen {
                    feed.snapshot.cards.clear();
                }
                feed.loaded_at = 0;
            }
            let fresh = !feed.snapshot.cards.is_empty()
                && now.saturating_sub(feed.loaded_at) < FRESH_FEED_MS;
            if fresh || feed.snapshot.loading {
                return feed.snapshot.clone();
            }
        }
        if !hides_seen && let Ok((mut cards, origins)) = cache::load_last_feed(&pool, now).await {
            cards.retain(showable);
            let mut feed = self.inner.feed.lock().unwrap();
            if feed.snapshot.cards.is_empty() && !cards.is_empty() {
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
            self.update_status(app, generation, |feed| feed.snapshot.loading_more = false);
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
        self.update_status(app, generation, |feed| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::video::VideoSummary;

    fn card(id: &str) -> Card {
        Card {
            video: VideoSummary {
                id: id.into(),
                ..VideoSummary::default()
            },
            published_at_ms: 0,
        }
    }

    fn feed_of(ids: &[&str]) -> HomeSnapshot {
        HomeSnapshot {
            generation: 3,
            cards: ids.iter().map(|id| card(id)).collect(),
            origins: ids
                .iter()
                .map(|id| ((*id).to_string(), Origin::new(OriginKind::Search, None)))
                .collect(),
            has_more: true,
            loading_more: true,
            ..HomeSnapshot::default()
        }
    }

    /// Three of these go out for every page loaded. Each used to carry the whole feed.
    #[test]
    fn a_change_to_the_flags_sends_no_cards() {
        let snapshot = feed_of(&["a", "b", "c"]);
        let Some(Notice::Status(status)) = Notice::of(&snapshot, &Changed::Status) else {
            panic!("a flags change should send the flags");
        };
        assert_eq!(status, HomeStatus::of(&snapshot));
        let sent = serde_json::to_value(&status).unwrap();
        assert!(sent.get("cards").is_none() && sent.get("origins").is_none());
        assert_eq!(sent["generation"], 3);
        assert_eq!(sent["loadingMore"], true);
    }

    #[test]
    fn a_page_added_at_the_end_sends_only_its_own_cards() {
        let snapshot = feed_of(&["a", "b", "c", "d", "e"]);
        let Some(Notice::Append(append)) = Notice::of(&snapshot, &Changed::Appended { start: 3 })
        else {
            panic!("an appended page should send an append");
        };
        let ids: Vec<&str> = append.cards.iter().map(Card::id).collect();
        assert_eq!(ids, ["d", "e"]);
        assert_eq!(append.start, 3);
        let mut origins: Vec<&str> = append.origins.keys().map(String::as_str).collect();
        origins.sort_unstable();
        assert_eq!(origins, ["d", "e"]);

        // The flags travel beside the cards, at the top level like a snapshot's.
        let sent = serde_json::to_value(&append).unwrap();
        assert_eq!(sent["hasMore"], true);
        assert_eq!(sent["start"], 3);
        assert_eq!(sent["cards"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn any_other_change_sends_the_whole_snapshot() {
        let snapshot = feed_of(&["a", "b"]);
        let Some(Notice::Snapshot(sent)) = Notice::of(&snapshot, &Changed::Cards) else {
            panic!("a change to the cards should send the snapshot");
        };
        assert_eq!(sent.cards.len(), 2);
        assert!(Notice::of(&snapshot, &Changed::Nothing).is_none());
    }
}
