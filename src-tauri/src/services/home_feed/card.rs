//! A Home card: a video and when it was published, which feeds give only as "3 days ago".

use serde::{Deserialize, Serialize};

use crate::flow_neuro::scoring::is_known_short;
use crate::models::video::VideoSummary;

const MINUTE_MS: u64 = 60_000;
const HOUR_MS: u64 = 60 * MINUTE_MS;
const DAY_MS: u64 = 24 * HOUR_MS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    #[serde(flatten)]
    pub video: VideoSummary,
    /// When the video was published: exact from the subscription store, else read from its
    /// "3 days ago"; 0 when unknown.
    #[serde(default)]
    pub published_at_ms: u64,
}

impl Card {
    /// A card from a feed item, its publish time read from the card's own text.
    #[must_use]
    pub fn from_summary(video: VideoSummary, now_ms: u64) -> Self {
        let published_at_ms = video
            .published_text
            .as_deref()
            .and_then(age_of)
            .map_or(0, |age| now_ms.saturating_sub(age));
        Self {
            video,
            published_at_ms,
        }
    }

    pub fn id(&self) -> &str {
        &self.video.id
    }

    pub fn channel_id(&self) -> &str {
        self.video.channel_id.as_deref().unwrap_or("")
    }

    pub fn upload_text(&self) -> String {
        self.video
            .published_text
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
    }

    pub fn is_short(&self) -> bool {
        is_known_short(self.video.duration_seconds)
    }

    /// Not a Short, and of known length unless live (Android `filterValid`).
    pub fn is_valid(&self) -> bool {
        !self.is_short() && (self.video.duration_seconds.unwrap_or(0) > 0 || self.video.is_live)
    }

    /// How long ago it was published, when known.
    pub fn age_ms(&self, now_ms: u64) -> Option<u64> {
        (self.published_at_ms > 0 && self.published_at_ms <= now_ms)
            .then(|| now_ms - self.published_at_ms)
    }
}

/// The leading number of `text` as Kotlin's `filter { it.isDigit() }.toIntOrNull()` reads it.
#[must_use]
pub fn number_in(text: &str) -> Option<u64> {
    let digits: String = text.chars().filter(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// "3 days ago" as milliseconds; none for text that names no age.
#[must_use]
pub fn age_of(text: &str) -> Option<u64> {
    let text = text.to_lowercase();
    let value = number_in(&text).unwrap_or(1);
    let unit = if text.contains("second") {
        1_000
    } else if text.contains("minute") {
        MINUTE_MS
    } else if text.contains("hour") {
        HOUR_MS
    } else if text.contains("day") {
        DAY_MS
    } else if text.contains("week") {
        7 * DAY_MS
    } else if text.contains("month") {
        30 * DAY_MS
    } else if text.contains("year") {
        365 * DAY_MS
    } else {
        return None;
    };
    Some(value.saturating_mul(unit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ages_are_read_from_feed_text() {
        assert_eq!(age_of("3 days ago"), Some(3 * DAY_MS));
        assert_eq!(age_of("Streamed 2 hours ago"), Some(2 * HOUR_MS));
        assert_eq!(age_of("1 year ago"), Some(365 * DAY_MS));
        assert_eq!(age_of("Premieres soon"), None);
    }
}
