//! What one Home load reads locally: the channels followed, likes, saved videos and watch history
//! as seeds, the videos already watched, and what the viewer hid.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use sqlx::SqlitePool;

use super::card::Card;
use super::channel_memory::Watch;
use super::filters::is_within;
use super::seeds::{SeedInput, SeedSource};
use crate::db::settings::get_setting;
use crate::db::watch_history::{WatchHistoryRecord, get_watch_history};
use crate::db::{known_shorts, library, seen_videos, unplayable_videos};
use crate::errors::AppResult;
use crate::flow_neuro::gates::BlockedMatchers;
use crate::flow_neuro::scoring::{CHANNEL_SUPPRESSION_DAYS, UserBrain};
use crate::models::video::VideoSummary;

const HISTORY_LOOKBACK: i64 = 400;
const HISTORY_SEED_MAX: usize = 40;
const LONG_TERM_HISTORY_MAX: usize = 200;
/// Mostly watched: Home does not suggest it again.
const WATCHED_SHARE: f64 = 0.85;
const WATCHED_UNKNOWN_LENGTH_SECONDS: i64 = 1800;
/// Settings → Content, "Hide videos older than", in hours; 0 or unset is off.
const MAX_VIDEO_AGE_SETTING: &str = "home_max_video_age";
/// Settings → Content, "Hide videos you've already seen".
const HIDE_SEEN_SETTING: &str = "hide_seen_videos";

/// Whether the viewer chose never to be recommended a video they were already shown.
pub async fn hides_seen_videos(pool: &SqlitePool) -> bool {
    get_setting(pool, HIDE_SEEN_SETTING)
        .await
        .ok()
        .flatten()
        .is_some_and(|value| value == "true")
}

/// How old a video Home may show at most, by the viewer's choice; `None` when they made none.
pub async fn max_video_age_ms(pool: &SqlitePool) -> Option<u64> {
    let hours: u64 = get_setting(pool, MAX_VIDEO_AGE_SETTING)
        .await
        .ok()
        .flatten()?
        .trim()
        .parse()
        .ok()?;
    (hours > 0).then(|| hours.saturating_mul(3_600_000))
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredSubscription {
    Channel {
        id: String,
        #[serde(default)]
        name: String,
        #[serde(default, rename = "avatarUrl")]
        avatar_url: Option<String>,
    },
    Id(String),
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FeedActions {
    #[serde(default)]
    dismissed: Vec<String>,
    #[serde(default)]
    blocked: Vec<String>,
    #[serde(default)]
    suppressed_channels: Vec<(String, u64)>,
    #[serde(default)]
    watched: Vec<String>,
}

/// The channels the viewer follows, by id, with their names and avatars.
#[derive(Default)]
pub struct Subscriptions {
    pub names: HashMap<String, String>,
    pub avatars: HashMap<String, String>,
}

impl Subscriptions {
    pub fn ids(&self) -> HashSet<String> {
        self.names.keys().cloned().collect()
    }
}

/// What Home leaves out: what the viewer hid (videos, channels and topics, from the brain and the
/// feed actions), videos known to be Shorts, videos that were refused for good, and, by the
/// viewer's choice, videos older than a limit or already seen.
pub struct Exclusions {
    videos: HashSet<String>,
    channels: HashSet<String>,
    shorts: HashSet<String>,
    unplayable: HashSet<String>,
    /// Empty unless the viewer hides videos they were already shown.
    seen: HashSet<String>,
    /// The oldest a video may be and the time it is measured from, when the viewer set a limit.
    age_limit: Option<(u64, u64)>,
    matchers: BlockedMatchers,
    spec: crate::flow_neuro::keyspec::KeySpec,
}

impl Exclusions {
    /// Videos the viewer hid; they never open a related lane either.
    pub fn hidden_videos(&self) -> &HashSet<String> {
        &self.videos
    }

    /// Shorts found after the inputs were read.
    pub fn add_shorts(&mut self, shorts: HashSet<String>) {
        self.shorts.extend(shorts);
    }

    #[must_use]
    pub fn hides(&self, card: &Card) -> bool {
        self.videos.contains(card.id())
            || self.shorts.contains(card.id())
            || self.unplayable.contains(card.id())
            || self.seen.contains(card.id())
            || self
                .age_limit
                .is_some_and(|(max_age_ms, now_ms)| !is_within(card, now_ms, max_age_ms))
            || self.channels.contains(card.channel_id())
            || self
                .matchers
                .blocks_text(&card.video.title, &card.video.channel_name, &self.spec)
    }
}

/// Everything local one Home load reads.
pub struct Inputs {
    pub subscriptions: Subscriptions,
    pub watched: HashSet<String>,
    pub exclusions: Exclusions,
    pub history: Vec<WatchHistoryRecord>,
    pub likes: Vec<(VideoSummary, u64)>,
    pub saved: Vec<(VideoSummary, u64)>,
    pub max_video_age_ms: Option<u64>,
    pub hides_seen_videos: bool,
}

impl Inputs {
    pub async fn load(pool: &SqlitePool, brain: &UserBrain, now_ms: u64) -> AppResult<Self> {
        let subscriptions = subscriptions(pool).await?;
        let actions: FeedActions = get_setting(pool, "feed_actions_state_v1")
            .await?
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let history = get_watch_history(pool, HISTORY_LOOKBACK, 0).await?;
        let mut watched: HashSet<String> = history
            .iter()
            .filter(|record| is_mostly_watched(record))
            .map(|record| record.video_id.clone())
            .collect();
        watched.extend(actions.watched);
        let channel_cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * 86_400_000);
        let mut channels: HashSet<String> = brain.blocked_channels.iter().cloned().collect();
        channels.extend(actions.blocked);
        channels.extend(
            brain
                .suppressed_channels
                .iter()
                .filter(|(_, at)| **at > channel_cutoff)
                .map(|(id, _)| id.clone()),
        );
        channels.extend(
            actions
                .suppressed_channels
                .into_iter()
                .filter(|(_, at)| *at > channel_cutoff)
                .map(|(id, _)| id),
        );
        let mut videos: HashSet<String> = brain.suppressed_video_ids.keys().cloned().collect();
        videos.extend(actions.dismissed);
        let mut shorts = known_shorts::all(pool).await?;
        shorts.extend(
            history
                .iter()
                .filter(|record| record.is_short_video())
                .map(|record| record.video_id.clone()),
        );
        let spec = brain.key_spec();
        let max_video_age_ms = max_video_age_ms(pool).await;
        let hides_seen_videos = hides_seen_videos(pool).await;
        Ok(Self {
            exclusions: Exclusions {
                videos,
                channels,
                shorts,
                unplayable: unplayable_videos::all(pool).await?,
                seen: if hides_seen_videos {
                    seen_videos::all(pool).await?
                } else {
                    HashSet::new()
                },
                age_limit: max_video_age_ms.map(|max_age_ms| (max_age_ms, now_ms)),
                matchers: BlockedMatchers::new(&brain.blocked_topics, &spec),
                spec,
            },
            subscriptions,
            watched,
            likes: library::liked_videos(pool).await?,
            saved: library::saved_videos(pool).await?,
            history,
            max_video_age_ms,
            hides_seen_videos,
        })
    }

    fn history_seeds(&self) -> impl Iterator<Item = SeedInput> + '_ {
        self.history
            .iter()
            .filter(|record| !record.is_music)
            .filter(|record| !record.is_short_video())
            .map(|record| {
                let duration = record.total_duration_seconds.unwrap_or(0).max(0);
                #[allow(clippy::cast_precision_loss)]
                let percent = if duration > 0 {
                    (record.watch_duration_seconds as f64 * 100.0 / duration as f64)
                        .clamp(0.0, 100.0)
                } else {
                    0.0
                };
                SeedInput {
                    id: record.video_id.clone(),
                    title: record.title.clone(),
                    channel_id: record.channel_id.clone().unwrap_or_default(),
                    source: SeedSource::WatchHistory,
                    engagement_weight: percent / 100.0,
                    timestamp_ms: library::iso_ms(&record.watch_date),
                    duration_seconds: u64::try_from(duration).unwrap_or(0),
                    percent_watched: percent,
                }
            })
    }

    /// The newest 40 watches, as related-lane seeds.
    pub fn recent_seeds(&self, disliked: &HashSet<String>) -> Vec<SeedInput> {
        self.history_seeds()
            .filter(|seed| !disliked.contains(&seed.id))
            .take(HISTORY_SEED_MAX)
            .collect()
    }

    fn video_seeds(
        videos: &[(VideoSummary, u64)],
        source: SeedSource,
    ) -> impl Iterator<Item = SeedInput> + '_ {
        videos.iter().map(move |(video, at)| SeedInput {
            id: video.id.clone(),
            title: video.title.clone(),
            channel_id: video.channel_id.clone().unwrap_or_default(),
            source,
            engagement_weight: 1.0,
            timestamp_ms: *at,
            duration_seconds: video.duration_seconds.unwrap_or(0),
            percent_watched: 0.0,
        })
    }

    /// Seeds for lasting interests: likes, saved videos and the watches older than the recent ones.
    pub fn long_term_seeds(&self, disliked: &HashSet<String>) -> Vec<SeedInput> {
        let mut seen = HashSet::new();
        Self::video_seeds(&self.likes, SeedSource::Liked)
            .chain(Self::video_seeds(&self.saved, SeedSource::Playlist))
            .chain(
                self.history_seeds()
                    .take(LONG_TERM_HISTORY_MAX)
                    .skip(HISTORY_SEED_MAX),
            )
            .filter(|seed| !disliked.contains(&seed.id) && seen.insert(seed.id.clone()))
            .collect()
    }

    /// Saved interests for load-more: recent watches, likes and saved videos.
    pub fn saved_seeds(
        &self,
        disliked: &HashSet<String>,
        cooled: &HashSet<String>,
    ) -> Vec<SeedInput> {
        let per_source = HISTORY_SEED_MAX;
        let history: Vec<SeedInput> = self.recent_seeds(disliked);
        [
            history,
            Self::video_seeds(&self.likes, SeedSource::Liked).collect(),
            Self::video_seeds(&self.saved, SeedSource::Playlist)
                .filter(|seed| !disliked.contains(&seed.id))
                .collect(),
        ]
        .into_iter()
        .flat_map(|seeds| {
            seeds
                .into_iter()
                .filter(|s| !cooled.contains(&s.id))
                .take(per_source)
        })
        .collect()
    }

    /// Watches by channel, for channel memory.
    pub fn watches(&self) -> Vec<Watch> {
        self.history
            .iter()
            .filter(|record| !record.is_music)
            .filter_map(|record| {
                let channel_id = record.channel_id.clone()?;
                if record.is_short_video() {
                    return None;
                }
                let duration =
                    u64::try_from(record.total_duration_seconds.unwrap_or(0)).unwrap_or(0);
                Some(Watch {
                    channel_id,
                    channel_name: record.channel_name.clone().unwrap_or_default(),
                    watched_at_ms: library::iso_ms(&record.watch_date),
                    watched_seconds: u64::try_from(record.watch_duration_seconds).unwrap_or(0),
                    duration_seconds: duration,
                })
            })
            .collect()
    }

    /// Likes by channel, for channel memory.
    pub fn liked_channels(&self) -> Vec<(String, u64)> {
        self.likes
            .iter()
            .filter_map(|(video, at)| Some((video.channel_id.clone()?, *at)))
            .collect()
    }
}

fn is_mostly_watched(record: &WatchHistoryRecord) -> bool {
    match record.total_duration_seconds {
        #[allow(clippy::cast_precision_loss)]
        Some(total) if total > 0 => {
            record.watch_duration_seconds as f64 / total as f64 >= WATCHED_SHARE
        }
        _ => record.watch_duration_seconds >= WATCHED_UNKNOWN_LENGTH_SECONDS,
    }
}

pub(crate) async fn subscriptions(pool: &SqlitePool) -> AppResult<Subscriptions> {
    let stored: Vec<StoredSubscription> = get_setting(pool, "subscriptions")
        .await?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let mut out = Subscriptions::default();
    for entry in stored {
        let (id, name, avatar) = match entry {
            StoredSubscription::Channel {
                id,
                name,
                avatar_url,
            } => (id, name, avatar_url),
            StoredSubscription::Id(id) => (id, String::new(), None),
        };
        let id = id.trim().trim_start_matches("channel:").to_string();
        if id.is_empty() {
            continue;
        }
        if let Some(avatar) = avatar.filter(|a| !a.is_empty()) {
            out.avatars.insert(id.clone(), avatar);
        }
        out.names.insert(id, name);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;

    #[tokio::test]
    async fn shorts_and_videos_refused_for_good_are_left_out() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        known_shorts::remember(&pool, &["seen-in-rss".to_string()], 1_000)
            .await
            .unwrap();
        unplayable_videos::mark(&pool, "members", "membersOnly", 1_000)
            .await
            .unwrap();
        crate::db::watch_history::upsert_watch_record(
            &pool,
            &WatchHistoryRecord {
                id: None,
                video_id: "swiped".into(),
                title: "A Short".into(),
                channel_name: Some("Chan".into()),
                channel_id: Some("UC1".into()),
                watch_date: "2026-10-27T12:00:00Z".into(),
                watch_duration_seconds: 5,
                total_duration_seconds: Some(150),
                is_music: false,
                is_short: true,
            },
        )
        .await
        .unwrap();
        let inputs = Inputs::load(&pool, &UserBrain::default(), 2_000)
            .await
            .unwrap();
        let hidden: Vec<bool> = ["seen-in-rss", "swiped", "members", "video"]
            .iter()
            .map(|id| inputs.exclusions.hides(&card(id, "UC2", "1 day ago")))
            .collect();
        assert_eq!(hidden, [true, true, true, false]);
    }

    #[tokio::test]
    async fn a_video_age_limit_hides_older_and_undated_videos() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let day = 86_400_000;
        let now = 30 * day;
        let off = Inputs::load(&pool, &UserBrain::default(), now)
            .await
            .unwrap();
        assert!(!off.exclusions.hides(&card("old", "UC1", "2 weeks ago")));
        crate::db::settings::set_setting(&pool, MAX_VIDEO_AGE_SETTING, "72")
            .await
            .unwrap();
        let limited = Inputs::load(&pool, &UserBrain::default(), now)
            .await
            .unwrap();
        assert_eq!(limited.max_video_age_ms, Some(3 * day));
        let hidden: Vec<bool> = ["2 days ago", "2 weeks ago", ""]
            .iter()
            .map(|age| limited.exclusions.hides(&card("v", "UC1", age)))
            .collect();
        assert_eq!(hidden, [false, true, true]);
    }

    #[tokio::test]
    async fn seen_videos_are_hidden_only_when_the_viewer_turned_it_on() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        seen_videos::remember(&pool, &["shown".to_string()], 1_000)
            .await
            .unwrap();
        let hides = |inputs: &Inputs| {
            ["shown", "new"].map(|id| inputs.exclusions.hides(&card(id, "UC1", "1 day ago")))
        };
        let off = Inputs::load(&pool, &UserBrain::default(), 2_000)
            .await
            .unwrap();
        assert_eq!(hides(&off), [false, false]);
        crate::db::settings::set_setting(&pool, HIDE_SEEN_SETTING, "true")
            .await
            .unwrap();
        let on = Inputs::load(&pool, &UserBrain::default(), 2_000)
            .await
            .unwrap();
        assert_eq!(hides(&on), [true, false]);
    }
}
