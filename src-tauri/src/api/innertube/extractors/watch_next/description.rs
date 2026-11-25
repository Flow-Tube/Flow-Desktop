//! The description as the watch page shows it: the text with its links, and
//! the structured panel under it (headline numbers, credited songs, the
//! creator's links). Ported from Flow for Android's `VideoDescriptionPage`.

use serde_json::Value;

use super::info_renderers;
use crate::api::innertube::json::rich_text::{rich_text, unwrap_redirect};
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::largest_url;
use crate::models::rich_text::RichText;
use crate::models::video::{
    CreatorLink, DescriptionChannel, DescriptionExtras, Disclosure, Factoid, MusicCard,
};

/// The description with its links. The watch answer's text can be a machine
/// translation of the player's, so its offsets only apply when both read the
/// same; otherwise the page links the plain text itself.
#[must_use]
pub fn description_rich(next: &Value, shown: Option<&str>, video_id: &str) -> Option<RichText> {
    let rich = rich_text(
        &info_renderers(next).1["attributedDescription"],
        Some(video_id),
    )?;
    (shown.is_none_or(|shown| shown == rich.text) && !rich.spans.is_empty()).then_some(rich)
}

#[must_use]
pub fn description_extras(next: &Value, video_id: &str) -> DescriptionExtras {
    let items: Vec<&Value> = next["engagementPanels"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|panel| &panel["engagementPanelSectionListRenderer"])
        .filter(|panel| panel["panelIdentifier"] == "engagement-panel-structured-description")
        .filter_map(|panel| {
            panel["content"]["structuredDescriptionContentRenderer"]["items"].as_array()
        })
        .flatten()
        .collect();
    DescriptionExtras {
        factoids: items
            .iter()
            .filter_map(|item| item["videoDescriptionHeaderRenderer"]["factoid"].as_array())
            .flatten()
            .filter_map(factoid)
            .collect(),
        music: items
            .iter()
            .map(|item| &item["horizontalCardListRenderer"])
            .filter(|list| text_of(&list["header"]["richListHeaderRenderer"]["title"]).is_some())
            .filter_map(|list| list["cards"].as_array())
            .flatten()
            .filter_map(|card| music_card(&card["videoAttributeViewModel"]))
            .collect(),
        links: items
            .iter()
            .filter_map(|item| {
                item["videoDescriptionInfocardsSectionRenderer"]["creatorCustomUrlButtons"]
                    .as_array()
            })
            .flatten()
            .filter_map(|button| creator_link(&button["buttonViewModel"]))
            .collect(),
        channel: items
            .iter()
            .find_map(|item| channel_card(&item["videoDescriptionInfocardsSectionRenderer"])),
        disclosure: items
            .iter()
            .find_map(|item| disclosure(&item["howThisWasMadeSectionViewModel"], video_id)),
    }
}

fn channel_card(section: &Value) -> Option<DescriptionChannel> {
    Some(DescriptionChannel {
        name: text_of(&section["sectionTitle"]).filter(|name| !name.is_empty())?,
        subtitle: text_of(&section["sectionSubtitle"]).filter(|text| !text.is_empty()),
        avatar_url: largest_url(&section["channelAvatar"]["thumbnails"]),
        channel_id: section["channelEndpoint"]["browseEndpoint"]["browseId"]
            .as_str()
            .map(ToOwned::to_owned),
    })
}

fn disclosure(section: &Value, video_id: &str) -> Option<Disclosure> {
    let header = text_of(&section["bodyHeader"]).filter(|text| !text.is_empty());
    let body = rich_text(&section["bodyText"], Some(video_id)).filter(|body| !body.text.is_empty());
    if header.is_none() && body.is_none() {
        return None;
    }
    Some(Disclosure {
        title: text_of(&section["sectionTitle"]).filter(|text| !text.is_empty()),
        header,
        body,
    })
}

/// A headline number. View and upload-time factoids wrap the plain one.
fn factoid(entry: &Value) -> Option<Factoid> {
    let renderer = entry.get("factoidRenderer").or_else(|| {
        entry
            .as_object()?
            .values()
            .find_map(|wrapper| wrapper["factoid"].get("factoidRenderer"))
    })?;
    Some(Factoid {
        value: text_of(&renderer["value"])?,
        label: text_of(&renderer["label"])?,
    })
}

fn music_card(card: &Value) -> Option<MusicCard> {
    Some(MusicCard {
        title: card["title"]
            .as_str()
            .filter(|title| !title.is_empty())?
            .to_string(),
        artist: card["subtitle"].as_str().map(ToOwned::to_owned),
        album: text_of(&card["secondarySubtitle"]),
        thumbnail_url: largest_url(&card["image"]["sources"]),
    })
}

fn creator_link(button: &Value) -> Option<CreatorLink> {
    let command = &button["onTap"]["innertubeCommand"];
    let url = command["urlEndpoint"]["url"]
        .as_str()
        .or_else(|| command["commandMetadata"]["webCommandMetadata"]["url"].as_str())?;
    Some(CreatorLink {
        title: button["title"]
            .as_str()
            .filter(|title| !title.is_empty())?
            .to_string(),
        url: unwrap_redirect(url),
        icon_url: button["iconImage"]["url"]
            .as_str()
            .map(ToOwned::to_owned)
            .or_else(|| largest_url(&button["iconImage"]["sources"])),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn with_panel(items: &Value) -> Value {
        json!({ "engagementPanels": [{ "engagementPanelSectionListRenderer": {
            "panelIdentifier": "engagement-panel-structured-description",
            "content": { "structuredDescriptionContentRenderer": { "items": items } }
        } }] })
    }

    #[test]
    fn factoids_songs_and_links_are_read_from_the_panel() {
        let next = with_panel(&json!([
            { "videoDescriptionHeaderRenderer": { "factoid": [
                { "factoidRenderer": { "value": { "simpleText": "19M" }, "label": { "simpleText": "Likes" } } },
                { "viewCountFactoidRenderer": { "factoid": { "factoidRenderer": {
                    "value": { "simpleText": "1,829,262,761" }, "label": { "simpleText": "Views" } } } } }
            ] } },
            { "horizontalCardListRenderer": {
                "header": { "richListHeaderRenderer": { "title": { "simpleText": "Music" } } },
                "cards": [{ "videoAttributeViewModel": {
                    "title": "Never Gonna Give You Up",
                    "subtitle": "Rick Astley",
                    "secondarySubtitle": { "content": "Whenever You Need Somebody" },
                    "image": { "sources": [{ "url": "https://yt3.googleusercontent.com/song" }] }
                } }]
            } },
            { "videoDescriptionInfocardsSectionRenderer": {
                "sectionTitle": { "simpleText": "Rick Astley" },
                "sectionSubtitle": { "simpleText": "4.4M subscribers" },
                "channelAvatar": { "thumbnails": [{ "url": "https://yt3.ggpht.com/rick", "width": 88 }] },
                "channelEndpoint": { "browseEndpoint": { "browseId": "UCuAXFkgsw1L7xaCfnd5JJOw" } },
                "creatorCustomUrlButtons": [
                    { "buttonViewModel": { "title": "Instagram",
                        "iconImage": { "sources": [{ "url": "https://e/ig.png" }] },
                        "onTap": { "innertubeCommand": { "urlEndpoint": {
                            "url": "https://www.youtube.com/redirect?event=x&q=https%3A%2F%2Fwww.instagram.com%2Frick%2F"
                        } } } } }
                ]
            } },
            { "howThisWasMadeSectionViewModel": {
                "sectionTitle": { "content": "How this content was made" },
                "bodyHeader": { "content": "Altered or synthetic content" },
                "bodyText": { "content": "Sound or visuals were altered." }
            } }
        ]));
        let extras = description_extras(&next, "v");
        assert_eq!(
            extras.factoids,
            [
                Factoid {
                    value: "19M".into(),
                    label: "Likes".into()
                },
                Factoid {
                    value: "1,829,262,761".into(),
                    label: "Views".into()
                },
            ]
        );
        assert_eq!(extras.music.len(), 1);
        assert_eq!(extras.music[0].artist.as_deref(), Some("Rick Astley"));
        assert_eq!(
            extras.music[0].album.as_deref(),
            Some("Whenever You Need Somebody")
        );
        assert_eq!(
            extras.links,
            [CreatorLink {
                title: "Instagram".into(),
                url: "https://www.instagram.com/rick/".into(),
                icon_url: Some("https://e/ig.png".into()),
            }]
        );
        assert_eq!(
            extras.channel,
            Some(DescriptionChannel {
                name: "Rick Astley".into(),
                subtitle: Some("4.4M subscribers".into()),
                avatar_url: Some("https://yt3.ggpht.com/rick".into()),
                channel_id: Some("UCuAXFkgsw1L7xaCfnd5JJOw".into()),
            })
        );
        let disclosure = extras.disclosure.expect("disclosure");
        assert_eq!(
            disclosure.header.as_deref(),
            Some("Altered or synthetic content")
        );
        assert_eq!(
            disclosure.body.map(|body| body.text).as_deref(),
            Some("Sound or visuals were altered.")
        );
    }

    #[test]
    fn a_translated_description_keeps_no_offsets() {
        let next = json!({ "contents": { "twoColumnWatchNextResults": { "results": { "results": {
            "contents": [{ "videoSecondaryInfoRenderer": { "attributedDescription": {
                "content": "Hola https://a.b",
                "commandRuns": [{ "startIndex": 5, "length": 11, "onTap": { "innertubeCommand": {
                    "urlEndpoint": { "url": "https://a.b" } } } }]
            } } }]
        } } } } });
        assert!(description_rich(&next, Some("Hello https://a.b"), "v").is_none());
        assert!(description_rich(&next, Some("Hola https://a.b"), "v").is_some());
    }
}
