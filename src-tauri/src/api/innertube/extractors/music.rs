use tracing::debug;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    extract_channel_id_from_music_renderer, map_related_content_to_video_summary,
    parse_duration_seconds,
};
use crate::api::innertube::parsers::{
    parse_music_album_json, parse_music_artist_json, parse_music_charts_json,
    parse_music_explore_json,
};
use crate::errors::{AppError, AppResult};
use crate::models::music::{ArtistPage, ChartsPage, ExplorePage};
use crate::models::video::{MusicHomeChip, MusicHomeSection, VideoSummary};

impl InnertubeClient {
    pub async fn get_music_lyrics(&self, video_id: &str) -> AppResult<Option<String>> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        // 1. Fetch metadata from next to get lyrics browseId and params
        let (lyrics_browse_id, lyrics_params, _, _) =
            match self.fetch_watch_next_metadata(video_id_trimmed).await {
                Ok(data) => data,
                Err(_) => (None, None, None, None),
            };

        let browse_id = match lyrics_browse_id {
            Some(id) => id,
            None => return Ok(None), // Lyrics not available for this song
        };

        // 2. Fetch lyrics using WEB_REMIX client browse
        let mut payload = serde_json::json!({
            "browseId": browse_id
        });
        if let Some(p) = lyrics_params {
            payload["params"] = serde_json::Value::String(p);
        }

        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;

        let mut lyrics_text = String::new();
        if let Some(contents) = res["contents"]["sectionListRenderer"]["contents"].as_array() {
            for section in contents {
                if let Some(shelf) = section.get("musicDescriptionShelfRenderer") {
                    if let Some(runs) = shelf["description"]["runs"].as_array() {
                        for run in runs {
                            if let Some(t) = run["text"].as_str() {
                                lyrics_text.push_str(t);
                            }
                        }
                    }
                }
            }
        }

        if lyrics_text.is_empty() {
            Ok(None)
        } else {
            Ok(Some(lyrics_text))
        }
    }

    pub async fn get_music_related(&self, video_id: &str) -> AppResult<Vec<VideoSummary>> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Err(AppError::Validation("Video ID cannot be empty".into()));
        }

        debug!(video_id = %video_id_trimmed, "[get_music_related] Starting related videos fetch");

        // 1. Fetch metadata from next to get related browseId
        let (_, _, related_browse_id, related_params) = match self
            .fetch_watch_next_metadata(video_id_trimmed)
            .await
        {
            Ok(data) => {
                debug!(
                    video_id = %video_id_trimmed,
                    has_related_browse_id = data.2.is_some(),
                    "[get_music_related] WEB_REMIX watch next metadata result"
                );
                data
            }
            Err(e) => {
                debug!(video_id = %video_id_trimmed, error = %e, "[get_music_related] WEB_REMIX metadata fetch failed, falling back to WEB");
                (None, None, None, None)
            }
        };

        let browse_id = match related_browse_id {
            Some(id) => id,
            None => {
                // Fallback to standard watch next recommendations if we don't have related_browse_id
                debug!(video_id = %video_id_trimmed, "[get_music_related] No music related browse ID, falling back to WEB next endpoint");
                let standard_related = match self.get_related_videos(video_id_trimmed).await {
                    Ok(results) => results
                        .into_iter()
                        .map(map_related_content_to_video_summary)
                        .collect(),
                    Err(error) => {
                        debug!(video_id = %video_id_trimmed, error = %error, "[get_music_related] WEB next endpoint call failed");
                        Vec::new()
                    }
                };
                debug!(video_id = %video_id_trimmed, count = standard_related.len(), "[get_music_related] Returning standard related videos");
                return Ok(standard_related);
            }
        };

        // 2. Fetch related items using WEB_REMIX client browse
        let mut payload = serde_json::json!({
            "browseId": browse_id
        });
        if let Some(p) = related_params {
            payload["params"] = serde_json::Value::String(p);
        }

        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;

        let mut related_items = Vec::new();
        if let Some(sections) = res["contents"]["sectionListRenderer"]["contents"].as_array() {
            for section in sections {
                if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
                    if let Some(contents_arr) = carousel["contents"].as_array() {
                        for item in contents_arr {
                            let renderer = item
                                .get("musicResponsiveListItemRenderer")
                                .or_else(|| item.get("musicTwoRowItemRenderer"));

                            if let Some(r) = renderer {
                                let video_id = r["playlistItemData"]["videoId"]
                                    .as_str()
                                    .or_else(|| {
                                        r["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str()
                                    })
                                    .or_else(|| {
                                        r["flexColumns"][0]
                                            ["musicResponsiveListItemFlexColumnRenderer"]["text"]
                                            ["runs"][0]["navigationEndpoint"]["watchEndpoint"]
                                            ["videoId"]
                                            .as_str()
                                    })
                                    .unwrap_or_default()
                                    .to_string();

                                if video_id.is_empty() {
                                    continue;
                                }

                                let title = r["flexColumns"][0]
                                    ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                                    [0]["text"]
                                    .as_str()
                                    .or_else(|| r["title"]["runs"][0]["text"].as_str())
                                    .unwrap_or_default()
                                    .to_string();

                                let mut channel_name = String::new();
                                if let Some(runs) =
                                    r["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]
                                        ["text"]["runs"]
                                        .as_array()
                                {
                                    for run in runs {
                                        if let Some(t) = run["text"].as_str() {
                                            if t != "•" && t != " " {
                                                channel_name = t.to_string();
                                                break;
                                            }
                                        }
                                    }
                                }
                                if channel_name.is_empty() {
                                    channel_name = r["subtitle"]["runs"][0]["text"]
                                        .as_str()
                                        .unwrap_or("Related Song")
                                        .to_string();
                                }

                                let thumbnail_url = r["thumbnail"]["musicThumbnailRenderer"]
                                    ["thumbnail"]["thumbnails"][0]["url"]
                                    .as_str()
                                    .or_else(|| {
                                        r["thumbnailRenderer"]["musicThumbnailRenderer"]
                                            ["thumbnail"]["thumbnails"][0]["url"]
                                            .as_str()
                                    })
                                    .map(|s| s.to_string());

                                related_items.push(VideoSummary {
                                    id: video_id,
                                    title,
                                    channel_name,
                                    channel_id: extract_channel_id_from_music_renderer(r),
                                    thumbnail_url,
                                    duration_seconds: None,
                                    published_text: None,
                                    view_count_text: Some("Related Song".to_string()),
                                    channel_avatar_url: None,
                                    is_live: false,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(related_items)
    }

    pub async fn get_music_album(&self, album_browse_id: &str) -> AppResult<Vec<VideoSummary>> {
        let album_browse_id_trimmed = album_browse_id.trim();
        if album_browse_id_trimmed.is_empty() {
            return Err(AppError::Validation(
                "Album Browse ID cannot be empty".into(),
            ));
        }

        let mut payload = serde_json::json!({
            "browseId": album_browse_id_trimmed
        });

        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;
        let tracks = parse_music_album_json(&res);

        Ok(tracks)
    }

    pub async fn get_music_home(&self) -> AppResult<(Vec<MusicHomeSection>, Vec<MusicHomeChip>)> {
        let mut payload = serde_json::json!({
            "browseId": "FEmusic_home"
        });
        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;

        // 1. Parse chips
        let mut chips = Vec::new();
        let chips_val = res["header"]["chipCloudRenderer"]["chips"]
            .as_array()
            .or_else(|| {
                res["header"]["musicHeaderRenderer"]["header"]["chipCloudRenderer"]["chips"]
                    .as_array()
            });

        if let Some(arr) = chips_val {
            for (idx, item) in arr.iter().enumerate() {
                if let Some(chip_renderer) = item.get("chipCloudChipRenderer") {
                    let title = chip_renderer["text"]["runs"][0]["text"]
                        .as_str()
                        .or_else(|| chip_renderer["text"]["simpleText"].as_str())
                        .unwrap_or_default()
                        .to_string();
                    if title.is_empty() {
                        continue;
                    }
                    let browse_id =
                        chip_renderer["navigationEndpoint"]["browseEndpoint"]["browseId"]
                            .as_str()
                            .map(|s| s.to_string());
                    let params = chip_renderer["navigationEndpoint"]["browseEndpoint"]["params"]
                        .as_str()
                        .map(|s| s.to_string());
                    chips.push(MusicHomeChip {
                        title,
                        browse_id,
                        params,
                        order_by: idx as i32,
                    });
                }
            }
        }

        // 2. Parse sections
        let mut sections_arr = None;
        if let Some(arr) = res["contents"]["sectionListRenderer"]["contents"].as_array() {
            sections_arr = Some(arr);
        } else if let Some(tabs) =
            res["contents"]["singleColumnBrowseResultsRenderer"]["tabs"].as_array()
        {
            if let Some(tab_renderer) = tabs.first().and_then(|t| t.get("tabRenderer")) {
                if let Some(arr) =
                    tab_renderer["content"]["sectionListRenderer"]["contents"].as_array()
                {
                    sections_arr = Some(arr);
                }
            }
        }

        let mut sections = Vec::new();
        if let Some(arr) = sections_arr {
            let mut order_idx = 0;
            for section in arr {
                if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
                    let title = carousel["header"]["musicCarouselShelfBasicHeaderRenderer"]
                        ["title"]["runs"][0]["text"]
                        .as_str()
                        .or_else(|| {
                            carousel["header"]["musicCarouselShelfBasicHeaderRenderer"]["title"]
                                ["simpleText"]
                                .as_str()
                        })
                        .unwrap_or("Featured")
                        .to_string();

                    let subtitle = carousel["header"]["musicCarouselShelfBasicHeaderRenderer"]
                        ["strapline"]["runs"][0]["text"]
                        .as_str()
                        .or_else(|| {
                            carousel["header"]["musicCarouselShelfBasicHeaderRenderer"]["strapline"]
                                ["simpleText"]
                                .as_str()
                        })
                        .map(|s| s.to_string());

                    let mut tracks = Vec::new();
                    if let Some(contents) = carousel["contents"].as_array() {
                        for item in contents {
                            let renderer = item
                                .get("musicResponsiveListItemRenderer")
                                .or_else(|| item.get("musicTwoRowItemRenderer"));

                            if let Some(r) = renderer {
                                let video_id = r["playlistItemData"]["videoId"]
                                    .as_str()
                                    .or_else(|| {
                                        r["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str()
                                    })
                                    .or_else(|| {
                                        r["flexColumns"][0]
                                            ["musicResponsiveListItemFlexColumnRenderer"]["text"]
                                            ["runs"][0]["navigationEndpoint"]["watchEndpoint"]
                                            ["videoId"]
                                            .as_str()
                                    })
                                    .or_else(|| {
                                        r["title"]["runs"][0]["navigationEndpoint"]["watchEndpoint"]
                                            ["videoId"]
                                            .as_str()
                                    })
                                    .unwrap_or_default()
                                    .to_string();

                                if video_id.is_empty() {
                                    continue;
                                }

                                let title = r["flexColumns"][0]
                                    ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                                    [0]["text"]
                                    .as_str()
                                    .or_else(|| r["title"]["runs"][0]["text"].as_str())
                                    .unwrap_or_default()
                                    .to_string();

                                let mut channel_name = String::new();
                                if let Some(runs) =
                                    r["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]
                                        ["text"]["runs"]
                                        .as_array()
                                {
                                    for run in runs {
                                        if let Some(t) = run["text"].as_str() {
                                            if t != "•" && t != " " {
                                                channel_name = t.to_string();
                                                break;
                                            }
                                        }
                                    }
                                }
                                if channel_name.is_empty() {
                                    if let Some(runs) = r["subtitle"]["runs"].as_array() {
                                        for run in runs {
                                            if let Some(t) = run["text"].as_str() {
                                                if t != "•"
                                                    && t != " "
                                                    && t != "Song"
                                                    && t != "Video"
                                                {
                                                    channel_name = t.to_string();
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                if channel_name.is_empty() {
                                    channel_name = "YouTube Music".to_string();
                                }

                                let thumbnail_url = r["thumbnail"]["musicThumbnailRenderer"]
                                    ["thumbnail"]["thumbnails"][0]["url"]
                                    .as_str()
                                    .or_else(|| {
                                        r["thumbnailRenderer"]["musicThumbnailRenderer"]
                                            ["thumbnail"]["thumbnails"][0]["url"]
                                            .as_str()
                                    })
                                    .map(|s| s.to_string());

                                let mut duration_seconds = None;
                                if let Some(runs) =
                                    r["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]
                                        ["text"]["runs"]
                                        .as_array()
                                {
                                    for run in runs {
                                        if let Some(t) = run["text"].as_str() {
                                            if t.contains(':') {
                                                duration_seconds = Some(parse_duration_seconds(t));
                                                break;
                                            }
                                        }
                                    }
                                }
                                if duration_seconds.is_none() {
                                    if let Some(runs) = r["subtitle"]["runs"].as_array() {
                                        for run in runs {
                                            if let Some(t) = run["text"].as_str() {
                                                if t.contains(':') {
                                                    duration_seconds =
                                                        Some(parse_duration_seconds(t));
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }

                                tracks.push(VideoSummary {
                                    id: video_id,
                                    title,
                                    channel_name,
                                    channel_id: extract_channel_id_from_music_renderer(r),
                                    thumbnail_url,
                                    duration_seconds,
                                    published_text: None,
                                    view_count_text: Some("Song".to_string()),
                                    channel_avatar_url: None,
                                    is_live: false,
                                });
                            }
                        }
                    }

                    if !tracks.is_empty() {
                        let section_id = format!("music_section_{}", order_idx);
                        sections.push(MusicHomeSection {
                            section_id,
                            title,
                            subtitle,
                            tracks,
                            order_by: order_idx,
                        });
                        order_idx += 1;
                    }
                }
            }
        }

        Ok((sections, chips))
    }

    pub async fn get_music_artist(&self, artist_browse_id: &str) -> AppResult<ArtistPage> {
        let mut payload = serde_json::json!({
            "browseId": artist_browse_id
        });
        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;
        let mut artist_page = parse_music_artist_json(&res)?;
        artist_page.artist.id = artist_browse_id.to_string();
        Ok(artist_page)
    }

    pub async fn get_music_explore(&self) -> AppResult<ExplorePage> {
        let mut payload = serde_json::json!({
            "browseId": "FEmusic_explore"
        });
        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;
        parse_music_explore_json(&res)
    }

    pub async fn get_music_charts(&self, continuation: Option<String>) -> AppResult<ChartsPage> {
        let mut payload = if let Some(token) = continuation {
            serde_json::json!({
                "continuation": token
            })
        } else {
            serde_json::json!({
                "browseId": "FEmusic_charts",
                "params": "ggMGCgQIgAQ%3D"
            })
        };
        let res = self
            .post_innertube("browse", &clients::WEB_REMIX, &mut payload)
            .await?;
        parse_music_charts_json(&res)
    }
}
