//! Key spec 2 stage 8 against Flow for Android: every row of `fixtures/neuro/stem_golden.tsv`
//! (byte-identical to Android's) and ports of `NeuroStemmerTest`.

use flow_desktop_lib::flow_neuro::keyspec::tables::tables;
use flow_desktop_lib::flow_neuro::keyspec::text::{fold, words};
use flow_desktop_lib::flow_neuro::keyspec::{KeySpec, normalize_lemma, stemmer};

const STEM_GOLDEN: &str = include_str!("fixtures/neuro/stem_golden.tsv");
const LANGUAGE_TITLES: &str = include_str!("fixtures/neuro/language_titles.tsv");
const GOLDEN: &str = include_str!("fixtures/neuro/key_spec_golden.json");

const KEY_LANGUAGES: [&str; 7] = ["en", "es", "pt", "fr", "de", "it", "ru"];

fn rows(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
}

fn keys(language: &str, words: &[&str]) -> Vec<String> {
    let spec = KeySpec::new("en", language);
    words.iter().map(|word| spec.key_of(word)).collect()
}

#[test]
fn every_golden_stem_matches_android() {
    let mut total = 0;
    let mut failures = Vec::new();
    for row in rows(STEM_GOLDEN) {
        let [language, word, key] = row.split('\t').collect::<Vec<_>>()[..] else {
            panic!("malformed row {row}");
        };
        total += 1;
        let actual = KeySpec::new("en", language).key_of(word);
        if actual != key {
            failures.push(format!("{language}\t{word}: {actual}, expected {key}"));
        }
    }
    println!(
        "stem_golden.tsv: {} of {total} rows pass",
        total - failures.len()
    );
    assert!(total > 1700);
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn words_share_a_key_with_their_other_forms_in_the_viewers_language() {
    assert_eq!(
        keys("en", &["guitars", "guitar", "kayaks", "kayaking"]),
        ["guitar", "guitar", "kayak", "kayak"]
    );
    assert_eq!(
        keys("es", &["croquetas", "croqueta"]),
        ["croquet", "croquet"]
    );
    assert_eq!(keys("fr", &["recettes", "recette"]), ["recet", "recet"]);
    assert_eq!(keys("de", &["rezepte", "rezept"]), ["rezept", "rezept"]);
    assert_eq!(
        keys("ru", &["рецепты", "рецептов", "рецепт"]),
        ["рецепт", "рецепт", "рецепт"]
    );
}

#[test]
fn the_engines_own_words_and_words_with_digits_stay_as_written() {
    let words = [
        "anime",
        "animation",
        "technology",
        "lyrics",
        "ps5",
        "4k",
        "node.js",
    ];
    assert_eq!(keys("en", &words), words);
}

#[test]
fn the_script_and_the_profile_choose_the_stemmer_never_the_title() {
    assert_eq!(
        keys("tr", &["oyunları", "guitars"]),
        ["oyunları", "guitars"]
    );
    assert_eq!(keys("ru", &["guitars", "рецепты"]), ["guitar", "рецепт"]);
    assert_eq!(keys("uk", &["рецепти"]), ["рецепти"]);
    assert_eq!(keys("ja", &["ギター"]), ["ギター"]);
}

#[test]
fn a_stem_that_stems_again_leaves_the_word_as_written() {
    assert_eq!(keys("es", &["casero", "casa"]), ["casero", "cas"]);
}

#[test]
fn a_key_is_always_its_own_key() {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    let titles = rows(LANGUAGE_TITLES)
        .filter_map(|row| row.split_once('\t').map(|(_, title)| title))
        .chain(
            golden["cases"]
                .as_array()
                .unwrap()
                .iter()
                .map(|case| case["input"].as_str().unwrap()),
        );
    let mut all: Vec<String> = titles
        .flat_map(|title| words(&fold(title)))
        .map(|piece| piece.trim_matches(|c: char| !c.is_alphabetic()).to_string())
        .filter(|word| word.chars().count() >= 3)
        .collect();
    all.sort();
    all.dedup();
    for language in KEY_LANGUAGES {
        let spec = KeySpec::new("en", language);
        let changed: Vec<&String> = all
            .iter()
            .filter(|word| {
                let key = spec.key_of(word);
                spec.key_of(&key) != key
            })
            .collect();
        assert!(changed.is_empty(), "{language}: {changed:?}");
    }
}

#[test]
fn the_lemma_map_never_rewrites_its_own_lemmas() {
    let rewritten: Vec<&String> = tables()
        .lemmas
        .values()
        .filter(|lemma| normalize_lemma(lemma) != **lemma)
        .collect();
    assert!(rewritten.is_empty(), "{rewritten:?}");
}

#[test]
fn stemming_on_many_threads_gives_the_same_keys_as_on_one() {
    let words: Vec<String> = rows(LANGUAGE_TITLES)
        .filter_map(|row| row.split_once('\t').map(|(_, title)| title.to_lowercase()))
        .flat_map(|title| title.split(' ').map(str::to_string).collect::<Vec<_>>())
        .filter(|word| word.chars().count() >= 3 && word.chars().all(char::is_alphabetic))
        .collect();
    let stem_all = |words: &[String]| -> Vec<String> {
        words.iter().map(|word| stemmer::key(word, "es")).collect()
    };
    let serial = stem_all(&words);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8).map(|_| scope.spawn(|| stem_all(&words))).collect();
        for handle in handles {
            assert_eq!(handle.join().unwrap(), serial);
        }
    });
}
