//! Stage 1 and the word split of stage 2 (Android `NeuroText`): styled letters fold to plain
//! ones, and scripts written without spaces split into dictionary words.

use icu_properties::props::Script;
use icu_segmenter::WordSegmenter;
use icu_segmenter::options::WordBreakInvariantOptions;
use unicode_normalization::UnicodeNormalization;

use super::chars::{is_letter_or_digit, is_mark, is_whitespace, script, utf16_len};
use super::tables::tables;

// NFKC has no mapping for small capitals, a common way to style titles.
const SMALL_CAPS: [(char, char); 25] = [
    ('ᴀ', 'a'),
    ('ʙ', 'b'),
    ('ᴄ', 'c'),
    ('ᴅ', 'd'),
    ('ᴇ', 'e'),
    ('ꜰ', 'f'),
    ('ɢ', 'g'),
    ('ʜ', 'h'),
    ('ɪ', 'i'),
    ('ᴊ', 'j'),
    ('ᴋ', 'k'),
    ('ʟ', 'l'),
    ('ᴍ', 'm'),
    ('ɴ', 'n'),
    ('ᴏ', 'o'),
    ('ᴘ', 'p'),
    ('ꞯ', 'q'),
    ('ʀ', 'r'),
    ('ꜱ', 's'),
    ('ᴛ', 't'),
    ('ᴜ', 'u'),
    ('ᴠ', 'v'),
    ('ᴡ', 'w'),
    ('ʏ', 'y'),
    ('ᴢ', 'z'),
];

const APOSTROPHES: [char; 5] = ['\u{2019}', '\u{2018}', '\u{02BC}', '`', '\u{00B4}'];

// Turkish dotted capital I, the emoji variation selector and joiner, and the Unicode hyphens.
const MARKS: [char; 5] = ['\u{0130}', '\u{FE0F}', '\u{200D}', '\u{2010}', '\u{2011}'];

const UNSPACED_SCRIPTS: [Script; 7] = [
    Script::Han,
    Script::Hiragana,
    Script::Katakana,
    Script::Thai,
    Script::Lao,
    Script::Khmer,
    Script::Myanmar,
];

/// Lowercase plain letters: "𝙋𝙃𝙊𝙉𝙆", "ｐｈｏｎｋ", "ⓟⓗⓞⓝⓚ" and "ᴘʜᴏɴᴋ" all read "phonk". Every
/// apostrophe reads ', Turkish İ reads i, and emoji joiners are dropped.
#[must_use]
pub fn fold(text: &str) -> String {
    if text.is_ascii() {
        return text.to_ascii_lowercase().replace('`', "'");
    }
    // Before NFKC, which turns ´ into a space and a combining accent.
    let marked: String = text
        .chars()
        .filter_map(|c| match c {
            c if APOSTROPHES.contains(&c) => Some('\''),
            '\u{0130}' => Some('i'),
            '\u{2010}' | '\u{2011}' => Some('-'),
            c if MARKS.contains(&c) => None,
            c => Some(c),
        })
        .collect();
    // NFKC splits Thai and Lao SARA AM into two characters no dictionary or title uses; put it back.
    let normalized = marked
        .nfkc()
        .collect::<String>()
        .replace("\u{0E4D}\u{0E32}", "\u{0E33}")
        .replace("\u{0ECD}\u{0EB2}", "\u{0EB3}");
    let plain: String = normalized
        .chars()
        .map(|c| {
            SMALL_CAPS
                .iter()
                .find(|(small, _)| *small == c)
                .map_or(c, |(_, plain)| *plain)
        })
        .collect();
    plain.to_lowercase()
}

/// The words of folded text, split at ASCII whitespace as Java's `\s+` does. Chinese, Japanese,
/// Thai, Lao, Khmer and Burmese runs are split by the ICU dictionary word breaker.
#[must_use]
pub fn words(folded: &str) -> Vec<String> {
    folded
        .split([' ', '\t', '\n', '\u{0B}', '\u{0C}', '\r'])
        // Android keeps an empty piece at either end; no later stage reads anything from one.
        .filter(|piece| !piece.is_empty())
        .flat_map(|piece| {
            if piece.chars().any(is_unspaced) {
                segment(piece)
            } else {
                vec![piece.to_string()]
            }
        })
        .collect()
}

/// A letter, digit or combining mark: the marks spell vowels and tones in Thai and Devanagari words.
#[must_use]
pub fn is_word_char(c: char) -> bool {
    is_letter_or_digit(c) || is_mark(c)
}

/// Long enough to be a topic: three letters, a known short name, or two characters of an unspaced
/// script. Lengths are UTF-16 units, as on Android.
#[must_use]
pub fn is_topic_sized(word: &str) -> bool {
    match utf16_len(word) {
        n if n >= 3 => !is_grammar_kana(word),
        _ if tables().short_topics.contains(word) => true,
        2 => word.chars().all(is_unspaced) && !is_grammar_kana(word),
        _ => false,
    }
}

fn is_unspaced(c: char) -> bool {
    !is_whitespace(c) && script(c).is_some_and(|s| UNSPACED_SCRIPTS.contains(&s))
}

// Hiragana-only words are almost always particles and inflections, not subjects.
fn is_grammar_kana(word: &str) -> bool {
    word.chars().all(|c| script(c) == Some(Script::Hiragana))
}

fn segment(chunk: &str) -> Vec<String> {
    let breaks: Vec<usize> = WordSegmenter::new_dictionary(WordBreakInvariantOptions::default())
        .segment_str(chunk)
        .collect();
    breaks
        .windows(2)
        .map(|pair| &chunk[pair[0]..pair[1]])
        .filter(|word| word.chars().any(is_letter_or_digit))
        .map(str::to_string)
        .collect()
}
