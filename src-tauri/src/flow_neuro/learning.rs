//! What one interaction teaches the brain, ported from Flow for Android's
//! `FlowNeuroEngine.onVideoInteraction`. Pure mutation of the resident brain, no I/O: the caller
//! persists it and logs the event.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::display_forms::{fill_gaps, record, spellings_in};
use crate::flow_neuro::features::{
    TopicReader, VideoText, document_terms, extract_features, pick_keys, plant_filter,
};
use crate::flow_neuro::scoring::{
    AFFINITY_INCREMENT, AFFINITY_KEEP_TOP, AFFINITY_MAX, AFFINITY_MAX_ENTRIES, AFFINITY_TOP_TOPICS,
    CHANNEL_EMA_ALPHA, CHANNEL_KEEP_HIGH, CHANNEL_KEEP_LOW, CHANNEL_PROFILE_LEARNING_RATE,
    CHANNEL_PROFILE_MAX_CHANNELS, CHANNEL_PROFILE_MAX_TOPICS, CHANNEL_PROFILE_PRUNE_THRESHOLD,
    CHANNEL_SUPPRESSION_DAYS, ContentVector, DISLIKE_CHANNEL_FACTOR, IDF_KEEP_KEYS, IDF_MAX_KEYS,
    IdfSnapshot, MAX_CHANNEL_SCORES, MAX_CONSECUTIVE_SKIPS, MAX_SUPPRESSED_CHANNELS,
    MAX_SUPPRESSED_VIDEOS, PERSONA_MAX_STABILITY, REJECTION_EXPIRY_DAYS, REJECTION_MEMORY_MAX,
    RejectionSignal, TOPIC_ACQUISITION_FLOOR, TOPIC_ACQUISITION_TOP_K, TOPIC_EVIDENCE_MAX_ENTRIES,
    TOPIC_EVIDENCE_MAX_IDS, TimeBucket, TopicEvidence, UserBrain, WATCH_HISTORY_MAX,
    WATCHED_THRESHOLD_FULL, WATCHED_THRESHOLD_SAMPLED, classify_persona, extract_rejection_keys,
    strip_domain_tag,
};
use crate::flow_neuro::signals::{InteractionType, make_affinity_key};
use crate::flow_neuro::vector_math::{
    DECAY_REFERENCE_RATE, EVIDENCE_PRUNE_THRESHOLD, Horizon, LONG_TERM, MAX_GLOBAL_TOPICS,
    PHRASE_WORD_SHARE, RECENT, TIME_OF_DAY, adjust_vector, cap_topics, learn, phrase_first,
    plant_topics,
};

/// A Short teaches the taste vectors 1 % of what a long-form video does: Shorts are browsed by
/// swiping, so each one says little (Android #907). The Shorts vector learns from them in full.
pub const SHORTS_LEARNING_PENALTY: f64 = 0.01;
const CLICK_RATE: f64 = 0.03;
const LIKED_RATE: f64 = 0.30;
const SAVED_RATE: f64 = 0.22;
const WATCH_RATE: f64 = 0.15;
const WATCH_TIME_BONUS: f64 = 0.08;
const SKIPPED_RATE: f64 = -0.15;
const REJECTED_RATE: f64 = -0.40;
/// What "not interested" leaves of the channel's score, a deeper cut than a thumbs-down.
const NOT_INTERESTED_CHANNEL_FACTOR: f64 = 0.10;

/// One event the engine learns from.
#[derive(Debug, Clone, Copy)]
pub struct Interaction<'a> {
    pub video_id: &'a str,
    pub title: &'a str,
    pub channel_name: &'a str,
    pub channel_id: &'a str,
    pub description: Option<&'a str>,
    pub duration_sec: Option<u64>,
    pub is_live: bool,
    pub is_short: bool,
    pub kind: InteractionType,
    pub percent_watched: f32,
    /// Seconds since the card was last shown: a quick click says more than a late one.
    pub seconds_since_impression: Option<f64>,
}

/// Result of applying one interaction. `learning_rate` is `None` when a watch update taught
/// nothing new; `primary_topic` feeds session state.
pub struct InteractionOutcome {
    pub learning_rate: Option<f64>,
    pub primary_topic: Option<String>,
}

/// The event's learning rate, before Shorts, click speed and maturity adjust it.
#[must_use]
pub fn base_rate(kind: InteractionType, percent_watched: f32, duration_sec: Option<u64>) -> f64 {
    match kind {
        InteractionType::Click => CLICK_RATE,
        InteractionType::Liked => LIKED_RATE,
        InteractionType::Saved => SAVED_RATE,
        InteractionType::Watched => {
            let percent = f64::from(percent_watched);
            #[allow(clippy::cast_precision_loss)]
            let minutes = percent * duration_sec.unwrap_or(0) as f64 / 60.0;
            WATCH_RATE * percent + (1.0 + minutes).ln() / 61.0_f64.ln() * WATCH_TIME_BONUS
        }
        InteractionType::Skipped => SKIPPED_RATE,
        InteractionType::Disliked | InteractionType::NotInterested => REJECTED_RATE,
    }
}

/// How much a click is worth for how soon it followed the card being shown.
fn click_speed(seconds_since_impression: f64) -> f64 {
    if seconds_since_impression < 5.0 {
        1.5
    } else if seconds_since_impression < 30.0 {
        1.0
    } else if seconds_since_impression < 120.0 {
        0.8
    } else {
        0.6
    }
}

/// Duration, pacing and complexity settle as the profile matures; topic evidence needs no brake.
fn maturity_damping(total_interactions: i32) -> f64 {
    (1.0 / (1.0 + (1.0 + f64::from(total_interactions) / 50.0).ln())).clamp(0.25, 1.0)
}

/// Keeps the furthest share each video was watched to, and says whether this watch got far
/// enough past it to teach anything new.
fn note_watch_progress(brain: &mut UserBrain, video_id: &str, percent: f32) -> bool {
    let existing = brain
        .watch_signal_progress
        .get(video_id)
        .copied()
        .unwrap_or(0.0);
    if percent > existing {
        brain
            .watch_signal_progress
            .insert(video_id.to_string(), percent);
        if brain.watch_signal_progress.len() > WATCH_HISTORY_MAX {
            drop_lowest(&mut brain.watch_signal_progress);
        }
    }
    should_learn_from_watch(existing, percent)
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
    next_progress - existing_progress >= MIN_PROGRESS_DELTA
        || WATCH_MILESTONES
            .iter()
            .any(|milestone| existing_progress < *milestone && next_progress >= *milestone)
}

/// Applies one interaction to the in-memory brain.
pub fn apply_interaction(brain: &mut UserBrain, event: &Interaction) -> InteractionOutcome {
    let now_ms = chrono::Utc::now().timestamp_millis().cast_unsigned();
    let percent = event.percent_watched.clamp(0.0, 1.0);
    let kind = event.kind;
    if kind == InteractionType::Watched && !note_watch_progress(brain, event.video_id, percent) {
        return InteractionOutcome {
            learning_rate: None,
            primary_topic: None,
        };
    }

    let idf = IdfSnapshot {
        word_frequencies: brain.idf_word_frequency.clone(),
        total_documents: brain.idf_total_documents,
    };
    let spec = brain.key_spec();
    let video_vector = extract_features(
        &VideoText {
            title: event.title,
            channel_name: event.channel_name,
            description: event.description,
            duration_seconds: event.duration_sec,
            is_live: event.is_live,
            is_short: event.is_short,
        },
        &TopicReader {
            spec: spec.clone(),
            idf: &idf,
        },
    );
    let primary_topic = video_vector
        .topics
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(topic, _)| topic.clone());

    let mut learning_rate = base_rate(kind, percent, event.duration_sec);
    if event.is_short {
        learning_rate *= SHORTS_LEARNING_PENALTY;
    }
    let mut strength = learning_rate / DECAY_REFERENCE_RATE;
    if learning_rate > 0.0 {
        learning_rate *= maturity_damping(brain.total_interactions);
    }
    if let (InteractionType::Click, Some(seconds)) = (kind, event.seconds_since_impression) {
        learning_rate *= click_speed(seconds);
        strength *= click_speed(seconds);
    }

    learn_taste(brain, event, &video_vector, &idf, learning_rate, strength);
    learn_channel_score(brain, event, learning_rate);
    brain.consecutive_skips = match kind {
        InteractionType::Click
        | InteractionType::Liked
        | InteractionType::Saved
        | InteractionType::Watched => 0,
        // A swiped-away Short is how Shorts are browsed, and a rejection says what the viewer
        // does not want; neither is boredom with the feed (Android #907).
        InteractionType::Skipped if event.is_short => brain.consecutive_skips,
        InteractionType::Skipped => (brain.consecutive_skips + 1).min(MAX_CONSECUTIVE_SKIPS),
        InteractionType::Disliked | InteractionType::NotInterested => brain.consecutive_skips,
    };

    if learning_rate > 0.0 {
        learn_links(brain, &video_vector);
        count_document(brain, event.video_id, event.title, &video_vector, &spec);
        learn_channel_profile(brain, event.channel_id, &video_vector);
        brain.topic_evidence = update_topic_evidence(
            &brain.topic_evidence,
            &video_vector,
            event,
            topic_evidence_signal(kind, percent, event.is_short),
            now_ms,
        );
    }
    if matches!(
        kind,
        InteractionType::Skipped | InteractionType::Disliked | InteractionType::NotInterested
    ) {
        record_negative_topic_evidence(&mut brain.topic_evidence, &video_vector, now_ms);
    }
    if matches!(
        kind,
        InteractionType::Disliked | InteractionType::NotInterested
    ) {
        reject(brain, event, &video_vector, &spec, now_ms);
    }

    let persona = classify_persona(brain).name().to_string();
    brain.persona_stability = if brain.last_persona.as_deref() == Some(&persona) {
        (brain.persona_stability + 1).min(PERSONA_MAX_STABILITY)
    } else {
        1
    };
    brain.last_persona = Some(persona);

    if kind == InteractionType::Watched && percent > WATCHED_THRESHOLD_SAMPLED {
        record_watch(brain, event.video_id, percent);
    }
    if kind == InteractionType::Watched && learning_rate > 0.0 {
        brain.vote_language(event.title, event.description);
    }
    if learning_rate > 0.0 {
        learn_spellings(brain, event, &video_vector, &spec);
    }

    brain.total_interactions += 1;
    InteractionOutcome {
        learning_rate: Some(learning_rate),
        primary_topic,
    }
}

fn record_watch(brain: &mut UserBrain, video_id: &str, percent: f32) {
    let existing = brain
        .watch_history_map
        .get(video_id)
        .copied()
        .unwrap_or(0.0);
    if percent > existing {
        brain
            .watch_history_map
            .insert(video_id.to_string(), percent);
        if brain.watch_history_map.len() > WATCH_HISTORY_MAX {
            drop_lowest(&mut brain.watch_history_map);
        }
    }
}

/// How the video's title and channel name write its keys, for labels and searches.
fn learn_spellings(
    brain: &mut UserBrain,
    event: &Interaction,
    video_vector: &ContentVector,
    spec: &crate::flow_neuro::keyspec::KeySpec,
) {
    let keys: Vec<String> = video_vector.topics.keys().cloned().collect();
    let global = &brain.global_vector;
    let keep = |key: &str| global.topics.contains_key(key);
    let from_title = record(
        &brain.display_forms,
        &spellings_in(event.title, &keys, spec),
        keep,
    );
    // Keys read from the channel name still read as written somewhere.
    brain.display_forms = fill_gaps(
        &from_title,
        &spellings_in(event.channel_name, &keys, spec),
        keep,
    );
}

/// The long-term, recent and time-of-day taste, and the Shorts vector for a Short.
fn learn_taste(
    brain: &mut UserBrain,
    event: &Interaction,
    video_vector: &ContentVector,
    idf: &IdfSnapshot,
    learning_rate: f64,
    strength: f64,
) {
    let picks = pick_keys(brain);
    let learning_vector = if learning_rate > 0.0 {
        phrase_first(video_vector, PHRASE_WORD_SHARE)
    } else {
        video_vector.clone()
    };
    let learn_on = |vector: &ContentVector, horizon: Horizon| {
        if learning_rate > 0.0 {
            learn(
                vector,
                &learning_vector,
                strength,
                horizon,
                learning_rate,
                &picks,
            )
        } else {
            adjust_vector(
                vector,
                video_vector,
                learning_rate,
                EVIDENCE_PRUNE_THRESHOLD,
            )
        }
    };

    let mut global = learn_on(&brain.global_vector, LONG_TERM);
    brain.recent_vector = learn_on(&brain.recent_vector, RECENT);

    // A real watch, like or save counts at least the acquisition floor for its top topics, so a
    // new interest can establish on a mature profile at all.
    let strong = matches!(event.kind, InteractionType::Liked | InteractionType::Saved)
        || (event.kind == InteractionType::Watched && event.percent_watched >= 0.40);
    if strong && !event.is_short {
        let own_documents = i32::from(brain.counted_documents.contains(event.video_id));
        let plantable = plant_filter(
            event.title,
            event.description,
            idf,
            &brain.key_spec(),
            own_documents,
        );
        global = plant_topics(
            &global,
            video_vector,
            TOPIC_ACQUISITION_FLOOR,
            TOPIC_ACQUISITION_TOP_K,
            plantable,
        );
    }
    brain.global_vector = cap_topics(&global, MAX_GLOBAL_TOPICS, &picks);

    if event.is_short {
        let shorts_rate = match event.kind {
            InteractionType::Click => 0.08,
            InteractionType::Liked => 0.20,
            InteractionType::Saved => 0.15,
            InteractionType::Watched => 0.10 * f64::from(event.percent_watched),
            InteractionType::Skipped => -0.12,
            InteractionType::Disliked | InteractionType::NotInterested => -0.30,
        };
        brain.shorts_vector = adjust_vector(
            &brain.shorts_vector,
            video_vector,
            shorts_rate,
            crate::flow_neuro::scoring::TOPIC_PRUNE_THRESHOLD,
        );
    }

    let bucket = TimeBucket::current();
    let bucket_vector = brain.time_vectors.get(&bucket).cloned().unwrap_or_default();
    brain
        .time_vectors
        .insert(bucket, learn_on(&bucket_vector, TIME_OF_DAY));
    if learning_rate > 0.0 && !event.is_short {
        *brain.time_bucket_counts.entry(bucket).or_insert(0) += 1;
    }
}

fn learn_channel_score(brain: &mut UserBrain, event: &Interaction, learning_rate: f64) {
    let current = brain
        .channel_scores
        .get(event.channel_id)
        .copied()
        .unwrap_or(0.5);
    let updated = match event.kind {
        InteractionType::Disliked => (current * DISLIKE_CHANNEL_FACTOR).max(0.01),
        InteractionType::NotInterested => (current * NOT_INTERESTED_CHANNEL_FACTOR).max(0.01),
        _ => {
            // A swiped Short moves its channel 1 % of what a long-form video does (Android A7).
            let alpha = if event.is_short {
                CHANNEL_EMA_ALPHA * SHORTS_LEARNING_PENALTY
            } else {
                CHANNEL_EMA_ALPHA
            };
            let outcome = if learning_rate > 0.0 { 1.0 } else { 0.0 };
            current * (1.0 - alpha) + outcome * alpha
        }
    };
    brain
        .channel_scores
        .insert(event.channel_id.to_string(), updated);

    if brain.channel_scores.len() > MAX_CHANNEL_SCORES {
        let mut sorted: Vec<(String, f64)> = brain.channel_scores.drain().collect();
        sorted.sort_by(|a, b| a.1.total_cmp(&b.1));
        let high_from = sorted.len().saturating_sub(CHANNEL_KEEP_HIGH);
        brain.channel_scores = sorted
            .into_iter()
            .enumerate()
            .filter(|(index, _)| *index < CHANNEL_KEEP_LOW || *index >= high_from)
            .map(|(_, entry)| entry)
            .collect();
    }
}

/// Links between the video's strongest topics. No per-update value prune: links start below any
/// useful prune line, so one would delete every new link in the update that made it. The size cap
/// evicts the weakest links instead.
fn learn_links(brain: &mut UserBrain, video_vector: &ContentVector) {
    let mut top: Vec<(&String, &f64)> = video_vector.topics.iter().collect();
    top.sort_by(|a, b| b.1.total_cmp(a.1));
    let top: Vec<&String> = top
        .into_iter()
        .take(AFFINITY_TOP_TOPICS)
        .map(|(key, _)| key)
        .collect();
    for i in 0..top.len() {
        for j in i + 1..top.len() {
            let key = make_affinity_key(top[i], top[j]);
            let current = brain.topic_affinities.get(&key).copied().unwrap_or(0.0);
            brain
                .topic_affinities
                .insert(key, (current + AFFINITY_INCREMENT).min(AFFINITY_MAX));
        }
    }
    if brain.topic_affinities.len() > AFFINITY_MAX_ENTRIES {
        let mut sorted: Vec<(String, f64)> = brain.topic_affinities.drain().collect();
        sorted.sort_by(|a, b| b.1.total_cmp(&a.1));
        sorted.truncate(AFFINITY_KEEP_TOP);
        brain.topic_affinities = sorted.into_iter().collect();
    }
}

/// Document frequency counts each video once, so pair counts can say what is a phrase.
fn count_document(
    brain: &mut UserBrain,
    video_id: &str,
    title: &str,
    video_vector: &ContentVector,
    spec: &crate::flow_neuro::keyspec::KeySpec,
) {
    if !brain.counted_documents.insert(video_id.to_string()) {
        return;
    }
    for term in document_terms(title, video_vector, spec) {
        *brain.idf_word_frequency.entry(term).or_insert(0) += 1;
    }
    brain.idf_total_documents += 1;
    if brain.idf_total_documents > 10_000 {
        for count in brain.idf_word_frequency.values_mut() {
            *count /= 2;
        }
        brain.idf_word_frequency.retain(|_, count| *count > 0);
        brain.idf_total_documents /= 2;
    }
    if brain.idf_word_frequency.len() > IDF_MAX_KEYS {
        let mut entries: Vec<(String, i32)> = brain.idf_word_frequency.drain().collect();
        entries.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
        entries.truncate(IDF_KEEP_KEYS);
        brain.idf_word_frequency = entries.into_iter().collect();
    }
}

fn learn_channel_profile(brain: &mut UserBrain, channel_id: &str, video_vector: &ContentVector) {
    let mut profile = brain
        .channel_topic_profiles
        .get(channel_id)
        .cloned()
        .unwrap_or_default();
    for (topic, weight) in &video_vector.topics {
        let current = profile.get(topic).copied().unwrap_or(0.0);
        profile.insert(
            topic.clone(),
            current + (weight - current) * CHANNEL_PROFILE_LEARNING_RATE,
        );
    }
    profile.retain(|topic, value| {
        if !video_vector.topics.contains_key(topic) {
            *value *= 0.98;
        }
        *value >= CHANNEL_PROFILE_PRUNE_THRESHOLD
    });
    if profile.len() > CHANNEL_PROFILE_MAX_TOPICS {
        let mut entries: Vec<(String, f64)> = profile.into_iter().collect();
        entries.sort_by(|a, b| b.1.total_cmp(&a.1));
        entries.truncate(CHANNEL_PROFILE_MAX_TOPICS);
        profile = entries.into_iter().collect();
    }
    brain
        .channel_topic_profiles
        .insert(channel_id.to_string(), profile);

    if brain.channel_topic_profiles.len() > CHANNEL_PROFILE_MAX_CHANNELS {
        let scores = &brain.channel_scores;
        let mut channels: Vec<String> = brain.channel_topic_profiles.keys().cloned().collect();
        channels.sort_by(|a, b| {
            let score = |id: &String| scores.get(id).copied().unwrap_or(0.0);
            score(a).total_cmp(&score(b))
        });
        let excess = channels.len() - CHANNEL_PROFILE_MAX_CHANNELS;
        for channel in channels.into_iter().take(excess) {
            brain.channel_topic_profiles.remove(&channel);
        }
    }
}

fn topic_evidence_signal(kind: InteractionType, percent_watched: f32, is_short: bool) -> f64 {
    let base = match kind {
        InteractionType::Click => 0.20,
        InteractionType::Liked => 2.0,
        InteractionType::Saved => 1.2,
        InteractionType::Watched if percent_watched >= WATCHED_THRESHOLD_FULL => 1.5,
        InteractionType::Watched if percent_watched >= 0.40 => 1.0,
        InteractionType::Watched if percent_watched >= WATCHED_THRESHOLD_SAMPLED => 0.35,
        _ => 0.0,
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

/// The video's five strongest topics, the ones evidence is kept for.
fn evidence_topics(video_vector: &ContentVector) -> Vec<String> {
    let mut top: Vec<(String, f64)> = video_vector
        .topics
        .iter()
        .map(|(topic, score)| (strip_domain_tag(topic), *score))
        .filter(|(topic, _)| topic.len() >= 3)
        .collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1));
    top.into_iter().map(|(topic, _)| topic).take(5).collect()
}

fn update_topic_evidence(
    current: &HashMap<String, TopicEvidence>,
    video_vector: &ContentVector,
    event: &Interaction,
    signal_score: f64,
    now_ms: u64,
) -> HashMap<String, TopicEvidence> {
    if signal_score <= 0.0 {
        return current.clone();
    }
    let is_watch_signal = event.kind == InteractionType::Watched && event.percent_watched >= 0.40;
    let is_explicit_signal = matches!(event.kind, InteractionType::Liked | InteractionType::Saved);
    let mut updated = current.clone();
    for topic in evidence_topics(video_vector) {
        let existing = updated.get(&topic).cloned().unwrap_or_default();
        updated.insert(
            topic,
            TopicEvidence {
                positive_signals: existing.positive_signals + 1,
                negative_signals: existing.negative_signals,
                watch_signals: existing.watch_signals + i32::from(is_watch_signal),
                explicit_signals: existing.explicit_signals + i32::from(is_explicit_signal),
                positive_score: (existing.positive_score + signal_score).min(50.0),
                video_ids: capped_set(&existing.video_ids, event.video_id),
                channel_ids: capped_set(&existing.channel_ids, event.channel_id),
                first_seen_at: if existing.first_seen_at > 0 {
                    existing.first_seen_at
                } else {
                    now_ms
                },
                last_seen_at: now_ms,
            },
        );
    }
    if updated.len() <= TOPIC_EVIDENCE_MAX_ENTRIES {
        return updated;
    }
    let mut entries: Vec<(String, TopicEvidence)> = updated.into_iter().collect();
    entries.sort_by(|a, b| {
        b.1.positive_score
            .total_cmp(&a.1.positive_score)
            .then_with(|| b.1.last_seen_at.cmp(&a.1.last_seen_at))
    });
    entries.truncate(TOPIC_EVIDENCE_MAX_ENTRIES);
    entries.into_iter().collect()
}

/// A skip or rejection counts against topics already tracked, so exploration stops boosting
/// interests the viewer pushed back on. Never creates new entries.
fn record_negative_topic_evidence(
    topic_evidence: &mut HashMap<String, TopicEvidence>,
    video_vector: &ContentVector,
    now_ms: u64,
) {
    for topic in evidence_topics(video_vector) {
        if let Some(entry) = topic_evidence.get_mut(&topic) {
            entry.negative_signals += 1;
            entry.last_seen_at = now_ms;
        }
    }
}

/// Hides a rejected video for good. Past the cap the oldest rejections make room.
pub(crate) fn suppress_video(brain: &mut UserBrain, video_id: &str, now_ms: u64) {
    brain
        .suppressed_video_ids
        .insert(video_id.to_string(), now_ms);
    if brain.suppressed_video_ids.len() > MAX_SUPPRESSED_VIDEOS {
        let mut entries: Vec<(String, u64)> = brain
            .suppressed_video_ids
            .iter()
            .map(|(id, ts)| (id.clone(), *ts))
            .collect();
        entries.sort_by_key(|(_, ts)| *ts);
        let excess = entries.len() - MAX_SUPPRESSED_VIDEOS;
        for (id, _) in entries.into_iter().take(excess) {
            brain.suppressed_video_ids.remove(&id);
        }
    }
}

fn reject(
    brain: &mut UserBrain,
    event: &Interaction,
    video_vector: &ContentVector,
    spec: &crate::flow_neuro::keyspec::KeySpec,
    now_ms: u64,
) {
    suppress_video(brain, event.video_id, now_ms);
    // A rolling, self-healing window: an inferred rejection never becomes a permanent block,
    // only an explicit block_channel does, so two mis-taps cannot hide a channel forever.
    if event.kind == InteractionType::NotInterested && !event.channel_id.is_empty() {
        brain
            .suppressed_channels
            .insert(event.channel_id.to_string(), now_ms);
        if brain.suppressed_channels.len() > MAX_SUPPRESSED_CHANNELS {
            let cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * 86_400_000);
            brain.suppressed_channels.retain(|_, ts| *ts >= cutoff);
        }
    }

    for key in extract_rejection_keys(video_vector, spec) {
        let count = brain.rejection_patterns.get(&key).map_or(0, |s| s.count);
        brain.rejection_patterns.insert(
            key,
            RejectionSignal {
                count: count + 1,
                last_rejected_at: now_ms,
            },
        );
    }
    let cutoff = now_ms.saturating_sub(REJECTION_EXPIRY_DAYS * 86_400_000);
    brain
        .rejection_patterns
        .retain(|_, signal| signal.last_rejected_at >= cutoff);
    if brain.rejection_patterns.len() > REJECTION_MEMORY_MAX {
        let mut entries: Vec<(String, u64)> = brain
            .rejection_patterns
            .iter()
            .map(|(key, signal)| (key.clone(), signal.last_rejected_at))
            .collect();
        entries.sort_by_key(|(_, at)| *at);
        let excess = entries.len() - REJECTION_MEMORY_MAX;
        for (key, _) in entries.into_iter().take(excess) {
            brain.rejection_patterns.remove(&key);
        }
    }
}

/// Drops the entry with the smallest share, the least informative one, when a per-video map is
/// full. These maps carry no timestamps, so this is the best stand-in for the oldest.
fn drop_lowest(map: &mut HashMap<String, f32>) {
    if let Some(key) = map
        .iter()
        .min_by(|a, b| a.1.total_cmp(b.1))
        .map(|(key, _)| key.clone())
    {
        map.remove(&key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Event<'a> {
        id: &'a str,
        title: &'a str,
        duration: Option<u64>,
        is_short: bool,
        kind: InteractionType,
        percent: f32,
    }

    fn event<'a>(id: &'a str, title: &'a str, kind: InteractionType, percent: f32) -> Event<'a> {
        Event {
            id,
            title,
            duration: Some(600),
            is_short: false,
            kind,
            percent,
        }
    }

    fn apply(brain: &mut UserBrain, e: &Event) -> InteractionOutcome {
        apply_interaction(
            brain,
            &Interaction {
                video_id: e.id,
                title: e.title,
                channel_name: "Some Channel",
                channel_id: "chan1",
                description: None,
                duration_sec: e.duration,
                is_live: false,
                is_short: e.is_short,
                kind: e.kind,
                percent_watched: e.percent,
                seconds_since_impression: None,
            },
        )
    }

    const TITLE: &str = "Rust compiler internals explained";

    #[test]
    fn learning_rates_follow_the_interaction() {
        let rate = |kind, percent| {
            let mut brain = UserBrain::default();
            apply(&mut brain, &event("v1", TITLE, kind, percent))
                .learning_rate
                .unwrap()
        };
        assert!((rate(InteractionType::Click, 0.0) - CLICK_RATE).abs() < 1e-9);
        assert!((rate(InteractionType::Liked, 0.0) - LIKED_RATE).abs() < 1e-9);
        assert!((rate(InteractionType::Skipped, 0.0) - SKIPPED_RATE).abs() < 1e-9);
        assert!((rate(InteractionType::Disliked, 0.0) - REJECTED_RATE).abs() < 1e-9);
        // 0.15 * 1.0 plus the log time bonus for ten watched minutes.
        let full_watch = 0.15 + (11.0_f64).ln() / (61.0_f64).ln() * 0.08;
        assert!((rate(InteractionType::Watched, 1.0) - full_watch).abs() < 1e-9);
    }

    #[test]
    fn a_mature_profile_moves_its_scalars_less() {
        let mut fresh = UserBrain::default();
        let mut mature = UserBrain {
            total_interactions: 500,
            ..UserBrain::default()
        };
        let liked = event("v1", TITLE, InteractionType::Liked, 0.0);
        let fresh_rate = apply(&mut fresh, &liked).learning_rate.unwrap();
        let mature_rate = apply(&mut mature, &liked).learning_rate.unwrap();
        assert!(mature_rate < fresh_rate);
        assert!(mature_rate >= LIKED_RATE * 0.25);
    }

    #[test]
    fn a_quick_click_teaches_more_than_a_late_one() {
        let click = |seconds| {
            let mut brain = UserBrain::default();
            apply_interaction(
                &mut brain,
                &Interaction {
                    video_id: "v1",
                    title: TITLE,
                    channel_name: "Some Channel",
                    channel_id: "chan1",
                    description: None,
                    duration_sec: Some(600),
                    is_live: false,
                    is_short: false,
                    kind: InteractionType::Click,
                    percent_watched: 0.0,
                    seconds_since_impression: Some(seconds),
                },
            )
            .learning_rate
            .unwrap()
        };
        assert!(click(2.0) > click(60.0));
        assert!(click(60.0) > click(600.0));
    }

    #[test]
    fn shorts_teach_the_taste_a_hundredth_and_the_shorts_vector_in_full() {
        let mut brain = UserBrain::default();
        let mut short = event("s1", TITLE, InteractionType::Liked, 0.0);
        short.is_short = true;
        short.duration = Some(30);
        let rate = apply(&mut brain, &short).learning_rate.unwrap();
        assert!((rate - LIKED_RATE * SHORTS_LEARNING_PENALTY).abs() < 1e-9);
        assert!(!brain.shorts_vector.topics.is_empty());
        let shorts_top = brain
            .shorts_vector
            .topics
            .values()
            .copied()
            .fold(0.0, f64::max);
        let global_top = brain
            .global_vector
            .topics
            .values()
            .copied()
            .fold(0.0, f64::max);
        assert!(shorts_top > global_top);
        assert!((brain.channel_scores["chan1"] - 0.5).abs() < CHANNEL_EMA_ALPHA * 0.1);
        assert!(brain.time_bucket_counts.is_empty());
    }

    #[test]
    fn a_watch_reaches_every_horizon() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Watched, 0.9),
        );
        assert!(!brain.global_vector.topics.is_empty());
        assert!(!brain.recent_vector.topics.is_empty());
        let bucket = TimeBucket::current();
        assert!(!brain.time_vectors[&bucket].topics.is_empty());
        assert_eq!(brain.time_bucket_counts[&bucket], 1);
        assert!(brain.channel_scores["chan1"] > 0.5);
        assert!(brain.watch_history_map.contains_key("v1"));
        assert!(brain.channel_topic_profiles.contains_key("chan1"));
        assert_eq!(brain.idf_total_documents, 1);
        assert!(!brain.topic_evidence.is_empty());
    }

    #[test]
    fn a_strong_watch_plants_its_confirmed_topics() {
        let mut brain = UserBrain::default();
        // The first time a title is seen only words confirmed elsewhere may be planted.
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Watched, 0.9),
        );
        apply(
            &mut brain,
            &event("v2", TITLE, InteractionType::Watched, 0.9),
        );
        assert!(
            brain
                .global_vector
                .topics
                .values()
                .any(|weight| *weight >= TOPIC_ACQUISITION_FLOOR)
        );
    }

    #[test]
    fn picks_survive_the_topic_cap() {
        let mut brain = UserBrain::default();
        brain.preferred_topics.insert("Woodworking".into());
        let pick = pick_keys(&brain).into_iter().next().unwrap();
        brain.global_vector.topics.insert(pick.clone(), 0.0051);
        for i in 0..(MAX_GLOBAL_TOPICS + 20) {
            brain.global_vector.topics.insert(format!("filler{i}"), 0.5);
        }
        apply(&mut brain, &event("v1", TITLE, InteractionType::Liked, 0.0));
        assert!(brain.global_vector.topics.contains_key(&pick));
    }

    #[test]
    fn watch_progress_learns_only_on_real_progress() {
        let mut brain = UserBrain::default();
        assert!(
            apply(
                &mut brain,
                &event("v1", TITLE, InteractionType::Watched, 0.20)
            )
            .learning_rate
            .is_some()
        );
        assert!(
            apply(
                &mut brain,
                &event("v1", TITLE, InteractionType::Watched, 0.25)
            )
            .learning_rate
            .is_none()
        );
        assert!(
            apply(
                &mut brain,
                &event("v1", TITLE, InteractionType::Watched, 0.10)
            )
            .learning_rate
            .is_none()
        );
        assert!(
            apply(
                &mut brain,
                &event("v1", TITLE, InteractionType::Watched, 0.41)
            )
            .learning_rate
            .is_some()
        );
        assert_eq!(brain.total_interactions, 2);
    }

    #[test]
    fn a_video_counts_as_one_document() {
        let mut brain = UserBrain::default();
        apply(&mut brain, &event("v1", TITLE, InteractionType::Click, 0.0));
        apply(&mut brain, &event("v1", TITLE, InteractionType::Liked, 0.0));
        assert_eq!(brain.idf_total_documents, 1);
    }

    #[test]
    fn positive_events_reset_consecutive_skips() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Skipped, 0.05),
        );
        apply(
            &mut brain,
            &event("v2", TITLE, InteractionType::Skipped, 0.05),
        );
        assert_eq!(brain.consecutive_skips, 2);
        apply(&mut brain, &event("v3", TITLE, InteractionType::Click, 0.0));
        assert_eq!(brain.consecutive_skips, 0);
    }

    #[test]
    fn a_dislike_records_rejection_patterns_and_lowers_the_channel() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Disliked, 0.0),
        );
        assert!(!brain.rejection_patterns.is_empty());
        assert!(brain.channel_scores["chan1"] < 0.5);
    }

    #[test]
    fn not_interested_twice_never_blocks_a_channel() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::NotInterested, 0.0),
        );
        apply(
            &mut brain,
            &event("v2", TITLE, InteractionType::NotInterested, 0.0),
        );
        assert!(brain.blocked_channels.is_empty());
        assert!(brain.channel_strikes.is_empty());
        assert!(brain.suppressed_channels.contains_key("chan1"));
        assert!(brain.suppressed_video_ids.contains_key("v1"));
        assert!(brain.suppressed_video_ids.contains_key("v2"));
    }

    #[test]
    fn a_thumbs_down_hides_the_video_but_not_the_channel() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Disliked, 0.0),
        );
        assert!(brain.suppressed_video_ids.contains_key("v1"));
        assert!(brain.suppressed_channels.is_empty());
        assert!((brain.channel_scores["chan1"] - 0.5 * DISLIKE_CHANNEL_FACTOR).abs() < 1e-9);
    }

    #[test]
    fn rejections_do_not_count_as_boredom() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Disliked, 0.0),
        );
        apply(
            &mut brain,
            &event("v2", TITLE, InteractionType::NotInterested, 0.0),
        );
        assert_eq!(brain.consecutive_skips, 0);
    }

    #[test]
    fn a_skip_hides_nothing() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Skipped, 0.05),
        );
        assert!(brain.suppressed_video_ids.is_empty());
        assert!(brain.suppressed_channels.is_empty());
    }

    #[test]
    fn swiping_past_a_short_is_not_boredom() {
        let mut brain = UserBrain::default();
        let mut short = event("s1", TITLE, InteractionType::Skipped, 0.05);
        short.is_short = true;
        short.duration = Some(30);
        apply(&mut brain, &short);
        assert_eq!(brain.consecutive_skips, 0);
    }

    #[test]
    fn hidden_videos_past_the_cap_drop_the_oldest() {
        let mut brain = UserBrain::default();
        for i in 0..MAX_SUPPRESSED_VIDEOS as u64 {
            brain.suppressed_video_ids.insert(format!("old{i}"), i + 1);
        }
        suppress_video(&mut brain, "new", 1_000_000);
        assert_eq!(brain.suppressed_video_ids.len(), MAX_SUPPRESSED_VIDEOS);
        assert!(!brain.suppressed_video_ids.contains_key("old0"));
        assert!(brain.suppressed_video_ids.contains_key("new"));
    }

    #[test]
    fn a_topic_link_survives_its_first_update() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event("v1", TITLE, InteractionType::Watched, 0.9),
        );
        assert!(!brain.topic_affinities.is_empty());
        assert!(
            brain
                .topic_affinities
                .values()
                .all(|v| (v - AFFINITY_INCREMENT).abs() < 1e-9)
        );
        apply(
            &mut brain,
            &event("v2", TITLE, InteractionType::Watched, 0.9),
        );
        assert!(
            brain
                .topic_affinities
                .values()
                .any(|v| (v - 2.0 * AFFINITY_INCREMENT).abs() < 1e-9)
        );
    }

    #[test]
    fn topic_links_join_only_the_top_three_topics() {
        let mut brain = UserBrain::default();
        apply(
            &mut brain,
            &event(
                "v1",
                "Rust compiler internals explained with borrow checker lifetimes",
                InteractionType::Liked,
                0.0,
            ),
        );
        assert!(brain.topic_affinities.len() <= 3);
    }

    #[test]
    fn a_save_is_a_strong_explicit_signal_weaker_than_a_like() {
        let mut saved = UserBrain::default();
        let rate = apply(&mut saved, &event("v1", TITLE, InteractionType::Saved, 0.0))
            .learning_rate
            .unwrap();
        assert!(rate > 0.0 && rate < LIKED_RATE);
        assert!(
            saved
                .topic_evidence
                .values()
                .all(|e| e.explicit_signals == 1)
        );
        assert_eq!(saved.consecutive_skips, 0);
    }
}
