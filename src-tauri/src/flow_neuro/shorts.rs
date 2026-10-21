//! What a Short's viewing teaches and which Shorts open related reel chains, from Flow for
//! Android's `ShortWatchClassifier` and `ShortsSeedSelector`, plus the ledger of Shorts already on
//! screen that ranking holds back for a week (one ledger for every Shorts surface, Android A17).

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::scoring::UserBrain;
use crate::flow_neuro::signals::InteractionType;

/// Quick flicks below this count as skips, not watches.
const MIN_WATCH_MS: u64 = 2_000;
/// Swiping away below this share, before `ABANDON_NEUTRAL_MS`, reads as rejection.
const ABANDON_SKIP_FRACTION: f64 = 0.30;
/// Watching past this share before swiping away still counts as a watch.
const ABANDON_WATCH_FRACTION: f64 = 0.60;
/// Past this position an early swipe is neutral.
const ABANDON_NEUTRAL_MS: u64 = 15_000;
pub const SEEN_SHORTS_MAX: usize = 3_000;
const SEEN_SHORT_EXPIRY_DAYS: f64 = 7.0;
/// A Short seen today keeps this share of its score, recovering over the week.
const SEEN_SHORT_PENALTY: f64 = 0.05;
const DAY_MS: f64 = 86_400_000.0;
const MIN_SEED_WATCHED_PERCENT: f64 = 60.0;
const FULL_WATCH_PERCENT: f64 = 90.0;

/// A viewing's verdict and how much of the Short it covered.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShortSignal {
    pub kind: InteractionType,
    pub percent: f32,
}

fn percent_of(position_ms: u64, duration_ms: u64) -> (u64, f32) {
    let duration = duration_ms.max(1);
    let position = position_ms.min(duration);
    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    let percent = (position as f64 / duration as f64) as f32;
    (position, percent.clamp(0.0, 1.0))
}

/// A viewing that played to the end: under two seconds skipped, otherwise watched.
#[must_use]
pub fn classify(position_ms: u64, duration_ms: u64) -> ShortSignal {
    let (position, percent) = percent_of(position_ms, duration_ms);
    let kind = if position < MIN_WATCH_MS {
        InteractionType::Skipped
    } else {
        InteractionType::Watched
    };
    ShortSignal { kind, percent }
}

/// A Short swiped away before it ended: most of it watched counts as watched, an early swipe as
/// skipped, and the middle teaches nothing.
#[must_use]
pub fn classify_abandon(position_ms: u64, duration_ms: u64) -> Option<ShortSignal> {
    let base = classify(position_ms, duration_ms);
    let (position, _) = percent_of(position_ms, duration_ms);
    if f64::from(base.percent) >= ABANDON_WATCH_FRACTION {
        Some(ShortSignal {
            kind: InteractionType::Watched,
            ..base
        })
    } else if f64::from(base.percent) < ABANDON_SKIP_FRACTION && position < ABANDON_NEUTRAL_MS {
        Some(ShortSignal {
            kind: InteractionType::Skipped,
            ..base
        })
    } else {
        None
    }
}

/// Notes Shorts that were on screen; each sighting restarts its week.
pub fn mark_seen(brain: &mut UserBrain, ids: &[String], now_ms: u64) {
    for id in ids {
        brain.seen_shorts_history.insert(id.clone(), now_ms);
    }
    cap_seen(brain);
}

pub fn cap_seen(brain: &mut UserBrain) {
    let history = &mut brain.seen_shorts_history;
    if history.len() <= SEEN_SHORTS_MAX {
        return;
    }
    let mut entries: Vec<(String, u64)> = history.drain().collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(SEEN_SHORTS_MAX);
    history.extend(entries);
}

/// The score factor for a Short already on screen in the last week.
#[must_use]
pub fn seen_penalty(seen_at: Option<u64>, now_ms: u64) -> f64 {
    let Some(seen_at) = seen_at else {
        return 1.0;
    };
    #[allow(clippy::cast_precision_loss)]
    let days = now_ms.saturating_sub(seen_at) as f64 / DAY_MS;
    if days >= SEEN_SHORT_EXPIRY_DAYS {
        return 1.0;
    }
    let recovery = (days / SEEN_SHORT_EXPIRY_DAYS).clamp(0.0, 1.0);
    SEEN_SHORT_PENALTY + (1.0 - SEEN_SHORT_PENALTY) * recovery
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortSeedSource {
    Liked,
    Watched,
    Saved,
}

#[derive(Debug, Clone)]
pub struct ShortSeed {
    pub id: String,
    pub channel_id: String,
    pub source: ShortSeedSource,
    pub timestamp_ms: u64,
    /// 0 to 100.
    pub percent_watched: f64,
}

impl ShortSeed {
    fn weight(&self, now_ms: u64) -> f64 {
        let source = match self.source {
            ShortSeedSource::Liked => 1.4,
            ShortSeedSource::Watched if self.percent_watched >= FULL_WATCH_PERCENT => 1.2,
            ShortSeedSource::Watched => 0.8,
            ShortSeedSource::Saved => 1.0,
        };
        let recency = if self.timestamp_ms == 0 {
            0.85
        } else {
            match now_ms.saturating_sub(self.timestamp_ms) / 86_400_000 {
                0..=1 => 1.0,
                2..=7 => 0.9,
                8..=30 => 0.75,
                31..=90 => 0.55,
                _ => 0.4,
            }
        };
        source * recency
    }
}

/// The Shorts that open related reel chains: most liked and best watched first, one per channel,
/// skipping seeds used lately unless too few others qualify.
#[must_use]
pub fn select_seeds(
    candidates: &[ShortSeed],
    max_seeds: usize,
    now_ms: u64,
    excluded_channels: &HashSet<String>,
    cooled: &HashSet<String>,
) -> Vec<String> {
    let eligible: Vec<&ShortSeed> = candidates
        .iter()
        .filter(|s| !s.id.is_empty())
        .filter(|s| s.channel_id.is_empty() || !excluded_channels.contains(&s.channel_id))
        .filter(|s| {
            s.source != ShortSeedSource::Watched || s.percent_watched >= MIN_SEED_WATCHED_PERCENT
        })
        .collect();
    let rotated: Vec<&ShortSeed> = eligible
        .iter()
        .copied()
        .filter(|s| !cooled.contains(&s.id))
        .collect();
    let pool = if rotated.len() >= max_seeds {
        rotated
    } else {
        eligible
    };
    let mut best: HashMap<&str, (f64, &ShortSeed)> = HashMap::new();
    for seed in pool {
        let weight = seed.weight(now_ms);
        if best.get(seed.id.as_str()).is_none_or(|(w, _)| weight > *w) {
            best.insert(&seed.id, (weight, seed));
        }
    }
    let mut ranked: Vec<(f64, &ShortSeed)> = best.into_values().collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    let mut channels = HashSet::new();
    ranked
        .into_iter()
        .filter(|(_, seed)| {
            let channel = if seed.channel_id.is_empty() {
                &seed.id
            } else {
                &seed.channel_id
            };
            channels.insert(channel.clone())
        })
        .take(max_seeds)
        .map(|(_, seed)| seed.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_played_out_counts_unless_flicked() {
        assert_eq!(classify(1_500, 30_000).kind, InteractionType::Skipped);
        assert_eq!(classify(30_000, 30_000).kind, InteractionType::Watched);
    }

    #[test]
    fn an_early_swipe_skips_a_late_one_watches_and_the_middle_says_nothing() {
        assert_eq!(
            classify_abandon(3_000, 30_000).map(|s| s.kind),
            Some(InteractionType::Skipped)
        );
        assert_eq!(
            classify_abandon(20_000, 30_000).map(|s| s.kind),
            Some(InteractionType::Watched)
        );
        assert_eq!(classify_abandon(12_000, 30_000), None);
        // Past fifteen seconds an early-share swipe is neutral.
        assert_eq!(classify_abandon(16_000, 60_000), None);
    }

    #[test]
    fn a_seen_short_waits_a_week() {
        let now = 10 * 86_400_000;
        assert!((seen_penalty(Some(now), now) - SEEN_SHORT_PENALTY).abs() < 1e-12);
        assert!((seen_penalty(Some(now - 8 * 86_400_000), now) - 1.0).abs() < 1e-12);
        assert!((seen_penalty(None, now) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn seeds_favour_likes_and_full_watches_one_per_channel() {
        let seed = |id: &str, channel: &str, source, percent| ShortSeed {
            id: id.into(),
            channel_id: channel.into(),
            source,
            timestamp_ms: 1_000,
            percent_watched: percent,
        };
        let picked = select_seeds(
            &[
                seed("a", "c1", ShortSeedSource::Watched, 95.0),
                seed("b", "c1", ShortSeedSource::Liked, 0.0),
                seed("c", "c2", ShortSeedSource::Watched, 40.0),
                seed("d", "c3", ShortSeedSource::Watched, 70.0),
            ],
            2,
            2_000,
            &HashSet::new(),
            &HashSet::new(),
        );
        assert_eq!(picked, ["b", "d"]);
    }
}
