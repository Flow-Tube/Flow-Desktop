//! The watch page's `/next` answer, fetched once per video and shared by
//! everything read from it: the details, the related lane, the first comments
//! page and the live chat seed. Flow for Android keeps the same small cache
//! (`YouTubeRepository.watchNextJson`); fetching it per consumer cost three to
//! four half-megabyte requests per watch.

mod chapters;
mod owner;
mod primary;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::player_requests::PlayerFlights;
use crate::api::innertube::core::utils::{
    collect_related_content_items, dedupe_related_content_items, watch_next_body,
};
use crate::api::innertube::json::continuation::{continuation_item_lists, last_continuation_token};
use crate::errors::{AppError, AppResult};
use crate::models::video::RelatedPage;

pub use chapters::{chapters, description_chapters, heatmap};
pub use owner::{WatchOwner, owner};
pub use primary::{WatchPrimary, primary};

const CAPACITY: usize = 4;
// Long enough to cover a watch page opening its comments and chat a little
// after the details, short enough that a stale like count is not kept around.
const TTL: Duration = Duration::from_mins(5);
const TIMEOUT: Duration = Duration::from_secs(6);

/// A failed fetch, shared with every caller that waited on it.
#[derive(Clone)]
enum Failure {
    RateLimited(String),
    Network(String),
    Other(String),
}

impl From<&AppError> for Failure {
    fn from(error: &AppError) -> Self {
        match error {
            AppError::RateLimited(message) => Self::RateLimited(message.clone()),
            AppError::Network(message) => Self::Network(message.clone()),
            other => Self::Other(other.to_string()),
        }
    }
}

impl From<Failure> for AppError {
    fn from(failure: Failure) -> Self {
        match failure {
            Failure::RateLimited(message) => Self::RateLimited(message),
            Failure::Network(message) => Self::Network(message),
            Failure::Other(message) => Self::Extractor(message),
        }
    }
}

type Entry = (String, Instant, Arc<Value>);

fn cache() -> &'static Mutex<VecDeque<Entry>> {
    static CACHE: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(VecDeque::with_capacity(CAPACITY)))
}

/// The cached watch answer for `video_id`, if one is still fresh.
pub(crate) fn cached(video_id: &str) -> Option<Arc<Value>> {
    let mut entries = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    entries.retain(|(_, at, _)| at.elapsed() < TTL);
    entries
        .iter()
        .find(|(id, _, _)| id == video_id)
        .map(|(_, _, value)| value.clone())
}

fn remember(video_id: &str, value: Arc<Value>) {
    let mut entries = cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    entries.retain(|(id, _, _)| id != video_id);
    if entries.len() >= CAPACITY {
        entries.pop_front();
    }
    entries.push_back((video_id.to_string(), Instant::now(), value));
}

/// The `videoPrimaryInfoRenderer` and `videoSecondaryInfoRenderer` of a watch
/// answer, or `Null` for one that is missing.
fn info_renderers(next: &Value) -> (&Value, &Value) {
    let mut primary = &Value::Null;
    let mut secondary = &Value::Null;
    for item in next["contents"]["twoColumnWatchNextResults"]["results"]["results"]["contents"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(renderer) = item.get("videoPrimaryInfoRenderer") {
            primary = renderer;
        }
        if let Some(renderer) = item.get("videoSecondaryInfoRenderer") {
            secondary = renderer;
        }
    }
    (primary, secondary)
}

/// The description, as the watch page shows it.
#[must_use]
pub fn description(next: &Value) -> Option<String> {
    info_renderers(next).1["attributedDescription"]["content"]
        .as_str()
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

/// The video the site would autoplay next.
#[must_use]
pub fn autoplay_video_id(next: &Value) -> Option<String> {
    next["contents"]["twoColumnWatchNextResults"]["autoplay"]["autoplay"]["sets"]
        .as_array()?
        .iter()
        .find_map(|set| set["autoplayVideo"]["watchEndpoint"]["videoId"].as_str())
        .map(ToOwned::to_owned)
}

/// The chat's seed token ("Top chat") and whether the chat is a replay of a
/// finished stream.
#[must_use]
pub fn chat_seed(next: &Value) -> Option<(String, bool)> {
    let chat =
        &next["contents"]["twoColumnWatchNextResults"]["conversationBar"]["liveChatRenderer"];
    let seed = chat["continuations"][0]["reloadContinuationData"]["continuation"].as_str()?;
    Some((
        seed.to_string(),
        chat["isReplay"].as_bool().unwrap_or(false),
    ))
}

/// The related lane of a watch answer: its first page, or a continuation page.
#[must_use]
pub fn related_page(next: &Value) -> RelatedPage {
    let lists: Vec<&Vec<Value>> = next["contents"]["twoColumnWatchNextResults"]["secondaryResults"]
        ["secondaryResults"]["results"]
        .as_array()
        .into_iter()
        .chain(continuation_item_lists(next))
        .collect();
    let mut items = Vec::new();
    for list in &lists {
        for item in *list {
            collect_related_content_items(item, &mut items);
        }
    }
    RelatedPage {
        items: dedupe_related_content_items(items),
        continuation: lists.last().and_then(|list| last_continuation_token(list)),
    }
}

impl InnertubeClient {
    /// The `/next` answer for `video_id`: cached, and one request however many
    /// callers ask at once. It runs on the playback connections within six
    /// seconds, because a deep link waits on the details read from it.
    pub(crate) async fn watch_next(&self, video_id: &str) -> AppResult<Arc<Value>> {
        static FLIGHTS: OnceLock<PlayerFlights<Result<Arc<Value>, Failure>>> = OnceLock::new();
        if let Some(hit) = cached(video_id) {
            return Ok(hit);
        }
        let flight = FLIGHTS
            .get_or_init(PlayerFlights::default)
            .for_video(video_id);
        flight
            .get_or_init(|| async {
                let mut payload = watch_next_body(video_id);
                let answer = tokio::time::timeout(
                    TIMEOUT,
                    self.post_innertube_for_playback("next", &clients::WEB, &mut payload),
                )
                .await;
                match answer {
                    Ok(Ok(next)) => {
                        let next = Arc::new(next);
                        remember(video_id, next.clone());
                        Ok(next)
                    }
                    Ok(Err(error)) => Err(Failure::from(&error)),
                    Err(_) => Err(Failure::Network(format!(
                        "watch page request for {video_id} timed out"
                    ))),
                }
            })
            .await
            .clone()
            .map_err(AppError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_autoplay_target_is_read_from_the_first_set_that_names_one() {
        let next = json!({ "contents": { "twoColumnWatchNextResults": { "autoplay": { "autoplay": {
            "sets": [{ "mode": "NORMAL", "autoplayVideo": { "watchEndpoint": { "videoId": "Qt2mbGP6vFI" } } }]
        } } } } });
        assert_eq!(autoplay_video_id(&next).as_deref(), Some("Qt2mbGP6vFI"));
        assert_eq!(autoplay_video_id(&json!({})), None);
    }

    #[test]
    fn a_finished_stream_seeds_a_replay() {
        let next = json!({ "contents": { "twoColumnWatchNextResults": { "conversationBar": {
            "liveChatRenderer": {
                "continuations": [{ "reloadContinuationData": { "continuation": "SEED" } }],
                "isReplay": true
            }
        } } } });
        assert_eq!(chat_seed(&next), Some(("SEED".to_string(), true)));
        assert_eq!(chat_seed(&json!({})), None);
    }

    #[test]
    fn the_related_lane_keeps_its_continuation() {
        let next = json!({ "contents": { "twoColumnWatchNextResults": { "secondaryResults": {
            "secondaryResults": { "results": [
                { "continuationItemRenderer": { "continuationEndpoint": {
                    "continuationCommand": { "token": "MORE" }
                } } }
            ] }
        } } } });
        let page = related_page(&next);
        assert!(page.items.is_empty());
        assert_eq!(page.continuation.as_deref(), Some("MORE"));
    }

    #[test]
    fn a_continuation_page_reads_its_appended_items() {
        let next = json!({ "onResponseReceivedEndpoints": [{ "appendContinuationItemsAction": {
            "continuationItems": [{ "continuationItemRenderer": { "continuationEndpoint": {
                "continuationCommand": { "token": "EVEN_MORE" }
            } } }]
        } }] });
        assert_eq!(
            related_page(&next).continuation.as_deref(),
            Some("EVEN_MORE")
        );
    }

    #[test]
    fn the_cache_keeps_the_newest_answers() {
        for index in 0..=CAPACITY {
            remember(&format!("cache-test-{index}"), Arc::new(json!(index)));
        }
        assert!(cached("cache-test-0").is_none());
        assert_eq!(
            cached(&format!("cache-test-{CAPACITY}")).as_deref(),
            Some(&json!(CAPACITY))
        );
    }
}
