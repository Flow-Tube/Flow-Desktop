//! The About panel, which the landing page does not carry: only a token for it.

use serde_json::Value;

use crate::api::innertube::json::rich_text::unwrap_redirect;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::largest_url;
use crate::models::channel::{ChannelAbout, ChannelLink};

pub(super) fn first_named<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .get(key)
            .or_else(|| map.values().find_map(|child| first_named(child, key))),
        Value::Array(items) => items.iter().find_map(|child| first_named(child, key)),
        _ => None,
    }
}

/// The first continuation token under `value`, wherever its wrapper put it.
pub(super) fn first_token(value: &Value) -> Option<String> {
    first_named(value, "continuationCommand")
        .and_then(|command| command["token"].as_str())
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

#[must_use]
pub fn parse_about(page: &Value) -> Option<ChannelAbout> {
    let model = first_named(page, "aboutChannelViewModel")?;
    let text = |key: &str| text_of(&model[key]).filter(|text| !text.trim().is_empty());
    Some(ChannelAbout {
        description: text("description").map(|text| text.trim().to_string()),
        country_text: text("country"),
        joined_date_text: text("joinedDateText"),
        view_count_text: text("viewCountText"),
        video_count_text: text("videoCountText"),
        subscriber_count_text: text("subscriberCountText"),
        canonical_url: model["canonicalChannelUrl"].as_str().map(ToOwned::to_owned),
        links: model["links"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let link = &entry["channelExternalLinkViewModel"];
                let title = text_of(&link["title"]).filter(|title| !title.is_empty())?;
                let url = first_named(&link["link"], "urlEndpoint")
                    .and_then(|endpoint| endpoint["url"].as_str())
                    .map(unwrap_redirect)
                    .or_else(|| text_of(&link["link"]).map(|text| format!("https://{text}")))?;
                Some(ChannelLink {
                    title,
                    url,
                    icon_url: largest_url(&link["favicon"]["sources"]),
                })
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn about_reads_its_counts_and_unwraps_links() {
        let page = json!({ "onResponseReceivedEndpoints": [{ "appendContinuationItemsAction": {
            "continuationItems": [{ "aboutChannelRenderer": { "metadata": { "aboutChannelViewModel": {
                "country": "Canada",
                "joinedDateText": { "content": "Joined Nov 24, 2008" },
                "viewCountText": "9,929,731,584 views",
                "videoCountText": "7,963 videos",
                "canonicalChannelUrl": "http://www.youtube.com/@LinusTechTips",
                "links": [{ "channelExternalLinkViewModel": {
                    "title": { "content": "lttstore.com" },
                    "link": { "content": "lttstore.com", "commandRuns": [{ "onTap": { "innertubeCommand": {
                        "urlEndpoint": { "url": "https://www.youtube.com/redirect?event=x&q=https%3A%2F%2Fwww.lttstore.com%2F" }
                    } } }] }
                } }]
            } } } }]
        } }] });
        let about = parse_about(&page).expect("about");
        assert_eq!(about.country_text.as_deref(), Some("Canada"));
        assert_eq!(
            about.joined_date_text.as_deref(),
            Some("Joined Nov 24, 2008")
        );
        assert_eq!(about.video_count_text.as_deref(), Some("7,963 videos"));
        assert_eq!(about.links[0].url, "https://www.lttstore.com/");
    }
}
