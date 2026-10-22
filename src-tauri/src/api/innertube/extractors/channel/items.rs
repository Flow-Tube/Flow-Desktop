//! The things a channel tab lists, and the shelves its Home tab arranges them in.

use serde_json::Value;

use super::posts::{post, post_renderer};
use crate::api::innertube::core::utils::short_video_summary_from_item;
use crate::api::innertube::json::continuation::continuation_token;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::api::innertube::renderers::lockup::{lockup_item, related_to_video};
use crate::api::innertube::renderers::video::video_from_renderer;
use crate::models::channel::{
    ChannelItem, ChannelSection, ChannelSectionMore, ChannelSummary, PlaylistSummary,
};
use crate::models::video::VideoSummary;

/// The channel a page belongs to, for items that leave their channel out.
pub(super) struct Owner {
    pub id: Option<String>,
    pub name: String,
}

impl Owner {
    /// Items on a channel's own tabs usually omit their byline; a shelf of
    /// collaborations names its own channels, which are kept.
    fn claim(&self, mut video: VideoSummary) -> VideoSummary {
        if video.channel_id.is_none() {
            video.channel_id.clone_from(&self.id);
        }
        if video.channel_name.is_empty() {
            video.channel_name.clone_from(&self.name);
        }
        video
    }
}

fn https(url: &str) -> String {
    url.strip_prefix("//")
        .map_or_else(|| url.to_string(), |rest| format!("https://{rest}"))
}

fn playlist_summary(renderer: &Value) -> Option<PlaylistSummary> {
    let id = renderer["playlistId"]
        .as_str()
        .filter(|id| !id.is_empty())?;
    Some(PlaylistSummary {
        id: id.to_string(),
        title: text_of(&renderer["title"]).unwrap_or_default(),
        thumbnail_url: largest_url(&renderer["thumbnail"]["thumbnails"])
            .or_else(|| largest_url(&renderer["thumbnails"][0]["thumbnails"]))
            .as_deref()
            .map(https),
        video_count_text: text_of(&renderer["videoCountText"])
            .or_else(|| text_of(&renderer["videoCountShortText"])),
    })
}

fn channel_summary(renderer: &Value) -> Option<ChannelSummary> {
    Some(ChannelSummary {
        channel_id: renderer["channelId"]
            .as_str()
            .filter(|id| !id.is_empty())?
            .to_string(),
        name: text_of(&renderer["title"])?,
        avatar_url: largest_url(&renderer["thumbnail"]["thumbnails"])
            .as_deref()
            .map(https)
            .map(|url| normalize_youtube_image_url(&url)),
        subscriber_count_text: text_of(&renderer["subscriberCountText"]),
    })
}

/// One listed thing, whatever renderer carries it. Podcasts, albums and courses
/// open as playlists; a lockup of any other kind is skipped rather than shown as
/// a video it is not.
pub(super) fn item_of(node: &Value, owner: &Owner) -> Option<ChannelItem> {
    let node = node
        .get("richItemRenderer")
        .map_or(node, |rich| &rich["content"]);
    if let Some(lockup) = node.get("lockupViewModel") {
        let item = lockup_item(lockup)?;
        if item.item_type == "video" {
            return Some(ChannelItem::Video(owner.claim(related_to_video(item))));
        }
        return Some(ChannelItem::Playlist(PlaylistSummary {
            id: item.playlist_id.clone().unwrap_or(item.id),
            title: item.title,
            thumbnail_url: item.thumbnail_url,
            video_count_text: item.view_count_text,
        }));
    }
    if let Some(video) = node
        .get("videoRenderer")
        .or_else(|| node.get("gridVideoRenderer"))
        .and_then(video_from_renderer)
    {
        return Some(ChannelItem::Video(owner.claim(video)));
    }
    if let Some(short) = short_video_summary_from_item(node) {
        return Some(ChannelItem::Short(short));
    }
    if let Some(playlist) = node
        .get("gridPlaylistRenderer")
        .or_else(|| node.get("playlistRenderer"))
        .and_then(playlist_summary)
    {
        return Some(ChannelItem::Playlist(playlist));
    }
    if let Some(renderer) = post_renderer(node) {
        return post(renderer).map(ChannelItem::Post);
    }
    node.get("gridChannelRenderer")
        .or_else(|| node.get("channelRenderer"))
        .and_then(channel_summary)
        .map(ChannelItem::Channel)
}

/// The items of a grid or list, and the token for its next page.
pub(super) fn collect(
    list: &[Value],
    owner: &Owner,
    items: &mut Vec<ChannelItem>,
    token: &mut Option<String>,
) {
    for node in list {
        if let Some(inner) = node["itemSectionRenderer"]["contents"].as_array() {
            collect(inner, owner, items, token);
        } else if let Some(inner) = node["gridRenderer"]["items"].as_array() {
            collect(inner, owner, items, token);
        } else if let Some(item) = item_of(node, owner) {
            items.push(item);
        } else if token.is_none() {
            *token = continuation_token(node);
        }
    }
}

fn shelf_more(shelf: &Value, owner: &Owner) -> Option<ChannelSectionMore> {
    let endpoint = shelf["title"]["runs"][0]["navigationEndpoint"]
        .get("browseEndpoint")
        .or_else(|| shelf["endpoint"].get("browseEndpoint"))?;
    let browse_id = endpoint["browseId"].as_str()?;
    if let Some(playlist_id) = browse_id.strip_prefix("VL") {
        return Some(ChannelSectionMore {
            params: None,
            playlist_id: Some(playlist_id.to_string()),
        });
    }
    (Some(browse_id) == owner.id.as_deref()).then(|| ChannelSectionMore {
        params: endpoint["params"].as_str().map(ToOwned::to_owned),
        playlist_id: None,
    })
}

/// Home's shelves, in the order the channel arranged them.
pub(super) fn sections(list: &[Value], owner: &Owner) -> Vec<ChannelSection> {
    let mut sections = Vec::new();
    for node in list.iter().flat_map(|section| {
        section["itemSectionRenderer"]["contents"]
            .as_array()
            .map_or_else(|| std::slice::from_ref(section), Vec::as_slice)
    }) {
        if let Some(trailer) = node.get("channelVideoPlayerRenderer") {
            let Some(id) = trailer["videoId"].as_str() else {
                continue;
            };
            sections.push(ChannelSection {
                title: text_of(&trailer["title"]).unwrap_or_default(),
                items: vec![ChannelItem::Video(owner.claim(VideoSummary {
                    id: id.to_string(),
                    title: text_of(&trailer["title"]).unwrap_or_default(),
                    thumbnail_url: Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
                    view_count_text: text_of(&trailer["viewCountText"]),
                    published_text: text_of(&trailer["publishedTimeText"]),
                    ..VideoSummary::default()
                }))],
                more: None,
                is_trailer: true,
            });
            continue;
        }
        let (shelf, list) = if let Some(shelf) = node.get("shelfRenderer") {
            let content = &shelf["content"];
            let list = content["horizontalListRenderer"]["items"]
                .as_array()
                .or_else(|| content["expandedShelfContentsRenderer"]["items"].as_array())
                .or_else(|| content["gridRenderer"]["items"].as_array())
                .or_else(|| content["verticalListRenderer"]["items"].as_array());
            (shelf, list)
        } else if let Some(shelf) = node.get("reelShelfRenderer") {
            (shelf, shelf["items"].as_array())
        } else if let Some(shelf) = node["richSectionRenderer"]["content"].get("richShelfRenderer")
        {
            (shelf, shelf["contents"].as_array())
        } else {
            continue;
        };
        let items: Vec<ChannelItem> = list
            .into_iter()
            .flatten()
            .filter_map(|item| item_of(item, owner))
            .collect();
        if items.is_empty() {
            continue;
        }
        sections.push(ChannelSection {
            title: text_of(&shelf["title"]).unwrap_or_default(),
            items,
            more: shelf_more(shelf, owner),
            is_trailer: false,
        });
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn owner() -> Owner {
        Owner {
            id: Some("UCowner".into()),
            name: "Owner".into(),
        }
    }

    #[test]
    fn home_keeps_its_trailer_shelves_and_their_see_all_targets() {
        let list = json!([{ "itemSectionRenderer": { "contents": [
            { "channelVideoPlayerRenderer": { "videoId": "trailer0001", "title": { "runs": [{ "text": "Trailer" }] } } }
        ] } }, { "itemSectionRenderer": { "contents": [
            { "shelfRenderer": {
                "title": { "runs": [{ "text": "Popular videos", "navigationEndpoint": { "browseEndpoint": {
                    "browseId": "UCowner", "params": "POPULAR" } } }] },
                "content": { "horizontalListRenderer": { "items": [
                    { "gridVideoRenderer": { "videoId": "video000001", "title": { "runs": [{ "text": "V" }] } } }
                ] } }
            } }
        ] } }, { "itemSectionRenderer": { "contents": [
            { "reelShelfRenderer": { "title": { "runs": [{ "text": "Shorts" }] }, "items": [
                { "shortsLockupViewModel": { "onTap": { "innertubeCommand": { "reelWatchEndpoint": { "videoId": "short000001" } } } } }
            ] } }
        ] } }, { "itemSectionRenderer": { "contents": [
            { "shelfRenderer": {
                "title": { "runs": [{ "text": "Featured Channels" }] },
                "content": { "horizontalListRenderer": { "items": [
                    { "gridChannelRenderer": { "channelId": "UCother", "title": { "simpleText": "Other" },
                        "subscriberCountText": { "simpleText": "2.55M subscribers" } } }
                ] } }
            } }
        ] } }]);
        let sections = sections(list.as_array().unwrap(), &owner());
        assert_eq!(sections.len(), 4);
        assert!(sections[0].is_trailer);
        assert_eq!(
            sections[1]
                .more
                .as_ref()
                .and_then(|more| more.params.as_deref()),
            Some("POPULAR")
        );
        assert!(
            matches!(&sections[1].items[0], ChannelItem::Video(video) if video.channel_id.as_deref() == Some("UCowner"))
        );
        assert!(matches!(&sections[2].items[0], ChannelItem::Short(_)));
        assert!(
            matches!(&sections[3].items[0], ChannelItem::Channel(channel) if channel.channel_id == "UCother")
        );
    }

    #[test]
    fn a_playlist_shelf_opens_its_playlist() {
        let shelf = json!({ "title": { "runs": [{ "text": "WAN", "navigationEndpoint": { "browseEndpoint": { "browseId": "VLPL123" } } }] } });
        let more = shelf_more(&shelf, &owner()).expect("more");
        assert_eq!(more.playlist_id.as_deref(), Some("PL123"));
    }

    #[test]
    fn an_item_with_its_own_channel_keeps_it() {
        let node = json!({ "videoRenderer": { "videoId": "collab00001", "title": { "runs": [{ "text": "C" }] },
            "ownerText": { "runs": [{ "text": "Guest", "navigationEndpoint": { "browseEndpoint": { "browseId": "UCguest" } } }] } } });
        let Some(ChannelItem::Video(video)) = item_of(&node, &owner()) else {
            panic!("video")
        };
        assert_eq!(video.channel_id.as_deref(), Some("UCguest"));
        assert_eq!(video.channel_name, "Guest");
    }
}
