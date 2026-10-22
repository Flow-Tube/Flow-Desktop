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

/// The header's metadata rows: "@handle", "16.9M subscribers", "7.9K videos".
fn metadata_rows(header: &Value) -> Vec<String> {
    header["metadata"]["contentMetadataViewModel"]["metadataRows"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["metadataParts"].as_array().into_iter().flatten())
        .filter_map(|part| text_of(&part["text"]))
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .collect()
}

fn mentions(text: &str, word: &str) -> bool {
    text.to_lowercase().contains(word)
}

#[must_use]
pub fn parse_header(page: &Value, requested_id: &str) -> ChannelDetails {
    let header = page_header(page);
    let legacy = &page["header"]["c4TabbedHeaderRenderer"];
    let metadata = &page["metadata"]["channelMetadataRenderer"];
    let rows = metadata_rows(header);
    let subscriber_count_text = rows
        .iter()
        .find(|row| mentions(row, "subscriber"))
        .cloned()
        .or_else(|| text_of(&legacy["subscriberCountText"]));
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
        handle: rows
            .iter()
            .find(|row| row.starts_with('@'))
            .cloned()
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
        video_count_text: rows
            .iter()
            .find(|row| mentions(row, "video") && !row.starts_with('@'))
            .cloned()
            .or_else(|| text_of(&legacy["videosCountText"])),
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
}
