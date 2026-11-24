//! A Short's comments from its reel's own comment panel. `reel_item_watch`
//! without the player carries the panel, whose token pages through `/browse`,
//! so opening a Short's comments costs no watch page. Ported from Flow for
//! Android's `ShortsCommentsSource`.

use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use super::comments::{parse_comments_json, sort_menu_options};
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::continuation::continuation_token;
use crate::api::innertube::json::text::text_of;
use crate::errors::AppResult;
use crate::models::comment::{CommentSort, CommentsResponse};

const COMMENTS_PANEL: &str = "engagement-panel-comments-section";
const COMMENT_SECTION: &str = "comment-item-section";
/// Reels whose comment route is remembered, so their later pages go the same way.
const ROUTES_KEPT: usize = 64;

/// What a reel's comment panel says about its comment section.
#[derive(Debug, PartialEq)]
enum ReelSection {
    /// The section loads from this `/browse` token.
    Open(String),
    /// The uploader turned comments off.
    TurnedOff,
}

#[derive(Debug)]
struct ReelCommentsPanel {
    section: ReelSection,
    sort_options: Vec<CommentSort>,
    count_text: Option<String>,
}

fn reel_comments_panel(answer: &Value) -> Option<ReelCommentsPanel> {
    let panel = answer["engagementPanels"]
        .as_array()?
        .iter()
        .map(|entry| &entry["engagementPanelSectionListRenderer"])
        .find(|panel| panel["targetId"] == COMMENTS_PANEL)?;
    let items = panel["content"]["sectionListRenderer"]["contents"]
        .as_array()?
        .iter()
        .map(|content| &content["itemSectionRenderer"])
        .find(|section| section["sectionIdentifier"] == COMMENT_SECTION)?["contents"]
        .as_array()?;
    let section = match items.iter().find_map(continuation_token) {
        Some(token) => ReelSection::Open(token),
        None if items
            .iter()
            .any(|item| item.get("messageRenderer").is_some()) =>
        {
            ReelSection::TurnedOff
        }
        None => return None,
    };
    let header = &panel["header"]["engagementPanelTitleHeaderRenderer"];
    Some(ReelCommentsPanel {
        section,
        sort_options: sort_menu_options(&header["menu"]),
        count_text: text_of(&header["contextualInfo"]),
    })
}

/// Whether each recent reel's comments came through its panel (`true`) or the
/// watch page (`false`).
fn routes() -> &'static Mutex<VecDeque<(String, bool)>> {
    static ROUTES: OnceLock<Mutex<VecDeque<(String, bool)>>> = OnceLock::new();
    ROUTES.get_or_init(|| Mutex::new(VecDeque::with_capacity(ROUTES_KEPT)))
}

fn remember_route(video_id: &str, through_panel: bool) {
    let Ok(mut routes) = routes().lock() else {
        return;
    };
    routes.retain(|(id, _)| id != video_id);
    if routes.len() == ROUTES_KEPT {
        routes.pop_front();
    }
    routes.push_back((video_id.to_string(), through_panel));
}

fn through_panel(video_id: &str) -> bool {
    routes().lock().ok().is_none_or(|routes| {
        routes
            .iter()
            .find(|(id, _)| id == video_id)
            .is_none_or(|(_, panel)| *panel)
    })
}

impl InnertubeClient {
    /// A Short's comments: the first page from its reel's comment panel, later
    /// pages, other orders and replies through `/browse`. A reel without a
    /// readable panel goes through its watch page, as other videos do.
    pub async fn get_short_comments(
        &self,
        video_id: &str,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        let video_id = video_id.trim();
        if let Some(token) = page_token {
            if !through_panel(video_id) {
                return self.get_comments(video_id, Some(token)).await;
            }
            return self.browse_comments(video_id, token).await;
        }

        let mut payload = json!({
            "playerRequest": { "videoId": video_id },
            "disablePlayerResponse": true,
        });
        let panel = self
            .post_innertube("reel/reel_item_watch", &clients::WEB, &mut payload)
            .await
            .ok()
            .and_then(|answer| reel_comments_panel(&answer));
        remember_route(video_id, panel.is_some());
        let Some(panel) = panel else {
            tracing::debug!(
                video_id,
                "[get_short_comments] no reel panel; using the watch page"
            );
            return self.get_comments(video_id, None).await;
        };
        let token = match panel.section {
            ReelSection::Open(token) => token,
            ReelSection::TurnedOff => {
                return Ok(CommentsResponse {
                    comments: Vec::new(),
                    next_page_token: None,
                    comment_count_text: None,
                    sort_options: Vec::new(),
                    total_count: None,
                    comments_disabled: true,
                });
            }
        };
        let mut page = self.browse_comments(video_id, token).await?;
        // The first page's own header can leave the menu and the count out.
        if page.sort_options.is_empty() {
            page.sort_options = panel.sort_options;
        }
        if page.comment_count_text.is_none() {
            page.comment_count_text = panel.count_text;
        }
        Ok(page)
    }

    async fn browse_comments(&self, video_id: &str, token: String) -> AppResult<CommentsResponse> {
        let mut payload = json!({ "continuation": token });
        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        Ok(parse_comments_json(&response, Some(video_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel(items: &Value) -> Value {
        json!({ "engagementPanels": [
            { "engagementPanelSectionListRenderer": { "targetId": "engagement-panel-structured-description" } },
            { "engagementPanelSectionListRenderer": {
                "targetId": "engagement-panel-comments-section",
                "header": { "engagementPanelTitleHeaderRenderer": {
                    "contextualInfo": { "runs": [{ "text": "1.2K" }] },
                    "menu": { "sortFilterSubMenuRenderer": { "subMenuItems": [
                        { "title": "Top", "selected": true, "serviceEndpoint": { "continuationCommand": { "token": "TOP" } } },
                        { "title": "Newest", "selected": false, "serviceEndpoint": { "continuationCommand": { "token": "NEW" } } }
                    ] } }
                } },
                "content": { "sectionListRenderer": { "contents": [{ "itemSectionRenderer": {
                    "sectionIdentifier": "comment-item-section",
                    "contents": items
                } }] } }
            } }
        ] })
    }

    #[test]
    fn reads_the_first_token_and_the_header_of_a_reel_panel() {
        let answer = panel(&json!([{ "continuationItemRenderer": {
            "continuationEndpoint": { "continuationCommand": { "token": "FEcomment_shorts_web_top_level" } }
        } }]));
        let parsed = reel_comments_panel(&answer).expect("panel");
        assert_eq!(
            parsed.section,
            ReelSection::Open("FEcomment_shorts_web_top_level".into())
        );
        assert_eq!(parsed.sort_options.len(), 2);
        assert_eq!(parsed.sort_options[1].token, "NEW");
        assert_eq!(parsed.count_text.as_deref(), Some("1.2K"));
    }

    #[test]
    fn a_panel_with_a_message_and_no_token_means_comments_are_off() {
        let answer = panel(
            &json!([{ "messageRenderer": { "text": { "runs": [{ "text": "Comments are turned off." }] } } }]),
        );
        assert_eq!(
            reel_comments_panel(&answer).expect("panel").section,
            ReelSection::TurnedOff
        );
    }

    #[test]
    fn an_answer_without_the_panel_has_none() {
        assert!(reel_comments_panel(&json!({ "engagementPanels": [] })).is_none());
    }

    #[test]
    fn later_pages_follow_the_route_the_first_page_took() {
        remember_route("reel-a", false);
        remember_route("reel-b", true);
        assert!(!through_panel("reel-a"));
        assert!(through_panel("reel-b"));
        assert!(through_panel("never-opened"));
    }
}
