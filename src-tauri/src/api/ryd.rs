//! Return YouTube Dislike (RYD) integration.
//!
//! Runs in the backend because the packaged webview CSP has no `https:` in
//! `connect-src`, so a frontend fetch is silently blocked in release builds.
//! RYD is a graceful-degradation integration: every failure mode resolves to
//! `None`, never an error surfaced to the frontend.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_MAX_ENTRIES: usize = 512;

/// Vote data returned by `https://returnyoutubedislikeapi.com/votes`.
///
/// Field names mirror the `RydData` shape the frontend consumes; extra fields
/// in the API response (`rawLikes`, `rawDislikes`, ...) are ignored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RydVotes {
    pub id: String,
    #[serde(default)]
    pub date_created: String,
    #[serde(default)]
    pub likes: i64,
    #[serde(default)]
    pub dislikes: i64,
    #[serde(default)]
    pub rating: f64,
    #[serde(default)]
    pub view_count: i64,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    /// `None` records a definitive "RYD has no data for this video" (404).
    votes: Option<RydVotes>,
    fetched_at: Instant,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_get(video_id: &str) -> Option<Option<RydVotes>> {
    let cache = cache().lock().ok()?;
    let entry = cache.get(video_id)?;
    if entry.fetched_at.elapsed() < CACHE_TTL {
        Some(entry.votes.clone())
    } else {
        None
    }
}

fn cache_put(video_id: &str, votes: Option<RydVotes>) {
    let Ok(mut cache) = cache().lock() else {
        return;
    };
    if cache.len() >= CACHE_MAX_ENTRIES {
        cache.retain(|_, entry| entry.fetched_at.elapsed() < CACHE_TTL);
        if cache.len() >= CACHE_MAX_ENTRIES {
            // Still full of fresh entries: evict the oldest one.
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.fetched_at)
                .map(|(id, _)| id.clone())
            {
                cache.remove(&oldest);
            }
        }
    }
    cache.insert(
        video_id.to_string(),
        CacheEntry {
            votes,
            fetched_at: Instant::now(),
        },
    );
}

/// Fetch RYD vote data for a video. Returns `None` on any failure (network
/// error, timeout, non-2xx status, unparseable body) — RYD must never block
/// or break playback UI.
pub async fn fetch_ryd_votes(video_id: &str) -> Option<RydVotes> {
    if let Some(cached) = cache_get(video_id) {
        debug!("RYD cache hit for {}", video_id);
        return cached;
    }
    debug!("RYD cache miss for {}", video_id);

    let client = crate::api::http::shared_client();
    let url = format!("https://returnyoutubedislikeapi.com/votes?videoId={video_id}");

    let response = match client.get(&url).timeout(REQUEST_TIMEOUT).send().await {
        Ok(response) => response,
        Err(error) => {
            warn!("Failed to fetch RYD data for {}: {}", video_id, error);
            return None;
        }
    };

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        // Definitive "no data for this video" — cache it so we don't re-ask.
        cache_put(video_id, None);
        return None;
    }
    if !status.is_success() {
        warn!("RYD API returned status {} for {}", status, video_id);
        return None;
    }

    match response.json::<RydVotes>().await {
        Ok(votes) => {
            cache_put(video_id, Some(votes.clone()));
            Some(votes)
        }
        Err(error) => {
            warn!("Failed to parse RYD JSON for {}: {}", video_id, error);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_full_ryd_response() {
        // Canned body matching the live API, including extra fields we ignore.
        let body = r#"{
            "id": "dQw4w9WgXcQ",
            "dateCreated": "2021-12-20T12:25:54.418014Z",
            "likes": 18443000,
            "dislikes": 522000,
            "rawDislikes": 12872,
            "rawLikes": 419021,
            "viewCount": 1712121212,
            "deleted": false,
            "rating": 4.887506442243943
        }"#;

        let votes: RydVotes = serde_json::from_str(body).expect("valid RYD body must parse");
        assert_eq!(votes.id, "dQw4w9WgXcQ");
        assert_eq!(votes.date_created, "2021-12-20T12:25:54.418014Z");
        assert_eq!(votes.likes, 18_443_000);
        assert_eq!(votes.dislikes, 522_000);
        assert_eq!(votes.view_count, 1_712_121_212);
        assert!(!votes.deleted);
        assert!((votes.rating - 4.887506442243943).abs() < f64::EPSILON);
    }

    #[test]
    fn deserializes_with_missing_optional_fields() {
        let body = r#"{ "id": "abcDEF12345" }"#;
        let votes: RydVotes = serde_json::from_str(body).expect("minimal body must parse");
        assert_eq!(votes.id, "abcDEF12345");
        assert_eq!(votes.likes, 0);
        assert_eq!(votes.dislikes, 0);
        assert_eq!(votes.view_count, 0);
        assert!(!votes.deleted);
        assert_eq!(votes.rating, 0.0);
        assert_eq!(votes.date_created, "");
    }

    #[test]
    fn serializes_camel_case_for_frontend() {
        let votes = RydVotes {
            id: "dQw4w9WgXcQ".into(),
            date_created: "2021-12-20T12:25:54.418014Z".into(),
            likes: 10,
            dislikes: 2,
            rating: 4.5,
            view_count: 100,
            deleted: false,
        };
        let json = serde_json::to_string(&votes).expect("serialization must succeed");
        assert!(json.contains("\"dateCreated\""));
        assert!(json.contains("\"viewCount\""));
        assert!(!json.contains("date_created"));
    }
}
