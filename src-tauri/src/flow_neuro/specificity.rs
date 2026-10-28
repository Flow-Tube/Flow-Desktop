//! How specific a key is in general language, ported from Flow for Android's `NeuroSpecificity`
//! (#907): "pixel" or "snapdragon" name one subject, while "better", "top" and "year" sit in
//! titles of every subject. A viewer's own history cannot tell them apart, so the signal comes from
//! general word frequencies (`resources/neuro/freq/<lang>.txt`, one "word zipf×10" line per word,
//! mirrored from Android), keyed the way titles are.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::tables::list_fold;
use crate::flow_neuro::keyspec::text::fold_with;
use crate::flow_neuro::scoring::strip_domain_tag;

/// Words at or below this Zipf frequency are fully specific; at or above `HIGH_ZIPF`, as generic
/// as it gets.
const LOW_ZIPF: f64 = 4.0;
const HIGH_ZIPF: f64 = 5.5;
pub const MIN_SPECIFICITY: f64 = 0.05;

macro_rules! freq_files {
    ($($language:literal),* $(,)?) => {
        [$(($language, include_str!(concat!("../../resources/neuro/freq/", $language, ".txt")))),*]
    };
}

const FREQ_FILES: [(&str, &str); 17] = freq_files!(
    "ar", "cs", "de", "en", "es", "et", "fa", "fr", "id", "it", "pl", "pt", "ru", "tr", "uk", "vi",
    "zh",
);

fn words(language: &str) -> impl Iterator<Item = (String, i32)> {
    FREQ_FILES
        .iter()
        .filter(move |(name, _)| *name == language)
        .flat_map(|(_, text)| text.lines())
        .filter_map(|line| {
            let (word, zipf) = line.rsplit_once(' ')?;
            Some((
                fold_with(word, list_fold(language)),
                zipf.trim().parse().ok()?,
            ))
        })
}

/// Specificity for one key spec: English, the key language and the language profile.
pub struct Specificity {
    zipf_by_key: HashMap<String, i32>,
}

impl Specificity {
    fn build(spec: &KeySpec) -> Self {
        let mut languages = vec![
            "en".to_string(),
            spec.key_language.clone(),
            spec.language_profile.clone(),
        ];
        languages.dedup();
        let mut zipf_by_key: HashMap<String, i32> = HashMap::new();
        for language in languages.iter().filter(|l| !l.is_empty()) {
            // A key many words lead to takes the most frequent of them.
            for (word, zipf) in words(language) {
                let key = spec.key_of(&word);
                let entry = zipf_by_key.entry(key).or_insert(zipf);
                *entry = (*entry).max(zipf);
            }
        }
        Self { zipf_by_key }
    }

    /// From [`MIN_SPECIFICITY`] for the commonest words to 1 for rare ones. A phrase takes the
    /// geometric mean of its words, so "galaxy s26" stays specific and "long term" generic.
    #[must_use]
    pub fn of(&self, key: &str) -> f64 {
        let base = strip_domain_tag(key);
        let words: Vec<&str> = base.split(' ').collect();
        #[allow(clippy::cast_precision_loss)]
        let count = words.len() as f64;
        if words.len() == 1 {
            return self.of_word(words[0]);
        }
        words
            .iter()
            .map(|word| self.of_word(word))
            .product::<f64>()
            .powf(1.0 / count)
    }

    fn of_word(&self, word: &str) -> f64 {
        let Some(&zipf) = self.zipf_by_key.get(word) else {
            return 1.0;
        };
        ((HIGH_ZIPF - f64::from(zipf) / 10.0) / (HIGH_ZIPF - LOW_ZIPF)).clamp(MIN_SPECIFICITY, 1.0)
    }
}

type Cached = Option<(KeySpec, Arc<Specificity>)>;

static CACHE: Mutex<Cached> = Mutex::new(None);

/// The specificity table for `spec`; one brain is resident, so one spec is cached.
#[must_use]
pub fn specificity(spec: &KeySpec) -> Arc<Specificity> {
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((cached, table)) = cache.as_ref()
        && cached == spec
    {
        return table.clone();
    }
    let table = Arc::new(Specificity::build(spec));
    *cache = Some((spec.clone(), table.clone()));
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/learn_golden.json");

    #[test]
    fn specificity_matches_android() {
        let golden: Value = serde_json::from_str(GOLDEN).unwrap();
        for case in golden["specificity"].as_array().unwrap() {
            let spec = KeySpec::new(
                case["languageProfile"].as_str().unwrap(),
                case["keyLanguage"].as_str().unwrap(),
            );
            let table = Specificity::build(&spec);
            for section in ["keys", "phrases"] {
                for (key, expected) in case[section].as_object().unwrap() {
                    let got = table.of(key);
                    let expected = expected.as_f64().unwrap();
                    assert!(
                        (got - expected).abs() < 1e-9,
                        "{} {}: {key} is {got}, Android {expected}",
                        spec.key_language,
                        spec.language_profile,
                    );
                }
            }
        }
    }

    // Android NeuroSpecificityTest.
    #[test]
    fn chinese_words_every_subject_uses_are_not_specific() {
        let table = Specificity::build(&KeySpec::new("zh", "zh"));
        for word in ["新闻", "电影", "音乐", "游戏", "时候"] {
            assert!(table.of(word) < 0.5, "{word}: {}", table.of(word));
        }
        assert!((table.of("台积电") - 1.0).abs() < 1e-9);
    }
}
