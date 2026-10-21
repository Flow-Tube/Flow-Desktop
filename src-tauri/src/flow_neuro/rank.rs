//! One ranking pass over feed candidates, in Flow for Android's order (`FlowNeuroEngine.rank`):
//! hard filters, the seen gate, topic blocks on the candidate's leading topics, a lane's relevance
//! floor, scoring with jitter relative to the median score, then diversity.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::categories::ChannelCategory;
use crate::flow_neuro::clusters::{ClusterInputs, build_clusters};
use crate::flow_neuro::diversity::apply_smart_diversity;
use crate::flow_neuro::features::{TopicReader, VideoText, extract_features_with_prior, pick_keys};
use crate::flow_neuro::gates::{
    BlockedMatchers, UNRELATED_SIMILARITY, adaptive_jitter, apply_seen_gate, blocks_topics,
    is_known_channel, topic_similarity,
};
use crate::flow_neuro::interest_share;
use crate::flow_neuro::ranker::{
    Candidate, MomentumEntry, ScoringParams, affinity_neighbours, score_candidate,
};
use crate::flow_neuro::scoring::{
    CHANNEL_SUPPRESSION_DAYS, COLD_START_THRESHOLD, ContentVector, FlowPersona, IdfSnapshot,
    ONBOARDING_WARMUP_INTERACTIONS, ScoredVideo, TimeBucket, UserBrain, classify_persona,
    is_known_short, time_bucket_confidence,
};
use crate::flow_neuro::specificity::specificity;
use crate::flow_neuro::vector_math::{RECENT_SHARE, blend};
use crate::models::video::VideoSummary;

const TASTE_WEIGHT: f64 = 0.8;
const NOVELTY_WEIGHT: f64 = 0.2;
const DAY_MS: u64 = 86_400_000;
const FEED_OVERLAP_WINDOW_MS: u64 = 48 * 3_600_000;
const MIN_MEDIAN_SCORE: f64 = 0.05;
/// Skips in a row that earn the feed one more exploration slot.
const BOREDOM_SKIPS: i32 = 5;

/// What this session has done so far.
pub struct SessionState<'a> {
    pub topics: &'a [String],
    pub video_count: i32,
    pub momentum: &'a [MomentumEntry],
}

/// Everything one pass reads besides the candidates.
pub struct RankContext<'a> {
    pub brain: &'a UserBrain,
    pub user_subs: &'a HashSet<String>,
    pub now_ms: u64,
    /// Above 0, candidates sharing less with the viewer's interests are left out (a Home lane).
    pub min_relevance: f64,
    /// Shorts keep channels the viewer suppressed for a while, so the feed is not starved.
    pub keep_suppressed_channels: bool,
    pub session: SessionState<'a>,
    pub category_of: &'a dyn Fn(&str) -> Option<ChannelCategory>,
    pub co_watch_prior: &'a HashMap<String, f64>,
    /// Confirmed pairs of channels watched together, which link interests into groups.
    pub channel_edges: &'a HashMap<String, f64>,
    /// What a video read as when it was watched, for a candidate met again with its title alone.
    pub stored_topics: &'a dyn Fn(&str) -> Option<HashMap<String, f64>>,
    pub seed: u64,
}

/// "1.2M views" as a number; 0 when unknown.
#[must_use]
pub fn view_count_of(text: Option<&str>) -> u64 {
    let Some(text) = text.map(str::to_lowercase) else {
        return 0;
    };
    let digits: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let number: f64 = digits.parse().unwrap_or(0.0);
    let scale = if text.contains('m') {
        1_000_000.0
    } else if text.contains('k') {
        1_000.0
    } else if text.contains('b') {
        1_000_000_000.0
    } else {
        1.0
    };
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let count = (number * scale) as u64;
    count
}

fn channel_of(video: &VideoSummary) -> &str {
    video.channel_id.as_deref().unwrap_or(&video.id)
}

/// A seeded generator, so one pass is reproducible from its seed.
struct Jitter(u64);

impl Jitter {
    fn next(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        #[allow(clippy::cast_precision_loss)]
        let unit = (self.0 >> 11) as f64 / (1u64 << 53) as f64;
        unit
    }
}

fn passes_hard_filters(
    ctx: &RankContext,
    video: &VideoSummary,
    matchers: &BlockedMatchers,
    spec: &crate::flow_neuro::keyspec::KeySpec,
) -> bool {
    let brain = ctx.brain;
    let channel = channel_of(video);
    let channel_cutoff = ctx.now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * DAY_MS);
    !brain.suppressed_video_ids.contains_key(&video.id)
        && (ctx.keep_suppressed_channels
            || brain
                .suppressed_channels
                .get(channel)
                .is_none_or(|at| *at <= channel_cutoff))
        && !brain.blocked_channels.contains(channel)
        && !matchers.blocks_text(&video.title, &video.channel_name, spec)
}

fn feed_overlap(brain: &UserBrain, candidates: &[VideoSummary], now_ms: u64) -> f64 {
    if candidates.is_empty() || brain.feed_history.is_empty() {
        return 0.0;
    }
    let ids: HashSet<&str> = candidates.iter().map(|video| video.id.as_str()).collect();
    let overlap = ids
        .iter()
        .filter(|id| {
            brain.feed_history.get(**id).is_some_and(|entry| {
                now_ms.saturating_sub(entry.last_shown) < FEED_OVERLAP_WINDOW_MS
            })
        })
        .count();
    #[allow(clippy::cast_precision_loss)]
    let ratio = overlap as f64 / ids.len() as f64;
    ratio.clamp(0.0, 1.0)
}

/// The median score, at least [`MIN_MEDIAN_SCORE`]: jitter scales with it, so noise stays in
/// proportion to the scores it shuffles.
fn median_of(scores: &[f64]) -> f64 {
    let mut sorted = scores.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted
        .get(sorted.len() / 2)
        .copied()
        .unwrap_or(0.0)
        .max(MIN_MEDIAN_SCORE)
}

/// The candidates in feed order; some may be left out.
#[must_use]
pub fn rank(ctx: &RankContext, candidates: Vec<VideoSummary>) -> Vec<VideoSummary> {
    let brain = ctx.brain;
    let spec = brain.key_spec();
    let matchers = BlockedMatchers::new(&brain.blocked_topics, &spec);
    let overlap = feed_overlap(brain, &candidates, ctx.now_ms);
    let filtered: Vec<VideoSummary> = candidates
        .into_iter()
        .filter(|video| passes_hard_filters(ctx, video, &matchers, &spec))
        .collect();
    let gated = apply_seen_gate(filtered, &brain.feed_history, ctx.now_ms, |video| &video.id);
    let pool_size = gated.len();

    let interests: HashMap<String, f64> = brain
        .interests()
        .map(|(key, weight)| (key.clone(), weight))
        .collect();
    let table = specificity(&spec);
    let specific = |key: &str| table.of(key);
    let mature = brain.total_interactions >= COLD_START_THRESHOLD;
    let vectors = relevant_vectors(ctx, gated, &interests, &specific);

    let picks = pick_keys(brain);
    let taste = blend(&brain.global_vector, &brain.recent_vector, RECENT_SHARE);
    let bucket = TimeBucket::current();
    let context = brain.time_vectors.get(&bucket).cloned().unwrap_or_default();
    let w_context = TASTE_WEIGHT * 0.5 * time_bucket_confidence(brain, bucket);
    let is_onboarding = brain.total_interactions < ONBOARDING_WARMUP_INTERACTIONS;
    let params = ScoringParams {
        brain,
        user_subs: ctx.user_subs,
        taste: &taste,
        context: &context,
        w_personality: TASTE_WEIGHT - w_context,
        w_context,
        w_novelty: NOVELTY_WEIGHT,
        is_cold_start: !mature,
        is_onboarding,
        onboarding_warmup: if is_onboarding {
            1.0 - f64::from(brain.total_interactions) / f64::from(ONBOARDING_WARMUP_INTERACTIONS)
                * 0.5
        } else {
            0.5
        },
        picks: &picks,
        session_topics: ctx.session.topics,
        session_video_count: ctx.session.video_count,
        momentum: ctx.session.momentum,
        candidate_pool_size: pool_size,
        now_ms: ctx.now_ms,
        explore_weight: match classify_persona(brain) {
            FlowPersona::Explorer => 1.0,
            FlowPersona::Specialist => 0.3,
            FlowPersona::Initiate => 0.0,
            _ => 0.6,
        },
        category_of: ctx.category_of,
        co_watch_prior: ctx.co_watch_prior,
        spec: &spec,
        affinity_neighbours: affinity_neighbours(brain),
    };

    let base: Vec<f64> = vectors
        .iter()
        .map(|(video, vector)| score_candidate(&params, &candidate(video, vector)))
        .collect();
    let jitter_unit = adaptive_jitter(brain.total_interactions, overlap) * median_of(&base);
    let mut jitter = Jitter(ctx.seed);

    let mut by_id: HashMap<String, VideoSummary> = HashMap::with_capacity(vectors.len());
    let mut scored: Vec<ScoredVideo> = Vec::with_capacity(vectors.len());
    for ((video, vector), score) in vectors.into_iter().zip(base) {
        scored.push(ScoredVideo {
            id: video.id.clone(),
            title: video.title.clone(),
            channel_id: channel_of(&video).to_string(),
            score: score + jitter.next() * jitter_unit,
            vector,
        });
        by_id.insert(video.id.clone(), video);
    }

    let extra_exploration = usize::from(brain.consecutive_skips >= BOREDOM_SKIPS);
    let is_unrelated = |candidate: &ScoredVideo| {
        mature
            && !is_known_channel(&candidate.channel_id, ctx.user_subs, &brain.channel_scores)
            && topic_similarity(&interests, &candidate.vector, Some(&specific))
                < UNRELATED_SIMILARITY
    };
    apply_smart_diversity(
        scored,
        &spec,
        extra_exploration,
        &is_unrelated,
        ctx.min_relevance > 0.0,
    )
    .into_iter()
    .filter_map(|id| by_id.remove(&id))
    .collect()
}

/// `ranked` with its places shared between the viewer's lasting interests, so the strongest one
/// does not fill every page.
#[must_use]
pub fn share_by_interest(ctx: &RankContext, ranked: Vec<VideoSummary>) -> Vec<VideoSummary> {
    let brain = ctx.brain;
    let interests: HashMap<String, f64> = brain
        .interests()
        .map(|(key, weight)| (key.clone(), weight))
        .collect();
    let clusters = build_clusters(&ClusterInputs {
        topic_scores: &interests,
        affinities: &brain.topic_affinities,
        channel_topic_profiles: &brain.channel_topic_profiles,
        channel_edges: ctx.channel_edges,
        spec: &brain.key_spec(),
    });
    let weights = interest_share::weights(&clusters);
    if weights.len() < 2 {
        return ranked;
    }
    let group_by_topic: HashMap<String, String> = clusters
        .iter()
        .filter(|cluster| weights.contains_key(&cluster.representative))
        .flat_map(|cluster| {
            cluster
                .topics
                .iter()
                .map(|topic| (topic.clone(), cluster.representative.clone()))
        })
        .collect();
    let idf = IdfSnapshot {
        word_frequencies: brain.idf_word_frequency.clone(),
        total_documents: brain.idf_total_documents,
    };
    let reader = TopicReader {
        spec: brain.key_spec(),
        idf: &idf,
    };
    let topics_by_id: HashMap<String, HashMap<String, f64>> = ranked
        .iter()
        .map(|video| (video.id.clone(), vector_of(ctx, video, &reader).topics))
        .collect();
    interest_share::interleave(ranked, &weights, |video| {
        topics_by_id
            .get(&video.id)
            .and_then(|topics| interest_share::group_of(topics, &group_by_topic))
    })
}

/// Each candidate with its vector, leaving out those whose leading topics are blocked and, in a
/// lane with a relevance floor on a mature profile, those sharing too little with the interests.
fn relevant_vectors(
    ctx: &RankContext,
    candidates: Vec<VideoSummary>,
    interests: &HashMap<String, f64>,
    specific: &dyn Fn(&str) -> f64,
) -> Vec<(VideoSummary, ContentVector)> {
    let brain = ctx.brain;
    let spec = brain.key_spec();
    let idf = IdfSnapshot {
        word_frequencies: brain.idf_word_frequency.clone(),
        total_documents: brain.idf_total_documents,
    };
    let reader = TopicReader {
        spec: spec.clone(),
        idf: &idf,
    };
    let blocked_keys: HashSet<String> = brain
        .blocked_topics
        .iter()
        .map(|topic| spec.key_of(topic))
        .collect();
    let floored = ctx.min_relevance > 0.0 && brain.total_interactions >= COLD_START_THRESHOLD;
    candidates
        .into_iter()
        .map(|video| {
            let vector = vector_of(ctx, &video, &reader);
            (video, vector)
        })
        .filter(|(_, vector)| !blocks_topics(vector, &blocked_keys))
        .filter(|(video, vector)| {
            !floored
                || is_known_channel(channel_of(video), ctx.user_subs, &brain.channel_scores)
                || topic_similarity(interests, vector, Some(specific)) >= ctx.min_relevance
        })
        .collect()
}

/// A candidate's vector from its title, with what its channel is known for; a video watched before
/// keeps the topics it read as then.
fn vector_of(ctx: &RankContext, video: &VideoSummary, reader: &TopicReader) -> ContentVector {
    let mut vector = extract_features_with_prior(
        &VideoText {
            title: &video.title,
            channel_name: &video.channel_name,
            description: None,
            duration_seconds: video.duration_seconds,
            is_live: video.is_live,
            is_short: is_known_short(video.duration_seconds),
        },
        reader,
        ctx.brain.channel_topic_profiles.get(channel_of(video)),
    );
    if let Some(topics) = (ctx.stored_topics)(&video.id) {
        vector.topics = topics;
    }
    vector
}

fn candidate<'a>(video: &'a VideoSummary, vector: &'a ContentVector) -> Candidate<'a> {
    Candidate {
        video_id: &video.id,
        channel_id: channel_of(video),
        vector,
        upload_date: video.published_text.as_deref().unwrap_or(""),
        view_count: view_count_of(video.view_count_text.as_deref()),
        // List renderers carry neither; a category still comes from the channel's.
        like_count: 0,
        category: None,
        is_live: video.is_live,
        is_short: is_known_short(video.duration_seconds),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(index: usize) -> VideoSummary {
        let words = [
            "guitar",
            "chess",
            "sourdough",
            "rust",
            "minecraft",
            "tennis",
            "anime",
            "physics",
        ];
        VideoSummary {
            id: format!("v{index}"),
            title: format!(
                "{} {} lesson number {index}",
                words[index % words.len()],
                words[(index / 3) % words.len()]
            ),
            channel_name: format!("Channel {}", index % 40),
            channel_id: Some(format!("UC{}", index % 40)),
            thumbnail_url: None,
            duration_seconds: Some(600),
            published_text: Some("2 days ago".into()),
            view_count_text: Some("12K views".into()),
            channel_avatar_url: None,
            is_live: false,
        }
    }

    fn context<'a>(
        brain: &'a UserBrain,
        subs: &'a HashSet<String>,
        prior: &'a HashMap<String, f64>,
        min_relevance: f64,
    ) -> RankContext<'a> {
        RankContext {
            brain,
            user_subs: subs,
            now_ms: 1_800_000_000_000,
            min_relevance,
            keep_suppressed_channels: false,
            session: SessionState {
                topics: &[],
                video_count: 0,
                momentum: &[],
            },
            category_of: &|_| None,
            co_watch_prior: prior,
            channel_edges: prior,
            stored_topics: &|_| None,
            seed: 7,
        }
    }

    fn mature_brain() -> UserBrain {
        let mut brain = UserBrain {
            total_interactions: 200,
            ..UserBrain::default()
        };
        brain.global_vector.topics =
            [("guitar".to_string(), 0.7), ("chess".to_string(), 0.4)].into();
        brain
    }

    #[test]
    fn a_relevant_lane_leaves_out_what_shares_nothing_with_the_viewer() {
        let brain = mature_brain();
        let subs = HashSet::new();
        let prior = HashMap::new();
        let candidates: Vec<VideoSummary> = (0..40).map(summary).collect();
        let ranked = rank(&context(&brain, &subs, &prior, 0.02), candidates);
        assert!(!ranked.is_empty());
        assert!(ranked.iter().all(|video| {
            let title = video.title.to_lowercase();
            title.contains("guitar") || title.contains("chess")
        }));
    }

    #[test]
    #[ignore = "timing; run with --release --ignored"]
    fn ranking_600_candidates_stays_under_10_ms() {
        let brain = mature_brain();
        let subs = HashSet::new();
        let prior = HashMap::new();
        let candidates: Vec<VideoSummary> = (0..600).map(summary).collect();
        // The first pass builds the per-spec word tables every later pass reuses.
        let _ = rank(&context(&brain, &subs, &prior, 0.0), candidates.clone());
        let started = std::time::Instant::now();
        let ranked = rank(&context(&brain, &subs, &prior, 0.0), candidates);
        let elapsed = started.elapsed();
        println!("ranked {} of 600 in {elapsed:?}", ranked.len());
        assert!(elapsed.as_millis() < 10, "{elapsed:?}");
    }
}
