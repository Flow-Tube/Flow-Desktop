//! Artist page extractor (reuses the existing `models::music::ArtistPage`).

use base64::Engine;
use serde_json::Value;

use super::parse::endpoint::{browse_id, browse_params};
use super::parse::runs::runs_text;
use super::parse::shelves;
use super::parse::thumbnail::thumbnail_url;
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::json::rich_text::unwrap_redirect;
use crate::errors::AppResult;
use crate::models::music::{
    ArtistItem, ArtistPage, ArtistSection, ArtistSectionKind, DescriptionLink, MusicWatchTarget,
    YTItem,
};

/// Browse ids of an artist's release lists ("Albums", "Singles & EPs").
const RELEASES_BROWSE_PREFIX: &str = "MPAD";

impl InnertubeClient {
    /// Fetch an artist page by channel/browse id (`UC…`).
    pub(crate) async fn music_artist_page(&self, browse_id: &str) -> AppResult<ArtistPage> {
        let res = self.music_browse(Some(browse_id), None, None).await?;
        Ok(parse_artist_page(browse_id, &res))
    }
}

#[must_use]
pub fn parse_artist_page(browse_id: &str, res: &Value) -> ArtistPage {
    let header = find_artist_header(res);
    let title = runs_text(&header["title"]).unwrap_or_default();
    let thumbnail = thumbnail_url(header);
    let description_runs = header["description"]["musicDescriptionShelfRenderer"]["description"]
        .get("runs")
        .map_or(&header["description"], |_| {
            &header["description"]["musicDescriptionShelfRenderer"]["description"]
        });
    let description = runs_text(description_runs);
    let subscribe = &header["subscriptionButton"]["subscribeButtonRenderer"];
    let subscriber_count_text = runs_text(
        &header["subscriptionButton2"]["subscribeButtonRenderer"]["subscriberCountWithSubscribeText"],
    )
    .or_else(|| runs_text(&subscribe["longSubscriberCountText"]))
    .or_else(|| runs_text(&subscribe["subscriberCountText"]))
    .or_else(|| runs_text(&subscribe["shortSubscriberCountText"]));
    let monthly_listener_count = runs_text(&header["monthlyListenerCount"]);
    let artist_ids: Vec<&str> = [Some(browse_id), subscribe["channelId"].as_str()]
        .into_iter()
        .flatten()
        .collect();

    let mut sections: Vec<(ArtistSection, Option<ArtistSectionKind>, bool)> = Vec::new();
    for section in shelves::section_list_contents(res) {
        let Some(shelf) = shelves::parse_section(&section) else {
            continue;
        };
        let carousel = &section["musicCarouselShelfRenderer"];
        sections.push((
            ArtistSection {
                title: shelf.title,
                items: shelf.items,
                more_endpoint_browse_id: shelf.browse_id,
                more_endpoint_params: shelf.params,
                kind: if section.get("musicShelfRenderer").is_some() {
                    ArtistSectionKind::TopSongs
                } else {
                    ArtistSectionKind::Other
                },
            },
            discography_kind(carousel),
            shows_release_type(carousel),
        ));
    }

    ArtistPage {
        artist: ArtistItem {
            id: browse_id.to_string(),
            title,
            thumbnail,
            channel_id: Some(browse_id.to_string()),
            is_profile: false,
        },
        sections: classify(sections, &artist_ids),
        description,
        description_links: description_links(description_runs),
        shuffle: watch_target(&header["playButton"]),
        radio: watch_target(&header["startRadioButton"]),
        subscriber_count_text,
        monthly_listener_count,
        is_subscribed: false,
    }
}

fn watch_target(button: &Value) -> Option<MusicWatchTarget> {
    let nav = &button["buttonRenderer"]["navigationEndpoint"];
    let endpoint = nav
        .get("watchEndpoint")
        .or_else(|| nav.get("watchPlaylistEndpoint"))?;
    Some(MusicWatchTarget {
        playlist_id: endpoint["playlistId"].as_str()?.to_string(),
        params: endpoint["params"].as_str().map(ToOwned::to_owned),
    })
}

/// A bio arrives as its text, then each link as its own run.
fn description_links(text: &Value) -> Vec<DescriptionLink> {
    let mut offset = 0;
    text["runs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|run| {
            let start = offset;
            offset += run["text"]
                .as_str()
                .unwrap_or_default()
                .encode_utf16()
                .count();
            let url = run["navigationEndpoint"]["urlEndpoint"]["url"].as_str()?;
            Some(DescriptionLink {
                start,
                end: offset,
                url: unwrap_redirect(url),
            })
        })
        .collect()
}

/// One protobuf field of `bytes`: its value if a varint, its bytes if length-delimited.
fn proto_field(bytes: &[u8], number: u64) -> Option<Result<u64, &[u8]>> {
    fn varint(bytes: &[u8], at: &mut usize) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *bytes.get(*at)?;
            *at += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }
    let mut at = 0;
    while at < bytes.len() {
        let tag = varint(bytes, &mut at)?;
        let value = match tag & 7 {
            0 => Ok(varint(bytes, &mut at)?),
            2 => {
                let len = usize::try_from(varint(bytes, &mut at)?).ok()?;
                let slice = bytes.get(at..at + len)?;
                at += len;
                Err(slice)
            }
            _ => return None,
        };
        if tag >> 3 == number {
            return Some(value);
        }
    }
    None
}

/// Which release list a discography link opens. Its params hold field 48,
/// holding field 15, holding field 1: 1 for albums, 2 for singles and EPs, in
/// every interface language.
fn release_kind(params: &str) -> Option<ArtistSectionKind> {
    let decoded = params
        .replace("%3D", "=")
        .replace('-', "+")
        .replace('_', "/");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(decoded)
        .ok()?;
    let Some(Err(outer)) = proto_field(&bytes, 48) else {
        return None;
    };
    let Some(Err(filter)) = proto_field(outer, 15) else {
        return None;
    };
    match proto_field(filter, 1)? {
        Ok(1) => Some(ArtistSectionKind::Albums),
        Ok(2) => Some(ArtistSectionKind::Singles),
        _ => None,
    }
}

fn discography_kind(carousel: &Value) -> Option<ArtistSectionKind> {
    let header = &carousel["header"]["musicCarouselShelfBasicHeaderRenderer"];
    [
        &header["moreContentButton"]["buttonRenderer"]["navigationEndpoint"],
        &header["title"]["runs"][0]["navigationEndpoint"],
    ]
    .into_iter()
    .find(|nav| browse_id(nav).is_some_and(|id| id.starts_with(RELEASES_BROWSE_PREFIX)))
    .and_then(browse_params)
    .and_then(|params| release_kind(&params))
}

/// Every card names its release type ("Single • 2026"), as the singles shelf does.
fn shows_release_type(carousel: &Value) -> bool {
    let subtitles: Vec<usize> = carousel["contents"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["musicTwoRowItemRenderer"]["subtitle"]["runs"].as_array())
        .map(|runs| {
            runs.iter()
                .filter(|run| {
                    run["text"]
                        .as_str()
                        .is_some_and(|text| text.trim() != "\u{2022}")
                })
                .count()
        })
        .collect();
    !subtitles.is_empty() && subtitles.iter().all(|parts| *parts > 1)
}

/// Albums and Singles & EPs are both album shelves. A shelf's discography link
/// says which; an artist with few releases gets no link, so the rest are taken
/// in page order, Albums first, and a lone unlinked shelf goes by its subtitles.
fn release_kinds(
    sections: &[(ArtistSection, Option<ArtistSectionKind>, bool)],
) -> Vec<Option<ArtistSectionKind>> {
    let mut kinds = vec![None; sections.len()];
    let shelves: Vec<usize> = (0..sections.len())
        .filter(|&index| {
            let section = &sections[index].0;
            section.kind != ArtistSectionKind::TopSongs
                && !section.items.is_empty()
                && section
                    .items
                    .iter()
                    .all(|item| matches!(item, YTItem::Album(_)))
        })
        .collect();
    for &index in &shelves {
        if let Some(kind) = sections[index].1
            && !kinds.contains(&Some(kind))
        {
            kinds[index] = Some(kind);
        }
    }
    let open: Vec<ArtistSectionKind> = [ArtistSectionKind::Albums, ArtistSectionKind::Singles]
        .into_iter()
        .filter(|kind| !kinds.contains(&Some(*kind)))
        .collect();
    let unlinked: Vec<usize> = shelves
        .into_iter()
        .filter(|&index| kinds[index].is_none())
        .collect();
    if unlinked.len() == 1 && open.len() == 2 {
        let index = unlinked[0];
        kinds[index] = Some(if sections[index].2 {
            ArtistSectionKind::Singles
        } else {
            ArtistSectionKind::Albums
        });
    } else {
        for (index, kind) in unlinked.into_iter().zip(open) {
            kinds[index] = Some(kind);
        }
    }
    kinds
}

/// Types each section without reading its title. `artist_ids` tells the
/// artist's own playlists apart from the ones they are featured on.
fn classify(
    sections: Vec<(ArtistSection, Option<ArtistSectionKind>, bool)>,
    artist_ids: &[&str],
) -> Vec<ArtistSection> {
    let releases = release_kinds(&sections);
    let mut song_carousels = 0;
    sections
        .into_iter()
        .zip(releases)
        .map(|((mut section, _, _), release)| {
            let items = &section.items;
            let all = |test: fn(&YTItem) -> bool| !items.is_empty() && items.iter().all(test);
            section.kind = if section.kind == ArtistSectionKind::TopSongs {
                ArtistSectionKind::TopSongs
            } else if let Some(kind) = release {
                kind
            } else if all(|item| matches!(item, YTItem::Song(_))) {
                song_carousels += 1;
                if song_carousels == 1 {
                    ArtistSectionKind::Videos
                } else {
                    ArtistSectionKind::Other
                }
            } else if all(|item| matches!(item, YTItem::Artist(_))) {
                ArtistSectionKind::RelatedArtists
            } else if all(|item| matches!(item, YTItem::Playlist(_)))
                && section.more_endpoint_browse_id.is_none()
                && !items.iter().any(|item| {
                    matches!(item, YTItem::Playlist(playlist)
                        if playlist.author.as_ref().and_then(|author| author.id.as_deref()).is_some_and(|id| artist_ids.contains(&id)))
                })
            {
                ArtistSectionKind::FeaturedOn
            } else {
                ArtistSectionKind::Other
            };
            section
        })
        .collect()
}

fn find_artist_header(res: &Value) -> &Value {
    for key in [
        "musicImmersiveHeaderRenderer",
        "musicVisualHeaderRenderer",
        "musicHeaderRenderer",
        "musicDetailHeaderRenderer",
        "musicResponsiveHeaderRenderer",
    ] {
        let node = &res["header"][key];
        if !node.is_null() {
            return node;
        }
    }
    &res["header"]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::music::{AlbumItem, Artist, PlaylistItem};
    use serde_json::json;

    fn album(id: &str) -> YTItem {
        YTItem::Album(AlbumItem {
            browse_id: id.into(),
            playlist_id: String::new(),
            title: id.into(),
            artists: None,
            year: None,
            thumbnail: String::new(),
            explicit: false,
        })
    }

    fn section(items: Vec<YTItem>, more: Option<&str>) -> ArtistSection {
        ArtistSection {
            title: "localised".into(),
            items,
            more_endpoint_browse_id: more.map(ToOwned::to_owned),
            more_endpoint_params: None,
            kind: ArtistSectionKind::Other,
        }
    }

    #[test]
    fn discography_params_name_albums_and_singles() {
        assert_eq!(
            release_kind("ggMIegYIARoCAQI%3D"),
            Some(ArtistSectionKind::Albums)
        );
        assert_eq!(
            release_kind("ggMIegYIAhoCAQI%3D"),
            Some(ArtistSectionKind::Singles)
        );
        assert_eq!(release_kind("garbage"), None);
    }

    #[test]
    fn sections_are_typed_by_structure() {
        let playlist = |author: &str| {
            YTItem::Playlist(PlaylistItem {
                id: "PL".into(),
                title: "P".into(),
                author: Some(Artist {
                    name: "A".into(),
                    id: Some(author.into()),
                }),
                song_count_text: None,
                thumbnail: None,
            })
        };
        let mut top = section(vec![], None);
        top.kind = ArtistSectionKind::TopSongs;
        let sections = classify(
            vec![
                (top, None, false),
                (
                    section(vec![album("a")], Some("MPADx")),
                    Some(ArtistSectionKind::Singles),
                    true,
                ),
                (section(vec![album("b")], None), None, false),
                (section(vec![playlist("UCother")], None), None, false),
                (section(vec![playlist("UCartist")], None), None, false),
            ],
            &["UCartist"],
        );
        let kinds: Vec<_> = sections.iter().map(|section| section.kind).collect();
        assert_eq!(
            kinds,
            [
                ArtistSectionKind::TopSongs,
                ArtistSectionKind::Singles,
                ArtistSectionKind::Albums,
                ArtistSectionKind::FeaturedOn,
                ArtistSectionKind::Other,
            ]
        );
    }

    #[test]
    fn the_header_gives_shuffle_radio_and_the_bio_links() {
        let res = json!({ "header": { "musicImmersiveHeaderRenderer": {
            "title": { "runs": [{ "text": "The Weeknd" }] },
            "description": { "runs": [
                { "text": "Abel Tesfaye … " },
                { "text": "Wikipedia", "navigationEndpoint": { "urlEndpoint": { "url": "https://en.wikipedia.org/wiki/The_Weeknd" } } }
            ] },
            "playButton": { "buttonRenderer": { "navigationEndpoint": { "watchEndpoint": {
                "playlistId": "RDAOxyz", "params": "wAEB8gECGAE%3D" } } } },
            "startRadioButton": { "buttonRenderer": { "navigationEndpoint": { "watchEndpoint": {
                "playlistId": "RDEMxyz", "params": "wAEB" } } } },
            "subscriptionButton": { "subscribeButtonRenderer": { "subscriberCountText": { "runs": [{ "text": "38.5M" }] } } }
        } } });
        let page = parse_artist_page("UCx", &res);
        assert_eq!(
            page.shuffle
                .as_ref()
                .map(|target| target.playlist_id.as_str()),
            Some("RDAOxyz")
        );
        assert_eq!(
            page.radio
                .as_ref()
                .and_then(|target| target.params.as_deref()),
            Some("wAEB")
        );
        assert_eq!(page.subscriber_count_text.as_deref(), Some("38.5M"));
        assert_eq!(
            page.description_links[0].start,
            "Abel Tesfaye … ".encode_utf16().count()
        );
        assert_eq!(
            page.description_links[0].url,
            "https://en.wikipedia.org/wiki/The_Weeknd"
        );
    }
}
