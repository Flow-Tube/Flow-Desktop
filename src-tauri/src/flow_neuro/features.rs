//! A video's text read into its topic vector by key spec 2 (Android `NeuroTokenizer.extractFeatures`):
//! the keys are the ones Flow for Android writes for the same title, so a synced brain holds one
//! key per word. The weights stay this engine's own.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::keyed_lists::{KeyedLists, keyed_lists};
use crate::flow_neuro::keyspec::tables::{format_of, tables};
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::keyspec::{KeySpec, normalize_lemma, phrases};
use crate::flow_neuro::scoring::{
    BIGRAM_PRIORITY_WEIGHT, BIGRAM_WEIGHT, CHANNEL_KEYWORD_WEIGHT, COMPLEXITY_CHAPTER_BONUS,
    COMPLEXITY_TITLE_LEN_MAX, COMPLEXITY_TITLE_LEN_WEIGHT, COMPLEXITY_WORD_LEN_DIVISOR,
    COMPLEXITY_WORD_LEN_WEIGHT, ContentVector, DESCRIPTION_LINE_MIN_LENGTH, DESCRIPTION_MIN_LENGTH,
    DESCRIPTION_TAKE_CHARS, DESCRIPTION_TAKE_LINES, DESCRIPTION_TAKE_WORDS,
    DESCRIPTION_WORD_WEIGHT, IdfSnapshot, TITLE_KEYWORD_WEIGHT, UserBrain, calculate_idf_weight,
    strip_domain_tag,
};

const GENERIC_TOKEN_WEIGHT: f64 = 0.18;
const PHRASE_WEIGHT: f64 = BIGRAM_WEIGHT * BIGRAM_PRIORITY_WEIGHT;

/// What a video says about itself.
pub struct VideoText<'a> {
    pub title: &'a str,
    pub channel_name: &'a str,
    pub description: Option<&'a str>,
    pub duration_seconds: Option<u64>,
    pub is_live: bool,
    pub is_short: bool,
}

/// How one brain reads text: its key spec and its per-video document frequencies.
pub struct TopicReader<'a> {
    pub spec: KeySpec,
    pub idf: &'a IdfSnapshot,
}

pub fn extract_features(video: &VideoText, reader: &TopicReader) -> ContentVector {
    let spec = &reader.spec;
    let idf = reader.idf;
    let lists = keyed_lists(spec);
    let weight = |key: &str, base: f64| {
        let damping = if lists.is_generic(key) {
            GENERIC_TOKEN_WEIGHT
        } else {
            1.0
        };
        calculate_idf_weight(key, base * damping, idf)
    };
    let never_alone = &tables().never_alone;

    let mut topics: HashMap<String, f64> = HashMap::new();
    for word in spec.chunk(video.channel_name).words() {
        if !never_alone.contains(&word) {
            let value = weight(&word, CHANNEL_KEYWORD_WEIGHT);
            topics.insert(word, value);
        }
    }

    // A run of the title is a key only once it is known to be a phrase; until then it only counts
    // toward document frequency, which is how it can become one. A phrase takes its words.
    let title = spec.chunk(video.title);
    let mut claimed: HashSet<(usize, usize)> = HashSet::new();
    for run in title.runs() {
        if is_promoted(&run.key, &lists, idf) {
            topics.insert(
                run.key.clone(),
                calculate_idf_weight(&run.key, PHRASE_WEIGHT, idf),
            );
            claimed.extend((run.from..run.to).map(|index| (run.chunk, index)));
        }
    }
    for (chunk_index, chunk) in title.chunks.iter().enumerate() {
        for (index, word) in chunk.iter().enumerate() {
            if claimed.contains(&(chunk_index, index)) || never_alone.contains(word) {
                continue;
            }
            *topics.entry(word.clone()).or_insert(0.0) += weight(word, TITLE_KEYWORD_WEIGHT);
        }
    }

    if let Some(description) = video.description {
        let head: String = description.chars().take(DESCRIPTION_TAKE_CHARS).collect();
        for word in description_words(spec, &head) {
            *topics.entry(word.clone()).or_insert(0.0) += weight(&word, DESCRIPTION_WORD_WEIGHT);
        }
    }

    topics.retain(|key, _| !is_noise_topic(key, spec));

    let magnitude = topics.values().map(|v| v * v).sum::<f64>().sqrt();
    if magnitude > 0.0 {
        for value in topics.values_mut() {
            *value /= magnitude;
        }
    }

    ContentVector {
        topics,
        topic_confidence: HashMap::new(),
        anchor_topics: HashSet::new(),
        duration: duration_score(video),
        pacing: pacing_score(video),
        complexity: complexity_score(video),
        is_live: if video.is_live { 1.0 } else { 0.0 },
    }
}

/// Whether a run of title words is an interest: a phrase the engine knows, or a pair the viewer's
/// own counts prove is one.
pub(crate) fn is_promoted(run: &str, lists: &KeyedLists, idf: &IdfSnapshot) -> bool {
    lists.is_known_phrase(run) || (run.matches(' ').count() == 1 && phrases::is_phrase(run, idf))
}

/// Which keys of a video a strong signal may plant at the acquisition floor: known phrases of its
/// title, title words its description repeats, and words another video already used. A bare title
/// the viewer meets for the first time plants nothing (Android `NeuroTokenizer.plantFilter`;
/// desktop videos carry no tags, so the tag confirmations do not apply). `own_documents` is how
/// many of `idf`'s counts are this video itself.
pub fn plant_filter<'a>(
    title: &str,
    description: Option<&str>,
    idf: &'a IdfSnapshot,
    spec: &KeySpec,
    own_documents: i32,
) -> impl Fn(&str) -> bool + 'a {
    let lists = keyed_lists(spec);
    let title_chunks = spec.chunk(title);
    let title_words: HashSet<String> = title_chunks.words().into_iter().collect();
    let description_words: HashSet<String> = description
        .filter(|text| !text.trim().is_empty())
        .map(|text| {
            let head: Vec<&str> = text.lines().take(DESCRIPTION_TAKE_LINES).collect();
            spec.chunk(&head.join(" ")).words().into_iter().collect()
        })
        .unwrap_or_default();
    let mut confirmed: HashSet<String> = title_words
        .intersection(&description_words)
        .cloned()
        .collect();
    for run in title_chunks.runs() {
        if is_promoted(&run.key, &lists, idf) {
            confirmed.insert(run.key);
        }
    }
    move |key: &str| {
        let base = strip_domain_tag(key);
        confirmed.contains(&base)
            || (!base.contains(' ')
                && idf.word_frequencies.get(key).copied().unwrap_or(0) > own_documents)
    }
}

/// What one video counts toward document frequency: its keys, and every word, run and model pair
/// of its title, so a pair can prove to be a phrase.
#[must_use]
pub fn document_terms(title: &str, vector: &ContentVector, spec: &KeySpec) -> HashSet<String> {
    let chunks = spec.chunk(title);
    let mut terms: HashSet<String> = vector.topics.keys().cloned().collect();
    terms.extend(chunks.words());
    terms.extend(chunks.runs().into_iter().map(|run| run.key));
    terms.extend(chunks.model_pairs);
    terms
}

/// A title's words, the way two titles are compared for near-duplicates.
#[must_use]
pub fn title_words(title: &str, spec: &KeySpec) -> HashSet<String> {
    spec.chunk(title).words().into_iter().collect()
}

/// A key that is vocabulary noise rather than an interest (Android `NeuroTokenizer.isNoiseTopic`).
#[must_use]
pub fn is_noise_topic(topic: &str, spec: &KeySpec) -> bool {
    let tables = tables();
    let base = strip_domain_tag(topic);
    let base = base.trim();
    if tables.expressions.values().any(|key| key == base) {
        return false;
    }
    if tables.never_alone.contains(base) || base.encode_utf16().count() > tables.max_key_length {
        return true;
    }
    if format_of(base).is_some() || !is_topic_sized(base) {
        return true;
    }
    if base.chars().all(|c| c.is_ascii_digit()) || is_year_tag(base) {
        return true;
    }
    let parts: Vec<&str> = base
        .split(' ')
        .filter(|part| !part.trim().is_empty())
        .collect();
    if parts.is_empty() {
        return true;
    }
    // Degenerate pairs like "code code" are tokenizer echoes, not topics.
    if parts.len() > 1 && parts.iter().collect::<HashSet<_>>().len() < parts.len() {
        return true;
    }
    let profile = KeySpec::stop_list(&spec.language_profile);
    parts.iter().any(|part| {
        tables.stop_words.contains(*part)
            || tables.stop_words.contains(&normalize_lemma(part))
            || profile.contains(*part)
            || !is_topic_sized(part)
    })
}

fn is_year_tag(word: &str) -> bool {
    let bytes = word.as_bytes();
    bytes.len() == 4
        && bytes.starts_with(b"20")
        && (b'2'..=b'9').contains(&bytes[2])
        && bytes[3].is_ascii_digit()
}

fn description_words(spec: &KeySpec, description: &str) -> Vec<String> {
    if description.len() < DESCRIPTION_MIN_LENGTH {
        return Vec::new();
    }
    let content = description
        .lines()
        .filter(|line| is_description_content_line(line))
        .take(DESCRIPTION_TAKE_LINES)
        .collect::<Vec<&str>>()
        .join(" ");
    let mut words = spec.chunk(&content).words();
    words.truncate(DESCRIPTION_TAKE_WORDS);
    words
}

fn is_description_content_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.len() <= DESCRIPTION_LINE_MIN_LENGTH {
        return false;
    }
    let lower = trimmed.to_lowercase();
    if SPONSOR_LINE_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return false;
    }
    if lower.contains("http") || trimmed.starts_with('#') {
        return false;
    }
    !(trimmed.len() > 5 && trimmed == trimmed.to_uppercase())
}

fn duration_score(video: &VideoText) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let seconds = match video.duration_seconds {
        Some(d) if d > 0 => d as f64,
        _ if video.is_live => 3600.0,
        _ => 300.0,
    };
    ((1.0 + seconds).ln() / 7201.0_f64.ln()).clamp(0.0, 1.0)
}

#[allow(clippy::cast_precision_loss)]
fn pacing_score(video: &VideoText) -> f64 {
    let title = video.title.to_lowercase();
    let count = |words: &[&str]| words.iter().filter(|word| title.contains(*word)).count() as f64;
    let high = count(&HIGH_PACING_WORDS);
    let low = count(&LOW_PACING_WORDS);
    if high > low {
        (0.6 + high * 0.1).min(0.95)
    } else if low > high {
        (0.4 - low * 0.1).max(0.05)
    } else if video.is_short {
        0.85
    } else {
        0.5
    }
}

#[allow(clippy::cast_precision_loss)]
fn complexity_score(video: &VideoText) -> f64 {
    let raw_words: Vec<&str> = video
        .title
        .split_whitespace()
        .filter(|word| word.chars().count() > 1)
        .collect();
    let avg_word_len = if raw_words.is_empty() {
        4.0
    } else {
        raw_words.iter().map(|w| w.chars().count()).sum::<usize>() as f64 / raw_words.len() as f64
    };
    let title_len_factor = (video.title.chars().count() as f64 / COMPLEXITY_TITLE_LEN_MAX)
        .clamp(0.0, COMPLEXITY_TITLE_LEN_WEIGHT);
    let word_len_factor =
        (avg_word_len / COMPLEXITY_WORD_LEN_DIVISOR).clamp(0.0, COMPLEXITY_WORD_LEN_WEIGHT);
    let chapter_bonus = if video.description.is_some_and(has_chapters) {
        COMPLEXITY_CHAPTER_BONUS
    } else {
        0.0
    };
    (title_len_factor + word_len_factor + chapter_bonus).clamp(0.0, 1.0)
}

/// Three or more timestamps ("12:34", "1:23") mark a description with chapters.
fn has_chapters(description: &str) -> bool {
    let chars: Vec<char> = description.chars().collect();
    let mut timestamps = 0;
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut before = 0;
        while i < chars.len() && chars[i].is_ascii_digit() {
            before += 1;
            i += 1;
        }
        if (1..=2).contains(&before) && i < chars.len() && chars[i] == ':' {
            i += 1;
            let mut after = 0;
            while i < chars.len() && chars[i].is_ascii_digit() {
                after += 1;
                i += 1;
            }
            if after == 2 {
                timestamps += 1;
            }
        }
    }
    timestamps >= 3
}

/// A sponsor block or link line says nothing about what the video is about.
const SPONSOR_LINE_PATTERNS: [&str; 39] = [
    "use code ",
    "% off",
    "free trial",
    "link in",
    "sponsored by",
    "brought to you",
    "check out",
    "sign up",
    "discount",
    "promo code",
    "coupon",
    "affiliate",
    "partner",
    "merch",
    "merchandise",
    "patreon",
    "ko-fi",
    "buymeacoffee",
    "buy me a coffee",
    "subscribe",
    "follow me",
    "social media",
    "instagram",
    "twitter",
    "tiktok",
    "discord",
    "join the",
    "become a member",
    "membership",
    "business inquiries",
    "business email",
    "contact:",
    "►",
    "→",
    "⬇",
    "⇩",
    "👇",
    "timestamps:",
    "chapters:",
];

const HIGH_PACING_WORDS: [&str; 24] = [
    "compilation",
    "tiktok",
    "tiktoks",
    "highlights",
    "speedrun",
    "trailer",
    "shorts",
    "montage",
    "moments",
    "best of",
    "try not to",
    "memes",
    "funny",
    "fails",
    "rapid",
    "fast",
    "quick",
    "minute",
    "seconds",
    "top 10",
    "top 5",
    "ranked",
    "tier list",
    "versus",
];

const LOW_PACING_WORDS: [&str; 20] = [
    "podcast",
    "essay",
    "ambient",
    "explained",
    "study",
    "meditation",
    "sleep",
    "asmr",
    "relaxing",
    "calm",
    "deep dive",
    "analysis",
    "lecture",
    "course",
    "documentary",
    "interview",
    "conversation",
    "discussion",
    "breakdown",
    "walkthrough",
];

/// The keys the viewer's onboarding picks read as ("Machine Learning" reads "machin learn").
#[must_use]
pub fn pick_keys(brain: &UserBrain) -> HashSet<String> {
    let spec = brain.key_spec();
    brain
        .preferred_topics
        .iter()
        .flat_map(|label| spec.keys_of(label))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/fixtures/neuro/key_spec_golden.json");

    fn read(title: &str, idf: &IdfSnapshot) -> ContentVector {
        extract_features(
            &VideoText {
                title,
                channel_name: "",
                description: None,
                duration_seconds: Some(600),
                is_live: false,
                is_short: false,
            },
            &TopicReader {
                spec: KeySpec::default(),
                idf,
            },
        )
    }

    fn no_counts() -> IdfSnapshot {
        IdfSnapshot {
            word_frequencies: HashMap::new(),
            total_documents: 0,
        }
    }

    #[test]
    fn every_key_is_spelled_as_android_spells_the_title() {
        let golden: Value = serde_json::from_str(GOLDEN).unwrap();
        for case in golden["cases"].as_array().unwrap() {
            if case.get("languageProfile").is_some() {
                continue;
            }
            let input = case["input"].as_str().unwrap();
            let chunks: Vec<Vec<String>> = serde_json::from_value(case["chunks"].clone()).unwrap();
            let mut spelled: HashSet<String> = chunks.iter().flatten().cloned().collect();
            for chunk in &chunks {
                for from in 0..chunk.len() {
                    for to in from + 2..=chunk.len().min(from + 3) {
                        spelled.insert(chunk[from..to].join(" "));
                    }
                }
            }
            for key in read(input, &no_counts()).topics.keys() {
                assert!(spelled.contains(key), "{input}: {key} is not {spelled:?}");
            }
        }
    }

    #[test]
    fn a_pair_is_a_key_only_once_it_is_a_phrase() {
        let title = "Why Big Tech's Privacy Promises Are Lies";
        let keys: HashSet<String> = read(title, &no_counts()).topics.into_keys().collect();
        let expected: HashSet<String> = ["big", "tech", "privaci", "promises", "lie"]
            .into_iter()
            .map(String::from)
            .collect();
        assert_eq!(keys, expected);

        let mut counts = HashMap::new();
        counts.insert("privaci promises".to_string(), 8);
        counts.insert("privaci".to_string(), 8);
        counts.insert("promises".to_string(), 9);
        let learned = IdfSnapshot {
            word_frequencies: counts,
            total_documents: 40,
        };
        let keys = read(title, &learned).topics;
        assert!(keys.contains_key("privaci promises"));
        assert!(!keys.contains_key("privaci"), "a phrase takes its words");
    }

    #[test]
    fn written_variants_share_one_key() {
        for title in [
            "Lo-Fi Hip Hop Radio",
            "Lo Fi Hip-Hop Radio",
            "lofi hip hop radio",
        ] {
            let keys: HashSet<String> = read(title, &no_counts()).topics.into_keys().collect();
            let expected: HashSet<String> = ["lofi hip hop", "radio"]
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(keys, expected, "{title}");
        }
    }

    #[test]
    fn a_document_counts_every_word_and_run_of_its_title() {
        let spec = KeySpec::default();
        let vector = read("Restoring Vintage Guitars", &no_counts());
        let terms = document_terms("Restoring Vintage Guitars", &vector, &spec);
        assert!(terms.contains("guitar"));
        assert!(terms.iter().any(|term| term.ends_with(" guitar")));
    }

    #[test]
    fn noise_keys_never_become_topics() {
        let spec = KeySpec::default();
        assert!(is_noise_topic("2026", &spec));
        assert!(is_noise_topic("code code", &spec));
        assert!(is_noise_topic("the", &spec));
        assert!(!is_noise_topic("guitar", &spec));
        assert!(!is_noise_topic("hip hop", &spec));
    }
}
