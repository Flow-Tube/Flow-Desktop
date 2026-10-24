//! Item renderers → [`YTItem`].
//!
//! Handles `musicResponsiveListItemRenderer` (list rows),
//! `musicTwoRowItemRenderer` (carousel/grid cards), and the
//! `musicCardShelfRenderer` "top result" card. Type dispatch is by `pageType`
//! with the **episode-before-song** ordering Metrolist marks as critical.

use serde_json::Value;

use super::endpoint::{
    album_from_menu, browse_id, has_explicit, menu_has_icon, music_video_type, page_type,
    row_video_type, video_id,
};
use super::runs::{
    flex_text, looks_like_play_count, parse_artists_and_year, parse_song_meta, runs_text,
};
use super::thumbnail::thumbnail_url;
use crate::api::innertube::music::endpoints;
use crate::models::music::{
    Album, AlbumItem, Artist, ArtistItem, EpisodeItem, PlaylistItem, PodcastItem, SongItem, YTItem,
};

/// Dispatch any carousel/list item wrapper to a [`YTItem`].
#[must_use]
pub fn parse_yt_item(item: &Value) -> Option<YTItem> {
    if let Some(r) = item.get("musicResponsiveListItemRenderer") {
        return parse_responsive_list_item(r);
    }
    if let Some(r) = item.get("musicTwoRowItemRenderer") {
        return parse_two_row_item(r);
    }
    None
}

fn song_from_responsive(r: &Value, title: String, thumbnail: Option<String>) -> Option<YTItem> {
    let vid = video_id(r)?;
    let (artists, album, duration) = parse_song_meta(r);
    let album = album.or_else(|| album_from_menu(r));
    let mvt = row_video_type(r);
    Some(YTItem::Song(SongItem {
        id: vid.clone(),
        title,
        artists,
        album,
        duration,
        music_video_type: mvt,
        thumbnail: thumbnail.unwrap_or_default(),
        explicit: has_explicit(r),
        video_id: Some(vid),
        playlist_id: r["navigationEndpoint"]["watchEndpoint"]["playlistId"]
            .as_str()
            .map(ToOwned::to_owned),
        params: None,
        views_text: None,
    }))
}

const EPISODE_VIDEO_TYPE: &str = "MUSIC_VIDEO_TYPE_PODCAST_EPISODE";
const SEPARATOR: &str = " \u{2022} ";

fn column_runs(r: &Value, column: usize) -> &[Value] {
    r["flexColumns"][column]["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"]
        .as_array()
        .map_or(&[], Vec::as_slice)
}

/// An episode says so only on its title run's page type or its play button,
/// never on the row: read first, or it lands among the songs.
fn is_episode_row(r: &Value) -> bool {
    let title_page =
        page_type(&column_runs(r, 0).first().unwrap_or(&Value::Null)["navigationEndpoint"]);
    page_type(&r["navigationEndpoint"])
        .into_iter()
        .chain(title_page)
        .any(|page| page.contains("NON_MUSIC_AUDIO_TRACK"))
        || row_video_type(r).as_deref() == Some(EPISODE_VIDEO_TYPE)
}

/// The plain runs of a row's byline, past the leading type label a search row
/// starts with ("Episode • 4d ago • Show").
fn plain_byline(r: &Value) -> Vec<String> {
    let flex_count = r["flexColumns"].as_array().map_or(0, Vec::len);
    let mut parts = Vec::new();
    for column in 1..flex_count {
        let runs = column_runs(r, column);
        let labelled =
            column == 1 && runs.get(1).and_then(|run| run["text"].as_str()) == Some(SEPARATOR);
        for (index, run) in runs.iter().enumerate() {
            if labelled && index == 0 || run.get("navigationEndpoint").is_some() {
                continue;
            }
            if let Some(text) = run["text"]
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty() && *text != "\u{2022}")
            {
                parts.push(text.to_string());
            }
        }
    }
    parts
}

fn episode_from_row(r: &Value, title: String, thumbnail: Option<String>) -> Option<YTItem> {
    let show = (1..r["flexColumns"].as_array().map_or(0, Vec::len))
        .flat_map(|column| column_runs(r, column))
        .find(|run| {
            page_type(&run["navigationEndpoint"]).is_some_and(|page| page.contains("PODCAST_SHOW"))
        });
    let id = video_id(r).or_else(|| browse_id(&r["navigationEndpoint"]))?;
    Some(YTItem::Episode(EpisodeItem {
        id,
        title,
        author: show
            .and_then(|run| run["text"].as_str())
            .map(|name| Artist {
                name: name.to_string(),
                id: None,
            })
            .or_else(|| parse_song_meta(r).0.into_iter().next()),
        podcast_id: show
            .and_then(|run| browse_id(&run["navigationEndpoint"]))
            .map(|id| endpoints::podcast_playlist_id(&id).to_string()),
        thumbnail: thumbnail.unwrap_or_default(),
        explicit: has_explicit(r),
        publish_date_text: plain_byline(r).into_iter().next(),
    }))
}

/// Parse a `musicResponsiveListItemRenderer` row.
#[must_use]
pub fn parse_responsive_list_item(r: &Value) -> Option<YTItem> {
    let title = flex_text(r, 0)?;
    let thumbnail = thumbnail_url(r);
    let nav = &r["navigationEndpoint"];

    if is_episode_row(r) {
        return episode_from_row(r, title, thumbnail);
    }
    match page_type(nav) {
        Some(pt) if pt.contains("ARTIST") || pt.contains("USER_CHANNEL") => {
            let id = browse_id(nav)?;
            Some(YTItem::Artist(ArtistItem {
                id: id.clone(),
                title: title.trim().to_string(),
                thumbnail,
                channel_id: Some(id),
                is_profile: pt.contains("USER_CHANNEL"),
            }))
        }
        Some(pt) if pt.contains("ALBUM") || pt.contains("AUDIOBOOK") => {
            let browse = browse_id(nav).unwrap_or_default();
            let (artists, year) = parse_artists_and_year(
                &r["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]["text"],
            );
            Some(YTItem::Album(AlbumItem {
                browse_id: browse,
                playlist_id: String::new(),
                title,
                artists: (!artists.is_empty()).then_some(artists),
                year,
                thumbnail: thumbnail.unwrap_or_default(),
                explicit: has_explicit(r),
            }))
        }
        Some(pt) if pt.contains("PODCAST") => {
            let id =
                endpoints::podcast_playlist_id(&browse_id(nav).unwrap_or_default()).to_string();
            Some(YTItem::Podcast(PodcastItem {
                id,
                title,
                author: parse_song_meta(r).0.into_iter().next(),
                episode_count_text: flex_text(r, 1),
                thumbnail,
            }))
        }
        Some(pt) if pt.contains("PLAYLIST") => {
            let id = endpoints::unvl(&browse_id(nav).unwrap_or_default()).to_string();
            Some(YTItem::Playlist(PlaylistItem {
                id,
                title,
                author: parse_song_meta(r).0.into_iter().next(),
                song_count_text: flex_text(r, 1),
                thumbnail,
            }))
        }
        // The reduced search layout can type an artist UNKNOWN, or not at all;
        // a channel id with an artist radio in its menu is one (#1379).
        _ if browse_id(nav).is_some_and(|id| id.starts_with("UC")) && menu_has_icon(r, "MIX") => {
            let id = browse_id(nav)?;
            Some(YTItem::Artist(ArtistItem {
                id: id.clone(),
                title,
                thumbnail,
                channel_id: Some(id),
                is_profile: false,
            }))
        }
        _ => song_from_responsive(r, title, thumbnail),
    }
}

/// An episode as a playable track, for lists that hold tracks (a podcast's page).
#[must_use]
pub fn episode_as_song(episode: EpisodeItem) -> SongItem {
    SongItem {
        video_id: Some(episode.id.clone()),
        id: episode.id,
        title: episode.title,
        artists: episode.author.into_iter().collect(),
        album: None,
        duration: None,
        music_video_type: Some(EPISODE_VIDEO_TYPE.to_string()),
        thumbnail: episode.thumbnail,
        explicit: episode.explicit,
        playlist_id: episode.podcast_id,
        params: None,
        views_text: None,
    }
}

/// Parse a `musicTwoRowItemRenderer` (carousel/grid card).
#[must_use]
pub fn parse_two_row_item(r: &Value) -> Option<YTItem> {
    let title = runs_text(&r["title"])?;
    let thumbnail = thumbnail_url(r);
    let nav = &r["navigationEndpoint"];
    let subtitle = &r["subtitle"];

    // Watch endpoint present → it's a song/video.
    if let Some(vid) = nav["watchEndpoint"]["videoId"].as_str() {
        let (artists, _year) = parse_artists_and_year(subtitle);
        return Some(YTItem::Song(SongItem {
            id: vid.to_string(),
            title,
            artists,
            album: album_from_menu(r),
            duration: None,
            music_video_type: music_video_type(nav),
            thumbnail: thumbnail.unwrap_or_default(),
            explicit: has_explicit(r),
            video_id: Some(vid.to_string()),
            playlist_id: nav["watchEndpoint"]["playlistId"]
                .as_str()
                .map(ToOwned::to_owned),
            params: None,
            views_text: None,
        }));
    }

    match page_type(nav) {
        Some(pt) if pt.contains("ARTIST") || pt.contains("USER_CHANNEL") => {
            let id = browse_id(nav)?;
            Some(YTItem::Artist(ArtistItem {
                id: id.clone(),
                title,
                thumbnail,
                channel_id: Some(id),
                is_profile: pt.contains("USER_CHANNEL"),
            }))
        }
        Some(pt) if pt.contains("ALBUM") || pt.contains("AUDIOBOOK") => {
            let (artists, year) = parse_artists_and_year(subtitle);
            Some(YTItem::Album(AlbumItem {
                browse_id: browse_id(nav).unwrap_or_default(),
                playlist_id: nav["watchPlaylistEndpoint"]["playlistId"]
                    .as_str()
                    .map(ToOwned::to_owned)
                    .unwrap_or_default(),
                title,
                artists: (!artists.is_empty()).then_some(artists),
                year,
                thumbnail: thumbnail.unwrap_or_default(),
                explicit: has_explicit(r),
            }))
        }
        Some(pt) if pt.contains("PODCAST") => Some(YTItem::Podcast(PodcastItem {
            id: endpoints::podcast_playlist_id(&browse_id(nav).unwrap_or_default()).to_string(),
            title,
            author: parse_artists_and_year(subtitle).0.into_iter().next(),
            episode_count_text: runs_text(subtitle),
            thumbnail,
        })),
        _ => {
            // Default to playlist (two-row playlist/mix cards).
            let id = endpoints::unvl(&browse_id(nav).unwrap_or_default()).to_string();
            if id.is_empty() {
                return None;
            }
            Some(YTItem::Playlist(PlaylistItem {
                id,
                title,
                author: parse_artists_and_year(subtitle).0.into_iter().next(),
                song_count_text: runs_text(subtitle),
                thumbnail,
            }))
        }
    }
}

/// Parse the "top result" `musicCardShelfRenderer` card.
#[must_use]
pub fn parse_card_shelf(card: &Value) -> Option<YTItem> {
    let title = runs_text(&card["title"])?;
    let thumbnail = thumbnail_url(card);
    let on_tap = &card["onTap"];
    let subtitle = &card["subtitle"];

    if let Some(vid) = on_tap["watchEndpoint"]["videoId"].as_str() {
        let (artists, _) = parse_artists_and_year(subtitle);
        return Some(YTItem::Song(SongItem {
            id: vid.to_string(),
            title,
            artists,
            album: album_from_menu(card),
            duration: None,
            music_video_type: music_video_type(on_tap),
            thumbnail: thumbnail.unwrap_or_default(),
            explicit: has_explicit(card),
            video_id: Some(vid.to_string()),
            playlist_id: None,
            params: None,
            views_text: None,
        }));
    }

    match page_type(on_tap) {
        Some(pt) if pt.contains("ARTIST") || pt.contains("USER_CHANNEL") => {
            let id = browse_id(on_tap)?;
            Some(YTItem::Artist(ArtistItem {
                id: id.clone(),
                title,
                thumbnail,
                channel_id: Some(id),
                is_profile: pt.contains("USER_CHANNEL"),
            }))
        }
        Some(pt) if pt.contains("ALBUM") || pt.contains("AUDIOBOOK") => {
            let (artists, year) = parse_artists_and_year(subtitle);
            Some(YTItem::Album(AlbumItem {
                browse_id: browse_id(on_tap).unwrap_or_default(),
                playlist_id: String::new(),
                title,
                artists: (!artists.is_empty()).then_some(artists),
                year,
                thumbnail: thumbnail.unwrap_or_default(),
                explicit: has_explicit(card),
            }))
        }
        Some(pt) if pt.contains("PLAYLIST") => Some(YTItem::Playlist(PlaylistItem {
            id: endpoints::unvl(&browse_id(on_tap).unwrap_or_default()).to_string(),
            title,
            author: None,
            song_count_text: runs_text(subtitle),
            thumbnail,
        })),
        _ => None,
    }
}

fn album_track_plays(r: &Value) -> Option<String> {
    (1..4).find_map(|col| flex_text(r, col).filter(|t| looks_like_play_count(t)))
}

/// Album rows carry no per-track artist or cover art (both live only in the album
/// header), so each track inherits them from this context.
pub struct AlbumTrackCtx {
    pub album: Album,
    pub artists: Vec<Artist>,
    pub thumbnail: String,
}

/// Album helper used by the album-songs continuation loop.
#[must_use]
pub fn album_track(r: &Value, ctx: Option<&AlbumTrackCtx>) -> Option<SongItem> {
    let title = flex_text(r, 0)?;
    let vid = video_id(r)?;
    let (mut artists, parsed_album, duration) = parse_song_meta(r);
    // An album row's artist lives in the header (threaded via ctx), not the row.
    // Keep only linked featured artists from the byline; otherwise take the
    // header's, so an unlinked run like "3.4B plays" can't stand in as the artist.
    if let Some(ctx) = ctx {
        artists.retain(|a| a.id.is_some());
        if artists.is_empty() {
            artists = ctx.artists.clone();
        }
    }
    let thumbnail = thumbnail_url(r)
        .filter(|t| !t.is_empty())
        .or_else(|| ctx.map(|c| c.thumbnail.clone()).filter(|t| !t.is_empty()))
        .unwrap_or_default();
    Some(SongItem {
        id: vid.clone(),
        title,
        artists,
        album: parsed_album.or_else(|| ctx.map(|c| c.album.clone())),
        duration,
        music_video_type: None,
        thumbnail,
        explicit: has_explicit(r),
        video_id: Some(vid),
        playlist_id: None,
        params: None,
        views_text: album_track_plays(r),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(text: &str) -> Value {
        json!({ "text": text })
    }

    fn linked(text: &str, browse_id: &str, page: &str) -> Value {
        json!({ "text": text, "navigationEndpoint": { "browseEndpoint": {
            "browseId": browse_id,
            "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": page } }
        } } })
    }

    fn row(columns: &[Vec<Value>], extra: &Value) -> Value {
        let mut row = json!({ "flexColumns": columns.iter().map(|runs| json!({
            "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": runs } }
        })).collect::<Vec<_>>() });
        for (key, value) in extra.as_object().unwrap() {
            row[key] = value.clone();
        }
        row
    }

    fn episode_overlay(video_id: &str) -> Value {
        json!({ "overlay": { "musicItemThumbnailOverlayRenderer": { "content": { "musicPlayButtonRenderer": {
            "playNavigationEndpoint": { "watchEndpoint": { "videoId": video_id, "watchEndpointMusicSupportedConfigs": {
                "watchEndpointMusicConfig": { "musicVideoType": "MUSIC_VIDEO_TYPE_PODCAST_EPISODE" } } } }
        } } } } })
    }

    #[test]
    fn a_search_episode_is_an_episode_of_its_show() {
        let r = row(
            &[
                vec![linked(
                    "Why Hit Songs",
                    "MPEDcKOVOZ6H1eI",
                    "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE",
                )],
                vec![
                    run("Episode"),
                    run(" \u{2022} "),
                    run("4d ago"),
                    run(" \u{2022} "),
                    linked(
                        "EVERY-TIME PODCAST",
                        "MPSPPLQPfLTZQIOPM",
                        "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE",
                    ),
                ],
            ],
            &episode_overlay("ep000000001"),
        );
        let Some(YTItem::Episode(episode)) = parse_responsive_list_item(&r) else {
            panic!("episode")
        };
        assert_eq!(episode.id, "ep000000001");
        assert_eq!(
            episode.author.map(|a| a.name).as_deref(),
            Some("EVERY-TIME PODCAST")
        );
        assert_eq!(episode.podcast_id.as_deref(), Some("PLQPfLTZQIOPM"));
        assert_eq!(episode.publish_date_text.as_deref(), Some("4d ago"));
    }

    #[test]
    fn a_podcast_page_row_is_an_episode_and_plays_as_a_track() {
        let r = row(
            &[
                vec![linked(
                    "DAWN FM",
                    "MPEDlhW1h",
                    "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE",
                )],
                vec![linked(
                    "Ondas",
                    "MPSPPLYW",
                    "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE",
                )],
                vec![run("Apr 7, 2023")],
            ],
            &episode_overlay("ep000000002"),
        );
        let Some(YTItem::Episode(episode)) = parse_responsive_list_item(&r) else {
            panic!("episode")
        };
        assert_eq!(episode.publish_date_text.as_deref(), Some("Apr 7, 2023"));
        let song = episode_as_song(episode);
        assert_eq!(song.video_id.as_deref(), Some("ep000000002"));
        assert_eq!(song.artists[0].name, "Ondas");
    }

    #[test]
    fn a_profile_is_marked_and_an_untyped_artist_is_still_an_artist() {
        let profile = row(
            &[vec![run("Fan Page ")], vec![run("Profile")]],
            &json!({
                "navigationEndpoint": linked("", "UCprofile", "MUSIC_PAGE_TYPE_USER_CHANNEL")["navigationEndpoint"]
            }),
        );
        let Some(YTItem::Artist(profile)) = parse_responsive_list_item(&profile) else {
            panic!("profile")
        };
        assert!(profile.is_profile);
        assert_eq!(profile.title, "Fan Page");

        let untyped = row(
            &[vec![run("Ariana Grande")], vec![run("Artist")]],
            &json!({
                "navigationEndpoint": { "browseEndpoint": { "browseId": "UC0076UMUgEng8HORUw_MYHA" } },
                "menu": { "menuRenderer": { "items": [
                    { "menuNavigationItemRenderer": { "icon": { "iconType": "MUSIC_SHUFFLE" } } },
                    { "menuNavigationItemRenderer": { "icon": { "iconType": "MIX" } } }
                ] } }
            }),
        );
        let Some(YTItem::Artist(artist)) = parse_responsive_list_item(&untyped) else {
            panic!("artist")
        };
        assert!(!artist.is_profile);
    }

    #[test]
    fn a_podcast_opens_its_playlist() {
        let r = row(
            &[vec![run("The Weekend Show")], vec![run("Podcast")]],
            &json!({
                "navigationEndpoint": linked("", "MPSPPL36GQAcc", "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE")["navigationEndpoint"]
            }),
        );
        let Some(YTItem::Podcast(podcast)) = parse_responsive_list_item(&r) else {
            panic!("podcast")
        };
        assert_eq!(podcast.id, "PL36GQAcc");
    }
}
