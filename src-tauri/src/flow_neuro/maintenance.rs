//! A one-time tidy of brains learned before the evidence horizons, from Flow for Android's
//! `NeuroMaintenance`: noise and blocked topics leave the vector and its links, each time of day
//! gets an estimate of how many events it saw, onboarding anchors become picks, and a vector decay
//! emptied is rehydrated from what channel profiles still know. Values stay as they are and are
//! read as horizon weights from then on, as Android did.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::display_forms::label;
use crate::flow_neuro::features::{is_noise_topic, pick_keys};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::fold;
use crate::flow_neuro::scoring::{
    DEVELOPING_TOPIC_THRESHOLD, TIME_BUCKET_CONFIDENT_EVENTS, UserBrain, strip_domain_tag,
};
use crate::flow_neuro::signals::make_affinity_key;

const REHYDRATE_MAX_TOPICS: usize = 40;
const REHYDRATE_MAX_WEIGHT: f64 = 0.30;
const REHYDRATE_MIN_WEIGHT: f64 = 0.06;
const REHYDRATE_AFFINITY_SEED: f64 = 0.15;
const REHYDRATE_MIN_CHANNEL_QUALITY: f64 = 0.4;
/// Fewer topics than this at the developing tier or above means decay emptied the vector.
const HOLLOW_VECTOR_TOPICS: usize = 5;

/// Runs every step. Each is safe to run again on a brain it already tidied.
pub fn migrate(brain: &mut UserBrain) {
    let spec = brain.key_spec();
    drop_blocked_topics(brain, &spec);
    drop_noise(brain, &spec);
    estimate_time_bucket_counts(brain);
    anchors_to_picks(brain);
    if is_hollow(brain) {
        rehydrate_from_channel_profiles(brain, &spec);
    }
}

/// Blocked topics, and the words of blocked phrases unless the viewer picked them, so blocking
/// "code technology" never hides the pick "Coding".
fn blocked_keys(brain: &UserBrain, spec: &KeySpec) -> HashSet<String> {
    let mut blocked: HashSet<String> = brain
        .blocked_topics
        .iter()
        .map(|topic| spec.key_of(fold(topic).trim()))
        .collect();
    let picked = pick_keys(brain);
    let phrase_words: Vec<String> = blocked
        .iter()
        .filter(|key| key.contains(' '))
        .flat_map(|phrase| spec.chunk(phrase).words())
        .filter(|word| !picked.contains(word))
        .collect();
    blocked.extend(phrase_words);
    blocked
}

fn is_blocked(topic: &str, blocked: &HashSet<String>, spec: &KeySpec) -> bool {
    if blocked.is_empty() {
        return false;
    }
    let base = strip_domain_tag(topic);
    blocked.contains(&base)
        || base
            .split(' ')
            .any(|word| blocked.contains(&spec.key_of(word)))
}

fn drop_blocked_topics(brain: &mut UserBrain, spec: &KeySpec) {
    let blocked = blocked_keys(brain, spec);
    if blocked.is_empty() {
        return;
    }
    brain
        .global_vector
        .topics
        .retain(|key, _| !is_blocked(key, &blocked, spec));
    brain
        .topic_affinities
        .retain(|key, _| key.split('|').all(|part| !is_blocked(part, &blocked, spec)));
}

/// Words that became filler after they were learned leave the vector and its links.
fn drop_noise(brain: &mut UserBrain, spec: &KeySpec) {
    brain
        .global_vector
        .topics
        .retain(|key, _| !is_noise_topic(key, spec));
    brain
        .topic_affinities
        .retain(|key, _| key.split('|').all(|part| !is_noise_topic(part, spec)));
}

/// A time of day learned before counts were kept is credited with as many events as it holds
/// topics, up to full confidence, so it keeps its weight in ranking only as far as it earned it.
fn estimate_time_bucket_counts(brain: &mut UserBrain) {
    for (bucket, vector) in &brain.time_vectors {
        if brain.time_bucket_counts.contains_key(bucket) || vector.topics.is_empty() {
            continue;
        }
        let events = i32::try_from(vector.topics.len())
            .unwrap_or(i32::MAX)
            .min(TIME_BUCKET_CONFIDENT_EVENTS);
        brain.time_bucket_counts.insert(*bucket, events);
    }
}

/// Onboarding anchors were protected from decay; picks are now, so an anchor becomes the pick it
/// stood for and the anchor list empties.
fn anchors_to_picks(brain: &mut UserBrain) {
    let picked = pick_keys(brain);
    let anchors: Vec<String> = brain.global_vector.anchor_topics.drain().collect();
    for anchor in anchors {
        let key = strip_domain_tag(&anchor);
        if !picked.contains(&key) {
            brain
                .preferred_topics
                .insert(label(&brain.display_forms, &key));
        }
    }
    brain.global_vector.topic_confidence.clear();
}

fn is_hollow(brain: &UserBrain) -> bool {
    brain
        .global_vector
        .topics
        .values()
        .filter(|weight| **weight >= DEVELOPING_TOPIC_THRESHOLD)
        .count()
        < HOLLOW_VECTOR_TOPICS
}

/// Seeds the vector from the topics good channels are known for. A max-merge that never lowers a
/// score and tops out below established interests, so seeded topics still need watching to last;
/// links between each channel's top topics give interest groups structure at once.
fn rehydrate_from_channel_profiles(brain: &mut UserBrain, spec: &KeySpec) {
    if brain.channel_topic_profiles.is_empty() {
        return;
    }
    let blocked = blocked_keys(brain, spec);
    let usable = |topic: &str| !is_noise_topic(topic, spec) && !is_blocked(topic, &blocked, spec);
    let quality = |channel: &str| brain.channel_scores.get(channel).copied().unwrap_or(0.5);

    let mut aggregated: HashMap<String, f64> = HashMap::new();
    let mut links: Vec<String> = Vec::new();
    for (channel, profile) in &brain.channel_topic_profiles {
        let channel_quality = quality(channel);
        if channel_quality < REHYDRATE_MIN_CHANNEL_QUALITY {
            continue;
        }
        let mut top: Vec<(&String, f64)> = Vec::new();
        for (topic, &weight) in profile {
            if usable(topic) {
                *aggregated.entry(topic.clone()).or_insert(0.0) += weight * channel_quality;
                top.push((topic, weight));
            }
        }
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        let mut top: Vec<String> = top
            .into_iter()
            .take(3)
            .map(|(topic, _)| strip_domain_tag(topic))
            .collect();
        top.dedup();
        for i in 0..top.len() {
            for j in i + 1..top.len() {
                links.push(make_affinity_key(&top[i], &top[j]));
            }
        }
    }
    let Some(max) = aggregated.values().copied().reduce(f64::max) else {
        return;
    };
    if max <= 0.0 {
        return;
    }
    let mut ranked: Vec<(String, f64)> = aggregated.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (topic, aggregate) in ranked.into_iter().take(REHYDRATE_MAX_TOPICS) {
        let seeded = (aggregate / max * REHYDRATE_MAX_WEIGHT).max(REHYDRATE_MIN_WEIGHT);
        let weight = brain.global_vector.topics.entry(topic).or_insert(0.0);
        *weight = weight.max(seeded);
    }
    for link in links {
        let weight = brain.topic_affinities.entry(link).or_insert(0.0);
        *weight = weight.max(REHYDRATE_AFFINITY_SEED);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::scoring::TimeBucket;

    #[test]
    fn noise_and_blocked_topics_leave_the_vector_and_its_links() {
        let mut brain = UserBrain::default();
        let spec = brain.key_spec();
        let chess = spec.key_of("chess");
        let drama = spec.key_of("drama");
        for key in [&chess, &drama, &"the".to_string()] {
            brain.global_vector.topics.insert(key.clone(), 0.4);
        }
        brain
            .topic_affinities
            .insert(make_affinity_key(&chess, &drama), 0.2);
        brain.blocked_topics.insert("drama".into());
        migrate(&mut brain);
        assert!(brain.global_vector.topics.contains_key(&chess));
        assert!(!brain.global_vector.topics.contains_key(&drama));
        assert!(!brain.global_vector.topics.contains_key("the"));
        assert!(brain.topic_affinities.is_empty());
    }

    #[test]
    fn a_time_of_day_without_counts_gets_an_estimate() {
        let mut brain = UserBrain::default();
        let vector = brain
            .time_vectors
            .get_mut(&TimeBucket::WeekdayEvening)
            .unwrap();
        for i in 0..12 {
            vector.topics.insert(format!("topic{i}"), 0.2);
        }
        migrate(&mut brain);
        assert_eq!(brain.time_bucket_counts[&TimeBucket::WeekdayEvening], 12);
        assert!(
            !brain
                .time_bucket_counts
                .contains_key(&TimeBucket::WeekdayMorning)
        );
    }

    #[test]
    fn anchors_become_picks() {
        let mut brain = UserBrain::default();
        let key = brain.key_spec().key_of("woodworking");
        brain.global_vector.anchor_topics.insert(key.clone());
        migrate(&mut brain);
        assert!(brain.global_vector.anchor_topics.is_empty());
        assert!(pick_keys(&brain).contains(&key));
    }

    #[test]
    fn a_hollow_vector_is_rehydrated_from_good_channels_only() {
        let mut brain = UserBrain::default();
        let spec = brain.key_spec();
        let good: HashMap<String, f64> =
            [(spec.key_of("sourdough"), 0.6), (spec.key_of("bread"), 0.4)].into();
        let bad: HashMap<String, f64> = [(spec.key_of("prank"), 0.9)].into();
        brain.channel_topic_profiles.insert("good".into(), good);
        brain.channel_topic_profiles.insert("bad".into(), bad);
        brain.channel_scores.insert("good".into(), 0.8);
        brain.channel_scores.insert("bad".into(), 0.1);
        migrate(&mut brain);
        assert!(
            (brain.global_vector.topics[&spec.key_of("sourdough")] - REHYDRATE_MAX_WEIGHT).abs()
                < 1e-12
        );
        assert!(
            !brain
                .global_vector
                .topics
                .contains_key(&spec.key_of("prank"))
        );
        assert!(!brain.topic_affinities.is_empty());
    }

    #[test]
    fn migrating_twice_changes_nothing_more() {
        let mut brain = UserBrain::default();
        brain.channel_topic_profiles.insert(
            "good".into(),
            [(brain.key_spec().key_of("chess"), 0.6)].into(),
        );
        migrate(&mut brain);
        let once = serde_json::to_string(&brain).unwrap();
        migrate(&mut brain);
        let twice: UserBrain =
            serde_json::from_str(&serde_json::to_string(&brain).unwrap()).unwrap();
        let once: UserBrain = serde_json::from_str(&once).unwrap();
        assert_eq!(once.global_vector.topics, twice.global_vector.topics);
        assert_eq!(once.topic_affinities, twice.topic_affinities);
    }
}
