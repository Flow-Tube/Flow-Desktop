use serde::{Deserialize, Serialize};

/// Text with its links: what each span points at, and the custom emoji drawn
/// over it. Offsets count UTF-16 code units, as the page that slices them does.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichText {
    pub text: String,
    pub spans: Vec<RichSpan>,
    pub emojis: Vec<RichEmoji>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichSpan {
    pub start: usize,
    pub length: usize,
    pub target: RichTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RichTarget {
    /// A moment of the video the text belongs to.
    #[serde(rename_all = "camelCase")]
    Timestamp { seconds: u64 },
    #[serde(rename_all = "camelCase")]
    Video {
        video_id: String,
        start_seconds: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Playlist { playlist_id: String },
    #[serde(rename_all = "camelCase")]
    Channel { channel_id: String },
    #[serde(rename_all = "camelCase")]
    Hashtag { tag: String },
    #[serde(rename_all = "camelCase")]
    Url { url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichEmoji {
    pub start: usize,
    pub length: usize,
    pub image_url: String,
    pub label: String,
}
