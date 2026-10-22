//! The owner block beside the subscribe button. A collaboration's block names
//! every channel and opens the "Collaborators" dialog instead of one channel.

use serde_json::Value;

use super::info_renderers;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::api::innertube::renderers::collaborators::collaborators_in;
use crate::models::video::Collaborator;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct WatchOwner {
    pub channel_id: Option<String>,
    /// The channel name, or every channel's ("A and B") for a collaboration.
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub subscriber_count_text: Option<String>,
    /// "verified" or "artist".
    pub badge: Option<&'static str>,
    pub collaborators: Vec<Collaborator>,
}

#[must_use]
pub fn owner(next: &Value) -> WatchOwner {
    let owner = &info_renderers(next).1["owner"]["videoOwnerRenderer"];
    let collaborators = collaborators_in(&owner["navigationEndpoint"]);
    let lead = collaborators.first();
    WatchOwner {
        channel_id: owner["navigationEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .map(ToOwned::to_owned)
            .or_else(|| lead.map(|lead| lead.channel_id.clone())),
        name: text_of(&owner["title"]).or_else(|| text_of(&owner["attributedTitle"])),
        avatar_url: largest_url(&owner["thumbnail"]["thumbnails"])
            .or_else(|| lead.and_then(|lead| lead.avatar_url.clone()))
            .map(|url| normalize_youtube_image_url(&url)),
        subscriber_count_text: text_of(&owner["subscriberCountText"])
            .or_else(|| lead.and_then(|lead| lead.subscriber_count_text.clone())),
        badge: badge(&owner["badges"]),
        collaborators,
    }
}

fn badge(badges: &Value) -> Option<&'static str> {
    badges.as_array()?.iter().find_map(|badge| {
        match badge["metadataBadgeRenderer"]["style"].as_str()? {
            "BADGE_STYLE_TYPE_VERIFIED_ARTIST" => Some("artist"),
            "BADGE_STYLE_TYPE_VERIFIED" => Some("verified"),
            _ => None,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::renderers::collaborators::tests::dialog;
    use serde_json::json;

    fn next_with(owner: &Value) -> Value {
        json!({ "contents": { "twoColumnWatchNextResults": { "results": { "results": {
            "contents": [{ "videoSecondaryInfoRenderer": { "owner": { "videoOwnerRenderer": owner } } }]
        } } } } })
    }

    #[test]
    fn a_channel_owner_comes_with_its_avatar_subscribers_and_badge() {
        let owner = owner(&next_with(&json!({
            "title": { "runs": [{ "text": "Rick Astley" }] },
            "navigationEndpoint": { "browseEndpoint": { "browseId": "UCuAXFkgsw1L7xaCfnd5JJOw" } },
            "thumbnail": { "thumbnails": [
                { "url": "https://yt3.ggpht.com/a=s48-c-k-c0x00ffffff-no-rj", "width": 48 },
                { "url": "https://yt3.ggpht.com/a=s176-c-k-c0x00ffffff-no-rj", "width": 176 }
            ] },
            "subscriberCountText": { "simpleText": "4.55M subscribers" },
            "badges": [{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_VERIFIED_ARTIST" } }]
        })));
        assert_eq!(
            owner.channel_id.as_deref(),
            Some("UCuAXFkgsw1L7xaCfnd5JJOw")
        );
        assert_eq!(owner.name.as_deref(), Some("Rick Astley"));
        assert_eq!(
            owner.avatar_url.as_deref(),
            Some("https://yt3.ggpht.com/a=s512")
        );
        assert_eq!(
            owner.subscriber_count_text.as_deref(),
            Some("4.55M subscribers")
        );
        assert_eq!(owner.badge, Some("artist"));
        assert!(owner.collaborators.is_empty());
    }

    #[test]
    fn a_collaboration_is_led_by_its_first_channel() {
        let owner = owner(&next_with(&json!({
            "attributedTitle": { "content": "KSI and MrBeast" },
            "navigationEndpoint": dialog(&[("UCGmnsW623G1r-Chmo5RB4Yw", "KSI"), ("UCX6OQ3DkcsbYNE6H8uQQuVA", "MrBeast")])
        })));
        assert_eq!(owner.name.as_deref(), Some("KSI and MrBeast"));
        assert_eq!(
            owner.channel_id.as_deref(),
            Some("UCGmnsW623G1r-Chmo5RB4Yw")
        );
        assert_eq!(owner.collaborators.len(), 2);
    }
}
