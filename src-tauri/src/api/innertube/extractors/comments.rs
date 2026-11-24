use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::debug;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::continuation::{continuation_item_lists, continuation_token};
use crate::api::innertube::json::count::parse_count;
use crate::api::innertube::json::rich_text::rich_text;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{
    normalize_youtube_image_url, thumbnail_url_from_array,
};
use crate::api::innertube::transport::request::Host;
use crate::errors::{AppError, AppResult};
use crate::models::comment::{Comment, CommentImage, CommentSort, CommentsResponse};

/// The Timed list's opening line, which is no comment.
const TIMED_WELCOME_ID: &str = "timed_comments_welcome_sync_id";
/// Only the entities: the rest of the Timed answer is server-drawn rows, 600 KB of
/// them, that take seconds to arrive.
const TIMED_FIELDS: &str = "&fields=frameworkUpdates.entityBatchUpdate.mutations";

/// What a thread renders with when its comment is pinned to the top.
const PINNED_PRIORITY: &str = "RENDERING_PRIORITY_PINNED_COMMENT";
const HEARTED: &str = "TOOLBAR_HEART_STATE_HEARTED";

fn find_comment_count_text(val: &Value) -> Option<String> {
    if let Some(panels) = val["engagementPanels"].as_array() {
        for panel in panels {
            let section = &panel["engagementPanelSectionListRenderer"];
            let panel_id = section["panelIdentifier"].as_str();
            if panel_id == Some("comment-item-section")
                || panel_id == Some("engagement-panel-comments-section")
            {
                let header = &section["header"]["engagementPanelTitleHeaderRenderer"];
                if let Some(text) = header["contextualInfo"]["runs"][0]["text"].as_str() {
                    return Some(text.to_string());
                }
                if let Some(text) = header["contextualInfo"]["simpleText"].as_str() {
                    return Some(text.to_string());
                }
            }
        }
    }

    if let Some(contents) =
        val["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"].as_array()
    {
        for content in contents {
            let item_section = &content["itemSectionRenderer"];
            let target_id = item_section["targetId"].as_str();
            let section_id = item_section["sectionIdentifier"].as_str();
            let looks_like_comments = target_id == Some("comments-section")
                || section_id == Some("comment-item-section")
                || section_id == Some("comments-section");

            if looks_like_comments {
                let header = &item_section["header"]["commentsHeaderRenderer"];
                if !header.is_null() {
                    let mut count_str = String::new();
                    if let Some(runs) = header["countText"]["runs"].as_array() {
                        for run in runs {
                            if let Some(t) = run["text"].as_str() {
                                count_str.push_str(t);
                            }
                        }
                    } else if let Some(simple) = header["countText"]["simpleText"].as_str() {
                        count_str = simple.to_string();
                    }

                    if !count_str.is_empty() {
                        return Some(count_str);
                    }
                }
            }
        }
    }

    None
}

/// The comments page's header: the sort options and the exact count. A
/// community post's page can carry it inside its sections rather than in the
/// continuation items, so the rest of the answer is searched after those.
fn comments_header(val: &Value) -> Option<&Value> {
    continuation_item_lists(val)
        .into_iter()
        .flatten()
        .find_map(|item| item.get("commentsHeaderRenderer"))
        .or_else(|| find_comments_header(val))
}

fn find_comments_header(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(map) => map
            .get("commentsHeaderRenderer")
            .or_else(|| map.values().find_map(find_comments_header)),
        Value::Array(items) => items.iter().find_map(find_comments_header),
        _ => None,
    }
}

fn sort_options(header: &Value) -> Vec<CommentSort> {
    sort_menu_options(&header["sortMenu"])
}

/// The entries of a menu that holds a `sortFilterSubMenuRenderer`.
pub(super) fn sort_menu_options(menu: &Value) -> Vec<CommentSort> {
    menu["sortFilterSubMenuRenderer"]["subMenuItems"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(CommentSort {
                title: text_of(&item["title"])?,
                token: item["serviceEndpoint"]["continuationCommand"]["token"]
                    .as_str()?
                    .to_string(),
                selected: item["selected"].as_bool().unwrap_or(false),
            })
        })
        .collect()
}

/// Whether the watch answer's comment section says comments are off: it holds
/// a message where the token for the first page would be.
fn comments_disabled(val: &Value) -> bool {
    val["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|content| &content["itemSectionRenderer"])
        .find(|section| section["sectionIdentifier"] == "comment-item-section")
        .and_then(|section| section["contents"].as_array())
        .is_some_and(|contents| {
            contents
                .iter()
                .any(|item| item.get("messageRenderer").is_some())
                && !contents
                    .iter()
                    .any(|item| item.get("continuationItemRenderer").is_some())
        })
}

/// A page of comments: the watch answer's first section, or a continuation.
#[must_use]
pub fn parse_comments_json(val: &Value, own_video_id: Option<&str>) -> CommentsResponse {
    let mut comments = Vec::new();
    let mut next_page_token = None;
    let mutation_payloads = build_comment_mutation_map(val);

    collect_comments_from_value(
        &val["onResponseReceivedEndpoints"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
        own_video_id,
    );
    collect_comments_from_value(
        &val["onResponseReceivedActions"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
        own_video_id,
    );
    collect_comments_from_value(
        &val["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
        own_video_id,
    );
    collect_comments_from_value(
        &val["engagementPanels"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
        own_video_id,
    );

    if comments.is_empty() || next_page_token.is_none() {
        collect_comments_from_value(
            val,
            &mut comments,
            &mut next_page_token,
            &mutation_payloads,
            own_video_id,
        );
    }

    comments = dedupe_comments(comments);

    let header = comments_header(val);
    let header_count = header.and_then(|header| text_of(&header["countText"]));

    CommentsResponse {
        comments,
        next_page_token,
        total_count: header_count
            .as_deref()
            .map(|text| {
                text.chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>()
            })
            .and_then(|digits| digits.parse().ok()),
        comment_count_text: find_comment_count_text(val),
        sort_options: header.map(sort_options).unwrap_or_default(),
        comments_disabled: comments_disabled(val),
    }
}

fn find_first_comments_continuation(value: &Value) -> Option<String> {
    if let Some(token) = continuation_token(value) {
        return Some(token);
    }

    if let Some(token) = value["continuationCommand"]["token"].as_str() {
        return Some(token.to_string());
    }

    if let Some(array) = value.as_array() {
        for item in array {
            if let Some(token) = find_first_comments_continuation(item) {
                return Some(token);
            }
        }
        return None;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            if let Some(token) = find_first_comments_continuation(child) {
                return Some(token);
            }
        }
    }

    None
}

fn find_initial_comments_token(response: &Value) -> Option<String> {
    response["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"]
        .as_array()
        .and_then(|contents| {
            contents.iter().find_map(|content| {
                let item_section = &content["itemSectionRenderer"];
                let target_id = item_section["targetId"].as_str();
                let section_id = item_section["sectionIdentifier"].as_str();
                let looks_like_comments = target_id == Some("comments-section")
                    || section_id == Some("comment-item-section")
                    || section_id == Some("comments-section");

                if !looks_like_comments {
                    return None;
                }

                item_section["contents"]
                    .as_array()
                    .and_then(|section_contents| {
                        section_contents.iter().find_map(|item| {
                            item["continuationItemRenderer"]["continuationEndpoint"]
                                ["continuationCommand"]["token"]
                                .as_str()
                                .or_else(|| {
                                    item["continuationItemRenderer"]["button"]["buttonRenderer"]
                                        ["command"]["continuationCommand"]["token"]
                                        .as_str()
                                })
                                .map(ToOwned::to_owned)
                        })
                    })
                    .or_else(|| {
                        item_section["header"]["commentsHeaderRenderer"]["sortMenu"]
                            ["sortFilterSubMenuRenderer"]["subMenuItems"][0]["serviceEndpoint"]
                            ["continuationCommand"]["token"]
                            .as_str()
                            .map(ToOwned::to_owned)
                    })
            })
        })
        .or_else(|| {
            response["engagementPanels"].as_array().and_then(|panels| {
                panels.iter().find_map(|panel| {
                    let section = &panel["engagementPanelSectionListRenderer"];
                    let panel_id = section["panelIdentifier"].as_str();
                    if panel_id != Some("comment-item-section")
                        && panel_id != Some("engagement-panel-comments-section")
                    {
                        return None;
                    }

                    section["content"]["sectionListRenderer"]["contents"]
                        .as_array()
                        .and_then(|contents| {
                            contents.iter().find_map(|content| {
                                content["itemSectionRenderer"]["contents"][0]
                                    ["continuationItemRenderer"]["continuationEndpoint"]
                                    ["continuationCommand"]["token"]
                                    .as_str()
                                    .map(ToOwned::to_owned)
                            })
                        })
                        .or_else(|| {
                            section["header"]["engagementPanelTitleHeaderRenderer"]["menu"]
                                ["sortFilterSubMenuRenderer"]["subMenuItems"][0]["serviceEndpoint"]
                                ["continuationCommand"]["token"]
                                .as_str()
                                .map(ToOwned::to_owned)
                        })
                })
            })
        })
        .or_else(|| find_first_comments_continuation(response))
}

fn collect_comments_from_value(
    value: &Value,
    comments: &mut Vec<Comment>,
    next_page_token: &mut Option<String>,
    mutation_payloads: &HashMap<String, Value>,
    own_video_id: Option<&str>,
) {
    if let Some(thread) = value.get("commentThreadRenderer") {
        let pinned = thread["renderingPriority"] == PINNED_PRIORITY;
        let replies = thread
            .get("replies")
            .and_then(|replies| replies.get("commentRepliesRenderer"));
        let view_model = thread["commentViewModel"]["commentViewModel"]
            .as_object()
            .map(|_| &thread["commentViewModel"]["commentViewModel"])
            .or_else(|| thread.get("commentViewModel"));
        let comment = match view_model {
            Some(view_model) => build_comment_from_view_model(
                view_model,
                replies,
                mutation_payloads,
                own_video_id,
                pinned,
            ),
            None => legacy_comment(&thread["comment"]["commentRenderer"], replies),
        };
        comments.extend(comment);
        return;
    }

    if let Some(view_model) = value.get("commentViewModel") {
        comments.extend(build_comment_from_view_model(
            view_model,
            None,
            mutation_payloads,
            own_video_id,
            false,
        ));
        return;
    }

    if let Some(renderer) = value.get("commentRenderer") {
        comments.extend(legacy_comment(renderer, None));
        return;
    }

    // "Show more replies" carries its token on a button, not a continuation endpoint.
    if next_page_token.is_none() {
        *next_page_token = continuation_token(value);
    }

    if let Some(array) = value.as_array() {
        for item in array {
            collect_comments_from_value(
                item,
                comments,
                next_page_token,
                mutation_payloads,
                own_video_id,
            );
        }
        return;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            collect_comments_from_value(
                child,
                comments,
                next_page_token,
                mutation_payloads,
                own_video_id,
            );
        }
    }
}

/// A comment in the older `commentRenderer` shape.
fn legacy_comment(renderer: &Value, replies_renderer: Option<&Value>) -> Option<Comment> {
    let id = renderer["commentId"].as_str().filter(|id| !id.is_empty())?;
    let (creator_reply_thumbnail, creator_reply_name) = creator_reply(replies_renderer);
    Some(Comment {
        id: id.to_string(),
        author: text_of(&renderer["authorText"]).unwrap_or_else(|| "Anonymous".to_string()),
        author_thumbnail: thumbnail_url_from_array(&renderer["authorThumbnail"]["thumbnails"]),
        author_channel_id: renderer["authorEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .map(ToOwned::to_owned),
        text: text_of(&renderer["contentText"]).unwrap_or_default(),
        published_text: text_of(&renderer["publishedTimeText"]),
        like_count: renderer["voteCount"]["simpleText"]
            .as_str()
            .and_then(parse_count),
        like_count_text: text_of(&renderer["voteCount"]),
        reply_count: renderer["replyCount"].as_u64(),
        continuation_token: comment_reply_token(replies_renderer),
        is_pinned: renderer.get("pinnedCommentBadge").is_some(),
        is_verified: renderer.get("authorCommentBadge").is_some(),
        creator_reply_thumbnail,
        creator_reply_name,
        image: comment_image(&renderer["imageAttachmentViewModel"]),
        ..Default::default()
    })
}

/// The avatar and channel name on the replies button of a thread the creator
/// answered.
fn creator_reply(replies_renderer: Option<&Value>) -> (Option<String>, Option<String>) {
    let Some(thumbnail) = replies_renderer.map(|renderer| &renderer["viewRepliesCreatorThumbnail"])
    else {
        return (None, None);
    };
    let Some(url) = thumbnail_url_from_array(&thumbnail["thumbnails"]) else {
        return (None, None);
    };
    let name = thumbnail["accessibility"]["accessibilityData"]["label"]
        .as_str()
        .filter(|label| !label.trim().is_empty())
        .map(ToOwned::to_owned);
    (Some(url), name)
}

/// The GIF or picture `YouTube` shows under a comment's text, with its size.
fn comment_image(attachment: &Value) -> Option<CommentImage> {
    let view_model = &attachment["commentImageAttachmentViewModel"];
    let url = thumbnail_url_from_array(&view_model["image"]["sources"])?;
    let width = u32::try_from(view_model["width"].as_u64()?).ok()?;
    let height = u32::try_from(view_model["height"].as_u64()?).ok()?;
    (width > 0 && height > 0).then_some(CommentImage { url, width, height })
}

fn build_comment_mutation_map(value: &Value) -> HashMap<String, Value> {
    let mut mutations = HashMap::new();

    if let Some(items) = value["frameworkUpdates"]["entityBatchUpdate"]["mutations"].as_array() {
        for mutation in items {
            if let Some(key) = mutation["entityKey"].as_str() {
                mutations.insert(key.to_string(), mutation["payload"].clone());
            }
        }
    }

    mutations
}

fn comment_reply_token(replies_renderer: Option<&Value>) -> Option<String> {
    replies_renderer
        .and_then(|renderer| renderer["contents"].as_array())
        .and_then(|contents| {
            contents.iter().find_map(|content| {
                content["continuationItemRenderer"]["continuationEndpoint"]["continuationCommand"]
                    ["token"]
                    .as_str()
                    .map(ToOwned::to_owned)
            })
        })
}

fn build_comment_from_view_model(
    view_model: &Value,
    replies_renderer: Option<&Value>,
    mutation_payloads: &HashMap<String, Value>,
    own_video_id: Option<&str>,
    pinned: bool,
) -> Option<Comment> {
    let comment_key = view_model["commentKey"].as_str().unwrap_or_default();
    let toolbar_key = view_model["toolbarStateKey"].as_str().unwrap_or_default();

    let entity_payload = mutation_payloads
        .get(comment_key)
        .and_then(|payload| payload.get("commentEntityPayload"))?;

    let toolbar_state = mutation_payloads
        .get(toolbar_key)
        .and_then(|payload| payload.get("engagementToolbarStateEntityPayload"));

    let properties = &entity_payload["properties"];
    let author = &entity_payload["author"];
    let toolbar = &entity_payload["toolbar"];

    let id = properties["commentId"]
        .as_str()
        .or_else(|| view_model["commentId"].as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return None;
    }

    let text = text_of(&properties["content"]).unwrap_or_default();
    // The avatar moved: current responses carry it as a plain string on the
    // author and drop the `avatar` object entirely. Both shapes are read so a
    // response of either vintage still renders a picture.
    let author_thumbnail = author["avatarThumbnailUrl"]
        .as_str()
        .map(normalize_youtube_image_url)
        .or_else(|| thumbnail_url_from_array(&entity_payload["avatar"]["image"]["sources"]));

    let reply_count = toolbar["replyCount"]
        .as_str()
        .and_then(parse_count)
        .or_else(|| toolbar["replyCount"].as_u64());

    let like_count = toolbar["likeCountNotliked"].as_str().and_then(parse_count);

    let continuation_token = comment_reply_token(replies_renderer);

    let author_channel_id = author["channelId"]
        .as_str()
        .or_else(|| author["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        .map(|s| s.to_string());

    let pinned_text =
        text_of(&view_model["pinnedText"]).or_else(|| text_of(&properties["pinnedText"]));
    let flag = |key: &str| author[key].as_bool().unwrap_or(false);
    let (creator_reply_thumbnail, creator_reply_name) = creator_reply(replies_renderer);
    let image = view_model["commentSurfaceKey"]
        .as_str()
        .and_then(|key| mutation_payloads.get(key))
        .and_then(|payload| {
            comment_image(&payload["commentSurfaceEntityPayload"]["imageAttachmentViewModel"])
        });

    Some(Comment {
        id,
        author: author["displayName"]
            .as_str()
            .unwrap_or("Anonymous")
            .to_string(),
        author_thumbnail,
        author_channel_id,
        text,
        published_text: properties["publishedTime"].as_str().map(ToOwned::to_owned),
        like_count,
        like_count_text: toolbar["likeCountNotliked"]
            .as_str()
            .filter(|count| !count.trim().is_empty())
            .map(ToOwned::to_owned),
        reply_count,
        continuation_token,
        rich_text: rich_text(&properties["content"], own_video_id).filter(|rich| {
            !rich.spans.is_empty() || !rich.emojis.is_empty() || !rich.styles.is_empty()
        }),
        is_pinned: pinned || pinned_text.is_some(),
        pinned_text,
        is_hearted: toolbar_state.is_some_and(|state| state["heartState"] == HEARTED),
        hearted_by_text: toolbar["heartActiveTooltip"]
            .as_str()
            .map(ToOwned::to_owned),
        is_verified: flag("isVerified"),
        is_creator: flag("isCreator"),
        is_artist: flag("isArtist"),
        creator_heart_thumbnail: toolbar["creatorThumbnailUrl"]
            .as_str()
            .filter(|url| !url.trim().is_empty())
            .map(normalize_youtube_image_url),
        creator_reply_thumbnail,
        creator_reply_name,
        image,
        timed_at_ms: None,
    })
}

/// `YouTube`'s Timed list, in playback order, each comment with the time
/// `YouTube` shows it at. The order and the times come from the list's sync entity; the
/// comments are ordinary comment entities, found by their id.
fn parse_timed_comments(response: &Value, own_video_id: Option<&str>) -> Vec<Comment> {
    let mutations = build_comment_mutation_map(response);
    let key_by_id: HashMap<&str, &str> = mutations
        .iter()
        .filter_map(|(key, payload)| {
            let id = payload["commentEntityPayload"]["properties"]["commentId"].as_str()?;
            Some((id, key.as_str()))
        })
        .collect();
    let entries = mutations
        .values()
        .find_map(|payload| payload.get("timedMarkersListSyncEntity"))
        .and_then(|sync| sync["timedListData"]["sections"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|section| section["timedSyncDataList"].as_array())
        .flatten();
    let comments = entries
        .filter_map(|entry| {
            let id = entry["syncItemId"]
                .as_str()
                .filter(|id| *id != TIMED_WELCOME_ID)?;
            let at_ms = entry["videoTimeMs"]
                .as_str()
                .and_then(|ms| ms.parse().ok())
                .or_else(|| entry["videoTimeMs"].as_u64())?;
            let view_model = serde_json::json!({ "commentKey": key_by_id.get(id)? });
            let mut comment =
                build_comment_from_view_model(&view_model, None, &mutations, own_video_id, false)?;
            comment.timed_at_ms = Some(at_ms);
            Some(comment)
        })
        .collect();
    dedupe_comments(comments)
}

fn dedupe_comments(comments: Vec<Comment>) -> Vec<Comment> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for comment in comments {
        if seen.insert(comment.id.clone()) {
            deduped.push(comment);
        }
    }

    deduped
}

impl InnertubeClient {
    pub async fn get_comments(
        &self,
        video_id: &str,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() && page_token.is_none() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        debug!(video_id = %video_id_trimmed, has_page_token = page_token.is_some(), "[get_comments] Starting comments fetch");
        let own_video_id = Some(video_id_trimmed).filter(|id| !id.is_empty());

        // The first page's token is in the watch answer the details already
        // fetched; only later pages need a request of their own.
        let res = if let Some(ref token) = page_token {
            let mut payload = serde_json::json!({ "continuation": token });
            Arc::new(
                self.post_innertube("next", &clients::WEB, &mut payload)
                    .await?,
            )
        } else {
            self.watch_next(video_id_trimmed).await?
        };
        let mut comments_res = parse_comments_json(&res, own_video_id);

        debug!(
            video_id = %video_id_trimmed,
            comments_count = comments_res.comments.len(),
            has_next_token = comments_res.next_page_token.is_some(),
            "[get_comments] Initial parse result"
        );

        if page_token.is_none()
            && comments_res.comments.is_empty()
            && !comments_res.comments_disabled
        {
            let initial_count_text = comments_res.comment_count_text.clone();
            let continuation_token =
                find_initial_comments_token(&res).or_else(|| comments_res.next_page_token.clone());

            debug!(
                video_id = %video_id_trimmed,
                has_continuation = continuation_token.is_some(),
                "[get_comments] Will attempt second fetch for actual comments"
            );

            if let Some(token) = continuation_token {
                let mut next_payload = serde_json::json!({
                    "continuation": token
                });
                let next_res = self
                    .post_innertube("next", &clients::WEB, &mut next_payload)
                    .await?;
                comments_res = parse_comments_json(&next_res, own_video_id);
                if comments_res.comment_count_text.is_none() {
                    comments_res.comment_count_text = initial_count_text;
                }
                debug!(
                    video_id = %video_id_trimmed,
                    comments_count = comments_res.comments.len(),
                    "[get_comments] Second fetch result"
                );
            }
        }

        Ok(comments_res)
    }

    /// `YouTube`'s Timed list for the comment section `section_token` opens (its
    /// Newest order), in one IOS request. Only IOS serves it: ANDROID answers 400
    /// and WEB has no Timed filter. IOS never gets a `BotGuard` token.
    pub async fn get_timed_comments(
        &self,
        video_id: &str,
        section_token: &str,
    ) -> AppResult<Vec<Comment>> {
        let mut payload = serde_json::json!({
            "continuation": section_token,
            "formData": { "commentsFilterFormData": { "commentsFilter": { "sortBy": "SORT_BY_TIMED" } } },
        });
        let response = self
            .post_via(
                &self.client,
                Host::Www,
                "next",
                &clients::IOS,
                &mut payload,
                None,
                Some(TIMED_FIELDS),
            )
            .await?;
        let comments = parse_timed_comments(&response, Some(video_id.trim()));
        debug!(video_id = %video_id.trim(), count = comments.len(), "[get_timed_comments] YouTube's Timed list");
        Ok(comments)
    }

    pub async fn get_post_comments(
        &self,
        post_id: &str,
        params: Option<String>,
        page_token: Option<String>,
    ) -> AppResult<CommentsResponse> {
        let post_id_trimmed = post_id.trim();
        if post_id_trimmed.is_empty() && params.is_none() && page_token.is_none() {
            return Err(AppError::Validation("Post ID cannot be empty".into()));
        }

        let res = if let Some(ref token) = page_token {
            let mut payload = serde_json::json!({
                "continuation": token
            });
            self.post_innertube("browse", &clients::WEB, &mut payload)
                .await?
        } else {
            let mut payload = serde_json::json!({
                "browseId": "FEpost_detail",
            });
            if let Some(ref post_params) = params {
                payload["params"] = serde_json::json!(post_params);
            } else {
                payload["canonicalBaseUrl"] = serde_json::json!(format!("/post/{post_id_trimmed}"));
            }
            self.post_innertube("browse", &clients::WEB, &mut payload)
                .await?
        };

        let mut comments_res = parse_comments_json(&res, None);

        if page_token.is_none() && comments_res.comments.is_empty() {
            let initial = comments_res.clone();
            let continuation_token =
                find_initial_comments_token(&res).or_else(|| comments_res.next_page_token.clone());

            if let Some(token) = continuation_token {
                let mut next_payload = serde_json::json!({
                    "continuation": token
                });
                let next_res = self
                    .post_innertube("browse", &clients::WEB, &mut next_payload)
                    .await?;
                comments_res = parse_comments_json(&next_res, None);
                if comments_res.comment_count_text.is_none() {
                    comments_res.comment_count_text = initial.comment_count_text;
                }
                // The post's own page can hold the sort menu its first comments page leaves out.
                if comments_res.sort_options.is_empty() {
                    comments_res.sort_options = initial.sort_options;
                }
                if comments_res.total_count.is_none() {
                    comments_res.total_count = initial.total_count;
                }
            }
        }

        Ok(comments_res)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_comment_from_view_model, comment_image, parse_comments_json, parse_timed_comments,
    };
    use std::collections::HashMap;

    fn view_model() -> serde_json::Value {
        serde_json::json!({ "commentKey": "key-1", "toolbarStateKey": "toolbar-1" })
    }

    fn payloads(entity: serde_json::Value) -> HashMap<String, serde_json::Value> {
        HashMap::from([(
            "key-1".to_string(),
            serde_json::json!({ "commentEntityPayload": entity }),
        )])
    }

    #[test]
    fn reads_the_avatar_from_the_author_string() {
        let comment = build_comment_from_view_model(
            &view_model(),
            None,
            &payloads(serde_json::json!({
                "properties": { "commentId": "c1", "content": { "content": "hi" } },
                "author": {
                    "displayName": "Someone",
                    "channelId": "UC123",
                    "avatarThumbnailUrl": "https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj"
                }
            })),
            None,
            false,
        )
        .expect("comment");

        assert_eq!(
            comment.author_thumbnail.as_deref(),
            Some("https://yt3.ggpht.com/abc=s512")
        );
    }

    #[test]
    fn still_reads_the_avatar_from_the_older_sources_array() {
        let comment = build_comment_from_view_model(
            &view_model(),
            None,
            &payloads(serde_json::json!({
                "properties": { "commentId": "c1", "content": { "content": "hi" } },
                "author": { "displayName": "Someone" },
                "avatar": { "image": { "sources": [{ "url": "https://yt3.ggpht.com/legacy=s48" }] } }
            })),
            None,
            false,
        )
        .expect("comment");

        assert_eq!(
            comment.author_thumbnail.as_deref(),
            Some("https://yt3.ggpht.com/legacy=s512")
        );
    }

    #[test]
    fn legacy_comment_renderer_takes_the_largest_thumbnail() {
        let response = serde_json::json!({
            "contents": { "twoColumnWatchNextResults": { "results": { "results": { "contents": [
                { "commentThreadRenderer": { "comment": { "commentRenderer": {
                    "commentId": "c2",
                    "authorText": { "simpleText": "Someone" },
                    "contentText": { "runs": [{ "text": "hi" }] },
                    "authorThumbnail": { "thumbnails": [
                        { "url": "https://yt3.ggpht.com/small=s48" },
                        { "url": "https://yt3.ggpht.com/large=s176" }
                    ]}
                }}}}
            ]}}}}
        });

        let parsed = parse_comments_json(&response, None);
        assert_eq!(parsed.comments.len(), 1);
        assert_eq!(
            parsed.comments[0].author_thumbnail.as_deref(),
            Some("https://yt3.ggpht.com/large=s512")
        );
    }

    #[test]
    fn a_pinned_hearted_creator_comment_keeps_its_flags_and_links() {
        let mut mutations = payloads(serde_json::json!({
            "properties": {
                "commentId": "c3",
                "content": { "content": "see 1:05", "commandRuns": [{
                    "startIndex": 4, "length": 4,
                    "onTap": { "innertubeCommand": { "watchEndpoint": { "videoId": "own00000000", "startTimeSeconds": 65 } } }
                }] }
            },
            "author": { "displayName": "@Creator", "isCreator": true, "isVerified": true },
            "toolbar": { "likeCountNotliked": "26K", "heartActiveTooltip": "❤ by @Creator" }
        }));
        mutations.insert(
            "toolbar-1".to_string(),
            serde_json::json!({ "engagementToolbarStateEntityPayload": { "heartState": "TOOLBAR_HEART_STATE_HEARTED" } }),
        );
        let comment = build_comment_from_view_model(
            &view_model(),
            None,
            &mutations,
            Some("own00000000"),
            true,
        )
        .expect("comment");
        assert!(
            comment.is_pinned && comment.is_hearted && comment.is_creator && comment.is_verified
        );
        assert_eq!(comment.hearted_by_text.as_deref(), Some("❤ by @Creator"));
        assert_eq!(comment.like_count_text.as_deref(), Some("26K"));
        let rich = comment.rich_text.expect("rich text");
        assert_eq!(rich.spans.len(), 1);
    }

    #[test]
    fn the_header_gives_the_sort_options_and_exact_count() {
        let response = serde_json::json!({ "onResponseReceivedEndpoints": [{
            "reloadContinuationItemsCommand": { "continuationItems": [{ "commentsHeaderRenderer": {
                "countText": { "runs": [{ "text": "2,460,273" }, { "text": " Comments" }] },
                "sortMenu": { "sortFilterSubMenuRenderer": { "subMenuItems": [
                    { "title": "Top", "selected": true, "serviceEndpoint": { "continuationCommand": { "token": "TOP" } } },
                    { "title": "Newest", "selected": false, "serviceEndpoint": { "continuationCommand": { "token": "NEW" } } }
                ] } }
            } }] }
        }] });
        let parsed = parse_comments_json(&response, None);
        assert_eq!(parsed.total_count, Some(2_460_273));
        assert_eq!(parsed.sort_options.len(), 2);
        assert_eq!(parsed.sort_options[1].token, "NEW");
        assert!(parsed.sort_options[0].selected);
    }

    #[test]
    fn reads_the_creator_avatars_the_gif_and_style_only_text() {
        let view_model = serde_json::json!({
            "commentKey": "key-1", "toolbarStateKey": "toolbar-1", "commentSurfaceKey": "surface-1"
        });
        let mut mutations = payloads(serde_json::json!({
            "properties": { "commentId": "c4", "content": {
                "content": "loud", "styleRuns": [{ "startIndex": 0, "length": 4, "weightLabel": "FONT_WEIGHT_BOLD" }]
            } },
            "author": { "displayName": "@fan" },
            "toolbar": { "creatorThumbnailUrl": "//yt3.ggpht.com/creator=s48-c-k-c0x00ffffff-no-rj" }
        }));
        mutations.insert(
            "surface-1".to_string(),
            serde_json::json!({ "commentSurfaceEntityPayload": { "imageAttachmentViewModel": {
                "commentImageAttachmentViewModel": {
                    "image": { "sources": [{ "url": "https://yt3.ggpht.com/gif", "width": 220, "height": 124 }] },
                    "width": 220, "height": 124
                }
            } } }),
        );
        let replies = serde_json::json!({ "viewRepliesCreatorThumbnail": {
            "thumbnails": [{ "url": "https://yt3.ggpht.com/creator=s88-c-k-c0x00ffffff-no-rj", "width": 88, "height": 88 }],
            "accessibility": { "accessibilityData": { "label": "Ridgeline Audio" } }
        } });
        let comment =
            build_comment_from_view_model(&view_model, Some(&replies), &mutations, None, false)
                .expect("comment");
        assert!(
            comment
                .creator_heart_thumbnail
                .as_deref()
                .is_some_and(|url| url.starts_with("https://yt3.ggpht.com/creator"))
        );
        assert!(comment.creator_reply_thumbnail.is_some());
        assert_eq!(
            comment.creator_reply_name.as_deref(),
            Some("Ridgeline Audio")
        );
        let image = comment.image.expect("gif");
        assert_eq!((image.width, image.height), (220, 124));
        assert_eq!(
            comment
                .rich_text
                .expect("styles keep the rich text")
                .styles
                .len(),
            1
        );
    }

    #[test]
    fn the_timed_list_gives_comments_in_its_order_with_their_times() {
        let entity = |id: &str, text: &str| {
            serde_json::json!({ "commentEntityPayload": {
                "properties": { "commentId": id, "content": { "content": text } },
                "author": { "displayName": "@someone" }
            } })
        };
        let response = serde_json::json!({ "frameworkUpdates": { "entityBatchUpdate": { "mutations": [
            { "entityKey": "k-late", "payload": entity("late", "the drop") },
            { "entityKey": "k-early", "payload": entity("early", "intro") },
            { "entityKey": "list", "payload": { "timedMarkersListSyncEntity": { "timedListData": { "sections": [
                { "timedSyncDataList": [
                    { "syncItemId": "timed_comments_welcome_sync_id", "videoTimeMs": "0" },
                    { "syncItemId": "early", "videoTimeMs": "12000" },
                    { "syncItemId": "late", "videoTimeMs": "95000" },
                    { "syncItemId": "missing", "videoTimeMs": "99000" }
                ] }
            ] } } } }
        ] } } });
        let comments = parse_timed_comments(&response, Some("own00000000"));
        let order: Vec<(&str, Option<u64>)> = comments
            .iter()
            .map(|c| (c.id.as_str(), c.timed_at_ms))
            .collect();
        assert_eq!(order, [("early", Some(12_000)), ("late", Some(95_000))]);
        assert!(comments.iter().all(|c| c.continuation_token.is_none()));
    }

    #[test]
    fn a_gif_without_a_size_is_dropped() {
        let attachment = serde_json::json!({ "commentImageAttachmentViewModel": {
            "image": { "sources": [{ "url": "https://yt3.ggpht.com/gif" }] }, "width": 0, "height": 124
        } });
        assert!(comment_image(&attachment).is_none());
    }

    #[test]
    fn a_post_page_gives_the_sort_options_from_inside_its_section() {
        let response = serde_json::json!({ "contents": { "twoColumnBrowseResultsRenderer": { "tabs": [{
            "tabRenderer": { "content": { "sectionListRenderer": { "contents": [{ "itemSectionRenderer": {
                "header": { "commentsHeaderRenderer": {
                    "sortMenu": { "sortFilterSubMenuRenderer": { "subMenuItems": [
                        { "title": "Top", "selected": true, "serviceEndpoint": { "continuationCommand": { "token": "TOP" } } },
                        { "title": "Newest", "selected": false, "serviceEndpoint": { "continuationCommand": { "token": "NEW" } } }
                    ] } }
                } }
            } }] } } }
        }] } } });
        let parsed = parse_comments_json(&response, None);
        assert_eq!(parsed.sort_options.len(), 2);
        assert_eq!(parsed.sort_options[0].token, "TOP");
    }

    #[test]
    fn turned_off_comments_are_reported() {
        let response = serde_json::json!({ "contents": { "twoColumnWatchNextResults": { "results": { "results": {
            "contents": [{ "itemSectionRenderer": {
                "sectionIdentifier": "comment-item-section",
                "contents": [{ "messageRenderer": { "text": { "runs": [{ "text": "Comments are turned off. " }] } } }]
            } }]
        } } } } });
        assert!(parse_comments_json(&response, None).comments_disabled);
    }

    #[test]
    fn show_more_replies_button_hands_out_the_next_token() {
        let response = serde_json::json!({ "onResponseReceivedEndpoints": [{
            "appendContinuationItemsAction": { "continuationItems": [
                { "continuationItemRenderer": { "button": { "buttonRenderer": {
                    "command": { "continuationCommand": { "token": "MORE_REPLIES" } }
                } } } }
            ] }
        }] });
        let parsed = parse_comments_json(&response, None);
        assert_eq!(parsed.next_page_token.as_deref(), Some("MORE_REPLIES"));
    }
}
