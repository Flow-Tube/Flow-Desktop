use crate::models::video::VideoSummary;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortVideoSummary {
    pub id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub view_count_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub id: String,
    pub title: String,
    pub thumbnail_url: Option<String>,
    pub video_count_text: Option<String>,
}

/// A channel listed on another channel's page ("Featured Channels").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    pub channel_id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub subscriber_count_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollChoice {
    pub text: String,
    /// Share of the votes from 0 to 1, when the post shows results.
    pub vote_ratio: Option<f64>,
    pub vote_count_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizChoice {
    pub text: String,
    pub is_correct: bool,
    pub explanation: Option<String>,
}

/// What a post carries besides its text. A single image is a one-picture gallery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PostAttachment {
    #[serde(rename_all = "camelCase")]
    Images { urls: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Poll {
        choices: Vec<PollChoice>,
        total_votes_text: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Quiz {
        choices: Vec<QuizChoice>,
        total_votes_text: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Video { video: Box<VideoSummary> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostSummary {
    pub id: String,
    pub author_name: String,
    pub author_avatar: Option<String>,
    pub text_content: Option<String>,
    pub attachment: Option<PostAttachment>,
    pub likes_count_text: Option<String>,
    pub comment_count_text: Option<String>,
    pub comment_endpoint_params: Option<String>,
    pub published_time_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChannelItem {
    Video(VideoSummary),
    Short(ShortVideoSummary),
    Playlist(PlaylistSummary),
    Post(PostSummary),
    Channel(ChannelSummary),
}

/// One of a channel's tabs. `kind` comes from the tab's own URL ("videos",
/// "shorts", "streams", "playlists", "posts", "releases", …), never its title,
/// which is localised; `params` from the response, so a rotation cannot strand it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTab {
    pub kind: String,
    pub title: String,
    pub params: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDetails {
    pub id: String,
    pub name: String,
    pub handle: Option<String>,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    pub subscriber_count: Option<u64>,
    pub subscriber_count_text: Option<String>,
    pub video_count_text: Option<String>,
    pub verified: bool,
    pub tabs: Vec<ChannelTab>,
    /// The token that loads [`ChannelAbout`].
    pub about_token: Option<String>,
}

/// Where a section's "See all" leads: a tab's browse params or a playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSectionMore {
    pub params: Option<String>,
    pub playlist_id: Option<String>,
}

/// A titled run on a channel's Home tab, in the order the channel arranged it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSection {
    pub title: String,
    pub items: Vec<ChannelItem>,
    pub more: Option<ChannelSectionMore>,
    /// The channel trailer, shown on its own above the shelves.
    #[serde(default)]
    pub is_trailer: bool,
}

/// One choice in a filter row. Chips and sort sheets reload through
/// `continuation`; the Playlists sort menu re-browses the tab with `params`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFilterOption {
    pub label: String,
    pub selected: bool,
    pub continuation: Option<String>,
    pub params: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFilterGroup {
    pub title: Option<String>,
    pub is_dropdown: bool,
    pub options: Vec<ChannelFilterOption>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTabResponse {
    pub channel_id: String,
    /// Every item of the tab in order: Home's shelves flattened, a grid as is.
    pub items: Vec<ChannelItem>,
    pub next_page_token: Option<String>,
    /// Home's shelves with their titles; empty for a grid tab.
    #[serde(default)]
    pub sections: Vec<ChannelSection>,
    #[serde(default)]
    pub filters: Vec<ChannelFilterGroup>,
}

/// A channel's landing page: its header, tabs and Home tab from one request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPage {
    pub details: ChannelDetails,
    pub home: ChannelTabResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelLink {
    pub title: String,
    pub url: String,
    pub icon_url: Option<String>,
}

/// The About panel, loaded on demand through [`ChannelDetails::about_token`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAbout {
    pub description: Option<String>,
    pub country_text: Option<String>,
    pub joined_date_text: Option<String>,
    pub view_count_text: Option<String>,
    pub video_count_text: Option<String>,
    pub subscriber_count_text: Option<String>,
    pub canonical_url: Option<String>,
    pub links: Vec<ChannelLink>,
}
