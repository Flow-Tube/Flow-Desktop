use crate::errors::AppResult;
use crate::models::music::{
    Album, AlbumItem, Artist, ArtistItem, ArtistPage, ArtistSection, ChartSection, ChartsPage,
    EpisodeItem, ExplorePage, MoodAndGenreItem, PlaylistItem, PodcastItem, SongItem, YTItem,
};
use crate::models::video::VideoSummary;
use serde_json::Value;

// --- Helper functions ---

pub fn parse_duration_seconds(simple_text: &str) -> u64 {
    let parts: Vec<&str> = simple_text.split(':').collect();
    let mut total = 0u64;
    let mut multiplier = 1u64;
    for part in parts.iter().rev() {
        if let Ok(num) = part.parse::<u64>() {
            total += num * multiplier;
            multiplier *= 60;
        }
    }
    total
}

fn upgrade_youtube_thumbnail_url(url: String) -> String {
    let (base, query) = url
        .split_once('?')
        .map_or((url.as_str(), ""), |(base, query)| (base, query));

    if base.ends_with("maxresdefault.jpg")
        || base.ends_with("maxresdefault.webp")
        || base.ends_with("hq720.jpg")
        || base.ends_with("hq720.webp")
    {
        return url;
    }

    for suffix in [
        "mqdefault.jpg",
        "hqdefault.jpg",
        "sddefault.jpg",
        "default.jpg",
        "mqdefault.webp",
        "hqdefault.webp",
        "sddefault.webp",
        "default.webp",
    ] {
        if let Some(prefix) = base.strip_suffix(suffix) {
            return if query.is_empty() {
                format!("{prefix}hq720.jpg")
            } else {
                format!("{prefix}hq720.jpg?{query}")
            };
        }
    }

    url
}

fn normalize_image_url(url: &str) -> String {
    let mut normalized = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    };

    if normalized.contains("googleusercontent.com") || normalized.contains("ggpht.com") {
        let is_yt3_avatar = normalized.contains("://yt3.")
            || normalized.contains("//yt3.")
            || normalized.contains("yt3.googleusercontent.com")
            || normalized.contains("yt3.ggpht.com");
        if let Some(eq_pos) = normalized.find('=') {
            let base = &normalized[..eq_pos];
            normalized = if is_yt3_avatar {
                format!("{base}=s512")
            } else {
                format!("{base}=w1080-h1080-p-l90-rj")
            };
        } else {
            normalized.push_str(if is_yt3_avatar {
                "=s512"
            } else {
                "=w1080-h1080-p-l90-rj"
            });
        }
    } else if normalized.contains("i.ytimg.com") || normalized.contains("img.youtube.com") {
        normalized = upgrade_youtube_thumbnail_url(normalized);
    }

    normalized
}

fn best_thumbnail_url(value: &Value) -> Option<String> {
    value
        .as_array()
        .and_then(|thumbnails| thumbnails.last())
        .and_then(|thumb| thumb["url"].as_str().or_else(|| thumb["uri"].as_str()))
        .map(normalize_image_url)
}

pub fn get_thumbnail_url(renderer: &Value) -> Option<String> {
    best_thumbnail_url(&renderer["musicThumbnailRenderer"]["thumbnail"]["thumbnails"])
        .or_else(|| best_thumbnail_url(&renderer["thumbnail"]["thumbnails"]))
}

pub fn extract_channel_id_from_music_renderer(renderer: &Value) -> Option<String> {
    renderer["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
        .as_array()
        .and_then(|runs| {
            runs.iter().find_map(|run| {
                run["navigationEndpoint"]["browseEndpoint"]["browseId"]
                    .as_str()
                    .map(ToOwned::to_owned)
            })
        })
}

// --- Search & Album Parsers ---

pub fn parse_music_search_json(val: &Value) -> Vec<VideoSummary> {
    let mut items = Vec::new();

    let mut process_shelf = |shelf: &Value| {
        if let Some(contents_arr) = shelf["contents"].as_array() {
            for item in contents_arr {
                if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
                    let video_id = renderer["playlistItemData"]["videoId"]
                        .as_str()
                        .or_else(|| {
                            renderer["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]
                                ["text"]["runs"][0]["navigationEndpoint"]["watchEndpoint"]
                                ["videoId"]
                                .as_str()
                        })
                        .unwrap_or_default()
                        .to_string();

                    if video_id.is_empty() {
                        continue;
                    }

                    let title = renderer["flexColumns"][0]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]["text"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();

                    let mut artist_name = String::new();
                    if let Some(runs) = renderer["flexColumns"][1]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                        .as_array()
                    {
                        for run in runs {
                            if let Some(t) = run["text"].as_str() {
                                if t != "•" && t != " " {
                                    artist_name = t.to_string();
                                    break;
                                }
                            }
                        }
                    }

                    let thumbnail_url = best_thumbnail_url(
                        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
                    );

                    let mut duration_seconds = None;
                    if let Some(runs) = renderer["flexColumns"][1]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
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

                    items.push(VideoSummary {
                        id: video_id,
                        title,
                        channel_name: if artist_name.is_empty() {
                            "YouTube Music".to_string()
                        } else {
                            artist_name
                        },
                        channel_id: extract_channel_id_from_music_renderer(renderer),
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
    };

    if let Some(tabs) = val["contents"]["tabbedSearchResultsRenderer"]["tabs"].as_array() {
        if let Some(tab_content) = tabs[0]["tabRenderer"]["content"].as_object() {
            if let Some(contents) = tab_content["sectionListRenderer"]["contents"].as_array() {
                for content in contents {
                    if let Some(shelf) = content.get("musicShelfRenderer") {
                        process_shelf(shelf);
                    }
                }
            }
        }
    }

    items
}

pub fn parse_music_album_json(val: &Value) -> Vec<VideoSummary> {
    let mut items = Vec::new();

    let mut process_shelf = |shelf: &Value| {
        if let Some(contents_arr) = shelf["contents"].as_array() {
            for item in contents_arr {
                if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
                    let video_id = renderer["playlistItemData"]["videoId"]
                        .as_str()
                        .or_else(|| {
                            renderer["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]
                                ["text"]["runs"][0]["navigationEndpoint"]["watchEndpoint"]
                                ["videoId"]
                                .as_str()
                        })
                        .unwrap_or_default()
                        .to_string();

                    if video_id.is_empty() {
                        continue;
                    }

                    let title = renderer["flexColumns"][0]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]["text"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();

                    let mut artist_name = String::new();
                    if let Some(runs) = renderer["flexColumns"][1]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                        .as_array()
                    {
                        for run in runs {
                            if let Some(t) = run["text"].as_str() {
                                if t != "•" && t != " " {
                                    artist_name = t.to_string();
                                    break;
                                }
                            }
                        }
                    }

                    let thumbnail_url = best_thumbnail_url(
                        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
                    );

                    let mut duration_seconds = None;
                    if let Some(runs) = renderer["flexColumns"][1]
                        ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
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

                    items.push(VideoSummary {
                        id: video_id,
                        title,
                        channel_name: if artist_name.is_empty() {
                            "YouTube Music".to_string()
                        } else {
                            artist_name
                        },
                        channel_id: extract_channel_id_from_music_renderer(renderer),
                        thumbnail_url,
                        duration_seconds,
                        published_text: None,
                        view_count_text: Some("Album Track".to_string()),
                        channel_avatar_url: None,
                        is_live: false,
                    });
                }
            }
        }
    };

    if let Some(contents) = val["contents"]["twoColumnBrowseResultsRenderer"]["secondaryContents"]
        ["musicPlaylistShelfRenderer"]
        .as_object()
    {
        process_shelf(&Value::Object(contents.clone()));
    } else if let Some(contents) = val["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]
        ["tabRenderer"]["content"]["sectionListRenderer"]["contents"]
        .as_array()
    {
        for content in contents {
            if let Some(shelf) = content.get("musicPlaylistShelfRenderer") {
                process_shelf(shelf);
            }
        }
    }

    items
}

// --- Item Parsers ---

pub fn parse_music_responsive_list_item_renderer(renderer: &Value) -> Option<YTItem> {
    let video_id = renderer["playlistItemData"]["videoId"]
        .as_str()
        .or_else(|| {
            renderer["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
                [0]["navigationEndpoint"]["watchEndpoint"]["videoId"]
                .as_str()
        })
        .map(|s| s.to_string())?;

    let title =
        renderer["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]
            ["text"]
            .as_str()
            .unwrap_or("Unknown Track")
            .to_string();

    let mut artists = Vec::new();
    if let Some(runs) =
        renderer["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
            .as_array()
    {
        for run in runs {
            if let Some(text) = run["text"].as_str() {
                if text != "•" && text != " " {
                    let artist_id = run["navigationEndpoint"]["browseEndpoint"]["browseId"]
                        .as_str()
                        .map(|s| s.to_string());
                    artists.push(Artist {
                        name: text.to_string(),
                        id: artist_id,
                    });
                }
            }
        }
    }

    let mut album = None;
    if let Some(cols) = renderer["flexColumns"].as_array() {
        if cols.len() >= 3 {
            if let Some(runs) =
                cols[2]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"].as_array()
            {
                if let Some(first_run) = runs.first() {
                    if let Some(album_id) =
                        first_run["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str()
                    {
                        let album_name = first_run["text"].as_str().unwrap_or("").to_string();
                        album = Some(Album {
                            name: album_name,
                            id: album_id.to_string(),
                        });
                    }
                }
            }
        }
    }

    let thumbnail_url = best_thumbnail_url(
        &renderer["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    )
    .or_else(|| best_thumbnail_url(&renderer["thumbnail"]["thumbnails"]))
    .unwrap_or_default();

    let is_explicit = renderer["badges"]
        .as_array()
        .map(|badges| {
            badges.iter().any(|b| {
                b["musicInlineBadgeRenderer"]["icon"]["iconType"].as_str()
                    == Some("MUSIC_EXPLICIT_BADGE")
            })
        })
        .unwrap_or(false);

    let playlist_id = renderer["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]["playlistId"]
        .as_str()
        .map(|s| s.to_string());
    let params = renderer["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
        ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]["params"]
        .as_str()
        .map(|s| s.to_string());

    Some(YTItem::Song(SongItem {
        id: video_id.clone(),
        title,
        artists,
        album,
        duration: None,
        music_video_type: renderer["musicVideoType"].as_str().map(|s| s.to_string()),
        thumbnail: thumbnail_url,
        explicit: is_explicit,
        video_id: Some(video_id),
        playlist_id,
        params,
        views_text: None,
    }))
}

pub fn parse_music_two_row_item_renderer(renderer: &Value) -> Option<YTItem> {
    let title = renderer["title"]["runs"][0]["text"].as_str()?.to_string();
    let thumbnail = best_thumbnail_url(
        &renderer["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"],
    )
    .or_else(|| best_thumbnail_url(&renderer["thumbnailRenderer"]["thumbnail"]["thumbnails"]))
    .or_else(|| best_thumbnail_url(&renderer["thumbnail"]["thumbnails"]))?;

    let watch_endpoint = &renderer["navigationEndpoint"]["watchEndpoint"];
    let browse_endpoint = &renderer["navigationEndpoint"]["browseEndpoint"];
    let page_type = browse_endpoint["browseEndpointContextSupportedConfigs"]
        ["browseEndpointContextMusicConfig"]["pageType"]
        .as_str()
        .unwrap_or_default();

    let subtitle_runs = renderer["subtitle"]["runs"].as_array();
    let is_explicit = renderer["subtitleBadges"]
        .as_array()
        .map(|badges| {
            badges.iter().any(|b| {
                b["musicInlineBadgeRenderer"]["icon"]["iconType"].as_str()
                    == Some("MUSIC_EXPLICIT_BADGE")
            })
        })
        .unwrap_or(false);

    if watch_endpoint["videoId"].is_string() {
        let video_id = watch_endpoint["videoId"].as_str()?.to_string();
        let mut artists = Vec::new();
        if let Some(runs) = subtitle_runs {
            for run in runs {
                let text = run["text"].as_str().unwrap_or("");
                if text != "•" && text != " " {
                    let artist_id = run["navigationEndpoint"]["browseEndpoint"]["browseId"]
                        .as_str()
                        .map(|s| s.to_string());
                    artists.push(Artist {
                        name: text.to_string(),
                        id: artist_id,
                    });
                }
            }
        }

        Some(YTItem::Song(SongItem {
            id: video_id.clone(),
            title,
            artists,
            album: None,
            duration: None,
            music_video_type: renderer["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]
                ["content"]["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]
                ["watchEndpointMusicSupportedConfigs"]["watchEndpointMusicConfig"]
                ["musicVideoType"]
                .as_str()
                .map(|s| s.to_string()),
            thumbnail,
            explicit: is_explicit,
            video_id: Some(video_id),
            playlist_id: watch_endpoint["playlistId"].as_str().map(|s| s.to_string()),
            params: watch_endpoint["params"].as_str().map(|s| s.to_string()),
            views_text: None,
        }))
    } else if page_type == "MUSIC_PAGE_TYPE_ARTIST" || page_type == "MUSIC_PAGE_TYPE_LIBRARY_ARTIST"
    {
        let artist_id = browse_endpoint["browseId"].as_str()?.to_string();
        Some(YTItem::Artist(ArtistItem {
            id: artist_id,
            title,
            thumbnail: Some(thumbnail),
            channel_id: renderer["menu"]["menuRenderer"]["items"]
                .as_array()
                .and_then(|items| {
                    items.iter().find_map(|item| {
                        item["toggleMenuServiceItemRenderer"]["defaultServiceEndpoint"]
                            ["subscribeEndpoint"]["channelIds"][0]
                            .as_str()
                            .map(|s| s.to_string())
                    })
                }),
        }))
    } else if page_type == "MUSIC_PAGE_TYPE_ALBUM" || page_type == "MUSIC_PAGE_TYPE_AUDIOBOOK" {
        let browse_id = browse_endpoint["browseId"].as_str()?.to_string();
        let playlist_id = renderer["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]
            ["content"]["musicPlayButtonRenderer"]["playNavigationEndpoint"]
            ["watchPlaylistEndpoint"]["playlistId"]
            .as_str()
            .or_else(|| {
                renderer["thumbnailOverlay"]["musicItemThumbnailOverlayRenderer"]["content"]
                    ["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]
                    ["playlistId"]
                    .as_str()
            })
            .unwrap_or_default()
            .to_string();

        let mut year = None;
        if let Some(runs) = subtitle_runs {
            if let Some(last_run) = runs.last() {
                if let Some(text) = last_run["text"].as_str() {
                    year = text.parse::<i32>().ok();
                }
            }
        }

        Some(YTItem::Album(AlbumItem {
            browse_id,
            playlist_id,
            title,
            artists: None,
            year,
            thumbnail,
            explicit: is_explicit,
        }))
    } else if page_type == "MUSIC_PAGE_TYPE_PLAYLIST" {
        let id = browse_endpoint["browseId"]
            .as_str()?
            .to_string()
            .replace("VL", "");
        let author_name = subtitle_runs
            .and_then(|runs| runs.first())
            .and_then(|run| run["text"].as_str())
            .unwrap_or("YouTube Music")
            .to_string();

        Some(YTItem::Playlist(PlaylistItem {
            id,
            title,
            author: Some(Artist {
                name: author_name,
                id: None,
            }),
            song_count_text: None,
            thumbnail: Some(thumbnail),
        }))
    } else if page_type == "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE" {
        let id = browse_endpoint["browseId"].as_str()?.to_string();
        let author_name = subtitle_runs
            .and_then(|runs| runs.first())
            .and_then(|run| run["text"].as_str())
            .unwrap_or("Unknown Author")
            .to_string();
        let author_id = subtitle_runs
            .and_then(|runs| runs.first())
            .and_then(|run| run["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
            .map(|s| s.to_string());

        Some(YTItem::Podcast(PodcastItem {
            id,
            title,
            author: Some(Artist {
                name: author_name,
                id: author_id,
            }),
            episode_count_text: subtitle_runs
                .and_then(|runs| runs.last())
                .and_then(|run| run["text"].as_str())
                .map(|s| s.to_string()),
            thumbnail: Some(thumbnail),
        }))
    } else if page_type == "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE" {
        let id = browse_endpoint["browseId"].as_str()?.to_string();
        let author_name = subtitle_runs
            .and_then(|runs| runs.first())
            .and_then(|run| run["text"].as_str())
            .unwrap_or("Unknown Author")
            .to_string();
        let author_id = subtitle_runs
            .and_then(|runs| runs.first())
            .and_then(|run| run["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
            .map(|s| s.to_string());

        Some(YTItem::Episode(EpisodeItem {
            id,
            title,
            author: Some(Artist {
                name: author_name,
                id: author_id,
            }),
            thumbnail,
            explicit: is_explicit,
            publish_date_text: subtitle_runs
                .and_then(|runs| runs.last())
                .and_then(|run| run["text"].as_str())
                .map(|s| s.to_string()),
        }))
    } else {
        None
    }
}

pub fn parse_yt_item(item: &Value) -> Option<YTItem> {
    if let Some(renderer) = item.get("musicResponsiveListItemRenderer") {
        parse_music_responsive_list_item_renderer(renderer)
    } else if let Some(renderer) = item.get("musicTwoRowItemRenderer") {
        parse_music_two_row_item_renderer(renderer)
    } else {
        None
    }
}

// --- Section & Page Parsers ---

pub fn parse_artist_section(sec: &Value) -> Option<ArtistSection> {
    if let Some(shelf) = sec.get("musicShelfRenderer") {
        let title = shelf["title"]["runs"][0]["text"].as_str()?.to_string();
        let mut items = Vec::new();
        if let Some(contents) = shelf["contents"].as_array() {
            for item in contents {
                if let Some(parsed) = parse_yt_item(item) {
                    items.push(parsed);
                }
            }
        }
        if items.is_empty() {
            return None;
        }

        let more_endpoint_browse_id =
            shelf["title"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["browseId"]
                .as_str()
                .map(|s| s.to_string());
        let more_endpoint_params =
            shelf["title"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["params"]
                .as_str()
                .map(|s| s.to_string());

        Some(ArtistSection {
            title,
            items,
            more_endpoint_browse_id,
            more_endpoint_params,
        })
    } else if let Some(shelf) = sec.get("musicCarouselShelfRenderer") {
        let basic_header = &shelf["header"]["musicCarouselShelfBasicHeaderRenderer"];
        let title = basic_header["title"]["runs"][0]["text"]
            .as_str()?
            .to_string();
        let mut items = Vec::new();
        if let Some(contents) = shelf["contents"].as_array() {
            for item in contents {
                if let Some(parsed) = parse_yt_item(item) {
                    items.push(parsed);
                }
            }
        }
        if items.is_empty() {
            return None;
        }

        let more_endpoint_browse_id = basic_header["moreContentButton"]["buttonRenderer"]
            ["navigationEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .map(|s| s.to_string());
        let more_endpoint_params = basic_header["moreContentButton"]["buttonRenderer"]
            ["navigationEndpoint"]["browseEndpoint"]["params"]
            .as_str()
            .map(|s| s.to_string());

        Some(ArtistSection {
            title,
            items,
            more_endpoint_browse_id,
            more_endpoint_params,
        })
    } else {
        None
    }
}

pub fn parse_music_artist_json(val: &Value) -> AppResult<ArtistPage> {
    let header = &val["header"];
    let contents = &val["contents"];

    let immersive = &header["musicImmersiveHeaderRenderer"];
    let visual = &header["musicVisualHeaderRenderer"];
    let detail = &header["musicDetailHeaderRenderer"];
    let header_gen = &header["musicHeaderRenderer"];

    let artist_name = immersive["title"]["runs"][0]["text"]
        .as_str()
        .or_else(|| visual["title"]["runs"][0]["text"].as_str())
        .or_else(|| header_gen["title"]["runs"][0]["text"].as_str())
        .or_else(|| detail["title"]["runs"][0]["text"].as_str())
        .unwrap_or("Unknown Artist")
        .to_string();

    let thumbnail = get_thumbnail_url(&immersive["thumbnail"])
        .or_else(|| get_thumbnail_url(&visual["foregroundThumbnail"]))
        .or_else(|| get_thumbnail_url(&detail["thumbnail"]))
        .unwrap_or_default();

    let channel_id = immersive["subscriptionButton"]["subscribeButtonRenderer"]["channelId"]
        .as_str()
        .or_else(|| visual["subscriptionButton"]["subscribeButtonRenderer"]["channelId"].as_str())
        .map(|s| s.to_string());

    let is_subscribed = immersive["subscriptionButton"]["subscribeButtonRenderer"]["subscribed"]
        .as_bool()
        .or_else(|| visual["subscriptionButton"]["subscribeButtonRenderer"]["subscribed"].as_bool())
        .unwrap_or(false);

    let subscriber_count_text = immersive["subscriptionButton2"]["subscribeButtonRenderer"]
        ["subscriberCountWithSubscribeText"]["runs"][0]["text"]
        .as_str()
        .or_else(|| {
            immersive["subscriptionButton"]["subscribeButtonRenderer"]["longSubscriberCountText"]
                ["runs"][0]["text"]
                .as_str()
        })
        .or_else(|| {
            immersive["subscriptionButton"]["subscribeButtonRenderer"]["shortSubscriberCountText"]
                ["runs"][0]["text"]
                .as_str()
        })
        .or_else(|| {
            visual["subscriptionButton"]["subscribeButtonRenderer"]["longSubscriberCountText"]
                ["runs"][0]["text"]
                .as_str()
        })
        .map(|s| s.to_string());

    let monthly_listener_count = immersive["monthlyListenerCount"]["runs"][0]["text"]
        .as_str()
        .map(|s| s.to_string());

    let mut description = None;
    if let Some(sections) = contents["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
        ["content"]["sectionListRenderer"]["contents"]
        .as_array()
    {
        for sec in sections {
            if let Some(desc_shelf) = sec.get("musicDescriptionShelfRenderer") {
                if let Some(runs) = desc_shelf["description"]["runs"].as_array() {
                    let text = runs
                        .iter()
                        .filter_map(|r| r["text"].as_str())
                        .collect::<Vec<&str>>()
                        .join("");
                    if !text.is_empty() {
                        description = Some(text);
                        break;
                    }
                }
            }
        }
    }
    if description.is_none() {
        if let Some(runs) = immersive["description"]["runs"].as_array() {
            let text = runs
                .iter()
                .filter_map(|r| r["text"].as_str())
                .collect::<Vec<&str>>()
                .join("");
            if !text.is_empty() {
                description = Some(text);
            }
        }
    }

    let mut sections = Vec::new();
    if let Some(sections_arr) = contents["singleColumnBrowseResultsRenderer"]["tabs"][0]
        ["tabRenderer"]["content"]["sectionListRenderer"]["contents"]
        .as_array()
    {
        for sec in sections_arr {
            if let Some(artist_sec) = parse_artist_section(sec) {
                sections.push(artist_sec);
            }
        }
    }

    Ok(ArtistPage {
        artist: ArtistItem {
            id: String::new(), // Set in client/service layer
            title: artist_name,
            thumbnail: Some(thumbnail),
            channel_id,
        },
        sections,
        description,
        subscriber_count_text,
        monthly_listener_count,
        is_subscribed,
    })
}

pub fn parse_music_navigation_button_renderer(renderer: &Value) -> Option<MoodAndGenreItem> {
    let title = renderer["buttonText"]["runs"][0]["text"]
        .as_str()?
        .to_string();
    let stripe_color = renderer["solid"]["leftStripeColor"]
        .as_u64()
        .or_else(|| {
            renderer["solid"]["leftStripeColor"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
        })
        .unwrap_or(0);
    let browse_id = renderer["clickCommand"]["browseEndpoint"]["browseId"]
        .as_str()?
        .to_string();
    let params = renderer["clickCommand"]["browseEndpoint"]["params"]
        .as_str()
        .map(|s| s.to_string());

    Some(MoodAndGenreItem {
        title,
        stripe_color,
        browse_id,
        params,
    })
}

pub fn parse_music_explore_json(val: &Value) -> AppResult<ExplorePage> {
    let mut new_release_albums = Vec::new();
    let mut mood_and_genres = Vec::new();

    if let Some(shelves) = val["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]
        ["tabRenderer"]["content"]["sectionListRenderer"]["contents"]
        .as_array()
    {
        for shelf in shelves {
            if let Some(carousel) = shelf.get("musicCarouselShelfRenderer") {
                let header = &carousel["header"]["musicCarouselShelfBasicHeaderRenderer"];
                let more_browse_id = header["moreContentButton"]["buttonRenderer"]
                    ["navigationEndpoint"]["browseEndpoint"]["browseId"]
                    .as_str()
                    .unwrap_or_default();

                if more_browse_id == "FEmusic_new_releases_albums" {
                    if let Some(contents) = carousel["contents"].as_array() {
                        for item in contents {
                            if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
                                if let Some(YTItem::Album(album)) =
                                    parse_music_two_row_item_renderer(two_row)
                                {
                                    new_release_albums.push(album);
                                }
                            }
                        }
                    }
                } else if more_browse_id == "FEmusic_moods_and_genres" {
                    if let Some(contents) = carousel["contents"].as_array() {
                        for item in contents {
                            if let Some(nav_btn) = item.get("musicNavigationButtonRenderer") {
                                if let Some(mood_item) =
                                    parse_music_navigation_button_renderer(nav_btn)
                                {
                                    mood_and_genres.push(mood_item);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ExplorePage {
        new_release_albums,
        mood_and_genres,
    })
}

pub fn parse_music_charts_json(val: &Value) -> AppResult<ChartsPage> {
    let mut sections = Vec::new();

    if let Some(contents_arr) = val["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]
        ["tabRenderer"]["content"]["sectionListRenderer"]["contents"]
        .as_array()
    {
        for content in contents_arr {
            if let Some(renderer) = content.get("musicCarouselShelfRenderer") {
                if let Some(title) = renderer["header"]["musicCarouselShelfBasicHeaderRenderer"]
                    ["title"]["runs"][0]["text"]
                    .as_str()
                {
                    let mut items = Vec::new();
                    if let Some(contents) = renderer["contents"].as_array() {
                        for item in contents {
                            if let Some(parsed) = parse_yt_item(item) {
                                items.push(parsed);
                            }
                        }
                    }
                    if !items.is_empty() {
                        let chart_type = if title.to_lowercase().contains("trending") {
                            "Trending"
                        } else if title.to_lowercase().contains("top") {
                            "Top"
                        } else {
                            "Genre"
                        }
                        .to_string();

                        sections.push(ChartSection {
                            title: title.to_string(),
                            items,
                            chart_type,
                        });
                    }
                }
            } else if let Some(renderer) = content.get("gridRenderer") {
                if let Some(title) =
                    renderer["header"]["gridHeaderRenderer"]["title"]["runs"][0]["text"].as_str()
                {
                    let mut items = Vec::new();
                    if let Some(contents) = renderer["items"].as_array() {
                        for item in contents {
                            if let Some(two_row) = item.get("musicTwoRowItemRenderer") {
                                if let Some(parsed) = parse_music_two_row_item_renderer(two_row) {
                                    items.push(parsed);
                                }
                            }
                        }
                    }
                    if !items.is_empty() {
                        sections.push(ChartSection {
                            title: title.to_string(),
                            items,
                            chart_type: "NewReleases".to_string(),
                        });
                    }
                }
            }
        }
    }

    let continuation = val["continuationContents"]["sectionListContinuation"]["continuations"][0]
        ["nextContinuationData"]["continuation"]
        .as_str()
        .or_else(|| {
            val["continuationContents"]["sectionListContinuation"]["continuations"][0]
                ["reloadContinuationData"]["continuation"]
                .as_str()
        })
        .map(|s| s.to_string());

    Ok(ChartsPage {
        sections,
        continuation,
    })
}
