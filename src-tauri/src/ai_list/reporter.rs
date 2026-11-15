//! Reports a channel to AiSList, the list's own maintainers, with a video as evidence. Opt-in: it
//! sends the channel handle, the video link and the viewer's chosen submitter name, which AiSList
//! shows on its public leaderboard. Their reviewers decide; nothing changes on this computer.

use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, USER_AGENT};
use serde::Serialize;

use super::fetcher::user_agent;
use super::matcher::AiVerdict;
use crate::api::http::shared_client;

const SUBMIT_URL: &str = "https://api.aisloplist.com";
const SUBMIT_TIMEOUT: Duration = Duration::from_secs(30);

/// What a report would be about, worked out before the viewer confirms it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiReportCheck {
    Ready { handle: String },
    AlreadyListed { verdict: AiVerdict },
    NoName,
    NoHandle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiReportResult {
    Sent,
    Busy,
    RateLimited,
    Rejected,
    Failed,
}

impl AiReportResult {
    /// AiSList's answers as its own clients read them; it publishes no API documentation.
    #[must_use]
    pub fn from_status(code: u16) -> Self {
        match code {
            200..=299 => Self::Sent,
            409 => Self::Busy,
            429 => Self::RateLimited,
            400 => Self::Rejected,
            _ => Self::Failed,
        }
    }
}

pub async fn submit(handle: &str, video_id: &str, name: &str) -> AiReportResult {
    if name.trim().is_empty() {
        return AiReportResult::Rejected;
    }
    let body = serde_json::json!({
        "channel_handle": handle,
        "video_url": format!("https://youtu.be/{video_id}"),
        "username": name.trim(),
    });
    let sent = shared_client()
        .post(SUBMIT_URL)
        .header(USER_AGENT, user_agent())
        .header(CONTENT_TYPE, "application/json")
        .timeout(SUBMIT_TIMEOUT)
        .body(body.to_string())
        .send()
        .await;
    match sent {
        Ok(response) => AiReportResult::from_status(response.status().as_u16()),
        Err(error) => {
            tracing::warn!(%error, "AiSList report did not go through");
            AiReportResult::Failed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aislist_answers_map_to_what_the_viewer_is_told() {
        assert_eq!(AiReportResult::from_status(200), AiReportResult::Sent);
        assert_eq!(AiReportResult::from_status(409), AiReportResult::Busy);
        assert_eq!(
            AiReportResult::from_status(429),
            AiReportResult::RateLimited
        );
        assert_eq!(AiReportResult::from_status(400), AiReportResult::Rejected);
        assert_eq!(AiReportResult::from_status(503), AiReportResult::Failed);
    }

    #[test]
    fn a_check_reads_as_a_tagged_object() {
        let ready = serde_json::to_value(AiReportCheck::Ready {
            handle: "@Name".to_string(),
        })
        .unwrap();
        assert_eq!(
            ready,
            serde_json::json!({ "kind": "ready", "handle": "@Name" })
        );
        let listed = serde_json::to_value(AiReportCheck::AlreadyListed {
            verdict: AiVerdict::Block,
        })
        .unwrap();
        assert_eq!(
            listed,
            serde_json::json!({ "kind": "alreadyListed", "verdict": "block" })
        );
    }
}
