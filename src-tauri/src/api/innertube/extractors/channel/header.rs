//! The channel header, from whichever generation the response uses: the
//! `pageHeaderViewModel`, the older `c4TabbedHeaderRenderer`, and the
//! `channelMetadataRenderer` beneath both. Each field falls through on its own.

use serde_json::Value;

use super::about::first_token;
use super::tabs::tabs;
use crate::api::innertube::json::count::parse_count;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::models::channel::ChannelDetails;

fn page_header(page: &Value) -> &Value {
    &page["header"]["pageHeaderRenderer"]["content"]["pageHeaderViewModel"]
}

/// One part of the header's metadata rows: "@handle", "16.9M subscribers", "7.9K videos".
struct MetadataPart {
    text: String,
    has_accessibility_label: bool,
}

/// The header's metadata parts, row after row.
fn metadata_parts(header: &Value) -> Vec<MetadataPart> {
    header["metadata"]["contentMetadataViewModel"]["metadataRows"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["metadataParts"].as_array().into_iter().flatten())
        .filter_map(|part| {
            let text = text_of(&part["text"])?.trim().to_string();
            (!text.is_empty()).then(|| MetadataPart {
                text,
                has_accessibility_label: part["accessibilityLabel"].is_string(),
            })
        })
        .collect()
}

/// The subscriber and video counts as written. The parts carry no field names
/// and their words follow the content language, so they are told apart by
/// shape, as Flow for Android does: only the subscriber count has an
/// accessibility label (seen in en, es, ja and ar). Without one, two parts are
/// subscribers then videos, and a lone part is the video count of a channel
/// that hides its subscribers.
fn counts(parts: &[MetadataPart]) -> (Option<String>, Option<String>) {
    let counts: Vec<&MetadataPart> = parts
        .iter()
        .filter(|part| !part.text.starts_with('@'))
        .collect();
    let subscribers = counts
        .iter()
        .position(|part| part.has_accessibility_label)
        .or_else(|| {
            counts
                .iter()
                .position(|part| part.text.to_lowercase().contains("subscriber"))
        })
        .or_else(|| (counts.len() >= 2).then_some(0));
    let videos = counts
        .iter()
        .enumerate()
        .find(|(index, _)| Some(*index) != subscribers)
        .map(|(_, part)| part.text.clone());
    (subscribers.map(|index| counts[index].text.clone()), videos)
}

#[must_use]
pub fn parse_header(page: &Value, requested_id: &str) -> ChannelDetails {
    let header = page_header(page);
    let legacy = &page["header"]["c4TabbedHeaderRenderer"];
    let metadata = &page["metadata"]["channelMetadataRenderer"];
    let parts = metadata_parts(header);
    let (subscribers, videos) = counts(&parts);
    let subscriber_count_text = subscribers.or_else(|| text_of(&legacy["subscriberCountText"]));
    let title = &header["title"]["dynamicTextViewModel"]["text"];
    ChannelDetails {
        id: metadata["externalId"]
            .as_str()
            .or_else(|| metadata["externalChannelId"].as_str())
            .or_else(|| legacy["channelId"].as_str())
            .unwrap_or(requested_id)
            .to_string(),
        name: text_of(title)
            .or_else(|| metadata["title"].as_str().map(ToOwned::to_owned))
            .or_else(|| text_of(&legacy["title"]))
            .unwrap_or_default(),
        handle: parts
            .iter()
            .find(|part| part.text.starts_with('@'))
            .map(|part| part.text.clone())
            .or_else(|| {
                metadata["vanityChannelUrl"]
                    .as_str()
                    .and_then(|url| url.rsplit('/').next())
                    .filter(|handle| handle.starts_with('@'))
                    .map(ToOwned::to_owned)
            }),
        description: metadata["description"]
            .as_str()
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                text_of(&header["description"]["descriptionPreviewViewModel"]["description"])
            }),
        avatar_url:
            largest_url(
                &header["image"]["decoratedAvatarViewModel"]["avatar"]["avatarViewModel"]["image"]
                    ["sources"],
            )
            .or_else(|| largest_url(&metadata["avatar"]["thumbnails"]))
            .or_else(|| largest_url(&legacy["avatar"]["thumbnails"]))
            .map(|url| normalize_youtube_image_url(&url)),
        banner_url: largest_url(&header["banner"]["imageBannerViewModel"]["image"]["sources"])
            .or_else(|| largest_url(&legacy["banner"]["thumbnails"]))
            .map(|url| {
                url.strip_prefix("//")
                    .map_or(url.clone(), |rest| format!("https://{rest}"))
            }),
        subscriber_count: subscriber_count_text.as_deref().and_then(parse_count),
        subscriber_count_text,
        video_count_text: videos.or_else(|| text_of(&legacy["videosCountText"])),
        verified: title["attachmentRuns"].to_string().contains("CHECK_CIRCLE")
            || legacy["badges"]
                .to_string()
                .contains("BADGE_STYLE_TYPE_VERIFIED"),
        tabs: tabs(page),
        // Only the description's "...more" and the links' "and N more" carry it.
        about_token: first_token(&header["description"])
            .or_else(|| first_token(&header["attribution"])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_header_reads_its_handle_counts_badge_and_about_token() {
        let page = json!({
            "metadata": { "channelMetadataRenderer": { "externalId": "UCXuqSBlHAE6Xw-yeJA0Tunw", "title": "Linus Tech Tips" } },
            "header": { "pageHeaderRenderer": { "content": { "pageHeaderViewModel": {
                "title": { "dynamicTextViewModel": { "text": { "content": "Linus Tech Tips",
                    "attachmentRuns": [{ "element": { "type": { "imageType": { "image": { "sources": [
                        { "clientResource": { "imageName": "CHECK_CIRCLE_FILLED" } }
                    ] } } } } }] } } },
                "metadata": { "contentMetadataViewModel": { "metadataRows": [
                    { "metadataParts": [{ "text": { "content": "@LinusTechTips" } }] },
                    { "metadataParts": [{ "text": { "content": "16.9M subscribers" } }, { "text": { "content": "7.9K videos" } }] }
                ] } },
                "description": { "descriptionPreviewViewModel": { "rendererContext": { "commandContext": { "onTap": {
                    "innertubeCommand": { "showEngagementPanelEndpoint": { "engagementPanel": { "content": {
                        "continuationItemRenderer": { "continuationEndpoint": { "continuationCommand": { "token": "ABOUT" } } }
                    } } } }
                } } } } }
            } } } }
        });
        let details = parse_header(&page, "UCx");
        assert_eq!(details.id, "UCXuqSBlHAE6Xw-yeJA0Tunw");
        assert_eq!(details.handle.as_deref(), Some("@LinusTechTips"));
        assert_eq!(
            details.subscriber_count_text.as_deref(),
            Some("16.9M subscribers")
        );
        assert_eq!(details.video_count_text.as_deref(), Some("7.9K videos"));
        assert!(
            details
                .subscriber_count
                .is_some_and(|count| count > 16_000_000)
        );
        assert!(details.verified);
        assert_eq!(details.about_token.as_deref(), Some("ABOUT"));
    }

    fn page_with_rows(rows: &serde_json::Value) -> serde_json::Value {
        json!({ "header": { "pageHeaderRenderer": { "content": { "pageHeaderViewModel": {
            "title": { "dynamicTextViewModel": { "text": { "content": "Canal" } } },
            "metadata": { "contentMetadataViewModel": { "metadataRows": rows } }
        } } } } })
    }

    #[test]
    fn spanish_counts_are_read_by_the_subscriber_label() {
        let page = page_with_rows(&json!([
            { "metadataParts": [{ "text": { "content": "@KPOP_STUFFF" } }] },
            { "metadataParts": [
                { "text": { "content": "89,7 K suscriptores" }, "accessibilityLabel": "89,7 mil suscriptores" },
                { "text": { "content": "279 vídeos" } }
            ] }
        ]));
        let details = parse_header(&page, "UCx");
        assert_eq!(details.handle.as_deref(), Some("@KPOP_STUFFF"));
        assert_eq!(
            details.subscriber_count_text.as_deref(),
            Some("89,7 K suscriptores")
        );
        assert_eq!(details.video_count_text.as_deref(), Some("279 vídeos"));
    }

    #[test]
    fn the_label_finds_subscribers_wherever_they_stand() {
        let page = page_with_rows(&json!([
            { "metadataParts": [{ "text": { "content": "@MrBeast" } }] },
            { "metadataParts": [
                { "text": { "content": "1013 本の動画" } },
                { "text": { "content": "チャンネル登録者数 5.26億人" }, "accessibilityLabel": "チャンネル登録者数 5.26億人" }
            ] }
        ]));
        let details = parse_header(&page, "UCx");
        assert_eq!(
            details.subscriber_count_text.as_deref(),
            Some("チャンネル登録者数 5.26億人")
        );
        assert_eq!(details.video_count_text.as_deref(), Some("1013 本の動画"));
    }

    #[test]
    fn a_lone_unlabelled_count_is_the_video_count_of_a_channel_hiding_subscribers() {
        let page = page_with_rows(&json!([
            { "metadataParts": [{ "text": { "content": "@quiet" } }] },
            { "metadataParts": [{ "text": { "content": "12 vídeos" } }] }
        ]));
        let details = parse_header(&page, "UCx");
        assert_eq!(details.subscriber_count_text, None);
        assert_eq!(details.subscriber_count, None);
        assert_eq!(details.video_count_text.as_deref(), Some("12 vídeos"));
    }

    #[test]
    fn a_lone_labelled_count_is_the_subscriber_count() {
        let page = page_with_rows(&json!([
            { "metadataParts": [{ "text": { "content": "@solo" } }] },
            { "metadataParts": [
                { "text": { "content": "3,2 K suscriptores" }, "accessibilityLabel": "3,2 mil suscriptores" }
            ] }
        ]));
        let details = parse_header(&page, "UCx");
        assert_eq!(
            details.subscriber_count_text.as_deref(),
            Some("3,2 K suscriptores")
        );
        assert_eq!(details.video_count_text, None);
    }
}
