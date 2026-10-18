use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use tracing::warn;

use crate::db::settings;
use crate::errors::AppResult;
use crate::flow_neuro::features::{TopicReader, VideoText, document_terms, extract_features};
use crate::flow_neuro::language::system_language;
use crate::flow_neuro::scoring::{
    AFFINITY_INCREMENT, AFFINITY_KEEP_TOP, AFFINITY_MAX, AFFINITY_MAX_ENTRIES,
    AFFINITY_PRUNE_THRESHOLD, CHANNEL_EMA_ALPHA, CHANNEL_EMA_DECAY, CHANNEL_INFERRED_BLOCK_DAYS,
    CHANNEL_KEEP_HIGH, CHANNEL_KEEP_LOW, CHANNEL_PROFILE_LEARNING_RATE,
    CHANNEL_PROFILE_MAX_CHANNELS, CHANNEL_PROFILE_MAX_TOPICS, CHANNEL_PROFILE_PRUNE_THRESHOLD,
    CHANNEL_SUPPRESSION_DAYS, ChannelStrike, ContentVector, IDF_KEEP_KEYS, IDF_MAX_KEYS,
    IdfSnapshot, MAX_CHANNEL_SCORES, MAX_CHANNEL_STRIKES, MAX_CONSECUTIVE_SKIPS,
    MAX_SUPPRESSED_CHANNELS, MAX_SUPPRESSED_VIDEOS, NOT_INTERESTED_SKIP_INCREMENT,
    PERSONA_MAX_STABILITY, REJECTION_EXPIRY_DAYS, REJECTION_MEMORY_MAX, RejectionSignal,
    TOPIC_EVIDENCE_MAX_ENTRIES, TOPIC_EVIDENCE_MAX_IDS, TimeBucket, TopicEvidence, UserBrain,
    VIDEO_SUPPRESSION_DAYS, WATCH_HISTORY_MAX, WATCHED_THRESHOLD_FULL, WATCHED_THRESHOLD_SAMPLED,
    adjust_vector, apply_anchor_decay, classify_persona, extract_rejection_keys, strip_domain_tag,
};

pub const SHORTS_LEARNING_PENALTY: f64 = 0.40;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum InteractionType {
    Click,
    Liked,
    Watched,
    Skipped,
    Disliked,
}

impl InteractionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Click => "CLICK",
            Self::Liked => "LIKED",
            Self::Watched => "WATCHED",
            Self::Skipped => "SKIPPED",
            Self::Disliked => "DISLIKED",
        }
    }
}

/// The key of a link between two topics, the way Flow for Android writes it ("a|b", in order).
pub fn make_affinity_key(t1: &str, t2: &str) -> String {
    if t1 < t2 {
        format!("{t1}|{t2}")
    } else {
        format!("{t2}|{t1}")
    }
}

fn should_learn_from_watch(existing_progress: f32, next_progress: f32) -> bool {
    const MIN_PROGRESS_DELTA: f32 = 0.15;
    const WATCH_MILESTONES: [f32; 4] = [
        WATCHED_THRESHOLD_SAMPLED,
        0.40,
        0.65,
        WATCHED_THRESHOLD_FULL,
    ];

    if next_progress <= existing_progress {
        return false;
    }

    if (next_progress - existing_progress) >= MIN_PROGRESS_DELTA {
        return true;
    }

    WATCH_MILESTONES
        .iter()
        .any(|milestone| existing_progress < *milestone && next_progress >= *milestone)
}

fn calculate_topic_evidence_signal(
    interaction_type: InteractionType,
    percent_watched: f32,
    is_short: bool,
) -> f64 {
    let base = match interaction_type {
        InteractionType::Click => 0.20,
        InteractionType::Liked => 2.0,
        InteractionType::Watched => {
            if percent_watched >= WATCHED_THRESHOLD_FULL {
                1.5
            } else if percent_watched >= 0.40 {
                1.0
            } else if percent_watched >= WATCHED_THRESHOLD_SAMPLED {
                0.35
            } else {
                0.0
            }
        }
        InteractionType::Skipped | InteractionType::Disliked => 0.0,
    };

    if is_short { base * 0.35 } else { base }
}

fn capped_set(existing: &HashSet<String>, value: &str) -> HashSet<String> {
    if value.is_empty() || existing.contains(value) {
        return existing.clone();
    }

    let mut values: Vec<String> = existing.iter().cloned().collect();
    values.push(value.to_string());
    values
        .into_iter()
        .rev()
        .take(TOPIC_EVIDENCE_MAX_IDS)
        .collect()
}

fn update_topic_evidence(
    current: &HashMap<String, TopicEvidence>,
    video_vector: &ContentVector,
    video_id: &str,
    channel_id: &str,
    signal_score: f64,
    is_watch_signal: bool,
    is_explicit_signal: bool,
) -> HashMap<String, TopicEvidence> {
    if signal_score <= 0.0 {
        return current.clone();
    }

    let now = chrono::Utc::now().timestamp_millis() as u64;
    let mut top_topics: Vec<(String, f64)> = video_vector
        .topics
        .iter()
        .map(|(topic, score)| (strip_domain_tag(topic), *score))
        .filter(|(topic, _)| topic.len() >= 3)
        .collect();
    top_topics.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top_topics: Vec<String> = top_topics
        .into_iter()
        .map(|(topic, _)| topic)
        .take(5)
        .collect();

    if top_topics.is_empty() {
        return current.clone();
    }

    let mut updated = current.clone();
    for topic in top_topics {
        let existing = updated.get(&topic).cloned().unwrap_or_default();
        updated.insert(
            topic,
            TopicEvidence {
                positive_signals: existing.positive_signals + 1,
                negative_signals: existing.negative_signals,
                watch_signals: existing.watch_signals + if is_watch_signal { 1 } else { 0 },
                explicit_signals: existing.explicit_signals
                    + if is_explicit_signal { 1 } else { 0 },
                positive_score: (existing.positive_score + signal_score).min(50.0),
                video_ids: capped_set(&existing.video_ids, video_id),
                channel_ids: capped_set(&existing.channel_ids, channel_id),
                first_seen_at: if existing.first_seen_at > 0 {
                    existing.first_seen_at
                } else {
                    now
                },
                last_seen_at: now,
            },
        );
    }

    if updated.len() <= TOPIC_EVIDENCE_MAX_ENTRIES {
        updated
    } else {
        let mut entries: Vec<(String, TopicEvidence)> = updated.into_iter().collect();
        entries.sort_by(|a, b| {
            b.1.positive_score
                .partial_cmp(&a.1.positive_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.1.last_seen_at.cmp(&a.1.last_seen_at))
        });
        entries
            .into_iter()
            .take(TOPIC_EVIDENCE_MAX_ENTRIES)
            .collect()
    }
}

pub async fn get_or_create_brain(pool: &SqlitePool) -> AppResult<UserBrain> {
    if let Some(json_str) = settings::get_setting(pool, "user_neuro_brain").await? {
        match serde_json::from_str::<UserBrain>(&json_str) {
            Ok(mut brain) => {
                let mut changed =
                    brain.schema_version != crate::flow_neuro::scoring::SCHEMA_VERSION;
                brain.schema_version = crate::flow_neuro::scoring::SCHEMA_VERSION;
                changed |= brain.settle_languages(&system_language());
                if changed {
                    save_brain(pool, &brain).await?;
                }
                return Ok(brain);
            }
            Err(error) => {
                warn!(
                    error = %error,
                    "[FlowNeuro] Stored brain failed to deserialize; preserving raw setting instead of overwriting it"
                );
                return Ok(UserBrain::default());
            }
        }
    }
    let mut default_brain = UserBrain::default();
    default_brain.settle_languages(&system_language());
    let json_str = serde_json::to_string(&default_brain).unwrap();
    settings::set_setting(pool, "user_neuro_brain", &json_str).await?;
    Ok(default_brain)
}

pub async fn save_brain(pool: &SqlitePool, brain: &UserBrain) -> AppResult<()> {
    let json_str = serde_json::to_string(brain).unwrap();
    settings::set_setting(pool, "user_neuro_brain", &json_str).await?;
    Ok(())
}

/// Result of applying one interaction to the brain. `learning_rate` is `None` when a
/// watch progress update was deduped (no learning); `primary_topic` feeds session state.
pub struct InteractionOutcome {
    pub learning_rate: Option<f64>,
    pub primary_topic: Option<String>,
}

fn prune_channel_strikes(brain: &mut UserBrain, now_ms: u64) {
    let cutoff = now_ms.saturating_sub(CHANNEL_INFERRED_BLOCK_DAYS * 86_400_000);
    brain
        .channel_strikes
        .retain(|_, strike| strike.last_at >= cutoff);
    if brain.channel_strikes.len() > MAX_CHANNEL_STRIKES {
        let mut entries: Vec<(String, u64)> = brain
            .channel_strikes
            .iter()
            .map(|(id, strike)| (id.clone(), strike.last_at))
            .collect();
        entries.sort_by(|a, b| a.1.cmp(&b.1));
        let removable: Vec<String> = entries
            .into_iter()
            .take(brain.channel_strikes.len() - MAX_CHANNEL_STRIKES)
            .map(|(id, _)| id)
            .collect();
        for id in removable {
            brain.channel_strikes.remove(&id);
        }
    }
}

/// Records an explicit dislike as negative evidence on already-tracked topics, so exploration
/// stops boosting interests the user has now pushed back on. Never creates new entries.
fn record_negative_topic_evidence(
    topic_evidence: &mut HashMap<String, TopicEvidence>,
    video_vector: &ContentVector,
    now_ms: u64,
) {
    let mut top: Vec<(String, f64)> = video_vector
        .topics
        .iter()
        .map(|(topic, score)| (strip_domain_tag(topic), *score))
        .filter(|(topic, _)| topic.len() >= 3)
        .collect();
    top.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    for (topic, _) in top.into_iter().take(5) {
        if let Some(entry) = topic_evidence.get_mut(&topic) {
            entry.negative_signals += 1;
            entry.last_seen_at = now_ms;
        }
    }
}

/// Applies one interaction to the in-memory brain (pure mutation, no I/O); persistence and
/// event logging are handled by the caller against the resident `BrainStore`.
pub fn apply_interaction(
    brain: &mut UserBrain,
    video_id: &str,
    title: &str,
    channel_name: &str,
    channel_id: &str,
    description: Option<&str>,
    duration_sec: Option<u64>,
    is_live: bool,
    is_short: bool,
    interaction_type: InteractionType,
    percent_watched: f32,
) -> InteractionOutcome {
    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
    let clamped_percent = percent_watched.clamp(0.0, 1.0);
    let existing_watch_progress = brain
        .watch_signal_progress
        .get(video_id)
        .copied()
        .unwrap_or(0.0);
    let should_apply_watch_learning = interaction_type != InteractionType::Watched
        || should_learn_from_watch(existing_watch_progress, clamped_percent);

    if interaction_type == InteractionType::Watched && clamped_percent > existing_watch_progress {
        brain
            .watch_signal_progress
            .insert(video_id.to_string(), clamped_percent);
        if brain.watch_signal_progress.len() > WATCH_HISTORY_MAX {
            if let Some(oldest_key) = brain.watch_signal_progress.keys().next().cloned() {
                brain.watch_signal_progress.remove(&oldest_key);
            }
        }
    }

    if interaction_type == InteractionType::Watched && !should_apply_watch_learning {
        return InteractionOutcome {
            learning_rate: None,
            primary_topic: None,
        };
    }

    let idf_snapshot = IdfSnapshot {
        word_frequencies: brain.idf_word_frequency.clone(),
        total_documents: brain.idf_total_documents,
    };

    let spec = brain.key_spec();
    let video_vector = extract_features(
        &VideoText {
            title,
            channel_name,
            description,
            duration_seconds: duration_sec,
            is_live,
            is_short,
        },
        &TopicReader {
            spec: spec.clone(),
            idf: &idf_snapshot,
        },
    );

    let primary_topic = video_vector
        .topics
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(topic, _)| topic.clone());

    let mut learning_rate = match interaction_type {
        InteractionType::Click => 0.10,
        InteractionType::Liked => 0.30,
        InteractionType::Watched => {
            let base_watch_rate = 0.15 * (clamped_percent as f64);
            let abs_duration_min = duration_sec.unwrap_or(0) as f64 / 60.0;
            let absolute_minutes_watched = clamped_percent as f64 * abs_duration_min;
            let time_bonus = (1.0 + absolute_minutes_watched).ln() / (61.0_f64).ln() * 0.08;
            base_watch_rate + time_bonus
        }
        InteractionType::Skipped => -0.15,
        InteractionType::Disliked => -0.40,
    };

    if is_short {
        learning_rate *= SHORTS_LEARNING_PENALTY;
    }

    if interaction_type == InteractionType::Watched && learning_rate > 0.0 {
        brain.vote_language(title, description);
    }

    let topic_evidence_signal =
        calculate_topic_evidence_signal(interaction_type, clamped_percent, is_short);

    // 1. Update global vector
    let mut new_global = adjust_vector(&brain.global_vector, &video_vector, learning_rate);
    if interaction_type == InteractionType::Watched {
        apply_anchor_decay(&mut new_global, brain.total_interactions + 1);
    }

    // 2. Update time bucket vector
    let current_bucket = TimeBucket::current();
    let current_bucket_vec = brain
        .time_vectors
        .get(&current_bucket)
        .cloned()
        .unwrap_or_default();
    let new_bucket_vec = adjust_vector(&current_bucket_vec, &video_vector, learning_rate * 1.5);
    brain.time_vectors.insert(current_bucket, new_bucket_vec);

    // 3. Channel score
    let current_ch_score = *brain.channel_scores.get(channel_id).unwrap_or(&0.5);
    let outcome = if learning_rate > 0.0 { 1.0 } else { 0.0 };
    let new_ch_score = (current_ch_score * CHANNEL_EMA_DECAY) + (outcome * CHANNEL_EMA_ALPHA);
    brain
        .channel_scores
        .insert(channel_id.to_string(), new_ch_score);

    // Channel pruning
    if brain.channel_scores.len() > MAX_CHANNEL_SCORES {
        let mut sorted: Vec<(String, f64)> = brain.channel_scores.clone().into_iter().collect();
        sorted.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        let keep_low: Vec<(String, f64)> = sorted.iter().take(CHANNEL_KEEP_LOW).cloned().collect();
        let keep_high: Vec<(String, f64)> = sorted
            .iter()
            .rev()
            .take(CHANNEL_KEEP_HIGH)
            .cloned()
            .collect();

        let mut new_channel_scores = HashMap::new();
        for (k, v) in keep_low.into_iter().chain(keep_high.into_iter()) {
            new_channel_scores.insert(k, v);
        }
        brain.channel_scores = new_channel_scores;
    }

    // 4. Consecutive skips (explicit dislikes weigh heavier toward boredom than implicit skips)
    let new_skips = match interaction_type {
        InteractionType::Click | InteractionType::Liked | InteractionType::Watched => 0,
        InteractionType::Skipped => (brain.consecutive_skips + 1).min(MAX_CONSECUTIVE_SKIPS),
        InteractionType::Disliked => {
            (brain.consecutive_skips + NOT_INTERESTED_SKIP_INCREMENT).min(MAX_CONSECUTIVE_SKIPS)
        }
    };
    brain.consecutive_skips = new_skips;

    // 5. Topic co-occurrence
    if learning_rate > 0.0 {
        let mut top_topics: Vec<(String, f64)> = video_vector.topics.clone().into_iter().collect();
        top_topics.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top_topics: Vec<String> = top_topics.into_iter().take(5).map(|(k, _)| k).collect();

        if top_topics.len() >= 2 {
            for i in 0..top_topics.len() {
                for j in i + 1..top_topics.len() {
                    let key = make_affinity_key(&top_topics[i], &top_topics[j]);
                    let current = *brain.topic_affinities.get(&key).unwrap_or(&0.0);
                    let new_val = (current + AFFINITY_INCREMENT).min(AFFINITY_MAX);
                    brain.topic_affinities.insert(key, new_val);
                }
            }
            brain
                .topic_affinities
                .retain(|_, &mut v| v > AFFINITY_PRUNE_THRESHOLD);
            if brain.topic_affinities.len() > AFFINITY_MAX_ENTRIES {
                let mut sorted: Vec<(String, f64)> =
                    brain.topic_affinities.clone().into_iter().collect();
                sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                brain.topic_affinities = sorted.into_iter().take(AFFINITY_KEEP_TOP).collect();
            }
        }
    }

    // 6. Document frequency counts each video once, so pair counts can say what is a phrase.
    if learning_rate > 0.0 && brain.counted_documents.insert(video_id.to_string()) {
        for term in document_terms(title, &video_vector, &spec) {
            *brain.idf_word_frequency.entry(term).or_insert(0) += 1;
        }
        brain.idf_total_documents += 1;

        if brain.idf_total_documents > 10000 {
            for v in brain.idf_word_frequency.values_mut() {
                *v /= 2;
            }
            brain.idf_word_frequency.retain(|_, &mut v| v > 0);
            brain.idf_total_documents /= 2;
        }

        if brain.idf_word_frequency.len() > IDF_MAX_KEYS {
            let mut entries: Vec<(String, i32)> = brain.idf_word_frequency.drain().collect();
            entries.sort_by(|a, b| b.1.cmp(&a.1));
            entries.truncate(IDF_KEEP_KEYS);
            brain.idf_word_frequency = entries.into_iter().collect();
        }
    }

    // 7. Persona tracking
    let raw_persona = classify_persona(&brain);
    let raw_persona_name = raw_persona.name().to_string();
    let new_stability = if Some(raw_persona_name.clone()) == brain.last_persona {
        (brain.persona_stability + 1).min(PERSONA_MAX_STABILITY)
    } else {
        1
    };
    brain.last_persona = Some(raw_persona_name);
    brain.persona_stability = new_stability;

    // 8. Watch history persistence
    if interaction_type == InteractionType::Watched && clamped_percent > WATCHED_THRESHOLD_SAMPLED {
        let existing = brain
            .watch_history_map
            .get(video_id)
            .cloned()
            .unwrap_or(0.0);
        if clamped_percent > existing {
            brain
                .watch_history_map
                .insert(video_id.to_string(), clamped_percent);

            // Keep watch history size restricted
            if brain.watch_history_map.len() > WATCH_HISTORY_MAX {
                // Find and remove oldest or just a key to satisfy capacity bounds.
                // In Rust HashMap, we can just remove the first key as a simple FIFO/LRU approximation
                // if we don't store exact watch timestamps, or we can just retain a random subset.
                if let Some(oldest_key) = brain.watch_history_map.keys().next().cloned() {
                    brain.watch_history_map.remove(&oldest_key);
                }
            }
        }
    }

    if learning_rate > 0.0 {
        let mut existing_profile = brain
            .channel_topic_profiles
            .get(channel_id)
            .cloned()
            .unwrap_or_default();

        for (topic, weight) in &video_vector.topics {
            let current = *existing_profile.get(topic).unwrap_or(&0.0);
            existing_profile.insert(
                topic.clone(),
                current + (weight - current) * CHANNEL_PROFILE_LEARNING_RATE,
            );
        }

        for (topic, value) in existing_profile.clone() {
            if !video_vector.topics.contains_key(&topic) {
                let decayed = value * 0.98;
                if decayed < CHANNEL_PROFILE_PRUNE_THRESHOLD {
                    existing_profile.remove(&topic);
                } else {
                    existing_profile.insert(topic, decayed);
                }
            }
        }

        if existing_profile.len() > CHANNEL_PROFILE_MAX_TOPICS {
            let mut entries: Vec<(String, f64)> = existing_profile.into_iter().collect();
            entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            existing_profile = entries
                .into_iter()
                .take(CHANNEL_PROFILE_MAX_TOPICS)
                .collect();
        }

        brain
            .channel_topic_profiles
            .insert(channel_id.to_string(), existing_profile);

        if brain.channel_topic_profiles.len() > CHANNEL_PROFILE_MAX_CHANNELS {
            let mut removable: Vec<String> = brain.channel_topic_profiles.keys().cloned().collect();
            removable.sort_by(|a, b| {
                brain
                    .channel_scores
                    .get(a)
                    .unwrap_or(&0.0)
                    .partial_cmp(brain.channel_scores.get(b).unwrap_or(&0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let removable: Vec<String> = removable
                .into_iter()
                .take(brain.channel_topic_profiles.len() - CHANNEL_PROFILE_MAX_CHANNELS)
                .collect();
            for channel in removable {
                brain.channel_topic_profiles.remove(&channel);
            }
        }

        brain.topic_evidence = update_topic_evidence(
            &brain.topic_evidence,
            &video_vector,
            video_id,
            channel_id,
            topic_evidence_signal,
            interaction_type == InteractionType::Watched && clamped_percent >= 0.40,
            interaction_type == InteractionType::Liked,
        );
    }

    if matches!(
        interaction_type,
        InteractionType::Skipped | InteractionType::Disliked
    ) {
        brain
            .suppressed_video_ids
            .insert(video_id.to_string(), now_ms);
        if brain.suppressed_video_ids.len() > MAX_SUPPRESSED_VIDEOS {
            let cutoff = now_ms.saturating_sub(VIDEO_SUPPRESSION_DAYS * 86_400_000);
            brain.suppressed_video_ids.retain(|_, ts| *ts >= cutoff);
        }
    }

    if interaction_type == InteractionType::Disliked {
        record_negative_topic_evidence(&mut brain.topic_evidence, &video_vector, now_ms);

        if !channel_id.is_empty() {
            if brain.suppressed_channels.contains_key(channel_id) {
                brain.blocked_channels.insert(channel_id.to_string());
                brain.suppressed_channels.remove(channel_id);
                brain.channel_strikes.remove(channel_id);
            } else {
                brain
                    .suppressed_channels
                    .insert(channel_id.to_string(), now_ms);
            }
            if brain.suppressed_channels.len() > MAX_SUPPRESSED_CHANNELS {
                let cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * 86_400_000);
                brain.suppressed_channels.retain(|_, ts| *ts >= cutoff);
            }

            let strike = brain
                .channel_strikes
                .entry(channel_id.to_string())
                .or_insert(ChannelStrike {
                    count: 0,
                    first_at: now_ms,
                    last_at: now_ms,
                });
            strike.count += 1;
            strike.last_at = now_ms;
            prune_channel_strikes(brain, now_ms);

            let current = *brain.channel_scores.get(channel_id).unwrap_or(&0.5);
            brain
                .channel_scores
                .insert(channel_id.to_string(), (current * 0.10).max(0.01));
        }

        for key in extract_rejection_keys(&video_vector) {
            let existing = brain
                .rejection_patterns
                .get(&key)
                .cloned()
                .unwrap_or_default();
            brain.rejection_patterns.insert(
                key,
                RejectionSignal {
                    count: existing.count + 1,
                    last_rejected_at: now_ms,
                },
            );
        }

        let pattern_cutoff = now_ms.saturating_sub(REJECTION_EXPIRY_DAYS * 86_400_000);
        brain
            .rejection_patterns
            .retain(|_, signal| signal.last_rejected_at >= pattern_cutoff);
        if brain.rejection_patterns.len() > REJECTION_MEMORY_MAX {
            let mut entries: Vec<(String, RejectionSignal)> = brain
                .rejection_patterns
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.last_rejected_at.cmp(&b.1.last_rejected_at));
            let removable: Vec<String> = entries
                .into_iter()
                .take(brain.rejection_patterns.len() - REJECTION_MEMORY_MAX)
                .map(|(key, _)| key)
                .collect();
            for key in removable {
                brain.rejection_patterns.remove(&key);
            }
        }
    }

    brain.total_interactions += 1;
    brain.global_vector = new_global;

    InteractionOutcome {
        learning_rate: Some(learning_rate),
        primary_topic,
    }
}
