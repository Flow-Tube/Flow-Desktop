//! Album page extractor: header (title/artists/year/description/counts) + the
//! full track list, with continuation paging.

use std::collections::HashSet;

use serde_json::Value;

use super::endpoints;
use super::parse::items::{AlbumTrackCtx, album_track};
use super::parse::runs::{parse_artists_and_year, runs_text};
use super::parse::thumbnail::thumbnail_url;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{Album, AlbumItem, SongItem};
use crate::models::music_pages::AlbumPage;

impl InnertubeClient {
    /// Fetch an album page by its browse id (`MPRE…`).
    pub(crate) async fn music_album_page(&self, browse_id: &str) -> AppResult<AlbumPage> {
        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(Some(browse_id), None, None, visitor.as_deref())
            .await?;

        let header = find_album_header(&res);
        let title = runs_text(&header["title"]).unwrap_or_default();
        let thumbnail = thumbnail_url(header);

        let (mut artists, mut year) = parse_artists_and_year(&header["straplineTextOne"]);
        if artists.is_empty() {
            let (a, y) = parse_artists_and_year(&header["subtitle"]);
            artists = a;
            year = year.or(y);
        }

        let description =
            runs_text(&header["description"]["musicDescriptionShelfRenderer"]["description"]);
        let second = runs_text(&header["secondSubtitle"]);
        let (song_count, duration_text) = parse_count_and_duration(second.as_deref());

        let album_ref = Album {
            name: title.clone(),
            id: browse_id.to_string(),
        };
        let playlist_id = extract_album_playlist_id(&res, header);

        let ctx = AlbumTrackCtx {
            album: album_ref,
            artists: artists.clone(),
            thumbnail: thumbnail.clone().unwrap_or_default(),
        };

        let (mut songs, mut continuation_token) = collect_album_tracks(&res, &ctx);
        let looks_capped = continuation_token.is_some() || songs.len() >= 100;
        if looks_capped && !playlist_id.is_empty() {
            if let Ok(full) = self
                .music_album_songs(&playlist_id, &ctx, visitor.as_deref())
                .await
            {
                if full.len() >= songs.len() {
                    songs = full;
                    continuation_token = None;
                }
            }
        }

        let album = AlbumItem {
            browse_id: browse_id.to_string(),
            playlist_id,
            title,
            artists: (!artists.is_empty()).then_some(artists),
            year,
            thumbnail: thumbnail.unwrap_or_default(),
            explicit: false,
        };

        Ok(AlbumPage {
            album,
            description,
            song_count,
            duration_text,
            songs,
            continuation: continuation_token,
        })
    }

    async fn music_album_songs(
        &self,
        playlist_id: &str,
        ctx: &AlbumTrackCtx,
        visitor: Option<&str>,
    ) -> AppResult<Vec<SongItem>> {
        let pl = endpoints::vl(playlist_id);
        let res = self.music_browse(Some(&pl), None, None, visitor).await?;

        let mut seen = HashSet::new();
        let (page, mut next) = collect_album_tracks(&res, ctx);
        let mut songs = Vec::new();
        for s in page {
            let key = s.video_id.clone().unwrap_or_else(|| s.id.clone());
            if seen.insert(key) {
                songs.push(s);
            }
        }

        const MAX_REQUESTS: usize = 50;
        let mut seen_tokens = HashSet::new();
        let mut requests = 0;
        while let Some(token) = next.take() {
            if requests >= MAX_REQUESTS || !seen_tokens.insert(token.clone()) {
                break;
            }
            requests += 1;
            let res = self.music_browse(None, None, Some(&token), visitor).await?;
            next = parse_album_continuation(&res, Some(ctx), &mut songs, &mut seen);
        }

        Ok(songs)
    }

    pub(crate) async fn music_album_continuation(
        &self,
        token: &str,
    ) -> AppResult<(Vec<SongItem>, Option<String>)> {
        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(None, None, Some(token), visitor.as_deref())
            .await?;
        let mut songs = Vec::new();
        let mut seen = HashSet::new();
        let next = parse_album_continuation(&res, None, &mut songs, &mut seen);
        Ok((songs, next))
    }
}

fn parse_album_continuation(
    res: &Value,
    ctx: Option<&AlbumTrackCtx>,
    songs: &mut Vec<SongItem>,
    seen: &mut HashSet<String>,
) -> Option<String> {
    let mut next = None;
    let cont = &res["continuationContents"];

    // Section-list continuation: wraps one or more shelves and carries its own
    // next token (`continuations`) a level above the shelf. Some large
    // playlists/albums page exclusively this way.
    if let Some(arr) = cont["sectionListContinuation"]["contents"].as_array() {
        for section in arr {
            for key in ["musicPlaylistShelfRenderer", "musicShelfRenderer"] {
                collect_album_rows(&section[key]["contents"], ctx, songs, seen);
            }
        }
        if next.is_none() {
            next = continuation::from_continuations(&cont["sectionListContinuation"]);
        }
    }

    for shelf in [
        &cont["musicPlaylistShelfContinuation"],
        &cont["musicShelfContinuation"],
    ] {
        collect_album_rows(&shelf["contents"], ctx, songs, seen);
        if next.is_none() {
            next = continuation::any(shelf, &shelf["contents"]);
        }
    }

    if let Some(actions) = res["onResponseReceivedActions"].as_array() {
        for action in actions {
            let items = &action["appendContinuationItemsAction"]["continuationItems"];
            collect_album_rows(items, ctx, songs, seen);
            if next.is_none() {
                next = continuation::from_items(items);
            }
        }
    }

    if next.is_none() {
        next = continuation::from_continuations(&res["contents"]["sectionListRenderer"]);
    }

    next
}

/// Locate the album header renderer across the known layouts.
fn find_album_header(res: &Value) -> &Value {
    let two_col = &res["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]
        ["sectionListRenderer"]["contents"][0]["musicResponsiveHeaderRenderer"];
    if !two_col.is_null() {
        return two_col;
    }
    let responsive = &res["header"]["musicResponsiveHeaderRenderer"];
    if !responsive.is_null() {
        return responsive;
    }
    &res["header"]["musicDetailHeaderRenderer"]
}

/// Collect album tracks from either the two-column secondary contents or the
/// single-column section list.
fn collect_album_tracks(res: &Value, ctx: &AlbumTrackCtx) -> (Vec<SongItem>, Option<String>) {
    let mut songs = Vec::new();
    let mut cont = None;
    let mut seen = HashSet::new();

    let sections: Vec<Value> = shelves::section_list_contents(res);
    for section in &sections {
        let shelf = if !section["musicShelfRenderer"].is_null() {
            &section["musicShelfRenderer"]
        } else if !section["musicPlaylistShelfRenderer"].is_null() {
            &section["musicPlaylistShelfRenderer"]
        } else {
            continue;
        };
        collect_album_rows(&shelf["contents"], Some(ctx), &mut songs, &mut seen);
        if cont.is_none() {
            cont = continuation::any(shelf, &shelf["contents"])
                .or_else(|| continuation::from_continuations(section));
        }
    }

    if cont.is_none() {
        cont = continuation::from_continuations(&res["contents"]["sectionListRenderer"])
            .or_else(|| {
                continuation::from_continuations(
                    &res["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]
                        ["tabRenderer"]["content"]["sectionListRenderer"],
                )
            })
            .or_else(|| {
                continuation::from_continuations(
                    &res["contents"]["twoColumnBrowseResultsRenderer"]["secondaryContents"]
                        ["sectionListRenderer"],
                )
            });
    }

    (songs, cont)
}

fn collect_album_rows(
    items: &Value,
    ctx: Option<&AlbumTrackCtx>,
    songs: &mut Vec<SongItem>,
    seen: &mut HashSet<String>,
) {
    if let Some(arr) = items.as_array() {
        for item in arr {
            if let Some(s) = album_track(&item["musicResponsiveListItemRenderer"], ctx) {
                let key = s.video_id.clone().unwrap_or_else(|| s.id.clone());
                if seen.insert(key) {
                    songs.push(s);
                }
            }
        }
    }
}

/// Album playlist id from microformat `urlCanonical` (`?list=…`) or the header
/// play button's watch-playlist endpoint.
fn extract_album_playlist_id(res: &Value, header: &Value) -> String {
    if let Some(url) = res["microformat"]["microformatDataRenderer"]["urlCanonical"].as_str() {
        if let Some(idx) = url.rfind("list=") {
            let id = url[idx + 5..].split('&').next().unwrap_or_default();
            if !id.is_empty() {
                return id.to_string();
            }
        }
    }
    header["buttons"]
        .as_array()
        .and_then(|btns| {
            btns.iter().find_map(|b| {
                b["musicPlayButtonRenderer"]["playNavigationEndpoint"]["watchEndpoint"]
                    ["playlistId"]
                    .as_str()
            })
        })
        .unwrap_or_default()
        .to_string()
}

/// Parse "N songs • X minutes" style text into (count, duration text).
fn parse_count_and_duration(second: Option<&str>) -> (Option<u32>, Option<String>) {
    let Some(text) = second else {
        return (None, None);
    };
    let mut count = None;
    let mut duration = None;
    for part in text.split('•') {
        let p = part.trim();
        let lower = p.to_ascii_lowercase();
        if lower.contains("song") || lower.contains("track") {
            count = p
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == ',')
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u32>()
                .ok();
        } else if lower.contains("minute") || lower.contains("hour") || lower.contains("second") {
            duration = Some(p.to_string());
        }
    }
    (count, duration)
}
