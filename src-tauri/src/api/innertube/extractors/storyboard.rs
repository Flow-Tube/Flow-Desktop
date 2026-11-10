//! Seek-bar preview frames: the player answer's storyboard spec, parsed into
//! its levels of sprite sheets.
//!
//! The spec is a URL template followed by one `|`-separated group per level,
//! `width#height#count#columns#rows#interval#name#sigh`. A level's sheet URL
//! is the template with `$L` as the level's index and `$N` as its name, plus
//! its `sigh`; `$M` in the name numbers the sheets.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::player_requests::PlayerFlights;
use crate::errors::AppResult;
use crate::models::video::StoryboardLevel;

const STORYBOARD_CACHE_CAPACITY: usize = 100;
const STORYBOARD_TTL: Duration = Duration::from_secs(3600); // 1 hour

#[derive(Clone, Debug)]
struct CachedStoryboard {
    levels: Vec<StoryboardLevel>,
    resolved_at: Instant,
}

fn storyboard_cache() -> &'static Mutex<HashMap<String, CachedStoryboard>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedStoryboard>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn flights() -> &'static PlayerFlights<Option<Vec<StoryboardLevel>>> {
    static FLIGHTS: OnceLock<PlayerFlights<Option<Vec<StoryboardLevel>>>> = OnceLock::new();
    FLIGHTS.get_or_init(PlayerFlights::default)
}

fn cached_storyboard(video_id: &str) -> Option<Vec<StoryboardLevel>> {
    let mut cache = storyboard_cache().lock().ok()?;
    let entry = cache.get(video_id)?;
    if entry.resolved_at.elapsed() >= STORYBOARD_TTL {
        cache.remove(video_id);
        return None;
    }
    Some(entry.levels.clone())
}

fn store_storyboard(video_id: &str, levels: Vec<StoryboardLevel>) {
    let Ok(mut cache) = storyboard_cache().lock() else {
        return;
    };
    cache.retain(|_, entry| entry.resolved_at.elapsed() < STORYBOARD_TTL);
    if cache.len() >= STORYBOARD_CACHE_CAPACITY {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.resolved_at)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(
        video_id.to_string(),
        CachedStoryboard {
            levels,
            resolved_at: Instant::now(),
        },
    );
}

fn extract_duration_seconds(response: &Value) -> Option<u64> {
    response["videoDetails"]["lengthSeconds"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| {
            response["microformat"]["playerMicroformatRenderer"]["lengthSeconds"]
                .as_str()
                .and_then(|value| value.parse::<u64>().ok())
        })
}

#[must_use]
pub fn parse_storyboard(player: &Value, duration_seconds: Option<u64>) -> Vec<StoryboardLevel> {
    player["storyboards"]["playerStoryboardSpecRenderer"]["spec"]
        .as_str()
        .map(|spec| parse_spec(spec, duration_seconds))
        .unwrap_or_default()
}

fn parse_spec(spec: &str, duration_seconds: Option<u64>) -> Vec<StoryboardLevel> {
    let mut parts = spec.split('|');
    let Some(base) = parts.next().filter(|base| !base.is_empty()) else {
        return Vec::new();
    };
    let base = if base.starts_with("http") {
        base.to_string()
    } else {
        format!("https://i.ytimg.com/{}", base.trim_start_matches('/'))
    };
    parts
        .enumerate()
        .filter_map(|(index, level)| {
            let fields: Vec<&str> = level.split('#').collect();
            let [width, height, count, columns, rows, interval, name, sigh] = fields.as_slice()
            else {
                return None;
            };
            let number = |text: &str| text.parse::<u32>().ok().filter(|value| *value > 0);
            let count = number(count)?;
            // An interval of 0 spreads the frames evenly over the whole video.
            let interval_ms = interval
                .parse::<u64>()
                .ok()
                .filter(|ms| *ms > 0)
                .or_else(|| duration_seconds.map(|seconds| seconds * 1000 / u64::from(count)))
                .filter(|ms| *ms > 0)?;
            Some(StoryboardLevel {
                width: number(width)?,
                height: number(height)?,
                count,
                columns: number(columns)?,
                rows: number(rows)?,
                interval_ms,
                url_template: format!(
                    "{}&sigh={sigh}",
                    base.replace("$L", &index.to_string()).replace("$N", name)
                ),
            })
        })
        .collect()
}

impl InnertubeClient {
    /// Fetches storyboard levels for hover preview or seek scrubbing.
    /// Deduplicated via `PlayerFlights` and cached in-memory with a 1-hour TTL.
    /// Unplayable videos or missing specs return an empty vector gracefully.
    pub async fn get_video_storyboard(&self, video_id: &str) -> AppResult<Vec<StoryboardLevel>> {
        let video_id_trimmed = video_id.trim();
        if video_id_trimmed.is_empty() {
            return Ok(Vec::new());
        }

        if let Some(cached) = cached_storyboard(video_id_trimmed) {
            return Ok(cached);
        }

        let flight = flights().for_video(video_id_trimmed);
        let outcome = flight
            .get_or_init(|| async {
                let mut payload = serde_json::json!({
                    "videoId": video_id_trimmed,
                    "playbackContext": {
                        "contentPlaybackContext": {
                            "signatureTimestamp": clients::DEFAULT_SIGNATURE_TIMESTAMP,
                        }
                    },
                    "contentCheckOk": true,
                    "racyCheckOk": true,
                });

                let response = self
                    .post_innertube("player", &clients::WEB, &mut payload)
                    .await
                    .ok()?;

                let duration_seconds = extract_duration_seconds(&response);
                let levels = parse_storyboard(&response, duration_seconds);
                store_storyboard(video_id_trimmed, levels.clone());
                Some(levels)
            })
            .await;

        Ok(outcome.clone().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SPEC: &str = "https://i.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg?sqp=xyz|48#27#100#10#10#0#default#rs$AAA|80#45#61#10#10#2000#M$M#rs$BBB|160#90#61#5#5#2000#M$M#rs$CCC";

    #[test]
    fn each_level_gets_its_sheet_url_and_frame_interval() {
        let levels = parse_storyboard(
            &json!({ "storyboards": { "playerStoryboardSpecRenderer": { "spec": SPEC } } }),
            Some(120),
        );
        assert_eq!(levels.len(), 3);
        assert_eq!(
            levels[0].interval_ms, 1200,
            "an interval of 0 spreads 100 frames over 120 s"
        );
        assert_eq!(
            levels[0].url_template,
            "https://i.ytimg.com/sb/abc/storyboard3_L0/default.jpg?sqp=xyz&sigh=rs$AAA"
        );
        let largest = &levels[2];
        assert_eq!(
            (largest.width, largest.height, largest.columns, largest.rows),
            (160, 90, 5, 5)
        );
        assert_eq!(largest.interval_ms, 2000);
        assert_eq!(
            largest.url_template,
            "https://i.ytimg.com/sb/abc/storyboard3_L2/M$M.jpg?sqp=xyz&sigh=rs$CCC"
        );
    }

    #[test]
    fn a_missing_or_broken_spec_gives_no_previews() {
        assert!(parse_storyboard(&json!({}), Some(60)).is_empty());
        assert!(parse_spec("https://x/$L|bad#level", Some(60)).is_empty());
        assert!(parse_spec("https://x/$L/$N|48#27#100#10#10#0#default#s", None).is_empty());
    }

    #[test]
    fn storyboard_cache_stores_and_evicts_oldest() {
        let test_levels = vec![StoryboardLevel {
            width: 160,
            height: 90,
            count: 10,
            columns: 5,
            rows: 5,
            interval_ms: 2000,
            url_template: "https://example.com/sheet.jpg".to_string(),
        }];

        store_storyboard("test_vid_1", test_levels.clone());
        let cached = cached_storyboard("test_vid_1");
        assert!(cached.is_some());
        assert_eq!(cached.unwrap()[0].width, 160);

        // Fill past capacity to verify eviction
        for i in 0..105 {
            store_storyboard(&format!("fill_vid_{i}"), test_levels.clone());
        }

        let cache = storyboard_cache().lock().unwrap();
        assert!(cache.len() <= STORYBOARD_CACHE_CAPACITY);
    }
}
