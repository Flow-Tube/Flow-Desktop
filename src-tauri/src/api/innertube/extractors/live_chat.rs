use serde_json::Value;
use tracing::debug;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::errors::AppResult;
use crate::models::live_chat::{LiveChatMessage, LiveChatResponse, LiveChatSegment};

const DEFAULT_POLL_MS: u64 = 2000;
const MIN_POLL_MS: u64 = 1000;
const MAX_POLL_MS: u64 = 6000;

fn extract_seed_continuation(res: &Value) -> Option<String> {
    res["contents"]["twoColumnWatchNextResults"]["conversationBar"]["liveChatRenderer"]
        ["continuations"][0]["reloadContinuationData"]["continuation"]
        .as_str()
        .map(ToOwned::to_owned)
}

fn extract_is_replay(res: &Value) -> bool {
    res["contents"]["twoColumnWatchNextResults"]["conversationBar"]["liveChatRenderer"]["isReplay"]
        .as_bool()
        .unwrap_or(false)
}

fn thumbnail_best_url(image: &Value) -> Option<String> {
    image["thumbnails"]
        .as_array()
        .and_then(|thumbs| thumbs.last())
        .and_then(|thumb| thumb["url"].as_str())
        .map(ToOwned::to_owned)
}

fn parse_message_runs(message: &Value) -> (String, Vec<LiveChatSegment>) {
    let mut text = String::new();
    let mut segments = Vec::new();

    let Some(runs) = message["runs"].as_array() else {
        return (text, segments);
    };

    for run in runs {
        if let Some(run_text) = run["text"].as_str() {
            text.push_str(run_text);
            segments.push(LiveChatSegment {
                text: run_text.to_string(),
                emoji_image_url: None,
            });
        } else if let Some(emoji) = run.get("emoji") {
            let is_custom = emoji["isCustomEmoji"].as_bool().unwrap_or(false);
            let emoji_id = emoji["emojiId"].as_str().unwrap_or_default();

            if !is_custom && !emoji_id.is_empty() {
                text.push_str(emoji_id);
                segments.push(LiveChatSegment {
                    text: emoji_id.to_string(),
                    emoji_image_url: None,
                });
            } else {
                let shortcut = emoji["shortcuts"][0].as_str().unwrap_or(emoji_id);
                text.push_str(shortcut);
                segments.push(LiveChatSegment {
                    text: shortcut.to_string(),
                    emoji_image_url: thumbnail_best_url(&emoji["image"]),
                });
            }
        }
    }

    (text, segments)
}

fn parse_renderer(renderer: &Value, message_type: &str) -> Option<LiveChatMessage> {
    let id = renderer["id"].as_str()?.to_string();

    let (message, segments) = {
        let (text, segs) = parse_message_runs(&renderer["message"]);
        if message_type == "membership" && text.trim().is_empty() {
            parse_message_runs(&renderer["headerSubtext"])
        } else {
            (text, segs)
        }
    };

    let mut is_owner = false;
    let mut is_moderator = false;
    let mut is_verified = false;
    let mut is_member = false;
    let mut member_badge_url = None;
    if let Some(badges) = renderer["authorBadges"].as_array() {
        for badge in badges {
            let badge_renderer = &badge["liveChatAuthorBadgeRenderer"];
            match badge_renderer["icon"]["iconType"]
                .as_str()
                .unwrap_or_default()
                .to_ascii_uppercase()
                .as_str()
            {
                "OWNER" => is_owner = true,
                "MODERATOR" => is_moderator = true,
                "VERIFIED" => is_verified = true,
                _ => {}
            }
            if let Some(url) = thumbnail_best_url(&badge_renderer["customThumbnail"]) {
                is_member = true;
                member_badge_url = Some(url);
            }
        }
    }

    let author = renderer["authorName"]["simpleText"]
        .as_str()
        .or_else(|| renderer["authorName"]["runs"][0]["text"].as_str())
        .unwrap_or_default()
        .to_string();

    Some(LiveChatMessage {
        id,
        author,
        author_photo_url: thumbnail_best_url(&renderer["authorPhoto"]),
        message,
        segments,
        timestamp: renderer["timestampText"]["simpleText"]
            .as_str()
            .map(ToOwned::to_owned),
        message_type: message_type.to_string(),
        is_owner,
        is_moderator,
        is_verified,
        is_member,
        member_badge_url,
        super_chat_amount: renderer["purchaseAmountText"]["simpleText"]
            .as_str()
            .map(ToOwned::to_owned),
        super_chat_argb: renderer["bodyBackgroundColor"].as_i64(),
        super_chat_header_argb: renderer["headerBackgroundColor"].as_i64(),
    })
}

fn parse_chat_item(item: &Value) -> Option<LiveChatMessage> {
    if let Some(renderer) = item.get("liveChatTextMessageRenderer") {
        return parse_renderer(renderer, "text");
    }
    if let Some(renderer) = item.get("liveChatPaidMessageRenderer") {
        return parse_renderer(renderer, "superChat");
    }
    if let Some(renderer) = item.get("liveChatMembershipItemRenderer") {
        return parse_renderer(renderer, "membership");
    }
    None
}

fn parse_live_chat_page(res: &Value) -> (Vec<LiveChatMessage>, Option<String>, u64) {
    let continuation = &res["continuationContents"]["liveChatContinuation"];

    let cont_obj = continuation["continuations"]
        .as_array()
        .and_then(|arr| arr.first());
    let next = cont_obj.and_then(|obj| {
        obj["timedContinuationData"]["continuation"]
            .as_str()
            .or_else(|| obj["invalidationContinuationData"]["continuation"].as_str())
            .or_else(|| obj["reloadContinuationData"]["continuation"].as_str())
            .or_else(|| obj["liveChatReplayContinuationData"]["continuation"].as_str())
            .map(ToOwned::to_owned)
    });
    let timeout = cont_obj
        .and_then(|obj| {
            obj["timedContinuationData"]["timeoutMs"]
                .as_u64()
                .or_else(|| obj["invalidationContinuationData"]["timeoutMs"].as_u64())
        })
        .unwrap_or(DEFAULT_POLL_MS)
        .clamp(MIN_POLL_MS, MAX_POLL_MS);

    let mut messages = Vec::new();
    if let Some(actions) = continuation["actions"].as_array() {
        for action in actions {
            let item = &action["addChatItemAction"]["item"];
            if !item.is_null() {
                if let Some(msg) = parse_chat_item(item) {
                    messages.push(msg);
                }
            } else if let Some(replay_actions) =
                action["replayChatItemAction"]["actions"].as_array()
            {
                for replay in replay_actions {
                    if let Some(msg) = parse_chat_item(&replay["addChatItemAction"]["item"]) {
                        messages.push(msg);
                    }
                }
            }
        }
    }

    (messages, next, timeout)
}

impl InnertubeClient {
    async fn get_live_chat_seed(&self, video_id: &str) -> AppResult<(Option<String>, bool)> {
        let mut payload = serde_json::json!({ "videoId": video_id });
        let res = self
            .post_innertube("next", &clients::WEB, &mut payload)
            .await?;
        Ok((extract_seed_continuation(&res), extract_is_replay(&res)))
    }

    pub async fn get_live_chat(
        &self,
        video_id: &str,
        continuation: Option<String>,
    ) -> AppResult<LiveChatResponse> {
        let video_id_trimmed = video_id.trim();

        let (token, is_replay) = match continuation {
            Some(token) if !token.is_empty() => (token, false),
            _ => {
                let (seed, is_replay) = self.get_live_chat_seed(video_id_trimmed).await?;
                match seed {
                    Some(token) => (token, is_replay),
                    None => {
                        debug!(video_id = %video_id_trimmed, "[get_live_chat] No live chat available");
                        return Ok(LiveChatResponse {
                            messages: Vec::new(),
                            continuation: None,
                            polling_interval_ms: 0,
                            is_replay,
                        });
                    }
                }
            }
        };

        let mut payload = serde_json::json!({ "continuation": token });
        let res = self
            .post_innertube("live_chat/get_live_chat", &clients::WEB, &mut payload)
            .await?;
        let (messages, next, polling_interval_ms) = parse_live_chat_page(&res);

        Ok(LiveChatResponse {
            messages,
            continuation: next,
            polling_interval_ms,
            is_replay,
        })
    }
}
