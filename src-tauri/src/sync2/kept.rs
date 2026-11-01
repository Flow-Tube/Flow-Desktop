//! Batches kept for a linked profile that isn't running (spec/protocol.md, Profiles), applied in
//! the order they were read once it runs.

use sqlx::SqlitePool;

use super::batches::IncomingBatch;
use crate::sync::error::SyncError;

/// A batch of `link` read from `sender`'s log at `seq`; `part` numbers a snapshot's blobs from 1,
/// and is 0 for a change batch.
pub struct Kept {
    pub link: String,
    pub sender: String,
    pub seq: u64,
    pub part: u32,
    pub batch: IncomingBatch,
}

fn to_i64(value: u64) -> Result<i64, SyncError> {
    i64::try_from(value).map_err(|_| SyncError::Protocol("log too long".into()))
}

/// Keeps batches of collections this build knows; a batch read again is kept once.
pub async fn keep(pool: &SqlitePool, kept: &[Kept]) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for item in kept {
        let Some(collection) = item.batch.collection else {
            continue;
        };
        sqlx::query(
            "INSERT OR IGNORE INTO sync2_kept (link, sender, seq, part, collection, head, records)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&item.link)
        .bind(&item.sender)
        .bind(to_i64(item.seq)?)
        .bind(item.part)
        .bind(collection.key())
        .bind(&item.batch.head)
        .bind(item.batch.records())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The batches kept for `link`, oldest first, by row id and sender.
pub async fn kept(
    pool: &SqlitePool,
    link: &str,
) -> Result<Vec<(i64, String, IncomingBatch)>, SyncError> {
    let rows: Vec<(i64, String, String, String, Vec<u8>)> = sqlx::query_as(
        "SELECT id, sender, collection, head, records FROM sync2_kept WHERE link = ? ORDER BY id",
    )
    .bind(link)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, sender, collection, head, records)| {
            let batch = IncomingBatch::kept(&collection, link.to_owned(), head, records);
            (id, sender, batch)
        })
        .collect())
}

/// Forgets kept batches once applied.
pub async fn applied(pool: &SqlitePool, ids: &[i64]) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for id in ids {
        sqlx::query("DELETE FROM sync2_kept WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Whether batches of `link` wait to be applied.
pub async fn has_kept(pool: &SqlitePool, link: &str) -> Result<bool, SyncError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM sync2_kept WHERE link = ? LIMIT 1")
            .bind(link)
            .fetch_optional(pool)
            .await?
            .is_some(),
    )
}
