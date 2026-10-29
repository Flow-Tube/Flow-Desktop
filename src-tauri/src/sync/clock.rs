//! This device's hybrid clock (flow-sync spec/protocol.md, Change batches): the highest physical
//! time of any stamp it has applied, so a local edit is stamped after everything it has seen, even
//! when this device's clock is behind the one that wrote it.

use serde_json::Value;
use sqlx::{SqliteConnection, SqlitePool};

use crate::sync::canonical::Hlc;
use crate::sync::error::SyncError;

const HIGH_WATER_KEY: &str = "sync_clock_hwm";

/// The highest physical time among the stamps (`hlc`, `updatedHlc`, …) anywhere in `ndjson`.
#[must_use]
pub fn highest_stamp(ndjson: &[u8]) -> u64 {
    ndjson
        .split(|&b| b == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .map(|record| highest_in(&record))
        .max()
        .unwrap_or(0)
}

fn highest_in(value: &Value) -> u64 {
    match value {
        Value::Object(fields) => fields
            .iter()
            .map(|(name, field)| match field {
                Value::String(text) if name.to_ascii_lowercase().ends_with("hlc") => {
                    text.parse::<Hlc>().map_or(0, |hlc| hlc.physical_ms)
                }
                _ => highest_in(field),
            })
            .max()
            .unwrap_or(0),
        Value::Array(items) => items.iter().map(highest_in).max().unwrap_or(0),
        _ => 0,
    }
}

/// Raises the high-water mark to `ms`; it never goes down.
pub async fn observe(conn: &mut SqliteConnection, ms: u64) -> Result<(), SyncError> {
    if ms == 0 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
         WHERE CAST(settings.value AS INTEGER) < CAST(excluded.value AS INTEGER)",
    )
    .bind(HIGH_WATER_KEY)
    .bind(ms.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The time to stamp a local edit with: now, or just after the newest stamp applied here.
pub async fn edit_ms(pool: &SqlitePool) -> Result<u64, SyncError> {
    let high_water: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(HIGH_WATER_KEY)
        .fetch_optional(pool)
        .await?;
    let seen = high_water.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
    let now = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0);
    Ok(now.max(seen + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_newest_stamp_at_any_depth() {
        let ndjson = br#"{"hlc":"100:0:a","items":[{"hlc":"900:2:b"}]}
{"updatedHlc":"500:0:c","title":"999:0:not a stamp"}"#;
        assert_eq!(highest_stamp(ndjson), 900);
        assert_eq!(highest_stamp(b""), 0);
    }
}
