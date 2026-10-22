//! What a link to the site points at, from `navigation/resolve_url`: the site's own
//! router, so handles, `/c/` and `/user/` names resolve to the channel they name
//! rather than to an id scraped out of a page's HTML.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::{Value, json};

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::errors::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedEndpoint {
    Channel(String),
    Playlist(String),
    Video(String),
    Short(String),
    Url(String),
}

fn cache() -> &'static Mutex<HashMap<String, ResolvedEndpoint>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ResolvedEndpoint>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn endpoint_of(answer: &Value) -> Option<ResolvedEndpoint> {
    let endpoint = &answer["endpoint"];
    let text = |value: &Value| {
        value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    };
    if let Some(browse_id) = text(&endpoint["browseEndpoint"]["browseId"]) {
        return Some(match browse_id.strip_prefix("VL") {
            Some(playlist_id) => ResolvedEndpoint::Playlist(playlist_id.to_string()),
            None => ResolvedEndpoint::Channel(browse_id),
        });
    }
    if let Some(video_id) = text(&endpoint["reelWatchEndpoint"]["videoId"]) {
        return Some(ResolvedEndpoint::Short(video_id));
    }
    if let Some(video_id) = text(&endpoint["watchEndpoint"]["videoId"]) {
        return Some(ResolvedEndpoint::Video(video_id));
    }
    text(&endpoint["urlEndpoint"]["url"]).map(ResolvedEndpoint::Url)
}

impl InnertubeClient {
    /// The endpoint `url` opens, cached for the session: a link resolves the
    /// same way until the app restarts.
    pub async fn resolve_url(&self, url: &str) -> AppResult<ResolvedEndpoint> {
        let url = url.trim();
        if let Some(hit) = cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(url)
        {
            return Ok(hit.clone());
        }
        let mut body = json!({ "url": url });
        let answer = self
            .post_innertube("navigation/resolve_url", &clients::WEB, &mut body)
            .await?;
        let endpoint = endpoint_of(&answer)
            .ok_or_else(|| AppError::ContentNotAvailable(format!("Nothing to open at {url}")))?;
        cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(url.to_string(), endpoint.clone());
        Ok(endpoint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_endpoint_shape_resolves() {
        let channel = json!({ "endpoint": { "browseEndpoint": { "browseId": "UCXuqSBlHAE6Xw-yeJA0Tunw", "params": "x" } } });
        assert_eq!(
            endpoint_of(&channel),
            Some(ResolvedEndpoint::Channel("UCXuqSBlHAE6Xw-yeJA0Tunw".into()))
        );
        let playlist = json!({ "endpoint": { "browseEndpoint": { "browseId": "VLPL123" } } });
        assert_eq!(
            endpoint_of(&playlist),
            Some(ResolvedEndpoint::Playlist("PL123".into()))
        );
        let short = json!({ "endpoint": { "reelWatchEndpoint": { "videoId": "qqhIp0OaZWI" } } });
        assert_eq!(
            endpoint_of(&short),
            Some(ResolvedEndpoint::Short("qqhIp0OaZWI".into()))
        );
        let link = json!({ "endpoint": { "urlEndpoint": { "url": "https://www.youtube.com/watch?v=x" } } });
        assert_eq!(
            endpoint_of(&link),
            Some(ResolvedEndpoint::Url(
                "https://www.youtube.com/watch?v=x".into()
            ))
        );
        assert_eq!(endpoint_of(&json!({})), None);
    }
}
