use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::scoring::{
    AFFINITY_BOOST_PER_PAIR, AFFINITY_MAX_BOOST_PER_VIDEO, BINGE_NOVELTY_FACTOR, BINGE_THRESHOLD,
    CLASSIC_VIEW_THRESHOLD, COLD_START_THRESHOLD, CURIOSITY_GAP_BONUS, ContentVector,
    IMPRESSION_DECAY_RATE, IMPRESSION_PENALTY_HEAVY, IMPRESSION_PENALTY_LIGHT,
    IMPRESSION_PENALTY_MEDIUM, IMPRESSION_THRESHOLD_DROP, IMPRESSION_THRESHOLD_HEAVY,
    IMPRESSION_THRESHOLD_LIGHT, ONBOARDING_MAX_BOOST, SERENDIPITY_BONUS,
    SESSION_AFFINITY_MILD_BOOST, SESSION_AFFINITY_MILD_THRESHOLD, SESSION_AFFINITY_STRONG_BOOST,
    SESSION_AFFINITY_STRONG_THRESHOLD, SUBSCRIPTION_BOOST, TimeDecay, UserBrain,
    WATCHED_PENALTY_FULL, WATCHED_PENALTY_HALF, WATCHED_PENALTY_SAMPLED, WATCHED_THRESHOLD_FULL,
    WATCHED_THRESHOLD_HALF, WATCHED_THRESHOLD_SAMPLED, calculate_anti_recommendation_penalty,
    calculate_channel_profile_boost, calculate_channel_score_multiplier,
    calculate_cosine_similarity, calculate_feed_history_penalty,
    calculate_implicit_disinterest_penalty, calculate_rejection_pattern_penalty,
    calculate_relevance_floor, strip_domain_tag,
};
use crate::flow_neuro::signals::make_affinity_key;
use std::collections::HashSet;

/// Summed additive bonuses are capped so boosts (subscription, affinity, serendipity, …) can lift
/// a candidate but never dominate the topical similarity that forms the base score.
pub const ADDITIVE_BONUS_CAP: f64 = 0.5;

/// UCB exploration: under-sampled topics get a confidence bonus `c * sqrt(ln(1+N) / (1+n))`,
/// nudging the feed toward what the profile is uncertain about instead of only what it knows.
pub const EXPLORE_C: f64 = 0.03;
pub const EXPLORE_BONUS_CAP: f64 = 0.08;

pub struct ScoringWeights {
    pub personality: f64,
    pub context: f64,
    pub novelty: f64,
}

/// Per-refresh inputs shared by every candidate in one ranking pass.
pub struct RankInputs<'a> {
    pub brain: &'a UserBrain,
    pub time_context: &'a ContentVector,
    pub weights: ScoringWeights,
    pub now_ms: u64,
    pub is_onboarding: bool,
    pub onboarding_warmup: f64,
    pub session_topics: &'a [String],
    pub session_video_count: i32,
    pub candidate_pool_size: usize,
    /// Persona-scaled exploration appetite (Explorer high, Specialist low). 0 disables UCB.
    pub exploration_scale: f64,
    /// The keys the viewer's onboarding picks read as.
    pub pick_keys: &'a HashSet<String>,
    /// How the brain reads text into keys.
    pub spec: &'a KeySpec,
}

/// Per-candidate inputs. Borrows the candidate's extracted vector and metadata.
pub struct Candidate<'a> {
    pub video_vector: &'a ContentVector,
    pub video_id: &'a str,
    pub channel_id: &'a str,
    pub published_text: &'a str,
    pub view_count: u64,
    pub is_subscription: bool,
    pub impression: Option<(i32, u64)>,
}

/// Scores one candidate as `(base + capped_bonuses) * penalties`. This gives the score a defined
/// range (`0 ..= (1 + ADDITIVE_BONUS_CAP) * max_age_boost`) and a single, interpretable shape,
/// replacing the previous order-dependent interleaving of additions and multiplications.
pub fn score_candidate(inputs: &RankInputs, candidate: &Candidate) -> f64 {
    let brain = inputs.brain;
    let vector = candidate.video_vector;

    let personality = calculate_cosine_similarity(&brain.global_vector, vector);
    let context = calculate_cosine_similarity(inputs.time_context, vector);
    let novelty = 1.0 - personality;

    let base = (personality * inputs.weights.personality
        + context * inputs.weights.context
        + novelty * inputs.weights.novelty)
        .clamp(0.0, 1.0);

    let bonus =
        additive_bonuses(inputs, candidate, personality, context, novelty).min(ADDITIVE_BONUS_CAP);
    let penalty = multiplicative_penalties(inputs, candidate, personality);

    ((base + bonus) * penalty).max(0.0)
}

fn primary_topic(vector: &ContentVector) -> Option<&String> {
    vector
        .topics
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(topic, _)| topic)
}

fn additive_bonuses(
    inputs: &RankInputs,
    candidate: &Candidate,
    personality: f64,
    context: f64,
    novelty: f64,
) -> f64 {
    let brain = inputs.brain;
    let vector = candidate.video_vector;
    let mut bonus = 0.0;

    bonus += calculate_channel_profile_boost(brain, candidate.channel_id, vector);
    bonus += affinity_bonus(brain, vector);
    if candidate.is_subscription {
        bonus += SUBSCRIPTION_BOOST;
    }

    // Serendipity: reward novel-but-context-relevant items via smooth ramps.
    let novelty_ramp = ((novelty - 0.4) / 0.4).clamp(0.0, 1.0);
    let context_ramp = ((context - 0.3) / 0.4).clamp(0.0, 1.0);
    bonus += SERENDIPITY_BONUS * novelty_ramp * context_ramp;

    if brain.total_interactions < COLD_START_THRESHOLD && candidate.view_count > 0 {
        bonus += (1.0 + candidate.view_count as f64).log10() / 10.0 * 0.05;
    }

    // Curiosity gap: nudge complexity above the user's norm, gated by topical safety (the ramp is
    // zero below personality 0.5, so no hard cutoff is needed).
    let complexity_diff = (brain.global_vector.complexity - vector.complexity).abs();
    let curiosity_ramp = ((complexity_diff - 0.2) / 0.3).clamp(0.0, 1.0);
    let topic_safety = ((personality - 0.5) / 0.3).clamp(0.0, 1.0);
    bonus += CURIOSITY_GAP_BONUS * curiosity_ramp * topic_safety;

    let topic = primary_topic(vector);

    if inputs.is_onboarding {
        let has_preferred = inputs
            .pick_keys
            .iter()
            .any(|key| vector.topics.contains_key(key));
        if has_preferred {
            bonus += inputs.onboarding_warmup * ONBOARDING_MAX_BOOST;
        }
    }

    if let Some(topic) = topic {
        if !inputs.session_topics.is_empty() {
            let recent_count = inputs
                .session_topics
                .iter()
                .rev()
                .take(5)
                .filter(|t| *t == topic)
                .count();
            if recent_count >= SESSION_AFFINITY_STRONG_THRESHOLD {
                bonus += SESSION_AFFINITY_STRONG_BOOST;
            } else if recent_count >= SESSION_AFFINITY_MILD_THRESHOLD {
                bonus += SESSION_AFFINITY_MILD_BOOST;
            }
        }
    }

    if inputs.session_video_count > BINGE_THRESHOLD {
        bonus += novelty * BINGE_NOVELTY_FACTOR;
    }

    bonus += exploration_bonus(inputs, vector);

    bonus
}

fn exploration_bonus(inputs: &RankInputs, vector: &ContentVector) -> f64 {
    if inputs.exploration_scale <= 0.0 {
        return 0.0;
    }
    let Some(topic) = primary_topic(vector) else {
        return 0.0;
    };
    let samples = inputs
        .brain
        .topic_evidence
        .get(&strip_domain_tag(topic))
        .map(|e| (e.positive_signals + e.negative_signals).max(0) as f64)
        .unwrap_or(0.0);
    let total = inputs.brain.total_interactions.max(0) as f64;
    let ucb = EXPLORE_C * ((1.0 + total).ln() / (1.0 + samples)).sqrt();
    (ucb * inputs.exploration_scale).min(EXPLORE_BONUS_CAP)
}

fn affinity_bonus(brain: &UserBrain, vector: &ContentVector) -> f64 {
    if brain.topic_affinities.is_empty() {
        return 0.0;
    }
    let topics: Vec<&String> = vector.topics.keys().collect();
    let mut boost = 0.0;
    for i in 0..topics.len() {
        for j in (i + 1)..topics.len() {
            let key = make_affinity_key(topics[i], topics[j]);
            if let Some(&affinity) = brain.topic_affinities.get(&key) {
                boost += affinity * AFFINITY_BOOST_PER_PAIR;
            }
        }
    }
    boost.min(AFFINITY_MAX_BOOST_PER_VIDEO)
}

fn multiplicative_penalties(inputs: &RankInputs, candidate: &Candidate, personality: f64) -> f64 {
    let brain = inputs.brain;
    let vector = candidate.video_vector;
    let now_ms = inputs.now_ms;
    let mut mult = 1.0;

    let age = TimeDecay::calculate_multiplier(candidate.published_text, false);
    let is_classic = candidate.view_count > CLASSIC_VIEW_THRESHOLD;
    mult *= if is_classic || candidate.is_subscription {
        (age + 1.0) / 2.0
    } else {
        age
    };

    mult *= calculate_channel_score_multiplier(brain, candidate.channel_id);
    mult *=
        calculate_rejection_pattern_penalty(vector, &brain.rejection_patterns, now_ms, inputs.spec);
    mult *= calculate_feed_history_penalty(
        candidate.video_id,
        &brain.feed_history,
        now_ms,
        inputs.candidate_pool_size,
    );
    mult *= calculate_implicit_disinterest_penalty(
        candidate.video_id,
        &brain.feed_history,
        &brain.watch_history_map,
        now_ms,
    );
    mult *= calculate_relevance_floor(
        personality,
        brain.total_interactions,
        candidate.is_subscription,
    );
    mult *= calculate_anti_recommendation_penalty(vector, brain);
    mult *= session_fatigue(inputs, vector);
    mult *= impression_fatigue(candidate, now_ms);
    mult *= watched_penalty(candidate, brain);

    mult
}

fn session_fatigue(inputs: &RankInputs, vector: &ContentVector) -> f64 {
    let Some(topic) = primary_topic(vector) else {
        return 1.0;
    };
    let count = inputs.session_topics.iter().filter(|t| *t == topic).count();
    if count >= 5 {
        0.3
    } else if count >= 3 {
        0.5
    } else if count >= 1 {
        0.8
    } else {
        1.0
    }
}

fn impression_fatigue(candidate: &Candidate, now_ms: u64) -> f64 {
    let Some((seen_count, last_seen)) = candidate.impression else {
        return 1.0;
    };
    let hours = now_ms.saturating_sub(last_seen) as f64 / 3_600_000.0;
    let decayed = (seen_count as f64 * (-IMPRESSION_DECAY_RATE * hours).exp()) as i32;
    if decayed >= IMPRESSION_THRESHOLD_DROP {
        IMPRESSION_PENALTY_HEAVY
    } else if decayed >= IMPRESSION_THRESHOLD_HEAVY {
        IMPRESSION_PENALTY_MEDIUM
    } else if decayed >= IMPRESSION_THRESHOLD_LIGHT {
        IMPRESSION_PENALTY_LIGHT
    } else {
        1.0
    }
}

fn watched_penalty(candidate: &Candidate, brain: &UserBrain) -> f64 {
    let Some(&percent) = brain.watch_history_map.get(candidate.video_id) else {
        return 1.0;
    };
    if percent > WATCHED_THRESHOLD_FULL {
        WATCHED_PENALTY_FULL
    } else if percent > WATCHED_THRESHOLD_HALF {
        WATCHED_PENALTY_HALF
    } else if percent > WATCHED_THRESHOLD_SAMPLED {
        WATCHED_PENALTY_SAMPLED
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn topic_vector(topic: &str) -> ContentVector {
        let mut v = ContentVector::default();
        v.topics.insert(topic.to_string(), 1.0);
        v
    }

    fn base_inputs<'a>(brain: &'a UserBrain, ctx: &'a ContentVector) -> RankInputs<'a> {
        RankInputs {
            brain,
            time_context: ctx,
            weights: ScoringWeights {
                personality: 0.4,
                context: 0.4,
                novelty: 0.2,
            },
            now_ms: 1_000_000_000,
            is_onboarding: false,
            onboarding_warmup: 0.5,
            session_topics: &[],
            session_video_count: 0,
            candidate_pool_size: 50,
            exploration_scale: 0.6,
            pick_keys: &NO_PICKS,
            spec: &DEFAULT_SPEC,
        }
    }

    static DEFAULT_SPEC: std::sync::LazyLock<KeySpec> = std::sync::LazyLock::new(KeySpec::default);
    static NO_PICKS: std::sync::LazyLock<HashSet<String>> = std::sync::LazyLock::new(HashSet::new);

    fn candidate_for<'a>(
        vector: &'a ContentVector,
        id: &'a str,
        is_subscription: bool,
    ) -> Candidate<'a> {
        Candidate {
            video_vector: vector,
            video_id: id,
            channel_id: "chan",
            published_text: "3 days ago",
            view_count: 1000,
            is_subscription,
            impression: None,
        }
    }

    #[test]
    fn score_is_non_negative_and_bounded() {
        let brain = UserBrain::default();
        let ctx = ContentVector::default();
        let vector = topic_vector("guitar");
        let inputs = base_inputs(&brain, &ctx);
        let score = score_candidate(&inputs, &candidate_for(&vector, "v1", true));
        // Upper bound: (1 + cap) * max age boost (1.15 for fresh content).
        assert!(score >= 0.0);
        assert!(
            score <= (1.0 + ADDITIVE_BONUS_CAP) * 1.15 + 1e-9,
            "score was {score}"
        );
    }

    #[test]
    fn subscription_boost_increases_score() {
        let mut brain = UserBrain::default();
        brain.global_vector.topics.insert("guitar".to_string(), 0.8);
        let ctx = ContentVector::default();
        let vector = topic_vector("guitar");
        let inputs = base_inputs(&brain, &ctx);
        let with_sub = score_candidate(&inputs, &candidate_for(&vector, "v1", true));
        let without_sub = score_candidate(&inputs, &candidate_for(&vector, "v1", false));
        assert!(with_sub > without_sub);
    }

    #[test]
    fn under_explored_topic_gets_more_exploration_bonus() {
        let mut brain = UserBrain::default();
        brain.total_interactions = 200;
        brain.topic_evidence.insert(
            "guitar".to_string(),
            crate::flow_neuro::scoring::TopicEvidence {
                positive_signals: 80,
                ..Default::default()
            },
        );
        let ctx = ContentVector::default();
        let inputs = base_inputs(&brain, &ctx);

        let familiar = exploration_bonus(&inputs, &topic_vector("guitar"));
        let novel = exploration_bonus(&inputs, &topic_vector("welding"));
        assert!(novel > familiar);
        assert!(novel <= EXPLORE_BONUS_CAP);
    }

    #[test]
    fn fully_watched_video_is_penalized() {
        let mut brain = UserBrain::default();
        brain.global_vector.topics.insert("guitar".to_string(), 0.8);
        let ctx = ContentVector::default();
        let vector = topic_vector("guitar");
        let inputs = base_inputs(&brain, &ctx);
        let fresh = score_candidate(&inputs, &candidate_for(&vector, "v1", false));

        brain.watch_history_map.insert("v1".to_string(), 0.95);
        let inputs2 = base_inputs(&brain, &ctx);
        let watched = score_candidate(&inputs2, &candidate_for(&vector, "v1", false));
        assert!(watched < fresh);
    }
}
