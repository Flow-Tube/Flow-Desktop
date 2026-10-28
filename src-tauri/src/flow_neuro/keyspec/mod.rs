//! Key spec 3: how text becomes the topic keys the engine learns, ranks and syncs by. A port of
//! Flow for Android's `NeuroKeySpec` pipeline; both apps pass Android's
//! `key_spec_golden.json`, so a brain synced between them holds one key per word.
//!
//! 1. Fold: NFKC, small capitals, lowercase, one apostrophe ([`text::fold`]). Traditional Chinese
//!    folds to Simplified unless the video holds kana; display forms keep the written spelling.
//! 2. Split at whitespace and punctuation; unspaced scripts by dictionary.
//! 3. Expressions: written variants read as one key ("lo-fi" reads "lofi").
//! 4. Possessives and French and Italian elisions come off.
//! 5. Stop words, years, bare numbers, short words and punctuation end a chunk.
//! 6. Runs of two or three words inside one chunk are candidates ([`Chunks::runs`]). Han
//!    characters the breaker leaves single merge with their neighbours ([`Chunks::merged`]).
//! 7. A run becomes a key once it is a phrase ([`phrases`]), a tag or a catalog topic; a merged
//!    Han run once [`phrases::is_merged_run`] says so.
//! 8. Each word's lemma is stemmed by its script and the key language ([`stemmer`]).
//!
//! Spec 3 changes stages 1, 6 and 7 for Chinese.

mod chars;
mod chunker;
pub mod languages;
pub mod phrases;
pub mod stemmer;
pub mod tables;
pub mod text;

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

pub use chunker::{Chunks, Run};

use chars::trim;
use tables::{raw_stop_list, tables};
use text::{HanFold, fold_with, has_kana, is_word_char, simplified};

/// The key spec version Android advertises in sync (`NeuroKeySpec.VERSION`).
pub const VERSION: u32 = 3;

/// The first spec that folds Traditional Chinese and merges Han runs (`NeuroKeySpec.HAN_SPEC`).
pub const HAN_SPEC: u32 = 3;

/// A word-level rejection pattern ("~guitar") keeps its mark through a re-key.
const WORD_PATTERN: char = '~';

/// How one viewer's text becomes keys: the stop words of `language_profile` apply to every
/// title, and words stem for `key_language`, which unlike the profile never follows what the
/// viewer watches, so a word keeps one key for the life of a brain. `version` is the key spec
/// read by, [`VERSION`] except while a brain converts from an older one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeySpec {
    pub language_profile: String,
    pub key_language: String,
    pub version: u32,
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
            version: VERSION,
        }
    }

    /// The same viewer read by key spec `version` (Android `NeuroTokenizer.atKeySpec`).
    #[must_use]
    pub fn at_version(&self, version: u32) -> Self {
        Self {
            version,
            ..self.clone()
        }
    }

    /// Whether keys fold Traditional Chinese and merge Han runs: from [`HAN_SPEC`], for every
    /// viewer but a Japanese one, whose kanji stay as written.
    #[must_use]
    pub fn han_folds(&self) -> bool {
        self.version >= HAN_SPEC && self.language_profile != "ja"
    }

    /// How text with no video around it folds Han.
    #[must_use]
    pub fn default_han(&self) -> HanFold {
        if self.han_folds() {
            HanFold::UnlessKana
        } else {
            HanFold::None
        }
    }

    /// One fold for every field of a video: kana in its title, channel name or tags makes the
    /// whole video Japanese and turns the fold off (Android `NeuroTokenizer.hanFoldOf`).
    #[must_use]
    pub fn han_fold_of<'a>(
        &self,
        title: &str,
        channel_name: &str,
        tags: impl IntoIterator<Item = &'a str>,
    ) -> HanFold {
        let kana = has_kana(title) || has_kana(channel_name) || tags.into_iter().any(has_kana);
        if self.han_folds() && !kana {
            HanFold::Always
        } else {
            HanFold::None
        }
    }

    /// `text` folded as this viewer folds text with no video around it.
    #[must_use]
    pub fn fold(&self, text: &str) -> String {
        fold_with(text, self.default_han())
    }

    /// `text` read by the key spec: its chunks of words that belong together.
    #[must_use]
    pub fn chunk(&self, text: &str) -> Chunks {
        chunker::chunk(self, text, self.default_han())
    }

    /// [`KeySpec::chunk`] with a video's own Han fold ([`KeySpec::han_fold_of`]).
    #[must_use]
    pub fn chunk_with(&self, text: &str, han: HanFold) -> Chunks {
        chunker::chunk(self, text, han)
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

    /// The keys a short label stands for, such as an onboarding pick: one per chunk, so "Lo-Fi"
    /// reads "lofi" and "Health & Fitness" reads "health" and "fitness", the keys titles produce.
    #[must_use]
    pub fn keys_of(&self, label: &str) -> Vec<String> {
        let chunks = self.chunk(label).chunks;
        if !chunks.is_empty() {
            return chunks.iter().map(|chunk| chunk.join(" ")).collect();
        }
        let key = self.key_of(trim(&self.fold(label)));
        if trim(&key).is_empty() {
            Vec::new()
        } else {
            vec![key]
        }
    }

    /// The keys a stored key reads as under this spec (Android `NeuroKeyMigration.keyFunction`,
    /// which sync's `BrainKeyRekey` applies to a peer's brain): one, several when it splits, none
    /// when it goes. A key holding punctuation or an expression is chunked again; any other key is
    /// read word by word, which leaves a key already read unchanged. A "~" mark and a ":domain"
    /// tag are kept.
    #[must_use]
    pub fn rekey(&self, key: &str) -> Vec<String> {
        if let Some(word) = key.strip_prefix(WORD_PATTERN) {
            return self
                .rekey(word)
                .into_iter()
                .map(|read| format!("{WORD_PATTERN}{read}"))
                .collect();
        }
        let (base, tag) = match key.split_once(':') {
            Some((base, tag)) if !tag.is_empty() => (base, tag),
            _ => (key, ""),
        };
        let read = if self.han_folds() {
            simplified(base, false)
        } else {
            base.to_string()
        };
        let base = read.as_str();
        let parts = if needs_rechunk(base) {
            self.chunk(base)
                .chunks
                .iter()
                .map(|chunk| chunk.join(" "))
                .collect()
        } else {
            let words: Vec<String> = base.split(' ').map(|word| self.key_of(word)).collect();
            vec![words.join(" ")]
        };
        if tag.is_empty() {
            parts
        } else {
            parts
                .into_iter()
                .map(|part| format!("{part}:{tag}"))
                .collect()
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

fn needs_rechunk(base: &str) -> bool {
    let expressions = &tables().expressions;
    base.chars().any(|c| c != ' ' && !is_word_char(c))
        || expressions.contains_key(base)
        || expressions.keys().any(|variant| {
            variant.contains(' ') && format!(" {base} ").contains(&format!(" {variant} "))
        })
}
