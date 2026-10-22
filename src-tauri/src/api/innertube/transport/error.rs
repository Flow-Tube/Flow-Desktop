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
}

impl TransportError {
    /// Whether a fresh attempt could plausibly succeed.
    #[must_use]
    pub fn is_transient(&self) -> bool {
        match self {
            Self::Timeout | Self::Connect(_) => true,
            Self::Status { code, .. } => *code >= 500,
            Self::RateLimited { .. } | Self::NotJson(_) => false,
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
        TransportError::Status { code, .. } if *code >= 500 => AppError::Network(message),
        TransportError::Status { .. } | TransportError::NotJson(_) => AppError::Extractor(message),
    }
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
