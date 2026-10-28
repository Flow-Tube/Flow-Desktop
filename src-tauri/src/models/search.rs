use serde::{Deserialize, Serialize};

use crate::models::channel::{PlaylistSummary, ShortVideoSummary};
use crate::models::video::VideoSummary;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchVideosRequest {
    pub query: String,
    pub page_token: Option<String>,
    /// `relevance` (default) or `views`; the site reorders by nothing else.
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Upload-date window: `any` | `hour` | `today` | `week` | `month` | `year`.
    #[serde(default)]
    pub upload_date: Option<String>,
    /// Duration bucket: `any` | `short` (under 3 min) | `medium` (3 to 20 min) | `long` (over 20 min).
    #[serde(default)]
    pub duration: Option<String>,
    /// Result type: `video` | `shorts` | `channel` | `playlist` | `movie`.
    #[serde(default)]
    pub content_type: Option<String>,
    /// Features that must all hold: `live` | `4k` | `hd` | `subtitles` |
    /// `creative_commons` | `360` | `hdr` | `vr180` | `3d` | `location`.
    #[serde(default)]
    pub features: Vec<String>,
    /// Search for the query as typed, without the site's spelling correction.
    #[serde(default)]
    pub exact: bool,
}

/// A channel among the results.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchChannel {
    pub channel_id: String,
    pub name: String,
    pub handle: Option<String>,
    pub avatar_url: Option<String>,
    pub subscriber_count_text: Option<String>,
    pub video_count_text: Option<String>,
    pub description: Option<String>,
    pub is_verified: bool,
}

/// A titled run of videos inside the results ("Latest from Linus Tech Tips").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchShelf {
    pub title: String,
    pub videos: Vec<VideoSummary>,
}

/// The site's spelling correction: results already shown for `query` (with a
/// way back to `original`), or only offered as "Did you mean".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCorrection {
    pub query: String,
    pub original: Option<String>,
    pub applied: bool,
}

/// One autocomplete row: the query to search, and for well-known people, places and
/// things, the knowledge-panel card that comes with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    pub text: String,
    pub entity: Option<SuggestionEntity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionEntity {
    pub title: String,
    /// A short line such as "Finnish-American software engineer".
    pub description: Option<String>,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchVideosResponse {
    /// The video results, in order, without Shorts.
    pub items: Vec<VideoSummary>,
    pub next_page_token: Option<String>,
    pub source: String,
    pub channels: Vec<SearchChannel>,
    pub playlists: Vec<PlaylistSummary>,
    pub shorts: Vec<ShortVideoSummary>,
    pub shelves: Vec<SearchShelf>,
    pub correction: Option<SearchCorrection>,
}
