//! Music-specific HTTP layer.
//!
//! This is deliberately separate from `core::http::post_innertube` (the video
//! path): it targets the `music.youtube.com` origin, uses the music client
//! profiles in [`super::clients`], and sets per-client User-Agents that
//! `post_innertube` does not know about. It reuses the shared `reqwest::Client`
//! on [`InnertubeClient`] so connection pooling (and any future outbound proxy)
//! is shared — but it never modifies the video request path.

use reqwest::header::USER_AGENT;
use serde_json::{Value, json};

use super::clients::MusicClient;
use super::endpoints;
use crate::api::innertube::InnertubeClient;
use crate::errors::{AppError, AppResult};

impl InnertubeClient {
    /// Visitor data, fetched once and cached on the shared client.
    pub(crate) async fn music_visitor_data(&self) -> Option<String> {
        if let Ok(guard) = self.visitor_data.read() {
            if let Some(v) = guard.as_ref() {
                return Some(v.clone());
            }
        }
        let fetched = self.fetch_visitor_data().await;
        if let Some(ref v) = fetched {
            if let Ok(mut guard) = self.visitor_data.write() {
                *guard = Some(v.clone());
            }
        }
        fetched
    }

    /// POST a request to the YouTube Music API (`music.youtube.com`).
    ///
    /// `payload` must already contain any `browseId`/`query`/`continuation`/
    /// `params` body fields. The `context` is injected from `client` when absent.
    /// `extra_query` lets the `search` endpoint append `&ctoken=…&continuation=…`.
    pub(crate) async fn post_music(
        &self,
        endpoint: &str,
        client: &MusicClient,
        payload: &mut Value,
        visitor_data: Option<&str>,
        extra_query: Option<&str>,
    ) -> AppResult<Value> {
        if let Some(obj) = payload.as_object_mut() {
            obj.entry("context")
                .or_insert_with(|| client.context(visitor_data, None));
        }

        let mut url = format!("{}{}?prettyPrint=false", endpoints::MUSIC_BASE, endpoint);
        if let Some(extra) = extra_query {
            url.push_str(extra);
        }

        let mut req = self
            .client
            .post(&url)
            .header(USER_AGENT, client.user_agent)
            .header("X-YouTube-Client-Name", client.client_id)
            .header("X-YouTube-Client-Version", client.version)
            .header("Origin", endpoints::ORIGIN)
            .header("Referer", endpoints::REFERER)
            .header("X-Origin", endpoints::ORIGIN)
            .header("X-Goog-Api-Format-Version", "1")
            .header("Cookie", "SOCS=CAE=")
            .json(payload);

        if let Some(vd) = visitor_data {
            req = req.header("X-Goog-Visitor-Id", vd);
        }

        let res = req
            .send()
            .await
            .map_err(|e| AppError::Extractor(format!("Music network error ({endpoint}): {e}")))?;
        let status = res.status();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| AppError::Extractor(format!("Music JSON error ({endpoint}): {e}")))?;

        if !status.is_success() {
            return Err(AppError::Extractor(format!(
                "YouTube Music returned status {} for {}: {}",
                status,
                endpoint,
                body["error"]["message"].as_str().unwrap_or("unknown error")
            )));
        }

        Ok(body)
    }

    /// Convenience: a `browse` against the music API with an optional browse id /
    /// params / continuation, all placed in the request body.
    pub(crate) async fn music_browse(
        &self,
        browse_id: Option<&str>,
        params: Option<&str>,
        continuation: Option<&str>,
        visitor_data: Option<&str>,
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
        self.post_music(
            "browse",
            &super::clients::WEB_REMIX,
            &mut payload,
            visitor_data,
            None,
        )
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
        // `player_context` drops the token unless this client's attestation platform
        // is the one Flow can actually mint for.
        let mut context = client.player_context(visitor_data, po_token, None);
        if client.is_embedded {
            context["thirdParty"] = json!({
                "embedUrl": format!("https://www.youtube.com/watch?v={video_id}")
            });
        }

        let mut payload = json!({
            "context": context,
            "videoId": video_id,
            "contentCheckOk": true,
            "racyCheckOk": true,
        });
        if let Some(ts) = signature_timestamp {
            payload["playbackContext"] = json!({
                "contentPlaybackContext": {
                    "referer": "https://www.youtube.com",
                    "signatureTimestamp": ts
                }
            });
        }

        let url = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
        let mut req = self
            .client
            .post(url)
            .header(USER_AGENT, client.user_agent)
            .header("X-YouTube-Client-Name", client.client_id)
            .header("X-YouTube-Client-Version", client.version)
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com")
            .header("Cookie", "SOCS=CAE=")
            .json(&payload);
        if let Some(vd) = visitor_data {
            req = req.header("X-Goog-Visitor-Id", vd);
        }

        let res = req
            .send()
            .await
            .map_err(|e| AppError::Extractor(format!("Music player network error: {e}")))?;
        let status = res.status();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| AppError::Extractor(format!("Music player JSON error: {e}")))?;
        if !status.is_success() {
            return Err(AppError::Extractor(format!(
                "Music player returned status {status} for client {}",
                client.name
            )));
        }
        Ok(body)
    }
}
