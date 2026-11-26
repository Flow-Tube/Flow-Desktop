//! Why a request failed, kept apart from what the response said so the user
//! sees a network problem as one, not as a parse error.

use std::fmt;

use crate::errors::AppError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    Timeout,
    /// The connection could not be made or broke before a response arrived.
    Connect(String),
    /// HTTP 429, with the seconds the server asked to wait when it said.
    RateLimited {
        retry_after: Option<u64>,
    },
    /// Any other non-success status, with the server's message when it sent one.
    Status {
        code: u16,
        message: String,
    },
    /// A success status whose body was not JSON, such as a consent page.
    NotJson(String),
    /// Google's unusual-traffic page: the whole IP address is blocked for a
    /// while, so every client and every retry from it gets the same page.
    Blocked,
}

impl TransportError {
    /// Whether a fresh attempt could plausibly succeed.
    #[must_use]
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Timeout | Self::Connect(_) => true,
            Self::Status { code, .. } => *code >= 500,
            Self::RateLimited { .. } | Self::NotJson(_) | Self::Blocked => false,
        }
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => write!(f, "the request timed out"),
            Self::Connect(reason) => write!(f, "network error: {reason}"),
            Self::RateLimited {
                retry_after: Some(seconds),
            } => {
                write!(f, "rate limited, retry after {seconds} s")
            }
            Self::RateLimited { retry_after: None } => write!(f, "rate limited"),
            Self::Status { code, message } => write!(f, "status {code}: {message}"),
            Self::NotJson(snippet) => write!(f, "response was not JSON: {snippet}"),
            Self::Blocked => write!(f, "Google flagged unusual traffic from this network"),
        }
    }
}

/// `endpoint` names the call in the message the user's diagnostics show.
#[must_use]
pub fn to_app_error(endpoint: &str, error: &TransportError) -> AppError {
    let message = format!("{endpoint}: {error}");
    match error {
        TransportError::Timeout | TransportError::Connect(_) => AppError::Network(message),
        TransportError::RateLimited { .. } => AppError::RateLimited(message),
        TransportError::Blocked => AppError::NetworkWall(message),
        TransportError::Status { code, .. } if *code >= 500 => AppError::Network(message),
        TransportError::Status { .. } | TransportError::NotJson(_) => AppError::Extractor(message),
    }
}

/// Whether a response is Google's unusual-traffic page, the one behind "Our
/// systems have detected unusual traffic from your computer network". It comes
/// as a 403 or 429 HTML page titled `Sorry...`, or as a redirect to
/// `google.com/sorry`.
#[must_use]
pub fn is_unusual_traffic_page(status: u16, final_url: &str, body: &str) -> bool {
    if is_sorry_url(final_url) {
        return true;
    }
    if status != 403 && status != 429 {
        return false;
    }
    body.contains("<title>Sorry...</title>")
        || body.contains("/sorry/index")
        || body.to_ascii_lowercase().contains("unusual traffic")
}

fn is_sorry_url(url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    let google = url
        .host_str()
        .is_some_and(|host| host == "google.com" || host.ends_with(".google.com"));
    google && url.path().starts_with("/sorry")
}

/// Seconds from a `Retry-After` header, which may also be an HTTP date that this
/// ignores.
#[must_use]
pub fn parse_retry_after(value: Option<&str>) -> Option<u64> {
    value?.trim().parse().ok()
}

/// The start of a body, for a log line or message, cut on a character boundary.
#[must_use]
pub fn snippet(body: &str) -> String {
    const MAX: usize = 160;
    let end = body
        .char_indices()
        .map(|(index, _)| index)
        .nth(MAX)
        .unwrap_or(body.len());
    body[..end].trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_follow_the_failure() {
        assert!(matches!(
            to_app_error("browse", &TransportError::Timeout),
            AppError::Network(_)
        ));
        assert!(matches!(
            to_app_error("browse", &TransportError::Connect("reset".into())),
            AppError::Network(_)
        ));
        assert!(matches!(
            to_app_error(
                "browse",
                &TransportError::RateLimited {
                    retry_after: Some(30)
                }
            ),
            AppError::RateLimited(_)
        ));
        assert!(matches!(
            to_app_error(
                "browse",
                &TransportError::Status {
                    code: 503,
                    message: String::new()
                }
            ),
            AppError::Network(_)
        ));
        assert!(matches!(
            to_app_error(
                "browse",
                &TransportError::Status {
                    code: 400,
                    message: "bad".into()
                }
            ),
            AppError::Extractor(_)
        ));
        assert!(matches!(
            to_app_error("browse", &TransportError::NotJson("<html>".into())),
            AppError::Extractor(_)
        ));
        assert!(matches!(
            to_app_error("player", &TransportError::Blocked),
            AppError::NetworkWall(_)
        ));
    }

    const SORRY_PAGE: &str = "<html><head><meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\"><title>Sorry...</title></head><body><div>We're sorry...</div><div>... but your computer or network may be sending automated queries.</div></body></html>";

    #[test]
    fn the_unusual_traffic_page_is_a_block() {
        let api = "https://www.youtube.com/youtubei/v1/player";
        assert!(is_unusual_traffic_page(403, api, SORRY_PAGE));
        assert!(is_unusual_traffic_page(429, api, SORRY_PAGE));
        assert!(is_unusual_traffic_page(
            429,
            api,
            "<p>Our systems have detected Unusual Traffic from your computer network.</p>"
        ));
        assert!(is_unusual_traffic_page(
            200,
            "https://www.google.com/sorry/index?continue=https://www.youtube.com/",
            ""
        ));
    }

    #[test]
    fn other_refusals_are_not_a_block() {
        let api = "https://www.youtube.com/youtubei/v1/player";
        let json_error = r#"{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}"#;
        assert!(!is_unusual_traffic_page(403, api, json_error));
        assert!(!is_unusual_traffic_page(429, api, ""));
        assert!(!is_unusual_traffic_page(200, api, SORRY_PAGE));
        assert!(!is_unusual_traffic_page(
            403,
            "https://www.youtube.com/sorry",
            "<html><title>Forbidden</title></html>"
        ));
        assert!(!is_unusual_traffic_page(
            200,
            "https://notgoogle.com/sorry/index",
            ""
        ));
    }

    #[test]
    fn only_timeouts_connections_and_server_errors_are_transient() {
        assert!(TransportError::Timeout.is_transient());
        assert!(TransportError::Connect("x".into()).is_transient());
        assert!(
            TransportError::Status {
                code: 502,
                message: String::new()
            }
            .is_transient()
        );
        assert!(
            !TransportError::Status {
                code: 403,
                message: String::new()
            }
            .is_transient()
        );
        assert!(!TransportError::RateLimited { retry_after: None }.is_transient());
        assert!(!TransportError::NotJson(String::new()).is_transient());
        assert!(!TransportError::Blocked.is_transient());
    }

    #[test]
    fn retry_after_and_snippets() {
        assert_eq!(parse_retry_after(Some(" 30 ")), Some(30));
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2026 07:28:00 GMT")),
            None
        );
        assert_eq!(parse_retry_after(None), None);
        assert_eq!(snippet("  short "), "short");
        assert_eq!(snippet(&"é".repeat(300)).chars().count(), 160);
    }
}
