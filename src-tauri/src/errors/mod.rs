use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Extractor error: {0}")]
    Extractor(String),

    #[error("Age-restricted content: {0}")]
    AgeRestricted(String),

    #[error("Private content: {0}")]
    PrivateContent(String),

    #[error("Paid content: {0}")]
    PaidContent(String),

    #[error("Members-only content: {0}")]
    MembersOnly(String),

    /// A premiere or scheduled stream that has not started, with its start in
    /// epoch milliseconds when known.
    #[error("Upcoming: {0}")]
    LiveUpcoming(String, Option<u64>),

    #[error("Geographic restriction: {0}")]
    GeographicRestriction(String),

    #[error("YouTube Music Premium content: {0}")]
    MusicPremium(String),

    #[error("Bot check required: {0}")]
    BotCheckRequired(String),

    /// A bot check that also held for a fresh visitor identity.
    #[error("Network blocked: {0}")]
    NetworkWall(String),

    #[error("Account terminated: {0}")]
    AccountTerminated(String),

    #[error("Content not available: {0}")]
    ContentNotAvailable(String),

    /// The request timed out, the connection failed, or the server had an error.
    #[error("Network error: {0}")]
    Network(String),

    /// The server asked Flow to slow down (HTTP 429).
    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Streaming error: {0}")]
    #[allow(dead_code)]
    Streaming(String),

    /// The audio element could not decode the stream, even in a second format.
    /// Raised by the player's media element rather than here; listed so the
    /// kind has one definition.
    #[error("Media decode error: {0}")]
    #[allow(dead_code)]
    MediaDecode(String),

    /// The stream link was refused or expired, and fresh links failed too.
    /// Raised by the player's media element, like `MediaDecode`.
    #[error("Stream link expired: {0}")]
    #[allow(dead_code)]
    StreamExpired(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

// Preserve the underlying cause when propagating common library errors with `?`,
// instead of hand-writing `.map_err(|e| AppError::X(e.to_string()))` at every
// call site. The formatted message keeps the source's own text so the boundary
// logger below records it.
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Internal(format!("IO error: {error}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Extractor(format!("JSON error: {error}"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub message: String,
    pub kind: String,
    /// When an upcoming premiere or stream starts, in epoch milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at_ms: Option<u64>,
}

/// Walks `source()` and joins the chain into `caused by -> ... -> ...`. Empty
/// for the current `String`-backed variants; captures the real chain automatically
/// once variants carry `#[source]`.
fn cause_chain(error: &AppError) -> String {
    use std::error::Error;
    let mut chain = String::new();
    let mut source = error.source();
    while let Some(err) = source {
        if !chain.is_empty() {
            chain.push_str(" -> ");
        }
        chain.push_str(&err.to_string());
        source = err.source();
    }
    chain
}

impl From<AppError> for ErrorResponse {
    fn from(error: AppError) -> Self {
        let kind = match &error {
            AppError::Validation(_) => "validation",
            AppError::Extractor(_) => "extractor",
            AppError::AgeRestricted(_) => "ageRestricted",
            AppError::PrivateContent(_) => "privateContent",
            AppError::PaidContent(_) => "paidContent",
            AppError::MembersOnly(_) => "membersOnly",
            AppError::LiveUpcoming(..) => "liveUpcoming",
            AppError::GeographicRestriction(_) => "geographicRestriction",
            AppError::MusicPremium(_) => "musicPremium",
            AppError::BotCheckRequired(_) => "botCheckRequired",
            AppError::NetworkWall(_) => "networkWall",
            AppError::AccountTerminated(_) => "accountTerminated",
            AppError::ContentNotAvailable(_) => "contentNotAvailable",
            AppError::Network(_) => "network",
            AppError::RateLimited(_) => "rateLimited",
            AppError::Database(_) => "database",
            AppError::Streaming(_) => "streaming",
            AppError::MediaDecode(_) => "mediaDecode",
            AppError::StreamExpired(_) => "streamExpired",
            AppError::Internal(_) => "internal",
        };

        let message = error.to_string();
        let cause = cause_chain(&error);
        let starts_at_ms = match &error {
            AppError::LiveUpcoming(_, start) => *start,
            _ => None,
        };

        // Log every failure that crosses the backend->frontend boundary so a
        // user-visible error always leaves a diagnosable trail in the log file.
        // Severity by kind: internal/database faults are bugs (error); extraction
        // and streaming failures are operational (warn); content restrictions are
        // expected outcomes (debug) and shouldn't spam the default `info` log.
        match kind {
            "internal" | "database" => {
                tracing::error!(kind, error = %message, cause = %cause, "backend_error")
            }
            "extractor" | "streaming" | "validation" | "botCheckRequired" | "networkWall"
            | "network" | "rateLimited" | "mediaDecode" | "streamExpired" => {
                tracing::warn!(kind, error = %message, cause = %cause, "backend_error")
            }
            _ => tracing::debug!(kind, error = %message, "backend_error"),
        }

        Self {
            message,
            kind: kind.to_string(),
            starts_at_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_each_variant_to_its_kind() {
        let cases = [
            (AppError::Validation("v".into()), "validation"),
            (AppError::Extractor("e".into()), "extractor"),
            (AppError::AgeRestricted("a".into()), "ageRestricted"),
            (AppError::BotCheckRequired("b".into()), "botCheckRequired"),
            (AppError::Network("n".into()), "network"),
            (AppError::MembersOnly("m".into()), "membersOnly"),
            (AppError::NetworkWall("w".into()), "networkWall"),
            (AppError::LiveUpcoming("u".into(), Some(5)), "liveUpcoming"),
            (AppError::RateLimited("r".into()), "rateLimited"),
            (AppError::MediaDecode("d".into()), "mediaDecode"),
            (AppError::StreamExpired("x".into()), "streamExpired"),
            (AppError::Database(sqlx::Error::RowNotFound), "database"),
            (AppError::Internal("i".into()), "internal"),
        ];
        for (error, expected_kind) in cases {
            let response: ErrorResponse = error.into();
            assert_eq!(response.kind, expected_kind);
        }
    }

    #[test]
    fn io_error_converts_preserving_the_source_message() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "missing.dat");
        let response: ErrorResponse = AppError::from(io).into();
        assert_eq!(response.kind, "internal");
        assert!(response.message.contains("missing.dat"));
    }
}
