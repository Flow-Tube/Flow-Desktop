//! A video's text read into its topic vector the way Flow for Android reads it
//! (`NeuroTokenizer.extractFeatures`), checked against its `features_golden.json`: the channel
//! name's topic words, known phrases and words of the title, polysemous words tagged by the words
//! around them ("metal:music"), the description's content lines and hashtags, and a channel's known
//! topics for a bare title.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::flow_neuro::feature_tables::feature_tables;
use crate::flow_neuro::keyed_lists::{KeyedLists, keyed_lists};
use crate::flow_neuro::keyspec::Chunks;
use crate::flow_neuro::keyspec::tables::{format_of, tables};
use crate::flow_neuro::keyspec::text::{
    HanFold, fold, fold_with, is_topic_sized, is_word_char, words,
};
use crate::flow_neuro::keyspec::{KeySpec, normalize_lemma, phrases};
use crate::flow_neuro::scoring::{
    BIGRAM_PRIORITY_WEIGHT, CHANNEL_KEYWORD_WEIGHT, CHANNEL_PROFILE_BLEND_WEIGHT,
    CHANNEL_PROFILE_MIN_VIDEOS, COMPLEXITY_CHAPTER_BONUS, COMPLEXITY_TITLE_LEN_MAX,
    COMPLEXITY_TITLE_LEN_WEIGHT, COMPLEXITY_WORD_LEN_DIVISOR, COMPLEXITY_WORD_LEN_WEIGHT,
    ContentVector, DESCRIPTION_LINE_MIN_LENGTH, DESCRIPTION_MIN_LENGTH, DESCRIPTION_TAKE_LINES,
    DESCRIPTION_TAKE_WORDS, DESCRIPTION_WORD_WEIGHT, IdfSnapshot, TITLE_KEYWORD_WEIGHT, UserBrain,
    calculate_idf_weight, strip_domain_tag,
};

const TAG_MAX_INGEST: usize = 15;
const TAG_PHRASE_MAX_WORDS: usize = 3;
const TAG_PHRASE_WORD_SHARE: f64 = 0.5;
const HASHTAG_MAX: usize = 5;
const HASHTAG_MIN_CHARS: usize = 3;
const HASHTAG_MAX_CHARS: usize = 40;
const TAG_VERIFIED_WEIGHT: f64 = 0.65;
const TAG_UNVERIFIED_WEIGHT: f64 = 0.10;
const TAG_MIN_LENGTH: usize = 3;
const TAG_MAX_LENGTH: usize = 40;

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
    extract_features_with_prior(video, reader, None)
}

/// As [`extract_features`], with what the video's channel is known for: a bare title also reads
/// as its channel's topics, at a fraction of their weight.
pub fn extract_features_with_prior(
    video: &VideoText,
    reader: &TopicReader,
    channel_profile: Option<&HashMap<String, f64>>,
) -> ContentVector {
    let spec = &reader.spec;
    let idf = reader.idf;
    let lists = keyed_lists(spec);
    let never_alone = &tables().never_alone;
    let weight = |key: &str, base: f64| calculate_idf_weight(key, base, idf);
    let tags = topic_tags(video.description);
    let han = han_fold_of(video.title, video.channel_name, &tags, spec);

    // Only a channel name's topic words count: "Linus Tech Tips" is about tech, not "linus".
    let mut topics: HashMap<String, f64> = HashMap::new();
    for word in channel_topics_folded(video.channel_name, spec, han) {
        let value = weight(&word, CHANNEL_KEYWORD_WEIGHT);
        topics.insert(word, value);
    }

    let context = context_words(video, &tags, han);
    let tag_chunks: Vec<Chunks> = tags
        .iter()
        .take(TAG_MAX_INGEST)
        .map(|tag| spec.chunk_with(tag, han))
        .collect();
    let tag_phrase_keys: HashSet<String> = tag_chunks.iter().flat_map(tag_phrases).collect();
    let title = spec.chunk_with(video.title, han);
    let formats: HashSet<String> = title
        .formats
        .iter()
        .chain(tag_chunks.iter().flat_map(|chunks| chunks.formats.iter()))
        .cloned()
        .collect();

    // A run of the title is a key only once it is known to be a phrase; until then it only counts
    // toward document frequency, which is how it can become one. A phrase takes its words.
    let mut claimed: HashSet<(usize, usize)> = HashSet::new();
    for run in title.runs() {
        if tag_phrase_keys.contains(&run.key) || is_promoted(&run.key, &lists, idf) {
            let value = weight(&run.key, BIGRAM_PRIORITY_WEIGHT);
            topics.insert(run.key.clone(), value);
            claimed.extend((run.from..run.to).map(|index| (run.chunk, index)));
        }
    }
    // A merged Han run is a key once the viewer's counts or a tag say so; its characters stay.
    for run in &title.merged {
        if phrases::is_merged_run(run, idf) || tag_phrase_keys.contains(run) {
            topics.insert(run.clone(), weight(run, BIGRAM_PRIORITY_WEIGHT));
        }
    }
    for (chunk_index, chunk) in title.chunks.iter().enumerate() {
        for (index, word) in chunk.iter().enumerate() {
            if claimed.contains(&(chunk_index, index)) || never_alone.contains(word) {
                continue;
            }
            let resolved = disambiguate(word, &context);
            let value = weight(&resolved, TITLE_KEYWORD_WEIGHT);
            *topics.entry(resolved).or_insert(0.0) += value;
        }
    }

    for (word, value) in description_keywords(video.description, spec, idf, han) {
        *topics.entry(disambiguate(&word, &context)).or_insert(0.0) += value;
    }

    if !tags.is_empty() {
        let description_words = video
            .description
            .map(|text| {
                let head: Vec<&str> = text.lines().take(DESCRIPTION_TAKE_LINES).collect();
                spec.chunk_with(&head.join(" "), han).words()
            })
            .unwrap_or_default();
        for (key, value) in process_tags(&tags, &title.words(), &description_words, spec, idf, han)
        {
            *topics.entry(key).or_insert(0.0) += value;
        }
    }

    topics.retain(|key, _| !is_noise_topic(key, spec));

    if let Some(profile) =
        channel_profile.filter(|profile| profile.len() >= CHANNEL_PROFILE_MIN_VIDEOS)
    {
        for (topic, channel_weight) in profile {
            let entry = topics.entry(topic.clone()).or_insert(0.0);
            if *entry == 0.0 {
                *entry = channel_weight * CHANNEL_PROFILE_BLEND_WEIGHT;
            }
        }
    }

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
        formats,
        duration: duration_score(video),
        pacing: pacing_score(video),
        complexity: complexity_score(video),
        is_live: if video.is_live { 1.0 } else { 0.0 },
    }
}

/// Splits on the whitespace Kotlin's `\s` means, dropping the empty pieces.
fn ascii_whitespace_split(text: &str) -> impl Iterator<Item = &str> {
    text.split([' ', '\t', '\n', '\u{b}', '\u{c}', '\r'])
        .filter(|piece| !piece.is_empty())
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// One Han fold for every field of a video, decided by its title, channel name and hashtags (the
/// tags a desktop video has).
fn han_fold_of(title: &str, channel_name: &str, tags: &[String], spec: &KeySpec) -> HanFold {
    spec.han_fold_of(
        title,
        channel_name,
        tags.iter().take(TAG_MAX_INGEST).map(String::as_str),
    )
}

/// The Han fold of a video, for reading its title outside [`extract_features`].
#[must_use]
pub fn video_han_fold(
    title: &str,
    channel_name: &str,
    description: Option<&str>,
    spec: &KeySpec,
) -> HanFold {
    han_fold_of(title, channel_name, &topic_tags(description), spec)
}

/// Folded words of `text` stripped of edge punctuation, longer than `min` UTF-16 units.
fn plain_words(text: &str, min: usize, han: HanFold) -> impl Iterator<Item = String> + '_ {
    let folded = fold_with(text, han);
    ascii_whitespace_split(&folded)
        .map(|word| {
            word.trim_matches(|c: char| !c.is_alphanumeric())
                .to_string()
        })
        .filter(move |word| utf16_len(word) > min)
        .collect::<Vec<_>>()
        .into_iter()
}

/// The words a polysemous word is read against: the title, the channel name, the description's
/// first lines and the tags (Android `buildContextWordList`).
fn context_words(video: &VideoText, tags: &[String], han: HanFold) -> Vec<String> {
    let mut context: Vec<String> = plain_words(video.title, 1, han).collect();
    context.extend(name_words(video.channel_name, han));
    if let Some(description) = video.description.filter(|text| !text.trim().is_empty()) {
        let head: Vec<&str> = description.lines().take(3).collect();
        context.extend(plain_words(&head.join(" "), 2, han));
    }
    for tag in tags.iter().take(TAG_MAX_INGEST) {
        context.extend(plain_words(tag, 1, han));
    }
    context
}

/// "metal" in a video about bands is "metal:music"; a word without a clear reading stays itself.
fn disambiguate(word: &str, context: &[String]) -> String {
    let Some(domains) = feature_tables().domains.get(word) else {
        return word.to_string();
    };
    let mut best: Option<&str> = None;
    let mut best_score = 0;
    let mut second_score = 0;
    for domain in domains {
        let score = domain
            .context_words
            .iter()
            .filter(|cue| {
                context
                    .iter()
                    .any(|word| word.starts_with(cue.as_str()) || cue.starts_with(word.as_str()))
            })
            .count();
        if score > best_score {
            second_score = best_score;
            best_score = score;
            best = Some(&domain.domain);
        } else if score > second_score {
            second_score = score;
        }
    }
    #[allow(clippy::cast_precision_loss)]
    let clear = second_score == 0 || best_score as f64 >= second_score as f64 * 1.5 + 1.0;
    match best {
        Some(domain) if best_score >= 1 && clear => format!("{word}:{domain}"),
        _ => word.to_string(),
    }
}

/// The description's hashtags, the tags a desktop video has: `#guitar_lessons` reads as
/// "guitar lessons" (Android `topicTags`; desktop videos carry no creator tags).
fn topic_tags(description: Option<&str>) -> Vec<String> {
    let Some(description) = description.filter(|text| text.contains('#')) else {
        return Vec::new();
    };
    let chars: Vec<char> = description.chars().collect();
    let is_tag_char = |c: char| c.is_alphabetic() || c.is_numeric() || c == '_';
    let mut tags: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() && tags.len() < HASHTAG_MAX {
        if chars[i] != '#' {
            i += 1;
            continue;
        }
        let run = chars[i + 1..]
            .iter()
            .take_while(|c| is_tag_char(**c))
            .count();
        if run < HASHTAG_MIN_CHARS {
            i += 1;
            continue;
        }
        let taken = run.min(HASHTAG_MAX_CHARS);
        let tag: String = chars[i + 1..=i + taken]
            .iter()
            .map(|c| if *c == '_' { ' ' } else { *c })
            .collect();
        if !tags.contains(&tag) {
            tags.push(tag);
        }
        i += 1 + taken;
    }
    tags
}

/// The unbroken parts of a tag that hold two or three words.
fn tag_phrases(tag: &Chunks) -> Vec<String> {
    tag.chunks
        .iter()
        .filter(|chunk| {
            chunk.len() >= 2
                && chunk
                    .iter()
                    .map(|word| word.matches(' ').count() + 1)
                    .sum::<usize>()
                    <= TAG_PHRASE_MAX_WORDS
        })
        .map(|chunk| chunk.join(" "))
        .collect()
}

/// A tag the title or description confirms weighs as a creator's declaration; one they do not
/// barely counts (Android `processTags`).
fn process_tags(
    tags: &[String],
    title_words: &[String],
    description_words: &[String],
    spec: &KeySpec,
    idf: &IdfSnapshot,
    han: HanFold,
) -> HashMap<String, f64> {
    let key_tables = tables();
    let spam = &feature_tables().tag_spam_words;
    let verification: HashSet<&String> = title_words.iter().chain(description_words).collect();
    let mut context: Vec<String> = tags
        .iter()
        .take(TAG_MAX_INGEST)
        .flat_map(|tag| plain_words(tag, 1, han).collect::<Vec<_>>())
        .collect();
    context.extend(title_words.iter().cloned());
    context.extend(description_words.iter().cloned());

    let mut result: HashMap<String, f64> = HashMap::new();
    for raw in tags.iter().take(TAG_MAX_INGEST) {
        let cleaned = fold_with(raw, han).trim().to_string();
        let length = utf16_len(&cleaned);
        if (length < TAG_MIN_LENGTH && !key_tables.short_topics.contains(&cleaned))
            || length > TAG_MAX_LENGTH
            || spam.contains(&cleaned)
            || key_tables.stop_words.contains(&cleaned)
            || is_year_tag(&cleaned)
        {
            continue;
        }
        let chunked = spec.chunk_with(&cleaned, han);
        let tokens = chunked.words();
        if tokens.is_empty() {
            continue;
        }
        let base = if tokens.iter().any(|token| verification.contains(token)) {
            TAG_VERIFIED_WEIGHT
        } else {
            TAG_UNVERIFIED_WEIGHT
        };
        let phrases = tag_phrases(&chunked);
        for phrase in &phrases {
            *result.entry(phrase.clone()).or_insert(0.0) += calculate_idf_weight(phrase, base, idf);
        }
        let word_weight = if phrases.is_empty() {
            base
        } else {
            base * TAG_PHRASE_WORD_SHARE
        };
        for token in &tokens {
            if key_tables.never_alone.contains(token) {
                continue;
            }
            let resolved = disambiguate(token, &context);
            let value = calculate_idf_weight(&resolved, word_weight, idf);
            *result.entry(resolved).or_insert(0.0) += value;
        }
    }
    result
}

/// The description's first content lines, without sponsor blocks, links, hashtags or shouting,
/// as weighted words (Android `extractDescriptionKeywords`).
fn description_keywords(
    description: Option<&str>,
    spec: &KeySpec,
    idf: &IdfSnapshot,
    han: HanFold,
) -> Vec<(String, f64)> {
    let Some(description) = description.filter(|text| !text.trim().is_empty()) else {
        return Vec::new();
    };
    if utf16_len(description) < DESCRIPTION_MIN_LENGTH {
        return Vec::new();
    }
    let sponsor = &feature_tables().sponsor_line_patterns;
    let content: Vec<&str> = description
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            let lower = trimmed.to_lowercase();
            utf16_len(trimmed) > DESCRIPTION_LINE_MIN_LENGTH
                && !sponsor
                    .iter()
                    .any(|pattern| lower.contains(pattern.as_str()))
                && !lower.contains("http")
                && !lower.trim_start().starts_with('#')
                && (utf16_len(trimmed) <= 5 || !is_shouted(line))
        })
        .take(DESCRIPTION_TAKE_LINES)
        .collect();
    let content = content.join(" ");
    if content.trim().is_empty() {
        return Vec::new();
    }
    let mut weights: Vec<(String, f64)> = Vec::new();
    for word in spec
        .chunk_with(&content, han)
        .words()
        .into_iter()
        .take(DESCRIPTION_TAKE_WORDS)
    {
        let value = calculate_idf_weight(&word, DESCRIPTION_WORD_WEIGHT, idf);
        match weights.iter_mut().find(|(existing, _)| *existing == word) {
            Some((_, total)) => *total += value,
            None => weights.push((word, value)),
        }
    }
    weights
}

/// An all-caps line ("SUBSCRIBE NOW") or one with no letters at all. Chinese, Japanese and Thai
/// have no case, so their letters count against the capitals: "【MV】周杰倫 新歌" is not shouting.
fn is_shouted(line: &str) -> bool {
    let mut capitals = 0;
    let mut uncased = 0;
    for c in line.chars() {
        if c.is_lowercase() {
            return false;
        } else if c.is_uppercase() {
            capitals += 1;
        } else if c.is_alphabetic() {
            uncased += 1;
        }
    }
    capitals >= uncased
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
    han: HanFold,
) -> impl Fn(&str) -> bool + 'a {
    let lists = keyed_lists(spec);
    let title_chunks = spec.chunk_with(title, han);
    let title_words: HashSet<String> = title_chunks.words().into_iter().collect();
    let description_words: HashSet<String> = description
        .filter(|text| !text.trim().is_empty())
        .map(|text| {
            let head: Vec<&str> = text.lines().take(DESCRIPTION_TAKE_LINES).collect();
            spec.chunk_with(&head.join(" "), han)
                .words()
                .into_iter()
                .collect()
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

const ALWAYS_TOPICAL: &str = include_str!("../../resources/neuro/topical/always.txt");
const TOPICAL_ZH: &str = include_str!("../../resources/neuro/topical/zh.txt");

/// Words that make a channel name topical: Android's English list and its Chinese one (#1350).
static CHANNEL_TOPIC_WORDS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    [ALWAYS_TOPICAL, TOPICAL_ZH]
        .iter()
        .flat_map(|text| text.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(fold)
        .collect()
});

/// The topic words of a channel name, the only part of it that says what the channel is about
/// (Android `NeuroTokenizer.tokenizeChannelName`): "Coding Sloth" is about code, "Fireship" says
/// nothing.
#[must_use]
pub fn channel_topics(name: &str, spec: &KeySpec) -> Vec<String> {
    channel_topics_folded(name, spec, spec.default_han())
}

fn channel_topics_folded(name: &str, spec: &KeySpec, han: HanFold) -> Vec<String> {
    let is_topic = |word: &str| CHANNEL_TOPIC_WORDS.contains(word);
    let name_words = name_words(name, han);
    let mut topics: Vec<String> = Vec::new();
    for word in &name_words {
        let lower = word.to_lowercase();
        let key = spec.key_of(&lower);
        let topic = if is_topic(&key) {
            Some(key)
        } else if is_topic(&lower) {
            // A lone word that is a topic only as written still stands for its key.
            Some(if name_words.len() == 1 { key } else { lower })
        } else {
            None
        };
        if let Some(topic) = topic
            && !topics.contains(&topic)
        {
            topics.push(topic);
        }
    }
    topics
}

/// Words of a channel name; scripts written without spaces are split by the word breaker.
fn name_words(name: &str, han: HanFold) -> Vec<String> {
    words(&fold_with(name, han))
        .into_iter()
        .map(|word| word.trim_matches(|c: char| !is_word_char(c)).to_string())
        .filter(|word| utf16_len(word) > 1)
        .collect()
}

/// What one video counts toward document frequency: its keys, and every word, run, model pair,
/// merged Han run and single Han character of its title, so a pair or a run can prove to be a
/// phrase.
#[must_use]
pub fn document_terms(
    title: &str,
    vector: &ContentVector,
    spec: &KeySpec,
    han: HanFold,
) -> HashSet<String> {
    let chunks = spec.chunk_with(title, han);
    let mut terms: HashSet<String> = vector.topics.keys().cloned().collect();
    terms.extend(chunks.words());
    terms.extend(chunks.runs().into_iter().map(|run| run.key));
    terms.extend(chunks.model_pairs);
    terms.extend(chunks.merged);
    terms.extend(chunks.singles);
    terms
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
    let count = |words: &[String]| {
        words
            .iter()
            .filter(|word| title.contains(word.as_str()))
            .count() as f64
    };
    let high = count(&feature_tables().high_pacing_words);
    let low = count(&feature_tables().low_pacing_words);
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
            // A polysemous word keeps its spelling under a domain tag ("play:gaming").
            for key in read(input, &no_counts()).topics.keys() {
                let base = strip_domain_tag(key);
                assert!(spelled.contains(&base), "{input}: {key} is not {spelled:?}");
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
        let terms = document_terms(
            "Restoring Vintage Guitars",
            &vector,
            &spec,
            spec.default_han(),
        );
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

    #[test]
    fn channel_names_teach_only_their_topic_words_as_android_reads_them() {
        let golden: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/neuro/learn_golden.json"))
                .unwrap();
        let spec = KeySpec::default();
        for (name, expected) in golden["channelNames"].as_object().unwrap() {
            let mut expected: Vec<String> = serde_json::from_value(expected.clone()).unwrap();
            let mut got = channel_topics(name, &spec);
            expected.sort();
            got.sort();
            assert_eq!(got, expected, "{name}");
        }
    }

    #[test]
    fn a_chinese_channel_name_gives_its_simplified_topic() {
        let spec = KeySpec::default();
        assert_eq!(channel_topics("央視新聞", &spec), ["新闻"]);
        assert_eq!(channel_topics("TVBS新聞", &spec), ["新闻"]);
        assert_eq!(channel_topics("阿滴英文", &spec), ["英文"]);
        assert_eq!(channel_topics("英文教室 科技", &spec), ["英文", "科技"]);
    }

    fn video<'a>(
        title: &'a str,
        channel_name: &'a str,
        description: Option<&'a str>,
    ) -> VideoText<'a> {
        VideoText {
            title,
            channel_name,
            description,
            duration_seconds: Some(600),
            is_live: false,
            is_short: false,
        }
    }

    fn terms_of(video: &VideoText, idf: &IdfSnapshot) -> HashSet<String> {
        let spec = KeySpec::default();
        let vector = extract_features(
            video,
            &TopicReader {
                spec: spec.clone(),
                idf,
            },
        );
        let han = video_han_fold(video.title, video.channel_name, video.description, &spec);
        document_terms(video.title, &vector, &spec, han)
    }

    fn idf_of(titles: &[&str]) -> IdfSnapshot {
        let mut counts: HashMap<String, i32> = HashMap::new();
        for title in titles {
            for term in terms_of(&video(title, "", None), &no_counts()) {
                *counts.entry(term).or_insert(0) += 1;
            }
        }
        IdfSnapshot {
            word_frequencies: counts,
            total_documents: i32::try_from(titles.len()).unwrap(),
        }
    }

    // Android NeuroHanRunsTest.
    #[test]
    fn a_merged_run_is_a_key_once_it_keeps_appearing() {
        let others: Vec<String> = (0..9).map(|i| format!("Tech review number {i}")).collect();
        let mut twice: Vec<&str> = vec!["周杰倫 新歌", "周杰倫 最新作品"];
        twice.extend(others.iter().map(String::as_str));
        let mut thrice: Vec<&str> = vec!["周杰倫 新歌", "周杰倫 最新作品", "周杰倫 演唱會"];
        thrice.extend(others.iter().map(String::as_str));

        assert!(
            !read("周杰倫 新歌", &no_counts())
                .topics
                .contains_key("周杰伦")
        );
        assert!(
            !read("周杰倫 新歌", &idf_of(&twice))
                .topics
                .contains_key("周杰伦")
        );
        assert!(
            read("周杰倫 新歌", &idf_of(&thrice))
                .topics
                .contains_key("周杰伦")
        );
    }

    #[test]
    fn a_run_whose_characters_mostly_stand_apart_is_not_a_key() {
        let mut titles = vec!["大小"; 3];
        titles.extend(vec!["大 小 号"; 12]);
        let others: Vec<String> = (0..5).map(|i| format!("other {i}")).collect();
        titles.extend(others.iter().map(String::as_str));
        assert!(!phrases::is_merged_run("大小", &idf_of(&titles)));
    }

    #[test]
    fn the_characters_of_a_run_count_toward_document_frequency() {
        let terms = terms_of(&video("周杰倫 演唱會", "", None), &no_counts());
        for term in ["周杰伦", "周", "杰", "伦"] {
            assert!(terms.contains(term), "{term} in {terms:?}");
        }
    }

    // Android NeuroHanFoldDecisionTest: one fold per video.
    #[test]
    fn a_video_with_kana_anywhere_keeps_han_as_written() {
        let title = "鬼滅 無限城編 予告";
        let spec = KeySpec::default();
        assert_eq!(
            video_han_fold(title, "アニメ公式", None, &spec),
            HanFold::None
        );
        assert_eq!(
            video_han_fold(title, "", Some("#アニメ #新作"), &spec),
            HanFold::None
        );
        let terms = terms_of(&video(title, "アニメ公式", None), &no_counts());
        assert!(terms.contains("無限"), "{terms:?}");
        assert!(!terms.contains("无限"), "{terms:?}");

        assert_eq!(
            video_han_fold(title, "央視新聞", None, &spec),
            HanFold::Always
        );
        assert!(terms_of(&video(title, "央視新聞", None), &no_counts()).contains("无限"));
    }

    #[test]
    fn description_keywords_follow_the_video() {
        let description = format!(
            "intro: 無限城編の予告です。機器學習 演唱會 周杰倫 的最新消息和內容介紹都在這裡。{}",
            "詳細は概要欄をご覧ください。".repeat(2)
        );
        let spec = KeySpec::default();
        let keys = |han| -> Vec<String> {
            description_keywords(Some(&description), &spec, &no_counts(), han)
                .into_iter()
                .map(|(key, _)| key)
                .collect()
        };
        let folded = keys(video_han_fold("機器學習 演唱會", "央視新聞", None, &spec));
        let kept = keys(video_han_fold("機器學習 演唱會", "アニメ公式", None, &spec));
        assert!(folded.iter().any(|key| key.contains('学')), "{folded:?}");
        assert!(!kept.iter().any(|key| key.contains('学')), "{kept:?}");
        assert!(kept.iter().any(|key| key.contains('學')), "{kept:?}");
    }

    #[test]
    fn a_japanese_viewer_folds_nothing() {
        let japanese = KeySpec::new("ja", "ja");
        assert!(!japanese.han_folds());
        assert_eq!(japanese.fold("鬼滅"), "鬼滅");
        assert!(japanese.chunk("周杰倫 演唱會").merged.is_empty());
        assert_eq!(
            video_han_fold("機器學習", "", None, &japanese),
            HanFold::None
        );
        assert_eq!(KeySpec::default().fold("鬼滅"), "鬼灭");
    }

    // Android NeuroDescriptionKeywordsTest (#1400).
    fn description_words(description: &str) -> Vec<String> {
        let spec = KeySpec::default();
        description_keywords(Some(description), &spec, &no_counts(), spec.default_han())
            .into_iter()
            .map(|(key, _)| key)
            .collect()
    }

    #[test]
    fn descriptions_in_scripts_without_case_give_keywords() {
        assert!(
            description_words("周杰倫 演唱會 台北小巨蛋 現場完整收錄 精彩片段一次看")
                .contains(&"台北".to_string())
        );
        assert!(
            !description_words("今日は東京で一番美味しいラーメン屋さんを紹介します").is_empty()
        );
        assert!(
            description_words("【MV】周杰倫 演唱會 台北小巨蛋 現場完整收錄")
                .contains(&"台北".to_string())
        );
    }

    #[test]
    fn a_shouted_line_and_a_bare_line_are_still_skipped() {
        let found = description_words(
            "SUBSCRIBE NOW FOR MORE VIDEOS\nLearning guitar chords for beginners today",
        );
        assert!(found.contains(&"guitar".to_string()), "{found:?}");
        assert!(
            !found.iter().any(|word| word.starts_with("subscrib")),
            "{found:?}"
        );

        let mut lines = vec![
            "━━━━━━━━━━━━━━━━━━━━";
            DESCRIPTION_TAKE_LINES
        ];
        lines.push("Learning guitar chords for beginners today");
        assert!(description_words(&lines.join("\n")).contains(&"guitar".to_string()));
    }
}
