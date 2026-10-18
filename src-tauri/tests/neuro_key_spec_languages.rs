//! Title language detection against Flow for Android: every row of
//! `fixtures/neuro/language_detected.tsv` (byte-identical to Android's) and ports of
//! `NeuroLanguagesTest`.

use std::collections::HashMap;

use flow_desktop_lib::flow_neuro::keyspec::KeySpec;
use flow_desktop_lib::flow_neuro::keyspec::languages::{
    PROFILE_WINDOW, detect_text, normalize, vote,
};
use flow_desktop_lib::flow_neuro::keyspec::tables::{raw_stop_list, tables};

const DETECTED: &str = include_str!("fixtures/neuro/language_detected.tsv");
const TITLES: &str = include_str!("fixtures/neuro/language_titles.tsv");

fn rows(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
}

fn labelled() -> Vec<(&'static str, &'static str)> {
    rows(TITLES)
        .map(|row| row.split_once('\t').expect("label and title"))
        .collect()
}

#[test]
fn every_golden_detection_matches_android() {
    let mut total = 0;
    let mut failures = Vec::new();
    for row in rows(DETECTED) {
        let [label, title, expected] = row.split('\t').collect::<Vec<_>>()[..] else {
            panic!("malformed row {row}");
        };
        total += 1;
        let detected = detect_text(title).unwrap_or_default();
        if detected != expected {
            failures.push(format!(
                "{label}\t{title}: {detected:?}, expected {expected:?}"
            ));
        }
    }
    println!(
        "language_detected.tsv: {} of {total} rows pass",
        total - failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn a_confident_detection_is_right_at_least_98_times_in_100() {
    let results: Vec<(&str, Option<&str>)> = labelled()
        .into_iter()
        .map(|(language, title)| (language, detect_text(title)))
        .collect();
    let confident: Vec<_> = results.iter().filter(|(_, d)| d.is_some()).collect();
    let wrong = confident.iter().filter(|(l, d)| Some(*l) != *d).count();
    #[allow(clippy::cast_precision_loss)]
    let (wrong, confident, all) = (wrong as f64, confident.len() as f64, results.len() as f64);
    assert!(1.0 - wrong / confident >= 0.98);
    assert!(confident / all >= 0.6);
}

#[test]
fn scripts_one_language_uses_decide_alone() {
    assert_eq!(detect_text("Обзор нового iPhone 17"), Some("ru"));
    assert_eq!(
        detect_text("Огляд iPhone 17: чи варто купувати"),
        Some("uk")
    );
    assert_eq!(detect_text("Преглед новог иПхоне ђак"), None);
    assert_eq!(detect_text("بررسی آیفون"), Some("fa"));
    assert_eq!(detect_text("مراجعة آيفون"), Some("ar"));
    assert_eq!(detect_text("iPhone 17 レビュー"), Some("ja"));
}

#[test]
fn a_title_with_too_few_function_words_has_no_language() {
    assert_eq!(detect_text("Minecraft speedrun world record"), None);
    assert_eq!(detect_text("de la"), None);
}

#[test]
fn every_stop_list_loads_without_its_header() {
    for language in &tables().stop_list_languages {
        let list = raw_stop_list(language).expect("a stop file per listed language");
        assert!(!list.is_empty(), "{language}");
        assert!(
            list.iter().all(|w| !w.starts_with('#') && !w.contains(' ')),
            "{language}"
        );
    }
    let es = raw_stop_list("es").unwrap();
    assert!(["los", "para", "como"].iter().all(|w| es.contains(*w)));
    let fr = raw_stop_list("fr").unwrap();
    assert!(["des", "les"].iter().all(|w| fr.contains(*w)));
    assert!(raw_stop_list("ru").unwrap().contains("как"));
    assert!(raw_stop_list("xx").is_none());
    assert!(KeySpec::stop_list("xx").is_empty());
}

#[test]
fn a_stop_list_never_removes_a_protected_word() {
    for language in &tables().stop_list_languages {
        let list = KeySpec::stop_list(language);
        assert!(
            list.iter().all(|w| !tables().protected_words.contains(w)),
            "{language}"
        );
    }
}

#[test]
fn the_profile_moves_only_when_most_of_a_window_disagrees() {
    let mut state = ("en".to_string(), HashMap::new());
    for _ in 0..PROFILE_WINDOW - 1 {
        state = vote(&state.0, &state.1, Some("es"));
    }
    assert_eq!(state.0, "en");
    state = vote(&state.0, &state.1, Some("es"));
    assert_eq!(state, ("es".to_string(), HashMap::new()));

    let mut mixed = ("en".to_string(), HashMap::new());
    for i in 0..PROFILE_WINDOW {
        let detected = if i % 2 == 0 { "es" } else { "en" };
        mixed = vote(&mixed.0, &mixed.1, Some(detected));
    }
    assert_eq!(mixed.0, "en");
    assert_eq!(
        vote("en", &HashMap::new(), None),
        ("en".to_string(), HashMap::new())
    );
}

#[test]
fn language_codes_read_as_the_stop_lists_name_them() {
    assert_eq!(normalize("in-ID"), "id");
    assert_eq!(normalize("pt_BR"), "pt");
    assert_eq!(normalize("zh-Hant-TW"), "zh");
    assert_eq!(normalize("iw"), "he");
}
