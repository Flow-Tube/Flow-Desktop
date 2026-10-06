//! The `sync_changes` table: per-record edit times and the tombstones sync still has to announce
//! (see migration `0015`).

use std::collections::BTreeMap;

use sqlx::SqliteConnection;

use crate::sync::error::SyncError;
use crate::sync::mapping::TOMBSTONE_TTL_MS;

pub const WATCH_HISTORY: &str = "watch_history";
pub const LIKES: &str = "likes";
pub const PLAYLISTS: &str = "playlists";
pub const PLAYLIST_ITEMS: &str = "playlist_items";
pub const GROUPS: &str = "subscriptions";

/// One local edit or deletion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub collection: &'static str,
    pub key: String,
    pub at_ms: u64,
    pub deleted: bool,
    /// Canonical JSON to send for a tombstone; this device's stamp is filled in on export.
    pub record: Option<String>,
}

impl Change {
    pub fn edit(collection: &'static str, key: impl Into<String>, at_ms: u64) -> Self {
        Self {
            collection,
            key: key.into(),
            at_ms,
            deleted: false,
            record: None,
        }
    }

    pub fn delete(
        collection: &'static str,
        key: impl Into<String>,
        at_ms: u64,
        record: Option<String>,
    ) -> Self {
        Self {
            collection,
            key: key.into(),
            at_ms,
            deleted: true,
            record,
        }
    }
}

/// What `sync_changes` holds for one record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stamp {
    pub at_ms: u64,
    pub deleted: bool,
    pub record: Option<String>,
    pub from_peer: bool,
}

/// The key of a track inside a playlist.
#[must_use]
pub fn item_key(sync_id: &str, video_id: &str) -> String {
    format!("{sync_id}|{video_id}")
}

/// Record local edits and deletions (latest wins per record).
pub async fn record(conn: &mut SqliteConnection, changes: &[Change]) -> Result<(), SyncError> {
    for c in changes {
        upsert(conn, c, false).await?;
    }
    Ok(())
}

/// Keep a tombstone received from a peer so it reaches devices that never talked to that peer.
pub async fn record_peer_tombstone(
    conn: &mut SqliteConnection,
    collection: &'static str,
    key: &str,
    at_ms: u64,
    record: String,
) -> Result<(), SyncError> {
    upsert(
        conn,
        &Change::delete(collection, key, at_ms, Some(record)),
        true,
    )
    .await
}

/// Move a playlist's history, its tracks' included, to the sync id it adopted from a peer.
pub async fn rename_playlist(
    conn: &mut SqliteConnection,
    from: &str,
    to: &str,
) -> Result<(), SyncError> {
    sqlx::query(
        "UPDATE OR REPLACE sync_changes SET item_key = ? WHERE collection = ? AND item_key = ?",
    )
    .bind(to)
    .bind(PLAYLISTS)
    .bind(from)
    .execute(&mut *conn)
    .await?;

    let (old_prefix, new_prefix) = (item_key(from, ""), item_key(to, ""));
    // SQLite's `substr` counts characters, not bytes.
    let len = i64::try_from(old_prefix.chars().count()).unwrap_or(i64::MAX);
    sqlx::query(
        "UPDATE OR REPLACE sync_changes SET item_key = ? || substr(item_key, ?)
         WHERE collection = ? AND substr(item_key, 1, ?) = ?",
    )
    .bind(new_prefix)
    .bind(len + 1)
    .bind(PLAYLIST_ITEMS)
    .bind(len)
    .bind(old_prefix)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn upsert(conn: &mut SqliteConnection, c: &Change, from_peer: bool) -> Result<(), SyncError> {
    sqlx::query(
        "INSERT INTO sync_changes (collection, item_key, changed_at_ms, deleted, record, from_peer)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection, item_key) DO UPDATE SET
            changed_at_ms = excluded.changed_at_ms,
            deleted = excluded.deleted,
            record = excluded.record,
            from_peer = excluded.from_peer",
    )
    .bind(c.collection)
    .bind(&c.key)
    .bind(i64::try_from(c.at_ms).unwrap_or(i64::MAX))
    .bind(c.deleted)
    .bind(&c.record)
    .bind(from_peer)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Everything recorded for `collection`, keyed by record key. Tombstones past the retention window
/// are dropped first, matching the subscription tombstones and Flow for Android.
pub async fn load(
    conn: &mut SqliteConnection,
    collection: &str,
    now_ms: u64,
) -> Result<BTreeMap<String, Stamp>, SyncError> {
    let cutoff = now_ms.saturating_sub(TOMBSTONE_TTL_MS);
    sqlx::query(
        "DELETE FROM sync_changes WHERE collection = ? AND deleted = 1 AND changed_at_ms < ?",
    )
    .bind(collection)
    .bind(i64::try_from(cutoff).unwrap_or(i64::MAX))
    .execute(&mut *conn)
    .await?;

    let rows: Vec<(String, i64, bool, Option<String>, bool)> = sqlx::query_as(
        "SELECT item_key, changed_at_ms, deleted, record, from_peer FROM sync_changes
         WHERE collection = ?",
    )
    .bind(collection)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(key, at, deleted, record, from_peer)| {
            (
                key,
                Stamp {
                    at_ms: u64::try_from(at).unwrap_or(0),
                    deleted,
                    record,
                    from_peer,
                },
            )
        })
        .collect())
}
