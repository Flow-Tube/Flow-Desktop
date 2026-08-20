use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    best_video_thumbnail_url, extract_channel_id_from_video_renderer,
    parse_mixed_number_word_to_long,
};
use crate::errors::{AppError, AppResult};
use crate::models::playlist::PlaylistDetailsResponse;
use crate::models::video::VideoSummary;
use serde_json::Value;

fn extract_videos_from_playlist_browse(val: &Value) -> (Vec<VideoSummary>, Option<String>) {
    let mut items = Vec::new();
    let mut next_page_token = None;

    let mut process_array = |arr: &Vec<Value>| {
        for item in arr {
            if let Some(video) = item.get("playlistVideoRenderer") {
                if let Some(video_id) = video["videoId"].as_str() {
                    let title = video["title"]["runs"][0]["text"]
                        .as_str()
                        .or_else(|| video["title"]["simpleText"].as_str())
                        .unwrap_or_default()
                        .to_string();

                    let channel_name = video["shortBylineText"]["runs"][0]["text"]
                        .as_str()
                        .or_else(|| video["longBylineText"]["runs"][0]["text"].as_str())
                        .unwrap_or_default()
                        .to_string();

                    let thumbnail_url = best_video_thumbnail_url(
                        video_id,
                        video.get("thumbnail").and_then(|t| t.get("thumbnails")),
                    );

                    let duration_seconds = video["lengthSeconds"]
                        .as_str()
                        .and_then(|s| s.parse::<u64>().ok())
                        .or_else(|| video["lengthSeconds"].as_u64());

                    items.push(VideoSummary {
                        id: video_id.to_string(),
                        title,
                        channel_name,
                        channel_id: extract_channel_id_from_video_renderer(video),
                        thumbnail_url,
                        duration_seconds,
                        published_text: None,
                        view_count_text: None,
                        channel_avatar_url: None,
                        is_live: false,
                    });
                }
            } else if let Some(cont) = item.get("continuationItemRenderer") {
                if let Some(token) =
                    cont["continuationEndpoint"]["continuationCommand"]["token"].as_str()
                {
                    next_page_token = Some(token.to_string());
                }
            }
        }
    };

    // Case 1: Continuation append/reload
    if let Some(actions) = val["onResponseReceivedActions"].as_array() {
        for action in actions {
            if let Some(items_arr) =
                action["appendContinuationItemsAction"]["continuationItems"].as_array()
            {
                process_array(items_arr);
            }
        }
    }

    // Case 2: Standard tabbed browse response
    if let Some(tabs) = val["contents"]["twoColumnBrowseResultsRenderer"]["tabs"].as_array() {
        for tab in tabs {
            if let Some(tab_renderer) = tab.get("tabRenderer") {
                let content = &tab_renderer["content"];
                if let Some(sections) = content["sectionListRenderer"]["contents"].as_array() {
                    for section in sections {
                        if let Some(items_arr) =
                            section["itemSectionRenderer"]["contents"].as_array()
                        {
                            for sub_item in items_arr {
                                if let Some(playlist_items) =
                                    sub_item["playlistVideoListRenderer"]["contents"].as_array()
                                {
                                    process_array(playlist_items);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (items, next_page_token)
}

fn extract_text_from_runs_or_simple(value: &Value) -> Option<String> {
    value["runs"]
        .as_array()
        .and_then(|runs| runs.first())
        .and_then(|run| run["text"].as_str())
        .or_else(|| value["simpleText"].as_str())
        .or_else(|| value["content"].as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn extract_playlist_title(res: &Value) -> String {
    let header = &res["header"];

    let title_candidates = [
        header
            .get("playlistHeaderRenderer")
            .and_then(|h| h.get("title")),
        header
            .get("pageHeaderRenderer")
            .and_then(|h| h.get("pageTitle")),
        header
            .get("pageHeaderViewModel")
            .and_then(|h| h.get("title"))
            .and_then(|title| title.get("dynamicTextViewModel"))
            .and_then(|vm| vm.get("text")),
        res["metadata"]
            .get("playlistMetadataRenderer")
            .and_then(|m| m.get("title")),
    ];

    for candidate in title_candidates {
        if let Some(title) = candidate.and_then(extract_text_from_runs_or_simple) {
            if !title.eq_ignore_ascii_case("unknown playlist") {
                return title;
            }
        }
    }

    "Unknown Playlist".to_string()
}

fn extract_playlist_description(header: &Value) -> Option<String> {
    extract_text_from_runs_or_simple(&header["descriptionText"])
}

fn is_unknown_owner(name: &str) -> bool {
    name.eq_ignore_ascii_case("unknown owner") || name.is_empty()
}

fn extract_playlist_owner_name(header: &Value) -> Option<String> {
    extract_text_from_runs_or_simple(&header["ownerText"]).filter(|name| !is_unknown_owner(name))
}

fn extract_owner_from_page_header(res: &Value) -> Option<String> {
    let rows = res["header"]["pageHeaderRenderer"]["content"]["pageHeaderViewModel"]["metadata"]
        ["contentMetadataViewModel"]["metadataRows"]
        .as_array()?;

    for row in rows {
        let parts = row["metadataParts"].as_array()?;
        for part in parts {
            let text = part["text"]["content"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let lower = text.to_lowercase();
            if lower.contains("view") || lower.contains("subscriber") {
                continue;
            }
            if lower.contains("video") && !lower.contains("by ") {
                continue;
            }
            if !is_unknown_owner(text) {
                return Some(text.to_string());
            }
        }
    }

    None
}

fn extract_owner_from_sidebar(res: &Value) -> Option<String> {
    let items = res["sidebar"]["playlistSidebarRenderer"]["items"].as_array()?;
    for item in items {
        if let Some(name) = item
            .get("playlistSidebarSecondaryInfoRenderer")
            .and_then(|info| info.get("videoOwner"))
            .and_then(|owner| owner.get("videoOwnerRenderer"))
            .and_then(|renderer| renderer.get("title"))
            .and_then(extract_text_from_runs_or_simple)
            .filter(|value| !is_unknown_owner(value))
        {
            return Some(name);
        }
    }
    None
}

fn extract_playlist_owner(res: &Value, header: Option<&Value>) -> String {
    let candidates = [
        header.and_then(extract_playlist_owner_name),
        extract_owner_from_page_header(res),
        extract_owner_from_sidebar(res),
        res["metadata"]["playlistMetadataRenderer"]["ownerChannelName"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        header.and_then(|h| {
            extract_text_from_runs_or_simple(&h["ownerBadge"]["badgeRenderer"]["title"])
        }),
    ];

    for candidate in candidates.into_iter().flatten() {
        if !is_unknown_owner(&candidate) {
            return candidate;
        }
    }

    "Unknown Owner".to_string()
}

fn metadata_row_mentions_views(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("view") || lower == "no views"
}

fn extract_view_count_from_page_header(res: &Value) -> Option<String> {
    let rows = res["header"]["pageHeaderRenderer"]["content"]["pageHeaderViewModel"]["metadata"]
        ["contentMetadataViewModel"]["metadataRows"]
        .as_array()?;

    for row in rows {
        let parts = row["metadataParts"].as_array()?;
        for part in parts {
            if let Some(text) = part["text"]["content"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if metadata_row_mentions_views(text) {
                    return Some(text.to_string());
                }
            }
        }
    }

    None
}

fn extract_view_count_from_sidebar(res: &Value) -> Option<String> {
    let items = res["sidebar"]["playlistSidebarRenderer"]["items"].as_array()?;
    for item in items {
        let stats = item["playlistSidebarPrimaryInfoRenderer"]["stats"].as_array()?;
        for stat in stats {
            if let Some(text) = extract_text_from_runs_or_simple(stat) {
                if metadata_row_mentions_views(&text) {
                    return Some(text);
                }
            }
        }
    }
    None
}

fn extract_playlist_view_count_text(res: &Value, header: Option<&Value>) -> Option<String> {
    header
        .and_then(|h| extract_text_from_runs_or_simple(&h["viewCountText"]))
        .or_else(|| extract_view_count_from_page_header(res))
        .or_else(|| extract_view_count_from_sidebar(res))
        .filter(|text| !text.is_empty())
}

fn extract_playlist_video_count(header: &Value) -> Option<u64> {
    header["numVideosText"]["runs"][0]["text"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| {
            header["numVideosText"]["simpleText"]
                .as_str()
                .map(|s| parse_mixed_number_word_to_long(s))
        })
}

impl InnertubeClient {
    pub async fn get_playlist_details(
        &self,
        playlist_id: &str,
        page_token: Option<String>,
    ) -> AppResult<PlaylistDetailsResponse> {
        let playlist_id_trimmed = playlist_id.trim();
        if playlist_id_trimmed.is_empty() {
            return Err(AppError::Validation("Playlist ID cannot be empty".into()));
        }

        let mut payload = if let Some(ref token) = page_token {
            serde_json::json!({
                "continuation": token
            })
        } else {
            serde_json::json!({
                "browseId": format!("VL{}", playlist_id_trimmed.replace("VL", ""))
            })
        };

        let res = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;

        let title = extract_playlist_title(&res);
        let playlist_header = res["header"].get("playlistHeaderRenderer");
        let description = playlist_header.and_then(extract_playlist_description);
        let channel_name = extract_playlist_owner(&res, playlist_header);
        let video_count = playlist_header.and_then(extract_playlist_video_count);
        let view_count_text = extract_playlist_view_count_text(&res, playlist_header);

        let (videos, next_page_token) = extract_videos_from_playlist_browse(&res);

        Ok(PlaylistDetailsResponse {
            id: playlist_id_trimmed.to_string(),
            title,
            description,
            channel_name,
            video_count,
            view_count_text,
            videos,
            next_page_token,
        })
    }
}
