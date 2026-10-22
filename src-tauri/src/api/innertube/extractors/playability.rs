//! What a non-OK `playabilityStatus` means: which restriction to tell the user,
//! and whether any other client could do better.
//!
//! Extraction runs in English, so the reasons are matched as English text, the
//! same patterns Flow for Android's `PlayabilityVerdict` uses.

use serde_json::Value;

use crate::errors::{AppError, AppResult};

/// One client's refusal, with whether the response still described the video.
/// A removed video comes back without its details; one refused to this viewer
/// (country, rate limit, membership) keeps them.
#[derive(Clone, Debug)]
pub(crate) struct Refusal {
    pub playability: Value,
    pub has_video_details: bool,
}

impl Refusal {
    pub(crate) fn of(response: &Value) -> Self {
        Self {
            playability: response["playabilityStatus"].clone(),
            has_video_details: response["videoDetails"].is_object(),
        }
    }
}

/// What the ladder tells the user once every client has failed.
#[derive(Clone, Debug)]
pub(crate) struct LadderReport {
    pub refusal: Refusal,
    /// The bot wall held for a freshly minted identity too, so the network,
    /// not the identity, is the likelier cause.
    pub fresh_identity_walled: bool,
}

impl LadderReport {
    pub(crate) fn to_error(&self) -> AppError {
        match map_playability_error(&self.refusal.playability) {
            AppError::BotCheckRequired(message) if self.fresh_identity_walled => {
                AppError::NetworkWall(message)
            }
            error => error,
        }
    }
}

/// The top-level `reason` joined with the `errorScreen` subreason, where the
/// specific detail often is ("This video may be inappropriate for some users.")
/// while `reason` stays terse ("Sign in to confirm your age").
fn combined_playability_reason(playability: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(reason) = playability["reason"]
        .as_str()
        .filter(|reason| !reason.is_empty())
    {
        parts.push(reason.to_string());
    }
    let subreason = &playability["errorScreen"]["playerErrorMessageRenderer"]["subreason"];
    if let Some(text) = subreason["simpleText"].as_str() {
        parts.push(text.to_string());
    }
    for run in subreason["runs"].as_array().into_iter().flatten() {
        if let Some(text) = run["text"].as_str() {
            parts.push(text.to_string());
        }
    }
    if parts.is_empty() {
        "Unknown content availability error".to_string()
    } else {
        parts.join(" ")
    }
}

/// When an upcoming premiere or stream starts, from its offline slate.
fn scheduled_start_ms(playability: &Value) -> Option<u64> {
    playability["liveStreamability"]["liveStreamabilityRenderer"]["offlineSlate"]
        ["liveStreamOfflineSlateRenderer"]["scheduledStartTime"]
        .as_str()
        .and_then(|seconds| seconds.parse::<u64>().ok())
        .map(|seconds| seconds.saturating_mul(1000))
}

fn is_upcoming(status: &str, playability: &Value, reason: &str) -> bool {
    status.eq_ignore_ascii_case("LIVE_STREAM_OFFLINE")
        || playability["liveStreamability"].is_object()
        || reason.contains("premiere")
        || reason.contains("will begin")
        || reason.contains("scheduled")
}

pub(crate) fn map_playability_error(playability: &Value) -> AppError {
    let status = playability["status"].as_str().unwrap_or("UNKNOWN");
    let reason_text = combined_playability_reason(playability);
    let reason = reason_text.to_ascii_lowercase();

    if is_upcoming(status, playability, &reason) {
        return AppError::LiveUpcoming(reason_text, scheduled_start_ms(playability));
    }

    if reason.contains("inappropriate for some users")
        || reason.contains("confirm your age")
        || reason.contains("verify your age")
        || reason.contains("age-restricted")
        || reason.contains("age restricted")
    {
        return AppError::AgeRestricted(
            "This age-restricted video cannot be watched anonymously".into(),
        );
    }

    if status.eq_ignore_ascii_case("login_required") {
        if reason.contains("private") {
            return AppError::PrivateContent("This video is private".into());
        }
        if reason.contains("not a bot") || reason.contains("confirm you") || reason.contains("bot")
        {
            return AppError::BotCheckRequired(format!(
                "YouTube blocked anonymous watch access: {status}: \"{reason_text}\""
            ));
        }
    }

    if status.eq_ignore_ascii_case("unplayable") || status.eq_ignore_ascii_case("error") {
        if reason.contains("music premium") {
            return AppError::MusicPremium("This video is a YouTube Music Premium video".into());
        }
        if reason.contains("members-only")
            || reason.contains("join this channel")
            || reason.contains("premium members")
            || reason.contains("members")
        {
            return AppError::MembersOnly("This video is only available to channel members".into());
        }
        if reason.contains("payment") || reason.contains("purchase") {
            return AppError::PaidContent("This video is a paid video".into());
        }
        if reason.contains("in your country")
            || reason.contains("in your region")
            || reason.contains("country")
        {
            return AppError::GeographicRestriction(
                "This video is not available in the current region".into(),
            );
        }
        if reason.contains("try again later") {
            return AppError::RateLimited(format!(
                "YouTube is refusing this network for a while: \"{reason_text}\""
            ));
        }
        if reason.contains("closed") || reason.contains("terminated") {
            return AppError::AccountTerminated(reason_text);
        }
    }

    AppError::ContentNotAvailable(format!("Got error {status}: \"{reason_text}\""))
}

/// A restriction that belongs to the video, so every client would refuse it
/// alike.
fn is_definitive_restriction(error: &AppError) -> bool {
    matches!(
        error,
        AppError::AgeRestricted(_)
            | AppError::PrivateContent(_)
            | AppError::PaidContent(_)
            | AppError::MembersOnly(_)
            | AppError::GeographicRestriction(_)
            | AppError::MusicPremium(_)
            | AppError::AccountTerminated(_)
            | AppError::LiveUpcoming(..)
    )
}

pub(crate) fn check_playability_status(playability_status: &Value) -> AppResult<()> {
    match playability_status["status"].as_str() {
        None => Ok(()),
        Some(status) if status.eq_ignore_ascii_case("ok") => Ok(()),
        Some(_) => Err(map_playability_error(playability_status)),
    }
}

pub(crate) fn is_bot_wall(playability: &Value) -> bool {
    matches!(
        map_playability_error(playability),
        AppError::BotCheckRequired(_)
    )
}

/// Whether this refusal ends the client ladder: it is about the video, so the
/// next client would only say the same. A removed video counts only when the
/// response no longer describes it; label and kids videos are refused on the app
/// clients with their details intact, and a web client still serves them. Bot
/// walls and rate limits are about the viewer and are worth another client.
pub(crate) fn ends_the_ladder(refusal: &Refusal) -> bool {
    match map_playability_error(&refusal.playability) {
        AppError::ContentNotAvailable(_) => {
            let status = refusal.playability["status"].as_str().unwrap_or_default();
            let client_specific = combined_playability_reason(&refusal.playability)
                .to_ascii_lowercase()
                .contains("page needs to be reloaded");
            (status.eq_ignore_ascii_case("ERROR") || status.eq_ignore_ascii_case("UNPLAYABLE"))
                && !refusal.has_video_details
                && !client_specific
        }
        error => is_definitive_restriction(&error),
    }
}

/// Whether `candidate` tells the user more than `current` does once every
/// client has failed: a bot wall is only reported when nothing else was said.
pub(crate) fn is_better_report(current: Option<&Refusal>, candidate: &Refusal) -> bool {
    current.is_none_or(|current| {
        is_bot_wall(&current.playability) && !is_bot_wall(&candidate.playability)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn refusal(playability: Value, has_video_details: bool) -> Refusal {
        Refusal {
            playability,
            has_video_details,
        }
    }

    #[test]
    fn age_gate_is_read_from_the_reason_or_the_subreason() {
        let terse = json!({ "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm your age" });
        assert!(matches!(
            map_playability_error(&terse),
            AppError::AgeRestricted(_)
        ));
        let detailed = json!({
            "status": "LOGIN_REQUIRED",
            "reason": "Sign in to confirm you’re not a bot",
            "errorScreen": { "playerErrorMessageRenderer": { "subreason": { "runs": [
                { "text": "This video may be inappropriate for some users." }
            ] } } }
        });
        assert!(matches!(
            map_playability_error(&detailed),
            AppError::AgeRestricted(_)
        ));
    }

    #[test]
    fn private_bot_wall_and_premium() {
        let private = json!({ "status": "LOGIN_REQUIRED", "reason": "This video is private." });
        assert!(matches!(
            map_playability_error(&private),
            AppError::PrivateContent(_)
        ));
        let wall =
            json!({ "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you’re not a bot" });
        assert!(is_bot_wall(&wall));
        assert!(!is_bot_wall(&private));
        let premium = json!({ "status": "UNPLAYABLE", "reason": "This video is only available to Music Premium members" });
        assert!(matches!(
            map_playability_error(&premium),
            AppError::MusicPremium(_)
        ));
    }

    #[test]
    fn viewer_blocks_from_android_s_wording() {
        let region = json!({ "status": "UNPLAYABLE", "reason": "The uploader has not made this video available in your country" });
        assert!(matches!(
            map_playability_error(&region),
            AppError::GeographicRestriction(_)
        ));
        let limited = json!({ "status": "ERROR", "reason": "This content isn't available, try again later." });
        assert!(matches!(
            map_playability_error(&limited),
            AppError::RateLimited(_)
        ));
        let members = json!({ "status": "UNPLAYABLE", "reason": "Join this channel to get access to members-only content like this video" });
        assert!(matches!(
            map_playability_error(&members),
            AppError::MembersOnly(_)
        ));
        let paid =
            json!({ "status": "UNPLAYABLE", "reason": "This video requires payment to watch." });
        assert!(matches!(
            map_playability_error(&paid),
            AppError::PaidContent(_)
        ));
    }

    #[test]
    fn upcoming_premieres_carry_their_start() {
        let offline = json!({
            "status": "LIVE_STREAM_OFFLINE",
            "reason": "Premieres in 2 hours",
            "liveStreamability": { "liveStreamabilityRenderer": { "offlineSlate": {
                "liveStreamOfflineSlateRenderer": { "scheduledStartTime": "1790000000" }
            } } }
        });
        match map_playability_error(&offline) {
            AppError::LiveUpcoming(_, start) => assert_eq!(start, Some(1_790_000_000_000)),
            other => panic!("expected upcoming, got {other:?}"),
        }
        let scheduled = json!({ "status": "UNPLAYABLE", "reason": "This live event will begin in a few moments." });
        assert!(matches!(
            map_playability_error(&scheduled),
            AppError::LiveUpcoming(_, None)
        ));
        assert!(ends_the_ladder(&refusal(offline, true)));
    }

    #[test]
    fn only_a_video_without_details_is_gone() {
        let removed = json!({ "status": "ERROR", "reason": "This video is unavailable" });
        assert!(ends_the_ladder(&refusal(removed.clone(), false)));
        assert!(!ends_the_ladder(&refusal(removed, true)));
        let label = json!({ "status": "UNPLAYABLE", "reason": "This video is not available" });
        assert!(
            !ends_the_ladder(&refusal(label, true)),
            "label videos are served by web clients"
        );
        let reload = json!({ "status": "UNPLAYABLE", "reason": "The page needs to be reloaded." });
        assert!(
            !ends_the_ladder(&refusal(reload, false)),
            "one client's reload request is not removal"
        );
    }

    #[test]
    fn walls_and_rate_limits_try_the_next_client() {
        let wall =
            json!({ "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you’re not a bot" });
        assert!(!ends_the_ladder(&refusal(wall.clone(), true)));
        let limited = json!({ "status": "ERROR", "reason": "This content isn't available, try again later." });
        assert!(!ends_the_ladder(&refusal(limited.clone(), true)));
        assert!(is_better_report(None, &refusal(wall.clone(), true)));
        assert!(is_better_report(
            Some(&refusal(wall.clone(), true)),
            &refusal(limited.clone(), true)
        ));
        assert!(!is_better_report(
            Some(&refusal(limited, true)),
            &refusal(wall, true)
        ));
    }

    #[test]
    fn a_wall_that_survives_a_new_identity_is_the_network_s() {
        let wall =
            json!({ "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you’re not a bot" });
        let report = |fresh_identity_walled| LadderReport {
            refusal: refusal(wall.clone(), true),
            fresh_identity_walled,
        };
        assert!(matches!(report(true).to_error(), AppError::NetworkWall(_)));
        assert!(matches!(
            report(false).to_error(),
            AppError::BotCheckRequired(_)
        ));
    }

    #[test]
    fn unknown_reason_falls_back_to_content_not_available() {
        let unknown = json!({ "status": "UNPLAYABLE", "reason": "Video unavailable" });
        assert!(matches!(
            map_playability_error(&unknown),
            AppError::ContentNotAvailable(_)
        ));
        assert!(check_playability_status(&json!({ "status": "OK" })).is_ok());
    }
}
