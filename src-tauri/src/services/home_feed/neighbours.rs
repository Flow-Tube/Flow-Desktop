//! Channels several of the viewer's own sit next to in related lists, and their latest uploads,
//! from Flow for Android's `NeighbourChannels` and its repository. A neighbour ignored too often,
//! or none of whose uploads is on the viewer's subjects, is dropped.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use super::card::Card;
use crate::errors::AppResult;
use crate::flow_neuro::co_watch::Source;

const MIN_POINTERS: usize = 2;
const MAX_CHANNELS: usize = 12;
pub const REFRESH_PER_LOAD: usize = 4;
pub const UPLOADS_PER_CHANNEL: usize = 3;
const REFRESH_AFTER_MS: u64 = 6 * 3_600_000;
pub const UPLOAD_WINDOW_MS: u64 = 14 * 86_400_000;
const IGNORED_IMPRESSIONS: i64 = 6;
const HALF_LIFE_MS: f64 = 45.0 * 86_400_000.0;
const MAX_STORED: i64 = 100;

#[derive(Debug, Clone)]
pub struct Neighbour {
    pub channel_id: String,
    pub name: String,
    /// The names of the viewer's channels that point here, strongest first.
    pub pointer_names: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Stored {
    pub fetched_at: u64,
    pub uploads: Vec<Card>,
    pub dropped: bool,
}

/// Channels at least two of `anchors` sit next to, strongest first.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn neighbours(
    sources: &[Source],
    anchors: &HashSet<String>,
    excluded: &dyn Fn(&str) -> bool,
    names: &HashMap<String, String>,
    now_ms: u64,
) -> Vec<Neighbour> {
    let mut by_channel: HashMap<&str, HashMap<&str, f64>> = HashMap::new();
    for source in sources.iter().filter(|s| anchors.contains(&s.channel_id)) {
        let weight = 0.5_f64.powf(now_ms.saturating_sub(source.at_ms) as f64 / HALF_LIFE_MS);
        for channel in &source.related {
            if anchors.contains(channel) || excluded(channel) {
                continue;
            }
            let pointer = by_channel
                .entry(channel)
                .or_default()
                .entry(&source.channel_id)
                .or_insert(0.0);
            *pointer = pointer.max(weight);
        }
    }
    let mut ranked: Vec<(f64, Neighbour)> = by_channel
        .into_iter()
        .filter(|(_, pointers)| pointers.len() >= MIN_POINTERS)
        .map(|(channel, pointers)| {
            let mut ordered: Vec<(&str, f64)> = pointers.into_iter().collect();
            ordered.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
            let score = ordered.iter().map(|(_, w)| w).sum();
            let neighbour = Neighbour {
                channel_id: channel.to_string(),
                name: names.get(channel).cloned().unwrap_or_default(),
                pointer_names: ordered
                    .iter()
                    .filter_map(|(id, _)| names.get(*id).filter(|n| !n.is_empty()).cloned())
                    .collect(),
            };
            (score, neighbour)
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| a.1.channel_id.cmp(&b.1.channel_id))
    });
    ranked
        .into_iter()
        .take(MAX_CHANNELS)
        .map(|(_, n)| n)
        .collect()
}

/// The named neighbours whose uploads are older than six hours, at most a load's worth.
#[must_use]
pub fn refresh_queue<'a>(
    neighbours: &'a [Neighbour],
    stored: &HashMap<String, Stored>,
    now_ms: u64,
) -> Vec<&'a Neighbour> {
    neighbours
        .iter()
        .filter(|n| !n.name.is_empty())
        .filter(|n| {
            now_ms.saturating_sub(stored.get(&n.channel_id).map_or(0, |s| s.fetched_at))
                >= REFRESH_AFTER_MS
        })
        .take(REFRESH_PER_LOAD)
        .collect()
}

pub async fn load(pool: &SqlitePool) -> AppResult<HashMap<String, Stored>> {
    let rows: Vec<(String, i64, String, i64)> = sqlx::query_as(
        "SELECT channel_id, fetched_at, uploads, dropped FROM home_neighbour_channels",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(channel, fetched, uploads, dropped)| {
            let stored = Stored {
                fetched_at: u64::try_from(fetched).unwrap_or(0),
                uploads: serde_json::from_str(&uploads).unwrap_or_default(),
                dropped: dropped != 0,
            };
            (channel, stored)
        })
        .collect())
}

pub async fn save_uploads(
    pool: &SqlitePool,
    channel_id: &str,
    name: &str,
    uploads: &[Card],
    now_ms: u64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO home_neighbour_channels (channel_id, name, fetched_at, uploads) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET name = excluded.name, fetched_at = excluded.fetched_at,
             uploads = excluded.uploads",
    )
    .bind(channel_id)
    .bind(name)
    .bind(i64::try_from(now_ms).unwrap_or(i64::MAX))
    .bind(serde_json::to_string(uploads).unwrap_or_else(|_| "[]".into()))
    .execute(pool)
    .await?;
    sqlx::query(
        "DELETE FROM home_neighbour_channels WHERE channel_id NOT IN (
             SELECT channel_id FROM home_neighbour_channels ORDER BY fetched_at DESC LIMIT ?)",
    )
    .bind(MAX_STORED)
    .execute(pool)
    .await?;
    Ok(())
}

/// Counts one showing of each channel; one shown too often without a watch is dropped.
pub async fn note_shown(pool: &SqlitePool, channel_ids: &HashSet<String>) -> AppResult<()> {
    for channel in channel_ids {
        sqlx::query(
            "INSERT INTO home_neighbour_channels (channel_id, impressions) VALUES (?, 1)
             ON CONFLICT(channel_id) DO UPDATE SET impressions = impressions + 1,
                 dropped = CASE WHEN impressions + 1 >= ? THEN 1 ELSE dropped END",
        )
        .bind(channel)
        .bind(IGNORED_IMPRESSIONS)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Drops neighbours whose fetched uploads all missed the viewer's subjects: popular channels the
/// site puts beside anything.
pub async fn drop_off_topic(pool: &SqlitePool, channel_ids: &HashSet<String>) -> AppResult<()> {
    for channel in channel_ids {
        sqlx::query(
            "INSERT INTO home_neighbour_channels (channel_id, dropped) VALUES (?, 1)
             ON CONFLICT(channel_id) DO UPDATE SET dropped = 1",
        )
        .bind(channel)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_neighbour_needs_two_of_the_viewers_channels() {
        let source = |channel: &str, related: &[&str]| Source {
            channel_id: channel.into(),
            related: related.iter().map(|r| (*r).to_string()).collect(),
            at_ms: 0,
        };
        let sources = vec![
            source("A", &["X", "Y"]),
            source("B", &["X"]),
            source("Z", &["Y"]),
        ];
        let anchors = HashSet::from(["A".to_string(), "B".to_string()]);
        let names = HashMap::from([
            ("A".to_string(), "Alpha".to_string()),
            ("X".to_string(), "Ex".to_string()),
        ]);
        let found = neighbours(&sources, &anchors, &|_| false, &names, 0);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].channel_id, "X");
        assert_eq!(found[0].name, "Ex");
        assert_eq!(found[0].pointer_names, ["Alpha"]);
    }
}
