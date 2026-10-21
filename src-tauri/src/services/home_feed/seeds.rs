//! Which videos open Home's related lane, from Flow for Android's `GraphSeedSelector` and
//! `HomeFeedGraphCandidates`: real watches, likes and saved videos, scored by engagement, source and
//! age, spread one per interest community, with the last seed kept for a lasting interest the
//! recent ones miss.

use std::collections::{HashMap, HashSet};

use super::card::Card;
use crate::flow_neuro::clusters::TopicCluster;
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::scoring::strip_domain_tag;
use crate::flow_neuro::topic_catalog::TOPIC_CATEGORIES;

const DAY_MS: u64 = 86_400_000;
const MIN_LONG_WATCH_SECONDS: f64 = 180.0;
/// Minutes of watching at which a watch counts about two thirds as much as it ever can.
const WATCH_MINUTES_SCALE: f64 = 8.0;
const MAX_PER_CLUSTER: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SeedSource {
    WatchHistory,
    Liked,
    Playlist,
    /// A card on screen the viewer never touched.
    Feed,
}

#[derive(Debug, Clone)]
pub struct SeedInput {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    pub source: SeedSource,
    pub engagement_weight: f64,
    pub timestamp_ms: u64,
    pub duration_seconds: u64,
    /// 0 to 100.
    pub percent_watched: f64,
}

impl SeedInput {
    /// A watch that proves interest: most of the video, or a good part of a long one.
    #[must_use]
    #[allow(clippy::cast_precision_loss)]
    pub fn is_real_watch(duration_seconds: u64, percent_watched: f64) -> bool {
        let watched = duration_seconds as f64 * percent_watched / 100.0;
        percent_watched >= 70.0 || (percent_watched >= 35.0 && watched >= MIN_LONG_WATCH_SECONDS)
    }

    fn is_eligible(&self, excluded_channels: &HashSet<String>) -> bool {
        if self.id.is_empty()
            || (!self.channel_id.is_empty() && excluded_channels.contains(&self.channel_id))
        {
            return false;
        }
        self.source != SeedSource::WatchHistory
            || Self::is_real_watch(self.duration_seconds, self.percent_watched)
    }

    /// Half how much of it was seen, half how many minutes, so a long video watched in part
    /// weighs as much as a short clip watched in full.
    #[allow(clippy::cast_precision_loss)]
    fn engagement(&self) -> f64 {
        if self.source != SeedSource::WatchHistory || self.duration_seconds == 0 {
            return self.engagement_weight.max(0.0);
        }
        let completion = (self.percent_watched / 100.0).clamp(0.0, 1.0);
        let minutes = self.duration_seconds as f64 * completion / 60.0;
        0.5 * completion + 0.5 * (1.0 - (-minutes / WATCH_MINUTES_SCALE).exp())
    }

    fn source_weight(&self) -> f64 {
        match self.source {
            SeedSource::Liked => 1.4,
            SeedSource::Playlist | SeedSource::WatchHistory => 1.0,
            SeedSource::Feed => 0.15,
        }
    }

    #[must_use]
    pub fn score(&self, now_ms: u64) -> f64 {
        self.engagement() * self.source_weight() * recency_weight(self.timestamp_ms, now_ms)
    }
}

fn recency_weight(timestamp_ms: u64, now_ms: u64) -> f64 {
    if timestamp_ms == 0 {
        return 0.85;
    }
    match now_ms.saturating_sub(timestamp_ms) / DAY_MS {
        0..=1 => 1.0,
        2..=7 => 0.9,
        8..=30 => 0.75,
        31..=90 => 0.55,
        _ => 0.4,
    }
}

/// How seeds are grouped: by the viewer's interest the title names best, else by catalog category.
pub struct SeedClusters<'a> {
    spec: &'a KeySpec,
    topic_scores: &'a HashMap<String, f64>,
    by_base: HashMap<String, f64>,
    community_of: HashMap<String, String>,
    community_mass: HashMap<String, f64>,
}

impl<'a> SeedClusters<'a> {
    #[must_use]
    pub fn new(
        spec: &'a KeySpec,
        topic_scores: &'a HashMap<String, f64>,
        clusters: &[TopicCluster],
    ) -> Self {
        let mut by_base = HashMap::new();
        for (key, score) in topic_scores {
            by_base.entry(strip_domain_tag(key)).or_insert(*score);
        }
        Self {
            spec,
            topic_scores,
            by_base,
            community_of: clusters
                .iter()
                .flat_map(|c| {
                    c.topics
                        .iter()
                        .map(|t| (t.clone(), c.representative.clone()))
                })
                .collect(),
            community_mass: clusters
                .iter()
                .map(|c| (c.representative.clone(), c.mass))
                .collect(),
        }
    }

    fn raw_key(&self, title: &str) -> String {
        let words = self.spec.chunk(title).words();
        let best = words
            .iter()
            .filter_map(|word| {
                let score = self
                    .topic_scores
                    .get(word)
                    .or_else(|| self.by_base.get(word))?;
                Some((word, *score))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((word, score)) = best
            && score >= 0.05
        {
            return word.clone();
        }
        for word in &words {
            if let Some(category) = TOPIC_CATEGORIES
                .iter()
                .find(|c| c.topics.iter().any(|t| self.spec.key_of(t) == *word))
            {
                return format!("cat:{}", category.name);
            }
        }
        words.first().cloned().unwrap_or_else(|| "misc".into())
    }

    fn community(&self, title: &str) -> String {
        let key = self.raw_key(title);
        self.community_of
            .get(&strip_domain_tag(&key))
            .cloned()
            .unwrap_or(key)
    }
}

struct Ranked {
    id: String,
    cluster: String,
    weight: f64,
}

/// Spread-first: one seed per cluster, then up to each cluster's cap while slots remain.
fn pick_diverse(
    mut seeds: Vec<Ranked>,
    max_seeds: usize,
    cap_of: &dyn Fn(&str) -> usize,
) -> Vec<String> {
    seeds.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    let mut out: Vec<String> = Vec::new();
    let mut per_cluster: HashMap<&str, usize> = HashMap::new();
    for allowed in 1..=MAX_PER_CLUSTER {
        for seed in &seeds {
            if out.len() >= max_seeds {
                return out;
            }
            if out.contains(&seed.id) {
                continue;
            }
            let count = per_cluster.get(seed.cluster.as_str()).copied().unwrap_or(0);
            if count >= allowed.min(cap_of(&seed.cluster)) {
                continue;
            }
            out.push(seed.id.clone());
            per_cluster.insert(&seed.cluster, count + 1);
        }
    }
    out
}

fn select(
    candidates: &[&SeedInput],
    max_seeds: usize,
    now_ms: u64,
    excluded_channels: &HashSet<String>,
    clusters: &SeedClusters,
) -> Vec<String> {
    if candidates.is_empty() || max_seeds == 0 {
        return Vec::new();
    }
    let mut best: HashMap<&str, Ranked> = HashMap::new();
    for seed in candidates
        .iter()
        .filter(|s| s.is_eligible(excluded_channels))
    {
        let weight = seed.score(now_ms);
        if weight <= 0.0 {
            continue;
        }
        let keep = best.get(seed.id.as_str()).is_none_or(|r| weight > r.weight);
        if keep {
            best.insert(
                &seed.id,
                Ranked {
                    id: seed.id.clone(),
                    cluster: clusters.community(&seed.title),
                    weight,
                },
            );
        }
    }
    let ranked: Vec<Ranked> = best.into_values().collect();
    let present: HashSet<&String> = ranked.iter().map(|r| &r.cluster).collect();
    let present_mass: f64 = present
        .iter()
        .filter_map(|c| clusters.community_mass.get(*c))
        .sum();
    if present_mass <= 0.0 {
        return pick_diverse(ranked, max_seeds, &|_| MAX_PER_CLUSTER);
    }
    // A light interest gets fewer seeds, so a burst of one new interest takes one seed.
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss
    )]
    let cap_of = |community: &str| {
        clusters.community_mass.get(community).map_or(1, |mass| {
            ((max_seeds as f64 * mass / present_mass).round() as usize).clamp(1, MAX_PER_CLUSTER)
        })
    };
    pick_diverse(ranked, max_seeds, &cap_of)
}

/// The seeds for one related pass: recent seeds not used in the last hours (unless none other
/// qualifies), with the last slot given to a lasting interest none of them covers.
#[must_use]
pub fn select_with_long_term(
    candidates: &[SeedInput],
    max_seeds: usize,
    long_term: &[SeedInput],
    clusters: &SeedClusters,
    now_ms: u64,
    cooled: &HashSet<String>,
    excluded_channels: &HashSet<String>,
) -> Vec<String> {
    let all: Vec<&SeedInput> = candidates.iter().collect();
    let fresh: Vec<&SeedInput> = candidates
        .iter()
        .filter(|s| !cooled.contains(&s.id))
        .collect();
    let mut recent = select(&fresh, max_seeds, now_ms, excluded_channels, clusters);
    if recent.is_empty() {
        recent = select(&all, max_seeds, now_ms, excluded_channels, clusters);
    }
    if long_term.is_empty() || max_seeds < 2 {
        return recent;
    }
    recent.truncate(max_seeds - 1);
    let covered: HashSet<String> = candidates
        .iter()
        .filter(|s| recent.contains(&s.id))
        .map(|s| clusters.community(&s.title))
        .collect();
    let lasting = long_term
        .iter()
        .filter(|s| {
            !cooled.contains(&s.id) && !recent.contains(&s.id) && s.is_eligible(excluded_channels)
        })
        .filter_map(|s| {
            let community = clusters.community(&s.title);
            let mass = *clusters.community_mass.get(&community)?;
            (!covered.contains(&community))
                .then(|| (s, mass, s.engagement_weight * s.source_weight()))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.2.total_cmp(&b.2)));
    if let Some((seed, _, _)) = lasting {
        recent.push(seed.id.clone());
    }
    recent
}

/// A video a related list returned, with what found it.
#[derive(Debug, Clone)]
pub struct GraphCandidate {
    pub card: Card,
    pub seed_id: String,
    pub seed_score: f64,
    pub graph_rank: usize,
    pub seed_result_count: usize,
    pub hit_count: usize,
}

/// One candidate per video: the strongest seed's copy, its best rank, and how many seeds found it.
#[must_use]
pub fn merge_candidates(candidates: Vec<GraphCandidate>) -> Vec<GraphCandidate> {
    let mut order: Vec<String> = Vec::new();
    let mut merged: HashMap<String, (GraphCandidate, HashSet<String>)> = HashMap::new();
    for candidate in candidates {
        let id = candidate.card.id().to_string();
        match merged.get_mut(&id) {
            None => {
                order.push(id.clone());
                let seeds = HashSet::from([candidate.seed_id.clone()]);
                merged.insert(id, (candidate, seeds));
            }
            Some((current, seeds)) => {
                seeds.insert(candidate.seed_id.clone());
                let stronger = candidate.seed_score > current.seed_score;
                if stronger {
                    current.card = candidate.card;
                    current.seed_id = candidate.seed_id;
                }
                current.seed_score = current.seed_score.max(candidate.seed_score);
                current.graph_rank = current.graph_rank.min(candidate.graph_rank);
                current.seed_result_count =
                    current.seed_result_count.max(candidate.seed_result_count);
                current.hit_count = seeds.len();
            }
        }
    }
    order
        .into_iter()
        .filter_map(|id| merged.remove(&id).map(|(candidate, _)| candidate))
        .collect()
}

fn graph_boost(candidate: &GraphCandidate) -> f64 {
    let high_seed: f64 = if candidate.seed_score >= 1.0 {
        0.04
    } else {
        0.0
    };
    let convergence = if candidate.hit_count > 1 { 0.03 } else { 0.0 };
    let top_third = candidate.seed_result_count.div_ceil(3).max(1);
    let rank = if candidate.graph_rank < top_third {
        0.02
    } else {
        0.0
    };
    (high_seed + convergence + rank).min(0.08)
}

/// The ranked list nudged by graph evidence: a strong seed, several seeds, a high place.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn apply_graph_boost(
    ranked: Vec<Card>,
    metadata: &HashMap<String, GraphCandidate>,
) -> Vec<Card> {
    if ranked.len() <= 1 || metadata.is_empty() {
        return ranked;
    }
    let max_index = (ranked.len() - 1).max(1) as f64;
    let mut scored: Vec<(f64, usize, Card)> = ranked
        .into_iter()
        .enumerate()
        .map(|(i, card)| {
            let boost = metadata.get(card.id()).map_or(0.0, graph_boost);
            (1.0 - i as f64 / max_index + boost, i, card)
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    scored.into_iter().map(|(_, _, card)| card).collect()
}

/// Cards on screen as seeds for load-more, those a related lane placed left out, so a lane is at
/// most one hop from something the viewer watched, saved or follows.
#[must_use]
pub fn feed_seed_inputs(
    cards: &[Card],
    now_ms: u64,
    max: usize,
    related_picks: &HashSet<String>,
) -> Vec<SeedInput> {
    cards
        .iter()
        .filter(|card| {
            !card.is_short() && !card.id().is_empty() && !related_picks.contains(card.id())
        })
        .take(max)
        .map(|card| SeedInput {
            id: card.id().to_string(),
            title: card.video.title.clone(),
            channel_id: card.channel_id().to_string(),
            source: SeedSource::Feed,
            engagement_weight: 0.6,
            timestamp_ms: now_ms,
            duration_seconds: card.video.duration_seconds.unwrap_or(0),
            percent_watched: 0.0,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(id: &str, title: &str, source: SeedSource, percent: f64) -> SeedInput {
        SeedInput {
            id: id.into(),
            title: title.into(),
            channel_id: format!("UC{id}"),
            source,
            engagement_weight: 1.0,
            timestamp_ms: 1_000,
            duration_seconds: 900,
            percent_watched: percent,
        }
    }

    #[test]
    fn half_watched_history_never_seeds_and_interests_spread() {
        let spec = KeySpec::default();
        let scores: HashMap<String, f64> = [("guitar".into(), 0.6), ("chess".into(), 0.4)].into();
        let clusters = SeedClusters::new(&spec, &scores, &[]);
        let candidates = vec![
            seed("a", "Guitar lesson one", SeedSource::WatchHistory, 90.0),
            seed("b", "Guitar lesson two", SeedSource::WatchHistory, 95.0),
            seed("c", "Chess opening", SeedSource::WatchHistory, 80.0),
            seed("d", "Guitar solo", SeedSource::WatchHistory, 10.0),
        ];
        let picked = select_with_long_term(
            &candidates,
            2,
            &[],
            &clusters,
            2_000,
            &HashSet::new(),
            &HashSet::new(),
        );
        assert_eq!(picked.len(), 2);
        assert!(picked.contains(&"c".to_string()), "{picked:?}");
        assert!(!picked.contains(&"d".to_string()));
    }

    #[test]
    fn a_video_found_by_two_seeds_is_one_candidate() {
        use crate::services::home_feed::filters::tests::card;
        let merged = merge_candidates(vec![
            GraphCandidate {
                card: card("v", "c", ""),
                seed_id: "s1".into(),
                seed_score: 0.5,
                graph_rank: 4,
                seed_result_count: 20,
                hit_count: 1,
            },
            GraphCandidate {
                card: card("v", "c", ""),
                seed_id: "s2".into(),
                seed_score: 0.9,
                graph_rank: 1,
                seed_result_count: 20,
                hit_count: 1,
            },
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].seed_id, "s2");
        assert_eq!(merged[0].hit_count, 2);
        assert_eq!(merged[0].graph_rank, 1);
    }
}
