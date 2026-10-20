//! Feature extraction against Flow for Android's `features_golden.json` (written by its
//! `NeuroFeaturesGoldenTest`): real titles with channel names and descriptions, with and without
//! document counts.

use std::collections::HashMap;

use serde_json::Value;

use crate::flow_neuro::features::{TopicReader, VideoText, extract_features};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::scoring::IdfSnapshot;

const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/features_golden.json");
const TOLERANCE: f64 = 1e-9;

fn counted_idf(golden: &Value) -> IdfSnapshot {
    IdfSnapshot {
        word_frequencies: golden["idf"]["wordFrequency"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(word, count)| {
                (
                    word.clone(),
                    i32::try_from(count.as_i64().unwrap()).unwrap(),
                )
            })
            .collect(),
        total_documents: i32::try_from(golden["idf"]["totalDocs"].as_i64().unwrap()).unwrap(),
    }
}

#[test]
fn feature_vectors_match_android() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let spec = KeySpec::default();
    let idfs = [
        ("empty", IdfSnapshot::default()),
        ("counted", counted_idf(&golden)),
    ];
    let mut mismatches = Vec::new();
    let mut total = 0;
    for case in golden["cases"].as_array().unwrap() {
        let description = case["description"].as_str().unwrap();
        let text = VideoText {
            title: case["title"].as_str().unwrap(),
            channel_name: case["channelName"].as_str().unwrap(),
            description: (!description.is_empty()).then_some(description),
            duration_seconds: case["duration"].as_u64().filter(|seconds| *seconds > 0),
            is_live: case["isLive"].as_bool().unwrap(),
            is_short: case["isShort"].as_bool().unwrap(),
        };
        for (name, idf) in &idfs {
            total += 1;
            let expected = &case["vectors"][name];
            let got = extract_features(
                &text,
                &TopicReader {
                    spec: spec.clone(),
                    idf,
                },
            );
            let want: HashMap<String, f64> = expected["topics"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_f64().unwrap()))
                .collect();
            let same_topics = want.len() == got.topics.len()
                && want
                    .iter()
                    .all(|(k, v)| got.topics.get(k).is_some_and(|g| (g - v).abs() < TOLERANCE));
            let same_scalars = [
                ("duration", got.duration),
                ("pacing", got.pacing),
                ("complexity", got.complexity),
                ("isLive", got.is_live),
            ]
            .iter()
            .all(|(field, value)| (expected[field].as_f64().unwrap() - value).abs() < TOLERANCE);
            if !same_topics || !same_scalars {
                let mut want_keys: Vec<&String> = want.keys().collect();
                let mut got_keys: Vec<&String> = got.topics.keys().collect();
                want_keys.sort();
                got_keys.sort();
                let weights: Vec<String> = want_keys
                    .iter()
                    .filter_map(|k| {
                        got.topics
                            .get(*k)
                            .map(|g| format!("{k}: {:.4}/{g:.4}", want[*k]))
                    })
                    .collect();
                mismatches.push(format!(
                    "{name} {:?} ch={:?} desc={}\n  android {want_keys:?}\n  desktop {got_keys:?}\n  weights {weights:?}\n  scalars ok: {same_scalars}",
                    case["title"].as_str().unwrap(),
                    case["channelName"].as_str().unwrap(),
                    !description.is_empty(),
                ));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {total} differ:\n{}",
        mismatches.len(),
        mismatches
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
