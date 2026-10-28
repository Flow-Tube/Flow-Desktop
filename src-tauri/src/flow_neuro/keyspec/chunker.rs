//! Stages 2 to 6 (Android `NeuroChunker`): folded text into chunks of words that belong together.
//! A title pair is only a candidate when nothing separates its words, so "Big Tech's Privacy
//! Promises Are Lies" never yields "promises lies".

use super::KeySpec;
use super::chars::{is_digit, utf16_len};
use super::tables::{DERIVED, format_of, run_breaks, tables};
use super::text::{
    HanFold, Piece, fold_with, is_han, is_kana, is_topic_sized, is_word_char, pieces,
};

const JOINERS: [char; 3] = ['-', '.', '&'];
const KEEP_SUFFIX: [char; 2] = ['+', '#'];

/// The longest merged Han run, in characters.
const MAX_MERGED_CHARS: usize = 5;

/// A title read by the key spec: its chunks of keyed words, the "word number" model pairs it
/// names ("pixel 10") and the formats it announces, in reading order. `merged` holds the runs of
/// Han characters the word breaker left single ("周杰伦"), candidates until
/// [`super::phrases::is_merged_run`] promotes one, and `singles` those single characters, which
/// count toward document frequency.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Chunks {
    pub chunks: Vec<Vec<String>>,
    pub model_pairs: Vec<String>,
    pub formats: Vec<String>,
    pub merged: Vec<String>,
    pub singles: Vec<String>,
}

/// A run of [`Chunks::words`] inside one chunk, from word `from` up to but not including `to`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub key: String,
    pub chunk: usize,
    pub from: usize,
    pub to: usize,
}

impl Chunks {
    /// Every word in reading order, never-alone words included.
    #[must_use]
    pub fn words(&self) -> Vec<String> {
        self.chunks.iter().flatten().cloned().collect()
    }

    /// Every run of two or three words inside one chunk.
    #[must_use]
    pub fn runs(&self) -> Vec<Run> {
        let tables = tables();
        let mut runs = Vec::new();
        for (index, chunk) in self.chunks.iter().enumerate() {
            for from in 0..chunk.len() {
                let mut words = word_count(&chunk[from]);
                for to in from + 2..=chunk.len() {
                    words += word_count(&chunk[to - 1]);
                    if words > tables.max_run_words {
                        break;
                    }
                    let key = chunk[from..to].join(" ");
                    if utf16_len(&key) <= tables.max_key_length {
                        runs.push(Run {
                            key,
                            chunk: index,
                            from,
                            to,
                        });
                    }
                }
            }
        }
        runs
    }
}

fn word_count(word: &str) -> usize {
    word.matches(' ').count() + 1
}

#[derive(Clone)]
enum Item {
    Word { text: String, whole: bool },
    Number(String),
    Format(String),
    Break,
}

impl Item {
    fn word(text: impl Into<String>) -> Self {
        Self::Word {
            text: text.into(),
            whole: false,
        }
    }

    fn whole(text: impl Into<String>) -> Self {
        Self::Word {
            text: text.into(),
            whole: true,
        }
    }
}

pub(crate) fn chunk(spec: &KeySpec, text: &str, han: HanFold) -> Chunks {
    let folded = fold_with(text, han);
    let spans = pieces(&folded);
    let pieces: Vec<String> = spans.iter().map(|span| span.text.clone()).collect();
    let is_stop_word = spec.stop_words_for(&pieces);
    let mut items = Vec::new();
    for piece in &pieces {
        split(piece, &mut items);
    }
    let mut out = Chunks::default();
    let mut current: Vec<String> = Vec::new();
    for item in merge_expressions(&items) {
        match classify(spec, item, &is_stop_word) {
            Item::Word { text, .. } => current.push(text),
            Item::Number(number) => {
                if let Some(previous) = current.last() {
                    out.model_pairs.push(format!("{previous} {number}"));
                }
                close(&mut out, &mut current);
            }
            Item::Format(id) => {
                if !out.formats.contains(&id) {
                    out.formats.push(id);
                }
                close(&mut out, &mut current);
            }
            Item::Break => close(&mut out, &mut current),
        }
    }
    close(&mut out, &mut current);
    if han != HanFold::None {
        merge_han_runs(&folded, &spans, &is_stop_word, han, &mut out);
    }
    out
}

/// Stage 6 for Chinese: Han characters the breaker left single join into one candidate with the
/// single characters beside them, the word before them, or (after a lone character) the word after
/// it, split at the language's break characters. A run is 2 to [`MAX_MERGED_CHARS`] characters and
/// holds no stop or format word; a format word inside one still counts as a format.
fn merge_han_runs(
    folded: &str,
    spans: &[Piece],
    is_stop_word: &impl Fn(&str) -> bool,
    han: HanFold,
    out: &mut Chunks,
) {
    if !folded.chars().any(is_han) {
        return;
    }
    let language = if han == HanFold::UnlessKana && folded.chars().any(is_kana) {
        "ja"
    } else {
        "zh"
    };
    let Some(breaks) = run_breaks(language) else {
        return;
    };
    let valid = |candidate: &[char]| {
        (2..=MAX_MERGED_CHARS).contains(&candidate.len())
            && (2..=candidate.len()).all(|length| {
                candidate.windows(length).all(|part| {
                    let part: String = part.iter().collect();
                    !is_stop_word(&part) && format_of(&part).is_none()
                })
            })
    };
    let mut keys: Vec<String> = Vec::new();
    let flush = |group: &mut Vec<Vec<char>>, out: &mut Chunks, keys: &mut Vec<String>| {
        let mut i = 0;
        while i < group.len() {
            if group[i].len() != 1 {
                i += 1;
                continue;
            }
            let mut end = i;
            while end < group.len() && group[end].len() == 1 {
                end += 1;
            }
            let run: Vec<char> = group[i..end].iter().flatten().copied().collect();
            let prefix: &[char] = match i.checked_sub(1).map(|p| &group[p]) {
                Some(word) if word.len() >= 2 => word,
                _ => &[],
            };
            let suffix: &[char] = match group.get(end) {
                Some(word) if run.len() == 1 && word.len() >= 2 => word,
                _ => &[],
            };
            for single in &group[i..end] {
                add(&mut out.singles, single.iter().collect());
            }
            for length in 2..=run.len() {
                for part in run.windows(length) {
                    let part: String = part.iter().collect();
                    if let Some(format) = format_of(&part) {
                        add(&mut out.formats, format.to_string());
                    }
                }
            }
            if valid(&run) {
                add(keys, run.iter().collect());
            }
            if !prefix.is_empty() {
                let joined: Vec<char> = prefix.iter().chain(&run).copied().collect();
                if valid(&joined) {
                    add(keys, joined.iter().collect());
                }
            }
            if !suffix.is_empty() {
                let joined: Vec<char> = run.iter().chain(suffix).copied().collect();
                if valid(&joined) {
                    add(keys, joined.iter().collect());
                }
            }
            i = end;
        }
        group.clear();
    };
    let mut group: Vec<Vec<char>> = Vec::new();
    for span in spans {
        let chars: Vec<char> = span.text.chars().collect();
        let all_han = chars.iter().all(|c| is_han(*c));
        let is_break = chars.len() == 1 && breaks.contains(&chars[0]);
        if !all_han || !span.joined || is_break {
            flush(&mut group, out, &mut keys);
        }
        if all_han && !is_break {
            group.push(chars);
        }
    }
    flush(&mut group, out, &mut keys);
    out.merged = keys;
}

fn close(out: &mut Chunks, current: &mut Vec<String>) {
    if !current.is_empty() {
        out.chunks.push(std::mem::take(current));
    }
}

// Stages 2 and 4: one whitespace-separated piece into words and breaks.
fn split(piece: &str, out: &mut Vec<Item>) {
    // A lone "&" stays a word until expressions are read, so "drum & bass" can still match one.
    if piece == "&" {
        out.push(Item::word(piece));
        return;
    }
    let chars: Vec<char> = piece.chars().collect();
    let mut word = String::new();
    for (i, &c) in chars.iter().enumerate() {
        let next = chars.get(i + 1).copied();
        if is_word_char(c) {
            word.push(c);
        } else if c == '\'' {
            if !word.is_empty() {
                word.push(c);
            }
        } else if JOINERS.contains(&c) && !word.is_empty() && next.is_some_and(is_word_char) {
            word.push(c);
        } else if c == '.' && next.is_none() && word.contains('.') {
            // The last dot of an abbreviation ("a.i.") is part of it, not the end of a sentence.
        } else if KEEP_SUFFIX.contains(&c) && !word.is_empty() && keeps_whole(&word, &chars[i..]) {
            word.push(c);
        } else {
            flush(&mut word, out);
            out.push(Item::Break);
        }
    }
    flush(&mut word, out);
}

fn flush(word: &mut String, out: &mut Vec<Item>) {
    if !word.is_empty() {
        shape(&std::mem::take(word), out);
    }
}

fn keeps_whole(word: &str, rest: &[char]) -> bool {
    let suffix: String = rest
        .iter()
        .take_while(|c| KEEP_SUFFIX.contains(c))
        .collect();
    tables().keep_whole.contains(&format!("{word}{suffix}"))
}

fn shape(raw: &str, out: &mut Vec<Item>) {
    let tables = tables();
    if tables.keep_whole.contains(raw) {
        out.push(Item::whole(raw));
        return;
    }
    if let Some(key) = tables.expressions.get(raw) {
        out.push(Item::whole(key.as_str()));
        return;
    }
    if tables.contractions.contains(raw) {
        out.push(Item::Break);
        return;
    }
    let elided = tables
        .elisions
        .iter()
        .find(|elision| raw.len() > elision.len() && raw.starts_with(elision.as_str()))
        .map_or(raw, |elision| &raw[elision.len()..]);
    let possessive = elided
        .strip_suffix("'s")
        .or_else(|| elided.strip_suffix('\''))
        .unwrap_or(elided);
    let word = possessive.replace('\'', "");
    if let Some(key) = tables.expressions.get(&word) {
        out.push(Item::whole(key.as_str()));
        return;
    }
    if word.contains('-') {
        let parts: Vec<&str> = word.split('-').filter(|part| !part.is_empty()).collect();
        if parts.iter().any(|part| utf16_len(part) <= 2) {
            out.push(Item::word(parts.concat()));
        } else {
            out.extend(parts.into_iter().map(Item::word));
        }
        return;
    }
    if word.contains('.') && !is_number(&word) {
        out.extend(
            word.split('.')
                .filter(|part| !part.is_empty())
                .map(Item::word),
        );
        return;
    }
    out.push(Item::word(word));
}

fn is_number(text: &str) -> bool {
    text.chars().all(|c| is_digit(c) || c == '.')
}

// Stage 3, for expressions written as separate words ("lo fi", "drum n bass").
fn merge_expressions(items: &[Item]) -> Vec<Item> {
    let word_count = items
        .iter()
        .filter(|item| matches!(item, Item::Word { .. }))
        .count();
    if word_count < 2 {
        return items.to_vec();
    }
    let derived = &*DERIVED;
    let mut out = Vec::with_capacity(items.len());
    let mut i = 0;
    while i < items.len() {
        let found = match &items[i] {
            Item::Word { text, .. } if derived.expression_first_words.contains(text) => {
                let longest = derived.longest_expression_words.min(items.len() - i);
                (2..=longest)
                    .rev()
                    .find_map(|length| expression(&items[i..i + length]).map(|key| (key, length)))
            }
            _ => None,
        };
        if let Some((key, length)) = found {
            out.push(Item::whole(key));
            i += length;
        } else {
            out.push(items[i].clone());
            i += 1;
        }
    }
    out
}

fn expression(window: &[Item]) -> Option<&'static str> {
    let mut words = Vec::with_capacity(window.len());
    for item in window {
        match item {
            Item::Word { text, whole: false } => words.push(text.as_str()),
            _ => return None,
        }
    }
    tables()
        .expressions
        .get(&words.join(" "))
        .map(String::as_str)
}

// Stage 5: what ends a chunk.
fn classify(spec: &KeySpec, item: Item, is_stop_word: &impl Fn(&str) -> bool) -> Item {
    let Item::Word { text, whole } = item else {
        return item;
    };
    if let Some(format) = format_of(&text) {
        return Item::Format(format.to_string());
    }
    if whole {
        return Item::Word { text, whole };
    }
    if text.is_empty() {
        return Item::Break;
    }
    if is_number(&text) {
        return if is_year(&text) {
            Item::Break
        } else {
            Item::Number(text)
        };
    }
    if !is_topic_sized(&text) {
        return Item::Break;
    }
    let lemma = super::normalize_lemma(&text);
    if let Some(format) = format_of(&lemma) {
        return Item::Format(format.to_string());
    }
    if is_stop_word(&text) || is_stop_word(&lemma) {
        return Item::Break;
    }
    Item::word(spec.key_of(&text))
}

fn is_year(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 4
        && (bytes.starts_with(b"19") || bytes.starts_with(b"20"))
        && bytes[2..].iter().all(u8::is_ascii_digit)
}

fn add(list: &mut Vec<String>, item: String) {
    if !list.contains(&item) {
        list.push(item);
    }
}
