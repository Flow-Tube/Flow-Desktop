//! Which language a title is written in, and how the viewer's profile follows it (Android
//! `NeuroLanguages`). A title gets the stop lists of the viewer's profile and of its own language
//! when [`detect`] is sure of it, so "des", "les" and "как" never become interests.

use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;
use std::sync::LazyLock;

use icu_properties::props::Script;

use super::chars::{is_letter, script};
use super::tables::tables;
use super::text::{fold, is_word_char, words};

/// Confident detections counted before the profile can move to another language.
pub const PROFILE_WINDOW: u32 = 200;

/// Share of [`PROFILE_WINDOW`] one other language needs to become the profile.
pub const PROFILE_SWITCH_SHARE: f64 = 0.7;

const MIN_HITS: u32 = 2;
const MIN_MARGIN: u32 = 2;
const MIN_SCRIPT_LETTERS: u32 = 2;

/// The function-word languages in Android's order, which settles a tie in favour of the earlier one.
const LANGUAGES: [&str; 11] = [
    "en", "es", "pt", "fr", "de", "it", "id", "tr", "pl", "cs", "et",
];

struct Index {
    word_languages: HashMap<String, Vec<usize>>,
    own_letters: HashMap<char, usize>,
    elisions: Vec<(HashSet<String>, Vec<usize>)>,
    letters: HashMap<&'static str, HashSet<char>>,
}

fn language_index(language: &str) -> usize {
    LANGUAGES
        .iter()
        .position(|l| *l == language)
        .expect("a function-word language")
}

static INDEX: LazyLock<Index> = LazyLock::new(|| {
    let tables = tables();
    let mut word_languages: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, language) in LANGUAGES.iter().enumerate() {
        for word in &tables.function_words[*language] {
            word_languages.entry(word.clone()).or_default().push(index);
        }
    }
    let own_letters = tables
        .own_letters
        .iter()
        .flat_map(|(language, letters)| letters.chars().map(|c| (c, language_index(language))))
        .collect();
    let elisions = ["fr", "fr it", "it"]
        .iter()
        .map(|group| {
            let prefixes = tables.elision_languages[*group].iter().cloned().collect();
            (prefixes, group.split(' ').map(language_index).collect())
        })
        .collect();
    let letters = [
        "persian",
        "urdu",
        "ukrainian",
        "otherCyrillic",
        "vietnamese",
    ]
    .into_iter()
    .map(|set| (set, tables.script_letters[set].chars().collect()))
    .collect();
    Index {
        word_languages,
        own_letters,
        elisions,
        letters,
    }
});

fn letter_in(set: &str, c: char) -> bool {
    INDEX.letters[set].contains(&c)
}

/// The two-letter code the stop lists use: "in-ID" reads "id", "iw" reads "he".
#[must_use]
pub fn normalize(code: &str) -> String {
    let language = code
        .split('-')
        .next()
        .and_then(|part| part.split('_').next())
        .unwrap_or_default()
        .to_lowercase();
    match language.as_str() {
        "in" => "id".to_string(),
        "iw" => "he".to_string(),
        "ji" => "yi".to_string(),
        _ => language,
    }
}

/// The language of `pieces`, the folded whitespace-separated pieces of a title, or `None` when
/// unsure. Scripts used by one language decide alone; Latin titles need two function words and a
/// lead of two points over the next language.
#[must_use]
pub fn detect(pieces: &[String]) -> Option<&'static str> {
    let mut count = ScriptCount::default();
    let mut ascii = true;
    for c in pieces.iter().flat_map(|piece| piece.chars()) {
        if c.is_ascii() {
            if c.is_ascii_alphabetic() {
                count.latin += 1;
            }
        } else {
            ascii = false;
            count.add(c);
        }
    }
    if let Some(language) = count.language() {
        let trimmed = |piece: &String| piece.trim_matches(|c| !is_word_char(c)).to_string();
        if language == "ru"
            && pieces
                .iter()
                .any(|piece| tables().ukrainian_words.contains(&trimmed(piece)))
        {
            return Some("uk");
        }
        return (!language.is_empty()).then_some(language);
    }
    if !ascii && vietnamese_words(pieces) >= MIN_HITS {
        return Some("vi");
    }
    function_word_language(pieces, ascii)
}

fn function_word_language(pieces: &[String], ascii: bool) -> Option<&'static str> {
    let mut points = [0u32; LANGUAGES.len()];
    let mut hits = [0u32; LANGUAGES.len()];
    for piece in pieces {
        let word = piece.trim_matches(|c| !is_word_char(c) && c != '\'');
        if !ascii {
            let own = word
                .chars()
                .find_map(|c| (!c.is_ascii()).then(|| INDEX.own_letters.get(&c)).flatten());
            if let Some(&language) = own {
                points[language] += 2;
                hits[language] += 1;
            }
        }
        let languages = INDEX
            .word_languages
            .get(word)
            .map(Vec::as_slice)
            .or_else(|| {
                if word.contains('\'') {
                    elision_languages(word)
                } else {
                    None
                }
            });
        let Some(languages) = languages else { continue };
        let weight = if languages.len() == 1 { 2 } else { 1 };
        for &language in languages {
            points[language] += weight;
            hits[language] += 1;
        }
    }
    let mut best = 0;
    let mut second = 0;
    for i in 1..points.len() {
        if points[i] > points[best] {
            second = points[best];
            best = i;
        } else if points[i] > second {
            second = points[i];
        }
    }
    (hits[best] >= MIN_HITS && points[best] - second >= MIN_MARGIN).then_some(LANGUAGES[best])
}

/// [`detect`] over raw `text`, such as a title and the first line of its description.
#[must_use]
pub fn detect_text(text: &str) -> Option<&'static str> {
    detect(&words(&fold(text)))
}

/// `profile` and `votes` after one more title whose language was `detected`. Every
/// [`PROFILE_WINDOW`] confident titles the votes are counted, and a language with
/// [`PROFILE_SWITCH_SHARE`] of them becomes the profile.
#[must_use]
pub fn vote<S: BuildHasher + Clone>(
    profile: &str,
    votes: &HashMap<String, u32, S>,
    detected: Option<&str>,
) -> (String, HashMap<String, u32, S>) {
    let Some(detected) = detected else {
        return (profile.to_string(), votes.clone());
    };
    let mut next = votes.clone();
    *next.entry(detected.to_string()).or_insert(0) += 1;
    let total: u32 = next.values().sum();
    if total < PROFILE_WINDOW {
        return (profile.to_string(), next);
    }
    // Two languages tied for the lead hold half the window at most, so a tie never switches.
    let switched = next
        .iter()
        .max_by_key(|(_, count)| **count)
        .filter(|(leader, count)| {
            leader.as_str() != profile
                && f64::from(**count) >= PROFILE_SWITCH_SHARE * f64::from(total)
        })
        .map(|(leader, _)| leader.clone());
    (
        switched.unwrap_or_else(|| profile.to_string()),
        HashMap::with_hasher(votes.hasher().clone()),
    )
}

fn elision_languages(word: &str) -> Option<&'static [usize]> {
    let (prefix, _) = word.split_once('\'')?;
    if prefix.is_empty() || word.encode_utf16().count() <= prefix.encode_utf16().count() + 1 {
        return None;
    }
    INDEX
        .elisions
        .iter()
        .find(|(prefixes, _)| prefixes.contains(prefix))
        .map(|(_, languages)| languages.as_slice())
}

fn vietnamese_words(pieces: &[String]) -> u32 {
    let count = pieces
        .iter()
        .filter(|piece| {
            piece
                .chars()
                .any(|c| ('Ạ'..='ỹ').contains(&c) || letter_in("vietnamese", c))
        })
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

#[expect(
    clippy::struct_excessive_bools,
    reason = "Android's tally, field for field"
)]
#[derive(Default)]
struct ScriptCount {
    latin: u32,
    hangul: u32,
    kana: u32,
    han: u32,
    devanagari: u32,
    arabic: u32,
    cyrillic: u32,
    persian: bool,
    urdu: bool,
    ukrainian: bool,
    other_cyrillic: bool,
}

impl ScriptCount {
    fn add(&mut self, c: char) {
        if !is_letter(c) {
            return;
        }
        match script(c) {
            Some(Script::Latin) => self.latin += 1,
            Some(Script::Hangul) => self.hangul += 1,
            Some(Script::Hiragana | Script::Katakana) => self.kana += 1,
            Some(Script::Han) => self.han += 1,
            Some(Script::Devanagari) => self.devanagari += 1,
            Some(Script::Arabic) => {
                self.arabic += 1;
                self.persian |= letter_in("persian", c);
                self.urdu |= letter_in("urdu", c);
            }
            Some(Script::Cyrillic) => {
                self.cyrillic += 1;
                self.ukrainian |= letter_in("ukrainian", c);
                self.other_cyrillic |= letter_in("otherCyrillic", c);
            }
            _ => {}
        }
    }

    /// A language decided by script, "" when the script has no supported language, `None` for Latin.
    fn language(&self) -> Option<&'static str> {
        // Kana and Hangul belong to one language each, so brand names around them do not matter.
        if self.kana >= MIN_SCRIPT_LETTERS {
            return Some("ja");
        }
        if self.hangul >= MIN_SCRIPT_LETTERS {
            return Some("ko");
        }
        let others =
            self.hangul + self.kana + self.han + self.devanagari + self.arabic + self.cyrillic;
        if others < MIN_SCRIPT_LETTERS || others < self.latin {
            return None;
        }
        Some(if self.kana > 0 {
            "ja"
        } else if self.han >= MIN_SCRIPT_LETTERS {
            "zh"
        } else if self.devanagari >= MIN_SCRIPT_LETTERS {
            "hi"
        } else if self.arabic >= MIN_SCRIPT_LETTERS {
            if self.urdu {
                ""
            } else if self.persian {
                "fa"
            } else {
                "ar"
            }
        } else if self.cyrillic >= MIN_SCRIPT_LETTERS {
            if self.other_cyrillic {
                ""
            } else if self.ukrainian {
                "uk"
            } else {
                "ru"
            }
        } else {
            ""
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{LANGUAGES, tables};

    #[test]
    fn the_language_order_covers_every_function_word_list() {
        let ordered: HashSet<&str> = LANGUAGES.into_iter().collect();
        let listed: HashSet<&str> = tables().function_words.keys().map(String::as_str).collect();
        assert_eq!(ordered, listed);
    }
}
