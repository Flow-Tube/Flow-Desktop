use serde::{Deserialize, Serialize};

use crate::models::rich_text::RichText;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub author_thumbnail: Option<String>,
    pub author_channel_id: Option<String>,
    pub text: String,
    pub published_text: Option<String>,
    pub like_count: Option<u64>,
    pub reply_count: Option<u64>,
    pub continuation_token: Option<String>,
    /// The text with its links, timestamps and custom emoji.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<RichText>,
    /// "26K", as the comment shows it.
    #[serde(default)]
    pub like_count_text: Option<String>,
    #[serde(default)]
    pub is_pinned: bool,
    /// "Pinned by @Creator".
    #[serde(default)]
    pub pinned_text: Option<String>,
    #[serde(default)]
    pub is_hearted: bool,
    /// "❤ by @Creator".
    #[serde(default)]
    pub hearted_by_text: Option<String>,
    #[serde(default)]
    pub is_verified: bool,
    /// The comment is by the video's own channel.
    #[serde(default)]
    pub is_creator: bool,
    #[serde(default)]
    pub is_artist: bool,
}

/// One way to order the comments, and the token that loads them that way.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentSort {
    pub title: String,
    pub token: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsResponse {
    pub comments: Vec<Comment>,
    pub next_page_token: Option<String>,
    pub comment_count_text: Option<String>,
    /// Top and Newest, from the first page's header.
    #[serde(default)]
    pub sort_options: Vec<CommentSort>,
    /// The exact count from that header ("2,460,273").
    #[serde(default)]
    pub total_count: Option<u64>,
    /// The creator turned comments off.
    #[serde(default)]
    pub comments_disabled: bool,
}
