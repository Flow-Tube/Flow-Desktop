//! What decides whether a candidate is ranked at all, ported from Flow for Android's
//! `NeuroScoring`: token-precise topic blocks, the seen gate, the relevance floor of a lane, and
//! how much jitter a pass gets.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::fold;
use crate::flow_neuro::scoring::{
    ContentVector, FeedEntry, ONBOARDING_WARMUP_INTERACTIONS, strip_domain_tag,
};
use crate::flow_neuro::topic_catalog::TOPIC_CATEGORIES;

/// A channel scored this high is one the viewer has taken to.
pub const KNOWN_CHANNEL_SCORE: f64 = 0.6;
/// Topic similarity under which a candidate shares nothing with the viewer.
pub const UNRELATED_SIMILARITY: f64 = 0.002;
/// The relevance a Home lane asks of what it shows.
pub const LANE_RELEVANCE_FLOOR: f64 = 0.02;
const SEEN_GATE_SHOW_COUNT: i32 = 2;
const SEEN_GATE_WINDOW_HOURS: f64 = 60.0;
const SEEN_GATE_SINGLE_SHOW_WINDOW_HOURS: f64 = 6.0;
const SEEN_GATE_MIN_POOL: usize = 25;
const SEEN_GATE_MIN_RESULTS: usize = 10;
const JITTER_COLD_START: f64 = 0.40;
const JITTER_NORMAL: f64 = 0.05;
const BLOCK_TOP_TOPICS: usize = 3;
const HOUR_MS: f64 = 3_600_000.0;

/// What the viewer blocked, as whole phrases and single keys.
#[derive(Debug, Default)]
pub struct BlockedMatchers {
    phrases: HashSet<String>,
    tokens: HashSet<String>,
}

impl BlockedMatchers {
    /// A block is precise: the term and its key, token-matched. Blocking a catalog category's own
    /// name also blocks its topics; blocking "Fortnite" never erases all of Gaming.
    #[must_use]
    pub fn new(blocked: &HashSet<String>, spec: &KeySpec) -> Self {
        let mut matchers = Self::default();
        for term in blocked {
            let lower = term.to_lowercase();
            if let Some(category) = TOPIC_CATEGORIES
                .iter()
                .find(|category| category.name.to_lowercase() == lower)
            {
                for topic in category.topics {
                    matchers.add(topic, spec);
                }
            }
            matchers.add(&lower, spec);
        }
        matchers
    }

    fn add(&mut self, term: &str, spec: &KeySpec) {
        let lower = term.to_lowercase().trim().to_string();
        if lower.is_empty() {
            return;
        }
        if lower.contains(' ') {
            self.phrases.insert(lower);
        } else {
            self.tokens.insert(spec.key_of(&lower));
            self.tokens.insert(lower);
        }
    }

    fn is_empty(&self) -> bool {
        self.phrases.is_empty() && self.tokens.is_empty()
    }

    /// Token-boundary matching: blocking "art" hides "art", never "startup".
    #[must_use]
    pub fn blocks_text(&self, title: &str, channel_name: &str, spec: &KeySpec) -> bool {
        if self.is_empty() {
            return false;
        }
        let title = fold(title);
        let channel = fold(channel_name);
        if self
            .phrases
            .iter()
            .any(|phrase| title.contains(phrase.as_str()) || channel.contains(phrase.as_str()))
        {
            return true;
        }
        if self.tokens.is_empty() {
            return false;
        }
        [&title, &channel]
            .into_iter()
            .flat_map(|text| {
                text.split([' ', '-', '_', '|', ',', '.', ':', '(', ')', '[', ']', '#'])
            })
            .map(|token| token.trim_matches(|c: char| !c.is_alphanumeric()))
            .filter(|token| token.encode_utf16().count() > 1)
            .any(|token| self.tokens.contains(token) || self.tokens.contains(&spec.key_of(token)))
    }
}

/// Whether a candidate's leading topics hold a blocked key, as a whole key or one of its words.
#[must_use]
pub fn blocks_topics(vector: &ContentVector, blocked_keys: &HashSet<String>) -> bool {
    if blocked_keys.is_empty() {
        return false;
    }
    let mut ranked: Vec<(&String, f64)> = vector.topics.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked.into_iter().take(BLOCK_TOP_TOPICS).any(|(topic, _)| {
        let base = strip_domain_tag(topic);
        blocked_keys.contains(&base) || base.split(' ').any(|part| blocked_keys.contains(part))
    })
}

/// The seen gate's rule for one item: a single showing hides it for hours, repeats for days.
#[must_use]
pub fn is_recently_seen(entry: Option<&FeedEntry>, now_ms: u64) -> bool {
    let Some(entry) = entry else {
        return false;
    };
    #[allow(clippy::cast_precision_loss)]
    let hours = now_ms.saturating_sub(entry.last_shown) as f64 / HOUR_MS;
    if hours < SEEN_GATE_SINGLE_SHOW_WINDOW_HOURS {
        return true;
    }
    entry.show_count >= SEEN_GATE_SHOW_COUNT && hours < SEEN_GATE_WINDOW_HOURS
}

/// Removes what was shown recently or often, unless the pool is small or too little would be left;
/// a score penalty alone lets a high scorer punch back in.
#[must_use]
pub fn apply_seen_gate<T>(
    items: Vec<T>,
    feed_history: &HashMap<String, FeedEntry>,
    now_ms: u64,
    id_of: impl Fn(&T) -> &str,
) -> Vec<T> {
    if items.len() < SEEN_GATE_MIN_POOL || feed_history.is_empty() {
        return items;
    }
    let kept = items
        .iter()
        .filter(|item| !is_recently_seen(feed_history.get(id_of(item)), now_ms))
        .count();
    if kept == items.len() || kept < SEEN_GATE_MIN_RESULTS {
        return items;
    }
    items
        .into_iter()
        .filter(|item| !is_recently_seen(feed_history.get(id_of(item)), now_ms))
        .collect()
}

/// How much `content`'s topics overlap `user`'s, from 0 to 1, without duration, pacing or
/// complexity. With `specificity`, each shared key counts by its square, so sharing "normal" or
/// "top" counts for little. A domain-tagged key meets its bare form at 0.3.
#[must_use]
pub fn topic_similarity(
    user: &HashMap<String, f64>,
    content: &ContentVector,
    specificity: Option<&dyn Fn(&str) -> f64>,
) -> f64 {
    let user_magnitude: f64 = user.values().map(|v| v * v).sum();
    if content.topics.is_empty() || user_magnitude <= 0.0 {
        return 0.0;
    }
    let mut base_to_tagged: HashMap<&str, f64> = HashMap::new();
    let mut untagged: HashMap<&str, f64> = HashMap::new();
    let mut tagged: Vec<(&String, f64)> = user
        .iter()
        .filter(|(key, _)| key.contains(':'))
        .map(|(key, &value)| (key, value))
        .collect();
    // Android keeps the first tagged key per base in map order; the smallest key is a stable pick.
    tagged.sort_by(|a, b| a.0.cmp(b.0));
    for (key, value) in tagged {
        let base = &key[..key.find(':').unwrap_or(key.len())];
        base_to_tagged.entry(base).or_insert(value);
    }
    for (key, &value) in user {
        if !key.contains(':') {
            untagged.insert(key, value);
        }
    }
    let mut dot = 0.0;
    let mut magnitude = 0.0;
    for (key, &value) in &content.topics {
        magnitude += value * value;
        let matched = user.get(key).copied().or_else(|| match key.find(':') {
            Some(index) => untagged.get(&key[..index]).map(|v| v * 0.3),
            None => base_to_tagged.get(key.as_str()).map(|v| v * 0.3),
        });
        if let Some(matched) = matched {
            let weight = specificity.map_or(1.0, |of| of(key));
            dot += value * matched * weight * weight;
        }
    }
    if dot > 0.0 && magnitude > 0.0 {
        dot / (user_magnitude.sqrt() * magnitude.sqrt())
    } else {
        0.0
    }
}

/// A channel the viewer subscribes to or has taken to.
#[must_use]
pub fn is_known_channel(
    channel_id: &str,
    user_subs: &HashSet<String>,
    channel_scores: &HashMap<String, f64>,
) -> bool {
    user_subs.contains(channel_id)
        || channel_scores.get(channel_id).copied().unwrap_or(0.0) >= KNOWN_CHANNEL_SCORE
}

/// Jitter as a fraction of the median score: more while the feed is stale, so repeats reshuffle,
/// less when it is fresh, so quality decides.
#[must_use]
pub fn adaptive_jitter(total_interactions: i32, feed_overlap_ratio: f64) -> f64 {
    if total_interactions < ONBOARDING_WARMUP_INTERACTIONS {
        JITTER_COLD_START
    } else if feed_overlap_ratio > 0.5 {
        0.25
    } else if feed_overlap_ratio > 0.2 {
        0.12
    } else {
        JITTER_NORMAL
    }
}
