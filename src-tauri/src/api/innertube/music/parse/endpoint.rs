//! Navigation/watch/browse endpoint extraction and `pageType` dispatch.

use serde_json::Value;

use crate::models::music::Album;

/// Music `pageType` of a navigation endpoint's browse config, if present.
#[must_use]
pub fn page_type(nav: &Value) -> Option<&str> {
    nav["browseEndpoint"]["browseEndpointContextSupportedConfigs"]
        ["browseEndpointContextMusicConfig"]["pageType"]
        .as_str()
}

/// `browseId` of a navigation endpoint.
#[must_use]
pub fn browse_id(nav: &Value) -> Option<String> {
    nav["browseEndpoint"]["browseId"]
        .as_str()
        .map(ToOwned::to_owned)
}

/// `browseEndpoint.params` of a navigation endpoint.
#[must_use]
pub fn browse_params(nav: &Value) -> Option<String> {
    nav["browseEndpoint"]["params"]
        .as_str()
        .map(ToOwned::to_owned)
}

/// The 4-way `videoId` fallback chain used by every song/episode parser.
#[must_use]
pub fn video_id(r: &Value) -> Option<String> {
    r["playlistItemData"]["videoId"]
        .as_str()
        .or_else(|| r["navigationEndpoint"]["watchEndpoint"]["videoId"].as_str())
        .or_else(|| {
            r["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]["musicPlayButtonRenderer"]
                ["playNavigationEndpoint"]["watchEndpoint"]["videoId"]
                .as_str()
        })
        .or_else(|| {
            r["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]
                ["navigationEndpoint"]["watchEndpoint"]["videoId"]
                .as_str()
        })
        .map(ToOwned::to_owned)
}

/// `musicVideoType` from a watch endpoint's music config (e.g. `..._ATV`).
#[must_use]
pub fn music_video_type(nav: &Value) -> Option<String> {
    nav["watchEndpoint"]["watchEndpointMusicSupportedConfigs"]["watchEndpointMusicConfig"]
        ["musicVideoType"]
        .as_str()
        .map(ToOwned::to_owned)
}

/// Album from a row's "Go to album" menu, when the byline has no album link. Name
/// is left empty — the menu label is the localized action text, not the title.
#[must_use]
pub fn album_from_menu(r: &Value) -> Option<Album> {
    let items = r["menu"]["menuRenderer"]["items"].as_array()?;
    items.iter().find_map(|item| {
        let nav = &item["menuNavigationItemRenderer"]["navigationEndpoint"];
        let pt = page_type(nav)?;
        if !(pt.contains("ALBUM") || pt.contains("AUDIOBOOK")) {
            return None;
        }
        let id = browse_id(nav)?;
        (!id.is_empty()).then(|| Album {
            name: String::new(),
            id,
        })
    })
}

/// `MUSIC_EXPLICIT_BADGE` presence on a renderer's `badges`.
#[must_use]
pub fn has_explicit(r: &Value) -> bool {
    r["badges"].as_array().is_some_and(|badges| {
        badges.iter().any(|b| {
            b["musicInlineBadgeRenderer"]["icon"]["iconType"].as_str()
                == Some("MUSIC_EXPLICIT_BADGE")
        })
    })
}
