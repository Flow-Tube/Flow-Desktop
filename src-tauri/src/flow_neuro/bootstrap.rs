//! Seeds a brain from an imported watch history or subscription list, the way Flow for Android
//! does (`FlowNeuroEngine.bootstrapFromWatchHistory` / `bootstrapFromSubscriptions`). An import
//! is evidence of taste, not a stream of real watches, so it learns gently and never counts as
//! months of use.

use serde::Deserialize;
use std::collections::HashMap;

use crate::flow_neuro::features::{
    TopicReader, VideoText, document_terms, extract_features, pick_keys,
};
use crate::flow_neuro::scoring::{
    AFFINITY_MAX, CHANNEL_EMA_ALPHA, CHANNEL_EMA_DECAY, ESTABLISHED_TOPIC_THRESHOLD, IdfSnapshot,
    ONBOARDING_WARMUP_INTERACTIONS, TopicEvidence, UserBrain,
};
use crate::flow_neuro::signals::make_affinity_key;
use crate::flow_neuro::vector_math::{DECAY_REFERENCE_RATE, LONG_TERM, learn};

const HISTORY_MAX_VIDEOS: usize = 500;
const HISTORY_MAX_PER_CHANNEL: usize = 20;
const HISTORY_RATE: f64 = 0.035;
const HISTORY_RATE_MATURE: f64 = 0.015;
const HISTORY_AFFINITY_INCREMENT: f64 = 0.01;
const HISTORY_AFFINITY_TOP_TOPICS: usize = 3;
const HISTORY_EVIDENCE_SIGNAL: f64 = 0.25;
/// The share a bootstrapped video counts as watched, so it is not recommended straight back.
const HISTORY_WATCHED_SHARE: f32 = 0.5;

const SUBSCRIPTION_SEED_WEIGHT: f64 = 0.25;
/// A subscription list carries no dates, so seeds stay below the established tier and watching
/// decides which of them last.
const SUBSCRIPTION_SEED_CAP: f64 = ESTABLISHED_TOPIC_THRESHOLD - 0.01;
const SUBSCRIPTION_TOP_KEYWORDS: usize = 15;
const SUBSCRIPTION_AFFINITY_INCREMENT: f64 = 0.15;

/// One imported watch-history entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedVideo {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub duration_seconds: Option<u64>,
    /// Epoch ms the video was watched; newer entries teach more.
    pub watched_at: i64,
    #[serde(default)]
    pub is_music: bool,
}

/// The entries an import learns from: newest first, no music, at most 20 per channel and 500 in
/// all, so one binge-watched channel cannot become the whole profile.
fn learnable(videos: Vec<ImportedVideo>) -> Vec<ImportedVideo> {
    let mut videos: Vec<ImportedVideo> = videos
        .into_iter()
        .filter(|video| {
            !video.is_music && !video.video_id.trim().is_empty() && !video.title.trim().is_empty()
        })
        .collect();
    videos.sort_by_key(|video| std::cmp::Reverse(video.watched_at));
    let mut seen = std::collections::HashSet::new();
    let mut per_channel: HashMap<String, usize> = HashMap::new();
    videos
        .into_iter()
        .filter(|video| seen.insert(video.video_id.clone()))
        .filter(|video| {
            let channel = video
                .channel_id
                .clone()
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| video.channel_name.clone());
            if channel.is_empty() {
                return true;
            }
            let count = per_channel.entry(channel).or_insert(0);
            *count += 1;
            *count <= HISTORY_MAX_PER_CHANNEL
        })
        .take(HISTORY_MAX_VIDEOS)
        .collect()
}

/// Links among an imported video's top topics, and positive evidence for them.
fn learn_imported_links_and_evidence(
    brain: &mut UserBrain,
    vector: &crate::flow_neuro::scoring::ContentVector,
    video_id: &str,
    channel_id: &str,
    now_ms: u64,
) {
    let mut top: Vec<(&String, &f64)> = vector.topics.iter().collect();
    top.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top: Vec<&String> = top
        .into_iter()
        .take(HISTORY_AFFINITY_TOP_TOPICS)
        .map(|(key, _)| key)
        .collect();
    for i in 0..top.len() {
        for j in i + 1..top.len() {
            let key = make_affinity_key(top[i], top[j]);
            let current = brain.topic_affinities.get(&key).copied().unwrap_or(0.0);
            brain.topic_affinities.insert(
                key,
                (current + HISTORY_AFFINITY_INCREMENT).min(AFFINITY_MAX),
            );
        }
    }
    for key in top {
        let evidence: &mut TopicEvidence = brain.topic_evidence.entry(key.clone()).or_default();
        evidence.positive_signals += 1;
        evidence.positive_score = (evidence.positive_score + HISTORY_EVIDENCE_SIGNAL).min(50.0);
        evidence.video_ids.insert(video_id.to_string());
        evidence.channel_ids.insert(channel_id.to_string());
        if evidence.first_seen_at == 0 {
            evidence.first_seen_at = now_ms;
        }
        evidence.last_seen_at = now_ms;
    }
}

/// Learns from an imported watch history. Returns how many videos it learned from.
pub fn bootstrap_from_history(brain: &mut UserBrain, videos: Vec<ImportedVideo>) -> usize {
    let videos = learnable(videos);
    if videos.is_empty() {
        return 0;
    }
    let mature = brain.total_interactions > 50 && brain.global_vector.topics.len() > 10;
    let rate = if mature {
        HISTORY_RATE_MATURE
    } else {
        HISTORY_RATE
    };
    let spec = brain.key_spec();
    let picks = pick_keys(brain);
    let now_ms = chrono::Utc::now().timestamp_millis().cast_unsigned();

    for (index, video) in videos.iter().enumerate() {
        let idf = IdfSnapshot {
            word_frequencies: brain.idf_word_frequency.clone(),
            total_documents: brain.idf_total_documents,
        };
        let vector = extract_features(
            &VideoText {
                title: &video.title,
                channel_name: &video.channel_name,
                description: None,
                duration_seconds: video.duration_seconds,
                is_live: false,
                is_short: false,
            },
            &TopicReader {
                spec: spec.clone(),
                idf: &idf,
            },
        );
        #[allow(clippy::cast_precision_loss)]
        let index_decay = 1.0 - (index as f64 / HISTORY_MAX_VIDEOS as f64 * 0.4);
        let effective_rate = rate * index_decay.clamp(0.6, 1.0);
        brain.global_vector = learn(
            &brain.global_vector,
            &vector,
            effective_rate / DECAY_REFERENCE_RATE,
            LONG_TERM,
            effective_rate,
            &picks,
        );

        let channel_id = video
            .channel_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| video.video_id.clone());
        let score = brain
            .channel_scores
            .get(&channel_id)
            .copied()
            .unwrap_or(0.5);
        brain.channel_scores.insert(
            channel_id.clone(),
            score * CHANNEL_EMA_DECAY + CHANNEL_EMA_ALPHA,
        );

        learn_imported_links_and_evidence(brain, &vector, &video.video_id, &channel_id, now_ms);

        if brain.counted_documents.insert(&video.video_id) {
            for term in document_terms(&video.title, &vector, &spec) {
                *brain.idf_word_frequency.entry(term).or_insert(0) += 1;
            }
            brain.idf_total_documents += 1;
        }
        brain
            .watch_history_map
            .entry(video.video_id.clone())
            .or_insert(HISTORY_WATCHED_SHARE);
    }

    // An import ends cold start and warm-up but no more: counting every imported video as an
    // interaction would damp all later learning as if Flow had been used for months.
    let learned = videos.len();
    brain.total_interactions += i32::try_from(learned)
        .unwrap_or(i32::MAX)
        .min(ONBOARDING_WARMUP_INTERACTIONS);
    brain.has_completed_onboarding = true;
    learned
}

/// Seeds topics from the words in subscribed channel names, unless the brain already learned
/// something. Channel-name words are inferred, so they never become the viewer's own picks.
/// Returns how many topics it seeded.
pub fn bootstrap_from_subscriptions(brain: &mut UserBrain, channel_names: &[String]) -> usize {
    if brain.total_interactions > 5 && !brain.global_vector.topics.is_empty() {
        return 0;
    }
    let spec = brain.key_spec();
    let mut mentions: HashMap<String, usize> = HashMap::new();
    for name in channel_names {
        for word in spec.chunk(name).words() {
            *mentions.entry(word).or_insert(0) += 1;
        }
    }
    if mentions.is_empty() {
        return 0;
    }

    for (key, count) in &mentions {
        #[allow(clippy::cast_precision_loss)]
        let weight = (*count as f64 * SUBSCRIPTION_SEED_WEIGHT).min(SUBSCRIPTION_SEED_CAP);
        let current = brain.global_vector.topics.entry(key.clone()).or_insert(0.0);
        *current = current.max(weight);
    }

    let mut ranked: Vec<(&String, &usize)> = mentions.iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
    let top: Vec<&String> = ranked
        .into_iter()
        .take(SUBSCRIPTION_TOP_KEYWORDS)
        .map(|(key, _)| key)
        .collect();
    for i in 0..top.len() {
        for j in i + 1..top.len() {
            let key = make_affinity_key(top[i], top[j]);
            let current = brain.topic_affinities.get(&key).copied().unwrap_or(0.0);
            brain.topic_affinities.insert(
                key,
                (current + SUBSCRIPTION_AFFINITY_INCREMENT).min(AFFINITY_MAX),
            );
        }
    }
    brain.has_completed_onboarding = true;
    mentions.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watched(id: &str, title: &str, channel: &str, watched_at: i64) -> ImportedVideo {
        ImportedVideo {
            video_id: id.into(),
            title: title.into(),
            channel_name: channel.into(),
            channel_id: Some(format!("UC{channel}")),
            duration_seconds: Some(600),
            watched_at,
            is_music: false,
        }
    }

    #[test]
    fn history_learns_gently_and_counts_at_most_warm_up() {
        let mut brain = UserBrain::default();
        let videos: Vec<ImportedVideo> = (0..120)
            .map(|i| {
                watched(
                    &format!("v{i}"),
                    "Rust compiler internals explained",
                    &format!("c{}", i % 10),
                    i,
                )
            })
            .collect();
        let learned = bootstrap_from_history(&mut brain, videos);
        assert_eq!(learned, 120);
        assert_eq!(brain.total_interactions, ONBOARDING_WARMUP_INTERACTIONS);
        assert!(brain.has_completed_onboarding);
        assert!(!brain.global_vector.topics.is_empty());
        assert!(brain.preferred_topics.is_empty());
        assert_eq!(brain.watch_history_map.len(), 120);
    }

    #[test]
    fn history_skips_music_and_caps_each_channel() {
        let mut brain = UserBrain::default();
        let mut videos: Vec<ImportedVideo> = (0..30)
            .map(|i| watched(&format!("v{i}"), "Woodworking joinery basics", "one", i))
            .collect();
        let mut song = watched("song", "A song", "Artist - Topic", 100);
        song.is_music = true;
        videos.push(song);
        assert_eq!(
            bootstrap_from_history(&mut brain, videos),
            HISTORY_MAX_PER_CHANNEL
        );
        assert!(!brain.watch_history_map.contains_key("song"));
    }

    #[test]
    fn subscriptions_seed_below_the_established_tier() {
        let mut brain = UserBrain::default();
        let names: Vec<String> = [
            "Chess Openings Daily",
            "Chess Endgames",
            "Chess Club",
            "Chess Talk",
        ]
        .iter()
        .map(|name| (*name).to_string())
        .collect();
        assert!(bootstrap_from_subscriptions(&mut brain, &names) > 0);
        assert!(
            brain
                .global_vector
                .topics
                .values()
                .all(|w| *w <= SUBSCRIPTION_SEED_CAP)
        );
        assert!(brain.preferred_topics.is_empty());
        assert!(brain.has_completed_onboarding);
    }

    #[test]
    fn subscriptions_leave_a_learned_brain_alone() {
        let mut brain = UserBrain {
            total_interactions: 20,
            ..UserBrain::default()
        };
        brain.global_vector.topics.insert("rust".into(), 0.6);
        assert_eq!(
            bootstrap_from_subscriptions(&mut brain, &["Chess Club".to_string()]),
            0
        );
        assert_eq!(brain.global_vector.topics.len(), 1);
    }
}
