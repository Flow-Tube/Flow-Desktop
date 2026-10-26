//! What a listed video is: its length, views, upload date and category. The
//! clients that serve streams return no microformat, so this costs one small
//! `MWEB` player request, asked without a signature timestamp: the answer is
//! unplayable and carries no streams, 5 to 10 KB (Flow for Android's
//! `videoCategory`). It stays out of the playback caches, so filling in a list
//! never pushes out what is playing.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::player_requests::PlayerFlights;
use crate::api::innertube::transport::request::Host;
use crate::errors::{AppError, AppResult};
use crate::models::video::VideoMetadata;

// Every answer this session is kept; a failure is not, so a later ask tries again.
const CAPACITY: usize = 1024;

fn cache() -> &'static Mutex<HashMap<String, VideoMetadata>> {
    static CACHE: OnceLock<Mutex<HashMap<String, VideoMetadata>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The upload time as epoch milliseconds, from a full timestamp or a bare date.
fn published_at_ms(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|date| date.timestamp_millis())
        .ok()
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(0, 0, 0)
                .map(|date| date.and_utc().timestamp_millis())
        })
}

/// The metadata in an `MWEB` player answer, or none when it describes no video
/// (a removed or private one answers `ERROR` without `videoDetails`).
#[must_use]
pub fn parse_video_metadata(response: &Value) -> Option<VideoMetadata> {
    let details = response.get("videoDetails")?;
    let microformat = &response["microformat"]["playerMicroformatRenderer"];
    let text = |value: &Value| {
        value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    };
    let is_live = microformat["liveBroadcastDetails"]["isLiveNow"]
        .as_bool()
        .unwrap_or(false);
    Some(VideoMetadata {
        title: text(&details["title"]).unwrap_or_default(),
        channel_name: text(&details["author"]).unwrap_or_default(),
        channel_id: text(&details["channelId"]),
        // A stream that is live reports how long it has run, not a length.
        duration_seconds: details["lengthSeconds"]
            .as_str()
            .and_then(|seconds| seconds.parse().ok())
            .filter(|seconds| *seconds > 0 && !is_live),
        view_count: details["viewCount"]
            .as_str()
            .and_then(|views| views.parse().ok()),
        published_at_ms: microformat["publishDate"]
            .as_str()
            .or_else(|| microformat["uploadDate"].as_str())
            .and_then(published_at_ms),
        is_live,
        category: text(&microformat["category"]),
    })
}

impl InnertubeClient {
    pub async fn get_video_metadata(&self, video_id: &str) -> AppResult<VideoMetadata> {
        static FLIGHTS: OnceLock<PlayerFlights<Option<VideoMetadata>>> = OnceLock::new();
        if let Some(metadata) = cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(video_id)
        {
            return Ok(metadata.clone());
        }
        let flight = FLIGHTS
            .get_or_init(PlayerFlights::default)
            .for_video(video_id);
        let metadata = flight
            .get_or_init(|| async {
                let mut payload = serde_json::json!({
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true,
                });
                let response = self
                    .post_via(
                        &self.client,
                        Host::Www,
                        "player",
                        &clients::MWEB,
                        &mut payload,
                        None,
                        None,
                    )
                    .await
                    .ok()?;
                let metadata = parse_video_metadata(&response)?;
                let mut cache = cache()
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if cache.len() >= CAPACITY {
                    cache.clear();
                }
                cache.insert(video_id.to_string(), metadata.clone());
                Some(metadata)
            })
            .await
            .clone();
        metadata.ok_or_else(|| {
            AppError::ContentNotAvailable(format!("No details for video {video_id}"))
        })
    }

    /// The video's category, which the recommendation engine clusters by.
    pub async fn get_video_category(&self, video_id: &str) -> AppResult<Option<String>> {
        Ok(self
            .get_video_metadata(video_id)
            .await
            .ok()
            .and_then(|metadata| metadata.category))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_mweb_answer_gives_length_views_date_and_category() {
        let response = json!({
            "playabilityStatus": { "status": "UNPLAYABLE" },
            "videoDetails": { "title": "Never Gonna Give You Up", "author": "Rick Astley",
                "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw", "lengthSeconds": "213", "viewCount": "1830673075" },
            "microformat": { "playerMicroformatRenderer": {
                "publishDate": "2009-10-24T23:57:33-07:00", "category": "Music" } }
        });
        let metadata = parse_video_metadata(&response).expect("metadata");
        assert_eq!(metadata.duration_seconds, Some(213));
        assert_eq!(metadata.view_count, Some(1_830_673_075));
        assert_eq!(metadata.published_at_ms, Some(1_256_453_853_000));
        assert_eq!(metadata.category.as_deref(), Some("Music"));
        assert!(!metadata.is_live);
    }

    #[test]
    fn a_live_stream_has_no_length_and_a_removed_video_no_metadata() {
        let live = json!({
            "videoDetails": { "lengthSeconds": "121601512", "viewCount": "651847115" },
            "microformat": { "playerMicroformatRenderer": { "publishDate": "2022-07-12",
                "liveBroadcastDetails": { "isLiveNow": true } } }
        });
        let metadata = parse_video_metadata(&live).expect("metadata");
        assert!(metadata.is_live);
        assert_eq!(metadata.duration_seconds, None);
        assert_eq!(metadata.published_at_ms, Some(1_657_584_000_000));
        assert!(
            parse_video_metadata(&json!({ "playabilityStatus": { "status": "ERROR" } })).is_none()
        );
    }
}
