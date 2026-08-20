use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients::{self, YouTubeClient};
use crate::errors::{AppError, AppResult};
use serde_json::Value;

/// Percent-encode for InnerTube query strings, which want `+` for spaces rather
/// than the `%20` a general-purpose encoder emits.
pub fn custom_url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char);
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{:02X}", b)),
        }
    }
    encoded
}

impl InnertubeClient {
    /// POST to the main-site InnerTube API as `client`.
    ///
    /// The client's User-Agent, numeric id and version all come from the one
    /// registry entry, so a request can never claim to be one build in its
    /// context and another in its headers.
    pub async fn post_innertube(
        &self,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
    ) -> AppResult<Value> {
        if let Some(obj) = payload.as_object_mut() {
            obj.entry("context")
                .or_insert_with(|| client.context(None, None));
        }

        let mut custom_referer = None;
        if let Some(obj) = payload.as_object_mut() {
            if let Some(val) = obj.remove("custom_referer") {
                if let Some(s) = val.as_str() {
                    custom_referer = Some(s.to_string());
                }
            }
        }

        let url = format!(
            "https://www.youtube.com/youtubei/v1/{}?prettyPrint=false",
            endpoint
        );
        let mut req = self
            .client
            .post(&url)
            .header(reqwest::header::USER_AGENT, client.user_agent)
            .header("X-YouTube-Client-Name", client.client_id)
            .header("X-YouTube-Client-Version", client.version)
            .header("Origin", "https://www.youtube.com")
            .header("Cookie", "SOCS=CAE=") // Bypasses cookie consent blocks!
            .json(payload);

        if let Some(ref ref_url) = custom_referer {
            req = req.header("Referer", ref_url);
        } else {
            req = req.header("Referer", "https://www.youtube.com");
        }

        let res = req
            .send()
            .await
            .map_err(|e| AppError::Extractor(format!("Network error: {}", e)))?;

        let status = res.status();
        let res_json = res
            .json::<Value>()
            .await
            .map_err(|e| AppError::Extractor(format!("JSON parse error: {}", e)))?;

        if !status.is_success() {
            return Err(AppError::Extractor(format!(
                "Innertube returned status {}: {}",
                status,
                res_json["error"]["message"]
                    .as_str()
                    .unwrap_or("Unknown error")
            )));
        }

        Ok(res_json)
    }

    // Helper to fetch watch-next details (lyrics & related browse pointers) from WEB_REMIX
    pub async fn fetch_watch_next_metadata(
        &self,
        video_id: &str,
    ) -> AppResult<(
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> {
        let mut payload = serde_json::json!({
            "videoId": video_id
        });

        let res = self
            .post_innertube("next", &clients::WEB_REMIX, &mut payload)
            .await?;

        let lyrics_tab = res["contents"]["singleColumnMusicWatchNextResultsRenderer"]
            ["tabbedRenderer"]["watchNextTabbedResultsRenderer"]["tabs"]
            .as_array()
            .and_then(|tabs| tabs.get(1))
            .and_then(|tab| tab.get("tabRenderer"));

        let lyrics_browse_id = lyrics_tab
            .and_then(|renderer| renderer["endpoint"]["browseEndpoint"]["browseId"].as_str())
            .map(|s| s.to_string());

        let lyrics_params = lyrics_tab
            .and_then(|renderer| renderer["endpoint"]["browseEndpoint"]["params"].as_str())
            .map(|s| s.to_string());

        let related_tab = res["contents"]["singleColumnMusicWatchNextResultsRenderer"]
            ["tabbedRenderer"]["watchNextTabbedResultsRenderer"]["tabs"]
            .as_array()
            .and_then(|tabs| tabs.get(2))
            .and_then(|tab| tab.get("tabRenderer"));

        let related_browse_id = related_tab
            .and_then(|renderer| renderer["endpoint"]["browseEndpoint"]["browseId"].as_str())
            .map(|s| s.to_string());

        let related_params = related_tab
            .and_then(|renderer| renderer["endpoint"]["browseEndpoint"]["params"].as_str())
            .map(|s| s.to_string());

        Ok((
            lyrics_browse_id,
            lyrics_params,
            related_browse_id,
            related_params,
        ))
    }
}
