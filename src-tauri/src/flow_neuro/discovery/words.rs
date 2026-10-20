//! The word lists discovery reads queries by, and the cleanup every query gets before it is
//! searched, from Flow for Android's `NeuroDiscovery`.

use std::collections::HashSet;
use std::sync::LazyLock;

/// Long-form words a deep diver's searches end in.
pub const LONG_FORM_WORDS: [&str; 5] = ["documentary", "deep dive", "essay", "full", "breakdown"];
pub const SHORT_FORM_WORDS: [&str; 3] = ["highlights", "best moments", "compilation"];
/// What a fresh-content search asks for. Android also used the year, which every query then
/// stripped again as noise, leaving the bare topic (A9).
pub const FRESHNESS_WORDS: [&str; 2] = ["new", "latest"];
const MAX_QUERY_CHARS: usize = 60;

fn set(words: &[&'static str]) -> HashSet<&'static str> {
    words.iter().copied().collect()
}

/// Words that need a qualifier before they name one subject.
pub static AMBIGUOUS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    set(&[
        "code", "design", "build", "run", "play", "model", "train", "stream", "fire", "rock",
        "metal", "spring", "cell", "plant", "pitch", "jam", "bar", "wave", "track", "scale",
        "craft", "mine", "host", "board", "drop", "lead", "light", "block", "bass", "clip", "fan",
        "gear", "kit", "log", "net", "pad", "port", "rig", "set", "tap", "tip", "web", "flow",
        "mix", "beat", "sound", "work", "world", "life", "point", "style", "power", "space",
        "match",
    ])
});

/// Verbs titles use for anything ("I tested", "we built"), as keys titles give them.
pub static GENERIC_TITLE_VERBS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    set(&[
        "test", "built", "make", "made", "tri", "use", "get", "got", "show", "watch",
    ])
});

/// Words that never belong in a query.
pub static NOISE: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    set(&[
        "prompt",
        "prompts",
        "prompting",
        "use",
        "used",
        "using",
        "guide",
        "tutorial",
        "tips",
        "tricks",
        "thing",
        "things",
        "stuff",
        "way",
        "ways",
        "type",
        "types",
        "kind",
        "level",
        "sensei",
        "guru",
        "master",
        "pro",
        "official",
        "studio",
        "studios",
        "media",
        "network",
    ])
});

/// Words that say nothing about a query's subject when comparing two queries.
pub static FILLER: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    set(&[
        "best",
        "new",
        "top",
        "how",
        "what",
        "why",
        "complete",
        "full",
        "advanced",
        "beginner",
        "learn",
        "understand",
        "understanding",
        "explained",
        "explains",
        "explanation",
        "morning",
        "evening",
        "night",
        "afternoon",
        "late",
        "early",
        "chill",
        "relaxing",
        "quick",
        "fast",
        "slow",
        "must",
        "watch",
        "see",
        "latest",
    ])
});

/// The word a domain tag adds to a search ("code:programming" searches "code programming").
#[must_use]
pub fn domain_query_word(domain: &str) -> &str {
    match domain {
        "tech" => "technology",
        "sport" => "sports",
        "live" => "livestream",
        "ai" => "artificial intelligence",
        "botany" => "plants",
        "pc" => "pc build",
        "car" => "car build",
        "graphic" => "graphic design",
        "interior" => "interior design",
        "game" => "game design",
        "diy" => "diy crafts",
        "promo" => "deals",
        "entertainment" => "movie",
        "hair" => "hairstyle",
        other => other,
    }
}

/// "2026", "2031": a year, which a search does not need.
#[must_use]
pub fn is_year(word: &str) -> bool {
    let bytes = word.as_bytes();
    bytes.len() == 4
        && bytes.starts_with(b"20")
        && (b'2'..=b'9').contains(&bytes[2])
        && bytes[3].is_ascii_digit()
}

/// Splits on the whitespace Kotlin's `\s+` means.
pub fn whitespace_words(text: &str) -> impl Iterator<Item = &str> {
    text.split([' ', '\t', '\n', '\u{b}', '\u{c}', '\r'])
        .filter(|word| !word.is_empty())
}

/// A query as searched: domain tags, repeated words, noise and years removed, at most 60
/// characters cut at a word; none when nothing is left.
#[must_use]
pub fn sanitize_query(raw: &str) -> Option<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    let cleaned: Vec<&str> = whitespace_words(raw.trim())
        .map(|word| word.split(':').next().unwrap_or(word))
        .filter(|word| seen.insert(word))
        .filter(|word| {
            let lower = word.to_lowercase();
            !lower.is_empty() && !NOISE.contains(lower.as_str()) && !is_year(&lower)
        })
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let result = cleaned.join(" ");
    if result.encode_utf16().count() <= MAX_QUERY_CHARS {
        return Some(result);
    }
    let cut: String = result.chars().take(MAX_QUERY_CHARS).collect();
    Some(match cut.rfind(' ') {
        Some(index) => cut[..index].to_string(),
        None => cut,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_lose_tags_noise_years_and_repeats() {
        assert_eq!(
            sanitize_query("metal:music guitar guitar tutorial 2026").as_deref(),
            Some("metal guitar")
        );
        assert_eq!(sanitize_query("tips 2025"), None);
        assert!(is_year("2029") && !is_year("2019") && !is_year("20255"));
    }
}
