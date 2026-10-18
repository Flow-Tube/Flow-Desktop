//! The tables key spec 2 reads titles by, from Android's `key_spec_tables.json`, its stop lists and
//! its unstemmed word list, mirrored byte for byte under `resources/neuro`.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use serde::Deserialize;

use super::chars::trim;

const TABLES_JSON: &str = include_str!("../../../resources/neuro/key_spec_tables.json");

const UNSTEMMED: &str = include_str!("../../../resources/neuro/keys/unstemmed.txt");

/// Android `key_spec_tables.json`, as written by its `KeySpecTablesTest`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tables {
    pub key_spec: u32,
    pub max_run_words: usize,
    pub max_key_length: usize,
    pub min_stem: usize,
    pub short_topics: HashSet<String>,
    pub never_alone: HashSet<String>,
    pub keep_whole: HashSet<String>,
    /// Longest first, so "dell'" comes off before "l'" could.
    pub elisions: Vec<String>,
    pub contractions: HashSet<String>,
    /// Written variants, folded, to the one key they share ("lo-fi" reads "lofi").
    pub expressions: HashMap<String, String>,
    pub lemmas: HashMap<String, String>,
    /// The stop words every title gets, whatever its language.
    pub stop_words: HashSet<String>,
    /// Words no language's stop list may remove.
    pub protected_words: HashSet<String>,
    /// Format id to the folded words that announce it.
    pub formats: HashMap<String, Vec<String>>,
    pub function_words: HashMap<String, Vec<String>>,
    pub own_letters: HashMap<String, String>,
    pub ukrainian_words: HashSet<String>,
    pub elision_languages: HashMap<String, Vec<String>>,
    pub script_letters: HashMap<String, String>,
    pub stop_list_languages: HashSet<String>,
    pub latin_stemmers: HashSet<String>,
    pub other_latin_languages: HashSet<String>,
    pub other_cyrillic_languages: HashSet<String>,
}

static TABLES: LazyLock<Tables> = LazyLock::new(|| {
    serde_json::from_str(TABLES_JSON).expect("key_spec_tables.json is embedded and valid")
});

/// The embedded tables, parsed once per process.
#[must_use]
pub fn tables() -> &'static Tables {
    &TABLES
}

/// What the tables imply, computed once.
pub(crate) struct Derived {
    pub format_of: HashMap<String, String>,
    /// The longest expression variant in words, so a scan knows how far ahead to look.
    pub longest_expression_words: usize,
    /// First words of the variants written as several words, so a scan only looks ahead from them.
    pub expression_first_words: HashSet<String>,
    pub unstemmed: HashSet<String>,
}

pub(crate) static DERIVED: LazyLock<Derived> = LazyLock::new(|| {
    let tables = tables();
    Derived {
        format_of: tables
            .formats
            .iter()
            .flat_map(|(id, words)| words.iter().map(move |word| (word.clone(), id.clone())))
            .collect(),
        longest_expression_words: tables
            .expressions
            .keys()
            .map(|variant| variant.matches(' ').count() + 1)
            .max()
            .unwrap_or(1),
        expression_first_words: tables
            .expressions
            .keys()
            .filter_map(|variant| variant.split_once(' ').map(|(first, _)| first.to_string()))
            .collect(),
        unstemmed: content_lines(UNSTEMMED).map(str::to_string).collect(),
    }
});

/// The format `word` (folded) announces, such as "review" or "playalong".
#[must_use]
pub fn format_of(word: &str) -> Option<&'static str> {
    DERIVED.format_of.get(word).map(String::as_str)
}

// Android's lists skip blank lines and `#` comments.
fn content_lines(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .filter(|line| !trim(line).is_empty() && !line.starts_with('#'))
}
