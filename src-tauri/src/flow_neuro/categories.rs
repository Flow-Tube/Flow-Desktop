//! Video categories as a soft signal, ported from Flow for Android's `NeuroCategories`
//! and `NeuroCategoryStore` (#907): a stable id per category, which categories each channel posts
//! in (learned from watched videos, since feed results carry none), how the viewer's watching splits
//! across them, and a small penalty for a candidate whose category is foreign to that mix.

use std::collections::HashMap;
use std::sync::Mutex;

use sqlx::SqlitePool;

use crate::db::neuro_stores;
use crate::errors::AppResult;

/// The most a category mismatch takes off a score.
const MAX_PENALTY: f64 = 0.35;
/// Categorized strong signals before the viewer's mix is trusted.
const MIN_SIGNALS: f64 = 20.0;
/// A category this share of the viewer's watching is familiar, however small beside the rest.
const FAMILIAR_SHARE: f64 = 0.10;
/// Past this many signals every count halves, so the mix follows what the viewer watches now.
const MAX_SIGNALS: f64 = 400.0;
/// Channels the store remembers, the most recently watched first.
pub const MAX_CHANNELS: usize = 1000;

const IDS: [(&str, &str); 15] = [
    ("film & animation", "film"),
    ("autos & vehicles", "autos"),
    ("music", "music"),
    ("pets & animals", "pets"),
    ("sports", "sports"),
    ("travel & events", "travel"),
    ("gaming", "gaming"),
    ("people & blogs", "people"),
    ("comedy", "comedy"),
    ("entertainment", "entertainment"),
    ("news & politics", "news"),
    ("howto & style", "howto"),
    ("education", "education"),
    ("science & technology", "science"),
    ("nonprofits & activism", "nonprofits"),
];

/// Uploads land in these by default, so they say less about a video than the others.
fn specificity(id: &str) -> f64 {
    match id {
        "people" => 0.3,
        "entertainment" => 0.5,
        _ => 1.0,
    }
}

/// The stable id of a category name as the player's microformat writes it.
#[must_use]
pub fn id_of(name: Option<&str>) -> Option<&'static str> {
    let name = name?.trim().to_lowercase();
    IDS.iter()
        .find(|(category, _)| *category == name)
        .map(|(_, id)| *id)
}

/// A channel's main category and how sure the store is of it.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelCategory {
    pub id: String,
    pub confidence: f64,
}

/// The viewer's category mix after one strong signal on a video in `category`.
pub fn learn(affinity: &mut HashMap<String, f64>, category: &str) {
    *affinity.entry(category.to_string()).or_insert(0.0) += 1.0;
    if affinity.values().sum::<f64>() > MAX_SIGNALS {
        for count in affinity.values_mut() {
            *count /= 2.0;
        }
    }
}

/// The score factor for a candidate in `category`, from `MAX_PENALTY` off up to none.
#[must_use]
pub fn factor(affinity: &HashMap<String, f64>, category: &ChannelCategory) -> f64 {
    let total: f64 = affinity.values().sum();
    if total < MIN_SIGNALS {
        return 1.0;
    }
    let share = affinity.get(&category.id).copied().unwrap_or(0.0) / total;
    let mismatch = 1.0 - (share / FAMILIAR_SHARE).min(1.0);
    1.0 - MAX_PENALTY * category.confidence.clamp(0.0, 1.0) * mismatch * specificity(&category.id)
}

#[derive(Debug, Clone, Default)]
struct StoredChannel {
    counts: HashMap<String, i64>,
    seen_at: i64,
}

/// Which categories each channel posts in, resident and written through to SQLite.
pub struct CategoryStore {
    pool: SqlitePool,
    channels: Mutex<HashMap<String, StoredChannel>>,
}

impl CategoryStore {
    pub async fn load(pool: SqlitePool) -> AppResult<Self> {
        let mut channels: HashMap<String, StoredChannel> = HashMap::new();
        for row in neuro_stores::load_categories(&pool).await? {
            let channel = channels.entry(row.channel_id).or_default();
            channel.counts.insert(row.category, row.count);
            channel.seen_at = channel.seen_at.max(row.seen_at);
        }
        Ok(Self {
            pool,
            channels: Mutex::new(channels),
        })
    }

    /// The category `channel_id` posts in most, discounted for few videos: one video is weaker
    /// proof than five.
    #[must_use]
    pub fn category_of(&self, channel_id: &str) -> Option<ChannelCategory> {
        let channels = self.channels.lock().unwrap();
        let counts = &channels.get(channel_id)?.counts;
        let (id, top) = counts
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))?;
        let total: i64 = counts.values().sum();
        #[allow(clippy::cast_precision_loss)]
        let confidence = *top as f64 / (total as f64 + 1.0);
        Some(ChannelCategory {
            id: id.clone(),
            confidence,
        })
    }

    /// Records that `channel_id` posted a video in `category`.
    pub async fn record(&self, channel_id: &str, category: &str, now_ms: i64) -> AppResult<()> {
        if channel_id.trim().is_empty() {
            return Ok(());
        }
        let over_capacity = {
            let mut channels = self.channels.lock().unwrap();
            let channel = channels.entry(channel_id.to_string()).or_default();
            *channel.counts.entry(category.to_string()).or_insert(0) += 1;
            channel.seen_at = now_ms;
            if channels.len() > MAX_CHANNELS {
                let mut by_age: Vec<(String, i64)> = channels
                    .iter()
                    .map(|(id, c)| (id.clone(), c.seen_at))
                    .collect();
                by_age.sort_by_key(|(_, seen_at)| std::cmp::Reverse(*seen_at));
                for (id, _) in by_age.into_iter().skip(MAX_CHANNELS) {
                    channels.remove(&id);
                }
                true
            } else {
                false
            }
        };
        neuro_stores::record_category(&self.pool, channel_id, category, now_ms).await?;
        if over_capacity {
            neuro_stores::prune_categories(
                &self.pool,
                i64::try_from(MAX_CHANNELS).unwrap_or(i64::MAX),
            )
            .await?;
        }
        Ok(())
    }

    /// Forgets every channel; the caller clears the table.
    pub fn forget(&self) {
        self.channels.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn microformat_names_map_to_stable_ids() {
        assert_eq!(id_of(Some("Science & Technology")), Some("science"));
        assert_eq!(id_of(Some(" Gaming ")), Some("gaming"));
        assert_eq!(id_of(Some("Unknown")), None);
        assert_eq!(id_of(None), None);
    }

    #[test]
    fn a_foreign_category_costs_at_most_a_third() {
        let mut affinity = HashMap::new();
        for _ in 0..30 {
            learn(&mut affinity, "education");
        }
        let foreign = ChannelCategory {
            id: "gaming".into(),
            confidence: 1.0,
        };
        let familiar = ChannelCategory {
            id: "education".into(),
            confidence: 1.0,
        };
        assert!((factor(&affinity, &foreign) - (1.0 - MAX_PENALTY)).abs() < 1e-12);
        assert!((factor(&affinity, &familiar) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn a_young_mix_judges_nothing() {
        let mut affinity = HashMap::new();
        learn(&mut affinity, "education");
        let foreign = ChannelCategory {
            id: "gaming".into(),
            confidence: 1.0,
        };
        assert!((factor(&affinity, &foreign) - 1.0).abs() < 1e-12);
    }

    #[tokio::test]
    async fn the_store_remembers_a_channels_main_category() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let store = CategoryStore::load(pool.clone()).await.unwrap();
        store.record("UC1", "gaming", 1).await.unwrap();
        store.record("UC1", "gaming", 2).await.unwrap();
        store.record("UC1", "comedy", 3).await.unwrap();
        let category = store.category_of("UC1").unwrap();
        assert_eq!(category.id, "gaming");
        assert!((category.confidence - 0.5).abs() < 1e-12);

        let reloaded = CategoryStore::load(pool).await.unwrap();
        assert_eq!(reloaded.category_of("UC1"), Some(category));
    }
}
