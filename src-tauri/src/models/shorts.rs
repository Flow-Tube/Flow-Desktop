use serde::{Deserialize, Serialize};

use crate::models::video::VideoSummary;

/// A single Short with the vertical-feed overlay metadata. Engagement counts and
/// `sequence_params` (the per-item "more like this" seed) are read by the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortItem {
    pub id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    pub thumbnail_url: String,
    pub channel_avatar_url: Option<String>,
    pub view_count_text: Option<String>,
    pub like_count_text: Option<String>,
    pub comment_count_text: Option<String>,
    pub published_text: Option<String>,
    pub sequence_params: Option<String>,
}

/// A page of Shorts plus the continuation token for the next batch.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortsFeed {
    pub items: Vec<ShortItem>,
    pub continuation: Option<String>,
}

impl ShortItem {
    /// Portrait poster thumbnail for a Short (`oar2` is the vertical crop).
    #[must_use]
    pub fn default_thumbnail(video_id: &str) -> String {
        format!("https://i.ytimg.com/vi/{video_id}/oar2.jpg")
    }

    /// Lower a Short into a `VideoSummary` for the shared ranker. Duration is left
    /// `None` so the engine auto-treats it as Shorts content.
    #[must_use]
    pub fn to_video_summary(&self) -> VideoSummary {
        VideoSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            channel_name: self.channel_name.clone(),
            channel_id: self.channel_id.clone(),
            thumbnail_url: Some(self.thumbnail_url.clone()),
            duration_seconds: None,
            published_text: self.published_text.clone(),
            view_count_text: self.view_count_text.clone(),
            channel_avatar_url: self.channel_avatar_url.clone(),
            is_live: false,
            ..Default::default()
        }
    }

    /// Build a Short from a non-reel candidate (topic search, subscription tab) so
    /// every ranked item ends up in the same shape.
    #[must_use]
    pub fn from_video_summary(video: VideoSummary) -> Self {
        let thumbnail_url = video
            .thumbnail_url
            .unwrap_or_else(|| Self::default_thumbnail(&video.id));
        Self {
            id: video.id,
            title: video.title,
            channel_name: video.channel_name,
            channel_id: video.channel_id,
            thumbnail_url,
            channel_avatar_url: video.channel_avatar_url,
            view_count_text: video.view_count_text,
            like_count_text: None,
            comment_count_text: None,
            published_text: video.published_text,
            sequence_params: None,
        }
    }
}
