//! The group this device belongs to, kept in Default's database (only Default syncs).

use std::collections::BTreeMap;

use sqlx::SqlitePool;

use super::array;
use super::envelope::StreamPosition;
use super::roster::{Entry, parse_entry};
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct GroupRecord {
    pub group_id: String,
    pub store_url: String,
    pub instance: Option<String>,
    pub link: String,
    pub own_seq: i64,
    pub own_prev: String,
    pub cursor: i64,
}

impl GroupRecord {
    /// A group this device has just joined: nothing written or read yet.
    pub fn new(
        group_id: String,
        store_url: String,
        instance: Option<String>,
        link: String,
    ) -> Self {
        Self {
            group_id,
            store_url,
            instance,
            link,
            own_seq: 0,
            own_prev: hex::encode([0; 32]),
            cursor: 0,
        }
    }
}

pub async fn load_group(pool: &SqlitePool) -> Result<Option<GroupRecord>, SyncError> {
    Ok(sqlx::query_as("SELECT group_id, store_url, instance, link, own_seq, own_prev, cursor FROM sync2_group WHERE id = 1")
        .fetch_optional(pool)
        .await?)
}

pub async fn save_group(pool: &SqlitePool, record: &GroupRecord) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync2_group (id, group_id, store_url, instance, link, own_seq, own_prev, cursor)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET group_id = excluded.group_id, store_url = excluded.store_url,
             instance = excluded.instance, link = excluded.link, own_seq = excluded.own_seq,
             own_prev = excluded.own_prev, cursor = excluded.cursor",
    )
    .bind(&record.group_id)
    .bind(&record.store_url)
    .bind(&record.instance)
    .bind(&record.link)
    .bind(record.own_seq)
    .bind(&record.own_prev)
    .bind(record.cursor)
    .execute(pool)
    .await?;
    Ok(())
}

/// The verified roster, in order. Entries are checked again when read back.
pub async fn roster_entries(pool: &SqlitePool) -> Result<Vec<Entry>, SyncError> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT entry FROM sync2_roster ORDER BY seq")
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|json| {
            let value = serde_json::from_str(json)?;
            parse_entry(&value).map_err(|e| SyncError::Protocol(e.to_string()))
        })
        .collect()
}

pub async fn add_roster_entries(pool: &SqlitePool, entries: &[Entry]) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for entry in entries {
        let seq =
            i64::try_from(entry.seq).map_err(|_| SyncError::Protocol("roster too long".into()))?;
        sqlx::query("INSERT INTO sync2_roster (seq, entry) VALUES (?, ?)")
            .bind(seq)
            .bind(String::from_utf8_lossy(&to_canonical_json(entry)).into_owned())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn streams(pool: &SqlitePool) -> Result<BTreeMap<String, StreamPosition>, SyncError> {
    let rows: Vec<(String, i64, String)> =
        sqlx::query_as("SELECT did, seq, hash FROM sync2_streams")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(did, seq, hash)| {
            let hash = hex::decode(hash).ok().filter(|h| h.len() == 32)?;
            Some((
                did,
                StreamPosition {
                    seq: u64::try_from(seq).ok()?,
                    hash: array(&hash),
                },
            ))
        })
        .collect())
}

pub async fn save_streams(
    pool: &SqlitePool,
    positions: &BTreeMap<String, StreamPosition>,
    cursor: i64,
) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for (did, position) in positions {
        let seq =
            i64::try_from(position.seq).map_err(|_| SyncError::Protocol("log too long".into()))?;
        sqlx::query("INSERT INTO sync2_streams (did, seq, hash) VALUES (?, ?, ?) ON CONFLICT (did) DO UPDATE SET seq = excluded.seq, hash = excluded.hash")
            .bind(did)
            .bind(seq)
            .bind(hex::encode(position.hash))
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE sync2_group SET cursor = ? WHERE id = 1")
        .bind(cursor)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
