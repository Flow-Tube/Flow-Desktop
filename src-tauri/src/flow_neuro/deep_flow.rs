//! Deep Flow pauses learning for a while, as `src/lib/deepFlow.ts` decides from the same settings.
//! The backend reads them too, so no window, the pop-out player included, can teach the engine
//! during a session the viewer asked to keep out of their profile.

use sqlx::SqlitePool;

use crate::db::settings;
use crate::errors::AppResult;

const ACTIVE: &str = "deep_flow_active";
const ACTIVATED_AT: &str = "deep_flow_activated_at";
const EXPIRE_HOURS: &str = "deep_flow_expire_hours";
/// The settings default when the viewer never picked a duration.
const DEFAULT_EXPIRE_HOURS: u64 = 4;

/// Whether a Deep Flow session is running at `now_ms`. Hours of 0 never expire; an active flag
/// without a start time is a corrupt state and counts as off, as the frontend heals it.
#[must_use]
pub fn deep_flow_active(
    active: Option<&str>,
    activated_at: Option<&str>,
    expire_hours: Option<&str>,
    now_ms: u64,
) -> bool {
    if active != Some("true") {
        return false;
    }
    let Some(started) = activated_at
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|started| *started > 0)
    else {
        return false;
    };
    let hours = expire_hours
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_EXPIRE_HOURS);
    hours == 0 || now_ms < started + hours * 3_600_000
}

pub async fn learning_paused(pool: &SqlitePool, now_ms: u64) -> AppResult<bool> {
    let active = settings::get_setting(pool, ACTIVE).await?;
    if active.as_deref() != Some("true") {
        return Ok(false);
    }
    let activated_at = settings::get_setting(pool, ACTIVATED_AT).await?;
    let expire_hours = settings::get_setting(pool, EXPIRE_HOURS).await?;
    Ok(deep_flow_active(
        active.as_deref(),
        activated_at.as_deref(),
        expire_hours.as_deref(),
        now_ms,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: u64 = 3_600_000;

    #[test]
    fn a_session_runs_until_its_hours_are_up() {
        assert!(deep_flow_active(
            Some("true"),
            Some("1000"),
            Some("2"),
            1000 + HOUR
        ));
        assert!(!deep_flow_active(
            Some("true"),
            Some("1000"),
            Some("2"),
            1000 + 2 * HOUR
        ));
    }

    #[test]
    fn zero_hours_never_expire_and_a_missing_choice_is_four() {
        assert!(deep_flow_active(
            Some("true"),
            Some("1000"),
            Some("0"),
            1000 + 100 * HOUR
        ));
        assert!(deep_flow_active(
            Some("true"),
            Some("1000"),
            None,
            1000 + 3 * HOUR
        ));
        assert!(!deep_flow_active(
            Some("true"),
            Some("1000"),
            None,
            1000 + 4 * HOUR
        ));
    }

    #[test]
    fn off_or_without_a_start_time_is_not_a_session() {
        assert!(!deep_flow_active(
            Some("false"),
            Some("1000"),
            Some("0"),
            2000
        ));
        assert!(!deep_flow_active(None, None, None, 2000));
        assert!(!deep_flow_active(Some("true"), Some("0"), Some("0"), 2000));
    }
}
