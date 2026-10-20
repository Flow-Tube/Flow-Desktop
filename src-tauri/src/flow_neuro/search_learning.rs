//! What a typed search teaches, ported from Flow for Android's `NeuroSearchLearning`. A search is
//! the most explicit interest statement there is, but its words are a question: the template
//! around the subject ("how does X work", "what is X", "X explained") is dropped, the subject is
//! read by the key spec, and what gets planted is a phrase it holds that the engine knows, a
//! catalog topic in it, or else the subject itself. Its other words only nudge the vector.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::display_forms::{fill_gaps, spellings_in};
use crate::flow_neuro::features::{is_promoted, pick_keys};
use crate::flow_neuro::keyed_lists::keyed_lists;
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::tables::tables;
use crate::flow_neuro::keyspec::text::fold;
use crate::flow_neuro::scoring::{
    ContentVector, IdfSnapshot, TOPIC_ACQUISITION_FLOOR, TOPIC_ACQUISITION_TOP_K,
    TOPIC_EVIDENCE_MAX_ENTRIES, TopicEvidence, UserBrain,
};
use crate::flow_neuro::vector_math::{
    DECAY_REFERENCE_RATE, Horizon, LONG_TERM, RECENT, learn, plant_keys,
};

const MAX_QUERY_WORDS: usize = 8;
const LEARNING_RATE: f64 = 0.05;
const EVIDENCE_SCORE: f64 = 0.5;
const EVIDENCE_SCORE_CAP: f64 = 50.0;
const WEAK_WORD_SHARE: f64 = 0.25;

/// What a search asks about, without the words of the question around it.
#[must_use]
pub fn subject_of(query: &str) -> String {
    let folded = fold(query);
    let trimmed = folded.trim().trim_end_matches(['?', '!', '.']);
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    let joined = words.join(" ");
    let n = words.len();
    let between = |from: usize, to: usize| words[from..to].join(" ");
    let first = words.first().copied().unwrap_or_default();
    let second = words.get(1).copied().unwrap_or_default();
    let last = words.last().copied().unwrap_or_default();

    if first == "how"
        && n >= 4
        && [
            "do", "does", "did", "can", "could", "would", "will", "is", "are",
        ]
        .contains(&second)
        && ["work", "works", "working", "happen", "happens"].contains(&last)
    {
        return between(2, n - 1);
    }
    if first == "how" && n >= 3 && ["work", "works"].contains(&last) {
        return between(1, n - 1);
    }
    if ["what", "who"].contains(&first) && ["is", "are", "was", "were"].contains(&second) && n >= 3
    {
        return between(2, n);
    }
    if ["explain", "explaining"].contains(&first) && n >= 2 {
        return between(1, n);
    }
    if last == "explained" && n >= 2 {
        return between(0, n - 1);
    }
    if first == "how" && second == "to" && n >= 3 {
        return between(2, n);
    }
    joined
}

/// The topics a search plants, and the words that only nudge the vector.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct QueryTopics {
    pub phrases: Vec<String>,
    pub weak_words: Vec<String>,
}

#[must_use]
pub fn query_topics(
    raw_query: &str,
    spec: &KeySpec,
    blocked_topics: &HashSet<String>,
    idf: &IdfSnapshot,
) -> QueryTopics {
    let lists = keyed_lists(spec);
    let chunks = spec.chunk(&subject_of(raw_query));
    let mut words: Vec<String> = Vec::new();
    for word in chunks.words() {
        if !words.contains(&word) {
            words.push(word);
        }
    }
    words.truncate(MAX_QUERY_WORDS);
    let blocked: HashSet<String> = blocked_topics
        .iter()
        .flat_map(|t| spec.keys_of(t))
        .collect();
    let usable: Vec<String> = words.into_iter().filter(|w| !blocked.contains(w)).collect();
    match usable.len() {
        0 => return QueryTopics::default(),
        1 => {
            return QueryTopics {
                phrases: usable,
                weak_words: Vec::new(),
            };
        }
        _ => {}
    }

    let known: Vec<String> = chunks
        .runs()
        .into_iter()
        .filter(|run| {
            chunks.chunks[run.chunk][run.from..run.to]
                .iter()
                .all(|word| !blocked.contains(word))
        })
        .map(|run| run.key)
        .filter(|key| is_promoted(key, &lists, idf))
        .collect();
    let catalog_words: Vec<String> = usable
        .iter()
        .filter(|word| lists.is_catalog_key(word))
        .cloned()
        .collect();
    let subject = match chunks.chunks.as_slice() {
        [only]
            if known.is_empty()
                && catalog_words.is_empty()
                && only.len() >= 2
                && only.iter().all(|word| !blocked.contains(word))
                && only.len() <= tables().max_run_words =>
        {
            Some(only.join(" "))
        }
        _ => None,
    };
    let mut phrases: Vec<String> = Vec::new();
    for phrase in known.into_iter().chain(catalog_words).chain(subject) {
        if !phrases.contains(&phrase) {
            phrases.push(phrase);
        }
    }
    phrases.truncate(TOPIC_ACQUISITION_TOP_K);
    let weak_words = usable
        .into_iter()
        .filter(|word| !phrases.contains(word))
        .collect();
    QueryTopics {
        phrases,
        weak_words,
    }
}

/// Applies a search to the brain. Returns false when the query carries no usable topic. A search
/// is evidence of interest, not an interaction: it never counts toward the profile's maturity.
pub fn learn_search(brain: &mut UserBrain, raw_query: &str, now_ms: u64) -> bool {
    let spec = brain.key_spec();
    let idf = IdfSnapshot {
        word_frequencies: brain.idf_word_frequency.clone(),
        total_documents: brain.idf_total_documents,
    };
    let topics = query_topics(raw_query, &spec, &brain.blocked_topics, &idf);
    if topics.phrases.is_empty() {
        return false;
    }

    for topic in &topics.phrases {
        let evidence: &mut TopicEvidence = brain.topic_evidence.entry(topic.clone()).or_default();
        evidence.positive_signals += 1;
        evidence.explicit_signals += 1;
        evidence.positive_score =
            (evidence.positive_score + EVIDENCE_SCORE).min(EVIDENCE_SCORE_CAP);
        if evidence.first_seen_at == 0 {
            evidence.first_seen_at = now_ms;
        }
        evidence.last_seen_at = now_ms;
    }
    cap_evidence(&mut brain.topic_evidence);

    let shares: HashMap<String, f64> = topics
        .phrases
        .iter()
        .map(|phrase| (phrase.clone(), 1.0))
        .chain(
            topics
                .weak_words
                .iter()
                .map(|word| (word.clone(), WEAK_WORD_SHARE)),
        )
        .collect();
    let total: f64 = shares.values().sum();
    let query = ContentVector {
        topics: shares.into_iter().map(|(k, v)| (k, v / total)).collect(),
        ..ContentVector::default()
    };
    let picks = pick_keys(brain);
    let learn_on = |vector: &ContentVector, horizon: Horizon| {
        learn(
            vector,
            &query,
            LEARNING_RATE / DECAY_REFERENCE_RATE,
            horizon,
            LEARNING_RATE,
            &picks,
        )
    };
    brain.global_vector = plant_keys(
        &learn_on(&brain.global_vector, LONG_TERM),
        &topics.phrases,
        TOPIC_ACQUISITION_FLOOR,
    );
    brain.recent_vector = learn_on(&brain.recent_vector, RECENT);

    let keys: Vec<String> = brain.global_vector.topics.keys().cloned().collect();
    let global = &brain.global_vector;
    brain.display_forms = fill_gaps(
        &brain.display_forms,
        &spellings_in(raw_query, &keys, &spec),
        |key| global.topics.contains_key(key),
    );
    true
}

fn cap_evidence(evidence: &mut HashMap<String, TopicEvidence>) {
    if evidence.len() <= TOPIC_EVIDENCE_MAX_ENTRIES {
        return;
    }
    let mut entries: Vec<(String, TopicEvidence)> = evidence.drain().collect();
    entries.sort_by(|a, b| {
        b.1.positive_score
            .total_cmp(&a.1.positive_score)
            .then_with(|| b.1.last_seen_at.cmp(&a.1.last_seen_at))
    });
    entries.truncate(TOPIC_EVIDENCE_MAX_ENTRIES);
    evidence.extend(entries);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_question_around_a_subject_is_dropped() {
        assert_eq!(subject_of("How does a jet engine work?"), "a jet engine");
        assert_eq!(subject_of("how solar panels work"), "solar panels");
        assert_eq!(subject_of("What is quantum computing"), "quantum computing");
        assert_eq!(subject_of("explain black holes"), "black holes");
        assert_eq!(subject_of("Blockchain explained"), "blockchain");
        assert_eq!(subject_of("how to bake sourdough"), "bake sourdough");
        assert_eq!(subject_of("lofi hip hop"), "lofi hip hop");
    }

    #[test]
    fn a_catalog_topic_in_a_search_is_planted_and_the_rest_only_nudged() {
        let mut brain = UserBrain::default();
        assert!(learn_search(
            &mut brain,
            "best woodworking tools for beginners",
            1
        ));
        let spec = brain.key_spec();
        let woodworking = spec.key_of("woodworking");
        assert!(brain.global_vector.topics[&woodworking] >= TOPIC_ACQUISITION_FLOOR);
        assert_eq!(brain.topic_evidence[&woodworking].explicit_signals, 1);
        assert_eq!(brain.total_interactions, 0);
        assert!(!brain.recent_vector.topics.is_empty());
    }

    #[test]
    fn a_one_word_search_plants_that_word() {
        let topics = query_topics(
            "chess",
            &KeySpec::default(),
            &HashSet::new(),
            &IdfSnapshot::default(),
        );
        assert_eq!(topics.phrases.len(), 1);
        assert!(topics.weak_words.is_empty());
    }

    #[test]
    fn a_blocked_topic_is_never_learned_from_a_search() {
        let blocked: HashSet<String> = ["chess".to_string()].into();
        let topics = query_topics(
            "chess",
            &KeySpec::default(),
            &blocked,
            &IdfSnapshot::default(),
        );
        assert_eq!(topics, QueryTopics::default());
    }
}
