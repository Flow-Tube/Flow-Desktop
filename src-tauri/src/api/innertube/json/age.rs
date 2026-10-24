//! Relative upload ages as feeds write them: "3 days ago", "Streamed 5 hours ago", and the
//! compact "2d ago" that related-video and lockup cards use.

use super::age_patterns::{AgePatterns, PATTERNS};

const SECOND_MS: u64 = 1_000;
const MINUTE_MS: u64 = 60 * SECOND_MS;
const HOUR_MS: u64 = 60 * MINUTE_MS;
const DAY_MS: u64 = 24 * HOUR_MS;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgeUnit {
    Second,
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

impl AgeUnit {
    #[must_use]
    pub const fn ms(self) -> u64 {
        match self {
            Self::Second => SECOND_MS,
            Self::Minute => MINUTE_MS,
            Self::Hour => HOUR_MS,
            Self::Day => DAY_MS,
            Self::Week => 7 * DAY_MS,
            Self::Month => 30 * DAY_MS,
            Self::Year => 365 * DAY_MS,
        }
    }

    fn from_word(word: &str) -> Option<Self> {
        let unit = match word.trim_end_matches('s') {
            "second" | "sec" => Self::Second,
            "minute" | "min" => Self::Minute,
            "hour" | "hr" => Self::Hour,
            "day" => Self::Day,
            "week" | "wk" => Self::Week,
            "month" => Self::Month,
            "year" | "yr" => Self::Year,
            _ => return None,
        };
        Some(unit)
    }

    /// The suffix of a compact age such as "2d" or "3mo".
    fn from_compact(suffix: &str) -> Option<Self> {
        let unit = match suffix {
            "s" => Self::Second,
            "m" => Self::Minute,
            "h" => Self::Hour,
            "d" => Self::Day,
            "w" => Self::Week,
            "mo" => Self::Month,
            "y" => Self::Year,
            _ => return Self::from_word(suffix),
        };
        Some(unit)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RelativeAge {
    pub value: u64,
    pub unit: AgeUnit,
}

impl RelativeAge {
    #[must_use]
    pub const fn ms(self) -> u64 {
        self.value.saturating_mul(self.unit.ms())
    }
}

/// The age `text` names, or none when it names no age ("Premieres 10/12/26", "1.2M views").
///
/// Read as English first, then in the content language when that is another one.
#[must_use]
pub fn relative_age(text: &str) -> Option<RelativeAge> {
    english_age(text).or_else(|| {
        let language = crate::api::innertube::core::locale::content_language();
        (language != "en")
            .then(|| relative_age_in(text, &language))
            .flatten()
    })
}

/// The age `text` names in `language`, by that language's unit words.
#[must_use]
pub fn relative_age_in(text: &str, language: &str) -> Option<RelativeAge> {
    let patterns = patterns_for(language)?;
    let lower = text.to_lowercase();
    if let Some((unit, _, value)) = patterns
        .special
        .iter()
        .find(|(_, phrase, _)| phrase_in(&lower, &phrase.to_lowercase(), patterns.separator))
    {
        return Some(RelativeAge {
            value: *value,
            unit: *unit,
        });
    }
    let unit = patterns.units.iter().find_map(|(unit, words)| {
        words
            .iter()
            .any(|word| phrase_in(&lower, &word.to_lowercase(), patterns.separator))
            .then_some(*unit)
    })?;
    // "vor 6 Tagen", "8 か月前": the text's number, or one when it names none ("a week").
    let value = lower
        .split(|c: char| !c.is_ascii_digit())
        .find(|digits| !digits.is_empty())
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(1);
    Some(RelativeAge { value, unit })
}

/// The table for a host language: its own, else its base language's.
fn patterns_for(language: &str) -> Option<&'static AgePatterns> {
    let tag = language.replace('_', "-");
    let base = tag.split('-').next().unwrap_or_default();
    let aliases: &[&str] = match tag.as_str() {
        "pt-BR" => &["pt"],
        "pt" => &["pt-PT", "pt"],
        "he" => &["iw"],
        "nb" | "nn" => &["no"],
        "tl" => &["fil"],
        "zh" => &["zh-CN"],
        _ => &[],
    };
    std::iter::once(tag.as_str())
        .chain(aliases.iter().copied())
        .chain(std::iter::once(base))
        .find_map(|candidate| {
            PATTERNS
                .iter()
                .find(|patterns| patterns.language.eq_ignore_ascii_case(candidate))
        })
}

/// Whether `phrase` stands in `text` as a word: bounded by spaces or digits,
/// or anywhere for languages written without spaces.
fn phrase_in(text: &str, phrase: &str, separator: &str) -> bool {
    if phrase.is_empty() {
        return false;
    }
    if separator.is_empty() {
        return text.contains(phrase);
    }
    let bound = |c: Option<char>| {
        c.is_none_or(|c| c.is_whitespace() || c.is_ascii_digit() || c == '\u{202f}')
    };
    text.match_indices(phrase).any(|(start, matched)| {
        bound(text[..start].chars().next_back())
            && bound(text[start + matched.len()..].chars().next())
    })
}

/// "3 days ago", "Streamed 5 hours ago" and the compact "2d ago".
///
/// A compact age only counts when "ago" follows it, so "4K", "21M" or "2m views" never read as
/// ages.
fn english_age(text: &str) -> Option<RelativeAge> {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split_whitespace()
        .map(|word| word.trim_matches(|c: char| matches!(c, ',' | '.' | '(' | ')' | '•')))
        .filter(|word| !word.is_empty())
        .collect();
    for (i, word) in words.iter().enumerate() {
        let next = words.get(i + 1).copied();
        let digits_end = word
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(word.len());
        if digits_end == 0 {
            if matches!(*word, "a" | "an")
                && let Some(unit) = next.and_then(AgeUnit::from_word)
            {
                return Some(RelativeAge { value: 1, unit });
            }
            continue;
        }
        let Ok(value) = word[..digits_end].parse::<u64>() else {
            continue;
        };
        let suffix = &word[digits_end..];
        let unit = if suffix.is_empty() {
            next.and_then(AgeUnit::from_word)
        } else if next == Some("ago") {
            AgeUnit::from_compact(suffix)
        } else {
            None
        };
        if let Some(unit) = unit {
            return Some(RelativeAge { value, unit });
        }
    }
    None
}

/// [`relative_age`] in milliseconds.
#[must_use]
pub fn relative_age_ms(text: &str) -> Option<u64> {
    relative_age(text).map(RelativeAge::ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ages_are_read_in_the_languages_the_site_writes() {
        let days = |value| {
            Some(RelativeAge {
                value,
                unit: AgeUnit::Day,
            })
        };
        assert_eq!(relative_age_in("vor 6 Tagen", "de"), days(6));
        assert_eq!(
            relative_age_in("il y a 20 heures", "fr"),
            Some(RelativeAge {
                value: 20,
                unit: AgeUnit::Hour
            })
        );
        assert_eq!(
            relative_age_in("il y a 2 semaines", "fr"),
            Some(RelativeAge {
                value: 2,
                unit: AgeUnit::Week
            })
        );
        assert_eq!(
            relative_age_in("8 か月前", "ja"),
            Some(RelativeAge {
                value: 8,
                unit: AgeUnit::Month
            })
        );
        assert_eq!(
            relative_age_in("hace 16 años", "es"),
            Some(RelativeAge {
                value: 16,
                unit: AgeUnit::Year
            })
        );
        assert_eq!(
            relative_age_in("4 месяца назад", "ru"),
            Some(RelativeAge {
                value: 4,
                unit: AgeUnit::Month
            })
        );
        assert_eq!(relative_age_in("5 дней назад", "ru"), days(5));
        assert_eq!(
            relative_age_in("há 2 horas", "pt-BR"),
            Some(RelativeAge {
                value: 2,
                unit: AgeUnit::Hour
            })
        );
        assert_eq!(relative_age_in("לפני יומיים", "he"), days(2));
        assert_eq!(relative_age_in("3天前", "zh-CN"), days(3));
    }

    #[test]
    fn a_word_inside_another_is_not_a_unit() {
        // Spanish "mes" (month) must not match inside "meses"'s neighbours, nor "an" inside "dans".
        assert_eq!(
            relative_age_in("dans 3 jours", "fr"),
            Some(RelativeAge {
                value: 3,
                unit: AgeUnit::Day
            })
        );
        assert_eq!(relative_age_in("Premiere am 12.10.2026", "de"), None);
        assert_eq!(relative_age_in("621.747 Aufrufe", "de"), None);
    }

    fn age(value: u64, unit: AgeUnit) -> RelativeAge {
        RelativeAge { value, unit }
    }

    #[test]
    fn long_forms() {
        assert_eq!(relative_age("3 days ago"), Some(age(3, AgeUnit::Day)));
        assert_eq!(relative_age("1 year ago"), Some(age(1, AgeUnit::Year)));
        assert_eq!(
            relative_age("Streamed 2 hours ago"),
            Some(age(2, AgeUnit::Hour))
        );
        assert_eq!(
            relative_age("Premiered 13 min ago"),
            Some(age(13, AgeUnit::Minute))
        );
        assert_eq!(relative_age("an hour ago"), Some(age(1, AgeUnit::Hour)));
        assert_eq!(
            relative_age("5\u{a0}months ago"),
            Some(age(5, AgeUnit::Month))
        );
    }

    #[test]
    fn compact_forms_from_related_cards() {
        assert_eq!(relative_age("2d ago"), Some(age(2, AgeUnit::Day)));
        assert_eq!(relative_age("5h ago"), Some(age(5, AgeUnit::Hour)));
        assert_eq!(relative_age("3mo ago"), Some(age(3, AgeUnit::Month)));
        assert_eq!(relative_age("1y ago"), Some(age(1, AgeUnit::Year)));
        assert_eq!(relative_age("4w ago"), Some(age(4, AgeUnit::Week)));
        assert_eq!(relative_age("10m ago"), Some(age(10, AgeUnit::Minute)));
        assert_eq!(relative_age("Streamed 6d ago"), Some(age(6, AgeUnit::Day)));
    }

    #[test]
    fn counts_dates_and_badges_are_not_ages() {
        assert_eq!(relative_age("1.2M views"), None);
        assert_eq!(relative_age("2m views"), None);
        assert_eq!(relative_age("4K"), None);
        assert_eq!(
            relative_age("21M"),
            None,
            "a bare compact view count is not 21 minutes"
        );
        assert_eq!(relative_age("Premieres 10/12/26"), None);
        assert_eq!(relative_age("Scheduled for 10/12/26, 7:00 PM"), None);
        assert_eq!(relative_age("12 waiting"), None);
        assert_eq!(relative_age(""), None);
    }

    #[test]
    fn milliseconds() {
        assert_eq!(relative_age_ms("2d ago"), Some(2 * DAY_MS));
        assert_eq!(relative_age_ms("1 week ago"), Some(7 * DAY_MS));
    }
}
