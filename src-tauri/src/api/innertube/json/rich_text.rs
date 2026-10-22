//! Attributed text (`content` plus `commandRuns` and `attachmentRuns`), as
//! descriptions and comments carry it, read into [`RichText`]. Ported from Flow
//! for Android's `toRichText`.

use serde_json::Value;

use crate::api::innertube::json::thumbnail::largest_url;
use crate::models::rich_text::{RichEmoji, RichSpan, RichTarget, RichText};

/// `attributed`'s text and spans. `own_video_id` tells a timestamp in this
/// video from a link to another one.
#[must_use]
pub fn rich_text(attributed: &Value, own_video_id: Option<&str>) -> Option<RichText> {
    let text = attributed["content"].as_str()?;
    let units = text.encode_utf16().count();
    let fits =
        |start: usize, length: usize| start.checked_add(length).is_some_and(|end| end <= units);
    let spans = attributed["commandRuns"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|run| {
            let (start, length) = run_range(run)?;
            if length == 0 || !fits(start, length) {
                return None;
            }
            Some(RichSpan {
                start,
                length,
                target: target(&run["onTap"]["innertubeCommand"], own_video_id)?,
            })
        })
        .collect();
    let emojis = attributed["attachmentRuns"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|run| {
            let (start, length) = run_range(run)?;
            if !fits(start, length) {
                return None;
            }
            let element = &run["element"];
            let image_url = largest_url(&element["type"]["imageType"]["image"]["sources"])?;
            let label = element["properties"]["accessibilityProperties"]["label"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            // A standard emoji is drawn over its own character, which the text
            // already shows; only custom emoji need their picture.
            let covered: Vec<u16> = text.encode_utf16().skip(start).take(length).collect();
            if String::from_utf16_lossy(&covered) == label {
                return None;
            }
            Some(RichEmoji {
                start,
                length,
                image_url,
                label,
            })
        })
        .collect();
    Some(RichText {
        text: text.to_string(),
        spans,
        emojis,
    })
}

fn run_range(run: &Value) -> Option<(usize, usize)> {
    Some((
        usize::try_from(run["startIndex"].as_u64()?).ok()?,
        usize::try_from(run["length"].as_u64()?).ok()?,
    ))
}

fn target(command: &Value, own_video_id: Option<&str>) -> Option<RichTarget> {
    if let Some(watch) = command.get("watchEndpoint") {
        let video_id = watch["videoId"].as_str()?;
        let start_seconds = watch["startTimeSeconds"].as_u64();
        return Some(match start_seconds {
            Some(seconds) if Some(video_id) == own_video_id => RichTarget::Timestamp { seconds },
            _ => RichTarget::Video {
                video_id: video_id.to_string(),
                start_seconds,
            },
        });
    }
    if let Some(browse) = command.get("browseEndpoint") {
        let browse_id = browse["browseId"].as_str()?;
        if let Some(tag) = browse["canonicalBaseUrl"]
            .as_str()
            .and_then(|url| url.strip_prefix("/hashtag/"))
        {
            return Some(RichTarget::Hashtag {
                tag: format!("#{tag}"),
            });
        }
        if let Some(playlist_id) = browse_id.strip_prefix("VL") {
            return Some(RichTarget::Playlist {
                playlist_id: playlist_id.to_string(),
            });
        }
        if browse_id.starts_with("UC") {
            return Some(RichTarget::Channel {
                channel_id: browse_id.to_string(),
            });
        }
    }
    let url = command["urlEndpoint"]["url"]
        .as_str()
        .or_else(|| command["commandMetadata"]["webCommandMetadata"]["url"].as_str())?;
    Some(RichTarget::Url {
        url: unwrap_redirect(url),
    })
}

/// Outbound links are printed as `youtube.com/redirect?...&q=<target>`; this
/// recovers the destination the reader would expect to see and open.
#[must_use]
pub fn unwrap_redirect(url: &str) -> String {
    let absolute = if url.starts_with('/') {
        format!("https://www.youtube.com{url}")
    } else {
        url.to_string()
    };
    reqwest::Url::parse(&absolute)
        .ok()
        .filter(|parsed| parsed.path() == "/redirect")
        .and_then(|parsed| {
            parsed
                .query_pairs()
                .find(|(key, _)| key == "q")
                .map(|(_, value)| value.into_owned())
        })
        .unwrap_or(absolute)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(start: u64, length: u64, command: &Value) -> Value {
        json!({ "startIndex": start, "length": length, "onTap": { "innertubeCommand": command } })
    }

    #[test]
    fn each_link_gets_its_target() {
        let attributed = json!({
            "content": "0:42 see #music by @Rick at https://example.com and another video",
            "commandRuns": [
                run(0, 4, &json!({ "watchEndpoint": { "videoId": "own00000000", "startTimeSeconds": 42 } })),
                run(9, 6, &json!({ "browseEndpoint": { "browseId": "FEhashtag", "canonicalBaseUrl": "/hashtag/music" } })),
                run(19, 5, &json!({ "browseEndpoint": { "browseId": "UCuAXFkgsw1L7xaCfnd5JJOw" } })),
                run(28, 19, &json!({ "urlEndpoint": { "url": "https://www.youtube.com/redirect?event=x&q=https%3A%2F%2Fexample.com%2F" } })),
                run(52, 13, &json!({ "watchEndpoint": { "videoId": "other000000" } }))
            ]
        });
        let rich = rich_text(&attributed, Some("own00000000")).expect("content");
        let targets: Vec<&RichTarget> = rich.spans.iter().map(|span| &span.target).collect();
        assert_eq!(
            targets,
            [
                &RichTarget::Timestamp { seconds: 42 },
                &RichTarget::Hashtag {
                    tag: "#music".into()
                },
                &RichTarget::Channel {
                    channel_id: "UCuAXFkgsw1L7xaCfnd5JJOw".into()
                },
                &RichTarget::Url {
                    url: "https://example.com/".into()
                },
                &RichTarget::Video {
                    video_id: "other000000".into(),
                    start_seconds: None
                },
            ]
        );
    }

    #[test]
    fn spans_past_the_text_are_dropped() {
        let attributed = json!({
            "content": "short",
            "commandRuns": [run(2, 10, &json!({ "urlEndpoint": { "url": "https://a.b" } }))]
        });
        assert!(
            rich_text(&attributed, None)
                .expect("content")
                .spans
                .is_empty()
        );
    }

    #[test]
    fn only_custom_emoji_keep_their_picture() {
        // "😭" is two UTF-16 units; the custom emoji is a placeholder word.
        let attributed = json!({
            "content": "ok 😭 :yt:",
            "attachmentRuns": [
                { "startIndex": 3, "length": 2, "element": { "type": { "imageType": { "image": {
                    "sources": [{ "url": "https://e/cry.png" }] } } },
                    "properties": { "accessibilityProperties": { "label": "😭" } } } },
                { "startIndex": 6, "length": 4, "element": { "type": { "imageType": { "image": {
                    "sources": [{ "url": "https://e/yt.png" }] } } },
                    "properties": { "accessibilityProperties": { "label": "yt" } } } }
            ]
        });
        let rich = rich_text(&attributed, None).expect("content");
        assert_eq!(rich.emojis.len(), 1);
        assert_eq!(rich.emojis[0].image_url, "https://e/yt.png");
        assert_eq!((rich.emojis[0].start, rich.emojis[0].length), (6, 4));
    }

    #[test]
    fn redirects_are_unwrapped_and_plain_links_kept() {
        assert_eq!(
            unwrap_redirect("/redirect?q=https%3A%2F%2Fexample.com&v=1"),
            "https://example.com"
        );
        assert_eq!(unwrap_redirect("https://a.b/c"), "https://a.b/c");
    }
}
