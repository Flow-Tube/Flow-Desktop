//! Plain GETs with no identifiers and no query parameters, as the list contract asks, on the
//! shared HTTP client.

use std::future::Future;
use std::time::Duration;

use reqwest::header::{ETAG, IF_NONE_MATCH, USER_AGENT};

use super::updater::{AiListFetcher, AiListResponse};
use crate::api::http::shared_client;

/// The shared client gives a request 30 s, which a slow link can spend on the snapshot alone;
/// every retry would then die at the same point.
const LIST_TIMEOUT: Duration = Duration::from_mins(5);
const MAX_BYTES: usize = 16 * 1024 * 1024;

pub fn user_agent() -> String {
    format!("Flow/{}", env!("CARGO_PKG_VERSION"))
}

pub struct HttpFetcher {
    base_url: String,
}

impl HttpFetcher {
    #[must_use]
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
        }
    }
}

impl AiListFetcher for HttpFetcher {
    fn get(
        &self,
        path: &str,
        etag: Option<&str>,
    ) -> impl Future<Output = Result<AiListResponse, String>> + Send {
        let mut request = shared_client()
            .get(format!("{}{path}", self.base_url))
            .header(USER_AGENT, user_agent())
            .timeout(LIST_TIMEOUT);
        if let Some(etag) = etag {
            request = request.header(IF_NONE_MATCH, etag);
        }
        let path = path.to_string();
        async move {
            let mut response = request.send().await.map_err(|error| error.to_string())?;
            let status = response.status().as_u16();
            let etag = response
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned);
            if status != 200 {
                return Ok(AiListResponse {
                    status,
                    body: None,
                    etag,
                });
            }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
                if body.len() + chunk.len() > MAX_BYTES {
                    return Err(format!("{path} is over {MAX_BYTES} bytes"));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(AiListResponse {
                status,
                body: Some(body),
                etag,
            })
        }
    }
}
