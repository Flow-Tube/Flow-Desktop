//! The subscription feed: every followed channel's uploads, newest first, with
//! Shorts, premieres and members-only uploads told apart. Ported from Flow for
//! Android's `RssSubscriptionService`.

pub mod reels;
pub mod rss;

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::api::innertube::extractors::channel::VIDEOS_TAB_PARAMS;
use crate::api::innertube::json::age::relative_age_ms;
use crate::commands::youtube::populate_video_durations;
use crate::models::channel::ChannelItem;
use crate::models::video::VideoSummary;
use crate::services::youtube_service::YoutubeService;

const RSS_CONCURRENCY: usize = 16;
/// Each fallback is a full channel browse, so few run at once.
const FALLBACK_CONCURRENCY: usize = 3;
const FALLBACK_JITTER_MS: u64 = 300;
/// The newest uploads get their length looked up; the rest stay without one.
const DURATION_FILL: usize = 100;
/// Shorts tabs looked up per load; channels past it are classified once cached.
const REEL_LOOKUPS_PER_LOAD: usize = 60;
/// How far down the feed the Shorts tabs are asked about.
const REEL_WINDOW: usize = 200;
/// The longest a video can run and still be guessed a Short when its channel's
/// Shorts tab is unknown.
const SHORT_GUESS_MAX_SECONDS: u64 = 60;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRssChannel {
    pub id: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRssFeed {
    pub videos: Vec<VideoSummary>,
    pub channels: Vec<SubscriptionRssChannel>,
    /// Channels whose uploads could not be read by RSS or by their Videos tab.
    pub failed_channel_ids: Vec<String>,
    /// Channels scanned so far (streaming progress). Equals `total` when done.
    pub processed: usize,
    /// Total channels to scan.
    pub total: usize,
}

/// Uploads of some channels, each with its publish time in seconds.
#[derive(Default)]
pub struct ChannelUploads {
    pub channels: Vec<SubscriptionRssChannel>,
    pub videos: Vec<(i64, VideoSummary)>,
    pub failed_channel_ids: Vec<String>,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX)
        })
}

/// Spreads fallback browses out so a burst of failures does not land at once.
fn jitter(channel_id: &str) -> Duration {
    let mut hasher = DefaultHasher::new();
    channel_id.hash(&mut hasher);
    Duration::from_millis(100 + hasher.finish() % FALLBACK_JITTER_MS)
}

/// A channel's uploads from its Videos tab, for when its feed cannot be read.
/// Its dates are relative ("3 days ago"), so their order is approximate.
async fn videos_tab(
    yt: &YoutubeService,
    channel_id: &str,
) -> Option<(SubscriptionRssChannel, Vec<(i64, VideoSummary)>)> {
    tokio::time::sleep(jitter(channel_id)).await;
    let tab = yt
        .get_channel_tab(channel_id, Some(VIDEOS_TAB_PARAMS.to_string()), None, None)
        .await
        .map_err(|error| tracing::warn!(%channel_id, %error, "Videos tab fallback failed"))
        .ok()?;
    let now = now_secs();
    let videos: Vec<(i64, VideoSummary)> = tab
        .items
        .into_iter()
        .filter_map(|item| match item {
            ChannelItem::Video(video) => {
                let age = video
                    .published_text
                    .as_deref()
                    .and_then(relative_age_ms)
                    .map_or(i64::MAX, |ms| i64::try_from(ms / 1000).unwrap_or(i64::MAX));
                Some((now.saturating_sub(age), video))
            }
            _ => None,
        })
        .collect();
    // A removed channel's browse still answers, with nothing on it.
    if videos.is_empty() {
        return None;
    }
    let name = videos.first().map(|(_, video)| video.channel_name.clone());
    Some((
        SubscriptionRssChannel {
            id: channel_id.to_string(),
            name,
            avatar_url: None,
        },
        videos,
    ))
}

/// The uploads of these channels: RSS first, retried once, then each failed
/// channel's Videos tab. A channel neither answers for is reported, never
/// counted as having nothing new. Members-only uploads are left out: they fail
/// to play.
pub async fn fetch_channels(yt: &YoutubeService, channel_ids: &[String]) -> ChannelUploads {
    let client = crate::api::http::shared_client();
    let feeds = crate::api::http::bounded_join(
        channel_ids.iter().cloned(),
        RSS_CONCURRENCY,
        |channel_id| async move {
            let parsed = rss::fetch_rss(client, &channel_id)
                .await
                .map(|xml| rss::parse_rss_feed(&channel_id, &xml));
            (channel_id, parsed)
        },
    )
    .await;

    let mut uploads = ChannelUploads::default();
    let mut unread = Vec::new();
    for (channel_id, parsed) in feeds {
        match parsed {
            // An error page served with a 200 parses to nothing, not even a name.
            Ok((None, videos)) if videos.is_empty() => unread.push(channel_id),
            Ok((name, videos)) => {
                uploads.channels.push(SubscriptionRssChannel {
                    id: channel_id,
                    name,
                    avatar_url: None,
                });
                uploads.videos.extend(videos);
            }
            Err(reason) => {
                tracing::warn!(%channel_id, %reason, "Subscription RSS fetch failed");
                unread.push(channel_id);
            }
        }
    }

    let fallbacks =
        crate::api::http::bounded_join(unread, FALLBACK_CONCURRENCY, |channel_id| async move {
            let found = videos_tab(yt, &channel_id).await;
            (channel_id, found)
        })
        .await;
    for (channel_id, found) in fallbacks {
        match found {
            Some((channel, videos)) => {
                uploads.channels.push(channel);
                uploads.videos.extend(videos);
            }
            None => uploads.failed_channel_ids.push(channel_id),
        }
    }
    uploads.videos.retain(|(_, video)| !video.is_members_only);
    uploads
}

pub fn sort_and_dedupe(videos: &mut Vec<(i64, VideoSummary)>) {
    videos.sort_by(|(left, _), (right, _)| right.cmp(left));
    let mut seen = std::collections::HashSet::new();
    videos.retain(|(_, video)| seen.insert(video.id.clone()));
}

/// Length is only a guess, used for channels whose Shorts tab is unknown.
fn guess_shorts(
    videos: &mut [VideoSummary],
    verdicts: &HashMap<String, std::collections::HashSet<String>>,
) {
    for video in videos {
        let classified = video
            .channel_id
            .as_ref()
            .is_some_and(|id| verdicts.contains_key(id));
        if !classified && !video.is_upcoming {
            video.is_short |= video
                .duration_seconds
                .is_some_and(|seconds| (1..=SHORT_GUESS_MAX_SECONDS).contains(&seconds));
        }
    }
}

/// The feed so far, with Shorts marked from the cache alone: a partial result
/// must not wait on lookups.
#[must_use]
pub fn partial_feed(videos: &[(i64, VideoSummary)], limit: usize) -> Vec<VideoSummary> {
    let mut feed: Vec<VideoSummary> = videos
        .iter()
        .take(limit)
        .map(|(_, video)| video.clone())
        .collect();
    let verdicts = reels::cached_verdicts(&feed);
    reels::mark(&mut feed, &verdicts);
    feed
}

/// The finished feed: Shorts tabs asked for the top of it while the newest
/// uploads get their lengths, then remembered for the home feed.
pub async fn finish_feed(
    yt: &YoutubeService,
    pool: &sqlx::SqlitePool,
    videos: Vec<(i64, VideoSummary)>,
    limit: usize,
) -> Vec<VideoSummary> {
    let published: HashMap<String, i64> = videos
        .iter()
        .map(|(seconds, video)| (video.id.clone(), *seconds))
        .collect();
    let mut feed: Vec<VideoSummary> = videos
        .into_iter()
        .map(|(_, video)| video)
        .take(limit)
        .collect();
    let window: Vec<VideoSummary> = feed.iter().take(REEL_WINDOW).cloned().collect();
    let fill = feed.len().min(DURATION_FILL);
    let (verdicts, ()) = tokio::join!(
        reels::verdicts(yt, &window, REEL_LOOKUPS_PER_LOAD),
        populate_video_durations(&mut feed[..fill], yt, pool),
    );
    reels::mark(&mut feed, &verdicts);
    guess_shorts(&mut feed, &verdicts);
    tracing::info!(
        videos = feed.len(),
        shorts = feed.iter().filter(|video| video.is_short).count(),
        upcoming = feed.iter().filter(|video| video.is_upcoming).count(),
        classified_channels = verdicts.len(),
        "Subscription feed finished"
    );
    crate::services::home_feed::remember_subscription_feed(pool, &feed, &published).await;
    feed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn video(id: &str, channel: &str, seconds: Option<u64>) -> VideoSummary {
        VideoSummary {
            id: id.into(),
            channel_id: Some(channel.into()),
            duration_seconds: seconds,
            ..VideoSummary::default()
        }
    }

    #[test]
    fn length_is_only_a_guess_where_the_shorts_tab_is_unknown() {
        let mut videos = vec![
            video("a", "known", Some(40)),
            video("b", "unknown", Some(40)),
            video("c", "unknown", Some(61)),
        ];
        let verdicts = HashMap::from([("known".to_string(), HashSet::new())]);
        guess_shorts(&mut videos, &verdicts);
        assert!(!videos[0].is_short);
        assert!(videos[1].is_short);
        assert!(!videos[2].is_short);
    }

    #[test]
    fn the_feed_is_newest_first_without_repeats() {
        let mut videos = vec![
            (1, video("a", "x", None)),
            (3, video("b", "x", None)),
            (2, video("a", "y", None)),
        ];
        sort_and_dedupe(&mut videos);
        let ids: Vec<&str> = videos.iter().map(|(_, video)| video.id.as_str()).collect();
        assert_eq!(ids, ["b", "a"]);
    }
}
