use serde::{Deserialize, Serialize};

// A single run inside a chat message: either plain text or a custom channel emoji whose image
// must be downloaded from `emoji_image_url` (unicode emojis are inlined into `text`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatSegment {
    pub text: String,
    pub emoji_image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatMessage {
    pub id: String,
    pub author: String,
    pub author_photo_url: Option<String>,
    pub message: String,
    pub segments: Vec<LiveChatSegment>,
    pub timestamp: Option<String>,
    // "text" | "superChat" | "membership"
    pub message_type: String,
    pub is_owner: bool,
    pub is_moderator: bool,
    pub is_verified: bool,
    pub is_member: bool,
    pub member_badge_url: Option<String>,
    // Super-chat only. ARGB colors are packed ints the frontend unpacks into CSS colors.
    pub super_chat_amount: Option<String>,
    pub super_chat_argb: Option<i64>,
    pub super_chat_header_argb: Option<i64>,
    /// Where in a replayed stream the message was sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_offset_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChatResponse {
    pub messages: Vec<LiveChatMessage>,
    pub continuation: Option<String>,
    // Server-recommended delay before the next poll, clamped to a safe range.
    pub polling_interval_ms: u64,
    pub is_replay: bool,
    /// Tokens that restart the chat as "Top chat" or as every message, from the
    /// first page's view selector.
    #[serde(default)]
    pub top_chat_continuation: Option<String>,
    #[serde(default)]
    pub all_chat_continuation: Option<String>,
    /// A replay token that jumps to another playback position.
    #[serde(default)]
    pub seek_continuation: Option<String>,
}
