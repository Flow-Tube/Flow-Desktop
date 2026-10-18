//! The tables key spec 2 reads by are Android's: the embedded `resources/neuro` files are
//! byte-identical to Android's `key_spec_tables.json` (the fixture) and the loaded tables hold
//! exactly what it says.

use std::collections::{HashMap, HashSet};

use flow_desktop_lib::flow_neuro::keyspec::tables::{format_of, tables};
use flow_desktop_lib::flow_neuro::keyspec::{VERSION, stemmer};
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/neuro/key_spec_tables.json");
const RESOURCE: &str = include_str!("../resources/neuro/key_spec_tables.json");

fn json() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

fn list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

fn set(value: &Value) -> HashSet<String> {
    list(value).into_iter().collect()
}

fn text_map(value: &Value) -> HashMap<String, String> {
    value
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_string()))
        .collect()
}

fn list_map(value: &Value) -> HashMap<String, Vec<String>> {
    value
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.clone(), list(v)))
        .collect()
}

#[test]
fn the_embedded_tables_are_androids_file() {
    assert_eq!(RESOURCE, FIXTURE);
}

#[test]
fn the_loaded_tables_hold_what_the_file_says() {
    let json = json();
    let t = tables();
    assert_eq!(u64::from(t.key_spec), json["keySpec"].as_u64().unwrap());
    assert_eq!(t.key_spec, VERSION);
    assert_eq!(
        t.max_run_words as u64,
        json["maxRunWords"].as_u64().unwrap()
    );
    assert_eq!(
        t.max_key_length as u64,
        json["maxKeyLength"].as_u64().unwrap()
    );
    assert_eq!(t.min_stem as u64, json["minStem"].as_u64().unwrap());
    assert_eq!(t.short_topics, set(&json["shortTopics"]));
    assert_eq!(t.never_alone, set(&json["neverAlone"]));
    assert_eq!(t.keep_whole, set(&json["keepWhole"]));
    assert_eq!(t.elisions, list(&json["elisions"]));
    assert_eq!(t.contractions, set(&json["contractions"]));
    assert_eq!(t.expressions, text_map(&json["expressions"]));
    assert_eq!(t.lemmas, text_map(&json["lemmas"]));
    assert_eq!(t.stop_words, set(&json["stopWords"]));
    assert_eq!(t.protected_words, set(&json["protectedWords"]));
    assert_eq!(t.formats, list_map(&json["formats"]));
    assert_eq!(t.function_words, list_map(&json["functionWords"]));
    assert_eq!(t.own_letters, text_map(&json["ownLetters"]));
    assert_eq!(t.ukrainian_words, set(&json["ukrainianWords"]));
    assert_eq!(t.elision_languages, list_map(&json["elisionLanguages"]));
    assert_eq!(t.script_letters, text_map(&json["scriptLetters"]));
    assert_eq!(t.stop_list_languages, set(&json["stopListLanguages"]));
    assert_eq!(t.latin_stemmers, set(&json["latinStemmers"]));
    assert_eq!(t.other_latin_languages, set(&json["otherLatinLanguages"]));
    assert_eq!(
        t.other_cyrillic_languages,
        set(&json["otherCyrillicLanguages"])
    );
}

#[test]
fn a_word_announces_one_format() {
    let mut seen = HashMap::new();
    for (id, words) in &tables().formats {
        for word in words {
            assert_eq!(seen.insert(word, id), None, "{word} announces two formats");
            assert_eq!(format_of(word), Some(id.as_str()));
        }
    }
}

#[test]
fn every_latin_stemmer_is_one_this_build_has() {
    for language in &tables().latin_stemmers {
        assert_eq!(
            stemmer::language_of("guitar", language),
            Some(language.as_str())
        );
    }
    assert_eq!(stemmer::language_of("рецепт", "en"), Some("ru"));
}
