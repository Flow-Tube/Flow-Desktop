//! The group this device belongs to, kept in Default's database whichever profile runs.

use std::collections::BTreeMap;

use sqlx::SqlitePool;

use super::array;
use super::envelope::StreamPosition;
use super::roster::{Entry, parse_entry};
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;

/// Where a group keeps its objects: a Flow server, a `WebDAV` folder, or only its devices on the
/// LAN.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, serde::Serialize)]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StoreKind {
    Server,
    WebDav,
    Lan,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct GroupRecord {
    pub group_id: String,
    pub kind: StoreKind,
    pub store_url: String,
    pub instance: Option<String>,
    pub link: String,
    pub own_seq: i64,
    pub own_prev: String,
    pub cursor: i64,
}

impl GroupRecord {
    /// A group on a Flow server this device has just joined: nothing written or read yet.
    pub fn new(
        group_id: String,
        store_url: String,
        instance: Option<String>,
        link: String,
    ) -> Self {
        Self {
            group_id,
            kind: StoreKind::Server,
            store_url,
            instance,
            link,
            own_seq: 0,
            own_prev: hex::encode([0; 32]),
            cursor: 0,
        }
    }

    /// A LAN group this device has just joined or created.
    pub fn on_webdav(group_id: String, url: String, link: String) -> Self {
        Self {
            kind: StoreKind::WebDav,
            ..Self::new(group_id, url, None, link)
        }
    }

    pub fn on_lan(group_id: String, link: String) -> Self {
        Self {
            kind: StoreKind::Lan,
            ..Self::new(group_id, String::new(), None, link)
        }
    }
}

pub async fn load_group(pool: &SqlitePool) -> Result<Option<GroupRecord>, SyncError> {
    Ok(sqlx::query_as("SELECT group_id, kind, store_url, instance, link, own_seq, own_prev, cursor FROM sync2_group WHERE id = 1")
        .fetch_optional(pool)
        .await?)
}

pub async fn save_group(pool: &SqlitePool, record: &GroupRecord) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync2_group (id, group_id, kind, store_url, instance, link, own_seq, own_prev, cursor)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET group_id = excluded.group_id, kind = excluded.kind,
             store_url = excluded.store_url,
             instance = excluded.instance, link = excluded.link, own_seq = excluded.own_seq,
             own_prev = excluded.own_prev, cursor = excluded.cursor",
    )
    .bind(&record.group_id)
    .bind(record.kind)
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

/// Keeps verified entries. Sessions open at once (a sync, the LAN runtime, the live channel) read
/// the same new entries, so one already kept is left as it is.
pub async fn add_roster_entries(pool: &SqlitePool, entries: &[Entry]) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for entry in entries {
        let seq =
            i64::try_from(entry.seq).map_err(|_| SyncError::Protocol("roster too long".into()))?;
        sqlx::query("INSERT OR IGNORE INTO sync2_roster (seq, entry) VALUES (?, ?)")
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

/// Forgets the group on this device, for a device that was removed from it.
pub async fn forget_group(pool: &SqlitePool) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for statement in [
        "DELETE FROM sync2_group",
        "DELETE FROM sync2_roster",
        "DELETE FROM sync2_streams",
        "DELETE FROM sync2_sent",
        "DELETE FROM sync2_sent_links",
        "DELETE FROM sync2_profile_links",
        "DELETE FROM sync2_kept",
        "DELETE FROM sync2_profiles",
        "DELETE FROM sync2_floors",
        "DELETE FROM sync2_reading",
        "DELETE FROM sync2_snapshots",
        "DELETE FROM sync2_acks",
        "DELETE FROM sync2_manifests",
        "DELETE FROM sync2_links",
        "DELETE FROM sync2_collected",
        "DELETE FROM sync2_held_roster",
        "DELETE FROM sync2_held_keys",
        "DELETE FROM sync2_held_objects",
        "DELETE FROM sync2_pending",
        "DELETE FROM sync2_live_seen",
        "DELETE FROM sync2_consent",
    ] {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Where each link read from a snapshot stops being included in it, by link and sender.
pub type Floors = BTreeMap<(String, String), u64>;

pub async fn floors(pool: &SqlitePool) -> Result<Floors, SyncError> {
    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT link, did, seq FROM sync2_floors")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(link, did, seq)| ((link, did), u64::try_from(seq).unwrap_or(0)))
        .collect())
}

pub async fn save_floors(pool: &SqlitePool, floors: &Floors) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for ((link, did), seq) in floors {
        let seq = i64::try_from(*seq).map_err(|_| SyncError::Protocol("log too long".into()))?;
        sqlx::query("INSERT INTO sync2_floors (link, did, seq) VALUES (?, ?, ?) ON CONFLICT (link, did) DO UPDATE SET seq = excluded.seq")
            .bind(link)
            .bind(did)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Asks the next run to read `link` from its snapshot, for a profile that just joined it.
pub async fn read_from_snapshot(pool: &SqlitePool, link: &str) -> Result<(), SyncError> {
    sqlx::query("INSERT OR IGNORE INTO sync2_reading (link) VALUES (?)")
        .bind(link)
        .execute(pool)
        .await?;
    Ok(())
}

/// Links still to be read from their snapshot.
pub async fn links_to_read(pool: &SqlitePool) -> Result<Vec<String>, SyncError> {
    Ok(sqlx::query_scalar("SELECT link FROM sync2_reading")
        .fetch_all(pool)
        .await?)
}

pub async fn link_read(pool: &SqlitePool, link: &str) -> Result<(), SyncError> {
    sqlx::query("DELETE FROM sync2_reading WHERE link = ?")
        .bind(link)
        .execute(pool)
        .await?;
    Ok(())
}
