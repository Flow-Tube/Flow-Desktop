//! Music playlist page extractor: header + tracks + continuation paging.

use std::collections::HashSet;

use serde_json::Value;

use super::endpoints;
use super::parse::items::{episode_as_song, parse_responsive_list_item};
use super::parse::runs::{parse_artists_and_year, runs_text};
use super::parse::thumbnail::thumbnail_url;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{SongItem, YTItem};
use crate::models::music_pages::MusicPlaylistPage;

impl InnertubeClient {
    /// Fetch a music playlist by its id (with or without the `VL` prefix).
    pub(crate) async fn music_playlist_page(
        &self,
        playlist_id: &str,
    ) -> AppResult<MusicPlaylistPage> {
        let browse = endpoints::vl(playlist_id);
        let res = self.music_browse(Some(&browse), None, None).await?;

        // A podcast's playlist page lists its episodes but has no header; the
        // show page (`MPSP…`) has it.
        let show_page = if find_playlist_header(&res).is_null() {
            let show = format!("MPSP{}", endpoints::unvl(&browse));
            self.music_browse(Some(&show), None, None).await.ok()
        } else {
            None
        };
        let header = show_page
            .as_ref()
            .map_or_else(|| find_playlist_header(&res), find_playlist_header);
        let title = runs_text(&header["title"]).unwrap_or_default();
        let thumbnail = thumbnail_url(header);
        let description =
            runs_text(&header["description"]["musicDescriptionShelfRenderer"]["description"])
                .or_else(|| runs_text(&header["description"]));
        let author = parse_artists_and_year(&header["straplineTextOne"])
            .0
            .into_iter()
            .next()
            .or_else(|| {
                parse_artists_and_year(&header["subtitle"])
                    .0
                    .into_iter()
                    .next()
            });
        let song_count_text =
            runs_text(&header["secondSubtitle"]).or_else(|| runs_text(&header["subtitle"]));

        let (songs, continuation_token) = collect_playlist_tracks(&res);

        Ok(MusicPlaylistPage {
            id: endpoints::unvl(&browse).to_string(),
            title,
            author,
            song_count_text,
            thumbnail,
            description,
            songs,
            continuation: continuation_token,
        })
    }

    /// Continue a playlist's track list.
    pub(crate) async fn music_playlist_continuation(
        &self,
        token: &str,
    ) -> AppResult<(Vec<SongItem>, Option<String>)> {
        let res = self.music_browse(None, None, Some(token)).await?;

        let mut songs = Vec::new();
        let mut seen = HashSet::new();
        let cont = &res["continuationContents"];

        // Collect rows from every known continuation shape: a section-list
        // continuation wrapping shelves, the direct shelf continuations, and the
        // append-action items. (Mirrors mobile `playlistContinuation`.)
        if let Some(arr) = cont["sectionListContinuation"]["contents"].as_array() {
            for section in arr {
                for key in ["musicPlaylistShelfRenderer", "musicShelfRenderer"] {
                    collect_playlist_rows(&section[key]["contents"], &mut songs, &mut seen);
                }
            }
        }
        collect_playlist_rows(
            &cont["musicPlaylistShelfContinuation"]["contents"],
            &mut songs,
            &mut seen,
        );
        collect_playlist_rows(
            &cont["musicShelfContinuation"]["contents"],
            &mut songs,
            &mut seen,
        );
        if let Some(actions) = res["onResponseReceivedActions"].as_array() {
            for action in actions {
                collect_playlist_rows(
                    &action["appendContinuationItemsAction"]["continuationItems"],
                    &mut songs,
                    &mut seen,
                );
            }
        }

        // Next token, in mobile's resolution order (section-list first).
        let next = continuation::from_continuations(&cont["sectionListContinuation"])
            .or_else(|| continuation::from_continuations(&cont["musicPlaylistShelfContinuation"]))
            .or_else(|| continuation::from_continuations(&cont["musicShelfContinuation"]))
            .or_else(|| {
                continuation::from_items(&cont["musicPlaylistShelfContinuation"]["contents"])
            })
            .or_else(|| continuation::from_items(&cont["musicShelfContinuation"]["contents"]))
            .or_else(|| {
                continuation::from_items(
                    &res["onResponseReceivedActions"][0]["appendContinuationItemsAction"]
                        ["continuationItems"],
                )
            });

        Ok((songs, next))
    }
}

fn find_playlist_header(res: &Value) -> &Value {
    for key in [
        "musicResponsiveHeaderRenderer",
        "musicEditablePlaylistDetailHeaderRenderer",
        "musicDetailHeaderRenderer",
    ] {
        let node = &res["header"][key];
        if !node.is_null() {
            return node;
        }
        // two-column layout nests the header in the first section
        let two_col = &res["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
            ["content"]["sectionListRenderer"]["contents"][0][key];
        if !two_col.is_null() {
            return two_col;
        }
    }
    &res["header"]["musicResponsiveHeaderRenderer"]
}

fn collect_playlist_tracks(res: &Value) -> (Vec<SongItem>, Option<String>) {
    let mut songs = Vec::new();
    let mut cont = None;
    let mut seen = HashSet::new();

    let sections = shelves::section_list_contents(res);
    for section in &sections {
        let shelf = if !section["musicPlaylistShelfRenderer"].is_null() {
            &section["musicPlaylistShelfRenderer"]
        } else if !section["musicShelfRenderer"].is_null() {
            &section["musicShelfRenderer"]
        } else {
            continue;
        };
        collect_playlist_rows(&shelf["contents"], &mut songs, &mut seen);
        if cont.is_none() {
            cont = continuation::any(shelf, &shelf["contents"]);
        }
    }

    // Large playlists carry the continuation on the section-list itself, a
    // level above the shelf (the shelf has no trailing token). Mirrors mobile
    // `playlist`, which reads `secondaryContents.sectionListRenderer.continuations`.
    if cont.is_none() {
        cont = continuation::from_continuations(
            &res["contents"]["twoColumnBrowseResultsRenderer"]["secondaryContents"]
                ["sectionListRenderer"],
        )
        .or_else(|| {
            continuation::from_continuations(
                &res["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                    ["content"]["sectionListRenderer"],
            )
        })
        .or_else(|| continuation::from_continuations(&res["contents"]["sectionListRenderer"]));
    }

    (songs, cont)
}

fn collect_playlist_rows(items: &Value, songs: &mut Vec<SongItem>, seen: &mut HashSet<String>) {
    if let Some(arr) = items.as_array() {
        for item in arr {
            let song = match parse_responsive_list_item(&item["musicResponsiveListItemRenderer"]) {
                Some(YTItem::Song(song)) => Some(song),
                Some(YTItem::Episode(episode)) => Some(episode_as_song(episode)),
                _ => None,
            };
            if let Some(s) = song {
                let key = s.video_id.clone().unwrap_or_else(|| s.id.clone());
                if seen.insert(key) {
                    songs.push(s);
                }
            }
        }
    }
}
