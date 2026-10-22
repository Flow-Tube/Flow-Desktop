//! Which of a channel's uploads are Shorts, from its Shorts tab. RSS cannot tell
//! a Short from a video, and length cannot either: Shorts run to three minutes
//! and plenty of ordinary videos are under one.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;

use crate::api::innertube::extractors::channel::SHORTS_TAB_PARAMS;
use crate::models::channel::ChannelItem;
use crate::models::video::VideoSummary;
use crate::services::youtube_service::YoutubeService;

const CACHE_TTL: Duration = Duration::from_hours(6);
const MAX_CACHED_CHANNELS: usize = 400;
/// A sweep asks for every channel; unbounded, these browses would take every
/// connection the player and search need.
const MAX_CONCURRENT_LOOKUPS: usize = 4;
/// The wait for a slot counts too, so a queue behind slow lookups cannot hold a refresh.
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(8);

struct Entry {
    reel_ids: HashSet<String>,
    fetched_at: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The channel's Shorts as last read, when that was recent enough to trust.
#[must_use]
pub fn cached(channel_id: &str) -> Option<HashSet<String>> {
    cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(channel_id)
        .filter(|entry| entry.fetched_at.elapsed() < CACHE_TTL)
        .map(|entry| entry.reel_ids.clone())
}

fn remember(channel_id: &str, reel_ids: HashSet<String>) {
    let mut cache = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if cache.len() >= MAX_CACHED_CHANNELS && !cache.contains_key(channel_id) {
        let oldest = cache
            .iter()
            .min_by_key(|(_, entry)| entry.fetched_at)
            .map(|(id, _)| id.clone());
        if let Some(oldest) = oldest {
            cache.remove(&oldest);
        }
    }
    cache.insert(
        channel_id.to_string(),
        Entry {
            reel_ids,
            fetched_at: Instant::now(),
        },
    );
}

/// The ids on the channel's Shorts tab, or `None` when the tab could not be read:
/// the channel is then unclassified, not Shorts-free.
pub async fn reel_ids(yt: &YoutubeService, channel_id: &str) -> Option<HashSet<String>> {
    static PERMITS: OnceLock<Semaphore> = OnceLock::new();
    if let Some(ids) = cached(channel_id) {
        return Some(ids);
    }
    let lookup = async {
        let _permit = PERMITS
            .get_or_init(|| Semaphore::new(MAX_CONCURRENT_LOOKUPS))
            .acquire()
            .await
            .ok()?;
        yt.get_channel_tab(channel_id, Some(SHORTS_TAB_PARAMS.to_string()), None, None)
            .await
            .map_err(|error| tracing::debug!(%channel_id, %error, "Shorts tab lookup failed"))
            .ok()
    };
    let tab = tokio::time::timeout(LOOKUP_TIMEOUT, lookup)
        .await
        .ok()
        .flatten()?;
    let ids: HashSet<String> = tab
        .items
        .into_iter()
        .filter_map(|item| match item {
            ChannelItem::Short(short) => Some(short.id),
            _ => None,
        })
        .collect();
    remember(channel_id, ids.clone());
    Some(ids)
}

/// Marks the Shorts of every channel whose tab is known; other channels keep what they had.
pub fn mark(videos: &mut [VideoSummary], verdicts: &HashMap<String, HashSet<String>>) {
    for video in videos {
        if let Some(ids) = video.channel_id.as_ref().and_then(|id| verdicts.get(id)) {
            video.is_short = ids.contains(&video.id);
        }
    }
}

/// The verdicts already in the cache for these videos' channels.
#[must_use]
pub fn cached_verdicts(videos: &[VideoSummary]) -> HashMap<String, HashSet<String>> {
    videos
        .iter()
        .filter_map(|video| video.channel_id.as_deref())
        .collect::<HashSet<_>>()
        .into_iter()
        .filter_map(|channel_id| cached(channel_id).map(|ids| (channel_id.to_string(), ids)))
        .collect()
}

/// Verdicts for the channels of these videos, the first `max_lookups` channels
/// in feed order looked up, the rest from the cache only.
pub async fn verdicts(
    yt: &YoutubeService,
    videos: &[VideoSummary],
    max_lookups: usize,
) -> HashMap<String, HashSet<String>> {
    let mut order = Vec::new();
    let mut seen = HashSet::new();
    for channel_id in videos
        .iter()
        .filter_map(|video| video.channel_id.as_deref())
    {
        if seen.insert(channel_id) {
            order.push(channel_id.to_string());
        }
    }
    let mut verdicts = HashMap::new();
    let mut to_look_up = Vec::new();
    for channel_id in order {
        match cached(&channel_id) {
            Some(ids) => {
                verdicts.insert(channel_id, ids);
            }
            None if to_look_up.len() < max_lookups => to_look_up.push(channel_id),
            None => {}
        }
    }
    let looked_up = crate::api::http::bounded_join(
        to_look_up,
        MAX_CONCURRENT_LOOKUPS,
        |channel_id| async move {
            let ids = reel_ids(yt, &channel_id).await;
            (channel_id, ids)
        },
    )
    .await;
    verdicts.extend(
        looked_up
            .into_iter()
            .filter_map(|(id, ids)| ids.map(|ids| (id, ids))),
    );
    verdicts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str, channel: &str) -> VideoSummary {
        VideoSummary {
            id: id.into(),
            channel_id: Some(channel.into()),
            ..VideoSummary::default()
        }
    }

    #[test]
    fn a_known_channel_marks_its_shorts_and_unmarks_the_rest() {
        let mut videos = vec![video("s1", "A"), video("v1", "A"), video("x", "B")];
        videos[1].is_short = true;
        let verdicts = HashMap::from([("A".to_string(), HashSet::from(["s1".to_string()]))]);
        mark(&mut videos, &verdicts);
        assert!(videos[0].is_short);
        assert!(!videos[1].is_short);
        assert!(!videos[2].is_short);
    }
}
