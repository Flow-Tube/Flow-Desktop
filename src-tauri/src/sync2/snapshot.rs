//! Snapshots (spec/protocol.md, Snapshots): the merged state of a link as sealed blobs, listed by
//! a manifest in the writer's log, so new devices and garbage collection don't need old logs.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use sqlx::SqlitePool;

use super::batches::batch_content;
use super::blob::seal_blob;
use super::engine::{Result, Session, now_ms};
use super::envelope::ObjectType;
use super::epoch::purpose_key;
use super::gc::{Logged, bounded_seq, manifests, record_manifest};
use super::kdf::sha256;
use super::paths::blob_path;
use super::payload::encode_payload;
use super::profile_names::{self, PROFILES};
use super::state::streams;
use super::store::Store;
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;
use crate::sync::protocol::OutgoingCollection;

const MERGED_LIMIT: i64 = 1024 * 1024;
/// How the `profiles` collection is named among links in this device's snapshot records.
pub const PROFILES_KEY: &str = "";
const MAX_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// spec/store.md asks for at most 2 MiB of payload per blob.
const BLOB_CONTENT_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Part {
    #[serde(deserialize_with = "blob_name")]
    pub blob: String,
    pub collection: String,
    pub size: u64,
}

/// A blob's name is the hex of its SHA-256 (spec/store.md, Snapshot blobs). It becomes a store path.
fn blob_name<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<String, D::Error> {
    let name = String::deserialize(deserializer)?;
    let valid = name.len() == 64 && name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    valid
        .then_some(name)
        .ok_or_else(|| serde::de::Error::custom("not a blob name"))
}

/// The last object of a log that a snapshot includes, so reading can go on from it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tip {
    pub hash: String,
    #[serde(deserialize_with = "bounded_seq")]
    pub seq: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub head: String,
    pub link: Option<String>,
    pub parts: Vec<Part>,
    pub vv: BTreeMap<String, Tip>,
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

/// When this device wrote the snapshot of `link` it still keeps, if it wrote one.
pub async fn own_snapshot_ms(pool: &SqlitePool, me: &str, link: &str) -> Result<Option<i64>> {
    let own = manifests(pool)
        .await?
        .iter()
        .any(|logged| logged.did == me && logged.manifest.link.as_deref() == Some(link));
    if !own {
        return Ok(None);
    }
    let written: Option<i64> =
        sqlx::query_scalar("SELECT written_ms FROM sync2_snapshots WHERE link = ?")
            .bind(link)
            .fetch_optional(pool)
            .await
            .map_err(SyncError::from)?;
    // Zero asks for a snapshot soon, after a removal; it says nothing about the last one.
    Ok(written.filter(|ms| *ms > 0))
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
    sqlx::query(
        "INSERT INTO sync2_snapshots (link, written_ms, merged_bytes) VALUES (?, ?, 0)
         ON CONFLICT (link) DO UPDATE SET written_ms = excluded.written_ms, merged_bytes = 0",
    )
    .bind(link)
    .bind(now_ms())
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
    /// Writes `exported`, the whole state of the running profile's link, as blobs and then a
    /// manifest naming the last object of every log merged into it. The caller first applies
    /// every batch kept for that link.
    pub async fn write_snapshot(
        &mut self,
        pool: &SqlitePool,
        exported: Vec<OutgoingCollection>,
    ) -> Result<()> {
        let Some(link) = self.reading().active.clone() else {
            return Ok(());
        };
        if self.roster().recovery_due {
            return Ok(());
        }
        let collections = exported
            .iter()
            .map(|c| (c.collection.key(), c.ndjson.as_slice()))
            .collect();
        self.write_snapshot_of(pool, Some(link), collections).await
    }

    /// Writes the `profiles` collection as a snapshot of its own.
    pub async fn write_profiles_snapshot(&mut self, pool: &SqlitePool) -> Result<()> {
        if self.roster().recovery_due {
            return Ok(());
        }
        let ndjson = profile_names::ndjson(pool).await?;
        self.write_snapshot_of(pool, None, vec![(PROFILES, ndjson.as_slice())])
            .await
    }

    async fn write_snapshot_of(
        &mut self,
        pool: &SqlitePool,
        link: Option<String>,
        collections: Vec<(&str, &[u8])>,
    ) -> Result<()> {
        self.may_seal()?;
        let group = *self.group();
        let epoch = self.roster().epoch;
        let did = self.device().did;
        let head = self.roster().head.clone();
        let key = purpose_key(
            self.current_key(),
            &group,
            epoch,
            ObjectType::Snapshot.purpose(),
        );
        let mut parts = Vec::new();
        for (collection, ndjson) in collections {
            for records in chunks(ndjson) {
                let content = batch_content(collection, &head, link.as_deref(), &records);
                let blob = seal_blob(&key, &group, epoch, &did, &encode_payload(&content)?);
                let name = hex::encode(sha256(&blob));
                parts.push(Part {
                    blob: name.clone(),
                    collection: collection.to_owned(),
                    size: blob.len() as u64,
                });
                self.store()
                    .put_object(&blob_path(&hex::encode(did), &name), blob)
                    .await?;
            }
        }
        let mut vv: BTreeMap<String, Tip> = streams(pool)
            .await?
            .into_iter()
            .map(|(sender, position)| {
                let tip = Tip {
                    hash: hex::encode(position.hash),
                    seq: position.seq,
                };
                (sender, tip)
            })
            .collect();
        vv.insert(
            hex::encode(did),
            Tip {
                hash: self.record().own_prev.clone(),
                seq: u64::try_from(self.record().own_seq).unwrap_or(0),
            },
        );
        let manifest = Manifest {
            head,
            link: link.clone(),
            parts,
            vv,
        };
        self.write(pool, ObjectType::Snapshot, &to_canonical_json(&manifest))
            .await?;
        let logged = Logged {
            did: hex::encode(did),
            seq: u64::try_from(self.record().own_seq).unwrap_or(0),
            manifest,
        };
        record_manifest(pool, &logged).await?;
        snapshot_written(pool, link.as_deref().unwrap_or(PROFILES_KEY)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_naming_a_seq_above_2_53_is_refused() {
        let manifest = |seq: u64| {
            serde_json::from_str::<Manifest>(&format!(
                r#"{{"head":"","link":null,"parts":[],"vv":{{"a":{{"hash":"","seq":{seq}}}}}}}"#
            ))
        };
        assert!(manifest((1 << 53) - 1).is_ok());
        assert!(manifest(1 << 53).is_err());
    }

    #[test]
    fn a_manifest_names_blobs_only_by_their_hash() {
        let manifest = |blob: &str| {
            serde_json::from_str::<Manifest>(&format!(
                r#"{{"head":"","link":null,"parts":[{{"blob":"{blob}","collection":"c","size":1}}],"vv":{{}}}}"#
            ))
        };
        assert!(manifest(&"a1".repeat(32)).is_ok());
        for blob in [
            "",
            "ab",
            "../x",
            &"A1".repeat(32),
            &"g1".repeat(32),
            &"a1".repeat(33),
        ] {
            assert!(manifest(blob).is_err(), "{blob}");
        }
    }

    #[test]
    fn records_are_split_below_the_blob_limit() {
        let record = vec![b'x'; BLOB_CONTENT_LIMIT / 3];
        let ndjson = [record.as_slice(); 7].join(&b'\n');
        let chunks = chunks(&ndjson);
        assert_eq!(chunks.iter().map(Vec::len).sum::<usize>(), 7);
        assert!(chunks.iter().all(|c| c.len() == 2 || c.len() == 1));
    }
}
