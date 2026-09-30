//! Watch-surface extractors: the `next` queue/radio, typed related, lyrics, and
//! `music/get_queue`.

use serde_json::{Value, json};

use super::clients;
use super::parse::endpoint::{WatchNextTab, album_from_menu, browse_id, watch_next_tab};
use super::parse::runs::{parse_artists_and_year, parse_duration, runs_text};
use super::parse::thumbnail::thumbnail_url;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{SongItem, YTItem};
use crate::models::music_pages::{QueuePage, RelatedPage, RelatedShelf, RelatedShelfType};

impl InnertubeClient {
    /// Watch queue / radio for a song (the `next` endpoint). Also surfaces the
    /// lyrics and related tab pointers for the now-playing UI.
    pub(crate) async fn music_watch_queue(
        &self,
        video_id: Option<&str>,
        playlist_id: Option<&str>,
        params: Option<&str>,
    ) -> AppResult<QueuePage> {
        let visitor = self.music_visitor_data().await;
        let mut payload = json!({ "isAudioOnly": true });
        if let Some(v) = video_id {
            payload["videoId"] = json!(v);
        }
        if let Some(p) = playlist_id {
            payload["playlistId"] = json!(p);
        }
        if let Some(p) = params {
            payload["params"] = json!(p);
        }
        let res = self
            .post_music(
                "next",
                &clients::WEB_REMIX,
                &mut payload,
                visitor.as_deref(),
                None,
            )
            .await?;
        Ok(parse_next_queue(&res))
    }

    /// Continue a watch queue.
    pub(crate) async fn music_queue_continuation(&self, token: &str) -> AppResult<QueuePage> {
        let visitor = self.music_visitor_data().await;
        let mut payload = json!({ "continuation": token });
        let res = self
            .post_music(
                "next",
                &clients::WEB_REMIX,
                &mut payload,
                visitor.as_deref(),
                None,
            )
            .await?;
        let panel = &res["continuationContents"]["playlistPanelContinuation"];
        let items = collect_panel_items(panel);
        Ok(QueuePage {
            items,
            current_index: None,
            continuation: continuation::any(panel, &panel["contents"]),
            lyrics_browse_id: None,
            lyrics_params: None,
            related_browse_id: None,
            radio_playlist_id: None,
        })
    }

    /// Build a queue from explicit video ids / a playlist (`music/get_queue`).
    pub(crate) async fn music_get_queue(
        &self,
        video_ids: &[String],
        playlist_id: Option<&str>,
    ) -> AppResult<QueuePage> {
        let visitor = self.music_visitor_data().await;
        let mut payload = json!({});
        if !video_ids.is_empty() {
            payload["videoIds"] = json!(video_ids);
        }
        if let Some(p) = playlist_id {
            payload["playlistId"] = json!(p);
        }
        let res = self
            .post_music(
                "music/get_queue",
                &clients::WEB_REMIX,
                &mut payload,
                visitor.as_deref(),
                None,
            )
            .await?;
        let mut items = Vec::new();
        if let Some(arr) = res["queueDatas"].as_array() {
            for q in arr {
                if let Some(s) = parse_panel_video(&q["content"]["playlistPanelVideoRenderer"]) {
                    items.push(s);
                }
            }
        }
        Ok(QueuePage {
            items,
            current_index: None,
            continuation: None,
            lyrics_browse_id: None,
            lyrics_params: None,
            related_browse_id: None,
            radio_playlist_id: playlist_id.map(ToOwned::to_owned),
        })
    }

    /// Typed related content for a song, bucketed by kind.
    pub(crate) async fn music_related_page(&self, video_id: &str) -> AppResult<RelatedPage> {
        let queue = self.music_watch_queue(Some(video_id), None, None).await?;
        let Some(related_browse) = queue.related_browse_id else {
            return Ok(related_from_sections(Vec::new()));
        };

        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(Some(&related_browse), None, None, visitor.as_deref())
            .await?;

        let sections = shelves::section_list_contents(&res)
            .into_iter()
            .filter_map(|section| {
                let parsed = shelves::parse_section(&section)?;
                let title_run = &section["musicCarouselShelfRenderer"]["header"]
                    ["musicCarouselShelfBasicHeaderRenderer"]["title"]["runs"][0];
                let artist_browse_id = browse_id(&title_run["navigationEndpoint"])
                    .filter(|id| id.starts_with("UC"));
                Some((parsed, artist_browse_id))
            })
            .collect();
        Ok(related_from_sections(sections))
    }

    /// Plain lyrics text for a song (via the `next` lyrics tab pointer).
    pub(crate) async fn music_lyrics_text(&self, video_id: &str) -> AppResult<Option<String>> {
        let queue = self.music_watch_queue(Some(video_id), None, None).await?;
        let Some(browse) = queue.lyrics_browse_id else {
            return Ok(None);
        };
        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(
                Some(&browse),
                queue.lyrics_params.as_deref(),
                None,
                visitor.as_deref(),
            )
            .await?;

        let mut text = String::new();
        for section in shelves::section_list_contents(&res) {
            if let Some(runs) =
                section["musicDescriptionShelfRenderer"]["description"]["runs"].as_array()
            {
                for run in runs {
                    if let Some(t) = run["text"].as_str() {
                        text.push_str(t);
                    }
                }
            }
        }
        Ok((!text.is_empty()).then_some(text))
    }
}

fn is_video_song(song: &SongItem) -> bool {
    song.music_video_type
        .as_deref()
        .is_some_and(|kind| kind != "MUSIC_VIDEO_TYPE_ATV")
}

fn related_from_sections(
    sections: Vec<(crate::models::music_pages::MusicShelf, Option<String>)>,
) -> RelatedPage {
    let mut page = RelatedPage {
        sections: Vec::new(),
        songs: Vec::new(),
        other_performances: Vec::new(),
        albums: Vec::new(),
        artists: Vec::new(),
        playlists: Vec::new(),
    };
    let mut song_shelves = 0;
    for (shelf, artist_browse_id) in sections {
        let items = &shelf.items;
        let shelf_type = if artist_browse_id.is_some()
            && items.iter().all(|item| matches!(item, YTItem::Album(_)))
        {
            RelatedShelfType::MoreFromArtist
        } else if items.iter().all(|item| matches!(item, YTItem::Artist(_))) {
            RelatedShelfType::SimilarArtists
        } else if items.iter().all(|item| matches!(item, YTItem::Playlist(_))) {
            RelatedShelfType::Playlists
        } else if items.iter().all(|item| matches!(item, YTItem::Song(_))) {
            // The first song carousel is the similar-audio lane and later ones are
            // alternate performances; videos are filtered per item below.
            song_shelves += 1;
            if song_shelves == 1 {
                RelatedShelfType::Similar
            } else {
                RelatedShelfType::OtherPerformances
            }
        } else {
            RelatedShelfType::Unknown
        };
        for item in &shelf.items {
            match (shelf_type, item) {
                (RelatedShelfType::Similar, YTItem::Song(song)) if !is_video_song(song) => {
                    page.songs.push(song.clone());
                }
                (RelatedShelfType::OtherPerformances, YTItem::Song(song)) => {
                    page.other_performances.push(song.clone());
                }
                (RelatedShelfType::MoreFromArtist, YTItem::Album(album)) => {
                    page.albums.push(album.clone());
                }
                (RelatedShelfType::SimilarArtists, YTItem::Artist(artist)) => {
                    page.artists.push(artist.clone());
                }
                (RelatedShelfType::Playlists, YTItem::Playlist(playlist)) => {
                    page.playlists.push(playlist.clone());
                }
                _ => {}
            }
        }
        page.sections.push(RelatedShelf {
            shelf_type,
            title: shelf.title,
            artist_browse_id,
            items: shelf.items,
        });
    }
    page
}

fn parse_next_queue(res: &Value) -> QueuePage {
    let tabs = &res["contents"]["singleColumnMusicWatchNextResultsRenderer"]["tabbedRenderer"]["watchNextTabbedResultsRenderer"]
        ["tabs"];

    let panel = &tabs[0]["tabRenderer"]["content"]["musicQueueRenderer"]["content"]["playlistPanelRenderer"];

    let items = collect_panel_items(panel);
    let current_index = panel["currentIndex"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok());
    let radio_playlist_id = panel["playlistId"].as_str().map(ToOwned::to_owned);

    let lyrics_endpoint = &watch_next_tab(tabs, WatchNextTab::Lyrics)["browseEndpoint"];
    let related_endpoint = &watch_next_tab(tabs, WatchNextTab::Related)["browseEndpoint"];

    QueuePage {
        items,
        current_index,
        continuation: continuation::any(panel, &panel["contents"]),
        lyrics_browse_id: lyrics_endpoint["browseId"].as_str().map(ToOwned::to_owned),
        lyrics_params: lyrics_endpoint["params"].as_str().map(ToOwned::to_owned),
        related_browse_id: related_endpoint["browseId"].as_str().map(ToOwned::to_owned),
        radio_playlist_id,
    }
}

fn collect_panel_items(panel: &Value) -> Vec<SongItem> {
    panel["contents"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| parse_panel_video(&c["playlistPanelVideoRenderer"]))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_panel_video(r: &Value) -> Option<SongItem> {
    let video_id = r["videoId"].as_str()?.to_string();
    let title = runs_text(&r["title"])?;
    let artists = parse_artists_and_year(&r["longBylineText"]).0;
    let album = album_from_menu(r);
    let duration = runs_text(&r["lengthText"]).and_then(|t| parse_duration(&t));
    Some(SongItem {
        id: video_id.clone(),
        title,
        artists,
        album,
        duration,
        music_video_type: None,
        thumbnail: thumbnail_url(r).unwrap_or_default(),
        explicit: false,
        video_id: Some(video_id),
        playlist_id: r["navigationEndpoint"]["watchEndpoint"]["playlistId"]
            .as_str()
            .map(ToOwned::to_owned),
        params: None,
        views_text: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_video_album_from_menu() {
        let r = json!({
            "videoId": "vid2",
            "title": { "runs": [{ "text": "Some Song" }] },
            "longBylineText": { "runs": [{ "text": "Some Artist" }] },
            "menu": { "menuRenderer": { "items": [
                { "menuNavigationItemRenderer": { "navigationEndpoint": { "browseEndpoint": {
                    "browseId": "MPREmenualbum",
                    "browseEndpointContextSupportedConfigs": {
                        "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ALBUM" }
                    }
                }}}}
            ]}}
        });
        let album = parse_panel_video(&r).unwrap().album.unwrap();
        assert_eq!(album.id, "MPREmenualbum");
        assert!(album.name.is_empty());
    }

    #[test]
    fn panel_video_no_album() {
        let r = json!({
            "videoId": "vid3",
            "title": { "runs": [{ "text": "Single" }] },
            "longBylineText": { "runs": [{ "text": "Artist Only" }] }
        });
        assert!(parse_panel_video(&r).unwrap().album.is_none());
    }
}

#[cfg(test)]
mod related_tests {
    use super::*;
    use crate::models::music::PlaylistItem;
    use crate::models::music_pages::MusicShelf;

    fn song(id: &str, kind: &str) -> YTItem {
        YTItem::Song(SongItem {
            id: id.into(),
            title: id.into(),
            artists: Vec::new(),
            album: None,
            duration: Some(180),
            music_video_type: Some(kind.into()),
            thumbnail: String::new(),
            explicit: false,
            video_id: Some(id.into()),
            playlist_id: None,
            params: None,
            views_text: None,
        })
    }

    fn shelf(title: &str, items: Vec<YTItem>) -> MusicShelf {
        MusicShelf {
            title: title.into(),
            subtitle: None,
            browse_id: None,
            params: None,
            items,
        }
    }

    #[test]
    fn translated_related_shelves_keep_audio_and_performances_apart() {
        let page = related_from_sections(vec![
            (
                shelf("مقترح لك", vec![song("similar", "MUSIC_VIDEO_TYPE_ATV")]),
                None,
            ),
            (
                shelf(
                    "قوائم تشغيل",
                    vec![YTItem::Playlist(PlaylistItem {
                        id: "playlist".into(),
                        title: "mix".into(),
                        author: None,
                        song_count_text: None,
                        thumbnail: None,
                    })],
                ),
                None,
            ),
            (
                shelf(
                    "عروض أخرى",
                    vec![
                        song("alternate-audio", "MUSIC_VIDEO_TYPE_ATV"),
                        song("live-video", "MUSIC_VIDEO_TYPE_OMV"),
                    ],
                ),
                None,
            ),
        ]);
        assert_eq!(page.sections[0].shelf_type, RelatedShelfType::Similar);
        assert_eq!(page.sections[1].shelf_type, RelatedShelfType::Playlists);
        assert_eq!(
            page.sections[2].shelf_type,
            RelatedShelfType::OtherPerformances
        );
        assert_eq!(
            page.songs
                .iter()
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            vec!["similar"]
        );
        assert_eq!(page.other_performances.len(), 2);
        assert_eq!(page.playlists.len(), 1);
    }

    #[test]
    fn a_video_in_the_similar_lane_is_dropped_without_losing_the_lane() {
        let page = related_from_sections(vec![
            (
                shelf(
                    "First",
                    vec![
                        song("audio-1", "MUSIC_VIDEO_TYPE_ATV"),
                        song("video", "MUSIC_VIDEO_TYPE_OMV"),
                        song("audio-2", "MUSIC_VIDEO_TYPE_ATV"),
                    ],
                ),
                None,
            ),
            (
                shelf("Second", vec![song("performance", "MUSIC_VIDEO_TYPE_UGC")]),
                None,
            ),
        ]);
        assert_eq!(page.sections[0].shelf_type, RelatedShelfType::Similar);
        assert_eq!(
            page.songs
                .iter()
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            vec!["audio-1", "audio-2"]
        );
        assert_eq!(page.other_performances.len(), 1);
    }

    #[test]
    fn next_queue_keeps_order_and_related_pointer() {
        let item = |id: &str| {
            json!({ "playlistPanelVideoRenderer": {
            "videoId": id,
            "title": { "runs": [{ "text": id }] },
            "longBylineText": { "runs": [{ "text": "Artist" }] },
            "lengthText": { "runs": [{ "text": "3:00" }] },
        } })
        };
        let response = json!({ "contents": { "singleColumnMusicWatchNextResultsRenderer": {
            "tabbedRenderer": { "watchNextTabbedResultsRenderer": { "tabs": [
                { "tabRenderer": { "content": { "musicQueueRenderer": { "content": {
                    "playlistPanelRenderer": { "contents": [item("one"), item("two")] }
                } } } } },
                { "tabRenderer": { "endpoint": { "browseEndpoint": {
                    "browseId": "MPLYt_lyrics",
                    "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": {
                        "pageType": "MUSIC_PAGE_TYPE_TRACK_LYRICS"
                    } }
                } } } },
                // YouTube added Comments here, pushing Related to the fourth tab.
                { "tabRenderer": { "title": "Comments" } },
                { "tabRenderer": { "endpoint": { "browseEndpoint": {
                    "browseId": "MPTRt_related",
                    "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": {
                        "pageType": "MUSIC_PAGE_TYPE_TRACK_RELATED"
                    } }
                } } } },
            ] } }
        } } });
        let queue = parse_next_queue(&response);
        assert_eq!(
            queue
                .items
                .iter()
                .map(|song| song.id.as_str())
                .collect::<Vec<_>>(),
            vec!["one", "two"]
        );
        assert_eq!(queue.related_browse_id.as_deref(), Some("MPTRt_related"));
        assert_eq!(queue.lyrics_browse_id.as_deref(), Some("MPLYt_lyrics"));
    }
}
