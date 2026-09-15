//! Watch-surface extractors: the `next` queue/radio, typed related, lyrics, and
//! `music/get_queue`.

use serde_json::{Value, json};

use super::clients;
use super::parse::endpoint::album_from_menu;
use super::parse::runs::{parse_artists_and_year, parse_duration, runs_text};
use super::parse::thumbnail::thumbnail_url;
use super::parse::{continuation, shelves};
use crate::api::innertube::InnertubeClient;
use crate::errors::AppResult;
use crate::models::music::{SongItem, YTItem};
use crate::models::music_pages::{QueuePage, RelatedPage};

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
        let mut page = RelatedPage {
            songs: Vec::new(),
            albums: Vec::new(),
            artists: Vec::new(),
            playlists: Vec::new(),
        };

        let queue = self.music_watch_queue(Some(video_id), None, None).await?;
        let Some(related_browse) = queue.related_browse_id else {
            return Ok(page);
        };

        let visitor = self.music_visitor_data().await;
        let res = self
            .music_browse(Some(&related_browse), None, None, visitor.as_deref())
            .await?;

        for section in shelves::section_list_contents(&res) {
            if let Some(shelf) = shelves::parse_section(&section) {
                for item in shelf.items {
                    match item {
                        YTItem::Song(s) => page.songs.push(s),
                        YTItem::Album(a) => page.albums.push(a),
                        YTItem::Artist(a) => page.artists.push(a),
                        YTItem::Playlist(p) => page.playlists.push(p),
                        _ => {}
                    }
                }
            }
        }
        Ok(page)
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

fn parse_next_queue(res: &Value) -> QueuePage {
    let tabs = &res["contents"]["singleColumnMusicWatchNextResultsRenderer"]["tabbedRenderer"]["watchNextTabbedResultsRenderer"]
        ["tabs"];

    let panel = &tabs[0]["tabRenderer"]["content"]["musicQueueRenderer"]["content"]["playlistPanelRenderer"];

    let items = collect_panel_items(panel);
    let current_index = panel["currentIndex"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok());
    let radio_playlist_id = panel["playlistId"].as_str().map(ToOwned::to_owned);

    let lyrics_endpoint = &tabs[1]["tabRenderer"]["endpoint"]["browseEndpoint"];
    let related_endpoint = &tabs[2]["tabRenderer"]["endpoint"]["browseEndpoint"];

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
