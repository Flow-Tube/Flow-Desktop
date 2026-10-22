use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients::YouTubeClient;
use crate::api::innertube::transport::error::{TransportError, to_app_error};
use crate::api::innertube::transport::request::{
    Host, RequestSpec, body_visitor, ensure_context, strip_visitor,
};
use crate::api::innertube::transport::send::send;
use crate::errors::AppResult;
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
        self.post_via(
            &self.client,
            Host::Www,
            endpoint,
            client,
            payload,
            None,
            None,
        )
        .await
    }

    /// [`Self::post_innertube`] on the dedicated playback connection pool, for
    /// the requests first frame waits on.
    pub async fn post_innertube_for_playback(
        &self,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
    ) -> AppResult<Value> {
        self.post_via(
            &self.playback_client,
            Host::Www,
            endpoint,
            client,
            payload,
            None,
            None,
        )
        .await
    }

    /// A `player` request on the playback pool, with an optional referer.
    pub async fn post_player(
        &self,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
    ) -> AppResult<Value> {
        self.post_via(
            &self.playback_client,
            Host::Www,
            "player",
            client,
            payload,
            referer,
            None,
        )
        .await
    }

    /// Send one request through the shared transport.
    ///
    /// A body without a context gets this client's, carrying the visitor
    /// identity; a body with one is sent as the caller built it. When the server
    /// answers 400 to an identity added here, the request is repeated once
    /// without it and that identity is dropped, as Flow for Android does.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn post_via(
        &self,
        http: &reqwest::Client,
        host: Host,
        endpoint: &str,
        client: &YouTubeClient,
        payload: &mut Value,
        referer: Option<&str>,
        extra_query: Option<&str>,
    ) -> AppResult<Value> {
        let spec = RequestSpec {
            host,
            endpoint,
            client,
            referer,
            extra_query,
        };
        let added = if payload.get("context").is_some() {
            false
        } else {
            let visitor = self.fetch_visitor_data().await;
            ensure_context(payload, client, visitor.as_deref())
        };
        let visitor = body_visitor(payload).map(ToOwned::to_owned);
        match send(http, &spec, payload, visitor.as_deref()).await {
            Err(TransportError::Status { code: 400, .. }) if added && visitor.is_some() => {
                strip_visitor(payload);
                let retried = send(http, &spec, payload, None).await;
                if retried.is_ok() {
                    if let Some(rejected) = visitor.as_deref() {
                        self.identity.forget_if(rejected);
                    }
                    tracing::warn!(
                        endpoint,
                        "visitor identity rejected; request succeeded without it"
                    );
                }
                retried.map_err(|error| to_app_error(endpoint, &error))
            }
            result => result.map_err(|error| to_app_error(endpoint, &error)),
        }
    }
}
