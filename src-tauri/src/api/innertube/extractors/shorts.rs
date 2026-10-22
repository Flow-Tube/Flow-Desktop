use base64::Engine;
use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::errors::AppResult;
use crate::models::shorts::{ShortItem, ShortsFeed};
use crate::streaming::sabr::pb::PbWriter;

/// How many reels of a page get their title and channel looked up before
/// ranking: the sequence names reels and nothing else, and each lookup is a
/// request of its own.
const OVERLAY_FILL_LIMIT: usize = 10;
const OVERLAY_CONCURRENCY: usize = 5;
/// The whole lookup's budget, so a slow connection costs titles rather than
/// the reel lane: lookups still running at the deadline are dropped.
const OVERLAY_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

/// `sequenceParams` sentinel for the home Shorts feed (no seed video). Raw base64
/// (`=`, not URL-encoded `%3D`) — the JSON body must carry the decoded token.
const HOME_SEQUENCE_PARAMS: &str = "CA8=";

/// The `sequenceParams` token that seeds a reel sequence from a video: protobuf `{1: videoId}`,
/// base64url without padding. As Flow for Android found (#931), this is the only accepted seed;
/// the same token in `params` is rejected with HTTP 400. The response never contains the seed.
#[must_use]
pub fn encode_reel_seed_params(video_id: &str) -> String {
    let mut writer = PbWriter::new();
    writer.write_string(1, video_id);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(writer.into_bytes())
}

impl InnertubeClient {
    /// Fetch a sequence of Shorts from `reel/reel_watch_sequence`.
    ///
    /// Home feed: `sequence_params = None`. Seeded from a video:
    /// `sequence_params = Some(encode_reel_seed_params(id))`. Next page: the page's token.
    /// IOS is asked first: its page is a few kilobytes per reel, where ANDROID's
    /// carries a prefetch of every reel's player response and runs to megabytes
    /// for the same reels (Flow for Android measured the same). Neither names a
    /// reel's title or channel: see [`Self::fill_reel_overlays`].
    pub async fn get_shorts_sequence(
        &self,
        sequence_params: Option<String>,
        region: Option<String>,
    ) -> AppResult<ShortsFeed> {
        let visitor_data = self.fetch_visitor_data().await;
        let region = region
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_uppercase)
            .filter(|value| value.len() == 2 && value.chars().all(|c| c.is_ascii_alphabetic()));
        let payload_params = sequence_params.unwrap_or_else(|| HOME_SEQUENCE_PARAMS.to_string());

        let mut feed = ShortsFeed::default();
        let mut last_error = None;
        for client in [&clients::IOS, &clients::ANDROID] {
            let mut payload = json!({
                "context": client.context(visitor_data.as_deref(), region.as_deref()),
                "sequenceParams": payload_params,
            });
            match self
                .post_innertube("reel/reel_watch_sequence", client, &mut payload)
                .await
            {
                Ok(res) => {
                    feed = parse_reel_sequence(&res);
                    if !feed.items.is_empty() {
                        tracing::info!(
                            client = client.name,
                            items = feed.items.len(),
                            "[shorts] reel sequence page"
                        );
                        break;
                    }
                }
                Err(error) => last_error = Some(error),
            }
        }
        if feed.items.is_empty()
            && let Some(error) = last_error
        {
            return Err(error);
        }
        Ok(feed)
    }

    /// Title, channel and counts for the first reels that came without them,
    /// from `reel/reel_item_watch` with the player response left out.
    pub async fn fill_reel_overlays(&self, items: &mut [ShortItem]) {
        let missing: Vec<(usize, String)> = items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.channel_id.is_none())
            .take(OVERLAY_FILL_LIMIT)
            .map(|(index, item)| (index, item.id.clone()))
            .collect();
        let deadline = tokio::time::Instant::now() + OVERLAY_BUDGET;
        let overlays = crate::api::http::bounded_join(
            missing,
            OVERLAY_CONCURRENCY,
            |(index, video_id)| async move {
                let mut payload = json!({
                    "playerRequest": { "videoId": video_id },
                    "disablePlayerResponse": true,
                });
                let answer = tokio::time::timeout_at(
                    deadline,
                    self.post_innertube("reel/reel_item_watch", &clients::WEB, &mut payload),
                )
                .await;
                (index, answer.ok().and_then(Result::ok))
            },
        )
        .await;
        for (index, answer) in overlays {
            if let (Some(item), Some(answer)) = (items.get_mut(index), answer) {
                apply_reel_overlay(item, &answer);
            }
        }
    }
}

/// Fill what `reel_item_watch` says about a reel into `item`, keeping anything
/// the sequence already named. Its overlay is a view model on WEB.
fn apply_reel_overlay(item: &mut ShortItem, answer: &Value) {
    let overlay = &answer["overlay"]["reelPlayerOverlayRenderer"];
    let view = &overlay["playerOverlay"]["reelPlayerOverlayViewModel"];
    let metadata = view["metapanel"]["reelMetapanelViewModel"]["metadataItems"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let buttons = view["actionBar"]["reelActionBarViewModel"]["buttonViewModels"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let channel_bar = metadata
        .iter()
        .find_map(|entry| entry.get("reelChannelBarViewModel"));
    if let Some(title) = metadata
        .iter()
        .find_map(|entry| entry["shortsVideoTitleViewModel"]["text"]["content"].as_str())
        .filter(|title| !title.trim().is_empty())
        && (item.title.is_empty() || item.title == "Short")
    {
        item.title = title.trim().to_string();
    }
    if let Some(bar) = channel_bar {
        if item.channel_id.is_none() {
            item.channel_id = bar["channelName"]["commandRuns"]
                .as_array()
                .into_iter()
                .flatten()
                .find_map(|run| {
                    run["onTap"]["innertubeCommand"]["browseEndpoint"]["browseId"].as_str()
                })
                .map(ToOwned::to_owned);
        }
        if item.channel_name.is_empty()
            && let Some(name) = bar["channelName"]["content"].as_str()
        {
            item.channel_name = name.to_string();
        }
        if item.channel_avatar_url.is_none() {
            item.channel_avatar_url = largest_url(
                &bar["decoratedAvatarViewModel"]["decoratedAvatarViewModel"]["avatar"]["avatarViewModel"]["image"]
                    ["sources"],
            )
            .map(|url| normalize_youtube_image_url(&url));
        }
    }
    if item.like_count_text.is_none() {
        item.like_count_text = buttons.iter().find_map(|button| {
            button["likeButtonViewModel"]["toggleButtonViewModel"]["toggleButtonViewModel"]["defaultButtonViewModel"]
                ["buttonViewModel"]["title"]
                .as_str()
                .map(ToOwned::to_owned)
        });
    }
    if item.comment_count_text.is_none() {
        item.comment_count_text = buttons
            .iter()
            .map(|button| &button["buttonViewModel"])
            .find(|button| button["iconName"] == "SHORTS_COMMENT")
            .and_then(|button| button["title"].as_str())
            .map(ToOwned::to_owned);
    }
    if item.published_text.is_none() {
        item.published_text = text_of(
            &overlay["reelPlayerHeaderSupportedRenderers"]["reelPlayerHeaderRenderer"]["timestampText"],
        );
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
            // Ads are named by `videoType` on the app clients and carry
            // `adClientParams` everywhere; they are ordinary uploads to the
            // player, so nothing later could tell them apart.
            if endpoint["videoType"] == "REEL_VIDEO_TYPE_AD"
                || !endpoint["adClientParams"].is_null()
                || !entry["adClientParams"].is_null()
            {
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

    let channel_avatar_url = largest_url(&header["channelThumbnail"]["thumbnails"])
        .or_else(|| largest_url(&metadata["channelThumbnail"]["thumbnails"]))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_params_encode_field_one() {
        let encoded = encode_reel_seed_params("3RmOvxilbPM");
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .unwrap();
        assert_eq!(bytes[0], 0x0a);
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

    #[test]
    fn ios_ads_are_named_by_their_video_type() {
        let res = json!({ "entries": [
            { "command": { "reelWatchEndpoint": { "videoId": "ad000000001", "videoType": "REEL_VIDEO_TYPE_AD" } } },
            { "command": { "reelWatchEndpoint": { "videoId": "vid00000002", "videoType": "REEL_VIDEO_TYPE_VIDEO" } } }
        ], "continuation": "NEXT" });
        let feed = parse_reel_sequence(&res);
        assert_eq!(feed.items.len(), 1);
        assert_eq!(feed.items[0].id, "vid00000002");
        assert_eq!(feed.continuation.as_deref(), Some("NEXT"));
    }

    #[test]
    fn the_item_watch_overlay_fills_title_channel_and_counts() {
        let mut item = parse_reel_entry("vid00000003", &Value::Null);
        assert_eq!(item.title, "Short");
        let answer = json!({ "overlay": { "reelPlayerOverlayRenderer": {
            "reelPlayerHeaderSupportedRenderers": { "reelPlayerHeaderRenderer": {
                "timestampText": { "simpleText": "2 days ago" }
            } },
            "playerOverlay": { "reelPlayerOverlayViewModel": {
                "metapanel": { "reelMetapanelViewModel": { "metadataItems": [
                    { "reelChannelBarViewModel": {
                        "channelName": { "content": "@creator", "commandRuns": [{ "onTap": { "innertubeCommand": {
                            "browseEndpoint": { "browseId": "UCcreator" } } } }] },
                        "decoratedAvatarViewModel": { "decoratedAvatarViewModel": { "avatar": { "avatarViewModel": {
                            "image": { "sources": [{ "url": "https://yt3.ggpht.com/a=s48-c-k-c0x00ffffff-no-rj" }] } } } } }
                    } },
                    { "shortsVideoTitleViewModel": { "text": { "content": "A real title " } } }
                ] } },
                "actionBar": { "reelActionBarViewModel": { "buttonViewModels": [
                    { "likeButtonViewModel": { "toggleButtonViewModel": { "toggleButtonViewModel": {
                        "defaultButtonViewModel": { "buttonViewModel": { "title": "58K" } } } } } },
                    { "buttonViewModel": { "iconName": "SHORTS_COMMENT", "title": "662" } }
                ] } }
            } }
        } } });
        apply_reel_overlay(&mut item, &answer);
        assert_eq!(item.title, "A real title");
        assert_eq!(item.channel_id.as_deref(), Some("UCcreator"));
        assert_eq!(item.channel_name, "@creator");
        assert!(item.channel_avatar_url.is_some());
        assert_eq!(item.like_count_text.as_deref(), Some("58K"));
        assert_eq!(item.comment_count_text.as_deref(), Some("662"));
        assert_eq!(item.published_text.as_deref(), Some("2 days ago"));
    }
}
