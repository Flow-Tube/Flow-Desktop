//! Pure request building: URL, headers and body context for one call.

use serde_json::Value;

use crate::api::innertube::core::clients::YouTubeClient;

/// Which `InnerTube` origin a request goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Host {
    /// `www.youtube.com`, for video metadata and every player request.
    Www,
    /// `music.youtube.com`, for music metadata.
    Music,
}

impl Host {
    #[must_use]
    pub const fn origin(self) -> &'static str {
        match self {
            Self::Www => "https://www.youtube.com",
            Self::Music => "https://music.youtube.com",
        }
    }

    #[must_use]
    pub const fn referer(self) -> &'static str {
        match self {
            Self::Www => "https://www.youtube.com/",
            Self::Music => "https://music.youtube.com/",
        }
    }
}

/// One request: where it goes and who it claims to be.
#[derive(Clone, Copy, Debug)]
pub struct RequestSpec<'a> {
    pub host: Host,
    pub endpoint: &'a str,
    pub client: &'a YouTubeClient,
    /// Overrides the host's referer, as the youtu.be retry does.
    pub referer: Option<&'a str>,
    /// Appended to the URL, such as the music search's `&ctoken=…`.
    pub extra_query: Option<&'a str>,
}

impl RequestSpec<'_> {
    #[must_use]
    pub fn url(&self) -> String {
        format!(
            "{}/youtubei/v1/{}?prettyPrint=false{}",
            self.host.origin(),
            self.endpoint,
            self.extra_query.unwrap_or_default()
        )
    }

    /// Every header the request carries. The visitor header mirrors the body's
    /// `context.client.visitorData`, so the two can never disagree.
    #[must_use]
    pub fn headers(&self, visitor: Option<&str>) -> Vec<(&'static str, String)> {
        let origin = self.host.origin();
        let mut headers = vec![
            ("User-Agent", self.client.user_agent.to_string()),
            ("X-YouTube-Client-Name", self.client.client_id.to_string()),
            ("X-YouTube-Client-Version", self.client.version.to_string()),
            ("X-Goog-Api-Format-Version", "1".to_string()),
            ("Origin", origin.to_string()),
            ("X-Origin", origin.to_string()),
            (
                "Referer",
                self.referer.unwrap_or(self.host.referer()).to_string(),
            ),
            ("Cookie", "SOCS=CAE=".to_string()),
        ];
        if let Some(visitor) = visitor.filter(|value| !value.is_empty()) {
            headers.push(("X-Goog-Visitor-Id", visitor.to_string()));
        }
        headers
    }

    /// Whether a failed attempt of this request may be repeated. Player and
    /// visitor requests have their own budgets in the ladder that sends them.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        !matches!(self.endpoint, "player" | "visitor_id")
    }
}

/// The visitor identity a body's context carries.
#[must_use]
pub fn body_visitor(payload: &Value) -> Option<&str> {
    payload["context"]["client"]["visitorData"]
        .as_str()
        .filter(|value| !value.is_empty())
}

/// Give `payload` this client's context in `language`, carrying `visitor`,
/// unless the caller built its own. Returns whether the context was added here.
pub fn ensure_context(
    payload: &mut Value,
    client: &YouTubeClient,
    visitor: Option<&str>,
    language: &str,
) -> bool {
    let Some(object) = payload.as_object_mut() else {
        return false;
    };
    if object.contains_key("context") {
        return false;
    }
    object.insert(
        "context".to_string(),
        client.context_in(visitor, None, language),
    );
    true
}

/// The same body without its visitor identity.
pub fn strip_visitor(payload: &mut Value) {
    if let Some(client) = payload["context"]["client"].as_object_mut() {
        client.remove("visitorData");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::core::clients::{MWEB, VISIONOS, WEB, WEB_REMIX};
    use serde_json::json;

    fn header<'a>(headers: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn www_and_music_requests_share_one_header_set() {
        for (host, client) in [(Host::Www, &VISIONOS), (Host::Music, &WEB_REMIX)] {
            let spec = RequestSpec {
                host,
                endpoint: "browse",
                client,
                referer: None,
                extra_query: None,
            };
            let headers = spec.headers(Some("visitor-1"));
            assert_eq!(header(&headers, "User-Agent"), Some(client.user_agent));
            assert_eq!(
                header(&headers, "X-YouTube-Client-Name"),
                Some(client.client_id)
            );
            assert_eq!(
                header(&headers, "X-YouTube-Client-Version"),
                Some(client.version)
            );
            assert_eq!(header(&headers, "X-Goog-Api-Format-Version"), Some("1"));
            assert_eq!(header(&headers, "X-Origin"), Some(host.origin()));
            assert_eq!(header(&headers, "Referer"), Some(host.referer()));
            assert_eq!(header(&headers, "X-Goog-Visitor-Id"), Some("visitor-1"));
        }
    }

    #[test]
    fn no_visitor_header_without_a_visitor() {
        let spec = RequestSpec {
            host: Host::Www,
            endpoint: "visitor_id",
            client: &WEB,
            referer: Some("https://youtu.be/abc"),
            extra_query: None,
        };
        let headers = spec.headers(None);
        assert!(header(&headers, "X-Goog-Visitor-Id").is_none());
        assert_eq!(header(&headers, "Referer"), Some("https://youtu.be/abc"));
        assert!(!spec.is_retryable());
    }

    #[test]
    fn url_carries_the_endpoint_and_extra_query() {
        let spec = RequestSpec {
            host: Host::Music,
            endpoint: "search",
            client: &WEB_REMIX,
            referer: None,
            extra_query: Some("&ctoken=abc"),
        };
        assert_eq!(
            spec.url(),
            "https://music.youtube.com/youtubei/v1/search?prettyPrint=false&ctoken=abc"
        );
    }

    #[test]
    fn context_is_added_only_when_missing() {
        let mut body = json!({ "browseId": "FEwhat_to_watch" });
        assert!(ensure_context(&mut body, &WEB, Some("v1"), "en"));
        assert_eq!(body_visitor(&body), Some("v1"));
        assert_eq!(body["context"]["client"]["platform"], "DESKTOP");

        let mut own = json!({ "context": { "client": { "clientName": "X" } } });
        assert!(!ensure_context(&mut own, &WEB, Some("v1"), "en"));
        assert_eq!(body_visitor(&own), None);

        strip_visitor(&mut body);
        assert_eq!(body_visitor(&body), None);
    }

    #[test]
    fn only_mweb_repeats_its_user_agent_in_the_context() {
        assert_eq!(
            MWEB.context(None, None)["client"]["userAgent"],
            MWEB.user_agent
        );
        assert!(WEB.context(None, None)["client"].get("userAgent").is_none());
        assert!(
            VISIONOS.context(None, None)["client"]
                .get("platform")
                .is_none()
        );
    }
}
