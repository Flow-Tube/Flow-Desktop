use serde_json::Value;
use std::collections::HashMap;
use tracing::debug;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    extract_text_from_value, normalize_youtube_image_url, parse_mixed_number_word_to_long,
    thumbnail_url_from_array,
};
use crate::errors::{AppError, AppResult};
use crate::models::comment::{Comment, CommentsResponse};

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

fn parse_comments_json(val: &Value) -> CommentsResponse {
    let mut comments = Vec::new();
    let mut next_page_token = None;
    let mutation_payloads = build_comment_mutation_map(val);

    collect_comments_from_value(
        &val["onResponseReceivedEndpoints"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
    );
    collect_comments_from_value(
        &val["onResponseReceivedActions"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
    );
    collect_comments_from_value(
        &val["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
    );
    collect_comments_from_value(
        &val["engagementPanels"],
        &mut comments,
        &mut next_page_token,
        &mutation_payloads,
    );

    if comments.is_empty() || next_page_token.is_none() {
        collect_comments_from_value(val, &mut comments, &mut next_page_token, &mutation_payloads);
    }

    comments = dedupe_comments(comments);

    let comment_count_text = find_comment_count_text(val);

    CommentsResponse {
        comments,
        next_page_token,
        comment_count_text,
    }
}

fn find_first_comments_continuation(value: &Value) -> Option<String> {
    if let Some(renderer) = value.get("continuationItemRenderer") {
        if let Some(token) =
            renderer["continuationEndpoint"]["continuationCommand"]["token"].as_str()
        {
            return Some(token.to_string());
        }
        if let Some(token) =
            renderer["button"]["buttonRenderer"]["command"]["continuationCommand"]["token"].as_str()
        {
            return Some(token.to_string());
        }
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
) {
    if let Some(thread) = value.get("commentThreadRenderer") {
        if let Some(view_model) = thread["commentViewModel"]["commentViewModel"]
            .as_object()
            .map(|_| &thread["commentViewModel"]["commentViewModel"])
            .or_else(|| thread.get("commentViewModel"))
        {
            if let Some(comment) = build_comment_from_view_model(
                view_model,
                thread
                    .get("replies")
                    .and_then(|r| r.get("commentRepliesRenderer")),
                mutation_payloads,
            ) {
                comments.push(comment);
            }
            return;
        }

        let renderer = &thread["comment"]["commentRenderer"];
        if !renderer.is_null() {
            let id = renderer["commentId"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if !id.is_empty() {
                let author = renderer["authorText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| renderer["authorText"]["simpleText"].as_str())
                    .unwrap_or("Anonymous")
                    .to_string();

                let author_thumbnail =
                    thumbnail_url_from_array(&renderer["authorThumbnail"]["thumbnails"]);

                let mut text = String::new();
                if let Some(runs) = renderer["contentText"]["runs"].as_array() {
                    for run in runs {
                        if let Some(run_text) = run["text"].as_str() {
                            text.push_str(run_text);
                        }
                    }
                } else if let Some(simple) = renderer["contentText"]["simpleText"].as_str() {
                    text = simple.to_string();
                }

                let published_text = renderer["publishedTimeText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| renderer["publishedTimeText"]["simpleText"].as_str())
                    .map(|s| s.to_string());

                let like_count = renderer["voteCount"]["simpleText"]
                    .as_str()
                    .map(parse_mixed_number_word_to_long);

                let reply_count = renderer["replyCount"].as_u64();

                let reply_token = thread["replies"]["commentRepliesRenderer"]["contents"][0]
                    ["continuationItemRenderer"]["continuationEndpoint"]["continuationCommand"]
                    ["token"]
                    .as_str()
                    .map(|s| s.to_string());

                let author_channel_id = renderer["authorEndpoint"]["browseEndpoint"]["browseId"]
                    .as_str()
                    .map(|s| s.to_string());

                comments.push(Comment {
                    id,
                    author,
                    author_thumbnail,
                    author_channel_id,
                    text,
                    published_text,
                    like_count,
                    reply_count,
                    continuation_token: reply_token,
                });
            }
        }
        return;
    }

    if let Some(view_model) = value.get("commentViewModel") {
        if let Some(comment) = build_comment_from_view_model(view_model, None, mutation_payloads) {
            comments.push(comment);
        }
        return;
    }

    if let Some(renderer) = value.get("commentRenderer") {
        let id = renderer["commentId"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if !id.is_empty() {
            let author = renderer["authorText"]["runs"][0]["text"]
                .as_str()
                .or_else(|| renderer["authorText"]["simpleText"].as_str())
                .unwrap_or("Anonymous")
                .to_string();

            let author_thumbnail =
                thumbnail_url_from_array(&renderer["authorThumbnail"]["thumbnails"]);

            let mut text = String::new();
            if let Some(runs) = renderer["contentText"]["runs"].as_array() {
                for run in runs {
                    if let Some(run_text) = run["text"].as_str() {
                        text.push_str(run_text);
                    }
                }
            } else if let Some(simple) = renderer["contentText"]["simpleText"].as_str() {
                text = simple.to_string();
            }

            let published_text = renderer["publishedTimeText"]["runs"][0]["text"]
                .as_str()
                .or_else(|| renderer["publishedTimeText"]["simpleText"].as_str())
                .map(|s| s.to_string());

            let like_count = renderer["voteCount"]["simpleText"]
                .as_str()
                .map(parse_mixed_number_word_to_long);

            let author_channel_id = renderer["authorEndpoint"]["browseEndpoint"]["browseId"]
                .as_str()
                .map(|s| s.to_string());

            comments.push(Comment {
                id,
                author,
                author_thumbnail,
                author_channel_id,
                text,
                published_text,
                like_count,
                reply_count: None,
                continuation_token: None,
            });
        }
        return;
    }

    if next_page_token.is_none() {
        if let Some(renderer) = value.get("continuationItemRenderer") {
            if let Some(token) =
                renderer["continuationEndpoint"]["continuationCommand"]["token"].as_str()
            {
                *next_page_token = Some(token.to_string());
            }
        }
    }

    if let Some(array) = value.as_array() {
        for item in array {
            collect_comments_from_value(item, comments, next_page_token, mutation_payloads);
        }
        return;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            collect_comments_from_value(child, comments, next_page_token, mutation_payloads);
        }
    }
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
) -> Option<Comment> {
    let comment_key = view_model["commentKey"].as_str().unwrap_or_default();
    let toolbar_key = view_model["toolbarStateKey"].as_str().unwrap_or_default();

    let entity_payload = mutation_payloads
        .get(comment_key)
        .and_then(|payload| payload.get("commentEntityPayload"))?;

    let _toolbar_state = mutation_payloads
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

    let text = extract_text_from_value(&properties["content"]).unwrap_or_default();
    // The avatar moved: current responses carry it as a plain string on the
    // author and drop the `avatar` object entirely. Both shapes are read so a
    // response of either vintage still renders a picture.
    let author_thumbnail = author["avatarThumbnailUrl"]
        .as_str()
        .map(normalize_youtube_image_url)
        .or_else(|| thumbnail_url_from_array(&entity_payload["avatar"]["image"]["sources"]));

    let reply_count = toolbar["replyCount"]
        .as_str()
        .map(parse_mixed_number_word_to_long)
        .or_else(|| toolbar["replyCount"].as_u64());

    let like_count = toolbar["likeCountNotliked"]
        .as_str()
        .map(parse_mixed_number_word_to_long);

    let continuation_token = comment_reply_token(replies_renderer);

    let author_channel_id = author["channelId"]
        .as_str()
        .or_else(|| author["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        .map(|s| s.to_string());

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
        reply_count,
        continuation_token,
    })
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

        let mut payload = if let Some(ref token) = page_token {
            serde_json::json!({
                "continuation": token
            })
        } else {
            serde_json::json!({
                "videoId": video_id_trimmed
            })
        };

        debug!(video_id = %video_id_trimmed, has_page_token = page_token.is_some(), "[get_comments] Starting comments fetch");

        let res = self
            .post_innertube("next", &clients::WEB, &mut payload)
            .await?;
        let mut comments_res = parse_comments_json(&res);

        debug!(
            video_id = %video_id_trimmed,
            comments_count = comments_res.comments.len(),
            has_next_token = comments_res.next_page_token.is_some(),
            "[get_comments] Initial parse result"
        );

        if page_token.is_none() && comments_res.comments.is_empty() {
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
                comments_res = parse_comments_json(&next_res);
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

        let mut comments_res = parse_comments_json(&res);

        if page_token.is_none() && comments_res.comments.is_empty() {
            let initial_count_text = comments_res.comment_count_text.clone();
            let continuation_token =
                find_initial_comments_token(&res).or_else(|| comments_res.next_page_token.clone());

            if let Some(token) = continuation_token {
                let mut next_payload = serde_json::json!({
                    "continuation": token
                });
                let next_res = self
                    .post_innertube("browse", &clients::WEB, &mut next_payload)
                    .await?;
                comments_res = parse_comments_json(&next_res);
                if comments_res.comment_count_text.is_none() {
                    comments_res.comment_count_text = initial_count_text;
                }
            }
        }

        Ok(comments_res)
    }
}

#[cfg(test)]
mod tests {
    use super::{build_comment_from_view_model, parse_comments_json};
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

        let parsed = parse_comments_json(&response);
        assert_eq!(parsed.comments.len(), 1);
        assert_eq!(
            parsed.comments[0].author_thumbnail.as_deref(),
            Some("https://yt3.ggpht.com/large=s512")
        );
    }
}
