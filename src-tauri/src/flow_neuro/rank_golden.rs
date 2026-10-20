//! Ranking against Flow for Android's `rank_golden.json` (written by its `NeuroRankGoldenTest`):
//! candidate scores for a mature and a cold-start brain, diversity orders, the seen gate, topic
//! relevance and topic blocks. Candidates carry their vectors, so the scores check scoring alone.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::flow_neuro::categories::ChannelCategory;
use crate::flow_neuro::diversity::apply_smart_diversity;
use crate::flow_neuro::features::pick_keys;
use crate::flow_neuro::gates::{BlockedMatchers, is_recently_seen, topic_similarity};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::ranker::{
    Candidate, MomentumEntry, ScoringParams, affinity_neighbours, score_candidate,
};
use crate::flow_neuro::scoring::{
    COLD_START_THRESHOLD, ContentVector, FeedEntry, ONBOARDING_WARMUP_INTERACTIONS,
    RejectionSignal, ScoredVideo, TopicEvidence, UserBrain, calculate_cosine_similarity,
};
use crate::flow_neuro::specificity::specificity;
use crate::flow_neuro::vector_math::{RECENT_SHARE, blend};

const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/rank_golden.json");
const TOLERANCE: f64 = 1e-9;

fn golden() -> Value {
    serde_json::from_str(GOLDEN).unwrap()
}

fn numbers(value: &Value) -> HashMap<String, f64> {
    value
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, number)| (key.clone(), number.as_f64().unwrap()))
        .collect()
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_string())
        .collect()
}

fn int(value: &Value) -> i32 {
    i32::try_from(value.as_i64().unwrap()).unwrap()
}

fn vector(value: &Value) -> ContentVector {
    ContentVector {
        topics: numbers(&value["topics"]),
        formats: strings(&value["formats"]).into_iter().collect(),
        duration: value["duration"].as_f64().unwrap(),
        pacing: value["pacing"].as_f64().unwrap(),
        complexity: value["complexity"].as_f64().unwrap(),
        is_live: value["isLive"].as_f64().unwrap(),
        ..ContentVector::default()
    }
}

fn feed_history(value: &Value) -> HashMap<String, FeedEntry> {
    value
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, entry)| {
            (
                id.clone(),
                FeedEntry {
                    last_shown: entry["lastShown"].as_u64().unwrap(),
                    show_count: int(&entry["showCount"]),
                },
            )
        })
        .collect()
}

fn brain(value: &Value, watch_history: &Value) -> UserBrain {
    let mut brain = UserBrain {
        global_vector: vector(&value["globalVector"]),
        recent_vector: vector(&value["recentVector"]),
        shorts_vector: vector(&value["shortsVector"]),
        channel_scores: numbers(&value["channelScores"]),
        topic_affinities: numbers(&value["topicAffinities"]),
        total_interactions: int(&value["totalInteractions"]),
        preferred_topics: strings(&value["preferredTopics"]).into_iter().collect(),
        feed_history: feed_history(&value["feedHistory"]),
        format_affinity: numbers(&value["formatAffinity"]),
        category_affinity: numbers(&value["categoryAffinity"]),
        ..UserBrain::default()
    };
    for (topic, e) in value["topicEvidence"].as_object().unwrap() {
        brain.topic_evidence.insert(
            topic.clone(),
            TopicEvidence {
                positive_signals: int(&e["positiveSignals"]),
                negative_signals: int(&e["negativeSignals"]),
                watch_signals: int(&e["watchSignals"]),
                explicit_signals: int(&e["explicitSignals"]),
                positive_score: e["positiveScore"].as_f64().unwrap(),
                video_ids: strings(&e["videoIds"]).into_iter().collect(),
                ..TopicEvidence::default()
            },
        );
    }
    for (key, signal) in value["rejectionPatterns"].as_object().unwrap() {
        brain.rejection_patterns.insert(
            key.clone(),
            RejectionSignal {
                count: int(&signal["count"]),
                last_rejected_at: signal["lastRejectedAt"].as_u64().unwrap(),
            },
        );
    }
    for (channel, profile) in value["channelTopicProfiles"].as_object().unwrap() {
        brain
            .channel_topic_profiles
            .insert(channel.clone(), numbers(profile));
    }
    for (id, entry) in watch_history.as_object().unwrap() {
        #[allow(clippy::cast_possible_truncation)]
        let percent = entry["percentWatched"].as_f64().unwrap() as f32;
        brain.watch_history_map.insert(id.clone(), percent);
    }
    brain
}

#[test]
fn candidate_scores_match_android() {
    let golden = golden();
    let spec = KeySpec::default();
    let mut mismatches = Vec::new();
    for case in golden["scores"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let brain = brain(&case["brain"], &case["watchHistory"]);
        let user_subs: HashSet<String> = strings(&case["userSubs"]).into_iter().collect();
        let context = vector(&case["context"]);
        let taste = blend(&brain.global_vector, &brain.recent_vector, RECENT_SHARE);
        let w_context = 0.8 * 0.5 * case["contextConfidence"].as_f64().unwrap();
        let is_onboarding = brain.total_interactions < ONBOARDING_WARMUP_INTERACTIONS;
        let picks = pick_keys(&brain);
        let session_topics = strings(&case["sessionTopics"]);
        let momentum: Vec<MomentumEntry> = case["momentum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| MomentumEntry {
                topic: entry["topic"].as_str().unwrap().to_string(),
                positive: entry["positive"].as_bool().unwrap(),
            })
            .collect();
        let categories: HashMap<String, ChannelCategory> = case["categoryOf"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(channel, category)| {
                (
                    channel.clone(),
                    ChannelCategory {
                        id: category["id"].as_str().unwrap().to_string(),
                        confidence: category["confidence"].as_f64().unwrap(),
                    },
                )
            })
            .collect();
        let category_of = |channel: &str| categories.get(channel).cloned();
        let co_watch_prior = numbers(&case["coWatchPrior"]);
        let params = ScoringParams {
            brain: &brain,
            user_subs: &user_subs,
            taste: &taste,
            context: &context,
            w_personality: 0.8 - w_context,
            w_context,
            w_novelty: 0.2,
            is_cold_start: brain.total_interactions < COLD_START_THRESHOLD,
            is_onboarding,
            onboarding_warmup: if is_onboarding {
                1.0 - f64::from(brain.total_interactions)
                    / f64::from(ONBOARDING_WARMUP_INTERACTIONS)
                    * 0.5
            } else {
                0.5
            },
            picks: &picks,
            session_topics: &session_topics,
            session_video_count: int(&case["sessionVideoCount"]),
            momentum: &momentum,
            candidate_pool_size: 40,
            now_ms: case["now"].as_u64().unwrap(),
            explore_weight: case["exploreWeight"].as_f64().unwrap(),
            category_of: &category_of,
            co_watch_prior: &co_watch_prior,
            spec: &spec,
            affinity_neighbours: affinity_neighbours(&brain),
        };
        for entry in case["candidates"].as_array().unwrap() {
            let video = &entry["video"];
            let vector = vector(&entry["vector"]);
            let candidate = Candidate {
                video_id: video["id"].as_str().unwrap(),
                channel_id: video["channelId"].as_str().unwrap(),
                vector: &vector,
                upload_date: video["uploadDate"].as_str().unwrap(),
                view_count: video["viewCount"].as_u64().unwrap(),
                like_count: video["likeCount"].as_u64().unwrap(),
                category: video["category"].as_str(),
                is_live: video["isLive"].as_bool().unwrap(),
                is_short: video["isShort"].as_bool().unwrap(),
            };
            let expected = entry["score"].as_f64().unwrap();
            let got = score_candidate(&params, &candidate);
            if (got - expected).abs() > TOLERANCE {
                mismatches.push(format!(
                    "{name} {}: android {expected}, desktop {got}",
                    candidate.video_id
                ));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} scores differ:\n{}",
        mismatches.len(),
        mismatches.join("\n")
    );
}

#[test]
fn diversity_orders_match_android() {
    let golden = golden();
    let spec = KeySpec::default();
    for case in golden["diversity"].as_array().unwrap() {
        let unrelated: HashSet<String> = strings(&case["unrelated"]).into_iter().collect();
        let scored: Vec<ScoredVideo> = case["scored"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| ScoredVideo {
                id: entry["video"]["id"].as_str().unwrap().to_string(),
                title: entry["video"]["title"].as_str().unwrap().to_string(),
                channel_id: entry["video"]["channelId"].as_str().unwrap().to_string(),
                score: entry["score"].as_f64().unwrap(),
                vector: vector(&entry["vector"]),
            })
            .collect();
        let extra = usize::try_from(case["extraExploration"].as_u64().unwrap()).unwrap();
        let drop_unrelated = case["dropUnrelated"].as_bool().unwrap();
        let order = apply_smart_diversity(
            scored,
            &spec,
            extra,
            &|candidate| unrelated.contains(&candidate.id),
            drop_unrelated,
        );
        assert_eq!(
            order,
            strings(&case["order"]),
            "extra {extra}, drop {drop_unrelated}"
        );
    }
}

#[test]
fn the_seen_gate_matches_android() {
    let golden = golden();
    let gate = &golden["seenGate"];
    let history = feed_history(&gate["history"]);
    let now = gate["now"].as_u64().unwrap();
    for (id, expected) in gate["recentlySeen"].as_object().unwrap() {
        assert_eq!(
            is_recently_seen(history.get(id), now),
            expected.as_bool().unwrap(),
            "{id}"
        );
    }
}

#[test]
fn topic_relevance_matches_android() {
    let golden = golden();
    let table = specificity(&KeySpec::default());
    let of = |key: &str| table.of(key);
    for case in golden["relevance"].as_array().unwrap() {
        let user = vector(&case["user"]);
        let probe = vector(&case["probe"]);
        for (name, got) in [
            ("plain", topic_similarity(&user.topics, &probe, None)),
            (
                "specific",
                topic_similarity(&user.topics, &probe, Some(&of)),
            ),
            ("cosine", calculate_cosine_similarity(&user, &probe)),
        ] {
            let expected = case[name].as_f64().unwrap();
            assert!(
                (got - expected).abs() < TOLERANCE,
                "{name} {:?}: android {expected}, desktop {got}",
                probe.topics
            );
        }
    }
}

#[test]
fn topic_blocks_match_android() {
    let golden = golden();
    let spec = KeySpec::default();
    let blocks = &golden["blocks"];
    let blocked: HashSet<String> = strings(&blocks["blocked"]).into_iter().collect();
    let matchers = BlockedMatchers::new(&blocked, &spec);
    for (title, expected) in blocks["titles"].as_object().unwrap() {
        assert_eq!(
            matchers.blocks_text(title, "Some Channel", &spec),
            expected.as_bool().unwrap(),
            "{title}"
        );
    }
}
