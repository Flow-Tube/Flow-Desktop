use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::normalize_youtube_image_url;
use crate::api::innertube::renderers::lockup::lockup_item;
use crate::api::innertube::renderers::video::{channel_id_of, video_from_renderer};
use crate::models::channel::ShortVideoSummary;
use crate::models::video::{RelatedContentItem, VideoSummary};
use serde_json::{Value, json};

/// Body of a video watch-next (`next`) request.
///
/// Without the content-check flags, a video behind a content warning comes back
/// with no `secondaryResults` at all, so its related list and autoplay are empty.
pub(crate) fn watch_next_body(video_id: &str) -> Value {
    json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true })
}

pub fn build_related_content_from_compact_video(video: &Value) -> Option<RelatedContentItem> {
    let summary = video_from_renderer(video)?;

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
        is_short: summary.is_short,
        ..Default::default()
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
        channel_id: channel_id_of(playlist),
        thumbnail_url,
        duration_seconds: None,
        published_text: None,
        view_count_text,
        video_id,
        playlist_id: Some(playlist_id),
        is_mix,
        is_live: false,
        ..Default::default()
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
        if let Some(summary) = lockup_item(lockup) {
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
        title: text_of(title).unwrap_or_default(),
        thumbnail_url: thumbnails
            .as_array()
            .and_then(|sources| sources.last())
            .and_then(|source| source["url"].as_str())
            .map(ToOwned::to_owned),
        view_count_text: text_of(view_count_text),
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
