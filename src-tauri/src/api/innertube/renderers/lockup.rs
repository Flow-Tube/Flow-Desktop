//! `lockupViewModel`, the card now used for related videos, playlist
//! rows, channel tabs and search playlists. Each part of its metadata is read
//! by what it is (the view count carries an icon, the date reads as an age),
//! not by where it sits, so an extra badge row no longer shifts the fields.

use serde_json::Value;

use super::collaborators::collaborators_in;
use crate::api::innertube::json::age::relative_age;
use crate::api::innertube::json::count::parse_count;
use crate::api::innertube::json::duration::parse_duration;
use crate::api::innertube::json::thumbnail::{
    largest_url, normalize_youtube_image_url, thumbnail_url_from_array,
};
use crate::models::video::{RelatedContentItem, VideoSummary};

/// One metadata part of a lockup.
struct Part<'a> {
    text: &'a str,
    /// The part spelt out for screen readers. Outside English it is the only
    /// full form of a compact age ("il y a 2 sem." is "il y a 2 semaines").
    label: Option<&'a str>,
    has_icon: bool,
    is_verified: bool,
}

impl Part<'_> {
    fn is_age(&self) -> bool {
        relative_age(self.text).is_some()
            || self
                .label
                .is_some_and(|label| relative_age(label).is_some())
    }

    /// The age as the card shows it: the text when it reads as one, else its full form.
    fn age_text(&self) -> &str {
        match self.label {
            Some(label) if relative_age(self.text).is_none() && relative_age(label).is_some() => {
                label
            }
            _ => self.text,
        }
    }
}

fn metadata(lockup: &Value) -> &Value {
    &lockup["metadata"]["lockupMetadataViewModel"]
}

fn rows(lockup: &Value) -> &[Value] {
    metadata(lockup)["metadata"]["contentMetadataViewModel"]["metadataRows"]
        .as_array()
        .map_or(&[], Vec::as_slice)
}

fn parts(row: &Value) -> Vec<Part<'_>> {
    row["metadataParts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| {
            Some(Part {
                text: part["text"]["content"].as_str()?,
                label: part["accessibilityLabel"].as_str(),
                has_icon: part.get("leadingIcon").is_some(),
                is_verified: part["text"]["attachmentRuns"]
                    .as_array()
                    .is_some_and(|runs| {
                        runs.iter().any(|run| {
                            run["element"]["type"]["imageType"]["image"]["sources"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|source| source["clientResource"]["imageName"].as_str())
                                .any(|name| name.contains("CHECK_CIRCLE"))
                        })
                    }),
            })
        })
        .collect()
}

fn row_badges(lockup: &Value) -> impl Iterator<Item = &Value> {
    rows(lockup)
        .iter()
        .filter_map(|row| row["badges"].as_array())
        .flatten()
        .map(|badge| &badge["badgeViewModel"])
}

fn thumbnail_badges(lockup: &Value) -> impl Iterator<Item = &Value> {
    let image = &lockup["contentImage"];
    image["thumbnailViewModel"]["overlays"]
        .as_array()
        .into_iter()
        .chain(image["collectionThumbnailViewModel"]["primaryThumbnail"]["thumbnailViewModel"]["overlays"].as_array())
        .flatten()
        .flat_map(|overlay| {
            overlay["thumbnailOverlayBadgeViewModel"]["thumbnailBadges"]
                .as_array()
                .or_else(|| overlay["thumbnailBottomOverlayViewModel"]["badges"].as_array())
                .into_iter()
                .flatten()
        })
        .map(|badge| &badge["thumbnailBadgeViewModel"])
}

/// A live lockup: its thumbnail badge reads LIVE or shows the live icon.
#[must_use]
pub fn is_live(lockup: &Value) -> bool {
    thumbnail_badges(lockup).any(|badge| {
        badge["text"]
            .as_str()
            .is_some_and(|text| text.eq_ignore_ascii_case("LIVE"))
            || badge["icon"]["sources"][0]["clientResource"]["imageName"]
                .as_str()
                .is_some_and(|name| name.contains("LIVE"))
    })
}

fn duration(lockup: &Value) -> Option<u64> {
    thumbnail_badges(lockup).find_map(|badge| badge["text"].as_str().and_then(parse_duration))
}

/// Premieres and scheduled streams name their start instead of an age.
fn is_upcoming_text(text: &str) -> bool {
    text.starts_with("Premieres") || text.starts_with("Scheduled for") || text.ends_with("waiting")
}

fn thumbnail(lockup: &Value) -> Option<String> {
    let image = &lockup["contentImage"];
    thumbnail_url_from_array(&image["thumbnailViewModel"]["image"]["sources"]).or_else(|| {
        thumbnail_url_from_array(
            &image["collectionThumbnailViewModel"]["primaryThumbnail"]["thumbnailViewModel"]["image"]["sources"],
        )
    })
}

fn command(lockup: &Value) -> &Value {
    &lockup["rendererContext"]["commandContext"]["onTap"]["innertubeCommand"]
}

/// A video card that opens the Shorts player. Shorts shelves use their own lockup, but a Short can
/// also come as a plain video card.
fn opens_shorts_player(lockup: &Value) -> bool {
    let command = command(lockup);
    let web = &command["commandMetadata"]["webCommandMetadata"];
    command.get("reelWatchEndpoint").is_some()
        || web["webPageType"] == "WEB_PAGE_TYPE_SHORTS"
        || web["url"]
            .as_str()
            .is_some_and(|url| url.starts_with("/shorts/"))
}

/// What a lockup points at.
struct Ids {
    item_type: &'static str,
    id: String,
    is_mix: bool,
    video_id: Option<String>,
    playlist_id: Option<String>,
}

fn ids(lockup: &Value, is_video: bool, is_playlist: bool) -> Option<Ids> {
    let command = command(lockup);
    let video_id = lockup["contentId"]
        .as_str()
        .filter(|_| is_video)
        .or_else(|| command["watchEndpoint"]["videoId"].as_str())
        .map(ToOwned::to_owned);
    let playlist_id = command["watchEndpoint"]["playlistId"]
        .as_str()
        .or_else(|| command["watchPlaylistEndpoint"]["playlistId"].as_str())
        .map(ToOwned::to_owned)
        .or_else(|| {
            command["browseEndpoint"]["browseId"]
                .as_str()
                .and_then(|id| id.strip_prefix("VL"))
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            is_playlist
                .then(|| lockup["contentId"].as_str().map(ToOwned::to_owned))
                .flatten()
        });

    let (item_type, id, is_mix) = if is_playlist {
        let playlist_id = playlist_id.clone()?;
        let is_mix = playlist_id.starts_with("RD") || playlist_id.starts_with("UL");
        (if is_mix { "mix" } else { "playlist" }, playlist_id, is_mix)
    } else {
        ("video", video_id.clone()?, false)
    };

    Some(Ids {
        item_type,
        id,
        is_mix,
        video_id,
        playlist_id,
    })
}

/// One lockup as a related item: a video, a playlist (podcasts, albums and
/// courses are playlists here) or a mix. Channel lockups and anything else are
/// skipped.
#[must_use]
pub fn lockup_item(lockup: &Value) -> Option<RelatedContentItem> {
    let is_playlist = matches!(
        lockup["contentType"].as_str(),
        Some(
            "LOCKUP_CONTENT_TYPE_PLAYLIST"
                | "LOCKUP_CONTENT_TYPE_PODCAST"
                | "LOCKUP_CONTENT_TYPE_ALBUM"
                | "LOCKUP_CONTENT_TYPE_COURSE"
        )
    );
    let is_video = lockup["contentType"] == "LOCKUP_CONTENT_TYPE_VIDEO";
    if !is_video && !is_playlist {
        return None;
    }
    let Ids {
        item_type,
        id,
        is_mix,
        video_id,
        playlist_id,
    } = ids(lockup, is_video, is_playlist)?;

    let all_rows: Vec<Vec<Part<'_>>> = rows(lockup).iter().map(parts).collect();
    let all_parts = || all_rows.iter().flatten();
    let channel = all_rows
        .first()
        .and_then(|row| row.first())
        .filter(|part| !part.has_icon && !part.is_age());
    let published = all_parts()
        .find(|part| part.is_age() || is_upcoming_text(part.text))
        .map(|part| part.age_text().to_string());
    // Rows after the first hold the counts; the first row is the byline.
    let views = all_parts()
        .find(|part| part.has_icon)
        .or_else(|| {
            // An abbreviated count in another language ("23 Mio.") reads as no
            // number, but is still the count the card shows.
            all_rows.iter().skip(1).flatten().find(|part| {
                !part.is_age()
                    && !is_upcoming_text(part.text)
                    && part.text.chars().any(|c| c.is_ascii_digit())
            })
        })
        .map(|part| part.text.to_string());
    let image = &metadata(lockup)["image"];
    let collaborators = collaborators_in(&image["avatarStackViewModel"]);
    let channel_id = image["decoratedAvatarViewModel"]["rendererContext"]["commandContext"]["onTap"]
        ["innertubeCommand"]["browseEndpoint"]["browseId"]
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| collaborators.first().map(|c| c.channel_id.clone()));

    Some(RelatedContentItem {
        id,
        item_type: item_type.to_string(),
        title: metadata(lockup)["title"]["content"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        channel_name: channel
            .map(|part| part.text.to_string())
            .unwrap_or_default(),
        channel_id,
        thumbnail_url: thumbnail(lockup),
        duration_seconds: duration(lockup),
        is_upcoming: published.as_deref().is_some_and(is_upcoming_text)
            || views.as_deref().is_some_and(is_upcoming_text),
        published_text: published,
        view_count_text: views,
        video_id,
        playlist_id,
        is_mix,
        is_live: is_live(lockup),
        channel_avatar_url: largest_url(
            &image["decoratedAvatarViewModel"]["avatar"]["avatarViewModel"]["image"]["sources"],
        )
        .map(|url| normalize_youtube_image_url(&url)),
        is_verified: channel.is_some_and(|part| part.is_verified),
        is_members_only: row_badges(lockup)
            .any(|badge| badge["badgeStyle"] == "BADGE_MEMBERS_ONLY"),
        is_short: is_video && opens_shorts_player(lockup),
        badges: row_badges(lockup)
            .filter(|badge| badge["badgeStyle"] != "BADGE_MEMBERS_ONLY")
            .filter_map(|badge| badge["badgeText"].as_str())
            .map(ToOwned::to_owned)
            .collect(),
        collaborators,
    })
}

/// A related item as a video card.
#[must_use]
pub fn related_to_video(item: RelatedContentItem) -> VideoSummary {
    let view_count = (!item.is_upcoming)
        .then(|| item.view_count_text.as_deref().and_then(parse_count))
        .flatten();
    VideoSummary {
        id: item.video_id.unwrap_or(item.id),
        title: item.title,
        channel_name: item.channel_name,
        channel_id: item.channel_id,
        thumbnail_url: item.thumbnail_url,
        duration_seconds: item.duration_seconds,
        published_text: item.published_text,
        view_count_text: item.view_count_text,
        channel_avatar_url: item.channel_avatar_url,
        is_live: item.is_live,
        view_count,
        is_upcoming: item.is_upcoming,
        is_verified: item.is_verified,
        is_members_only: item.is_members_only,
        is_short: item.is_short,
        badges: item.badges,
        collaborators: item.collaborators,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::renderers::collaborators::tests::dialog;
    use serde_json::json;

    fn video_lockup(rows: &Value) -> Value {
        json!({
            "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
            "contentId": "vid00000001",
            "contentImage": { "thumbnailViewModel": {
                "image": { "sources": [{ "url": "https://i.ytimg.com/vi/vid00000001/hqdefault.jpg" }] },
                "overlays": [{ "thumbnailBottomOverlayViewModel": { "badges": [
                    { "thumbnailBadgeViewModel": { "text": "12:34" } }
                ] } }]
            } },
            "metadata": { "lockupMetadataViewModel": {
                "title": { "content": "A video" },
                "image": { "decoratedAvatarViewModel": {
                    "avatar": { "avatarViewModel": { "image": { "sources": [
                        { "url": "https://yt3.ggpht.com/a=s68", "width": 68, "height": 68 }
                    ] } } },
                    "rendererContext": { "commandContext": { "onTap": { "innertubeCommand": {
                        "browseEndpoint": { "browseId": "UCowner" } } } } }
                } },
                "metadata": { "contentMetadataViewModel": { "metadataRows": rows } }
            } }
        })
    }

    #[test]
    fn a_video_card_that_opens_the_shorts_player_is_a_short() {
        let mut lockup = video_lockup(&json!([]));
        lockup["rendererContext"] = json!({ "commandContext": { "onTap": { "innertubeCommand": {
            "commandMetadata": { "webCommandMetadata": { "url": "/watch?v=vid00000001" } },
            "watchEndpoint": { "videoId": "vid00000001" }
        } } } });
        assert!(!lockup_item(&lockup).unwrap().is_short);
        lockup["rendererContext"] = json!({ "commandContext": { "onTap": { "innertubeCommand": {
            "commandMetadata": { "webCommandMetadata": { "url": "/shorts/vid00000001" } },
            "reelWatchEndpoint": { "videoId": "vid00000001" }
        } } } });
        let item = lockup_item(&lockup).unwrap();
        assert!(item.is_short);
        assert!(related_to_video(item).is_short);
    }

    #[test]
    fn fields_are_read_by_what_they_are() {
        let lockup = video_lockup(&json!([
            { "metadataParts": [{ "text": { "content": "Channel", "attachmentRuns": [{ "element": { "type": {
                "imageType": { "image": { "sources": [{ "clientResource": { "imageName": "CHECK_CIRCLE_FILLED" } }] } }
            } } }] } }] },
            { "metadataParts": [
                { "text": { "content": "1.6K" }, "leadingIcon": { "name": "PLAY_ARROW_OUTLINED" } },
                { "text": { "content": "1mo ago" } }
            ] },
            { "badges": [{ "badgeViewModel": { "badgeText": "New" } }] }
        ]));
        let item = lockup_item(&lockup).unwrap();
        assert_eq!(item.channel_name, "Channel");
        assert_eq!(item.channel_id.as_deref(), Some("UCowner"));
        assert_eq!(item.view_count_text.as_deref(), Some("1.6K"));
        assert_eq!(item.published_text.as_deref(), Some("1mo ago"));
        assert_eq!(item.duration_seconds, Some(754));
        assert!(item.is_verified);
        assert_eq!(item.badges, ["New"]);
        assert_eq!(
            item.channel_avatar_url.as_deref(),
            Some("https://yt3.ggpht.com/a=s512")
        );
        let video = related_to_video(item);
        assert_eq!(video.view_count, Some(1_600));
        assert_eq!(
            video.thumbnail_url.as_deref(),
            Some("https://i.ytimg.com/vi/vid00000001/hq720.jpg")
        );
    }

    #[test]
    fn a_badge_row_before_the_counts_does_not_shift_them() {
        let lockup = video_lockup(&json!([
            { "metadataParts": [{ "text": { "content": "Channel" } }] },
            { "badges": [{ "badgeViewModel": { "badgeText": "Members only", "badgeStyle": "BADGE_MEMBERS_ONLY" } }] },
            { "metadataParts": [{ "text": { "content": "3 days ago" } }] }
        ]));
        let item = lockup_item(&lockup).unwrap();
        assert!(item.is_members_only);
        assert!(item.badges.is_empty());
        assert_eq!(item.published_text.as_deref(), Some("3 days ago"));
        assert_eq!(item.view_count_text, None);
    }

    #[test]
    fn premieres_are_upcoming_and_not_views() {
        let lockup = video_lockup(&json!([
            { "metadataParts": [{ "text": { "content": "Channel" } }] },
            { "metadataParts": [{ "text": { "content": "Premieres 10/12/26, 7:00 PM" } }] }
        ]));
        let item = lockup_item(&lockup).unwrap();
        assert!(item.is_upcoming);
        assert_eq!(related_to_video(item).view_count, None);
    }

    #[test]
    fn albums_and_courses_are_playlists_and_collabs_take_the_lead() {
        let album = json!({
            "contentType": "LOCKUP_CONTENT_TYPE_ALBUM",
            "contentId": "OLAK5uy_album",
            "metadata": { "lockupMetadataViewModel": { "title": { "content": "An album" } } }
        });
        let item = lockup_item(&album).unwrap();
        assert_eq!(item.item_type, "playlist");
        assert_eq!(item.id, "OLAK5uy_album");

        let collab = json!({
            "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
            "contentId": "co",
            "metadata": { "lockupMetadataViewModel": {
                "image": { "avatarStackViewModel": { "rendererContext": { "commandContext": { "onTap": {
                    "innertubeCommand": dialog(&[("UC1", "A"), ("UC2", "B")])
                } } } } }
            } }
        });
        let item = lockup_item(&collab).unwrap();
        assert_eq!(item.channel_id.as_deref(), Some("UC1"));
        assert_eq!(item.collaborators.len(), 2);
        assert!(lockup_item(&json!({ "contentType": "LOCKUP_CONTENT_TYPE_CHANNEL" })).is_none());
    }
}
