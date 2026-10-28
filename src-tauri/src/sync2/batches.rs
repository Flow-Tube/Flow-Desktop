//! Change batches (spec/protocol.md, Change batches): the records of one collection that changed
//! since this device last uploaded them, in the FLOW-SYNC/1 canonical form, so the existing
//! export and the existing transactional apply do the real work.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::sync::apply::{ApplyReport, apply_payload};
use crate::sync::canonical::{Collection, to_canonical_json};
use crate::sync::codec::sha256_hex;
use crate::sync::error::SyncError;
use crate::sync::export::export_collections;
use crate::sync::frames::collection_from_key;
use crate::sync::protocol::StagedCollection;

/// FLOW-SYNC/1's chunk size; it keeps every batch well under the 4 MiB object limit.
const RECORDS_PER_BATCH: usize = 1000;
/// The brains change with every video watched; spec/protocol.md asks for at most one upload in 6 hours.
const BRAIN_INTERVAL_MS: i64 = 6 * 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchHeader {
    collection: String,
    head: String,
    link: Option<String>,
}

/// One batch, ready to be encoded as a payload and sealed in a change object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    pub collection: Collection,
    pub content: Vec<u8>,
}

/// Batches to upload, plus the hashes to record once the upload succeeded.
#[derive(Debug, Default)]
pub struct Outgoing {
    pub batches: Vec<Batch>,
    sent: Vec<(Collection, String, String)>,
    now_ms: i64,
}

fn record_key(collection: Collection, record: &Value) -> Option<String> {
    let field = |name: &str| record.get(name)?.as_str().map(str::to_owned);
    match collection {
        Collection::WatchHistory => field("videoId"),
        Collection::Likes => Some(format!("{}:{}", field("kind")?, field("id")?)),
        Collection::Playlists => field("syncId"),
        Collection::Settings => field("key"),
        Collection::Subscriptions => field("name"),
        Collection::SubscribedChannels => field("channelId"),
        Collection::FlowNeuroBrain | Collection::MusicBrain => Some(String::new()),
    }
}

fn is_brain(collection: Collection) -> bool {
    matches!(
        collection,
        Collection::FlowNeuroBrain | Collection::MusicBrain
    )
}

/// A brain record carries the time it was exported, which says nothing about its content.
fn record_hash(collection: Collection, record: &Value, line: &[u8]) -> String {
    match record {
        Value::Object(fields) if is_brain(collection) => {
            let content: serde_json::Map<String, Value> = fields
                .iter()
                .filter(|(name, _)| *name != "hlc")
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            sha256_hex(&to_canonical_json(&content))
        }
        _ => sha256_hex(line),
    }
}

async fn sent_hashes(
    pool: &SqlitePool,
    collection: Collection,
) -> Result<BTreeMap<String, (String, i64)>, SyncError> {
    let rows: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT record_key, hash, sent_at FROM sync2_sent WHERE collection = ?")
            .bind(collection.key())
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(key, hash, at)| (key, (hash, at)))
        .collect())
}

/// Exports `collections` and keeps the records whose canonical form changed since the last
/// upload. `head` is this device's roster head, `link` the profile link id, `now_ms` the time.
pub async fn outgoing_batches(
    pool: &SqlitePool,
    device_id: &str,
    collections: &[Collection],
    head: &str,
    link: &str,
    now_ms: i64,
) -> Result<Outgoing, SyncError> {
    let mut outgoing = Outgoing {
        now_ms,
        ..Outgoing::default()
    };
    for exported in export_collections(pool, device_id, collections).await? {
        let collection = exported.collection;
        let sent = sent_hashes(pool, collection).await?;
        let mut changed = Vec::new();
        for line in exported
            .ndjson
            .split(|&b| b == b'\n')
            .filter(|l| !l.is_empty())
        {
            let record: Value = serde_json::from_slice(line)?;
            let Some(key) = record_key(collection, &record) else {
                continue;
            };
            let hash = record_hash(collection, &record, line);
            let previous = sent.get(&key);
            let too_soon = is_brain(collection)
                && previous.is_some_and(|(_, at)| now_ms - at < BRAIN_INTERVAL_MS);
            if previous.map(|(h, _)| h) != Some(&hash) && !too_soon {
                changed.push(line.to_vec());
                outgoing.sent.push((collection, key, hash));
            }
        }
        let header = BatchHeader {
            collection: collection.key().to_owned(),
            head: head.to_owned(),
            link: Some(link.to_owned()),
        };
        for records in changed.chunks(RECORDS_PER_BATCH) {
            let content = [to_canonical_json(&header), records.join(&b'\n')].join(&b'\n');
            outgoing.batches.push(Batch {
                collection,
                content,
            });
        }
    }
    Ok(outgoing)
}

/// Records what was uploaded; call only after every batch reached the store.
pub async fn mark_sent(pool: &SqlitePool, outgoing: &Outgoing) -> Result<(), SyncError> {
    remember(pool, &outgoing.sent, outgoing.now_ms).await
}

async fn remember(
    pool: &SqlitePool,
    records: &[(Collection, String, String)],
    now_ms: i64,
) -> Result<(), SyncError> {
    let mut tx = pool.begin().await?;
    for (collection, key, hash) in records {
        sqlx::query("INSERT INTO sync2_sent (collection, record_key, hash, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT (collection, record_key) DO UPDATE SET hash = excluded.hash, sent_at = excluded.sent_at")
            .bind(collection.key())
            .bind(key)
            .bind(hash)
            .bind(now_ms)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// A batch read back: its collection (when this build knows it), link and records.
pub struct IncomingBatch {
    pub collection: Option<Collection>,
    pub link: Option<String>,
    pub head: String,
    records: Vec<u8>,
}

pub fn parse_batch(content: &[u8]) -> Result<IncomingBatch, SyncError> {
    let (header, records) = content.split_at(
        content
            .iter()
            .position(|&b| b == b'\n')
            .unwrap_or(content.len()),
    );
    let header: BatchHeader = serde_json::from_slice(header)?;
    Ok(IncomingBatch {
        collection: collection_from_key(&header.collection),
        link: header.link,
        head: header.head,
        records: records.strip_prefix(b"\n").unwrap_or(records).to_vec(),
    })
}

/// Applies batches from one sender in one transaction, through the FLOW-SYNC/1 merges. Batches of
/// collections this build doesn't know (Android's `notes`) are consumed without effect. Applied
/// records count as known to the group, so this device doesn't send them back unchanged.
pub async fn apply_batches(
    pool: &SqlitePool,
    our_device_id: &str,
    sender: &str,
    batches: &[IncomingBatch],
    now_ms: i64,
) -> Result<ApplyReport, SyncError> {
    let mut staged = Vec::new();
    let mut known = Vec::new();
    for batch in batches {
        let Some(collection) = batch.collection else {
            continue;
        };
        let lines: Vec<&[u8]> = batch
            .records
            .split(|&b| b == b'\n')
            .filter(|l| !l.is_empty())
            .collect();
        for line in &lines {
            let record: Value = serde_json::from_slice(line)?;
            if let Some(key) = record_key(collection, &record) {
                known.push((collection, key, record_hash(collection, &record, line)));
            }
        }
        let ndjson = lines.join(&b'\n');
        staged.push(StagedCollection {
            collection,
            hash: sha256_hex(&ndjson),
            record_count: lines.len() as u64,
            ndjson,
        });
    }
    let report = apply_payload(pool, our_device_id, sender, &staged).await?;
    remember(pool, &known, now_ms).await?;
    Ok(report)
}
