//! What channels tell the brain beyond watches, ported from Flow for Android's
//! `NeuroChannelKnowledge` and its subscription handling: following a channel, and the recent
//! upload titles the subscriptions feed already downloaded, which say what each channel is about
//! without waiting for a click.

use std::collections::HashMap;

use crate::flow_neuro::features::{channel_topics, is_noise_topic, pick_keys};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::scoring::{CHANNEL_PROFILE_MAX_TOPICS, ContentVector, UserBrain};
use crate::flow_neuro::vector_math::{DECAY_REFERENCE_RATE, LONG_TERM, learn};

/// Ceiling for topics read from upload titles: inferred, so modest.
const PASSIVE_MAX_WEIGHT: f64 = 0.25;
const MAX_TOKENS: usize = 8;
/// Upload titles read per channel.
pub const UPLOAD_TITLES_PER_CHANNEL: usize = 6;
/// A subscription teaches its channel name about half what a full watch teaches.
const SUBSCRIPTION_RATE: f64 = 0.08;
const SUBSCRIBED_CHANNEL_SCORE: f64 = 0.65;
const NEUTRAL_CHANNEL_SCORE: f64 = 0.5;

/// A channel's identity from its recent upload titles. With three or more titles a word must
/// repeat: a word from one video is usually that video's, not the channel's.
#[must_use]
pub fn profile_from_upload_titles(titles: &[&str], spec: &KeySpec) -> HashMap<String, f64> {
    if titles.is_empty() {
        return HashMap::new();
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    for title in titles {
        let mut words = spec.chunk(title).words();
        words.sort();
        words.dedup();
        for word in words {
            if !is_noise_topic(&word, spec) {
                *counts.entry(word).or_insert(0) += 1;
            }
        }
    }
    let min_count = if titles.len() >= 3 { 2 } else { 1 };
    let mut identity: Vec<(String, usize)> = counts
        .into_iter()
        .filter(|(_, n)| *n >= min_count)
        .collect();
    let Some(max) = identity.iter().map(|(_, n)| *n).max() else {
        return HashMap::new();
    };
    identity.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    #[allow(clippy::cast_precision_loss)]
    identity
        .into_iter()
        .take(MAX_TOKENS)
        .map(|(token, n)| (token, PASSIVE_MAX_WEIGHT * n as f64 / max as f64))
        .collect()
}

/// Merges `additions` into a profile without lowering anything it learned.
pub fn merge_profile(profile: &mut HashMap<String, f64>, additions: HashMap<String, f64>) {
    for (topic, weight) in additions {
        let entry = profile.entry(topic).or_insert(weight);
        *entry = entry.max(weight);
    }
    if profile.len() > CHANNEL_PROFILE_MAX_TOPICS {
        let mut entries: Vec<(String, f64)> = profile.drain().collect();
        entries.sort_by(|a, b| b.1.total_cmp(&a.1));
        entries.truncate(CHANNEL_PROFILE_MAX_TOPICS);
        profile.extend(entries);
    }
}

/// Learns what the given channels are about from their upload titles.
pub fn learn_from_uploads(brain: &mut UserBrain, uploads: &HashMap<String, Vec<String>>) {
    let spec = brain.key_spec();
    for (channel_id, titles) in uploads {
        let titles: Vec<&str> = titles
            .iter()
            .take(UPLOAD_TITLES_PER_CHANNEL)
            .map(String::as_str)
            .collect();
        let additions = profile_from_upload_titles(&titles, &spec);
        if additions.is_empty() {
            continue;
        }
        let profile = brain
            .channel_topic_profiles
            .entry(channel_id.clone())
            .or_default();
        merge_profile(profile, additions);
    }
    crate::flow_neuro::caps::cap_channel_profiles(brain);
}

/// Following a channel lifts it and teaches the words of its name; unfollowing returns it to
/// neutral at most, since leaving a channel is not disliking it.
pub fn subscription_changed(
    brain: &mut UserBrain,
    channel_id: &str,
    channel_name: &str,
    subscribed: bool,
) {
    if channel_id.trim().is_empty() {
        return;
    }
    let current = brain
        .channel_scores
        .get(channel_id)
        .copied()
        .unwrap_or(NEUTRAL_CHANNEL_SCORE);
    if !subscribed {
        brain
            .channel_scores
            .insert(channel_id.to_string(), current.min(NEUTRAL_CHANNEL_SCORE));
        return;
    }
    brain.channel_scores.insert(
        channel_id.to_string(),
        current.max(SUBSCRIBED_CHANNEL_SCORE),
    );
    brain.suppressed_channels.remove(channel_id);
    let name_words: HashMap<String, f64> = channel_topics(channel_name, &brain.key_spec())
        .into_iter()
        .map(|word| (word, 0.5))
        .collect();
    if name_words.is_empty() {
        return;
    }
    let picks = pick_keys(brain);
    brain.global_vector = learn(
        &brain.global_vector,
        &ContentVector {
            topics: name_words,
            ..ContentVector::default()
        },
        SUBSCRIPTION_RATE / DECAY_REFERENCE_RATE,
        LONG_TERM,
        SUBSCRIPTION_RATE,
        &picks,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_titles_keep_only_the_words_a_channel_repeats() {
        let spec = KeySpec::default();
        let titles = [
            "Sourdough starter from scratch",
            "My sourdough bread every week",
            "Baking a rye sourdough loaf",
        ];
        let profile = profile_from_upload_titles(&titles, &spec);
        let sourdough = spec.key_of("sourdough");
        assert!((profile[&sourdough] - PASSIVE_MAX_WEIGHT).abs() < 1e-12);
        assert!(!profile.contains_key(&spec.key_of("starter")));
    }

    #[test]
    fn subscribing_lifts_the_channel_and_teaches_its_name() {
        let mut brain = UserBrain::default();
        brain.suppressed_channels.insert("UC1".into(), 1);
        subscription_changed(&mut brain, "UC1", "Woodworking Weekly", true);
        assert!((brain.channel_scores["UC1"] - SUBSCRIBED_CHANNEL_SCORE).abs() < 1e-12);
        assert!(brain.suppressed_channels.is_empty());
        assert!(
            brain
                .global_vector
                .topics
                .contains_key(&brain.key_spec().key_of("woodworking"))
        );
        assert_eq!(brain.total_interactions, 0);

        subscription_changed(&mut brain, "UC1", "Woodworking Weekly", false);
        assert!((brain.channel_scores["UC1"] - NEUTRAL_CHANNEL_SCORE).abs() < 1e-12);
    }

    #[test]
    fn a_learned_profile_is_never_lowered() {
        let mut profile: HashMap<String, f64> = [("chess".to_string(), 0.6)].into();
        merge_profile(&mut profile, [("chess".to_string(), 0.2)].into());
        assert!((profile["chess"] - 0.6).abs() < 1e-12);
    }
}
