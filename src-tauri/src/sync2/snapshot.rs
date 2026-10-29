//! Snapshots (spec/protocol.md, Snapshots): the merged state of a link as sealed blobs, listed by
//! a manifest in the writer's log, so new devices and garbage collection don't need old logs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::batches::batch_content;
use super::blob::seal_blob;
use super::engine::{Result, Session, now_ms};
use super::envelope::ObjectType;
use super::epoch::purpose_key;
use super::kdf::sha256;
use super::paths::blob_path;
use super::payload::encode_payload;
use super::state::streams;
use super::store::Store;
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;
use crate::sync::protocol::OutgoingCollection;

const MERGED_LIMIT: i64 = 1024 * 1024;
const MAX_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// spec/store.md asks for at most 2 MiB of payload per blob.
const BLOB_CONTENT_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    pub blob: String,
    pub collection: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub head: String,
    pub link: Option<String>,
    pub parts: Vec<Part>,
    pub vv: BTreeMap<String, u64>,
}

/// Counts merged or uploaded batch bytes toward the next snapshot of `link`. The first call for a
/// link starts its age.
pub async fn note_merged(pool: &SqlitePool, link: &str, bytes: usize) -> Result<()> {
    sqlx::query(
        "INSERT INTO sync2_snapshots (link, written_ms, merged_bytes) VALUES (?, ?, ?)
         ON CONFLICT (link) DO UPDATE SET merged_bytes = merged_bytes + excluded.merged_bytes",
    )
    .bind(link)
    .bind(now_ms())
    .bind(i64::try_from(bytes).unwrap_or(i64::MAX))
    .execute(pool)
    .await
    .map_err(SyncError::from)?;
    Ok(())
}

pub async fn snapshot_due(pool: &SqlitePool, link: &str) -> Result<bool> {
    let row: Option<(i64, i64)> =
        sqlx::query_as("SELECT written_ms, merged_bytes FROM sync2_snapshots WHERE link = ?")
            .bind(link)
            .fetch_optional(pool)
            .await
            .map_err(SyncError::from)?;
    Ok(row
        .is_some_and(|(written, merged)| merged > MERGED_LIMIT || now_ms() - written >= MAX_AGE_MS))
}

/// After this device removed another, its next sync writes a snapshot under the new epoch.
pub async fn snapshot_soon(pool: &SqlitePool) -> Result<()> {
    sqlx::query("UPDATE sync2_snapshots SET written_ms = 0")
        .execute(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(())
}

async fn snapshot_written(pool: &SqlitePool, link: &str) -> Result<()> {
    sqlx::query("UPDATE sync2_snapshots SET written_ms = ?, merged_bytes = 0 WHERE link = ?")
        .bind(now_ms())
        .bind(link)
        .execute(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(())
}

/// Splits records into blob-sized groups.
fn chunks(ndjson: &[u8]) -> Vec<Vec<&[u8]>> {
    let mut chunks: Vec<Vec<&[u8]>> = Vec::new();
    let mut size = 0;
    for line in ndjson.split(|&b| b == b'\n').filter(|l| !l.is_empty()) {
        match chunks.last_mut() {
            Some(chunk) if size + line.len() < BLOB_CONTENT_LIMIT => chunk.push(line),
            _ => {
                chunks.push(vec![line]);
                size = 0;
            }
        }
        size += line.len() + 1;
    }
    chunks
}

impl<S: Store> Session<'_, S> {
    /// Writes `exported`, the whole state of this link, as blobs and then a manifest naming the
    /// last object of every log merged into it.
    pub async fn write_snapshot(
        &mut self,
        pool: &SqlitePool,
        exported: Vec<OutgoingCollection>,
    ) -> Result<()> {
        let group = *self.group();
        let epoch = self.roster().epoch;
        let did = self.device().did;
        let link = self.record().link.clone();
        let head = self.roster().head.clone();
        let key = purpose_key(
            self.current_key(),
            &group,
            epoch,
            ObjectType::Snapshot.purpose(),
        );
        let mut parts = Vec::new();
        for collection in exported {
            for records in chunks(&collection.ndjson) {
                let content = batch_content(collection.collection, &head, &link, &records);
                let blob = seal_blob(&key, &group, epoch, &did, &encode_payload(&content)?);
                let name = hex::encode(sha256(&blob));
                parts.push(Part {
                    blob: name.clone(),
                    collection: collection.collection.key().to_owned(),
                    size: blob.len() as u64,
                });
                self.store()
                    .put_object(&blob_path(&hex::encode(did), &name), blob)
                    .await?;
            }
        }
        let mut vv: BTreeMap<String, u64> = streams(pool)
            .await?
            .into_iter()
            .map(|(sender, position)| (sender, position.seq))
            .collect();
        vv.insert(
            hex::encode(did),
            u64::try_from(self.record().own_seq).unwrap_or(0),
        );
        let manifest = Manifest {
            head,
            link: Some(link.clone()),
            parts,
            vv,
        };
        self.write(pool, ObjectType::Snapshot, &to_canonical_json(&manifest))
            .await?;
        snapshot_written(pool, &link).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_are_split_below_the_blob_limit() {
        let record = vec![b'x'; BLOB_CONTENT_LIMIT / 3];
        let ndjson = [record.as_slice(); 7].join(&b'\n');
        let chunks = chunks(&ndjson);
        assert_eq!(chunks.iter().map(Vec::len).sum::<usize>(), 7);
        assert!(chunks.iter().all(|c| c.len() == 2 || c.len() == 1));
    }
}
