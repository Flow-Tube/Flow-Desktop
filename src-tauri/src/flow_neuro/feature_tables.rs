//! The word lists a video's text is read by, from Flow for Android's `feature_tables.json` (written
//! by its `NeuroFeatureTablesTest`, mirrored byte for byte under `resources/neuro`).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use serde::Deserialize;

const TABLES_JSON: &str = include_str!("../../resources/neuro/feature_tables.json");

/// One reading of a polysemous word, recognised by the words around it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainContext {
    pub domain: String,
    pub context_words: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DomainEntry {
    word: String,
    domains: Vec<DomainContext>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTables {
    domain_disambiguation: Vec<DomainEntry>,
    tag_spam_words: Vec<String>,
    sponsor_line_patterns: Vec<String>,
    high_pacing_words: Vec<String>,
    low_pacing_words: Vec<String>,
    compound_terms: Vec<String>,
}

pub struct FeatureTables {
    /// Polysemous words and their readings, in Android's order, which breaks ties.
    pub domains: HashMap<String, Vec<DomainContext>>,
    pub tag_spam_words: HashSet<String>,
    /// A description line holding one of these is a sponsor block or a link, not the subject.
    pub sponsor_line_patterns: Vec<String>,
    pub high_pacing_words: Vec<String>,
    pub low_pacing_words: Vec<String>,
    pub compound_terms: Vec<String>,
}

static TABLES: LazyLock<FeatureTables> = LazyLock::new(|| {
    let raw: RawTables =
        serde_json::from_str(TABLES_JSON).expect("feature_tables.json is embedded and valid");
    FeatureTables {
        domains: raw
            .domain_disambiguation
            .into_iter()
            .map(|entry| (entry.word, entry.domains))
            .collect(),
        tag_spam_words: raw.tag_spam_words.into_iter().collect(),
        sponsor_line_patterns: raw.sponsor_line_patterns,
        high_pacing_words: raw.high_pacing_words,
        low_pacing_words: raw.low_pacing_words,
        compound_terms: raw.compound_terms,
    }
});

#[must_use]
pub fn feature_tables() -> &'static FeatureTables {
    &TABLES
}
