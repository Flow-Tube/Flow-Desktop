//! Key spec 2 against Flow for Android: its golden cases (`fixtures/neuro/key_spec_golden.json`,
//! byte-identical to Android's) and ports of `NeuroKeySpecTest`, `BrainKeyRekeyTest`'s key
//! function and `NeuroPhraseLearningTest`'s phrase test.

use std::collections::HashMap;

use flow_desktop_lib::flow_neuro::keyspec::phrases::{IdfSnapshot, is_phrase};
use flow_desktop_lib::flow_neuro::keyspec::{KeySpec, VERSION};
use serde_json::Value;

const GOLDEN: &str = include_str!("fixtures/neuro/key_spec_golden.json");

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("an array")
        .iter()
        .map(|item| item.as_str().expect("a string").to_string())
        .collect()
}

#[test]
fn every_golden_case_reads_as_the_spec_says() {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    assert_eq!(golden["keySpec"].as_u64(), Some(u64::from(VERSION)));
    let cases = golden["cases"].as_array().unwrap();
    assert!(cases.len() >= 60);

    let mut failures = Vec::new();
    for case in cases {
        let input = case["input"].as_str().unwrap();
        let profile = case["languageProfile"].as_str().unwrap_or("en");
        let chunks = KeySpec::new(profile, profile).chunk(input);
        let expected: Vec<Vec<String>> = case["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(strings)
            .collect();
        let pairs = strings(&case["modelPairs"]);
        let formats = strings(&case["formats"]);
        if chunks.chunks != expected || chunks.model_pairs != pairs || chunks.formats != formats {
            failures.push(format!(
                "{input}: {:?} {:?} {:?}, expected {expected:?} {pairs:?} {formats:?}",
                chunks.chunks, chunks.model_pairs, chunks.formats
            ));
        }
    }
    println!(
        "key_spec_golden.json: {} of {} cases pass",
        cases.len() - failures.len(),
        cases.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}

fn key(spec: &KeySpec, phrase: &str) -> String {
    let keys = spec.keys_of(phrase);
    assert_eq!(keys.len(), 1, "{phrase} reads as {keys:?}");
    keys.into_iter().next().unwrap()
}

#[test]
fn runs_stay_inside_a_chunk_and_hold_at_most_three_words() {
    let spec = KeySpec::default();
    let mut runs: Vec<String> = spec
        .chunk("Lo-Fi Hip Hop Radio: chill study beats")
        .runs()
        .into_iter()
        .map(|run| run.key)
        .collect();
    let mut expected: Vec<String> = [
        "lofi hip hop",
        "hip hop radio",
        "chill study",
        "chill study beats",
        "study beats",
    ]
    .iter()
    .map(|phrase| key(&spec, phrase))
    .collect();
    runs.sort();
    expected.sort();
    assert_eq!(runs, expected);
}

#[test]
fn the_platform_and_its_bait_words_never_become_interests() {
    let words = KeySpec::default()
        .chunk("YouTube's most hilarious coding fails")
        .words();
    assert_eq!(words, ["code", "fails"]);
}

#[test]
fn every_spelling_of_an_apostrophe_reads_the_same() {
    let spec = KeySpec::default();
    for spelling in ["Tech's", "Tech’s", "Tech‘s", "Techʼs", "Tech`s", "Tech´s"] {
        assert_eq!(spec.chunk(spelling).words(), ["tech"], "{spelling}");
    }
}

#[test]
fn a_label_reads_as_the_keys_titles_give_it() {
    let spec = KeySpec::default();
    assert_eq!(spec.keys_of("Health & Fitness"), ["health", "fitness"]);
    assert_eq!(spec.keys_of("Call of Duty"), ["call of duty"]);
    assert_eq!(spec.keys_of("Lo-Fi"), ["lofi"]);
    assert_eq!(spec.keys_of("Web Development"), ["web development"]);
    assert!(spec.keys_of("   ").is_empty());
    assert!(spec.keys_of("").is_empty());
}

#[test]
fn a_stored_key_reads_again_by_spec_2() {
    let spec = KeySpec::default();
    assert_eq!(spec.rekey("guitars"), ["guitar"]);
    assert_eq!(spec.rekey("guitar"), ["guitar"]);
    assert_eq!(spec.rekey("kayaking"), ["kayak"]);
    assert_eq!(spec.rekey("tech's"), ["tech"]);
    assert_eq!(spec.rekey("lo-fi"), ["lofi"]);
    assert_eq!(spec.rekey("lo fi hip hop"), ["lofi hip hop"]);
    assert_eq!(spec.rekey("~guitars"), ["~guitar"]);
    assert_eq!(spec.rekey("metal guitars:music"), ["metal guitar:music"]);
    assert_eq!(spec.rekey("health & fitness"), ["health", "fitness"]);
    assert!(spec.rekey("m/v").is_empty());
}

#[test]
fn keys_already_read_stay_as_they_are() {
    let spec = KeySpec::default();
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let mut keys = vec![
        "guitars".to_string(),
        "kayaking".to_string(),
        "~tech's:music".to_string(),
    ];
    for case in golden["cases"].as_array().unwrap() {
        let chunks = spec.chunk(case["input"].as_str().unwrap());
        keys.extend(chunks.words());
        keys.extend(chunks.runs().into_iter().map(|run| run.key));
    }
    for key in keys {
        for once in spec.rekey(&key) {
            assert_eq!(spec.rekey(&once), std::slice::from_ref(&once), "{key}");
        }
    }
}

#[test]
fn a_pair_that_keeps_appearing_together_becomes_a_phrase_and_a_chance_pair_does_not() {
    let frequencies: HashMap<String, i32> = [
        ("guitar playalong", 6),
        ("guitar", 8),
        ("playalong", 6),
        ("review after", 3),
        ("review", 30),
        ("after", 25),
    ]
    .into_iter()
    .map(|(word, count)| (word.to_string(), count))
    .collect();
    let idf = IdfSnapshot {
        word_frequencies: frequencies.clone(),
        total_documents: 100,
    };
    assert!(is_phrase("guitar playalong", &idf));
    assert!(!is_phrase("review after", &idf));
    let fewer = IdfSnapshot {
        word_frequencies: frequencies,
        total_documents: 10,
    };
    assert!(!is_phrase("guitar playalong", &fewer));
}

// Android checks these on a device, where ICU's dictionaries live; ICU4X ships the same ones.
#[test]
fn unspaced_scripts_split_into_dictionary_words() {
    let spec = KeySpec::default();
    let words = |title: &str| spec.chunk(title).words();

    let chinese = words("吉他教学零基础入门");
    assert!(chinese.contains(&"吉他".to_string()), "{chinese:?}");
    assert!(chinese.contains(&"教学".to_string()), "{chinese:?}");

    let japanese = words("ギターの弾き方を初心者向けに解説");
    assert!(japanese.contains(&"ギター".to_string()), "{japanese:?}");
    assert!(
        !japanese.iter().any(|w| w == "の" || w == "を"),
        "{japanese:?}"
    );

    let thai = words("สอนเล่นกีตาร์สำหรับมือใหม่");
    assert!(thai.contains(&"กีตาร์".to_string()), "{thai:?}");
    assert!(thai.contains(&"สำหรับ".to_string()), "{thai:?}");

    let spaced = words("Pixel 10 Pro camera test");
    assert!(spaced.contains(&"pixel".to_string()), "{spaced:?}");
    assert!(spaced.contains(&"camera".to_string()), "{spaced:?}");
}
