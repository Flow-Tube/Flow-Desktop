//! Recent sync failures for the dashboard: the error kind and when, nothing else, newest first.
//! Kept in Default's settings with the rest of the group's state.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::engine::Result;
use crate::db::settings::{get_setting, set_setting};

const ERRORS_KEY: &str = "sync2_errors";
const KEPT: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedError {
    pub kind: String,
    pub at_ms: i64,
}

pub async fn recent(pool: &SqlitePool) -> Result<Vec<LoggedError>> {
    Ok(get_setting(pool, ERRORS_KEY)
        .await?
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default())
}

/// Keeps `kind` as the newest failure, dropping the oldest beyond a few.
pub async fn note(pool: &SqlitePool, kind: &str, at_ms: i64) -> Result<()> {
    let mut errors = recent(pool).await?;
    errors.insert(
        0,
        LoggedError {
            kind: kind.to_owned(),
            at_ms,
        },
    );
    errors.truncate(KEPT);
    let json = serde_json::to_string(&errors).map_err(crate::sync::error::SyncError::from)?;
    Ok(set_setting(pool, ERRORS_KEY, &json).await?)
}

pub async fn clear(pool: &SqlitePool) -> Result<()> {
    Ok(set_setting(pool, ERRORS_KEY, "[]").await?)
}
