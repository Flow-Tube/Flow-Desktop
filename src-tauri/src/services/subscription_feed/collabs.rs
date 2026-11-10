//! The collaborations a followed channel took part in but did not upload, from Flow for Android's
//! `ChannelCollabIndex`. A collaboration lists only on its uploader's feed and Videos tab; the one
//! place a collaborator shows it is the shelf on its Home tab, a heavy browse, so channels are looked
//! at a few per refresh: each at most once a day, and once a week when it has no collaborations.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::future::join_all;
use sqlx::SqlitePool;
use tokio::time::timeout;

use crate::db::settings::{get_setting, set_setting};
use crate::models::channel::{ChannelItem, ChannelTabResponse};
use crate::models::video::VideoSummary;
use crate::services::home_feed::card::Card;
use crate::services::youtube_service::YoutubeService;

const ENABLED_SETTING: &str = "subscription_collaborations_enabled";
const STORE_SETTING: &str = "subscription_collaborations_v1";
const MAX_CHANNELS_PER_PASS: usize = 12;
const PARALLEL_LOOKS: usize = 2;
const LOOK_TIMEOUT: Duration = Duration::from_secs(15);
const LOOK_INTERVAL_MS: u64 = 86_400_000;
const QUIET_LOOK_INTERVAL_MS: u64 = 7 * LOOK_INTERVAL_MS;
const WINDOW_MS: u64 = 60 * 86_400_000;

fn next_look_at() -> &'static Mutex<HashMap<String, u64>> {
    static NEXT: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    NEXT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The channels due a look, the never-seen first and then the longest-waiting, at most `max`.
fn due_channels(
    followed: &[String],
    next_look: &HashMap<String, u64>,
    now_ms: u64,
    max: usize,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut due: Vec<&String> = followed
        .iter()
        .filter(|id| seen.insert(id.as_str()))
        .filter(|id| next_look.get(*id).copied().unwrap_or(0) <= now_ms)
        .collect();
    due.sort_by_key(|id| next_look.get(*id).copied().unwrap_or(0));
    due.into_iter().take(max).cloned().collect()
}

fn home_videos(home: &ChannelTabResponse) -> impl Iterator<Item = &VideoSummary> {
    home.items
        .iter()
        .chain(
            home.sections
                .iter()
                .flat_map(|section| section.items.iter()),
        )
        .filter_map(|item| match item {
            ChannelItem::Video(video) => Some(video),
            _ => None,
        })
}

fn names_collaborator(video: &VideoSummary, channel_id: &str) -> bool {
    video.channel_id.as_deref().is_some_and(|c| c != channel_id)
        && video
            .collaborators
            .iter()
            .any(|c| c.channel_id == channel_id)
}

/// The Home tab's videos that name `channel_id` among their collaborators but were uploaded by a
/// channel the viewer does not follow; one they follow already reaches the feed by its own uploads.
/// Found by shape, never by the shelf's translated title.
fn collaborations_of(
    home: &ChannelTabResponse,
    channel_id: &str,
    followed: &HashSet<String>,
) -> Vec<VideoSummary> {
    let mut seen = HashSet::new();
    home_videos(home)
        .filter(|video| names_collaborator(video, channel_id))
        .filter(|video| {
            video
                .channel_id
                .as_deref()
                .is_some_and(|uploader| !followed.contains(uploader))
        })
        .filter(|video| seen.insert(video.id.clone()))
        .cloned()
        .collect()
}

fn has_collaborations(home: &ChannelTabResponse, channel_id: &str) -> bool {
    home_videos(home).any(|video| names_collaborator(video, channel_id))
}

type Store = HashMap<String, Vec<Card>>;

/// What is kept between refreshes, newest first and without the videos of channels no longer
/// followed: one the viewer followed since now reaches the feed by itself.
fn stored_videos(store: &Store, followed: &HashSet<String>, now_ms: u64) -> Vec<VideoSummary> {
    let mut seen = HashSet::new();
    let mut cards: Vec<&Card> = store
        .iter()
        .filter(|(channel, _)| followed.contains(*channel))
        .flat_map(|(_, cards)| cards)
        .filter(|card| !followed.contains(card.channel_id()))
        .filter(|card| card.age_ms(now_ms).is_some_and(|age| age <= WINDOW_MS))
        .filter(|card| seen.insert(card.id().to_string()))
        .collect();
    cards.sort_by_key(|card| std::cmp::Reverse(card.published_at_ms));
    cards.into_iter().map(|card| card.video.clone()).collect()
}

/// Looks at the followed channels most overdue and returns every collaboration known so far. With
/// the switch off, forgets them.
pub async fn scan(
    yt: &YoutubeService,
    pool: &SqlitePool,
    channel_ids: &[String],
    now_ms: u64,
) -> Vec<VideoSummary> {
    let enabled = get_setting(pool, ENABLED_SETTING)
        .await
        .ok()
        .flatten()
        .is_none_or(|value| value != "false");
    if !enabled {
        let _ = set_setting(pool, STORE_SETTING, "{}").await;
        return Vec::new();
    }
    let mut store: Store = get_setting(pool, STORE_SETTING)
        .await
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let followed: HashSet<String> = channel_ids.iter().cloned().collect();
    let due = {
        let next = next_look_at()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        due_channels(channel_ids, &next, now_ms, MAX_CHANNELS_PER_PASS)
    };
    let mut changed = false;
    for batch in due.chunks(PARALLEL_LOOKS) {
        let pages = join_all(batch.iter().map(|channel| async move {
            let page = timeout(LOOK_TIMEOUT, yt.get_channel_page(channel)).await;
            (channel, page)
        }))
        .await;
        for (channel, page) in pages {
            // A failed look is simply tried at the next refresh.
            let Ok(Ok(page)) = page else { continue };
            let wait = if has_collaborations(&page.home, channel) {
                LOOK_INTERVAL_MS
            } else {
                QUIET_LOOK_INTERVAL_MS
            };
            next_look_at()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(channel.clone(), now_ms + wait);
            let cards = collaborations_of(&page.home, channel, &followed)
                .into_iter()
                .map(|video| Card::from_summary(video, now_ms))
                .collect();
            store.insert(channel.clone(), cards);
            changed = true;
        }
    }
    if changed && let Ok(raw) = serde_json::to_string(&store) {
        let _ = set_setting(pool, STORE_SETTING, &raw).await;
    }
    stored_videos(&store, &followed, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::video::Collaborator;

    fn video(id: &str, uploader: &str, collaborators: &[&str]) -> VideoSummary {
        VideoSummary {
            id: id.to_string(),
            channel_id: Some(uploader.to_string()),
            collaborators: collaborators
                .iter()
                .map(|channel_id| Collaborator {
                    channel_id: (*channel_id).to_string(),
                    ..Collaborator::default()
                })
                .collect(),
            ..VideoSummary::default()
        }
    }

    fn home(videos: Vec<VideoSummary>) -> ChannelTabResponse {
        ChannelTabResponse {
            channel_id: "owner".to_string(),
            items: videos.into_iter().map(ChannelItem::Video).collect(),
            next_page_token: None,
            sections: Vec::new(),
            filters: Vec::new(),
        }
    }

    #[test]
    fn due_channels_put_the_never_seen_first_then_the_longest_waiting() {
        let followed: Vec<String> = ["a", "b", "c", "d", "a"]
            .iter()
            .map(ToString::to_string)
            .collect();
        let next = HashMap::from([
            ("a".to_string(), 50),
            ("b".to_string(), 10),
            ("d".to_string(), 500),
        ]);
        assert_eq!(due_channels(&followed, &next, 100, 3), ["c", "b", "a"]);
        assert_eq!(due_channels(&followed, &next, 100, 1), ["c"]);
    }

    #[test]
    fn a_collaboration_counts_only_from_a_channel_not_followed() {
        let page = home(vec![
            video("own", "owner", &["owner"]),
            video("followed", "friend", &["owner"]),
            video("kept", "stranger", &["owner", "stranger"]),
            video("kept", "stranger", &["owner"]),
            video("elsewhere", "stranger", &["someone"]),
        ]);
        let followed = HashSet::from(["owner".to_string(), "friend".to_string()]);
        let found = collaborations_of(&page, "owner", &followed);
        let ids: Vec<&str> = found.iter().map(|video| video.id.as_str()).collect();
        assert_eq!(ids, ["kept"]);
        assert!(has_collaborations(&page, "owner"));
        assert!(!has_collaborations(
            &home(vec![video("own", "owner", &[])]),
            "owner"
        ));
    }

    #[test]
    fn stored_videos_are_recent_and_only_for_channels_still_followed() {
        const DAY_MS: u64 = 86_400_000;
        let now = 100 * DAY_MS;
        let card = |id: &str, age_days: u64| Card {
            video: video(id, "stranger", &["owner"]),
            published_at_ms: now - age_days * DAY_MS,
        };
        let store = Store::from([
            (
                "owner".to_string(),
                vec![card("old", 90), card("b", 3), card("a", 1)],
            ),
            ("gone".to_string(), vec![card("left", 1)]),
        ]);
        let followed = HashSet::from(["owner".to_string()]);
        let ids: Vec<String> = stored_videos(&store, &followed, now)
            .into_iter()
            .map(|v| v.id)
            .collect();
        assert_eq!(ids, ["a", "b"]);
    }
}
