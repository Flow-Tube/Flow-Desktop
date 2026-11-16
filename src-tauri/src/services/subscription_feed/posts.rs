//! Community posts of the followed channels, for Subscriptions' Posts view. Ported from Flow for
//! Android's `SubscriptionPostsRepository`: the site has no combined posts feed, so each channel
//! costs one browse of its Posts tab. A page is [`CHANNELS_PER_PAGE`] channels, the most active first, and
//! each channel's recent posts are kept for half an hour.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Mutex, OnceLock, PoisonError};

use serde::{Deserialize, Serialize};

use crate::api::http::bounded_join;
use crate::api::innertube::extractors::channel::POSTS_TAB_PARAMS;
use crate::api::innertube::json::age::relative_age_ms;
use crate::errors::{AppError, AppResult};
use crate::models::channel::{ChannelItem, PostSummary};
use crate::services::youtube_service::YoutubeService;

pub const CHANNELS_PER_PAGE: usize = 8;
const CACHE_TTL_MS: u64 = 30 * 60 * 1000;
/// Posts this old are left out. An age the text does not give counts as old: it cannot prove the
/// post is recent.
const RECENT_WINDOW_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostsChannel {
    pub id: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionPost {
    pub post: PostSummary,
    pub channel_id: String,
    /// Epoch ms, read from the post's relative age when it was fetched.
    pub published_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionPostsPage {
    pub posts: Vec<SubscriptionPost>,
    /// The page after this one, or none once every channel was read.
    pub next_page: Option<usize>,
}

/// Each channel once, by its latest upload: `recent_uploader_ids` names channels newest upload
/// first, as the subscription feed lists them. Channels without a known upload keep their order at
/// the end.
#[must_use]
pub fn by_latest_upload(
    channels: Vec<PostsChannel>,
    recent_uploader_ids: &[String],
) -> Vec<PostsChannel> {
    let mut rank: HashMap<&str, usize> = HashMap::new();
    for (index, id) in recent_uploader_ids.iter().enumerate() {
        rank.entry(id.as_str()).or_insert(index);
    }
    let mut seen = HashSet::new();
    let mut ordered: Vec<PostsChannel> = channels
        .into_iter()
        .filter(|channel| seen.insert(channel.id.clone()))
        .collect();
    ordered.sort_by_key(|channel| rank.get(channel.id.as_str()).copied().unwrap_or(usize::MAX));
    ordered
}

fn page_of(ordered: &[PostsChannel], page: usize) -> (&[PostsChannel], Option<usize>) {
    let start = page.saturating_mul(CHANNELS_PER_PAGE).min(ordered.len());
    let end = start.saturating_add(CHANNELS_PER_PAGE).min(ordered.len());
    let next_page = (end < ordered.len()).then_some(page + 1);
    (&ordered[start..end], next_page)
}

/// The posts under [`RECENT_WINDOW_MS`] old, signed with the channel's name and avatar where the
/// post has none.
fn recent_posts(
    channel: &PostsChannel,
    posts: Vec<PostSummary>,
    now_ms: u64,
) -> Vec<SubscriptionPost> {
    posts
        .into_iter()
        .filter_map(|mut post| {
            let age = post
                .published_time_text
                .as_deref()
                .and_then(relative_age_ms)?;
            if age >= RECENT_WINDOW_MS {
                return None;
            }
            if post.author_name.is_empty() {
                post.author_name = channel.name.clone().unwrap_or_default();
            }
            if post.author_avatar.is_none() {
                post.author_avatar.clone_from(&channel.avatar_url);
            }
            Some(SubscriptionPost {
                post,
                channel_id: channel.id.clone(),
                published_at: now_ms.saturating_sub(age),
            })
        })
        .collect()
}

/// A round of channels' posts, newest first; equal ages keep the channels' order.
fn merge_by_age(round: Vec<Vec<SubscriptionPost>>) -> Vec<SubscriptionPost> {
    let mut seen = HashSet::new();
    let mut posts: Vec<SubscriptionPost> = round
        .into_iter()
        .flatten()
        .filter(|item| seen.insert(item.post.id.clone()))
        .collect();
    posts.sort_by_key(|item| std::cmp::Reverse(item.published_at));
    posts
}

/// Each channel's recent posts as last fetched, for a time to live.
pub struct ChannelPostsCache {
    ttl_ms: u64,
    entries: Mutex<HashMap<String, (u64, Vec<SubscriptionPost>)>>,
}

impl ChannelPostsCache {
    #[must_use]
    pub fn new(ttl_ms: u64) -> Self {
        Self {
            ttl_ms,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, (u64, Vec<SubscriptionPost>)>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn get(&self, channel_id: &str, now_ms: u64) -> Option<Vec<SubscriptionPost>> {
        self.entries()
            .get(channel_id)
            .filter(|(fetched_at, _)| now_ms.saturating_sub(*fetched_at) < self.ttl_ms)
            .map(|(_, posts)| posts.clone())
    }

    fn put(&self, channel_id: &str, posts: Vec<SubscriptionPost>, now_ms: u64) {
        let mut entries = self.entries();
        entries.retain(|_, (fetched_at, _)| now_ms.saturating_sub(*fetched_at) < self.ttl_ms);
        entries.insert(channel_id.to_string(), (now_ms, posts));
    }

    pub fn clear(&self) {
        self.entries().clear();
    }
}

/// The cache every Posts page reads, until a refresh clears it.
pub fn posts_cache() -> &'static ChannelPostsCache {
    static CACHE: OnceLock<ChannelPostsCache> = OnceLock::new();
    CACHE.get_or_init(|| ChannelPostsCache::new(CACHE_TTL_MS))
}

/// The first page of a channel's Posts tab.
pub async fn channel_posts(yt: &YoutubeService, channel_id: String) -> AppResult<Vec<PostSummary>> {
    let tab = yt
        .get_channel_tab(&channel_id, Some(POSTS_TAB_PARAMS.to_string()), None, None)
        .await?;
    Ok(tab
        .items
        .into_iter()
        .filter_map(|item| match item {
            ChannelItem::Post(post) => Some(post),
            _ => None,
        })
        .collect())
}

/// Page `page` of the channels in activity order: their recent posts in one bounded round, each
/// channel from the cache while it is fresh. A channel that fails is skipped; only a round where
/// every channel failed is an error, so it never reads as "no posts".
pub async fn load_page<F, Fut>(
    channels: Vec<PostsChannel>,
    recent_uploader_ids: &[String],
    page: usize,
    cache: &ChannelPostsCache,
    now_ms: u64,
    fetch: F,
) -> AppResult<SubscriptionPostsPage>
where
    F: Fn(PostsChannel) -> Fut,
    Fut: Future<Output = AppResult<Vec<PostSummary>>>,
{
    let ordered = by_latest_upload(channels, recent_uploader_ids);
    let (batch, next_page) = page_of(&ordered, page);
    if batch.is_empty() {
        return Ok(SubscriptionPostsPage {
            posts: Vec::new(),
            next_page: None,
        });
    }

    let fetch = &fetch;
    let mut results = bounded_join(
        // Owned channels: a future borrowing one would not be `Send` for every lifetime.
        batch.iter().cloned().enumerate(),
        CHANNELS_PER_PAGE,
        |(index, channel): (usize, PostsChannel)| async move {
            if let Some(posts) = cache.get(&channel.id, now_ms) {
                return (index, Ok(posts));
            }
            let found = fetch(channel.clone())
                .await
                .map(|posts| recent_posts(&channel, posts, now_ms));
            match &found {
                Ok(posts) => cache.put(&channel.id, posts.clone(), now_ms),
                Err(error) => {
                    tracing::warn!(channel_id = %channel.id, %error, "Channel posts failed");
                }
            }
            (index, found)
        },
    )
    .await;
    results.sort_by_key(|(index, _)| *index);

    let mut round = Vec::new();
    let mut first_error = None;
    for (_, result) in results {
        match result {
            Ok(posts) => round.push(posts),
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    tracing::info!(
        page,
        channels = batch.len(),
        failed = batch.len() - round.len(),
        "Subscription posts round"
    );
    if round.is_empty() {
        return Err(first_error.unwrap_or_else(|| {
            AppError::Network("No subscribed channel's posts could be loaded".into())
        }));
    }
    Ok(SubscriptionPostsPage {
        posts: merge_by_age(round),
        next_page,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_700_000_000_000;
    const DAY: u64 = 24 * 60 * 60 * 1000;
    const MINUTE: u64 = 60 * 1000;

    fn channel(id: &str) -> PostsChannel {
        PostsChannel {
            id: id.to_string(),
            name: Some(format!("{id} name")),
            avatar_url: Some(format!("https://yt3/{id}")),
        }
    }

    fn post(id: &str, published: &str) -> PostSummary {
        PostSummary {
            id: id.to_string(),
            author_name: "Author".to_string(),
            author_channel_id: None,
            author_avatar: None,
            text_content: None,
            attachment: None,
            likes_count_text: None,
            comment_count_text: None,
            comment_endpoint_params: None,
            published_time_text: Some(published.to_string()).filter(|text| !text.is_empty()),
        }
    }

    fn ids(channels: &[PostsChannel]) -> Vec<&str> {
        channels.iter().map(|channel| channel.id.as_str()).collect()
    }

    fn post_ids(posts: &[SubscriptionPost]) -> Vec<&str> {
        posts.iter().map(|item| item.post.id.as_str()).collect()
    }

    fn uploaders(ids: &[&str]) -> Vec<String> {
        ids.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn channels_with_the_newest_uploads_come_first_and_unknown_ones_keep_their_order() {
        let channels = ["quiet", "busy", "unknownA", "mid", "busy", "unknownB"]
            .map(channel)
            .to_vec();
        let ordered = by_latest_upload(channels, &uploaders(&["busy", "mid", "busy", "quiet"]));
        assert_eq!(
            ids(&ordered),
            ["busy", "mid", "quiet", "unknownA", "unknownB"]
        );
    }

    #[test]
    fn keeps_a_channels_posts_from_the_last_thirty_days() {
        let posts = vec![
            post("new", "2 days ago"),
            post("edited", "3 weeks ago (edited)"),
            post("four_weeks", "4 weeks ago"),
            post("thirty_days", "30 days ago"),
            post("month", "1 month ago"),
            post("unknown", ""),
            post("members", "Members only"),
        ];
        let recent = recent_posts(&channel("c1"), posts, NOW);
        assert_eq!(post_ids(&recent), ["new", "edited", "four_weeks"]);
        assert!(recent.iter().all(|item| item.channel_id == "c1"));
        assert_eq!(recent[0].published_at, NOW - 2 * DAY);
    }

    #[test]
    fn a_post_without_an_author_takes_the_channels() {
        let mut bare = post("p", "1 day ago");
        bare.author_name = String::new();
        let recent = recent_posts(&channel("c1"), vec![bare], NOW);
        assert_eq!(recent[0].post.author_name, "c1 name");
        assert_eq!(
            recent[0].post.author_avatar.as_deref(),
            Some("https://yt3/c1")
        );
    }

    #[test]
    fn a_round_merges_newest_first_keeping_channel_order_on_equal_ages() {
        let round = vec![
            recent_posts(
                &channel("a"),
                vec![post("a1", "5 days ago"), post("a2", "1 hour ago")],
                NOW,
            ),
            recent_posts(
                &channel("b"),
                vec![post("b1", "5 days ago"), post("b2", "2 weeks ago")],
                NOW,
            ),
            recent_posts(&channel("c"), vec![post("a1", "5 days ago")], NOW),
        ];
        assert_eq!(post_ids(&merge_by_age(round)), ["a2", "a1", "b1", "b2"]);
    }

    #[test]
    fn cached_posts_expire_after_the_time_to_live_and_clear_on_demand() {
        let cache = ChannelPostsCache::new(30 * MINUTE);
        let posts = recent_posts(&channel("a"), vec![post("a1", "1 day ago")], NOW);
        cache.put("a", posts, NOW);
        assert!(cache.get("a", NOW + 29 * MINUTE).is_some());
        assert!(cache.get("a", NOW + 30 * MINUTE).is_none());

        cache.put("a", Vec::new(), NOW);
        cache.clear();
        assert!(cache.get("a", NOW).is_none());
    }

    /// Answers every channel with one post a day old, recording which channels were browsed.
    fn recording_fetch(
        log: &Mutex<Vec<String>>,
        failing: &'static [&'static str],
    ) -> impl Fn(PostsChannel) -> std::future::Ready<AppResult<Vec<PostSummary>>> {
        move |channel: PostsChannel| {
            log.lock().unwrap().push(channel.id.clone());
            std::future::ready(if failing.contains(&channel.id.as_str()) {
                Err(AppError::RateLimited("slow down".into()))
            } else {
                Ok(vec![post(&format!("post-{}", channel.id), "1 day ago")])
            })
        }
    }

    #[tokio::test]
    async fn each_page_is_one_round_of_eight_channels_in_activity_order() {
        let channels: Vec<PostsChannel> = (1..=20).map(|n| channel(&format!("c{n}"))).collect();
        let active = uploaders(&["c20", "c19"]);
        let log = Mutex::new(Vec::new());
        let cache = ChannelPostsCache::new(CACHE_TTL_MS);
        let fetch = recording_fetch(&log, &[]);

        let mut pages = Vec::new();
        let mut next = Some(0);
        while let Some(page) = next {
            let loaded = load_page(channels.clone(), &active, page, &cache, NOW, &fetch)
                .await
                .expect("page");
            next = loaded.next_page;
            pages.push(loaded);
        }

        assert_eq!(
            pages
                .iter()
                .map(|page| page.posts.len())
                .collect::<Vec<_>>(),
            [8, 8, 4]
        );
        assert_eq!(
            pages.iter().map(|page| page.next_page).collect::<Vec<_>>(),
            [Some(1), Some(2), None]
        );
        let first: Vec<&str> = pages[0]
            .posts
            .iter()
            .map(|item| item.channel_id.as_str())
            .collect();
        assert_eq!(first, ["c20", "c19", "c1", "c2", "c3", "c4", "c5", "c6"]);
        let last: Vec<&str> = pages[2]
            .posts
            .iter()
            .map(|item| item.channel_id.as_str())
            .collect();
        assert_eq!(last, ["c15", "c16", "c17", "c18"]);
        assert_eq!(log.lock().unwrap().len(), 20);
    }

    #[tokio::test]
    async fn a_page_past_the_last_channel_is_empty_and_final() {
        let log = Mutex::new(Vec::new());
        let cache = ChannelPostsCache::new(CACHE_TTL_MS);
        let fetch = recording_fetch(&log, &[]);
        let past = load_page(vec![channel("a")], &[], 3, &cache, NOW, &fetch)
            .await
            .expect("page");
        assert!(past.posts.is_empty() && past.next_page.is_none());
        let none = load_page(Vec::new(), &[], 0, &cache, NOW, &fetch)
            .await
            .expect("page");
        assert!(none.posts.is_empty() && none.next_page.is_none());
        assert!(log.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_failing_channel_is_skipped_but_a_round_where_all_fail_is_an_error() {
        let log = Mutex::new(Vec::new());
        let cache = ChannelPostsCache::new(CACHE_TTL_MS);
        let fetch = recording_fetch(&log, &["bad", "worse"]);

        let some = load_page(
            vec![channel("good"), channel("bad")],
            &[],
            0,
            &cache,
            NOW,
            &fetch,
        )
        .await
        .expect("page");
        assert_eq!(post_ids(&some.posts), ["post-good"]);

        let all = load_page(
            vec![channel("bad"), channel("worse")],
            &[],
            0,
            &cache,
            NOW,
            &fetch,
        )
        .await;
        assert!(matches!(all, Err(AppError::RateLimited(_))));
    }

    #[tokio::test]
    async fn a_fresh_channel_is_read_from_the_cache_and_a_stale_one_again() {
        let log = Mutex::new(Vec::new());
        let cache = ChannelPostsCache::new(CACHE_TTL_MS);
        let fetch = recording_fetch(&log, &["bad"]);
        let channels = vec![channel("a"), channel("bad")];
        let browses = |id: &str| {
            log.lock()
                .unwrap()
                .iter()
                .filter(|seen| *seen == id)
                .count()
        };

        load_page(channels.clone(), &[], 0, &cache, NOW, &fetch)
            .await
            .expect("page");
        load_page(channels.clone(), &[], 0, &cache, NOW + 10 * MINUTE, &fetch)
            .await
            .expect("page");
        // A failure is not cached: that channel is asked again on the next page load.
        assert_eq!((browses("a"), browses("bad")), (1, 2));

        load_page(channels, &[], 0, &cache, NOW + 31 * MINUTE, &fetch)
            .await
            .expect("page");
        assert_eq!(browses("a"), 2);
    }
}
