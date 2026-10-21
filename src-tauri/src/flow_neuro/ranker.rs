//! Scores one candidate the way Flow for Android does (`NeuroScoring.scoreCandidate`), term by term
//! in its order, checked against its `rank_golden.json`. Additive terms and factors interleave as on
//! Android; the impression-fatigue factor is left out because it can never fire there (Android A1),
//! and a watched song gets no exemption from the watched penalty (music never trains this engine).

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::categories::{ChannelCategory, factor as category_factor, id_of};
use crate::flow_neuro::formats;
use crate::flow_neuro::keyed_lists::keyed_lists;
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::rejections::rejection_penalty;
use crate::flow_neuro::scoring::{
    COLD_START_THRESHOLD, ContentVector, FeedEntry, UserBrain, calculate_cosine_similarity,
    strip_domain_tag,
};
use crate::flow_neuro::shorts::seen_penalty;

const SUBSCRIPTION_BOOST: f64 = 0.15;
/// The reel feed has its own subscription lane; more than this made every page one.
const SHORTS_SUBSCRIPTION_BOOST_MULTIPLIER: f64 = 1.5;
const SUBSCRIPTION_BOOST_MAX: f64 = 0.30;
/// Where the channel sigmoid sits for a channel at its starting score, so knowing a channel is
/// neutral and only how it was received moves it.
const CHANNEL_SIGNAL_NEUTRAL: f64 = 0.7801;
const SERENDIPITY_BONUS: f64 = 0.10;
const CURIOSITY_GAP_BONUS: f64 = 0.10;
const NOT_INTERESTED_CHANNEL_FLOOR: f64 = 0.20;
const ONBOARDING_MAX_BOOST: f64 = 0.15;
const ENGAGEMENT_RATE_BASELINE: f64 = 0.05;
const ENGAGEMENT_MAX_BOOST: f64 = 0.05;
const ENGAGEMENT_MIN_VIEWS: u64 = 1000;
const ENGAGEMENT_FLOOR_RATE: f64 = 0.01;
const ENGAGEMENT_FLOOR_MIN_VIEWS: u64 = 50_000;
const ENGAGEMENT_FLOOR_PENALTY: f64 = 0.2;
const COLD_START_ENGAGEMENT_FLOOR_RATE: f64 = 0.02;
const COLD_START_ENGAGEMENT_FLOOR_MIN_VIEWS: u64 = 10_000;
const BINGE_THRESHOLD: i32 = 20;
const BINGE_NOVELTY_FACTOR: f64 = 0.15;
const CLASSIC_VIEW_THRESHOLD: u64 = 5_000_000;
const ANTI_REC_PENALTY_THRESHOLD: f64 = 0.6;
const ANTI_REC_PENALTY: f64 = 0.4;
const MOMENTUM_WINDOW: usize = 10;
const MOMENTUM_BOOST: f64 = 0.08;
const MOMENTUM_THRESHOLD: usize = 3;
const WATCHED_PENALTY_FULL: f64 = 0.02;
const WATCHED_PENALTY_HALF: f64 = 0.30;
const WATCHED_PENALTY_SAMPLED: f64 = 0.70;
const WATCHED_THRESHOLD_FULL: f32 = 0.85;
const WATCHED_THRESHOLD_HALF: f32 = 0.50;
const WATCHED_THRESHOLD_SAMPLED: f32 = 0.15;
const AFFINITY_MAX_BOOST_PER_VIDEO: f64 = 0.15;
const AFFINITY_BOOST_PER_PAIR: f64 = 0.05;
const EXPLORE_BETA_C: f64 = 0.28;
const EXPLORE_MAX_BONUS: f64 = 0.08;
const NOVELTY_RELEVANCE_GATE: f64 = 0.08;
const RELEVANCE_FLOOR_MIN_INTERACTIONS: i32 = 80;
const RELEVANCE_FLOOR_SEVERE_THRESHOLD: f64 = 0.05;
const RELEVANCE_FLOOR_MODERATE_THRESHOLD: f64 = 0.10;
const RELEVANCE_FLOOR_SEVERE_PENALTY: f64 = 0.15;
const RELEVANCE_FLOOR_MODERATE_PENALTY: f64 = 0.40;
const IMPLICIT_DISINTEREST_WINDOW_HOURS: f64 = 48.0;
const IMPLICIT_DISINTEREST_THRESHOLD_HEAVY: i32 = 5;
const IMPLICIT_DISINTEREST_THRESHOLD_LIGHT: i32 = 3;
const IMPLICIT_DISINTEREST_PENALTY_HEAVY: f64 = 0.10;
const IMPLICIT_DISINTEREST_PENALTY_LIGHT: f64 = 0.30;
/// The most a channel watched alongside the viewer's own adds to a score.
const COWATCH_MAX_PRIOR: f64 = 0.04;
const HOUR_MS: f64 = 3_600_000.0;

/// A recent interaction's topic and whether it was positive, for session momentum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MomentumEntry {
    pub topic: String,
    pub positive: bool,
}

/// Everything one ranking pass shares across its candidates.
pub struct ScoringParams<'a> {
    pub brain: &'a UserBrain,
    pub user_subs: &'a HashSet<String>,
    /// Long-term taste with a quarter of the recent one.
    pub taste: &'a ContentVector,
    pub context: &'a ContentVector,
    pub w_personality: f64,
    pub w_context: f64,
    pub w_novelty: f64,
    pub is_cold_start: bool,
    pub is_onboarding: bool,
    pub onboarding_warmup: f64,
    /// The keys the viewer's own picks read as.
    pub picks: &'a HashSet<String>,
    pub session_topics: &'a [String],
    pub session_video_count: i32,
    pub momentum: &'a [MomentumEntry],
    pub candidate_pool_size: usize,
    pub now_ms: u64,
    /// Persona-scaled appetite for exploration: explorers roam, specialists stay focused.
    pub explore_weight: f64,
    pub category_of: &'a dyn Fn(&str) -> Option<ChannelCategory>,
    /// Channel to the strength (0..1) of its strongest pair with a channel the viewer watches.
    pub co_watch_prior: &'a HashMap<String, f64>,
    pub spec: &'a KeySpec,
    /// The topic links as topic to (other topic to weight), built once per pass.
    pub affinity_neighbours: HashMap<String, HashMap<String, f64>>,
}

/// The topic links of `brain` as topic to (other topic to weight).
#[must_use]
pub fn affinity_neighbours(brain: &UserBrain) -> HashMap<String, HashMap<String, f64>> {
    let mut neighbours: HashMap<String, HashMap<String, f64>> = HashMap::new();
    for (key, &weight) in &brain.topic_affinities {
        let Some((a, b)) = key.split_once('|') else {
            continue;
        };
        if a.is_empty() {
            continue;
        }
        neighbours
            .entry(a.to_string())
            .or_default()
            .insert(b.to_string(), weight);
        neighbours
            .entry(b.to_string())
            .or_default()
            .insert(a.to_string(), weight);
    }
    neighbours
}

/// One candidate: its vector and what its card says.
pub struct Candidate<'a> {
    pub video_id: &'a str,
    pub channel_id: &'a str,
    pub vector: &'a ContentVector,
    /// "3 days ago" as the card writes it.
    pub upload_date: &'a str,
    pub view_count: u64,
    /// 0 when unknown, which feeds always are.
    pub like_count: u64,
    pub category: Option<&'a str>,
    pub is_live: bool,
    pub is_short: bool,
}

/// The deterministic score of one candidate; the caller adds the exploration jitter.
#[must_use]
pub fn score_candidate(p: &ScoringParams, c: &Candidate) -> f64 {
    let brain = p.brain;
    let vector = c.vector;

    let personality = if c.is_short && !brain.shorts_vector.topics.is_empty() {
        calculate_cosine_similarity(p.taste, vector) * 0.4
            + calculate_cosine_similarity(&brain.shorts_vector, vector) * 0.6
    } else {
        calculate_cosine_similarity(p.taste, vector)
    };
    let context = calculate_cosine_similarity(p.context, vector);
    // A smooth ramp instead of a cliff at the gate, so two near-identical candidates straddling it
    // get near-identical novelty credit.
    let novelty = if p.is_cold_start {
        1.0 - personality
    } else {
        smoothstep(
            NOVELTY_RELEVANCE_GATE,
            NOVELTY_RELEVANCE_GATE + 0.1,
            personality,
        ) * (1.0 - personality)
    };

    let mut total = personality * p.w_personality + context * p.w_context + novelty * p.w_novelty;
    total *= topic_probation(vector, brain, p.picks);
    if !brain.topic_affinities.is_empty() {
        total += affinity_boost(vector, &p.affinity_neighbours);
    }
    total += formats::score_term(&brain.format_affinity, &vector.formats);
    total += channel_signal(c, brain, p.user_subs);
    total += p.co_watch_prior.get(c.channel_id).copied().unwrap_or(0.0) * COWATCH_MAX_PRIOR;
    total += serendipity(novelty, context);
    if p.is_cold_start && c.view_count > 0 {
        #[allow(clippy::cast_precision_loss)]
        let popularity = (1.0 + c.view_count as f64).log10() / 10.0 * 0.05;
        total += popularity;
    }
    total *= engagement_quality(c, p.is_cold_start);

    let age = time_decay(c.upload_date, c.is_live);
    let is_sub = p.user_subs.contains(c.channel_id);
    total *= if c.view_count >= CLASSIC_VIEW_THRESHOLD || is_sub {
        f64::midpoint(age, 1.0)
    } else {
        age
    };
    total *= category_term(c, p, is_sub);
    total += curiosity(
        personality,
        brain.global_vector.complexity,
        vector.complexity,
    );
    total *= freshness(vector, personality, p.session_topics, p.session_video_count);
    if p.is_onboarding && p.picks.iter().any(|key| vector.topics.contains_key(key)) {
        total += p.onboarding_warmup * ONBOARDING_MAX_BOOST;
    }
    total *= watched_penalty(brain.watch_history_map.get(c.video_id).copied());
    total *= anti_recommendation(vector, brain);
    total *= rejection_penalty(
        vector,
        &brain.rejection_patterns,
        p.now_ms,
        &keyed_lists(p.spec),
    );
    total *= relevance_floor(personality, brain.total_interactions, is_sub);
    total *= feed_history_penalty(
        brain.feed_history.get(c.video_id),
        p.now_ms,
        p.candidate_pool_size,
    );
    total *= implicit_disinterest(
        brain.feed_history.get(c.video_id),
        brain.watch_history_map.contains_key(c.video_id),
        p.now_ms,
    );
    total += momentum_boost(vector, p.momentum, personality);
    total += exploration_bonus(vector, brain, p.explore_weight);
    if c.is_short {
        total *= seen_penalty(brain.seen_shorts_history.get(c.video_id).copied(), p.now_ms);
    }
    total
}

/// Hermite smoothstep: a continuous ramp from 0 at `edge0` to 1 at `edge1`.
fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn primary_topic(vector: &ContentVector) -> Option<&String> {
    vector
        .topics
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(key, _)| key)
}

fn ranked_topics(vector: &ContentVector) -> Vec<&String> {
    let mut ranked: Vec<(&String, f64)> = vector.topics.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked.into_iter().map(|(key, _)| key).collect()
}

/// Leading digits of `text`, as Kotlin's `filter { it.isDigit() }.toIntOrNull()` reads them.
fn number_in(text: &str) -> Option<u32> {
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// How a card's age lifts or lowers it: new uploads up, years-old ones down.
fn time_decay(date_text: &str, is_live: bool) -> f64 {
    let text = date_text.to_lowercase();
    if is_live {
        return 1.15;
    }
    if text.contains("second") || text.contains("minute") || text.contains("hour") {
        1.15
    } else if text.contains("day") {
        1.12
    } else if text.contains("week") {
        1.08
    } else if text.contains("month") {
        let months = f64::from(number_in(&text).unwrap_or(1));
        (1.0 / (1.0 + 0.08 * months)).max(0.75)
    } else if text.contains("year") {
        let years = f64::from(number_in(&text).unwrap_or(1));
        1.0 / (1.0 + 0.35 * years)
    } else {
        0.85
    }
}

fn is_older_than_24_hours(date_text: &str) -> bool {
    let text = date_text.to_lowercase();
    !(text.contains("second") || text.contains("minute") || text.contains("hour"))
}

/// A subscription's lift, larger for a fresh upload, and how the channel's past videos were
/// received, neutral for a channel at its starting score.
fn channel_signal(c: &Candidate, brain: &UserBrain, user_subs: &HashSet<String>) -> f64 {
    let mut signal = 0.0;
    if user_subs.contains(c.channel_id) {
        let boost = if c.is_short {
            SUBSCRIPTION_BOOST * SHORTS_SUBSCRIPTION_BOOST_MULTIPLIER
        } else {
            SUBSCRIPTION_BOOST
        };
        let text = c.upload_date.to_lowercase();
        let freshness = if !is_older_than_24_hours(&text) {
            2.0
        } else if text.contains("day") && number_in(&text).unwrap_or(99) <= 2 {
            1.5
        } else if text.contains("week") && number_in(&text).unwrap_or(99) <= 1 {
            1.2
        } else {
            1.0
        };
        signal += (boost * freshness).min(SUBSCRIPTION_BOOST_MAX);
    }
    if let Some(&click_rate) = brain.channel_scores.get(c.channel_id) {
        let quality = 1.0 / (1.0 + (-8.0 * (click_rate - 0.35)).exp());
        signal += 0.05 + 0.95 * quality - CHANNEL_SIGNAL_NEUTRAL;
    }
    signal
}

/// A strong like rate lifts a card a little and a clickbait one lowers it. Feeds carry no like
/// count, and 0 means unknown, not a bad ratio.
fn engagement_quality(c: &Candidate, is_cold_start: bool) -> f64 {
    if c.view_count < ENGAGEMENT_MIN_VIEWS || c.like_count == 0 {
        return 1.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let rate = c.like_count as f64 / c.view_count as f64;
    let (floor_views, floor_rate) = if is_cold_start {
        (
            COLD_START_ENGAGEMENT_FLOOR_MIN_VIEWS,
            COLD_START_ENGAGEMENT_FLOOR_RATE,
        )
    } else {
        (ENGAGEMENT_FLOOR_MIN_VIEWS, ENGAGEMENT_FLOOR_RATE)
    };
    if c.view_count > floor_views && is_older_than_24_hours(c.upload_date) && rate < floor_rate {
        return (ENGAGEMENT_FLOOR_PENALTY + (1.0 - ENGAGEMENT_FLOOR_PENALTY) * (rate / floor_rate))
            .clamp(ENGAGEMENT_FLOOR_PENALTY, 1.0);
    }
    1.0 + (rate / ENGAGEMENT_RATE_BASELINE).clamp(0.0, 1.0) * ENGAGEMENT_MAX_BOOST
}

/// Session fatigue on the same topic and novelty in a long binge.
fn freshness(
    vector: &ContentVector,
    personality: f64,
    session_topics: &[String],
    session_video_count: i32,
) -> f64 {
    let momentum = match primary_topic(vector) {
        Some(topic) => {
            let repeats = session_topics.iter().filter(|t| *t == topic).count();
            if repeats > 0 {
                #[allow(clippy::cast_precision_loss)]
                let fatigue = (-0.16 * repeats as f64).exp();
                fatigue.clamp(0.15, 1.0)
            } else {
                1.0
            }
        }
        None => 1.0,
    };
    let binge = if session_video_count > BINGE_THRESHOLD {
        1.0 + (1.0 - personality) * BINGE_NOVELTY_FACTOR
    } else {
        1.0
    };
    (momentum * binge).clamp(0.05, 1.3)
}

fn curiosity(personality: f64, brain_complexity: f64, video_complexity: f64) -> f64 {
    if personality <= 0.5 {
        return 0.0;
    }
    let difference = (brain_complexity - video_complexity).abs();
    if difference <= 0.2 {
        return 0.0;
    }
    let ramp = ((difference - 0.2) / 0.3).clamp(0.0, 1.0);
    let safety = ((personality - 0.5) / 0.3).clamp(0.0, 1.0);
    CURIOSITY_GAP_BONUS * ramp * safety
}

fn serendipity(novelty: f64, context: f64) -> f64 {
    let novelty_ramp = ((novelty - 0.4) / 0.4).clamp(0.0, 1.0);
    let context_ramp = ((context - 0.3) / 0.4).clamp(0.0, 1.0);
    SERENDIPITY_BONUS * novelty_ramp * context_ramp
}

fn watched_penalty(percent_watched: Option<f32>) -> f64 {
    match percent_watched {
        Some(percent) if percent > WATCHED_THRESHOLD_FULL => WATCHED_PENALTY_FULL,
        Some(percent) if percent > WATCHED_THRESHOLD_HALF => WATCHED_PENALTY_HALF,
        Some(percent) if percent > WATCHED_THRESHOLD_SAMPLED => WATCHED_PENALTY_SAMPLED,
        _ => 1.0,
    }
}

/// A card much like what channels the viewer rejected are about.
fn anti_recommendation(vector: &ContentVector, brain: &UserBrain) -> f64 {
    let max_similarity = brain
        .channel_scores
        .iter()
        .filter(|(_, score)| **score < NOT_INTERESTED_CHANNEL_FLOOR)
        .filter_map(|(channel, _)| brain.channel_topic_profiles.get(channel))
        .map(|profile| {
            let negative = ContentVector {
                topics: profile.clone(),
                ..ContentVector::default()
            };
            calculate_cosine_similarity(&negative, vector)
        })
        .fold(0.0, f64::max);
    if max_similarity > ANTI_REC_PENALTY_THRESHOLD {
        let strength = ((max_similarity - ANTI_REC_PENALTY_THRESHOLD)
            / (1.0 - ANTI_REC_PENALTY_THRESHOLD))
            .clamp(0.0, 1.0);
        1.0 - strength * (1.0 - ANTI_REC_PENALTY)
    } else {
        1.0
    }
}

/// A topic the viewer kept watching this session gets a little more, unless it already leads.
fn momentum_boost(vector: &ContentVector, momentum: &[MomentumEntry], personality: f64) -> f64 {
    if momentum.len() < MOMENTUM_THRESHOLD {
        return 0.0;
    }
    let Some(topic) = primary_topic(vector) else {
        return 0.0;
    };
    let recent = &momentum[momentum.len().saturating_sub(MOMENTUM_WINDOW)..];
    let positives = recent
        .iter()
        .filter(|entry| &entry.topic == topic && entry.positive)
        .count();
    if positives < MOMENTUM_THRESHOLD {
        return 0.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let raw = (positives as f64 / MOMENTUM_WINDOW as f64 * MOMENTUM_BOOST).min(MOMENTUM_BOOST);
    let dominance = if personality > 0.6 {
        (1.0 - (personality - 0.6) / 0.4).clamp(0.0, 1.0)
    } else {
        1.0
    };
    raw * dominance
}

/// A card shown recently or often waits, recovering over two weeks; a thin pool relaxes it.
#[must_use]
pub fn feed_history_penalty(entry: Option<&FeedEntry>, now_ms: u64, pool_size: usize) -> f64 {
    let Some(entry) = entry else {
        return 1.0;
    };
    #[allow(clippy::cast_precision_loss)]
    let hours = now_ms.saturating_sub(entry.last_shown) as f64 / HOUR_MS;
    let relaxation: f64 = if pool_size < 10 {
        0.4
    } else if pool_size < 25 {
        0.7
    } else {
        1.0
    };
    let repeated: f64 = if entry.show_count >= 5 {
        0.7
    } else if entry.show_count >= 3 {
        0.85
    } else {
        1.0
    };
    let base: f64 = if hours < 2.0 {
        0.05
    } else if hours < 8.0 {
        0.15
    } else if hours < 24.0 {
        0.35
    } else if hours < 72.0 {
        0.60
    } else if hours < 168.0 {
        0.80
    } else if hours < 336.0 {
        0.92
    } else {
        1.0
    };
    let penalty = (base * repeated).clamp(0.0, 1.0);
    penalty + (1.0 - penalty) * (1.0 - relaxation)
}

/// A card shown several times lately and never watched is quietly uninteresting.
fn implicit_disinterest(entry: Option<&FeedEntry>, watched: bool, now_ms: u64) -> f64 {
    let Some(entry) = entry else {
        return 1.0;
    };
    if watched {
        return 1.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let hours = now_ms.saturating_sub(entry.last_shown) as f64 / HOUR_MS;
    if hours > IMPLICIT_DISINTEREST_WINDOW_HOURS {
        1.0
    } else if entry.show_count >= IMPLICIT_DISINTEREST_THRESHOLD_HEAVY {
        IMPLICIT_DISINTEREST_PENALTY_HEAVY
    } else if entry.show_count >= IMPLICIT_DISINTEREST_THRESHOLD_LIGHT {
        IMPLICIT_DISINTEREST_PENALTY_LIGHT
    } else {
        1.0
    }
}

/// A mature profile lowers what shares next to nothing with it; subscriptions are exempt.
fn relevance_floor(personality: f64, total_interactions: i32, is_subscription: bool) -> f64 {
    if is_subscription || total_interactions < RELEVANCE_FLOOR_MIN_INTERACTIONS {
        1.0
    } else if personality < RELEVANCE_FLOOR_SEVERE_THRESHOLD {
        RELEVANCE_FLOOR_SEVERE_PENALTY
    } else if personality < RELEVANCE_FLOOR_MODERATE_THRESHOLD {
        RELEVANCE_FLOOR_MODERATE_PENALTY
    } else {
        1.0
    }
}

fn topic_score(brain: &UserBrain, topic: &str) -> f64 {
    if let Some(&weight) = brain.global_vector.topics.get(topic) {
        return weight;
    }
    brain
        .global_vector
        .topics
        .iter()
        .find(|(key, _)| strip_domain_tag(key) == topic)
        .map_or(0.0, |(_, &weight)| weight)
}

fn has_confirmed_evidence(topic: &str, brain: &UserBrain, picks: &HashSet<String>) -> bool {
    let base = strip_domain_tag(topic);
    if picks.iter().any(|pick| pick.eq_ignore_ascii_case(&base)) {
        return true;
    }
    brain
        .topic_evidence
        .get(&base)
        .or_else(|| brain.topic_evidence.get(topic))
        .is_some_and(|evidence| {
            evidence.explicit_signals > 0
                || evidence.watch_signals >= 2
                || evidence.video_ids.len() >= 2
                || evidence.positive_score >= 1.2
        })
}

/// On a mature profile, a card whose topics are mostly brand-new and unconfirmed waits a little.
fn topic_probation(vector: &ContentVector, brain: &UserBrain, picks: &HashSet<String>) -> f64 {
    if brain.total_interactions < COLD_START_THRESHOLD {
        return 1.0;
    }
    let mut top: Vec<String> = Vec::new();
    for key in ranked_topics(vector).into_iter().take(4) {
        let base = strip_domain_tag(key);
        if is_topic_sized(&base) && !top.contains(&base) {
            top.push(base);
        }
    }
    if top.is_empty() {
        return 1.0;
    }
    let probationary = top
        .iter()
        .filter(|topic| {
            let score = topic_score(brain, topic);
            (0.015..=0.20).contains(&score) && !has_confirmed_evidence(topic, brain, picks)
        })
        .count();
    if probationary == 0 {
        return 1.0;
    }
    #[allow(clippy::cast_precision_loss)]
    let ratio = probationary as f64 / top.len() as f64;
    if ratio <= 0.5 {
        1.0
    } else {
        (1.0 - ratio * 0.20).clamp(0.75, 1.0)
    }
}

/// Beta-posterior exploration: high while a topic's evidence is thin, low once it is clearly liked
/// or disliked, so rejected topics are not re-surfaced as exploration.
fn exploration_bonus(vector: &ContentVector, brain: &UserBrain, explore_weight: f64) -> f64 {
    if explore_weight <= 0.0 || brain.total_interactions < COLD_START_THRESHOLD {
        return 0.0;
    }
    let Some(primary) = primary_topic(vector).map(|key| strip_domain_tag(key)) else {
        return 0.0;
    };
    let evidence = brain.topic_evidence.get(&primary);
    let alpha = 1.0 + f64::from(evidence.map_or(0, |e| e.positive_signals));
    let beta = 1.0 + f64::from(evidence.map_or(0, |e| e.negative_signals));
    let total = alpha + beta;
    let std = (alpha * beta / (total * total * (total + 1.0))).sqrt();
    (EXPLORE_BETA_C * std * explore_weight).min(EXPLORE_MAX_BONUS)
}

/// A lift for the card's topic pairs the viewer watches together, capped per card.
fn affinity_boost(
    vector: &ContentVector,
    neighbours: &HashMap<String, HashMap<String, f64>>,
) -> f64 {
    let mut topics: Vec<String> = Vec::new();
    for key in vector.topics.keys() {
        let base = strip_domain_tag(key);
        if !topics.contains(&base) {
            topics.push(base);
        }
    }
    let mut boost = 0.0;
    for (i, topic) in topics.iter().enumerate() {
        let Some(of_topic) = neighbours.get(topic) else {
            continue;
        };
        for other in &topics[i + 1..] {
            if let Some(affinity) = of_topic.get(other) {
                boost += affinity * AFFINITY_BOOST_PER_PAIR;
            }
        }
    }
    boost.min(AFFINITY_MAX_BOOST_PER_VIDEO)
}

/// A soft category mismatch; subscriptions and picked topics are exempt.
fn category_term(c: &Candidate, p: &ScoringParams, is_sub: bool) -> f64 {
    if is_sub
        || p.picks
            .iter()
            .any(|pick| c.vector.topics.contains_key(pick))
    {
        return 1.0;
    }
    let category = id_of(c.category)
        .map(|id| ChannelCategory {
            id: id.to_string(),
            confidence: 1.0,
        })
        .or_else(|| (p.category_of)(c.channel_id));
    category.map_or(1.0, |category| {
        category_factor(&p.brain.category_affinity, &category)
    })
}
