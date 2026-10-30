//! What live messages keep on this device (spec/live.md): its own counter, the highest counter
//! accepted from each sender, and the user's answer for each device that may control this one.

use std::collections::BTreeMap;

use sqlx::SqlitePool;

use crate::sync::error::SyncError;

/// The counter for the next message this device sends, persisted before the message leaves.
pub async fn next_live_seq(pool: &SqlitePool) -> Result<u64, SyncError> {
    let seq: i64 = sqlx::query_scalar(
        "UPDATE sync2_group SET live_seq = live_seq + 1 WHERE id = 1 RETURNING live_seq",
    )
    .fetch_one(pool)
    .await?;
    Ok(u64::try_from(seq).unwrap_or_default())
}

/// Records `seq` from `did` when it is above every counter accepted from it, and says whether it
/// was.
pub async fn accept_live_seq(pool: &SqlitePool, did: &str, seq: u64) -> Result<bool, SyncError> {
    let seq = i64::try_from(seq).map_err(|_| SyncError::Protocol("live counter".into()))?;
    let updated = sqlx::query(
        "INSERT INTO sync2_live_seen (did, seq) VALUES (?, ?)
         ON CONFLICT (did) DO UPDATE SET seq = excluded.seq WHERE excluded.seq > sync2_live_seen.seq",
    )
    .bind(did)
    .bind(seq)
    .execute(pool)
    .await?;
    Ok(updated.rows_affected() == 1)
}

/// The remembered answers: `true` to allow always, `false` to decline.
pub async fn consents(pool: &SqlitePool) -> Result<BTreeMap<String, bool>, SyncError> {
    let rows: Vec<(String, bool)> = sqlx::query_as("SELECT did, allowed FROM sync2_consent")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}

/// Remembers an answer for `did`, or forgets it so the device is asked again.
pub async fn set_consent(
    pool: &SqlitePool,
    did: &str,
    allowed: Option<bool>,
) -> Result<(), SyncError> {
    match allowed {
        Some(allowed) => {
            sqlx::query(
                "INSERT INTO sync2_consent (did, allowed) VALUES (?, ?)
                 ON CONFLICT (did) DO UPDATE SET allowed = excluded.allowed",
            )
            .bind(did)
            .bind(allowed)
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query("DELETE FROM sync2_consent WHERE did = ?")
                .bind(did)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}
