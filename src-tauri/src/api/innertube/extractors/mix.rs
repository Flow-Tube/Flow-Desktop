//! A Mix, read from the watch page's playlist panel. The playlist browse refuses
//! one ("This playlist type is unviewable"), so its watch queue is the only list of
//! it, and that queue has no next page.

use std::collections::HashSet;

use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::renderers::video::video_from_renderer;
use crate::errors::{AppError, AppResult};
use crate::models::playlist::PlaylistDetailsResponse;

const VIDEO_ID_LENGTH: usize = 11;

/// A Mix is built around a video; `RDCLAK` ids are album playlists that only share the prefix.
#[must_use]
pub fn is_mix(playlist_id: &str) -> bool {
    playlist_id.starts_with("RD") && !playlist_id.starts_with("RDCLAK")
}

/// The video a plain `RD<videoId>` Mix grew from. Asking with it keeps that video first.
#[must_use]
pub fn mix_seed_video_id(playlist_id: &str) -> Option<&str> {
    playlist_id
        .strip_prefix("RD")
        .filter(|seed| seed.len() == VIDEO_ID_LENGTH)
}

/// The Mix queue of a WEB `next` response as a playlist.
fn mix_playlist_from_next(next: &Value, playlist_id: &str) -> PlaylistDetailsResponse {
    let panel = &next["contents"]["twoColumnWatchNextResults"]["playlist"]["playlist"];
    let mut seen = HashSet::new();
    let videos: Vec<_> = panel["contents"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("playlistPanelVideoRenderer"))
        .filter(|renderer| renderer.get("unplayableText").is_none())
        .filter_map(video_from_renderer)
        .filter(|video| seen.insert(video.id.clone()))
        .collect();
    PlaylistDetailsResponse {
        id: playlist_id.to_string(),
        title: panel["title"]
            .as_str()
            .map(ToOwned::to_owned)
            .or_else(|| text_of(&panel["titleText"]))
            .unwrap_or_default(),
        description: None,
        channel_name: text_of(&panel["ownerName"]).unwrap_or_default(),
        video_count: None,
        view_count_text: None,
        videos,
        next_page_token: None,
    }
}

impl InnertubeClient {
    /// A Mix's queue, asked for with its seed video when its id names one, else with
    /// `video_id`. Sent without the visitor id: with it, the answer is a queue personalised
    /// for this visitor that leaves out the video the Mix is named after.
    pub async fn get_mix_playlist(
        &self,
        playlist_id: &str,
        video_id: Option<&str>,
    ) -> AppResult<PlaylistDetailsResponse> {
        if !is_mix(playlist_id) {
            return Err(AppError::Validation("Not a Mix playlist".into()));
        }
        // A body that carries its own context is sent as built, so no visitor id joins it.
        let mut payload = json!({
            "context": clients::WEB.context(None, None),
            "playlistId": playlist_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
        });
        if let Some(video_id) = mix_seed_video_id(playlist_id).or(video_id) {
            payload["videoId"] = json!(video_id);
        }
        let next = self
            .post_innertube("next", &clients::WEB, &mut payload)
            .await?;
        Ok(mix_playlist_from_next(&next, playlist_id))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_mix, mix_playlist_from_next, mix_seed_video_id};
    use serde_json::{Value, json};

    fn panel_video(id: &str, title: &str) -> Value {
        json!({ "playlistPanelVideoRenderer": {
            "videoId": id,
            "title": { "simpleText": title },
            "lengthText": { "simpleText": "3:39" },
            "shortBylineText": { "runs": [{
                "text": format!("Channel {id}"),
                "navigationEndpoint": { "browseEndpoint": { "browseId": format!("UC{id}") } }
            }]}
        }})
    }

    fn response(items: &[Value]) -> Value {
        json!({ "contents": { "twoColumnWatchNextResults": { "playlist": { "playlist": {
            "title": "Mix - Song",
            "ownerName": { "simpleText": "YouTube" },
            "isInfinite": true,
            "contents": items
        }}}}})
    }

    #[test]
    fn reads_the_title_owner_and_videos_of_the_queue() {
        let next = response(&[
            panel_video("aaaaaaaaaa1", "First"),
            panel_video("bbbbbbbbbb2", "Second"),
        ]);
        let page = mix_playlist_from_next(&next, "RDaaaaaaaaaa1");

        assert_eq!(page.id, "RDaaaaaaaaaa1");
        assert_eq!(page.title, "Mix - Song");
        assert_eq!(page.channel_name, "YouTube");
        assert_eq!(page.next_page_token, None);
        let ids: Vec<&str> = page.videos.iter().map(|video| video.id.as_str()).collect();
        assert_eq!(ids, ["aaaaaaaaaa1", "bbbbbbbbbb2"]);
        let first = &page.videos[0];
        assert_eq!(first.title, "First");
        assert_eq!(first.channel_name, "Channel aaaaaaaaaa1");
        assert_eq!(first.channel_id.as_deref(), Some("UCaaaaaaaaaa1"));
        assert_eq!(first.duration_seconds, Some(219));
        assert!(first.thumbnail_url.is_some());
    }

    #[test]
    fn drops_repeats_and_videos_that_cannot_play() {
        let mut blocked = panel_video("ccccccccccc", "Blocked");
        blocked["playlistPanelVideoRenderer"]["unplayableText"] =
            json!({ "simpleText": "Unavailable" });
        let next = response(&[
            panel_video("aaaaaaaaaa1", "First"),
            panel_video("aaaaaaaaaa1", "First again"),
            blocked,
        ]);
        let page = mix_playlist_from_next(&next, "RDaaaaaaaaaa1");

        let titles: Vec<&str> = page
            .videos
            .iter()
            .map(|video| video.title.as_str())
            .collect();
        assert_eq!(titles, ["First"]);
    }

    #[test]
    fn a_response_without_a_queue_is_an_empty_playlist() {
        let page = mix_playlist_from_next(&json!({ "contents": {} }), "RDaaaaaaaaaa1");

        assert_eq!(page.title, "");
        assert!(page.videos.is_empty());
    }

    #[test]
    fn a_plain_mix_names_its_seed_video() {
        assert_eq!(mix_seed_video_id("RDHCjNJDNzw8Y"), Some("HCjNJDNzw8Y"));
        assert_eq!(mix_seed_video_id("RDMMHCjNJDNzw8Y"), None);
    }

    #[test]
    fn only_video_mixes_count_as_mixes() {
        assert!(is_mix("RDHCjNJDNzw8Y"));
        assert!(!is_mix("RDCLAK5uy_abc"));
        assert!(!is_mix("PLabc"));
    }
}
