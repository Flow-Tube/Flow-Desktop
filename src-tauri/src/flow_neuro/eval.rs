//! Offline evaluation harness for the ranker.
//!
//! Replays a labeled candidate set through `ranker::score_candidate` and computes standard
//! information-retrieval metrics (NDCG@k, intra-list diversity, topic coverage). Its purpose is to
//! turn the engine's hand-tuned constants into something measurable: the `#[cfg(test)]` gates below
//! fail if a change regresses ranking quality, and developers can reuse `evaluate` to compare
//! parameter choices on fixtures instead of guessing.

use std::collections::HashSet;

use crate::flow_neuro::ranker::{Candidate, RankInputs, ScoringWeights, score_candidate};
use crate::flow_neuro::scoring::{
    ContentVector, UserBrain, calculate_cosine_similarity, strip_domain_tag,
};

/// A candidate plus its ground-truth relevance label (e.g. derived from how a user actually
/// engaged with it). Relevance drives the NDCG calculation; it is not seen by the ranker.
pub struct EvalCandidate {
    pub vector: ContentVector,
    pub channel_id: String,
    pub is_subscription: bool,
    pub relevance: f64,
}

pub struct EvalMetrics {
    pub ndcg: f64,
    pub intra_list_diversity: f64,
    pub topic_coverage: f64,
}

fn dcg_at_k(relevances: &[f64], k: usize) -> f64 {
    relevances
        .iter()
        .take(k)
        .enumerate()
        .map(|(i, &rel)| rel / (i as f64 + 2.0).log2())
        .sum()
}

/// Normalized discounted cumulative gain — 1.0 when the ranking is perfectly ordered by relevance.
pub fn ndcg_at_k(ranked_relevances: &[f64], k: usize) -> f64 {
    let dcg = dcg_at_k(ranked_relevances, k);
    let mut ideal = ranked_relevances.to_vec();
    ideal.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let idcg = dcg_at_k(&ideal, k);
    if idcg <= 0.0 { 0.0 } else { dcg / idcg }
}

/// Mean pairwise dissimilarity (`1 - cosine`) across a result list. 0 = identical, ~1 = disjoint.
pub fn intra_list_diversity(vectors: &[&ContentVector]) -> f64 {
    let n = vectors.len();
    if n < 2 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut pairs = 0;
    for i in 0..n {
        for j in (i + 1)..n {
            sum += 1.0 - calculate_cosine_similarity(vectors[i], vectors[j]);
            pairs += 1;
        }
    }
    sum / pairs as f64
}

fn primary_topic(vector: &ContentVector) -> Option<String> {
    vector
        .topics
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(topic, _)| strip_domain_tag(topic))
}

/// Fraction of the result list occupied by distinct primary topics (1.0 = every item a new topic).
pub fn topic_coverage(vectors: &[&ContentVector]) -> f64 {
    if vectors.is_empty() {
        return 0.0;
    }
    let distinct: HashSet<String> = vectors.iter().filter_map(|v| primary_topic(v)).collect();
    distinct.len() as f64 / vectors.len() as f64
}

/// Scores every candidate with the live ranker (deterministic, no jitter), orders by score, and
/// reports ranking-quality metrics against the candidates' relevance labels.
pub fn evaluate(brain: &UserBrain, candidates: &[EvalCandidate], k: usize) -> EvalMetrics {
    let time_context = ContentVector::default();
    let inputs = RankInputs {
        brain,
        time_context: &time_context,
        weights: ScoringWeights {
            personality: 0.4,
            context: 0.4,
            novelty: 0.2,
        },
        now_ms: 0,
        is_onboarding: false,
        onboarding_warmup: 0.5,
        session_topics: &[],
        session_video_count: 0,
        candidate_pool_size: candidates.len(),
        exploration_scale: 0.6,
        pick_keys: &HashSet::new(),
        spec: &brain.key_spec(),
    };

    let scores: Vec<f64> = candidates
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let id = i.to_string();
            let candidate = Candidate {
                video_vector: &c.vector,
                video_id: &id,
                title: "",
                channel_name: "",
                channel_id: &c.channel_id,
                duration_seconds: Some(600),
                published_text: "1 day ago",
                view_count: 0,
                is_subscription: c.is_subscription,
                impression: None,
            };
            score_candidate(&inputs, &candidate)
        })
        .collect();

    let mut order: Vec<usize> = (0..candidates.len()).collect();
    order.sort_by(|&a, &b| {
        scores[b]
            .partial_cmp(&scores[a])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let ranked_relevances: Vec<f64> = order.iter().map(|&i| candidates[i].relevance).collect();
    let top_k: Vec<&ContentVector> = order
        .iter()
        .take(k)
        .map(|&i| &candidates[i].vector)
        .collect();

    EvalMetrics {
        ndcg: ndcg_at_k(&ranked_relevances, k),
        intra_list_diversity: intra_list_diversity(&top_k),
        topic_coverage: topic_coverage(&top_k),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn topic_vector(topic: &str) -> ContentVector {
        let mut vector = ContentVector::default();
        vector.topics.insert(topic.to_string(), 1.0);
        vector
    }

    #[test]
    fn ndcg_is_one_for_ideal_order_and_less_when_reversed() {
        assert!((ndcg_at_k(&[3.0, 2.0, 1.0, 0.0], 4) - 1.0).abs() < 1e-9);
        assert!(ndcg_at_k(&[0.0, 1.0, 2.0, 3.0], 4) < 1.0);
    }

    #[test]
    fn ild_is_zero_for_identical_and_high_for_disjoint() {
        let a = topic_vector("guitar");
        let b = topic_vector("guitar");
        let c = topic_vector("welding");
        assert!(intra_list_diversity(&[&a, &b]) < 0.05);
        assert!(intra_list_diversity(&[&a, &c]) > 0.5);
    }

    #[test]
    fn ranker_places_on_interest_candidates_on_top() {
        let mut brain = UserBrain::default();
        brain.total_interactions = 120;
        brain.global_vector.topics.insert("guitar".to_string(), 0.9);
        brain.global_vector.topics.insert("music".to_string(), 0.7);

        let candidates = vec![
            EvalCandidate {
                vector: topic_vector("welding"),
                channel_id: "c1".to_string(),
                is_subscription: false,
                relevance: 0.0,
            },
            EvalCandidate {
                vector: topic_vector("guitar"),
                channel_id: "c2".to_string(),
                is_subscription: false,
                relevance: 1.0,
            },
            EvalCandidate {
                vector: topic_vector("cooking"),
                channel_id: "c3".to_string(),
                is_subscription: false,
                relevance: 0.0,
            },
            EvalCandidate {
                vector: topic_vector("music"),
                channel_id: "c4".to_string(),
                is_subscription: false,
                relevance: 1.0,
            },
        ];

        let metrics = evaluate(&brain, &candidates, 4);
        // A guitar/music-loving profile must rank those above welding/cooking.
        assert!(metrics.ndcg > 0.9, "ndcg was {}", metrics.ndcg);
        assert!(metrics.topic_coverage > 0.0);
    }

    /// End to end through the text pipeline: a brain learned from titles ranks unseen titles on the
    /// same subjects above unrelated ones, however the titles inflect their words.
    #[test]
    fn a_brain_learned_from_titles_ranks_related_titles_first() {
        use crate::flow_neuro::features::{TopicReader, VideoText, extract_features};
        use crate::flow_neuro::scoring::IdfSnapshot;
        use crate::flow_neuro::signals::{InteractionType, apply_interaction};

        let watched = [
            ("Restoring Vintage Guitars", "Guitar Workshop"),
            ("Fingerstyle Guitar Lesson for Beginners", "Acoustic Life"),
            ("Best Electric Guitars Under 500", "Gear Review"),
            ("Lofi Hip Hop Beats to Study", "Chillhop Music"),
            ("Lo-Fi Hip Hop Radio for Relaxing", "Lofi Girl"),
            ("Learning Rust Programming in 2025", "Code Academy"),
            (
                "Rust Programming Tutorial: Ownership Explained",
                "Let's Get Rusty",
            ),
        ];
        let mut brain = UserBrain::default();
        for round in 0..6 {
            for (i, (title, channel)) in watched.iter().enumerate() {
                apply_interaction(
                    &mut brain,
                    &format!("w{round}-{i}"),
                    title,
                    channel,
                    &format!("ch{i}"),
                    None,
                    Some(600),
                    false,
                    false,
                    InteractionType::Watched,
                    0.9,
                );
            }
        }
        let idf = IdfSnapshot {
            word_frequencies: brain.idf_word_frequency.clone(),
            total_documents: brain.idf_total_documents,
        };
        let reader = TopicReader {
            spec: brain.key_spec(),
            idf: &idf,
        };
        let candidates: Vec<EvalCandidate> = [
            (
                "Guitar Restoration: Fixing an Old Acoustic",
                "Luthier Bench",
                1.0,
            ),
            ("Top 10 Guitar Riffs for Beginners", "Riff Daily", 1.0),
            ("Lofi Hip Hop Mix for Coding", "Beat Tape", 1.0),
            (
                "Rust Ownership and Borrowing Deep Dive",
                "Systems Talk",
                1.0,
            ),
            ("Welding Basics for Beginners", "Shop Floor", 0.0),
            ("Easy Pasta Recipes at Home", "Home Kitchen", 0.0),
            ("Crypto Market Update Today", "Coin Desk", 0.0),
            ("Makeup Tutorial Fall Look", "Glam Studio", 0.0),
        ]
        .iter()
        .enumerate()
        .map(|(i, (title, channel, relevance))| EvalCandidate {
            vector: extract_features(
                &VideoText {
                    title,
                    channel_name: channel,
                    description: None,
                    duration_seconds: Some(600),
                    is_live: false,
                    is_short: false,
                },
                &reader,
            ),
            channel_id: format!("k{i}"),
            is_subscription: false,
            relevance: *relevance,
        })
        .collect();

        let at_8 = evaluate(&brain, &candidates, 8);
        let at_4 = evaluate(&brain, &candidates, 4);
        println!(
            "titles: ndcg@8 {:.4} ild@8 {:.4} coverage@8 {:.4} | ndcg@4 {:.4} ild@4 {:.4} coverage@4 {:.4}",
            at_8.ndcg,
            at_8.intra_list_diversity,
            at_8.topic_coverage,
            at_4.ndcg,
            at_4.intra_list_diversity,
            at_4.topic_coverage
        );
        // The key spec 1 build scored 0.955 and 0.832 here (origin/main 4476a68).
        assert!(at_8.ndcg >= 0.95, "ndcg@8 was {}", at_8.ndcg);
        assert!(at_4.ndcg >= 0.83, "ndcg@4 was {}", at_4.ndcg);
    }
}
