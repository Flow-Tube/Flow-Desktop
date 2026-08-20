use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    detect_lockup_is_live, detect_video_is_live, extract_channel_id_from_video_renderer,
    normalize_youtube_image_url, parse_duration_seconds, parse_mixed_number_word_to_long,
};
use crate::errors::{AppError, AppResult};
use crate::models::channel::{
    ChannelDetails, ChannelItem, ChannelTabResponse, PlaylistSummary, PostSummary,
    ShortVideoSummary,
};
use crate::models::video::VideoSummary;
use serde_json::Value;
use tracing::debug;

fn normalize_large_google_image_url(url: &str) -> String {
    if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    }
}

fn thumbnail_area(thumbnail: &Value) -> u64 {
    let width = thumbnail.get("width").and_then(Value::as_u64).unwrap_or(0);
    let height = thumbnail.get("height").and_then(Value::as_u64).unwrap_or(0);
    width.saturating_mul(height)
}

fn best_thumbnail_url(thumbnails: &Value) -> Option<String> {
    thumbnails.as_array().and_then(|arr| {
        arr.iter()
            .max_by_key(|thumb| thumbnail_area(thumb))
            .and_then(|thumb| thumb.get("url").or_else(|| thumb.get("uri")))
            .and_then(Value::as_str)
            .map(normalize_large_google_image_url)
    })
}

fn text_from_text_runs(value: &Value) -> Option<String> {
    value
        .get("runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.is_empty())
        .or_else(|| {
            value
                .get("simpleText")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

fn post_comment_count_text(post: &Value) -> Option<String> {
    let reply_button =
        &post["actionButtons"]["commentActionButtonsRenderer"]["replyButton"]["buttonRenderer"];
    reply_button
        .get("text")
        .and_then(text_from_text_runs)
        .or_else(|| {
            reply_button
                .get("accessibility")
                .and_then(|a| a.get("label"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            reply_button
                .get("accessibilityData")
                .and_then(|a| a.get("accessibilityData"))
                .and_then(|a| a.get("label"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

fn post_comment_endpoint_params(post: &Value) -> Option<String> {
    let endpoint = &post["actionButtons"]["commentActionButtonsRenderer"]["replyButton"]["buttonRenderer"]
        ["navigationEndpoint"];
    endpoint["browseEndpoint"]["params"]
        .as_str()
        .or_else(|| endpoint["signInEndpoint"]["nextEndpoint"]["browseEndpoint"]["params"].as_str())
        .map(ToOwned::to_owned)
}

fn post_image_attachment_url(post: &Value) -> Option<String> {
    let attachment = post.get("backstageAttachment")?;

    attachment
        .get("backstageImageRenderer")
        .and_then(|renderer| renderer.get("image"))
        .and_then(|image| image.get("thumbnails"))
        .and_then(best_thumbnail_url)
        .or_else(|| {
            attachment
                .get("postMultiImageRenderer")
                .and_then(|renderer| renderer.get("images"))
                .and_then(Value::as_array)
                .and_then(|images| images.first())
                .and_then(|image| image.get("backstageImageRenderer"))
                .and_then(|renderer| renderer.get("image"))
                .and_then(|image| image.get("thumbnails"))
                .and_then(best_thumbnail_url)
        })
}

fn extract_videos_from_browse(
    val: &Value,
) -> (
    Vec<ChannelItem>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let mut items = Vec::new();
    let mut next_page_token = None;

    let top_channel_id = val
        .get("metadata")
        .and_then(|m| m.get("channelMetadataRenderer"))
        .and_then(|c| c.get("externalId").or_else(|| c.get("externalChannelId")))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string());

    let top_channel_name = val
        .get("header")
        .and_then(|h| h.get("pageHeaderRenderer"))
        .and_then(|p| p.get("content"))
        .and_then(|c| c.get("pageHeaderViewModel"))
        .and_then(|ph| ph.get("title"))
        .and_then(|t| t.get("dynamicTextViewModel"))
        .and_then(|d| d.get("text"))
        .and_then(|t| t.get("content"))
        .and_then(|s| s.as_str())
        .or_else(|| {
            val.get("metadata")
                .and_then(|m| m.get("channelMetadataRenderer"))
                .and_then(|c| c.get("title"))
                .and_then(|s| s.as_str())
        })
        .unwrap_or("Unknown Channel")
        .to_string();

    let mut process_array = |arr: &Vec<Value>| -> Option<String> {
        let mut token_found = None;
        for item in arr {
            let mut target = item;
            if let Some(content) = item.get("richItemRenderer").and_then(|r| r.get("content")) {
                target = content;
            }

            if let Some(video) = target
                .get("gridVideoRenderer")
                .or_else(|| target.get("videoRenderer"))
            {
                if let Some(video_id) = video.get("videoId").and_then(|v| v.as_str()) {
                    let title = video
                        .get("title")
                        .and_then(|t| {
                            t.get("runs")
                                .and_then(|r| r.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                                .or_else(|| t.get("simpleText").and_then(|s| s.as_str()))
                        })
                        .unwrap_or_default()
                        .to_string();

                    let channel_name = video
                        .get("shortBylineText")
                        .and_then(|b| {
                            b.get("runs")
                                .and_then(|r| r.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                        })
                        .or_else(|| {
                            video.get("longBylineText").and_then(|b| {
                                b.get("runs")
                                    .and_then(|r| r.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|f| f.get("text"))
                                    .and_then(|s| s.as_str())
                            })
                        })
                        .unwrap_or_default()
                        .to_string();

                    let thumbnail_url = video
                        .get("thumbnail")
                        .and_then(|th| {
                            th.get("thumbnails")
                                .and_then(|t| t.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|f| f.get("url"))
                                .and_then(|s| s.as_str())
                        })
                        .map(|s| s.to_string());

                    let duration_text = video
                        .get("thumbnailOverlays")
                        .and_then(|o| o.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("thumbnailOverlayTimeStatusRenderer"))
                        .and_then(|t| t.get("text"))
                        .and_then(|txt| {
                            txt.get("runs")
                                .and_then(|r| r.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                                .or_else(|| txt.get("simpleText").and_then(|s| s.as_str()))
                        })
                        .or_else(|| {
                            video.get("lengthText").and_then(|l| {
                                l.get("runs")
                                    .and_then(|r| r.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|f| f.get("text"))
                                    .and_then(|s| s.as_str())
                                    .or_else(|| l.get("simpleText").and_then(|s| s.as_str()))
                            })
                        })
                        .unwrap_or_default();

                    let duration_seconds = if duration_text.is_empty() {
                        None
                    } else {
                        Some(parse_duration_seconds(duration_text))
                    };

                    let published_text = video
                        .get("publishedTimeText")
                        .and_then(|p| {
                            p.get("simpleText").and_then(|s| s.as_str()).or_else(|| {
                                p.get("runs")
                                    .and_then(|r| r.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|f| f.get("text"))
                                    .and_then(|s| s.as_str())
                            })
                        })
                        .map(|s| s.to_string());

                    let view_count_text = video
                        .get("viewCountText")
                        .and_then(|v| {
                            v.get("simpleText").and_then(|s| s.as_str()).or_else(|| {
                                v.get("runs")
                                    .and_then(|r| r.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|f| f.get("text"))
                                    .and_then(|s| s.as_str())
                            })
                        })
                        .map(|s| s.to_string());

                    let channel_id = extract_channel_id_from_video_renderer(video);

                    items.push(ChannelItem::Video(VideoSummary {
                        id: video_id.to_string(),
                        title,
                        channel_name: if channel_name.is_empty() {
                            top_channel_name.clone()
                        } else {
                            channel_name
                        },
                        channel_id: channel_id.or_else(|| top_channel_id.clone()),
                        thumbnail_url,
                        duration_seconds,
                        published_text,
                        view_count_text,
                        channel_avatar_url: None,
                        is_live: detect_video_is_live(video),
                    }));
                }
            } else if let Some(shorts_lockup) = target.get("shortsLockupViewModel") {
                let video_id = shorts_lockup
                    .get("onTap")
                    .and_then(|ot| ot.get("innertubeCommand"))
                    .and_then(|ic| ic.get("reelWatchEndpoint"))
                    .and_then(|rw| rw.get("videoId"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !video_id.is_empty() {
                    let title = shorts_lockup
                        .get("overlayMetadata")
                        .and_then(|om| om.get("primaryText"))
                        .and_then(|pt| pt.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let thumbnail_url = shorts_lockup
                        .get("thumbnailViewModel")
                        .and_then(|tv| tv.get("thumbnailViewModel"))
                        .and_then(|tvm| tvm.get("image"))
                        .and_then(|img| img.get("sources"))
                        .and_then(|s| s.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|src| src.get("url"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let view_count_text = shorts_lockup
                        .get("overlayMetadata")
                        .and_then(|om| om.get("secondaryText"))
                        .and_then(|st| st.get("content"))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string());
                    items.push(ChannelItem::Short(ShortVideoSummary {
                        id: video_id.to_string(),
                        title,
                        thumbnail_url,
                        view_count_text,
                    }));
                }
            } else if let Some(reel) = target.get("reelItemRenderer") {
                let video_id = reel
                    .get("videoId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !video_id.is_empty() {
                    let title = reel
                        .get("headline")
                        .and_then(|h| h.get("simpleText").and_then(|s| s.as_str()))
                        .unwrap_or_default()
                        .to_string();
                    let thumbnail_url = reel
                        .get("thumbnail")
                        .and_then(|th| {
                            th.get("thumbnails")
                                .and_then(|t| t.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|f| f.get("url"))
                                .and_then(|s| s.as_str())
                        })
                        .map(|s| s.to_string());
                    let view_count_text = reel
                        .get("viewCountText")
                        .and_then(|v| v.get("simpleText").and_then(|s| s.as_str()))
                        .map(|s| s.to_string());

                    items.push(ChannelItem::Short(ShortVideoSummary {
                        id: video_id.to_string(),
                        title,
                        thumbnail_url,
                        view_count_text,
                    }));
                }
            } else if let Some(playlist) = target
                .get("playlistRenderer")
                .or_else(|| target.get("gridPlaylistRenderer"))
            {
                let playlist_id = playlist
                    .get("playlistId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !playlist_id.is_empty() {
                    let title = playlist
                        .get("title")
                        .and_then(|t| {
                            t.get("runs")
                                .and_then(|r| r.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                                .or_else(|| t.get("simpleText").and_then(|s| s.as_str()))
                        })
                        .unwrap_or_default()
                        .to_string();
                    let thumbnail_url = playlist
                        .get("thumbnails")
                        .and_then(|th| th.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|f| f.get("thumbnails"))
                        .and_then(|t| t.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|f| f.get("url"))
                        .and_then(|s| s.as_str())
                        .or_else(|| {
                            playlist.get("thumbnail").and_then(|th| {
                                th.get("thumbnails")
                                    .and_then(|t| t.as_array())
                                    .and_then(|arr| arr.last())
                                    .and_then(|f| f.get("url"))
                                    .and_then(|s| s.as_str())
                            })
                        })
                        .map(|s| s.to_string());
                    let video_count_text = playlist
                        .get("videoCountText")
                        .and_then(|v| {
                            v.get("runs")
                                .and_then(|r| r.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                                .or_else(|| v.get("simpleText").and_then(|s| s.as_str()))
                        })
                        .map(|s| s.to_string());

                    items.push(ChannelItem::Playlist(PlaylistSummary {
                        id: playlist_id.to_string(),
                        title,
                        thumbnail_url,
                        video_count_text,
                    }));
                }
            } else if let Some(lockup) = target.get("lockupViewModel") {
                let content_id = lockup
                    .get("contentId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let content_type = lockup
                    .get("contentType")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if !content_id.is_empty() {
                    let title = lockup
                        .get("metadata")
                        .and_then(|m| m.get("lockupMetadataViewModel"))
                        .and_then(|lm| lm.get("title"))
                        .and_then(|t| t.get("content"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();

                    let channel_name = top_channel_name.clone();
                    let channel_id = top_channel_id.clone();

                    let thumbnail_view_model = lockup.get("contentImage").and_then(|ci| {
                        ci.get("thumbnailViewModel").or_else(|| {
                            ci.get("collectionThumbnailViewModel")
                                .and_then(|ctv| ctv.get("primaryThumbnail"))
                                .and_then(|pt| pt.get("thumbnailViewModel"))
                        })
                    });

                    let thumbnail_url = thumbnail_view_model
                        .and_then(|tv| tv.get("image"))
                        .and_then(|img| img.get("sources"))
                        .and_then(|s| s.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|src| src.get("url"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    if content_type == "LOCKUP_CONTENT_TYPE_PLAYLIST"
                        || content_type == "LOCKUP_CONTENT_TYPE_PODCAST"
                    {
                        let mut video_count_text = None;
                        if let Some(overlays) = thumbnail_view_model
                            .and_then(|tv| tv.get("overlays"))
                            .and_then(|o| o.as_array())
                        {
                            for overlay in overlays {
                                if let Some(bottom) = overlay.get("thumbnailBottomOverlayViewModel")
                                {
                                    if let Some(badges) =
                                        bottom.get("badges").and_then(|b| b.as_array())
                                    {
                                        if let Some(badge) = badges
                                            .first()
                                            .and_then(|b| b.get("thumbnailBadgeViewModel"))
                                        {
                                            if let Some(text) =
                                                badge.get("text").and_then(|t| t.as_str())
                                            {
                                                video_count_text = Some(text.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }
                                if let Some(badge_vm) =
                                    overlay.get("thumbnailOverlayBadgeViewModel")
                                {
                                    if let Some(badges) =
                                        badge_vm.get("thumbnailBadges").and_then(|b| b.as_array())
                                    {
                                        if let Some(badge) = badges
                                            .first()
                                            .and_then(|b| b.get("thumbnailBadgeViewModel"))
                                        {
                                            if let Some(text) =
                                                badge.get("text").and_then(|t| t.as_str())
                                            {
                                                video_count_text = Some(text.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        items.push(ChannelItem::Playlist(PlaylistSummary {
                            id: content_id.to_string(),
                            title,
                            thumbnail_url,
                            video_count_text,
                        }));
                    } else if content_type == "LOCKUP_CONTENT_TYPE_SHORT" {
                        items.push(ChannelItem::Short(ShortVideoSummary {
                            id: content_id.to_string(),
                            title,
                            thumbnail_url,
                            view_count_text: None,
                        }));
                    } else {
                        let mut duration_text = "";
                        let mut duration_seconds = None;
                        if let Some(overlays) = thumbnail_view_model
                            .and_then(|tv| tv.get("overlays"))
                            .and_then(|o| o.as_array())
                        {
                            for overlay in overlays {
                                if let Some(bottom) = overlay.get("thumbnailBottomOverlayViewModel")
                                {
                                    if let Some(badges) =
                                        bottom.get("badges").and_then(|b| b.as_array())
                                    {
                                        if let Some(badge) = badges
                                            .first()
                                            .and_then(|b| b.get("thumbnailBadgeViewModel"))
                                        {
                                            if let Some(text) =
                                                badge.get("text").and_then(|t| t.as_str())
                                            {
                                                duration_text = text;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if !duration_text.is_empty() {
                            duration_seconds = Some(parse_duration_seconds(duration_text));
                        }

                        let mut view_count_text = None;
                        let mut published_text = None;
                        if let Some(meta) = lockup
                            .get("metadata")
                            .and_then(|m| m.get("lockupMetadataViewModel"))
                            .and_then(|lm| lm.get("metadata"))
                            .and_then(|m| m.get("contentMetadataViewModel"))
                            .and_then(|cm| cm.get("metadataRows"))
                            .and_then(|r| r.as_array())
                        {
                            if let Some(row) = meta.first() {
                                if let Some(parts) =
                                    row.get("metadataParts").and_then(|p| p.as_array())
                                {
                                    if parts.len() >= 2 {
                                        if let Some(p0) = parts[0]
                                            .get("text")
                                            .and_then(|t| t.get("content"))
                                            .and_then(|c| c.as_str())
                                        {
                                            view_count_text = Some(p0.to_string());
                                        }
                                        if let Some(p1) = parts[1]
                                            .get("text")
                                            .and_then(|t| t.get("content"))
                                            .and_then(|c| c.as_str())
                                        {
                                            published_text = Some(p1.to_string());
                                        }
                                    } else if parts.len() == 1 {
                                        if let Some(p0) = parts[0]
                                            .get("text")
                                            .and_then(|t| t.get("content"))
                                            .and_then(|c| c.as_str())
                                        {
                                            if p0.contains("view") || p0.contains("watching") {
                                                view_count_text = Some(p0.to_string());
                                            } else {
                                                published_text = Some(p0.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        items.push(ChannelItem::Video(VideoSummary {
                            id: content_id.to_string(),
                            title,
                            channel_name,
                            channel_id,
                            thumbnail_url,
                            duration_seconds,
                            published_text,
                            view_count_text,
                            channel_avatar_url: None,
                            is_live: detect_lockup_is_live(lockup),
                        }));
                    }
                }
            } else if let Some(post) = target
                .get("backstagePostThreadRenderer")
                .and_then(|thread| thread.get("post"))
                .and_then(|post| post.get("backstagePostRenderer"))
                .or_else(|| target.get("postRenderer"))
            {
                let post_id = post
                    .get("postId")
                    .and_then(|p| p.as_str())
                    .unwrap_or_default()
                    .to_string();
                let author_name = post
                    .get("authorText")
                    .and_then(|a| {
                        a.get("runs")
                            .and_then(|r| r.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|f| f.get("text"))
                            .and_then(|s| s.as_str())
                    })
                    .unwrap_or_default()
                    .to_string();
                let author_avatar = post
                    .get("authorThumbnail")
                    .and_then(|t| {
                        t.get("thumbnails")
                            .and_then(|th| th.as_array())
                            .and_then(|arr| arr.last())
                            .and_then(|f| f.get("url"))
                            .and_then(|s| s.as_str())
                    })
                    .map(normalize_youtube_image_url)
                    .map(|s| s.to_string());
                let text_content = post.get("contentText").and_then(text_from_text_runs);
                let published_time_text = post
                    .get("publishedTimeText")
                    .and_then(|p| {
                        p.get("runs")
                            .and_then(|r| r.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|f| f.get("text"))
                            .and_then(|s| s.as_str())
                    })
                    .map(|s| s.to_string());
                let likes_count_text = post
                    .get("voteCount")
                    .and_then(|v| v.get("simpleText").and_then(|s| s.as_str()))
                    .map(|s| s.to_string());
                let comment_count_text = post_comment_count_text(post);
                let comment_endpoint_params = post_comment_endpoint_params(post);
                let image_attachment = post_image_attachment_url(post);

                items.push(ChannelItem::Post(PostSummary {
                    id: post_id,
                    author_name: if author_name.is_empty() {
                        top_channel_name.clone()
                    } else {
                        author_name
                    },
                    author_avatar,
                    text_content,
                    image_attachment,
                    likes_count_text,
                    comment_count_text,
                    comment_endpoint_params,
                    published_time_text,
                }));
            } else if let Some(cont) = target.get("continuationItemRenderer") {
                if let Some(token) = cont
                    .get("continuationEndpoint")
                    .and_then(|e| e.get("continuationCommand"))
                    .and_then(|c| c.get("token"))
                    .and_then(|t| t.as_str())
                {
                    token_found = Some(token.to_string());
                }
            }
        }
        token_found
    };

    if let Some(actions) = val
        .get("onResponseReceivedActions")
        .and_then(|v| v.as_array())
    {
        for action in actions {
            if let Some(items_arr) = action
                .get("appendContinuationItemsAction")
                .and_then(|a| a.get("continuationItems"))
                .and_then(|c| c.as_array())
            {
                if let Some(tok) = process_array(items_arr) {
                    next_page_token = Some(tok);
                }
            } else if let Some(items_arr) = action
                .get("reloadContinuationItemsCommand")
                .and_then(|r| r.get("continuationItems"))
                .and_then(|c| c.as_array())
            {
                if let Some(tok) = process_array(items_arr) {
                    next_page_token = Some(tok);
                }
            }
        }
    }

    if let Some(tabs) = val
        .get("contents")
        .and_then(|c| c.get("twoColumnBrowseResultsRenderer"))
        .and_then(|t| t.get("tabs"))
        .and_then(|t| t.as_array())
    {
        let mut target_content = None;

        // 1. Search selected tab containing search endpoint url
        for tab in tabs {
            if let Some(tr) = tab.get("tabRenderer") {
                let is_selected = tr
                    .get("selected")
                    .and_then(|s| s.as_bool())
                    .unwrap_or(false);
                let is_search_url = tr
                    .get("endpoint")
                    .and_then(|e| e.get("commandMetadata"))
                    .and_then(|m| m.get("webCommandMetadata"))
                    .and_then(|w| w.get("url"))
                    .and_then(|u| u.as_str())
                    .map(|u| u.contains("/search"))
                    .unwrap_or(false);
                if is_selected && is_search_url {
                    target_content = tr.get("content");
                    break;
                }
            }
        }

        // 2. Search expandable tab with content (used by YouTube for channel search results)
        if target_content.is_none() {
            for tab in tabs {
                if let Some(et) = tab.get("expandableTabRenderer") {
                    if let Some(c) = et.get("content") {
                        if !c.is_null() {
                            target_content = Some(c);
                            break;
                        }
                    }
                }
            }
        }

        // 3. Search selected tab (standard tabs like Home, Videos)
        if target_content.is_none() {
            for tab in tabs {
                if let Some(tr) = tab.get("tabRenderer") {
                    let is_selected = tr
                        .get("selected")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false);
                    if is_selected {
                        target_content = tr.get("content");
                        break;
                    }
                }
            }
        }

        if let Some(content) = target_content {
            if let Some(contents_arr) = content
                .get("richGridRenderer")
                .and_then(|r| r.get("contents"))
                .and_then(|c| c.as_array())
            {
                if let Some(tok) = process_array(contents_arr) {
                    next_page_token = Some(tok);
                }
            }

            if let Some(sections) = content
                .get("sectionListRenderer")
                .and_then(|s| s.get("contents"))
                .and_then(|c| c.as_array())
            {
                for section in sections {
                    if let Some(items_arr) = section
                        .get("itemSectionRenderer")
                        .and_then(|i| i.get("contents"))
                        .and_then(|c| c.as_array())
                    {
                        if let Some(tok) = process_array(items_arr) {
                            next_page_token = Some(tok);
                        }
                        for sub_item in items_arr {
                            if let Some(grid_items) = sub_item
                                .get("gridRenderer")
                                .and_then(|g| g.get("items"))
                                .and_then(|i| i.as_array())
                            {
                                if let Some(tok) = process_array(grid_items) {
                                    next_page_token = Some(tok);
                                }
                            }
                            if let Some(shelf_items) = sub_item
                                .get("shelfRenderer")
                                .and_then(|s| s.get("content"))
                                .and_then(|c| {
                                    c.get("horizontalListRenderer")
                                        .or_else(|| c.get("gridRenderer"))
                                })
                                .and_then(|hl| hl.get("items"))
                                .and_then(|i| i.as_array())
                            {
                                if let Some(tok) = process_array(shelf_items) {
                                    next_page_token = Some(tok);
                                }
                            }
                        }
                    } else if let Some(cont) = section.get("continuationItemRenderer") {
                        if let Some(token) = cont
                            .get("continuationEndpoint")
                            .and_then(|e| e.get("continuationCommand"))
                            .and_then(|c| c.get("token"))
                            .and_then(|t| t.as_str())
                        {
                            next_page_token = Some(token.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Some(continuation_contents) = val.get("continuationContents") {
        if let Some(section_list) = continuation_contents.get("sectionListContinuation") {
            if let Some(contents) = section_list.get("contents").and_then(|c| c.as_array()) {
                for item in contents {
                    if let Some(item_sec) = item.get("itemSectionRenderer") {
                        if let Some(sec_contents) =
                            item_sec.get("contents").and_then(|c| c.as_array())
                        {
                            if let Some(tok) = process_array(sec_contents) {
                                next_page_token = Some(tok);
                            }
                        }
                    }
                    if let Some(cont) = item.get("continuationItemRenderer") {
                        if let Some(token) = cont
                            .get("continuationEndpoint")
                            .and_then(|e| e.get("continuationCommand"))
                            .and_then(|c| c.get("token"))
                            .and_then(|t| t.as_str())
                        {
                            next_page_token = Some(token.to_string());
                        }
                    }
                }
            }
            if next_page_token.is_none() {
                if let Some(conts) = section_list.get("continuations").and_then(|c| c.as_array()) {
                    if let Some(first_cont) = conts.first() {
                        if let Some(token) = first_cont
                            .get("nextContinuationData")
                            .and_then(|n| n.get("continuation"))
                            .and_then(|t| t.as_str())
                        {
                            next_page_token = Some(token.to_string());
                        }
                    }
                }
            }
        }

        if let Some(rich_grid) = continuation_contents.get("richGridContinuation") {
            if let Some(contents) = rich_grid.get("contents").and_then(|c| c.as_array()) {
                if let Some(tok) = process_array(contents) {
                    next_page_token = Some(tok);
                }
            }
        }
    }

    let mut sort_latest_token = None;
    let mut sort_popular_token = None;
    let mut sort_oldest_token = None;

    if let Some(tabs) = val
        .get("contents")
        .and_then(|c| c.get("twoColumnBrowseResultsRenderer"))
        .and_then(|t| t.get("tabs"))
        .and_then(|t| t.as_array())
    {
        for tab in tabs {
            if let Some(tr) = tab.get("tabRenderer") {
                let is_selected = tr
                    .get("selected")
                    .and_then(|s| s.as_bool())
                    .unwrap_or(false);
                if is_selected {
                    if let Some(content) = tr.get("content") {
                        if let Some(chip_bar) = content
                            .get("richGridRenderer")
                            .and_then(|r| r.get("header"))
                            .and_then(|h| h.get("chipBarViewModel"))
                        {
                            if let Some(chips) = chip_bar.get("chips").and_then(|c| c.as_array()) {
                                for chip in chips {
                                    if let Some(vm) = chip.get("chipViewModel") {
                                        let tap = vm
                                            .get("tapCommand")
                                            .and_then(|t| t.get("innertubeCommand"));
                                        if let Some(tap_cmd) = tap {
                                            if let Some(show_sheet) =
                                                tap_cmd.get("showSheetCommand")
                                            {
                                                if let Some(list_items) = show_sheet
                                                    .get("panelLoadingStrategy")
                                                    .and_then(|p| p.get("inlineContent"))
                                                    .and_then(|i| i.get("sheetViewModel"))
                                                    .and_then(|s| s.get("content"))
                                                    .and_then(|c| c.get("listViewModel"))
                                                    .and_then(|l| l.get("listItems"))
                                                    .and_then(|i| i.as_array())
                                                {
                                                    for item in list_items {
                                                        if let Some(item_vm) =
                                                            item.get("listItemViewModel")
                                                        {
                                                            let title = item_vm
                                                                .get("title")
                                                                .and_then(|t| t.get("content"))
                                                                .and_then(|s| s.as_str())
                                                                .unwrap_or_default()
                                                                .to_lowercase();
                                                            let mut token = None;
                                                            let ontap = item_vm
                                                                .get("rendererContext")
                                                                .and_then(|r| {
                                                                    r.get("commandContext")
                                                                })
                                                                .and_then(|c| c.get("onTap"))
                                                                .and_then(|o| {
                                                                    o.get("innertubeCommand")
                                                                });
                                                            if let Some(ontap_cmd) = ontap {
                                                                if let Some(executor) = ontap_cmd
                                                                    .get("commandExecutorCommand")
                                                                {
                                                                    if let Some(cmds) = executor
                                                                        .get("commands")
                                                                        .and_then(|c| c.as_array())
                                                                    {
                                                                        for cmd in cmds {
                                                                            if let Some(cont) = cmd.get("continuationCommand") {
                                                                                if let Some(t) = cont.get("token").and_then(|s| s.as_str()) {
                                                                                    token = Some(t.to_string());
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                } else if let Some(cont) = ontap_cmd
                                                                    .get("continuationCommand")
                                                                {
                                                                    if let Some(t) = cont
                                                                        .get("token")
                                                                        .and_then(|s| s.as_str())
                                                                    {
                                                                        token = Some(t.to_string());
                                                                    }
                                                                }
                                                            }

                                                            if let Some(tok) = token {
                                                                if title.contains("popular") {
                                                                    sort_popular_token = Some(tok);
                                                                } else if title.contains("oldest") {
                                                                    sort_oldest_token = Some(tok);
                                                                } else if title.contains("latest")
                                                                    || title.contains("newest")
                                                                {
                                                                    sort_latest_token = Some(tok);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            } else if let Some(cont) =
                                                tap_cmd.get("continuationCommand")
                                            {
                                                if let Some(t) =
                                                    cont.get("token").and_then(|s| s.as_str())
                                                {
                                                    let text = vm
                                                        .get("text")
                                                        .and_then(|t| t.as_str())
                                                        .unwrap_or_default()
                                                        .to_lowercase();
                                                    if text.contains("popular") {
                                                        sort_popular_token = Some(t.to_string());
                                                    } else if text.contains("oldest") {
                                                        sort_oldest_token = Some(t.to_string());
                                                    } else if text.contains("latest")
                                                        || text.contains("newest")
                                                    {
                                                        sort_latest_token = Some(t.to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (
        items,
        next_page_token,
        sort_latest_token,
        sort_popular_token,
        sort_oldest_token,
    )
}

impl InnertubeClient {
    pub async fn get_channel_details(&self, channel_id: &str) -> AppResult<ChannelDetails> {
        let channel_id_trimmed = channel_id.trim();
        if channel_id_trimmed.is_empty() {
            return Err(AppError::Validation("Channel ID cannot be empty".into()));
        }

        debug!(channel_id = %channel_id_trimmed, "[get_channel_details] Starting channel details fetch");

        let mut payload = serde_json::json!({
            "browseId": channel_id_trimmed
        });

        let res = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;

        debug!(
            channel_id = %channel_id_trimmed,
            has_metadata = !res["metadata"]["channelMetadataRenderer"].is_null(),
            has_header = !res["header"].is_null(),
            "[get_channel_details] Browse response received"
        );

        let metadata = res
            .get("metadata")
            .and_then(|m| m.get("channelMetadataRenderer"))
            .unwrap_or(&Value::Null);
        let header = res.get("header").unwrap_or(&Value::Null);

        let id = metadata
            .get("externalChannelId")
            .or_else(|| metadata.get("externalId"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                res.get("responseContext")
                    .and_then(|rc| rc.get("serviceTrackingParams"))
                    .and_then(|s| s.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|first| first.get("params"))
                    .and_then(|p| p.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|first| first.get("value"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or(channel_id_trimmed)
            .to_string();

        let name = metadata
            .get("title")
            .and_then(|v| v.as_str())
            .or_else(|| {
                header
                    .get("c4TabbedHeaderRenderer")
                    .and_then(|c4| c4.get("title"))
                    .and_then(|v| v.as_str())
            })
            .or_else(|| {
                header
                    .get("pageHeaderRenderer")
                    .and_then(|ph| ph.get("content"))
                    .and_then(|c| c.get("pageHeaderViewModel"))
                    .and_then(|ph| ph.get("title"))
                    .and_then(|t| t.get("dynamicTextViewModel"))
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.get("content"))
                    .and_then(|s| s.as_str())
            })
            .unwrap_or("Unknown Channel")
            .to_string();

        let description = metadata
            .get("description")
            .and_then(|v| v.as_str())
            .or_else(|| {
                res.get("microformat")
                    .and_then(|m| m.get("microformatDataRenderer"))
                    .and_then(|md| md.get("description"))
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.to_string());

        let avatar_url = metadata
            .get("avatar")
            .and_then(|a| a.get("thumbnails"))
            .and_then(|t| t.as_array())
            .and_then(|arr| arr.last())
            .and_then(|first| first.get("url"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                header
                    .get("c4TabbedHeaderRenderer")
                    .and_then(|c4| c4.get("avatar"))
                    .and_then(|a| a.get("thumbnails"))
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|first| first.get("url"))
                    .and_then(|v| v.as_str())
            })
            .or_else(|| {
                header
                    .get("pageHeaderRenderer")
                    .and_then(|ph| ph.get("content"))
                    .and_then(|c| c.get("pageHeaderViewModel"))
                    .and_then(|ph| ph.get("image"))
                    .and_then(|img| img.get("decoratedAvatarViewModel"))
                    .and_then(|dav| dav.get("avatar"))
                    .and_then(|av| av.get("avatarViewModel"))
                    .and_then(|avm| avm.get("image"))
                    .and_then(|img| img.get("sources"))
                    .and_then(|s| s.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|first| first.get("url"))
                    .and_then(|v| v.as_str())
            })
            .map(normalize_youtube_image_url);

        let banner_url = header
            .get("c4TabbedHeaderRenderer")
            .and_then(|c4| c4.get("banner"))
            .and_then(|b| b.get("thumbnails"))
            .and_then(best_thumbnail_url)
            .or_else(|| {
                header
                    .get("pageHeaderRenderer")
                    .and_then(|ph| ph.get("content"))
                    .and_then(|c| c.get("pageHeaderViewModel"))
                    .and_then(|ph| ph.get("banner"))
                    .and_then(|b| b.get("imageBannerViewModel"))
                    .and_then(|ib| ib.get("image"))
                    .and_then(|img| img.get("sources"))
                    .and_then(best_thumbnail_url)
            })
            .map(|s| normalize_large_google_image_url(&s));

        let mut subscriber_count = None;
        let mut subscriber_count_text = None;

        if let Some(text) = header
            .get("c4TabbedHeaderRenderer")
            .and_then(|c4| c4.get("subscriberCountText"))
            .and_then(|s| s.get("simpleText"))
            .and_then(|v| v.as_str())
        {
            subscriber_count_text = Some(text.to_string());
            subscriber_count = Some(parse_mixed_number_word_to_long(text));
        } else if let Some(runs) = header
            .get("c4TabbedHeaderRenderer")
            .and_then(|c4| c4.get("subscriberCountText"))
            .and_then(|s| s.get("runs"))
            .and_then(|r| r.as_array())
        {
            if let Some(text) = runs
                .first()
                .and_then(|r| r.get("text"))
                .and_then(|v| v.as_str())
            {
                subscriber_count_text = Some(text.to_string());
                subscriber_count = Some(parse_mixed_number_word_to_long(text));
            }
        } else if let Some(rows) = header
            .get("pageHeaderRenderer")
            .and_then(|ph| ph.get("content"))
            .and_then(|c| c.get("pageHeaderViewModel"))
            .and_then(|ph| ph.get("metadata"))
            .and_then(|m| m.get("contentMetadataViewModel"))
            .and_then(|cm| cm.get("metadataRows"))
            .and_then(|r| r.as_array())
        {
            for row in rows {
                if let Some(parts) = row.get("metadataParts").and_then(|p| p.as_array()) {
                    for part in parts {
                        if let Some(text) = part
                            .get("text")
                            .and_then(|t| t.get("content"))
                            .and_then(|c| c.as_str())
                        {
                            if text.contains("subscriber") {
                                subscriber_count_text = Some(text.to_string());
                                subscriber_count = Some(parse_mixed_number_word_to_long(text));
                                break;
                            }
                        }
                    }
                }
            }
        }

        let mut verified = false;
        if let Some(badges) = header
            .get("c4TabbedHeaderRenderer")
            .and_then(|c4| c4.get("badges"))
            .and_then(|b| b.as_array())
        {
            for badge in badges {
                if let Some(style) = badge
                    .get("metadataBadgeRenderer")
                    .and_then(|m| m.get("style"))
                    .and_then(|s| s.as_str())
                {
                    if style == "BADGE_STYLE_TYPE_VERIFIED"
                        || style == "BADGE_STYLE_TYPE_VERIFIED_ARTIST"
                    {
                        verified = true;
                        break;
                    }
                }
            }
        }
        if !verified {
            if let Some(label) = header
                .get("pageHeaderRenderer")
                .and_then(|ph| ph.get("content"))
                .and_then(|c| c.get("pageHeaderViewModel"))
                .and_then(|ph| ph.get("title"))
                .and_then(|t| t.get("dynamicTextViewModel"))
                .and_then(|d| d.get("rendererContext"))
                .and_then(|rc| rc.get("accessibilityContext"))
                .and_then(|ac| ac.get("label"))
                .and_then(|v| v.as_str())
            {
                if label.contains("Verified") || label.contains("verified") {
                    verified = true;
                }
            }
        }

        let mut available_tabs = Vec::new();
        if let Some(tabs) = res
            .get("contents")
            .and_then(|c| c.get("twoColumnBrowseResultsRenderer"))
            .and_then(|t| t.get("tabs"))
            .and_then(|t| t.as_array())
        {
            for tab in tabs {
                if let Some(tab_renderer) = tab.get("tabRenderer") {
                    if let Some(title_val) = tab_renderer.get("title") {
                        let title_str = if let Some(s) = title_val.as_str() {
                            Some(s.to_string())
                        } else if let Some(simple) =
                            title_val.get("simpleText").and_then(|s| s.as_str())
                        {
                            Some(simple.to_string())
                        } else if let Some(runs) = title_val.get("runs").and_then(|r| r.as_array())
                        {
                            runs.first()
                                .and_then(|f| f.get("text"))
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        };
                        if let Some(t_str) = title_str {
                            available_tabs.push(t_str);
                        }
                    }
                }
            }
        }

        Ok(ChannelDetails {
            id,
            name,
            description,
            avatar_url,
            banner_url,
            subscriber_count,
            subscriber_count_text,
            verified,
            available_tabs,
        })
    }

    pub async fn get_channel_tab(
        &self,
        channel_id: &str,
        params: Option<String>,
        page_token: Option<String>,
        query: Option<String>,
    ) -> AppResult<ChannelTabResponse> {
        let channel_id_trimmed = channel_id.trim();
        if channel_id_trimmed.is_empty() {
            return Err(AppError::Validation("Channel ID cannot be empty".into()));
        }

        let mut payload = if let Some(ref token) = page_token {
            serde_json::json!({
                "continuation": token
            })
        } else {
            let mut p = serde_json::json!({
                "browseId": channel_id_trimmed
            });
            if let Some(ref q) = query {
                p["query"] = serde_json::json!(q);
                p["params"] = serde_json::json!("EgZzZWFyY2jyBgQKAloA");
            } else if let Some(par) = params {
                p["params"] = serde_json::json!(par);
            }
            p
        };

        let res = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        let (items, next_page_token, sort_latest_token, sort_popular_token, sort_oldest_token) =
            extract_videos_from_browse(&res);

        Ok(ChannelTabResponse {
            channel_id: channel_id_trimmed.to_string(),
            items,
            next_page_token,
            sort_latest_token,
            sort_popular_token,
            sort_oldest_token,
        })
    }
}
