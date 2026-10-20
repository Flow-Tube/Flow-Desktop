//! Keys are folded and stemmed for matching ("machin learn"); people read them as titles write
//! them (Android `NeuroDisplayForms`). Each key keeps the spelling titles use most, for every label
//! and every search text. Only keys written differently from the key itself are stored.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::tables::tables;
use crate::flow_neuro::keyspec::text::is_word_char;
use crate::flow_neuro::scoring::strip_domain_tag;

pub const MAX_ENTRIES: usize = 2_000;
const MAX_VOTES: u32 = 20;

/// How titles write a key ("MMA", "Machine Learning"), and how sure that spelling is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayForm {
    pub form: String,
    #[serde(default = "one_vote")]
    pub votes: u32,
}

fn one_vote() -> u32 {
    1
}

impl DisplayForm {
    fn new(form: &str) -> Self {
        Self {
            form: form.to_string(),
            votes: 1,
        }
    }
}

pub type DisplayForms = HashMap<String, DisplayForm>;

/// The spelling of each of `keys` in `text`, where `text` holds it.
#[must_use]
pub fn spellings_in<'a>(
    text: &str,
    keys: impl IntoIterator<Item = &'a String>,
    spec: &KeySpec,
) -> HashMap<String, String> {
    let wanted: std::collections::HashSet<String> =
        keys.into_iter().map(|key| strip_domain_tag(key)).collect();
    if wanted.is_empty() || text.trim().is_empty() {
        return HashMap::new();
    }
    let normalized: String = text.nfkc().collect();
    let pieces: Vec<&str> = normalized
        .split([' ', '\t', '\n', '\u{0B}', '\u{0C}', '\r'])
        .map(|piece| {
            let trimmed = piece.trim_matches(|c| !is_word_char(c) && c != '+' && c != '#');
            let trimmed = trimmed.strip_suffix("'s").unwrap_or(trimmed);
            trimmed.strip_suffix("\u{2019}s").unwrap_or(trimmed)
        })
        .collect();
    let mut words = Vec::new();
    let mut piece_of = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        for word in spec.chunk(piece).words() {
            words.push(word);
            piece_of.push(index);
        }
    }
    let max_run = tables().max_run_words;
    let mut found = HashMap::new();
    for from in 0..words.len() {
        for to in from + 1..=words.len().min(from + max_run) {
            // Only words that stand next to each other in the title spell a key together.
            if to - from > 1 && piece_of[to - 1] - piece_of[to - 2] > 1 {
                break;
            }
            let key = words[from..to].join(" ");
            if wanted.contains(&key) && !found.contains_key(&key) {
                let spelling = pieces[piece_of[from]..=piece_of[to - 1]].join(" ");
                if spelling != key {
                    found.insert(key, spelling);
                }
            }
        }
    }
    found
}

/// `forms` after one more title wrote `spellings`: a spelling seen often enough replaces another.
/// Over [`MAX_ENTRIES`], the keys `keep` holds and then the surest spellings stay.
#[must_use]
pub fn record(
    forms: &DisplayForms,
    spellings: &HashMap<String, String>,
    keep: impl Fn(&str) -> bool,
) -> DisplayForms {
    if spellings.is_empty() {
        return forms.clone();
    }
    let mut updated = forms.clone();
    for (key, spelling) in spellings {
        let next = match updated.get(key) {
            None => DisplayForm::new(spelling),
            Some(current) if current.form == *spelling => DisplayForm {
                form: current.form.clone(),
                votes: (current.votes + 1).min(MAX_VOTES),
            },
            Some(current) if current.votes <= 1 => DisplayForm::new(spelling),
            Some(current) => DisplayForm {
                form: current.form.clone(),
                votes: current.votes - 1,
            },
        };
        updated.insert(key.clone(), next);
    }
    if updated.len() <= MAX_ENTRIES {
        return updated;
    }
    let mut entries: Vec<(String, DisplayForm)> = updated.into_iter().collect();
    entries.sort_by(|a, b| {
        keep(&b.0)
            .cmp(&keep(&a.0))
            .then(b.1.votes.cmp(&a.1.votes))
            .then_with(|| a.0.cmp(&b.0))
    });
    entries.truncate(MAX_ENTRIES);
    entries.into_iter().collect()
}

/// `forms` given spellings from text that is not a title (a channel name, an onboarding pick):
/// they fill only keys no title has spelled yet, so "google pixel" never outvotes "Google Pixel".
#[must_use]
pub fn fill_gaps(
    forms: &DisplayForms,
    spellings: &HashMap<String, String>,
    keep: impl Fn(&str) -> bool,
) -> DisplayForms {
    let gaps: HashMap<String, String> = spellings
        .iter()
        .filter(|(key, _)| !forms.contains_key(*key))
        .map(|(key, spelling)| (key.clone(), capitalized(spelling)))
        .collect();
    record(forms, &gaps, keep)
}

/// `key` as a label: its spelling in titles, else each word with a capital ("Claude 5.5").
#[must_use]
pub fn label(forms: &DisplayForms, key: &str) -> String {
    let base = strip_domain_tag(key);
    forms
        .get(&base)
        .map_or_else(|| capitalized(&base), |form| form.form.clone())
}

/// `text` with each word capitalized, unless it already holds a capital ("iPhone" stays).
#[must_use]
pub fn capitalized(text: &str) -> String {
    if text.chars().any(char::is_uppercase) {
        return text.to_string();
    }
    text.split(' ')
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().chain(chars).collect()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `forms` with each onboarding pick written as the viewer chose it ("Cooking"), even before any
/// title writes it.
#[must_use]
pub fn with_pick_spellings<'a>(
    forms: &DisplayForms,
    labels: impl IntoIterator<Item = &'a String>,
    spec: &KeySpec,
) -> DisplayForms {
    let mut current = forms.clone();
    for label in labels {
        let keys = spec.keys_of(label);
        // A label that is one key is that key's spelling, words like "of" included ("Call of Duty").
        let spellings = match keys.as_slice() {
            [only] => HashMap::from([(only.clone(), label.trim().to_string())]),
            _ => spellings_in(label, &keys, spec),
        };
        let spellings = spellings
            .into_iter()
            .filter(|(key, spelling)| key != spelling)
            .collect();
        current = record(&current, &spellings, |_| true);
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn a_title_spells_its_keys() {
        let spec = KeySpec::default();
        let title = "Restoring Vintage Guitars: Machine Learning Edition";
        let wanted = keys(&[
            &spec.key_of("restoring"),
            &spec.key_of("vintage"),
            "guitar",
            &spec.rekey("machine learning")[0],
        ]);
        let found = spellings_in(title, &wanted, &spec);
        assert_eq!(found[&spec.key_of("vintage")], "Vintage");
        assert_eq!(found["guitar"], "Guitars");
        assert_eq!(
            found[&spec.rekey("machine learning")[0]],
            "Machine Learning"
        );
    }

    #[test]
    fn a_spelling_needs_votes_to_replace_another() {
        let mut forms = DisplayForms::new();
        let spell = |text: &str| HashMap::from([("mma".to_string(), text.to_string())]);
        forms = record(&forms, &spell("MMA"), |_| true);
        forms = record(&forms, &spell("MMA"), |_| true);
        forms = record(&forms, &spell("Mma"), |_| true);
        assert_eq!(label(&forms, "mma"), "MMA");
        forms = record(&forms, &spell("Mma"), |_| true);
        forms = record(&forms, &spell("Mma"), |_| true);
        assert_eq!(label(&forms, "mma"), "Mma");
    }

    #[test]
    fn a_label_falls_back_to_capitals() {
        let forms = DisplayForms::new();
        assert_eq!(label(&forms, "claude 5.5:ai"), "Claude 5.5");
        assert_eq!(capitalized("iPhone"), "iPhone");
    }

    #[test]
    fn gaps_fill_without_outvoting_titles() {
        let titled = record(
            &DisplayForms::new(),
            &HashMap::from([("googl pixel".to_string(), "Google Pixel".to_string())]),
            |_| true,
        );
        let filled = fill_gaps(
            &titled,
            &HashMap::from([
                ("googl pixel".to_string(), "google pixel".to_string()),
                ("lofi".to_string(), "lo-fi".to_string()),
            ]),
            |_| true,
        );
        assert_eq!(label(&filled, "googl pixel"), "Google Pixel");
        assert_eq!(label(&filled, "lofi"), "Lo-fi");
    }

    #[test]
    fn learning_from_a_title_keeps_its_spellings() {
        use crate::flow_neuro::learning::{Interaction, apply_interaction};
        use crate::flow_neuro::scoring::UserBrain;
        use crate::flow_neuro::signals::InteractionType;

        let mut brain = UserBrain::default();
        apply_interaction(
            &mut brain,
            &Interaction {
                video_id: "v1",
                title: "Restoring Vintage Guitars",
                channel_name: "Guitar Workshop",
                channel_id: "c1",
                description: None,
                duration_sec: Some(600),
                is_live: false,
                is_short: false,
                kind: InteractionType::Watched,
                percent_watched: 0.9,
                seconds_since_impression: None,
            },
        );
        let spec = brain.key_spec();
        assert_eq!(label(&brain.display_forms, "guitar"), "Guitars");
        assert_eq!(
            label(&brain.display_forms, &spec.key_of("restoring")),
            "Restoring"
        );
    }

    #[test]
    fn a_pick_is_written_as_chosen() {
        let spec = KeySpec::default();
        let forms = with_pick_spellings(
            &DisplayForms::new(),
            &keys(&["Call of Duty", "Machine Learning"]),
            &spec,
        );
        assert_eq!(
            label(&forms, &spec.rekey("machine learning")[0]),
            "Machine Learning"
        );
    }
}
