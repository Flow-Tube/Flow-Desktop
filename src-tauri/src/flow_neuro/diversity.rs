//! Orders scored candidates so one channel, topic or near-identical title cannot fill the feed,
//! ported from Flow for Android's `NeuroScoring.applySmartDiversity` and checked against its
//! `rank_golden.json`. One fix over Android (A8): a high scorer deferred from the first phase that
//! the second phase cannot place falls through to the relaxed fill instead of being dropped.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::scoring::{ScoredVideo, calculate_title_similarity, strip_domain_tag};

const PHASE1_TARGET: usize = 20;
const TITLE_SIMILARITY_STRICT: f64 = 0.55;
const TITLE_SIMILARITY_RELAXED: f64 = 0.60;
/// A novel topic earns an exploration slot only at this share of the top score.
const EXPLORATION_MIN_SCORE_RATIO: f64 = 0.30;
const DEFERRED_SCORE_RATIO: f64 = 0.8;

fn primary_topic(candidate: &ScoredVideo) -> String {
    candidate
        .vector
        .topics
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(key, _)| strip_domain_tag(key))
        .unwrap_or_default()
}

struct Placed<'a> {
    ids: Vec<String>,
    channels: Vec<&'a str>,
    titles: Vec<&'a str>,
}

impl<'a> Placed<'a> {
    fn recent_channel_count(&self, window: usize, channel: &str) -> usize {
        self.channels
            .iter()
            .rev()
            .take(window)
            .filter(|c| **c == channel)
            .count()
    }

    fn push(&mut self, candidate: &'a ScoredVideo) {
        self.ids.push(candidate.id.clone());
        self.channels.push(&candidate.channel_id);
        self.titles.push(&candidate.title);
    }
}

/// How many of one topic the first slots take, how many exploration slots they keep, and the three
/// topics that weigh most across the candidates.
fn topic_shape(
    candidates: &[ScoredVideo],
    extra_exploration_slots: usize,
) -> (usize, usize, HashSet<String>) {
    let mut unique_topics: Vec<String> = Vec::new();
    for candidate in candidates {
        let topic = primary_topic(candidate);
        if !candidate.vector.topics.is_empty() && !unique_topics.contains(&topic) {
            unique_topics.push(topic);
        }
    }
    let diversity = unique_topics.len();
    let max_per_topic = match diversity {
        0..=2 => 6,
        3..=4 => 4,
        _ => 3,
    };
    let exploration_slots = if diversity <= 4 { 2 } else { 1 } + extra_exploration_slots;

    let mut sums: Vec<(String, f64)> = Vec::new();
    for candidate in candidates {
        for (key, value) in &candidate.vector.topics {
            let base = strip_domain_tag(key);
            match sums.iter_mut().find(|(topic, _)| *topic == base) {
                Some((_, sum)) => *sum += value,
                None => sums.push((base, *value)),
            }
        }
    }
    sums.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top_topics = sums.into_iter().take(3).map(|(topic, _)| topic).collect();
    (max_per_topic, exploration_slots, top_topics)
}

/// The candidates' ids in feed order. A candidate `is_unrelated` calls unrelated never takes one
/// of the first slots; with `drop_unrelated` it is left out instead of waiting for the relaxed fill.
pub fn apply_smart_diversity(
    mut candidates: Vec<ScoredVideo>,
    spec: &KeySpec,
    extra_exploration_slots: usize,
    is_unrelated: &dyn Fn(&ScoredVideo) -> bool,
    drop_unrelated: bool,
) -> Vec<String> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let words: HashMap<&str, HashSet<String>> = candidates
        .iter()
        .map(|c| {
            (
                c.title.as_str(),
                spec.chunk(&c.title).words().into_iter().collect(),
            )
        })
        .collect();
    let similar =
        |placed: &Placed, title: &str, threshold: f64| {
            placed.titles.iter().rev().take(5).any(|existing| {
                calculate_title_similarity(&words[title], &words[existing]) > threshold
            })
        };
    let admissible = |candidate: &ScoredVideo| !drop_unrelated || !is_unrelated(candidate);
    let (max_per_topic, exploration_slots, top_topics) =
        topic_shape(&candidates, extra_exploration_slots);

    let top_score = candidates.first().map_or(0.0, |c| c.score);
    let mut placed = Placed {
        ids: Vec::new(),
        channels: Vec::new(),
        titles: Vec::new(),
    };
    let mut topic_window: Vec<String> = Vec::new();
    let mut deferred: Vec<&ScoredVideo> = Vec::new();
    let mut remaining: Vec<&ScoredVideo> = Vec::new();
    let mut exploration_count = 0;

    // Phase 1: strict diversity.
    let mut rest = candidates.iter();
    for current in rest.by_ref() {
        let topic = primary_topic(current);
        let topic_count = topic_window.iter().filter(|t| **t == topic).count();
        let qualifies_for_exploration = !topic.is_empty()
            && !top_topics.contains(&topic)
            && exploration_count < exploration_slots
            && top_score > 0.0
            && current.score >= top_score * EXPLORATION_MIN_SCORE_RATIO;
        let topic_cap = max_per_topic + usize::from(qualifies_for_exploration);
        if placed.recent_channel_count(usize::MAX, &current.channel_id) == 0
            && !is_unrelated(current)
            && topic_count < topic_cap
            && !similar(&placed, &current.title, TITLE_SIMILARITY_STRICT)
        {
            placed.push(current);
            if !topic.is_empty() {
                topic_window.push(topic);
            }
            exploration_count += usize::from(qualifies_for_exploration);
            if placed.ids.len() >= PHASE1_TARGET {
                break;
            }
        } else if top_score > 0.0 && current.score > top_score * DEFERRED_SCORE_RATIO {
            deferred.push(current);
        } else {
            remaining.push(current);
        }
    }
    remaining.extend(rest);

    // Phase 2: deferred high scorers, two per channel in the last seven.
    for scored in deferred {
        if placed.recent_channel_count(7, &scored.channel_id) < 2
            && !similar(&placed, &scored.title, TITLE_SIMILARITY_RELAXED)
            && admissible(scored)
        {
            placed.push(scored);
        } else {
            remaining.push(scored);
        }
    }

    // Phase 3: relaxed fill.
    remaining.sort_by(|a, b| b.score.total_cmp(&a.score));
    for scored in remaining {
        if placed.recent_channel_count(5, &scored.channel_id) < 2
            && !similar(&placed, &scored.title, TITLE_SIMILARITY_RELAXED)
            && admissible(scored)
        {
            placed.push(scored);
        }
    }
    placed.ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::scoring::ContentVector;

    fn video(id: &str, channel: &str, score: f64, topic: &str) -> ScoredVideo {
        ScoredVideo {
            id: id.into(),
            title: format!("{topic} {id}"),
            channel_id: channel.into(),
            score,
            vector: ContentVector {
                topics: [(topic.to_string(), 1.0)].into(),
                ..ContentVector::default()
            },
        }
    }

    #[test]
    fn a_deferred_high_scorer_falls_through_to_the_relaxed_fill() {
        // C waits behind A and B of its own channel; the second phase finds two of them in its
        // window of seven, the relaxed fill only one in its window of five.
        let candidates = vec![
            video("a", "same", 1.0, "guitar"),
            video("b", "same", 0.95, "piano"),
            video("c", "same", 0.9, "drums"),
            video("x1", "one", 0.5, "chess"),
            video("x2", "two", 0.5, "tennis"),
            video("x3", "three", 0.5, "baking"),
            video("x4", "four", 0.5, "hiking"),
        ];
        let order = apply_smart_diversity(candidates, &KeySpec::default(), 0, &|_| false, false);
        assert_eq!(order, ["a", "x1", "x2", "x3", "x4", "b", "c"]);
    }
}
