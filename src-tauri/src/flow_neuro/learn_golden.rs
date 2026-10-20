//! The learning math against Flow for Android's `learn_golden.json` (written by its
//! `NeuroLearnGoldenTest`, mirrored by `scripts/mirror-neuro-fixtures.sh`), so both apps learn
//! the same way from the same events.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::flow_neuro::scoring::ContentVector;
use crate::flow_neuro::vector_math::{
    Horizon, LONG_TERM, PHRASE_WORD_SHARE, RECENT, RECENT_SHARE, TIME_OF_DAY, adjust_vector, blend,
    cap_topics, learn, phrase_first, plant_topics,
};

const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/learn_golden.json");
const TOLERANCE: f64 = 1e-9;

fn golden() -> Value {
    serde_json::from_str(GOLDEN).expect("learn_golden.json is valid")
}

fn number(value: &Value) -> f64 {
    value.as_f64().expect("a number")
}

fn vector(value: &Value) -> ContentVector {
    ContentVector {
        topics: value["topics"]
            .as_object()
            .expect("topics")
            .iter()
            .map(|(key, weight)| (key.clone(), number(weight)))
            .collect(),
        duration: number(&value["duration"]),
        pacing: number(&value["pacing"]),
        complexity: number(&value["complexity"]),
        is_live: number(&value["isLive"]),
        ..ContentVector::default()
    }
}

fn strings(value: &Value) -> HashSet<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| item.as_str().expect("a string").to_string())
        .collect()
}

fn horizon(name: &str) -> Horizon {
    match name {
        "longTerm" => LONG_TERM,
        "recent" => RECENT,
        "timeOfDay" => TIME_OF_DAY,
        other => panic!("unknown horizon {other}"),
    }
}

/// Android inserts the keys of a rejected video at 0.0 (its A6 bug); the port adds nothing, so
/// zero weights on Android's side are not compared.
fn assert_same(case: &str, expected: &ContentVector, actual: &ContentVector) {
    let expected_topics: HashMap<&String, f64> = expected
        .topics
        .iter()
        .filter(|(_, weight)| **weight != 0.0)
        .map(|(key, weight)| (key, *weight))
        .collect();
    let mut expected_keys: Vec<&&String> = expected_topics.keys().collect();
    let mut actual_keys: Vec<&String> = actual.topics.keys().collect();
    expected_keys.sort();
    actual_keys.sort();
    assert_eq!(
        expected_keys.iter().map(|k| k.as_str()).collect::<Vec<_>>(),
        actual_keys.iter().map(|k| k.as_str()).collect::<Vec<_>>(),
        "{case}: keys"
    );
    for (key, weight) in &expected_topics {
        let got = actual.topics[*key];
        assert!(
            (got - weight).abs() < TOLERANCE,
            "{case}: {key} is {got}, Android {weight}"
        );
    }
    for (name, expected, actual) in [
        ("duration", expected.duration, actual.duration),
        ("pacing", expected.pacing, actual.pacing),
        ("complexity", expected.complexity, actual.complexity),
        ("isLive", expected.is_live, actual.is_live),
    ] {
        assert!(
            (expected - actual).abs() < TOLERANCE,
            "{case}: {name} is {actual}, Android {expected}"
        );
    }
}

#[test]
fn constants_match_android() {
    let constants = &golden()["constants"];
    assert!((number(&constants["recentShare"]) - RECENT_SHARE).abs() < f64::EPSILON);
    assert!((number(&constants["phraseWordShare"]) - PHRASE_WORD_SHARE).abs() < f64::EPSILON);
    for (name, value) in constants["horizons"].as_object().unwrap() {
        let ours = horizon(name);
        assert!((number(&value["saturation"]) - ours.saturation).abs() < f64::EPSILON);
        assert!((number(&value["halfLife"]) - ours.half_life).abs() < f64::EPSILON);
        assert_eq!(
            usize::try_from(value["maxTopics"].as_u64().unwrap()).unwrap(),
            ours.max_topics
        );
    }
}

#[test]
fn learn_matches_android() {
    for (index, case) in golden()["learn"].as_array().unwrap().iter().enumerate() {
        let actual = learn(
            &vector(&case["current"]),
            &vector(&case["video"]),
            number(&case["strength"]),
            horizon(case["horizon"].as_str().unwrap()),
            number(&case["scalarRate"]),
            &strings(&case["protected"]),
        );
        assert_same(&format!("learn {index}"), &vector(&case["result"]), &actual);
    }
}

#[test]
fn learning_traces_match_android() {
    for trace in golden()["traces"].as_array().unwrap() {
        let name = trace["horizon"].as_str().unwrap();
        let protected = strings(&trace["protected"]);
        let mut current = ContentVector::default();
        for (step, event) in trace["steps"].as_array().unwrap().iter().enumerate() {
            let strength = number(&event["strength"]);
            let video = phrase_first(&vector(&event["video"]), PHRASE_WORD_SHARE);
            current = learn(
                &current,
                &video,
                strength,
                horizon(name),
                strength * 0.15,
                &protected,
            );
            assert_same(
                &format!("{name} trace step {step}"),
                &vector(&event["result"]),
                &current,
            );
        }
    }
}

#[test]
fn adjust_matches_android() {
    for (index, case) in golden()["adjust"].as_array().unwrap().iter().enumerate() {
        let actual = adjust_vector(
            &vector(&case["current"]),
            &vector(&case["target"]),
            number(&case["baseRate"]),
            number(&case["pruneBelow"]),
        );
        assert_same(
            &format!("adjust {index}"),
            &vector(&case["result"]),
            &actual,
        );
    }
}

#[test]
fn planting_matches_android() {
    for (index, case) in golden()["plant"].as_array().unwrap().iter().enumerate() {
        let actual = plant_topics(
            &vector(&case["current"]),
            &vector(&case["source"]),
            number(&case["floor"]),
            usize::try_from(case["topK"].as_u64().unwrap()).unwrap(),
            |_| true,
        );
        assert_same(&format!("plant {index}"), &vector(&case["result"]), &actual);
    }
}

#[test]
fn phrase_first_matches_android() {
    for (index, case) in golden()["phraseFirst"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let actual = phrase_first(&vector(&case["vector"]), PHRASE_WORD_SHARE);
        assert_same(
            &format!("phraseFirst {index}"),
            &vector(&case["result"]),
            &actual,
        );
    }
}

#[test]
fn blend_matches_android() {
    for (index, case) in golden()["blend"].as_array().unwrap().iter().enumerate() {
        let actual = blend(
            &vector(&case["longTerm"]),
            &vector(&case["recent"]),
            RECENT_SHARE,
        );
        assert_same(&format!("blend {index}"), &vector(&case["result"]), &actual);
    }
}

#[test]
fn capping_matches_android() {
    for (index, case) in golden()["cap"].as_array().unwrap().iter().enumerate() {
        let actual = cap_topics(
            &vector(&case["vector"]),
            usize::try_from(case["max"].as_u64().unwrap()).unwrap(),
            &strings(&case["protected"]),
        );
        assert_same(&format!("cap {index}"), &vector(&case["result"]), &actual);
    }
}
