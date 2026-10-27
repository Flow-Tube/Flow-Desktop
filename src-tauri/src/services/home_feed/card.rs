//! A Home card: a video and when it was published, which feeds give only as "3 days ago".

use serde::{Deserialize, Serialize};

use crate::api::innertube::json::age::relative_age_ms;
use crate::flow_neuro::scoring::is_known_short;
use crate::models::video::VideoSummary;

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
        self.video.is_short || is_known_short(self.video.duration_seconds)
    }

    /// Playable now: not a Short, not members-only, not a premiere still to come, and of known
    /// length unless live (Android `filterValid`, plus the members-only and upcoming checks its
    /// lanes make one by one).
    pub fn is_valid(&self) -> bool {
        !self.is_short()
            && !self.video.is_members_only
            && !self.video.is_upcoming
            && (self.video.duration_seconds.unwrap_or(0) > 0 || self.video.is_live)
    }

    /// How long ago it was published, when known.
    pub fn age_ms(&self, now_ms: u64) -> Option<u64> {
        (self.published_at_ms > 0 && self.published_at_ms <= now_ms)
            .then(|| now_ms - self.published_at_ms)
    }
}

/// "3 days ago" or "2d ago" as milliseconds; none for text that names no age.
#[must_use]
pub fn age_of(text: &str) -> Option<u64> {
    relative_age_ms(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR_MS: u64 = 3_600_000;
    const DAY_MS: u64 = 24 * HOUR_MS;

    #[test]
    fn ages_are_read_from_feed_text() {
        assert_eq!(age_of("3 days ago"), Some(3 * DAY_MS));
        assert_eq!(age_of("Streamed 2 hours ago"), Some(2 * HOUR_MS));
        assert_eq!(age_of("1 year ago"), Some(365 * DAY_MS));
        assert_eq!(age_of("2d ago"), Some(2 * DAY_MS));
        assert_eq!(age_of("Premieres soon"), None);
    }

    #[test]
    fn members_only_and_upcoming_videos_are_not_shown() {
        let card = |edit: fn(&mut VideoSummary)| {
            let mut video = VideoSummary {
                id: "v".into(),
                duration_seconds: Some(600),
                ..VideoSummary::default()
            };
            edit(&mut video);
            Card {
                video,
                published_at_ms: 0,
            }
        };
        assert!(card(|_| {}).is_valid());
        assert!(!card(|video| video.is_members_only = true).is_valid());
        assert!(!card(|video| video.is_upcoming = true).is_valid());
        assert!(!card(|video| video.is_short = true).is_valid());
    }
}
