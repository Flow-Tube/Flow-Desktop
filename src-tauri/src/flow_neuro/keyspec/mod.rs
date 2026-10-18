//! Key spec 2: how text becomes the topic keys the engine learns, ranks and syncs by. A port of
//! Flow for Android's `NeuroKeySpec` pipeline; both apps pass Android's
//! `key_spec_golden.json`, so a brain synced between them holds one key per word.
//!
//! 1. Fold: NFKC, small capitals, lowercase, one apostrophe ([`text::fold`]).
//! 2. Split at whitespace and punctuation; unspaced scripts by dictionary.
//! 3. Expressions: written variants read as one key ("lo-fi" reads "lofi").
//! 4. Possessives and French and Italian elisions come off.
//! 5. Stop words, years, bare numbers, short words and punctuation end a chunk.
//! 6. Runs of two or three words inside one chunk are candidates ([`Chunks::runs`]).
//! 7. A run becomes a key once it is a phrase, a tag or a catalog topic.
//! 8. Each word's lemma is stemmed by its script and the key language ([`stemmer`]).

mod chars;
mod chunker;
pub mod languages;
pub mod stemmer;
pub mod tables;
pub mod text;

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

pub use chunker::{Chunks, Run};

use tables::{raw_stop_list, tables};

/// The key spec version Android advertises in sync (`NeuroKeySpec.VERSION`).
pub const VERSION: u32 = 2;

/// How one viewer's text becomes keys: the stop words of `language_profile` apply to every
/// title, and words stem for `key_language`, which unlike the profile never follows what the
/// viewer watches, so a word keeps one key for the life of a brain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeySpec {
    pub language_profile: String,
    pub key_language: String,
}

impl Default for KeySpec {
    fn default() -> Self {
        Self::new("en", "en")
    }
}

/// `word`'s lemma: the lemma map's word for it, or the word in lowercase.
#[must_use]
pub fn normalize_lemma(word: &str) -> String {
    let lower = word.to_lowercase();
    tables().lemmas.get(&lower).cloned().unwrap_or(lower)
}

static STOP_LISTS: LazyLock<HashMap<String, HashSet<String>>> = LazyLock::new(|| {
    let tables = tables();
    tables
        .stop_list_languages
        .iter()
        .map(|language| {
            let words = raw_stop_list(language)
                .into_iter()
                .flatten()
                .filter(|word| !tables.protected_words.contains(*word))
                .cloned()
                .collect();
            (language.clone(), words)
        })
        .collect()
});

static NO_STOP_WORDS: LazyLock<HashSet<String>> = LazyLock::new(HashSet::new);

impl KeySpec {
    #[must_use]
    pub fn new(language_profile: &str, key_language: &str) -> Self {
        Self {
            language_profile: language_profile.to_string(),
            key_language: key_language.to_string(),
        }
    }

    /// `text` read by the key spec: its chunks of words that belong together.
    #[must_use]
    pub fn chunk(&self, text: &str) -> Chunks {
        chunker::chunk(self, text)
    }

    /// `word`'s key: its lemma stemmed for the key language, or the lemma when the stem is itself
    /// a lemma-map word. A key is its own key.
    #[must_use]
    pub fn key_of(&self, word: &str) -> String {
        let lemma = normalize_lemma(word);
        let stem = stemmer::key(&lemma, &self.key_language);
        if normalize_lemma(&stem) == stem {
            stem
        } else {
            lemma
        }
    }

    /// `language`'s stop words, less the words no list may remove; none when it has no list.
    #[must_use]
    pub fn stop_list(language: &str) -> &'static HashSet<String> {
        STOP_LISTS.get(language).unwrap_or(&NO_STOP_WORDS)
    }

    /// The stop words of one title: everyone's, the profile's, and the title's own language's.
    fn stop_words_for(&self, pieces: &[String]) -> impl Fn(&str) -> bool + use<> {
        let base = &tables().stop_words;
        let profile = Self::stop_list(&self.language_profile);
        let title = languages::detect(pieces)
            .filter(|language| *language != self.language_profile)
            .map_or(&*NO_STOP_WORDS, Self::stop_list);
        move |word| base.contains(word) || profile.contains(word) || title.contains(word)
    }
}
