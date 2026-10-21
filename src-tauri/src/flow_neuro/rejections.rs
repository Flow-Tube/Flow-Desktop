//! What the viewer rejected, remembered as patterns whose weight halves every month, ported from
//! Flow for Android's `NeuroScoring` rejection memory (#907). One rejected video says little about
//! any single topic, so the pair of its two strongest topics counts at once, and its specific words
//! (as "~" patterns) count once a second rejection repeats them.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::keyed_lists::KeyedLists;
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::scoring::{
    ContentVector, REJECTION_PENALTY_1, REJECTION_PENALTY_2, REJECTION_PENALTY_3_PLUS,
    RejectionSignal, strip_domain_tag,
};
use crate::flow_neuro::signals::make_affinity_key;

/// A rejection's weight halves every month instead of vanishing after two weeks.
pub const REJECTION_HALF_LIFE_DAYS: f64 = 30.0;
pub const REJECTION_FORGET_BELOW: f64 = 0.5;
const REJECTION_RECORD_KEYS: usize = 2;
const REJECTION_MATCH_TOPICS: usize = 6;
const REJECTION_WORD_PREFIX: &str = "~";
/// A "~" pattern counts once a second rejection repeats it.
const REJECTION_REPEATED: f64 = 1.5;
const DAY_MS: f64 = 86_400_000.0;

fn ranked_topics(video_vector: &ContentVector, take: usize) -> Vec<String> {
    let mut ranked: Vec<(&String, f64)> = video_vector
        .topics
        .iter()
        .map(|(key, &weight)| (key, weight))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked
        .into_iter()
        .take(take)
        .map(|(key, _)| strip_domain_tag(key))
        .collect()
}

/// The patterns one rejected video is remembered by: the pair of its two strongest topics, and
/// "~" keys for its specific topics and the words of its phrases.
#[must_use]
pub fn extract_rejection_keys(video_vector: &ContentVector, lists: &KeyedLists) -> Vec<String> {
    let mut top: Vec<String> = Vec::new();
    for topic in ranked_topics(video_vector, 4) {
        if is_topic_sized(&topic) && !top.contains(&topic) {
            top.push(topic);
        }
    }
    if top.is_empty() {
        return Vec::new();
    }
    let mut keys = Vec::new();
    if top.len() >= 2 {
        keys.push(make_affinity_key(&top[0], &top[1]));
    }
    let specific = top
        .iter()
        .filter(|topic| !lists.is_broad_topic(topic))
        .take(REJECTION_RECORD_KEYS)
        .cloned();
    let words = top
        .iter()
        .flat_map(|topic| topic.split(' '))
        .filter(|word| is_topic_sized(word) && !lists.is_broad_topic(word))
        .map(str::to_string);
    let mut seen = HashSet::new();
    for word in specific.chain(words) {
        if seen.insert(word.clone()) {
            keys.push(format!("{REJECTION_WORD_PREFIX}{word}"));
        }
    }
    keys
}

/// The terms a candidate is recognised by: its strongest topics and the words of its phrases, so
/// a rejected "phonk" catches "phonk mix" and "drift phonk" too.
fn rejection_terms(video_vector: &ContentVector, lists: &KeyedLists) -> HashSet<String> {
    let top = ranked_topics(video_vector, REJECTION_MATCH_TOPICS);
    let mut terms: HashSet<String> = top.iter().cloned().collect();
    for phrase in top.iter().filter(|topic| topic.contains(' ')) {
        terms.extend(
            phrase
                .split(' ')
                .filter(|word| is_topic_sized(word) && !lists.is_broad_topic(word))
                .map(str::to_string),
        );
    }
    terms
}

fn matches_rejection(key: &str, terms: &HashSet<String>) -> bool {
    if let Some((left, right)) = key.split_once('|') {
        terms.contains(left) && terms.contains(right)
    } else if let Some(word) = key.strip_prefix(REJECTION_WORD_PREFIX) {
        terms.contains(word)
    } else {
        terms.contains(key)
    }
}

/// The rejection count left after a month-by-month halving since it was last rejected.
#[must_use]
pub fn effective_rejections(signal: &RejectionSignal, now_ms: u64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let age_days = now_ms.saturating_sub(signal.last_rejected_at) as f64 / DAY_MS;
    f64::from(signal.count) * 0.5_f64.powf(age_days / REJECTION_HALF_LIFE_DAYS)
}

fn strongest_rejection(
    video_vector: &ContentVector,
    patterns: &HashMap<String, RejectionSignal>,
    now_ms: u64,
    lists: &KeyedLists,
) -> f64 {
    let terms = rejection_terms(video_vector, lists);
    patterns
        .iter()
        .filter(|(key, _)| matches_rejection(key, &terms))
        .map(|(key, signal)| (key, effective_rejections(signal, now_ms)))
        .filter(|(key, effective)| {
            !key.starts_with(REJECTION_WORD_PREFIX) || *effective >= REJECTION_REPEATED
        })
        .map(|(_, effective)| effective)
        .fold(0.0, f64::max)
}

/// How far ranking lowers a candidate that looks like what the viewer rejected.
#[must_use]
pub fn rejection_penalty(
    video_vector: &ContentVector,
    patterns: &HashMap<String, RejectionSignal>,
    now_ms: u64,
    lists: &KeyedLists,
) -> f64 {
    if patterns.is_empty() {
        return 1.0;
    }
    let strength = strongest_rejection(video_vector, patterns, now_ms, lists);
    if strength >= 2.5 {
        REJECTION_PENALTY_3_PLUS
    } else if strength >= 1.5 {
        REJECTION_PENALTY_2
    } else if strength >= REJECTION_FORGET_BELOW {
        REJECTION_PENALTY_1
    } else {
        1.0
    }
}

/// What "not interested" leaves of the video's topics and channel: half the first time, less
/// the more often the viewer rejected the same thing.
#[must_use]
pub fn rejection_aggression(
    video_vector: &ContentVector,
    patterns: &HashMap<String, RejectionSignal>,
    now_ms: u64,
    lists: &KeyedLists,
) -> f64 {
    if patterns.is_empty() {
        return 0.5;
    }
    let strength = strongest_rejection(video_vector, patterns, now_ms, lists);
    if strength >= 1.5 {
        0.10
    } else if strength >= REJECTION_FORGET_BELOW {
        0.25
    } else {
        0.50
    }
}

/// Adds one rejection of the video's patterns and forgets the ones whose weight decayed away.
/// "Not interested" and a thumbs-down both write here.
pub fn record_rejection(
    patterns: &mut HashMap<String, RejectionSignal>,
    video_vector: &ContentVector,
    now_ms: u64,
    lists: &KeyedLists,
) {
    for key in extract_rejection_keys(video_vector, lists) {
        let left = patterns
            .get(&key)
            .map_or(0.0, |signal| effective_rejections(signal, now_ms));
        #[allow(clippy::cast_possible_truncation)]
        let count = ((left + 1.0).round() as i32).max(1);
        patterns.insert(
            key,
            RejectionSignal {
                count,
                last_rejected_at: now_ms,
            },
        );
    }
    crate::flow_neuro::caps::prune_rejections(patterns, now_ms);
}

/// Lowers the rejected video's topics that the vector holds to `aggression` of their weight (never
/// above 0.3) and drops those that fall below the prune line. Unrelated topics stay as they are.
#[must_use]
pub fn reject_topics(
    current: &ContentVector,
    rejected: &ContentVector,
    aggression: f64,
) -> ContentVector {
    let mut topics = current.topics.clone();
    for key in rejected.topics.keys() {
        if let Some(weight) = topics.get_mut(key)
            && *weight > 0.0
        {
            *weight = (*weight * aggression).min(0.3);
        }
    }
    topics.retain(|key, weight| {
        !rejected.topics.contains_key(key)
            || *weight >= crate::flow_neuro::scoring::TOPIC_PRUNE_THRESHOLD
    });
    ContentVector {
        topics,
        ..current.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::keyed_lists::keyed_lists;
    use crate::flow_neuro::keyspec::KeySpec;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/learn_golden.json");

    fn vector(value: &Value) -> ContentVector {
        ContentVector {
            topics: value["topics"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, weight)| (key.clone(), weight.as_f64().unwrap()))
                .collect(),
            ..ContentVector::default()
        }
    }

    #[test]
    fn rejection_memory_matches_android() {
        let golden: Value = serde_json::from_str(GOLDEN).unwrap();
        let case = &golden["rejection"];
        let delay = case["probeDelayMs"].as_u64().unwrap();
        let lists = keyed_lists(&KeySpec::default());
        let mut patterns = HashMap::new();
        for (step, event) in case["steps"].as_array().unwrap().iter().enumerate() {
            let now = event["now"].as_u64().unwrap();
            record_rejection(&mut patterns, &vector(&event["video"]), now, &lists);

            let expected: HashMap<String, (i32, u64)> = event["patterns"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(key, signal)| {
                    let count = i32::try_from(signal["count"].as_i64().unwrap()).unwrap();
                    (
                        key.clone(),
                        (count, signal["lastRejectedAt"].as_u64().unwrap()),
                    )
                })
                .collect();
            let actual: HashMap<String, (i32, u64)> = patterns
                .iter()
                .map(|(key, signal)| (key.clone(), (signal.count, signal.last_rejected_at)))
                .collect();
            assert_eq!(actual, expected, "patterns after rejection {step}");

            for probe in event["probes"].as_array().unwrap() {
                let probe_vector = vector(&probe["vector"]);
                let penalty = rejection_penalty(&probe_vector, &patterns, now + delay, &lists);
                let aggression =
                    rejection_aggression(&probe_vector, &patterns, now + delay, &lists);
                assert!(
                    (penalty - probe["penalty"].as_f64().unwrap()).abs() < 1e-12,
                    "penalty at {step}"
                );
                assert!(
                    (aggression - probe["aggression"].as_f64().unwrap()).abs() < 1e-12,
                    "aggression at {step}"
                );
            }
        }
    }

    #[test]
    fn a_rejection_lowers_the_videos_topics_and_leaves_weak_unrelated_ones() {
        let mut current = ContentVector::default();
        current.topics.insert("chess".into(), 0.01);
        current.topics.insert("comedy".into(), 0.5);
        current.topics.insert("phonk".into(), 0.6);
        let mut rejected = ContentVector::default();
        rejected.topics.insert("phonk".into(), 0.9);
        let after = reject_topics(&current, &rejected, 0.5);
        assert!(after.topics.contains_key("chess"));
        assert!((after.topics["phonk"] - 0.3).abs() < 1e-12);
        assert!((after.topics["comedy"] - 0.5).abs() < 1e-12);
    }
}
