//! Channels watched together, from Flow for Android's `NeuroCoWatchStore` (#907): the related list
//! shown beside a video the viewer really watched or liked. One list is noise, so a pair of
//! channels counts once two different videos list it, or once the viewer has watched both.
//! Device-local, never synced.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use sqlx::SqlitePool;

use crate::db::neuro_stores::{self, CoWatchRow};
use crate::errors::AppResult;

const MAX_SOURCES: usize = 200;
const CHANNELS_PER_SOURCE: usize = 10;
const HALF_LIFE_MS: f64 = 45.0 * 24.0 * 3_600_000.0;
/// Fresh sources that make a pair as strong as it gets.
const FULL_STRENGTH_SOURCES: f64 = 2.0;
/// Related lists kept until the viewer watches or likes the video they were shown beside.
const PENDING_MAX: usize = 30;

/// One related list: the channel of the video it was beside, and the channels it held.
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub channel_id: String,
    pub related: Vec<String>,
    pub at_ms: u64,
}

/// A related video's channel, with its name so a neighbour can be fetched and named later.
#[derive(Debug, Clone)]
pub struct RelatedChannel {
    pub channel_id: String,
    pub channel_name: String,
}

fn pair_key(a: &str, b: &str) -> String {
    if a < b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

/// Confirmed channel pairs ("a|b") and their strength from 0 to 1: the decayed number of sources
/// listing them over [`FULL_STRENGTH_SOURCES`]. `is_watched` confirms a pair seen once.
#[must_use]
pub fn edges<'a>(
    sources: impl IntoIterator<Item = &'a Source>,
    is_watched: &dyn Fn(&str) -> bool,
    now_ms: u64,
) -> HashMap<String, f64> {
    let mut weight: HashMap<String, f64> = HashMap::new();
    let mut seen: HashMap<String, u32> = HashMap::new();
    for source in sources {
        #[allow(clippy::cast_precision_loss)]
        let age = now_ms.saturating_sub(source.at_ms) as f64;
        let decay = 0.5_f64.powf(age / HALF_LIFE_MS);
        for channel in &source.related {
            let key = pair_key(&source.channel_id, channel);
            *weight.entry(key.clone()).or_insert(0.0) += decay;
            *seen.entry(key).or_insert(0) += 1;
        }
    }
    weight
        .into_iter()
        .filter(|(key, _)| {
            seen.get(key).copied().unwrap_or(0) >= 2 || key.split('|').all(is_watched)
        })
        .map(|(key, value)| (key, (value / FULL_STRENGTH_SOURCES).min(1.0)))
        .collect()
}

/// For each channel next to one the viewer watches, the strongest such pair.
#[must_use]
pub fn neighbours(
    edges: &HashMap<String, f64>,
    is_watched: &dyn Fn(&str) -> bool,
) -> HashMap<String, f64> {
    let mut strongest: HashMap<String, f64> = HashMap::new();
    for (key, &strength) in edges {
        let Some((a, b)) = key.split_once('|') else {
            continue;
        };
        for (watched, other) in [(a, b), (b, a)] {
            if is_watched(watched) {
                let entry = strongest.entry(other.to_string()).or_insert(strength);
                *entry = entry.max(strength);
            }
        }
    }
    strongest
}

#[derive(Default)]
struct State {
    sources: HashMap<String, Source>,
    /// Video id to its related channels, newest last.
    pending: Vec<(String, Vec<RelatedChannel>)>,
}

/// The co-watch sources, resident and written through to SQLite.
pub struct CoWatchStore {
    pool: SqlitePool,
    state: Mutex<State>,
}

impl CoWatchStore {
    pub async fn load(pool: SqlitePool) -> AppResult<Self> {
        let mut state = State::default();
        for row in neuro_stores::load_cowatch(&pool).await? {
            let related: Vec<String> = serde_json::from_str(&row.related).unwrap_or_default();
            state.sources.insert(
                row.video_id,
                Source {
                    channel_id: row.channel_id,
                    related,
                    at_ms: u64::try_from(row.seen_at).unwrap_or(0),
                },
            );
        }
        Ok(Self {
            pool,
            state: Mutex::new(state),
        })
    }

    /// Keeps the related list shown beside `video_id` until the viewer watches or likes it.
    pub fn note_related(&self, video_id: &str, related: Vec<RelatedChannel>) {
        if video_id.trim().is_empty() || related.is_empty() {
            return;
        }
        let mut state = self.state.lock().unwrap();
        state.pending.retain(|(id, _)| id != video_id);
        state.pending.push((video_id.to_string(), related));
        if state.pending.len() > PENDING_MAX {
            state.pending.remove(0);
        }
    }

    /// Records the related list noted for `video_id`, a video of `channel_id` the viewer took to.
    pub async fn record_pending(
        &self,
        video_id: &str,
        channel_id: &str,
        now_ms: u64,
    ) -> AppResult<()> {
        let related = {
            let mut state = self.state.lock().unwrap();
            let Some(index) = state.pending.iter().position(|(id, _)| id == video_id) else {
                return Ok(());
            };
            state.pending.remove(index).1
        };
        self.record(video_id, channel_id, &related, now_ms).await
    }

    async fn record(
        &self,
        video_id: &str,
        channel_id: &str,
        related_videos: &[RelatedChannel],
        now_ms: u64,
    ) -> AppResult<()> {
        let mut related: Vec<String> = Vec::new();
        for video in related_videos {
            let id = video.channel_id.trim();
            if !id.is_empty() && id != channel_id && !related.iter().any(|known| known == id) {
                related.push(id.to_string());
            }
            if related.len() == CHANNELS_PER_SOURCE {
                break;
            }
        }
        if video_id.trim().is_empty() || channel_id.trim().is_empty() || related.is_empty() {
            return Ok(());
        }
        let wanted: HashSet<&String> = related.iter().collect();
        let names: HashMap<String, String> = related_videos
            .iter()
            .filter(|video| wanted.contains(&video.channel_id) && !video.channel_name.is_empty())
            .map(|video| (video.channel_id.clone(), video.channel_name.clone()))
            .collect();
        let row = CoWatchRow {
            video_id: video_id.to_string(),
            channel_id: channel_id.to_string(),
            related: serde_json::to_string(&related).unwrap_or_default(),
            names: serde_json::to_string(&names).unwrap_or_default(),
            seen_at: i64::try_from(now_ms).unwrap_or(i64::MAX),
        };
        {
            let mut state = self.state.lock().unwrap();
            state.sources.insert(
                video_id.to_string(),
                Source {
                    channel_id: channel_id.to_string(),
                    related,
                    at_ms: now_ms,
                },
            );
            if state.sources.len() > MAX_SOURCES {
                let mut by_age: Vec<(String, u64)> = state
                    .sources
                    .iter()
                    .map(|(id, source)| (id.clone(), source.at_ms))
                    .collect();
                by_age.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
                for (id, _) in by_age.into_iter().skip(MAX_SOURCES) {
                    state.sources.remove(&id);
                }
            }
        }
        neuro_stores::save_cowatch(
            &self.pool,
            &row,
            i64::try_from(MAX_SOURCES).unwrap_or(i64::MAX),
        )
        .await
    }

    /// For each channel beside one the viewer watches, its strongest confirmed pair.
    #[must_use]
    pub fn prior(&self, is_watched: &dyn Fn(&str) -> bool, now_ms: u64) -> HashMap<String, f64> {
        let state = self.state.lock().unwrap();
        neighbours(
            &edges(state.sources.values(), is_watched, now_ms),
            is_watched,
        )
    }

    /// Forgets every source and pending list; the caller clears the table.
    pub fn forget(&self) {
        *self.state.lock().unwrap() = State::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(channel: &str, related: &[&str]) -> Source {
        Source {
            channel_id: channel.into(),
            related: related.iter().map(|id| (*id).to_string()).collect(),
            at_ms: 0,
        }
    }

    #[test]
    fn one_list_is_noise_until_a_second_list_or_both_watches_confirm_it() {
        let nobody = |_: &str| false;
        let once = [source("A", &["B"])];
        assert!(edges(&once, &nobody, 0).is_empty());

        let twice = [source("A", &["B"]), source("B", &["A"])];
        assert!((edges(&twice, &nobody, 0)["A|B"] - 1.0).abs() < 1e-12);

        let both = |id: &str| id == "A" || id == "B";
        assert!((edges(&once, &both, 0)["A|B"] - 0.5).abs() < 1e-12);
    }

    #[test]
    fn neighbours_are_the_channels_beside_watched_ones() {
        let edges: HashMap<String, f64> =
            [("A|B".to_string(), 0.4), ("A|C".to_string(), 0.9)].into();
        let watched = |id: &str| id == "A";
        let prior = neighbours(&edges, &watched);
        assert_eq!(prior.len(), 2);
        assert!((prior["C"] - 0.9).abs() < 1e-12);
    }
}
