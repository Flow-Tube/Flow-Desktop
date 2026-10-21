//! What one Home load reads locally: the channels followed, likes, saved videos and watch history
//! as seeds, the videos already watched, and what the viewer hid.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use sqlx::SqlitePool;

use super::card::Card;
use super::channel_memory::Watch;
use super::seeds::{SeedInput, SeedSource};
use crate::db::library;
use crate::db::settings::get_setting;
use crate::db::watch_history::{WatchHistoryRecord, get_watch_history};
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

/// What the viewer hid: videos, channels and topics, from the brain and the feed actions.
pub struct Exclusions {
    videos: HashSet<String>,
    channels: HashSet<String>,
    matchers: BlockedMatchers,
    spec: crate::flow_neuro::keyspec::KeySpec,
}

impl Exclusions {
    /// Videos the viewer hid; they never open a related lane either.
    pub fn hidden_videos(&self) -> &HashSet<String> {
        &self.videos
    }

    #[must_use]
    pub fn hides(&self, card: &Card) -> bool {
        self.videos.contains(card.id())
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
        let spec = brain.key_spec();
        Ok(Self {
            exclusions: Exclusions {
                videos,
                channels,
                matchers: BlockedMatchers::new(&brain.blocked_topics, &spec),
                spec,
            },
            subscriptions,
            watched,
            likes: library::liked_videos(pool).await?,
            saved: library::saved_videos(pool).await?,
            history,
        })
    }

    fn history_seeds(&self) -> impl Iterator<Item = SeedInput> + '_ {
        self.history
            .iter()
            .filter(|record| !record.is_music)
            .filter(|record| {
                !crate::flow_neuro::scoring::is_known_short(
                    record
                        .total_duration_seconds
                        .and_then(|s| u64::try_from(s).ok()),
                )
            })
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
                let duration =
                    u64::try_from(record.total_duration_seconds.unwrap_or(0)).unwrap_or(0);
                if crate::flow_neuro::scoring::is_known_short(Some(duration)) {
                    return None;
                }
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

async fn subscriptions(pool: &SqlitePool) -> AppResult<Subscriptions> {
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
