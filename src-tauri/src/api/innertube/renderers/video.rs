//! The classic video renderers as one video card: `videoRenderer` (search,
//! channel tabs), `gridVideoRenderer`, `compactVideoRenderer` (older related
//! lists) and `playlistVideoRenderer`.

use serde_json::Value;

use super::collaborators::collaborators_in;
use crate::api::innertube::json::age::relative_age;
use crate::api::innertube::json::count::parse_count;
use crate::api::innertube::json::duration::parse_duration;
use crate::api::innertube::json::text::{browse_id_in_runs, text_of};
use crate::api::innertube::json::thumbnail::{
    best_video_thumbnail_url, largest_url, normalize_youtube_image_url,
};
use crate::models::video::VideoSummary;

const RENDERERS: [&str; 4] = [
    "videoRenderer",
    "gridVideoRenderer",
    "compactVideoRenderer",
    "playlistVideoRenderer",
];
const BYLINES: [&str; 3] = ["ownerText", "longBylineText", "shortBylineText"];

/// The video renderer `item` holds, looking inside a `richItemRenderer`.
#[must_use]
pub fn video_renderer(item: &Value) -> Option<&Value> {
    let item = item
        .get("richItemRenderer")
        .map_or(item, |rich| &rich["content"]);
    RENDERERS.iter().find_map(|key| item.get(*key))
}

/// `item` as a video card when it is one of the classic video renderers.
#[must_use]
pub fn video_from_item(item: &Value) -> Option<VideoSummary> {
    video_from_renderer(video_renderer(item)?)
}

/// One classic video renderer as a video card.
#[must_use]
pub fn video_from_renderer(video: &Value) -> Option<VideoSummary> {
    let id = video["videoId"]
        .as_str()
        .filter(|id| !id.is_empty())?
        .to_string();
    let collaborators = BYLINES
        .iter()
        .map(|field| collaborators_in(&video[*field]))
        .chain(std::iter::once(collaborators_in(&video["avatar"])))
        .find(|found| !found.is_empty())
        .unwrap_or_default();
    let channel_id =
        channel_id_of(video).or_else(|| collaborators.first().map(|c| c.channel_id.clone()));
    let is_upcoming = is_upcoming(video);
    let (info_views, info_published) = video_info(video);
    let view_count_text = text_of(&video["viewCountText"])
        .or_else(|| text_of(&video["shortViewCountText"]))
        .or(info_views);
    let badges = badge_labels(video);
    Some(
        VideoSummary {
            title: text_of(&video["title"]).unwrap_or_default(),
            channel_name: BYLINES
                .iter()
                .find_map(|field| text_of(&video[*field]))
                .unwrap_or_default(),
            channel_id,
            thumbnail_url: best_video_thumbnail_url(&id, Some(&video["thumbnail"]["thumbnails"])),
            duration_seconds: duration_of(video),
            published_text: text_of(&video["publishedTimeText"]).or(info_published),
            view_count: (!is_upcoming)
                .then(|| view_count_text.as_deref().and_then(parse_count))
                .flatten(),
            view_count_text,
            channel_avatar_url:
                largest_url(
                    &video["channelThumbnailSupportedRenderers"]["channelThumbnailWithLinkRenderer"]
                        ["thumbnail"]["thumbnails"],
                )
                .or_else(|| largest_url(&video["channelThumbnail"]["thumbnails"]))
                .map(|url| normalize_youtube_image_url(&url)),
            is_live: is_live(video),
            is_upcoming,
            upcoming_start_ms: video["upcomingEventData"]["startTime"]
                .as_str()
                .and_then(|seconds| seconds.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000)),
            is_short: is_short(video),
            is_verified: owner_badge_styles(video).any(|style| style.contains("VERIFIED")),
            is_members_only: badge_styles(video)
                .any(|style| style == "BADGE_STYLE_TYPE_MEMBERS_ONLY"),
            badges,
            collaborators,
            snippet: video["detailedMetadataSnippets"]
                .get(0)
                .and_then(|snippet| text_of(&snippet["snippetText"]))
                .or_else(|| text_of(&video["descriptionSnippet"])),
            id,
        },
    )
}

/// The channel id a classic renderer's byline links to.
#[must_use]
pub fn channel_id_of(video: &Value) -> Option<String> {
    BYLINES
        .iter()
        .find_map(|field| browse_id_in_runs(video, field))
}

/// A live broadcast: a LIVE NOW badge, a LIVE overlay, or a "watching" count.
#[must_use]
pub fn is_live(video: &Value) -> bool {
    badge_styles(video).any(|style| style == "BADGE_STYLE_TYPE_LIVE_NOW")
        || overlay_styles(video).any(|style| style.eq_ignore_ascii_case("LIVE"))
        || video["viewCountText"]["runs"]
            .as_array()
            .is_some_and(|runs| {
                runs.iter().any(|run| {
                    run["text"]
                        .as_str()
                        .is_some_and(|text| text.contains("watching"))
                })
            })
}

/// A playlist row's view count and publish date, which it writes as the runs of
/// one `videoInfo` line ("1.2M views", " • ", "3 years ago").
fn video_info(video: &Value) -> (Option<String>, Option<String>) {
    let mut views = None;
    let mut published = None;
    let runs = video["videoInfo"]["runs"].as_array().into_iter().flatten();
    for text in runs.filter_map(|run| run["text"].as_str()).map(str::trim) {
        if published.is_none() && relative_age(text).is_some() {
            published = Some(text.to_string());
        } else if views.is_none() && parse_count(text).is_some() {
            views = Some(text.to_string());
        }
    }
    (views, published)
}

fn is_upcoming(video: &Value) -> bool {
    video.get("upcomingEventData").is_some()
        || overlay_styles(video).any(|style| style.eq_ignore_ascii_case("UPCOMING"))
}

fn is_short(video: &Value) -> bool {
    let endpoint = &video["navigationEndpoint"];
    overlay_styles(video).any(|style| style.eq_ignore_ascii_case("SHORTS"))
        || endpoint.get("reelWatchEndpoint").is_some()
        || endpoint["commandMetadata"]["webCommandMetadata"]["webPageType"]
            == "WEB_PAGE_TYPE_SHORTS"
}

fn duration_of(video: &Value) -> Option<u64> {
    text_of(&video["lengthText"])
        .as_deref()
        .and_then(parse_duration)
        .or_else(|| {
            video["thumbnailOverlays"]
                .as_array()?
                .iter()
                .find_map(|overlay| {
                    text_of(&overlay["thumbnailOverlayTimeStatusRenderer"]["text"])
                        .as_deref()
                        .and_then(parse_duration)
                })
        })
        .or_else(|| {
            video["lengthSeconds"]
                .as_str()
                .and_then(|seconds| seconds.parse().ok())
                .or_else(|| video["lengthSeconds"].as_u64())
        })
}

fn badge_styles(video: &Value) -> impl Iterator<Item = &str> {
    video["badges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|badge| badge["metadataBadgeRenderer"]["style"].as_str())
}

fn owner_badge_styles(video: &Value) -> impl Iterator<Item = &str> {
    video["ownerBadges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|badge| badge["metadataBadgeRenderer"]["style"].as_str())
}

fn overlay_styles(video: &Value) -> impl Iterator<Item = &str> {
    video["thumbnailOverlays"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|overlay| overlay["thumbnailOverlayTimeStatusRenderer"]["style"].as_str())
}

/// The labels of the card's own badges ("4K", "CC", "New"), leaving out LIVE and
/// members-only, which the card shows in their own way.
fn badge_labels(video: &Value) -> Vec<String> {
    video["badges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|badge| {
            !matches!(
                badge["metadataBadgeRenderer"]["style"].as_str(),
                Some("BADGE_STYLE_TYPE_LIVE_NOW" | "BADGE_STYLE_TYPE_MEMBERS_ONLY")
            )
        })
        .filter_map(|badge| badge["metadataBadgeRenderer"]["label"].as_str())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::renderers::collaborators::tests::dialog;
    use serde_json::json;

    fn search_video() -> Value {
        json!({ "videoRenderer": {
            "videoId": "vid00000001",
            "title": { "runs": [{ "text": "A video" }] },
            "ownerText": { "runs": [{ "text": "Channel", "navigationEndpoint": {
                "browseEndpoint": { "browseId": "UCowner" } } }] },
            "lengthText": { "simpleText": "12:34" },
            "publishedTimeText": { "simpleText": "2 days ago" },
            "viewCountText": { "simpleText": "1,234,567 views" },
            "ownerBadges": [{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_VERIFIED" } }],
            "badges": [
                { "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_SIMPLE", "label": "4K" } },
                { "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_SIMPLE", "label": "New" } }
            ],
            "detailedMetadataSnippets": [{ "snippetText": { "runs": [
                { "text": "about " }, { "text": "gpus", "bold": true }
            ] } }],
            "channelThumbnailSupportedRenderers": { "channelThumbnailWithLinkRenderer": {
                "thumbnail": { "thumbnails": [{ "url": "https://yt3.ggpht.com/a=s68", "width": 68, "height": 68 }] }
            } }
        } })
    }

    #[test]
    fn search_card_carries_badges_counts_and_snippet() {
        let video = video_from_item(&search_video()).unwrap();
        assert_eq!(video.id, "vid00000001");
        assert_eq!(video.channel_id.as_deref(), Some("UCowner"));
        assert_eq!(video.duration_seconds, Some(754));
        assert_eq!(video.view_count, Some(1_234_567));
        assert!(video.is_verified);
        assert_eq!(video.badges, ["4K", "New"]);
        assert_eq!(video.snippet.as_deref(), Some("about gpus"));
        assert_eq!(
            video.channel_avatar_url.as_deref(),
            Some("https://yt3.ggpht.com/a=s512")
        );
        assert!(!video.is_upcoming && !video.is_short && !video.is_live);
    }

    #[test]
    fn upcoming_short_live_and_members_only() {
        let upcoming = video_from_renderer(&json!({
            "videoId": "up",
            "upcomingEventData": { "startTime": "1790000000" },
            "viewCountText": { "runs": [{ "text": "12" }, { "text": " waiting" }] },
        }))
        .unwrap();
        assert!(upcoming.is_upcoming);
        assert_eq!(upcoming.upcoming_start_ms, Some(1_790_000_000_000));
        assert_eq!(upcoming.view_count, None, "waiting viewers are not views");

        let short = video_from_renderer(&json!({
            "videoId": "sh",
            "navigationEndpoint": { "reelWatchEndpoint": { "videoId": "sh" } }
        }))
        .unwrap();
        assert!(short.is_short);

        let live = video_from_renderer(&json!({
            "videoId": "lv",
            "badges": [{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_LIVE_NOW", "label": "LIVE" } }],
            "viewCountText": { "runs": [{ "text": "1.2K" }, { "text": " watching" }] }
        }))
        .unwrap();
        assert!(live.is_live);
        assert_eq!(live.view_count_text.as_deref(), Some("1.2K watching"));
        assert!(live.badges.is_empty());

        let members = video_from_renderer(&json!({
            "videoId": "mo",
            "badges": [{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_MEMBERS_ONLY", "label": "Members only" } }]
        }))
        .unwrap();
        assert!(members.is_members_only);
    }

    #[test]
    fn collaboration_takes_the_lead_channel() {
        let video = video_from_renderer(&json!({
            "videoId": "co",
            "ownerText": { "runs": [{ "text": "CNET and Engadget", "navigationEndpoint":
                dialog(&[("UC1", "CNET"), ("UC2", "Engadget")]) }] }
        }))
        .unwrap();
        assert_eq!(video.channel_id.as_deref(), Some("UC1"));
        assert_eq!(video.collaborators.len(), 2);
    }

    #[test]
    fn playlist_rows_read_length_seconds() {
        let row = video_from_item(&json!({ "playlistVideoRenderer": {
            "videoId": "pl", "lengthSeconds": "125", "title": { "runs": [{ "text": "Row" }] },
            "videoInfo": { "runs": [{ "text": "1.2M views" }, { "text": " • " }, { "text": "3 years ago" }] }
        } }))
        .unwrap();
        assert_eq!(row.duration_seconds, Some(125));
        assert_eq!(row.view_count_text.as_deref(), Some("1.2M views"));
        assert_eq!(row.published_text.as_deref(), Some("3 years ago"));
        assert_eq!(row.view_count, Some(1_200_000));
    }
}
