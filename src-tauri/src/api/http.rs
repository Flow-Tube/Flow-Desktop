//! Shared HTTP client and bounded-concurrency helpers.

use std::future::Future;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};

/// Browser-like User-Agent used when scraping HTML pages / RSS from YouTube.
pub const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Default number of in-flight requests when fanning out over a collection of
/// remote resources (one request per subscribed channel, per video, ...).
pub const DEFAULT_FETCH_CONCURRENCY: usize = 8;

/// Process-wide shared HTTP client.
///
/// Built once, lazily, on first use and then reused for every request. Callers
/// that need a different `User-Agent` can override it per request with
/// `.header(reqwest::header::USER_AGENT, ...)` on the `RequestBuilder`.
pub fn shared_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        super::app_proxy::with_app_proxy(reqwest::Client::builder())
            .tls_backend_rustls()
            .user_agent(BROWSER_USER_AGENT)
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|error| {
                tracing::error!("failed to build shared HTTP client: {error}");
                reqwest::Client::new()
            })
    })
}

/// Warm the shared client so it is constructed at startup
pub fn warm_shared_client() {
    let _ = shared_client();
}

pub async fn bounded_join<I, F, Fut, T>(items: I, limit: usize, make_future: F) -> Vec<T>
where
    I: IntoIterator,
    F: FnMut(I::Item) -> Fut,
    Fut: Future<Output = T>,
{
    let limit = limit.max(1);
    stream::iter(items)
        .map(make_future)
        .buffer_unordered(limit)
        .collect()
        .await
}
