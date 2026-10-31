//! The `profiles` collection (spec/protocol.md, Profiles): each link's name, merged
//! last-writer-wins by `hlc`, kept in Default's database. A record goes out when this device's copy
//! differs from what it last sent or received.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::batches::IncomingBatch;
use crate::sync::canonical::{Hlc, to_canonical_json};
use crate::sync::clock;
use crate::sync::error::SyncError;

pub const PROFILES: &str = "profiles";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileRecord {
    pub deleted: bool,
    pub hlc: Hlc,
    pub link: String,
    pub name: String,
}

pub async fn records(pool: &SqlitePool) -> Result<Vec<ProfileRecord>, SyncError> {
    let rows: Vec<(String, String, String, bool)> =
        sqlx::query_as("SELECT link, name, hlc, deleted FROM sync2_profiles ORDER BY link")
            .fetch_all(pool)
            .await?;
    rows.into_iter()
        .map(|(link, name, hlc, deleted)| {
            Ok(ProfileRecord {
                deleted,
                hlc: hlc.parse().map_err(SyncError::Protocol)?,
                link,
                name,
            })
        })
        .collect()
}

/// Every record as canonical lines, the content of a `profiles` snapshot.
pub async fn ndjson(pool: &SqlitePool) -> Result<Vec<u8>, SyncError> {
    let lines: Vec<Vec<u8>> = records(pool).await?.iter().map(to_canonical_json).collect();
    Ok(lines.join(&b'\n'))
}

/// The records of `profiles` batches; a line this build can't read is skipped.
pub fn parse(batches: &[IncomingBatch]) -> Vec<ProfileRecord> {
    batches
        .iter()
        .flat_map(|batch| batch.records().split(|&b| b == b'\n'))
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect()
}

async fn stored(pool: &SqlitePool, link: &str) -> Result<Option<Hlc>, SyncError> {
    let hlc: Option<String> = sqlx::query_scalar("SELECT hlc FROM sync2_profiles WHERE link = ?")
        .bind(link)
        .fetch_optional(pool)
        .await?;
    hlc.map(|hlc| hlc.parse().map_err(SyncError::Protocol))
        .transpose()
}

async fn save(pool: &SqlitePool, record: &ProfileRecord) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync2_profiles (link, name, hlc, deleted) VALUES (?, ?, ?, ?)
         ON CONFLICT (link) DO UPDATE SET name = excluded.name, hlc = excluded.hlc,
             deleted = excluded.deleted",
    )
    .bind(&record.link)
    .bind(&record.name)
    .bind(record.hlc.to_string())
    .bind(record.deleted)
    .execute(pool)
    .await?;
    Ok(())
}

/// Merges records read from other devices, and returns the links they newly deleted.
pub async fn merge(
    pool: &SqlitePool,
    incoming: &[ProfileRecord],
) -> Result<Vec<String>, SyncError> {
    let mut deleted = Vec::new();
    for record in incoming {
        if stored(pool, &record.link)
            .await?
            .is_some_and(|hlc| hlc >= record.hlc)
        {
            continue;
        }
        save(pool, record).await?;
        mark_sent(pool, std::slice::from_ref(record)).await?;
        if record.deleted {
            deleted.push(record.link.clone());
        }
    }
    let highest = incoming
        .iter()
        .map(|r| r.hlc.physical_ms)
        .max()
        .unwrap_or(0);
    clock::observe(&mut *pool.acquire().await?, highest).await?;
    Ok(deleted)
}

/// Names `link` (or deletes it) as this device's newest edit.
pub async fn set(
    pool: &SqlitePool,
    device_id: &str,
    link: &str,
    name: &str,
    deleted: bool,
) -> Result<(), SyncError> {
    let hlc = Hlc::new(clock::edit_ms(pool).await?, 0, device_id);
    let record = ProfileRecord {
        deleted,
        hlc,
        link: link.to_owned(),
        name: name.to_owned(),
    };
    save(pool, &record).await
}

/// Writes a record for each of `named` (link and local name) that has none yet.
pub async fn name_missing(
    pool: &SqlitePool,
    device_id: &str,
    named: &[(String, String)],
) -> Result<(), SyncError> {
    for (link, name) in named {
        if stored(pool, link).await?.is_none() {
            set(pool, device_id, link, name, false).await?;
        }
    }
    Ok(())
}

/// Records this device hasn't sent in their current form.
pub async fn unsent(pool: &SqlitePool) -> Result<Vec<ProfileRecord>, SyncError> {
    let sent: Vec<(String, String)> = sqlx::query_as(
        "SELECT record_key, hash FROM sync2_sent_links WHERE link = '' AND collection = ?",
    )
    .bind(PROFILES)
    .fetch_all(pool)
    .await?;
    Ok(records(pool)
        .await?
        .into_iter()
        .filter(|r| {
            !sent
                .iter()
                .any(|(link, hlc)| *link == r.link && *hlc == r.hlc.to_string())
        })
        .collect())
}

/// Records sent or received, so they don't go out again unchanged.
pub async fn mark_sent(pool: &SqlitePool, records: &[ProfileRecord]) -> Result<(), SyncError> {
    for record in records {
        sqlx::query(
            "INSERT INTO sync2_sent_links (link, collection, record_key, hash, sent_at)
             VALUES ('', ?, ?, ?, 0)
             ON CONFLICT (link, collection, record_key) DO UPDATE SET hash = excluded.hash",
        )
        .bind(PROFILES)
        .bind(&record.link)
        .bind(record.hlc.to_string())
        .execute(pool)
        .await?;
    }
    Ok(())
}
