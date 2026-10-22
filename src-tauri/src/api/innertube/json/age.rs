//! Relative upload ages as feeds write them: "3 days ago", "Streamed 5 hours ago", and the
//! compact "2d ago" that related-video and lockup cards use.

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
/// A compact age only counts when "ago" follows it or it ends the text, so "4K" or "2m views"
/// never read as ages.
#[must_use]
pub fn relative_age(text: &str) -> Option<RelativeAge> {
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
        } else if matches!(next, None | Some("ago")) {
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

    fn age(value: u64, unit: AgeUnit) -> Option<RelativeAge> {
        Some(RelativeAge { value, unit })
    }

    #[test]
    fn long_forms() {
        assert_eq!(relative_age("3 days ago"), age(3, AgeUnit::Day));
        assert_eq!(relative_age("1 year ago"), age(1, AgeUnit::Year));
        assert_eq!(relative_age("Streamed 2 hours ago"), age(2, AgeUnit::Hour));
        assert_eq!(
            relative_age("Premiered 13 min ago"),
            age(13, AgeUnit::Minute)
        );
        assert_eq!(relative_age("an hour ago"), age(1, AgeUnit::Hour));
        assert_eq!(relative_age("5\u{a0}months ago"), age(5, AgeUnit::Month));
    }

    #[test]
    fn compact_forms_from_related_cards() {
        assert_eq!(relative_age("2d ago"), age(2, AgeUnit::Day));
        assert_eq!(relative_age("5h ago"), age(5, AgeUnit::Hour));
        assert_eq!(relative_age("3mo ago"), age(3, AgeUnit::Month));
        assert_eq!(relative_age("1y ago"), age(1, AgeUnit::Year));
        assert_eq!(relative_age("4w ago"), age(4, AgeUnit::Week));
        assert_eq!(relative_age("10m ago"), age(10, AgeUnit::Minute));
        assert_eq!(relative_age("Streamed 6d ago"), age(6, AgeUnit::Day));
    }

    #[test]
    fn counts_dates_and_badges_are_not_ages() {
        assert_eq!(relative_age("1.2M views"), None);
        assert_eq!(relative_age("2m views"), None);
        assert_eq!(relative_age("4K"), None);
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
