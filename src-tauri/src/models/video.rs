use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    pub published_text: Option<String>,
    pub view_count_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_avatar_url: Option<String>,
    #[serde(default)]
    pub is_live: bool,
    /// The view count as a number, read from `view_count_text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_count: Option<u64>,
    /// A premiere or scheduled stream that has not started.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_upcoming: bool,
    /// When an upcoming video starts, in epoch milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upcoming_start_ms: Option<u64>,
    /// A Short, known from the card itself rather than guessed from its length.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_short: bool,
    /// The channel carries a verified or verified-artist badge.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_verified: bool,
    /// Only the channel's members can watch it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_members_only: bool,
    /// The card's own badges as YouTube labels them ("4K", "CC", "New").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
    /// The channels behind a collaboration, the lead first; empty for one channel.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collaborators: Vec<Collaborator>,
    /// The description excerpt search results show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// One channel of a collaboration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collaborator {
    pub channel_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscriber_count_text: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedContentItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    pub published_text: Option<String>,
    pub view_count_text: Option<String>,
    pub video_id: Option<String>,
    pub playlist_id: Option<String>,
    pub is_mix: bool,
    #[serde(default)]
    pub is_live: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_upcoming: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_verified: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_members_only: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collaborators: Vec<Collaborator>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoChapter {
    pub title: String,
    pub start_seconds: u64,
    pub end_seconds: u64,
}

/// The two facts a feed needs to fill in for a listed video, without the full
/// details lookup and its `next` request.
#[derive(Debug, Clone, Default)]
pub struct VideoBasics {
    pub channel_id: Option<String>,
    pub duration_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetails {
    pub id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<u64>,
    pub like_count_text: Option<String>,
    pub view_count_text: Option<String>,
    pub published_text: Option<String>,
    pub chapters: Vec<VideoChapter>,
    #[serde(default)]
    pub is_live: bool,
    /// YouTube's category ("Gaming", "Education") from the player's microformat.
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub stream_id: String,
    pub local_url: String,
    pub expires_at: String,
    pub variants: Vec<StreamVariant>,
    pub captions: Vec<CaptionTrack>,
    pub audio_tracks: Vec<AudioTrack>,
    #[serde(skip)]
    pub download_audio_tracks: Vec<AudioTrack>,
    pub hls_manifest_url: Option<String>,
    pub dash_manifest_url: Option<String>,
    #[serde(default)]
    pub is_live: bool,
    // SABR availability + (once a session is prepared) a local manifest URL.
    // `None` when extraction found no SABR metadata at all.
    #[serde(default)]
    pub sabr: Option<SabrStreamInfo>,
    // Internal: everything needed to spin up a SABR session. Never serialized;
    // consumed by the command layer to register a session with the proxy.
    #[serde(skip)]
    pub sabr_descriptor: Option<crate::streaming::sabr::SabrSessionDescriptor>,
}

// Frontend-facing SABR metadata. Mirrors `src/types/video.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SabrStreamInfo {
    pub available: bool,
    pub manifest_url: Option<String>,
    pub audio_url: Option<String>,
    pub video_url: Option<String>,
    pub selected_audio_itag: Option<i32>,
    pub selected_video_itag: Option<i32>,
    pub expires_in_seconds: Option<u64>,
    pub requires_po_token: bool,
    pub reason_unavailable: Option<String>,
}

impl Default for SabrStreamInfo {
    fn default() -> Self {
        Self {
            available: false,
            manifest_url: None,
            audio_url: None,
            video_url: None,
            selected_audio_itag: None,
            selected_video_itag: None,
            expires_in_seconds: None,
            requires_po_token: false,
            reason_unavailable: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamVariant {
    pub id: String,
    pub local_url: String,
    pub quality_label: String,
    pub mime_type: Option<String>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub fps: Option<u64>,
    pub bitrate: Option<u64>,
    pub content_length: Option<u64>,
    pub is_default: bool,
    pub is_playable: bool,
    pub has_audio: bool,
    pub is_video_only: bool,
    pub delivery_method: String,
    pub init_range_start: Option<u64>,
    pub init_range_end: Option<u64>,
    pub index_range_start: Option<u64>,
    pub index_range_end: Option<u64>,
    pub approx_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrack {
    pub id: String,
    pub label: String,
    pub language_code: String,
    pub url: String,
    pub is_auto_generated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub label: String,
    pub language_code: Option<String>,
    pub audio_track_type: Option<String>,
    pub local_url: String,
    pub mime_type: Option<String>,
    pub bitrate: Option<u64>,
    pub content_length: Option<u64>,
    pub is_default: bool,
    pub available: bool,
    pub init_range_start: Option<u64>,
    pub init_range_end: Option<u64>,
    pub index_range_start: Option<u64>,
    pub index_range_end: Option<u64>,
    pub approx_duration_ms: Option<u64>,
    #[serde(skip)]
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicHomeChip {
    pub title: String,
    pub browse_id: Option<String>,
    pub params: Option<String>,
    pub order_by: i32,
}
