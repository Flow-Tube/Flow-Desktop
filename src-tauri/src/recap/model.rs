use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const MONTHS_MAX: usize = 36;
pub const CHANNELS_PER_MONTH: usize = 300;
pub const VIDEOS_PER_MONTH: usize = 300;
pub const TOPICS_PER_MONTH: usize = 60;
pub const DISCOVERED_PER_MONTH: usize = 500;
pub const SKIPS_PER_MONTH: usize = 150;
pub const DISLIKES_PER_MONTH: usize = 100;
pub const QUERIES_PER_MONTH: usize = 20;
pub const TOPICS_PER_VIEW: usize = 3;
pub const ARTISTS_PER_MONTH: usize = 250;
pub const TRACKS_PER_MONTH: usize = 300;
pub const SAID_NO_PER_MONTH: usize = 100;

/// How a video was watched. Music is never in the video ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ViewFormat {
    Long,
    Short,
    Live,
}

/// Library actions the recap counts per month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LedgerAction {
    Like,
    Save,
    Download,
    NotInterested,
    BlockChannel,
    Search,
}

/// A thumbs-down, with enough to name it after the video is long gone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DislikedVideo {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub at: i64,
}

/// One month of viewing. Display names live here because the engine prunes, and a December recap
/// must still name a March channel.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoMonth {
    /// Views that counted: past the skip threshold, or a Short watched rather than swiped.
    pub views: i64,
    /// Every session that produced watch time, skipped ones included.
    pub sessions: i64,
    pub watched_ms: i64,
    pub format_views: BTreeMap<ViewFormat, i64>,
    pub format_ms: BTreeMap<ViewFormat, i64>,
    pub channel_views: BTreeMap<String, i64>,
    pub channel_ms: BTreeMap<String, i64>,
    pub channel_names: BTreeMap<String, String>,
    pub channel_avatars: BTreeMap<String, String>,
    pub video_views: BTreeMap<String, i64>,
    pub video_titles: BTreeMap<String, String>,
    pub video_channels: BTreeMap<String, String>,
    pub topic_views: BTreeMap<String, i64>,
    /// Channels whose first view ever happened this month.
    pub discovered_channels: BTreeSet<String>,
    pub video_skips: BTreeMap<String, i64>,
    pub channel_skips: BTreeMap<String, i64>,
    pub dislikes: Vec<DislikedVideo>,
    pub actions: BTreeMap<LedgerAction, i64>,
    /// Search text to times searched.
    pub queries: BTreeMap<String, i64>,
    /// `SponsorBlock` category to the time it skipped.
    pub sponsor_skipped_ms: BTreeMap<String, i64>,
    pub day_views: BTreeMap<u32, i64>,
    pub day_ms: BTreeMap<u32, i64>,
    pub hour_views: BTreeMap<u32, i64>,
}

/// One month of listening.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicMonth {
    /// Counted plays: past half of the song, or an explicit like.
    pub plays: i64,
    /// Every session that produced any listening time, partial ones included.
    pub sessions: i64,
    pub listened_ms: i64,
    pub artist_plays: BTreeMap<String, i64>,
    pub artist_names: BTreeMap<String, String>,
    pub track_plays: BTreeMap<String, i64>,
    pub track_titles: BTreeMap<String, String>,
    /// Artists whose first counted play ever happened this month.
    pub discovered_artists: BTreeSet<String>,
    pub day_plays: BTreeMap<u32, i64>,
    pub hour_plays: BTreeMap<u32, i64>,
    pub day_ms: BTreeMap<u32, i64>,
    /// Sessions ended before the first milestone after a deliberate listen.
    pub track_skips: BTreeMap<String, i64>,
    pub artist_skips: BTreeMap<String, i64>,
    /// Artists marked "not interested" this month, with when.
    pub disliked_artists: BTreeMap<String, i64>,
    /// Artists blocked this month, with when.
    pub blocked_artists: BTreeMap<String, i64>,
    pub track_art: BTreeMap<String, String>,
    pub artist_art: BTreeMap<String, String>,
}

/// Where a moment falls in the local calendar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerMoment {
    pub month_key: String,
    pub day: u32,
    pub hour: u32,
}

impl LedgerMoment {
    /// `at_ms` in the machine's own time zone; `None` for a time no calendar holds.
    #[must_use]
    pub fn local(at_ms: i64) -> Option<Self> {
        use chrono::{Datelike, Local, TimeZone, Timelike};
        let time = Local.timestamp_millis_opt(at_ms).single()?;
        Some(Self {
            month_key: format!("{:04}-{:02}", time.year(), time.month()),
            day: time.day(),
            hour: time.hour(),
        })
    }
}

/// One finished stretch of a viewing session, as the player or the Shorts feed saw it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ViewEvent {
    pub video_id: String,
    pub title: String,
    pub channel_id: String,
    pub channel_name: String,
    pub channel_avatar_url: String,
    pub description: Option<String>,
    pub format: Option<ViewFormat>,
    pub watched_ms: i64,
    /// A deliberate view: it counts toward views, channels, videos and topics.
    pub counted: bool,
    /// Abandoned early after a real look.
    pub skipped: bool,
    /// More time from a session already sent; it adds time, not another session.
    pub continued: bool,
}

/// One stretch of a listening session.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListenEvent {
    pub track_id: String,
    pub title: String,
    pub artist_id: Option<String>,
    pub artist_name: String,
    pub artwork_url: String,
    pub listened_ms: i64,
    pub counted: bool,
    pub skipped: bool,
    pub continued: bool,
}

/// One thing the frontend queued for the ledger. The gate that decides what Deep Flow stops is in
/// `src/lib/recap/recapQueue.ts`, so nothing reaches this type while recording is off.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecapEntry {
    View {
        at_ms: i64,
        #[serde(flatten)]
        event: ViewEvent,
    },
    Listen {
        at_ms: i64,
        #[serde(flatten)]
        event: ListenEvent,
    },
    Dislike {
        at_ms: i64,
        video_id: String,
        title: String,
        channel_name: String,
    },
    DislikeRemoved {
        at_ms: i64,
        video_id: String,
    },
    Action {
        at_ms: i64,
        action: LedgerAction,
    },
    Search {
        at_ms: i64,
        query: Option<String>,
    },
    SponsorSkip {
        at_ms: i64,
        category: String,
        skipped_ms: i64,
    },
    ArtistSaidNo {
        at_ms: i64,
        artist_id: Option<String>,
        artist_name: String,
        blocked: bool,
    },
    QueriesCleared,
}

impl RecapEntry {
    #[must_use]
    pub fn at_ms(&self) -> Option<i64> {
        match self {
            Self::View { at_ms, .. }
            | Self::Listen { at_ms, .. }
            | Self::Dislike { at_ms, .. }
            | Self::DislikeRemoved { at_ms, .. }
            | Self::Action { at_ms, .. }
            | Self::Search { at_ms, .. }
            | Self::SponsorSkip { at_ms, .. }
            | Self::ArtistSaidNo { at_ms, .. } => Some(*at_ms),
            Self::QueriesCleared => None,
        }
    }
}

/// Both ledgers as one master-backup entry, the shape of Android's `recap_stats.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecapBackup {
    pub version: u32,
    pub video: VideoSnapshot,
    pub music: MusicSnapshot,
    /// When the ledger started, Unix milliseconds; 0 when the backup doesn't say.
    pub started_at: i64,
    /// Months that include an estimate from watch history, as "video/2026-09" or "music/2026-09".
    pub estimated: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoSnapshot {
    pub months: BTreeMap<String, VideoMonth>,
    pub seed_channels: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicSnapshot {
    pub months: BTreeMap<String, MusicMonth>,
    pub seed_artists: Vec<String>,
}

#[cfg(test)]
mod entry_tests {
    use super::RecapEntry;

    fn view(watched_ms: &str) -> Result<Vec<RecapEntry>, serde_json::Error> {
        serde_json::from_str(&format!(
            r#"[{{"kind":"view","atMs":1,"videoId":"v","title":"t","watchedMs":{watched_ms},"counted":true}}]"#
        ))
    }

    #[test]
    fn whole_milliseconds_are_read() {
        let entries = view("2503").unwrap();
        assert!(matches!(&entries[0], RecapEntry::View { event, .. } if event.watched_ms == 2503));
    }

    /// One fractional number refuses the whole batch, which is why the frontend rounds them.
    #[test]
    fn a_fractional_time_refuses_the_batch() {
        assert!(view("2503.7").is_err());
    }
}
