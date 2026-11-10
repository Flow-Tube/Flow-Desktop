//! Titles in the video's own language.
//!
//! Every list response the site sends is translated into the request language,
//! and no request setting turns that off. oEmbed is the one cheap response that
//! is not, about 1 KB against 200 KB for a player call. Failures resolve to
//! `None`, so a caller simply keeps the title it already has.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::{OnceCell, Semaphore};

const OEMBED_URL: &str = "https://www.youtube.com/oembed";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CAPACITY: usize = 1_000;
const MAX_PARALLEL: usize = 4;
const PAUSE: Duration = Duration::from_secs(60);
/// Network failures in a row that stop further lookups for a while: offline, each
/// queued card would otherwise wait out a full connect timeout in turn.
const FAILURES_BEFORE_PAUSE: u32 = 3;

/// What one request to the site said about a video.
#[derive(Debug, PartialEq, Eq)]
enum Answer {
    Title(String),
    /// Embedding is off, the video is gone, or the answer names no title. All final.
    NoTitle,
    /// Rate limited: nothing is learned about the video, and asking more makes it worse.
    Limited,
    /// Nothing is learned about the video; it can be asked for again.
    Failed,
}

#[derive(Default)]
struct Known {
    titles: HashMap<String, Option<String>>,
    order: VecDeque<String>,
}

#[derive(Default)]
struct Health {
    paused_until: Option<Instant>,
    failures: u32,
}

/// One request per video per process: answers and refusals are kept, concurrent
/// asks share one request, and a limit keeps a fast scroll from flooding the site.
struct TitleLookup {
    known: Mutex<Known>,
    in_flight: Mutex<HashMap<String, Arc<OnceCell<Option<String>>>>>,
    health: Mutex<Health>,
    permits: Semaphore,
    capacity: usize,
    pause: Duration,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl TitleLookup {
    fn new(capacity: usize, pause: Duration) -> Self {
        Self {
            known: Mutex::default(),
            in_flight: Mutex::default(),
            health: Mutex::default(),
            permits: Semaphore::new(MAX_PARALLEL),
            capacity,
            pause,
        }
    }

    async fn title<F, Fut>(&self, video_id: &str, fetch: F) -> Option<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Answer>,
    {
        if let Some(known) = locked(&self.known).titles.get(video_id) {
            return known.clone();
        }
        if self.is_paused() {
            return None;
        }
        let cell = Arc::clone(
            locked(&self.in_flight)
                .entry(video_id.to_owned())
                .or_default(),
        );
        let title = cell.get_or_init(|| self.ask(video_id, fetch)).await.clone();
        locked(&self.in_flight).remove(video_id);
        title
    }

    async fn ask<F, Fut>(&self, video_id: &str, fetch: F) -> Option<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Answer>,
    {
        let _permit = self.permits.acquire().await.ok()?;
        // A pause may have started while this ask waited its turn.
        if self.is_paused() {
            return None;
        }
        match fetch().await {
            Answer::Title(title) => {
                locked(&self.health).failures = 0;
                self.remember(video_id, Some(title.clone()));
                Some(title)
            }
            Answer::NoTitle => {
                locked(&self.health).failures = 0;
                self.remember(video_id, None);
                None
            }
            Answer::Limited => {
                self.start_pause();
                None
            }
            Answer::Failed => {
                let failures = {
                    let mut health = locked(&self.health);
                    health.failures += 1;
                    health.failures
                };
                if failures >= FAILURES_BEFORE_PAUSE {
                    self.start_pause();
                }
                None
            }
        }
    }

    fn remember(&self, video_id: &str, title: Option<String>) {
        let mut known = locked(&self.known);
        if known.titles.insert(video_id.to_owned(), title).is_none() {
            known.order.push_back(video_id.to_owned());
        }
        while known.order.len() > self.capacity {
            if let Some(oldest) = known.order.pop_front() {
                known.titles.remove(&oldest);
            }
        }
    }

    fn is_paused(&self) -> bool {
        locked(&self.health)
            .paused_until
            .is_some_and(|until| Instant::now() < until)
    }

    fn start_pause(&self) {
        let mut health = locked(&self.health);
        health.paused_until = Some(Instant::now() + self.pause);
        health.failures = 0;
    }
}

#[derive(Deserialize)]
struct OEmbed {
    title: Option<String>,
}

fn parse_title(body: &str) -> Option<String> {
    let title = serde_json::from_str::<OEmbed>(body).ok()?.title?;
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_owned())
}

fn answer_for(status: u16, body: Option<&str>) -> Answer {
    match status {
        200..=299 => body
            .and_then(parse_title)
            .map_or(Answer::NoTitle, Answer::Title),
        401 | 404 => Answer::NoTitle,
        429 => Answer::Limited,
        _ => Answer::Failed,
    }
}

async fn fetch_title(video_id: &str) -> Answer {
    let url = format!(
        "{OEMBED_URL}?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{video_id}&format=json"
    );
    let response = crate::api::http::shared_client()
        .get(url)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            tracing::debug!(video_id, error = %error, "original title request failed");
            return Answer::Failed;
        }
    };
    let status = response.status();
    if !status.is_success() {
        tracing::debug!(video_id, status = status.as_u16(), "original title refused");
        return answer_for(status.as_u16(), None);
    }
    match response.text().await {
        Ok(body) => answer_for(status.as_u16(), Some(&body)),
        Err(_) => Answer::Failed,
    }
}

/// The title `video_id` was uploaded with. `video_id` must already be validated:
/// it goes into the request address as it is.
pub async fn original_title(video_id: &str) -> Option<String> {
    static LOOKUP: OnceLock<TitleLookup> = OnceLock::new();
    LOOKUP
        .get_or_init(|| TitleLookup::new(CAPACITY, PAUSE))
        .title(video_id, || fetch_title(video_id))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn lookup() -> TitleLookup {
        TitleLookup::new(CAPACITY, PAUSE)
    }

    #[test]
    fn the_answer_names_the_title() {
        assert_eq!(
            parse_title(r#"{"title":"Las noticias del lunes","author_name":"RTVE"}"#).as_deref(),
            Some("Las noticias del lunes")
        );
    }

    #[test]
    fn a_body_without_a_title_names_none() {
        assert_eq!(parse_title(r#"{"author_name":"x"}"#), None);
        assert_eq!(parse_title(r#"{"title":"   "}"#), None);
        assert_eq!(parse_title("<html>"), None);
    }

    #[test]
    fn each_status_means_what_the_lookup_expects() {
        assert_eq!(
            answer_for(200, Some(r#"{"title":"t"}"#)),
            Answer::Title("t".to_owned())
        );
        assert_eq!(answer_for(200, Some("<html>")), Answer::NoTitle);
        assert_eq!(answer_for(401, None), Answer::NoTitle);
        assert_eq!(answer_for(404, None), Answer::NoTitle);
        assert_eq!(answer_for(429, None), Answer::Limited);
        assert_eq!(answer_for(500, None), Answer::Failed);
        assert_eq!(answer_for(403, None), Answer::Failed);
    }

    #[tokio::test]
    async fn a_video_is_asked_for_once() {
        let titles = lookup();
        let asks = AtomicU32::new(0);
        for _ in 0..3 {
            let title = titles
                .title("abc123def45", || async {
                    asks.fetch_add(1, Ordering::SeqCst);
                    Answer::Title("t".to_owned())
                })
                .await;
            assert_eq!(title.as_deref(), Some("t"));
        }
        assert_eq!(asks.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn asks_at_the_same_time_share_one_request() {
        let titles = lookup();
        let asks = AtomicU32::new(0);
        let ask = || {
            titles.title("abc123def45", || async {
                asks.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                Answer::Title("t".to_owned())
            })
        };
        let (a, b, c) = tokio::join!(ask(), ask(), ask());
        assert_eq!(
            (a.as_deref(), b.as_deref(), c.as_deref()),
            (Some("t"), Some("t"), Some("t"))
        );
        assert_eq!(asks.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn embedding_turned_off_is_remembered_as_no_title() {
        let titles = lookup();
        let asks = AtomicU32::new(0);
        for _ in 0..2 {
            let title = titles
                .title("abc123def45", || async {
                    asks.fetch_add(1, Ordering::SeqCst);
                    Answer::NoTitle
                })
                .await;
            assert_eq!(title, None);
        }
        assert_eq!(asks.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_failure_is_asked_again_next_time() {
        let titles = lookup();
        assert_eq!(
            titles
                .title("abc123def45", || async { Answer::Failed })
                .await,
            None
        );
        let title = titles
            .title("abc123def45", || async { Answer::Title("t".to_owned()) })
            .await;
        assert_eq!(title.as_deref(), Some("t"));
    }

    #[tokio::test]
    async fn a_rate_limit_stops_every_lookup_until_the_pause_ends() {
        let titles = TitleLookup::new(CAPACITY, Duration::from_millis(40));
        assert_eq!(
            titles
                .title("aaaaaaaaaaa", || async { Answer::Limited })
                .await,
            None
        );
        let asks = AtomicU32::new(0);
        let ask = || async {
            asks.fetch_add(1, Ordering::SeqCst);
            Answer::Title("t".to_owned())
        };
        assert_eq!(titles.title("bbbbbbbbbbb", ask).await, None);
        assert_eq!(asks.load(Ordering::SeqCst), 0);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(titles.title("bbbbbbbbbbb", ask).await.as_deref(), Some("t"));
        assert_eq!(asks.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn repeated_failures_pause_but_a_success_resets_the_count() {
        let titles = lookup();
        let fail = |id: &'static str| titles.title(id, || async { Answer::Failed });
        fail("aaaaaaaaaaa").await;
        fail("bbbbbbbbbbb").await;
        titles
            .title("ccccccccccc", || async { Answer::Title("t".to_owned()) })
            .await;
        fail("ddddddddddd").await;
        fail("eeeeeeeeeee").await;
        assert!(!titles.is_paused());
        fail("fffffffffff").await;
        assert!(titles.is_paused());
    }

    #[tokio::test]
    async fn a_known_title_still_answers_during_a_pause() {
        let titles = lookup();
        titles
            .title("aaaaaaaaaaa", || async { Answer::Title("t".to_owned()) })
            .await;
        titles
            .title("bbbbbbbbbbb", || async { Answer::Limited })
            .await;
        let title = titles
            .title("aaaaaaaaaaa", || async { Answer::Failed })
            .await;
        assert_eq!(title.as_deref(), Some("t"));
    }

    #[tokio::test]
    async fn the_oldest_title_goes_first_at_capacity() {
        let titles = TitleLookup::new(2, PAUSE);
        for id in ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"] {
            titles
                .title(id, || async { Answer::Title(id.to_owned()) })
                .await;
        }
        let asks = AtomicU32::new(0);
        let ask = || async {
            asks.fetch_add(1, Ordering::SeqCst);
            Answer::Title("again".to_owned())
        };
        assert_eq!(
            titles.title("ccccccccccc", ask).await.as_deref(),
            Some("ccccccccccc")
        );
        assert_eq!(asks.load(Ordering::SeqCst), 0);
        assert_eq!(
            titles.title("aaaaaaaaaaa", ask).await.as_deref(),
            Some("again")
        );
        assert_eq!(asks.load(Ordering::SeqCst), 1);
    }
}
