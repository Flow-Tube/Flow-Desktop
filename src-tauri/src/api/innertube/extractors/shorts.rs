use base64::Engine;
use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::context::get_android_context;
use crate::api::innertube::core::utils::normalize_youtube_image_url;
use crate::errors::AppResult;
use crate::models::shorts::{ShortItem, ShortsFeed};
use crate::streaming::sabr::pb::PbWriter;

/// `sequenceParams` sentinel for the home Shorts feed (no seed video). Raw base64
/// (`=`, not URL-encoded `%3D`) — the JSON body must carry the decoded token.
const HOME_SEQUENCE_PARAMS: &str = "CA8=";

/// Encode the `params` token that seeds a reel sequence from a video. The wire
/// shape is field 2 (length-delimited) holding the id, base64url'd without padding.
#[must_use]
pub fn encode_reel_seed_params(video_id: &str) -> String {
    let mut writer = PbWriter::new();
    writer.write_string(2, video_id);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(writer.into_bytes())
}

impl InnertubeClient {
    /// Fetch a sequence of Shorts from `reel/reel_watch_sequence`.
    ///
    /// Home feed: `sequence_params = None`. Seeded from a video:
    /// `params = Some(encode_reel_seed_params(id))`. Next page: `sequence_params = Some(token)`.
    /// The iOS client is used because it returns the portrait overlay renderers.
    pub async fn get_shorts_sequence(
        &self,
        params: Option<String>,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        let started = std::time::Instant::now();
        let visitor_data = self.fetch_visitor_data().await;
        tracing::info!(
            elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            resolved = visitor_data.is_some(),
            "[shorts] reel visitor_data step"
        );
        let mut context = get_android_context(visitor_data);
        if let Some(region) = region.as_deref() {
            let cleaned = region.trim().to_ascii_uppercase();
            if cleaned.len() == 2 && cleaned.chars().all(|c| c.is_ascii_alphabetic()) {
                context["client"]["gl"] = json!(cleaned);
            }
        }

        let mut payload = json!({ "context": context });
        if let Some(params) = params {
            payload["params"] = json!(params);
        }
        // A seed uses `params` alone; only fall back to the home sentinel when
        // neither a seed nor an explicit continuation was supplied.
        if let Some(seq) = sequence_params {
            payload["sequenceParams"] = json!(seq);
        } else if payload.get("params").is_none() {
            payload["sequenceParams"] = json!(HOME_SEQUENCE_PARAMS);
        }

        let res = self
            .post_innertube(
                "reel/reel_watch_sequence",
                "ANDROID",
                "21.03.38",
                &mut payload,
            )
            .await?;

        let feed = parse_reel_sequence(&res);
        if feed.items.is_empty() {
            tracing::warn!(
                "[shorts] reel_watch_sequence parsed 0 items. top-level keys: {:?}",
                res.as_object()
                    .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
            );
        } else {
            tracing::info!(
                "[shorts] reel_watch_sequence parsed {} items",
                feed.items.len()
            );
        }
        Ok(feed)
    }
}

/// Walk the `entries` array into Shorts, pruning ads, then resolve the next-page token.
fn parse_reel_sequence(res: &Value) -> ShortsFeed {
    let mut items = Vec::new();

    if let Some(entries) = res["entries"].as_array() {
        for entry in entries {
            let endpoint = &entry["command"]["reelWatchEndpoint"];
            if endpoint.is_null() {
                continue;
            }
            // Ads carry `adClientParams` on the endpoint or the entry itself.
            if !endpoint["adClientParams"].is_null() || !entry["adClientParams"].is_null() {
                continue;
            }
            let Some(video_id) = endpoint["videoId"].as_str().filter(|id| !id.is_empty()) else {
                continue;
            };
            items.push(parse_reel_entry(video_id, endpoint));
        }
    }

    // The last entry's own sequence params seed the next page (matches YouTube's app).
    let last_sequence_params = items.last().and_then(|item| item.sequence_params.clone());

    ShortsFeed {
        items,
        continuation: extract_reel_continuation(res, last_sequence_params),
    }
}

fn parse_reel_entry(video_id: &str, endpoint: &Value) -> ShortItem {
    let overlay = &endpoint["overlay"]["reelPlayerOverlayRenderer"];
    let metadata = &overlay["reelMetadata"]["reelMetadataRenderer"];
    let header = &overlay["reelPlayerHeaderSupportedRenderers"]["reelPlayerHeaderRenderer"];

    let title = reel_text(&header["reelTitleOnExpandedStateRenderer"]["dynamicTextContent"])
        .or_else(|| reel_text(&header["reelTitleOnExpandedStateRenderer"]["simpleTitleText"]))
        .or_else(|| reel_text(&overlay["reelTitleText"]))
        .unwrap_or_else(|| "Short".to_string());

    let channel_name = reel_text(&header["channelTitleText"])
        .or_else(|| reel_text(&metadata["channelTitle"]))
        .unwrap_or_default();

    let channel_id = header["channelNavigationEndpoint"]["browseEndpoint"]["browseId"]
        .as_str()
        .or_else(|| metadata["channelNavigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        .or_else(|| endpoint["navigationEndpoint"]["browseEndpoint"]["browseId"].as_str())
        .map(ToOwned::to_owned);

    let channel_avatar_url = last_thumbnail_url(&header["channelThumbnail"]["thumbnails"])
        .or_else(|| last_thumbnail_url(&metadata["channelThumbnail"]["thumbnails"]))
        .map(|url| normalize_youtube_image_url(&url));

    let view_count_text =
        reel_text(&overlay["viewCountText"]).or_else(|| reel_text(&metadata["viewCountText"]));

    let like_count_text = reel_text(&overlay["likeButton"]["toggleButtonRenderer"]["defaultText"])
        .or_else(|| {
            reel_accessibility_count(
                &overlay["likeButton"]["toggleButtonRenderer"]["accessibilityData"]
                    ["accessibilityData"]["label"],
            )
        });

    let comment_button = &overlay["commentButton"];
    let comment_count_text = comment_button["buttonViewModel"]["title"]
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| reel_text(&comment_button["reelCommentButtonRenderer"]["commentCountText"]))
        .or_else(|| reel_text(&comment_button["reelCommentButtonRenderer"]["commentCount"]))
        .or_else(|| reel_text(&comment_button["buttonRenderer"]["text"]));

    ShortItem {
        id: video_id.to_string(),
        title,
        channel_name,
        channel_id,
        thumbnail_url: ShortItem::default_thumbnail(video_id),
        channel_avatar_url,
        view_count_text,
        like_count_text,
        comment_count_text,
        published_text: reel_text(&header["timestampText"]),
        sequence_params: endpoint["sequenceParams"].as_str().map(ToOwned::to_owned),
    }
}

/// Resolve the pagination token, preferring the explicit continuation fields and
/// falling back to the last entry's sequence params.
fn extract_reel_continuation(res: &Value, last_sequence_params: Option<String>) -> Option<String> {
    res["continuation"]
        .as_str()
        .or_else(|| {
            res["continuationEndpoint"]["reelWatchSequenceEndpoint"]["sequenceParams"].as_str()
        })
        .or_else(|| res["continuationEndpoint"]["continuationCommand"]["token"].as_str())
        .map(ToOwned::to_owned)
        .or(last_sequence_params)
}

/// Read a text node (`simpleText` or joined `runs`).
fn reel_text(value: &Value) -> Option<String> {
    if let Some(simple) = value["simpleText"].as_str().filter(|s| !s.is_empty()) {
        return Some(simple.to_string());
    }
    if let Some(runs) = value["runs"].as_array() {
        let joined: String = runs.iter().filter_map(|run| run["text"].as_str()).collect();
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    None
}

/// Pull a compact like count out of an accessibility label like "12,345 likes".
// View/like counts are well under 2^52, so the f64 cast is exact in practice.
#[allow(clippy::cast_precision_loss)]
fn reel_accessibility_count(label: &Value) -> Option<String> {
    let digits: String = label
        .as_str()?
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    let count: u64 = digits.parse().ok()?;
    Some(match count {
        n if n >= 1_000_000_000 => format!("{:.1}B", n as f64 / 1_000_000_000.0),
        n if n >= 1_000_000 => format!("{:.1}M", n as f64 / 1_000_000.0),
        n if n >= 1_000 => format!("{:.1}K", n as f64 / 1_000.0),
        n => n.to_string(),
    })
}

fn last_thumbnail_url(thumbnails: &Value) -> Option<String> {
    thumbnails
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|thumb| thumb["url"].as_str())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_params_encode_field_two() {
        let encoded = encode_reel_seed_params("3RmOvxilbPM");
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .unwrap();
        assert_eq!(bytes[0], 0x12);
        assert_eq!(bytes[1] as usize, "3RmOvxilbPM".len());
        assert_eq!(&bytes[2..], b"3RmOvxilbPM");
    }

    #[test]
    fn parses_entries_and_skips_ads() {
        let res = json!({
            "entries": [
                {
                    "command": { "reelWatchEndpoint": {
                        "videoId": "vid00000001",
                        "sequenceParams": "SEQ1",
                        "overlay": { "reelPlayerOverlayRenderer": {
                            "reelTitleText": { "runs": [{ "text": "Hello " }, { "text": "World" }] },
                            "viewCountText": { "simpleText": "1.2M views" },
                            "reelPlayerHeaderSupportedRenderers": { "reelPlayerHeaderRenderer": {
                                "channelTitleText": { "simpleText": "Creator" },
                                "channelNavigationEndpoint": { "browseEndpoint": { "browseId": "UC123" } }
                            }}
                        }}
                    }}
                },
                {
                    "command": { "reelWatchEndpoint": {
                        "videoId": "ad000000002",
                        "adClientParams": { "isAd": true }
                    }}
                }
            ]
        });

        let feed = parse_reel_sequence(&res);
        assert_eq!(feed.items.len(), 1, "ad entry must be pruned");
        let short = &feed.items[0];
        assert_eq!(short.id, "vid00000001");
        assert_eq!(short.title, "Hello World");
        assert_eq!(short.channel_name, "Creator");
        assert_eq!(short.channel_id.as_deref(), Some("UC123"));
        assert_eq!(short.view_count_text.as_deref(), Some("1.2M views"));
        assert_eq!(feed.continuation.as_deref(), Some("SEQ1"));
    }
}
