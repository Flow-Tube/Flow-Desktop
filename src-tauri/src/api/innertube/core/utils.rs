use crate::models::channel::ShortVideoSummary;
use crate::models::video::{RelatedContentItem, VideoSummary};
use serde_json::Value;

pub fn detect_video_is_live(video: &Value) -> bool {
    if let Some(badges) = video["badges"].as_array() {
        for badge in badges {
            let style = badge["metadataBadgeRenderer"]["style"]
                .as_str()
                .unwrap_or_default();
            if style == "BADGE_STYLE_TYPE_LIVE_NOW" {
                return true;
            }
        }
    }

    if let Some(overlays) = video["thumbnailOverlays"].as_array() {
        for overlay in overlays {
            let style = overlay["thumbnailOverlayTimeStatusRenderer"]["style"]
                .as_str()
                .unwrap_or_default();
            if style.eq_ignore_ascii_case("LIVE") {
                return true;
            }
        }
    }

    video["viewCountText"]["runs"]
        .as_array()
        .map(|runs| {
            runs.iter()
                .any(|run| run["text"].as_str().is_some_and(|t| t.contains("watching")))
        })
        .unwrap_or(false)
}

// Detects a live broadcast from the newer lockupViewModel layout, where the LIVE state is a
// thumbnail overlay badge whose text reads "LIVE".
pub fn detect_lockup_is_live(lockup: &Value) -> bool {
    let overlays = lockup["contentImage"]["thumbnailViewModel"]["overlays"].as_array();
    if let Some(overlays) = overlays {
        for overlay in overlays {
            let badges = overlay["thumbnailOverlayBadgeViewModel"]["thumbnailBadges"]
                .as_array()
                .or_else(|| overlay["thumbnailBottomOverlayViewModel"]["badges"].as_array());
            if let Some(badges) = badges {
                for badge in badges {
                    let text = badge["thumbnailBadgeViewModel"]["text"]
                        .as_str()
                        .unwrap_or_default();
                    let icon = badge["thumbnailBadgeViewModel"]["icon"]["sources"][0]["clientResource"]
                        ["imageName"]
                        .as_str()
                        .unwrap_or_default();
                    if text.eq_ignore_ascii_case("LIVE") || icon.contains("LIVE") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

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

pub fn parse_mixed_number_word_to_long(text: &str) -> u64 {
    let cleaned = text
        .to_lowercase()
        .replace("subscribers", "")
        .replace("subscriber", "")
        .replace("views", "")
        .replace("view", "")
        .replace(",", "")
        .trim()
        .to_string();

    let mut multiplier = 1.0f64;
    let mut number_part = cleaned.clone();

    if cleaned.ends_with('k') {
        multiplier = 1_000.0;
        number_part = cleaned[..cleaned.len() - 1].trim().to_string();
    } else if cleaned.ends_with('m') {
        multiplier = 1_000_000.0;
        number_part = cleaned[..cleaned.len() - 1].trim().to_string();
    } else if cleaned.ends_with('b') {
        multiplier = 1_000_000_000.0;
        number_part = cleaned[..cleaned.len() - 1].trim().to_string();
    }

    if let Ok(num) = number_part.parse::<f64>() {
        (num * multiplier) as u64
    } else {
        0
    }
}

pub fn extract_continuation_token(item: &Value) -> Option<String> {
    item.get("continuationItemRenderer")
        .and_then(|renderer| {
            renderer["continuationEndpoint"]["continuationCommand"]["token"].as_str()
        })
        .map(ToOwned::to_owned)
}

pub fn extract_browse_id_from_text_runs(container: &Value, field: &str) -> Option<String> {
    container[field]["runs"].as_array().and_then(|runs| {
        runs.iter().find_map(|run| {
            run["navigationEndpoint"]["browseEndpoint"]["browseId"]
                .as_str()
                .map(ToOwned::to_owned)
        })
    })
}

pub fn extract_channel_id_from_video_renderer(video: &Value) -> Option<String> {
    extract_browse_id_from_text_runs(video, "ownerText")
        .or_else(|| extract_browse_id_from_text_runs(video, "longBylineText"))
        .or_else(|| extract_browse_id_from_text_runs(video, "shortBylineText"))
}

pub fn extract_text_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    if let Some(text) = value["simpleText"].as_str() {
        return Some(text.to_string());
    }

    if let Some(text) = value["content"].as_str() {
        return Some(text.to_string());
    }

    if let Some(runs) = value["runs"].as_array() {
        let text = runs
            .iter()
            .filter_map(|run| run["text"].as_str().or_else(|| run["content"].as_str()))
            .collect::<String>();
        if !text.is_empty() {
            return Some(text);
        }
    }

    None
}

pub fn thumbnail_url_from_array(value: &Value) -> Option<String> {
    value
        .as_array()
        .and_then(|thumbnails| thumbnails.last())
        .and_then(|thumb| thumb["url"].as_str().or_else(|| thumb["uri"].as_str()))
        .map(normalize_youtube_image_url)
}

pub fn youtube_video_thumbnail_url(video_id: &str, quality: &str) -> String {
    format!("https://i.ytimg.com/vi/{video_id}/{quality}.jpg")
}

pub fn best_video_thumbnail_url(video_id: &str, thumbnails: Option<&Value>) -> Option<String> {
    thumbnails
        .and_then(thumbnail_url_from_array)
        .or_else(|| Some(youtube_video_thumbnail_url(video_id, "hq720")))
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

pub fn normalize_youtube_image_url(url: &str) -> String {
    let mut normalized = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    };

    if normalized.contains("i.ytimg.com") || normalized.contains("img.youtube.com") {
        normalized = upgrade_youtube_thumbnail_url(normalized);
    } else if normalized.contains("googleusercontent.com") || normalized.contains("ggpht.com") {
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
    }

    normalized
}

pub fn build_video_summary_from_compact_video(video: &Value) -> Option<VideoSummary> {
    let video_id = video["videoId"].as_str()?.to_string();
    let title = video["title"]["runs"][0]["text"]
        .as_str()
        .or_else(|| video["title"]["simpleText"].as_str())
        .unwrap_or_default()
        .to_string();

    let channel_name = video["longBylineText"]["runs"][0]["text"]
        .as_str()
        .or_else(|| video["shortBylineText"]["runs"][0]["text"].as_str())
        .or_else(|| video["ownerText"]["runs"][0]["text"].as_str())
        .unwrap_or_default()
        .to_string();

    let thumbnail_url = video["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|thumbnails| thumbnails.last())
        .and_then(|thumb| thumb["url"].as_str())
        .map(normalize_youtube_image_url);

    let duration_seconds = video["lengthText"]["simpleText"]
        .as_str()
        .or_else(|| video["lengthText"]["runs"][0]["text"].as_str())
        .map(parse_duration_seconds);

    let published_text = video["publishedTimeText"]["simpleText"]
        .as_str()
        .or_else(|| video["publishedTimeText"]["runs"][0]["text"].as_str())
        .map(|s| s.to_string());

    let view_count_text = video["viewCountText"]["simpleText"]
        .as_str()
        .or_else(|| video["viewCountText"]["runs"][0]["text"].as_str())
        .map(|s| s.to_string());

    Some(VideoSummary {
        id: video_id,
        title,
        channel_name,
        channel_id: extract_channel_id_from_video_renderer(video),
        thumbnail_url,
        duration_seconds,
        published_text,
        view_count_text,
        channel_avatar_url: None,
        is_live: detect_video_is_live(video),
    })
}

pub fn build_related_content_from_compact_video(video: &Value) -> Option<RelatedContentItem> {
    let summary = build_video_summary_from_compact_video(video)?;

    Some(RelatedContentItem {
        id: summary.id.clone(),
        item_type: "video".to_string(),
        title: summary.title,
        channel_name: summary.channel_name,
        channel_id: summary.channel_id,
        thumbnail_url: summary.thumbnail_url,
        duration_seconds: summary.duration_seconds,
        published_text: summary.published_text,
        view_count_text: summary.view_count_text,
        video_id: Some(summary.id),
        playlist_id: None,
        is_mix: false,
        is_live: summary.is_live,
    })
}

pub fn build_related_content_from_compact_playlist(
    playlist: &Value,
    item_type: &str,
    is_mix: bool,
) -> Option<RelatedContentItem> {
    let playlist_id = playlist["playlistId"]
        .as_str()
        .or_else(|| playlist["navigationEndpoint"]["watchEndpoint"]["playlistId"].as_str())
        .or_else(|| playlist["navigationEndpoint"]["watchPlaylistEndpoint"]["playlistId"].as_str())?
        .to_string();

    let video_id = playlist["navigationEndpoint"]["watchEndpoint"]["videoId"]
        .as_str()
        .or_else(|| playlist["navigationEndpoint"]["watchPlaylistEndpoint"]["videoId"].as_str())
        .map(|s| s.to_string());

    let title = playlist["title"]["simpleText"]
        .as_str()
        .or_else(|| playlist["title"]["runs"][0]["text"].as_str())
        .unwrap_or_default()
        .to_string();

    let channel_name = playlist["shortBylineText"]["runs"][0]["text"]
        .as_str()
        .or_else(|| playlist["longBylineText"]["runs"][0]["text"].as_str())
        .or_else(|| playlist["ownerText"]["runs"][0]["text"].as_str())
        .unwrap_or_else(|| if is_mix { "YouTube Mix" } else { "Playlist" })
        .to_string();

    let thumbnail_url = playlist["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|thumbnails| thumbnails.last())
        .and_then(|thumb| thumb["url"].as_str())
        .map(normalize_youtube_image_url);

    let view_count_text = playlist["videoCountText"]["simpleText"]
        .as_str()
        .or_else(|| playlist["videoCountText"]["runs"][0]["text"].as_str())
        .or_else(|| playlist["videoCountShortText"]["simpleText"].as_str())
        .or_else(|| playlist["videoCountShortText"]["runs"][0]["text"].as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            Some(if is_mix {
                "Mix".to_string()
            } else {
                "Playlist".to_string()
            })
        });

    Some(RelatedContentItem {
        id: playlist_id.clone(),
        item_type: item_type.to_string(),
        title,
        channel_name,
        channel_id: extract_channel_id_from_video_renderer(playlist),
        thumbnail_url,
        duration_seconds: None,
        published_text: None,
        view_count_text,
        video_id,
        playlist_id: Some(playlist_id),
        is_mix,
        is_live: false,
    })
}

pub fn metadata_part_content(
    lockup: &Value,
    row_index: usize,
    part_index: usize,
) -> Option<String> {
    lockup["metadata"]["lockupMetadataViewModel"]["metadata"]["contentMetadataViewModel"]
        ["metadataRows"]
        .as_array()
        .and_then(|rows| rows.get(row_index))
        .and_then(|row| row["metadataParts"].as_array())
        .and_then(|parts| parts.get(part_index))
        .and_then(|part| part["text"]["content"].as_str())
        .map(ToOwned::to_owned)
}

pub fn extract_channel_id_from_lockup(lockup: &Value) -> Option<String> {
    lockup["metadata"]["lockupMetadataViewModel"]["image"]["decoratedAvatarViewModel"]
        ["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]["browseEndpoint"]
        ["browseId"]
        .as_str()
        .or_else(|| {
            lockup["metadata"]["lockupMetadataViewModel"]["image"]["avatarStackViewModel"]
                ["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]
                ["showDialogCommand"]["panelLoadingStrategy"]["inlineContent"]["dialogViewModel"]
                ["customContent"]["listViewModel"]["listItems"][0]["listItemViewModel"]
                ["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]["browseEndpoint"]
                ["browseId"]
                .as_str()
        })
        .map(ToOwned::to_owned)
}

pub fn duration_from_lockup(lockup: &Value) -> Option<u64> {
    lockup["contentImage"]["thumbnailViewModel"]["overlays"]
        .as_array()
        .and_then(|overlays| {
            overlays.iter().find_map(|overlay| {
                overlay["thumbnailBottomOverlayViewModel"]["badges"]
                    .as_array()
                    .and_then(|badges| {
                        badges.iter().find_map(|badge| {
                            let text = badge["thumbnailBadgeViewModel"]["text"].as_str()?;
                            if text.chars().any(|c| c.is_ascii_digit()) {
                                Some(parse_duration_seconds(text))
                            } else {
                                None
                            }
                        })
                    })
            })
        })
}

pub fn build_related_content_from_lockup(lockup: &Value) -> Option<RelatedContentItem> {
    let content_type = lockup["contentType"].as_str().unwrap_or_default();
    let is_video = content_type == "LOCKUP_CONTENT_TYPE_VIDEO";
    let is_playlist = content_type == "LOCKUP_CONTENT_TYPE_PLAYLIST"
        || content_type == "LOCKUP_CONTENT_TYPE_PODCAST";

    if !is_video && !is_playlist {
        return None;
    }

    let video_id = lockup["contentId"]
        .as_str()
        .or_else(|| {
            lockup["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]
                ["watchEndpoint"]["videoId"]
                .as_str()
        })
        .map(ToOwned::to_owned);

    let playlist_id = lockup["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]
        ["watchEndpoint"]["playlistId"]
        .as_str()
        .or_else(|| {
            lockup["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]
                ["watchPlaylistEndpoint"]["playlistId"]
                .as_str()
        })
        .map(ToOwned::to_owned);

    if is_video && video_id.is_none() {
        return None;
    }
    if is_playlist && playlist_id.is_none() {
        return None;
    }

    let title = lockup["metadata"]["lockupMetadataViewModel"]["title"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();

    let channel_name = metadata_part_content(lockup, 0, 0).unwrap_or_else(|| {
        if is_playlist {
            "Playlist".to_string()
        } else {
            String::new()
        }
    });

    let thumbnail_url =
        thumbnail_url_from_array(&lockup["contentImage"]["thumbnailViewModel"]["image"]["sources"]);

    let (item_type, id, is_mix) = if is_playlist {
        let resolved_playlist_id = playlist_id.clone()?;
        let is_mix =
            resolved_playlist_id.starts_with("RD") || resolved_playlist_id.starts_with("UL");
        (
            if is_mix { "mix" } else { "playlist" }.to_string(),
            resolved_playlist_id,
            is_mix,
        )
    } else {
        let video_id = video_id.clone()?;
        ("video".to_string(), video_id, false)
    };

    Some(RelatedContentItem {
        id,
        item_type,
        title,
        channel_name,
        channel_id: extract_channel_id_from_lockup(lockup),
        thumbnail_url,
        duration_seconds: duration_from_lockup(lockup),
        published_text: metadata_part_content(lockup, 1, 1),
        view_count_text: metadata_part_content(lockup, 1, 0),
        video_id,
        playlist_id,
        is_mix,
        is_live: detect_lockup_is_live(lockup),
    })
}

pub fn collect_related_content_items(value: &Value, related: &mut Vec<RelatedContentItem>) {
    if let Some(video) = value.get("compactVideoRenderer") {
        if let Some(summary) = build_related_content_from_compact_video(video) {
            related.push(summary);
        }
        return;
    }

    if let Some(mix) = value.get("compactRadioRenderer") {
        if let Some(summary) = build_related_content_from_compact_playlist(mix, "mix", true) {
            related.push(summary);
        }
        return;
    }

    if let Some(playlist) = value.get("compactPlaylistRenderer") {
        if let Some(summary) =
            build_related_content_from_compact_playlist(playlist, "playlist", false)
        {
            related.push(summary);
        }
        return;
    }

    if let Some(lockup) = value.get("lockupViewModel") {
        if let Some(summary) = build_related_content_from_lockup(lockup) {
            related.push(summary);
        }
        return;
    }

    if let Some(array) = value.as_array() {
        for item in array {
            collect_related_content_items(item, related);
        }
        return;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            collect_related_content_items(child, related);
        }
    }
}

pub fn dedupe_related_content_items(items: Vec<RelatedContentItem>) -> Vec<RelatedContentItem> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for item in items {
        let identity = format!(
            "{}:{}:{}",
            item.item_type,
            item.video_id.as_deref().unwrap_or(""),
            item.playlist_id.as_deref().unwrap_or(&item.id)
        );

        if seen.insert(identity) {
            deduped.push(item);
        }
    }

    deduped
}

pub fn unique_video_summaries(items: Vec<VideoSummary>) -> Vec<VideoSummary> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for item in items {
        if seen.insert(item.id.clone()) {
            deduped.push(item);
        }
    }

    deduped
}

pub fn map_related_content_to_video_summary(item: RelatedContentItem) -> VideoSummary {
    VideoSummary {
        id: item.video_id.unwrap_or(item.id),
        title: item.title,
        channel_name: item.channel_name,
        channel_id: item.channel_id,
        thumbnail_url: item.thumbnail_url,
        duration_seconds: item.duration_seconds,
        published_text: item.published_text,
        view_count_text: item.view_count_text,
        channel_avatar_url: None,
        is_live: item.is_live,
    }
}

/// A Short from the object wrapping a `shortsLockupViewModel` or older
/// `reelItemRenderer`.
pub fn short_video_summary_from_item(item: &Value) -> Option<ShortVideoSummary> {
    let (id, title, thumbnails, view_count_text) =
        if let Some(lockup) = item.get("shortsLockupViewModel") {
            let overlay = &lockup["overlayMetadata"];
            (
                &lockup["onTap"]["innertubeCommand"]["reelWatchEndpoint"]["videoId"],
                &overlay["primaryText"],
                &lockup["thumbnailViewModel"]["thumbnailViewModel"]["image"]["sources"],
                &overlay["secondaryText"],
            )
        } else {
            let reel = item.get("reelItemRenderer")?;
            (
                &reel["videoId"],
                &reel["headline"],
                &reel["thumbnail"]["thumbnails"],
                &reel["viewCountText"],
            )
        };

    Some(ShortVideoSummary {
        id: id.as_str().filter(|id| !id.is_empty())?.to_string(),
        title: extract_text_from_value(title).unwrap_or_default(),
        thumbnail_url: thumbnails
            .as_array()
            .and_then(|sources| sources.last())
            .and_then(|source| source["url"].as_str())
            .map(ToOwned::to_owned),
        view_count_text: extract_text_from_value(view_count_text),
    })
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
