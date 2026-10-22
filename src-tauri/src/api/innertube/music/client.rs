//! Music requests: the `music.youtube.com` host, the music client
//! profiles in [`super::clients`], and request counters for Diagnostics. They go
//! through the same transport as every other `InnerTube` request.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use serde::Serialize;
use serde_json::{Value, json};

use super::clients::MusicClient;
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::transport::request::Host;
use crate::errors::AppResult;

static MUSIC_REQUESTS: AtomicU64 = AtomicU64::new(0);
static MUSIC_REQUEST_MILLIS: AtomicU64 = AtomicU64::new(0);
static MUSIC_PUBLIC_CACHE_HITS: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicRequestDiagnostics {
    pub requests: u64,
    pub request_millis: u64,
    pub public_cache_hits: u64,
}

pub fn music_request_diagnostics() -> MusicRequestDiagnostics {
    MusicRequestDiagnostics {
        requests: MUSIC_REQUESTS.load(Ordering::Relaxed),
        request_millis: MUSIC_REQUEST_MILLIS.load(Ordering::Relaxed),
        public_cache_hits: MUSIC_PUBLIC_CACHE_HITS.load(Ordering::Relaxed),
    }
}

pub fn record_public_cache_hit() {
    MUSIC_PUBLIC_CACHE_HITS.fetch_add(1, Ordering::Relaxed);
}

impl InnertubeClient {
    /// POST a request to the YouTube Music API (`music.youtube.com`).
    ///
    /// `payload` must already contain any `browseId`/`query`/`continuation`/
    /// `params` body fields. The `context`, with the visitor identity, is added
    /// from `client` when absent. `extra_query` lets the `search` endpoint append
    /// `&ctoken=…&continuation=…`.
    pub(crate) async fn post_music(
        &self,
        endpoint: &str,
        client: &MusicClient,
        payload: &mut Value,
        extra_query: Option<&str>,
    ) -> AppResult<Value> {
        MUSIC_REQUESTS.fetch_add(1, Ordering::Relaxed);
        let started = Instant::now();
        let result = self
            .post_via(
                &self.client,
                Host::Music,
                endpoint,
                client,
                payload,
                None,
                extra_query,
            )
            .await;
        let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        MUSIC_REQUEST_MILLIS.fetch_add(elapsed, Ordering::Relaxed);
        tracing::debug!(endpoint, elapsed_ms = elapsed, "Music request completed");
        result
    }

    /// Convenience: a `browse` against the music API with an optional browse id /
    /// params / continuation, all placed in the request body.
    pub(crate) async fn music_browse(
        &self,
        browse_id: Option<&str>,
        params: Option<&str>,
        continuation: Option<&str>,
    ) -> AppResult<Value> {
        let mut payload = json!({});
        if let Some(id) = browse_id {
            payload["browseId"] = json!(id);
        }
        if let Some(p) = params {
            payload["params"] = json!(p);
        }
        if let Some(c) = continuation {
            payload["continuation"] = json!(c);
        }
        self.post_music("browse", &super::clients::WEB_REMIX, &mut payload, None)
            .await
    }

    /// A `player` request for one client, against the main API (mobile clients
    /// are designed against `www.youtube.com`). Used by the stream resolver.
    ///
    /// This is a music-only player path; it does not touch the video extractor's
    /// `get_stream_info`.
    pub(crate) async fn music_player(
        &self,
        client: &MusicClient,
        video_id: &str,
        signature_timestamp: Option<i64>,
        po_token: Option<&str>,
        visitor_data: Option<&str>,
    ) -> AppResult<Value> {
        // `player_body` drops the token unless this client's attestation platform
        // is the one Flow can actually mint for.
        let mut payload = client.player_body(video_id, visitor_data, po_token);
        if let Some(ts) = signature_timestamp {
            payload["playbackContext"] = json!({
                "contentPlaybackContext": {
                    "referer": "https://www.youtube.com",
                    "signatureTimestamp": ts
                }
            });
        }

        // The playback pool: a track waiting behind the music home's browse
        // traffic on the shared connection was most of a slow start.
        self.post_player(client, &mut payload, None).await
    }
}
