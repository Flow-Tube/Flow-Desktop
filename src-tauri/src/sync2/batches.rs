//! Change batches (spec/protocol.md, Change batches): the records of one collection that changed
//! since this device last uploaded them, in the FLOW-SYNC/1 canonical form, so the existing
//! export and the existing transactional apply do the real work.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::sync::apply::{ApplyReport, apply_stream_payload};
use crate::sync::canonical::{Collection, to_canonical_json};
use crate::sync::codec::sha256_hex;
use crate::sync::error::SyncError;
use crate::sync::export::export_collections;
use crate::sync::frames::collection_from_key;
use crate::sync::protocol::{OutgoingCollection, StagedCollection};

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
    sent: Vec<Sent>,
    now_ms: i64,
}

/// A record as uploaded or received: its link, collection, key and hash.
type Sent = (String, Collection, String, String);

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
    link: &str,
    collection: Collection,
) -> Result<BTreeMap<String, (String, i64)>, SyncError> {
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT record_key, hash, sent_at FROM sync2_sent_links WHERE link = ? AND collection = ?",
    )
    .bind(link)
    .bind(collection.key())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(key, hash, at)| (key, (hash, at)))
        .collect())
}

/// A header line and then the records, one per line: the format of change batches and of
/// snapshot blobs.
pub fn batch_content(
    collection: Collection,
    head: &str,
    link: &str,
    records: &[impl AsRef<[u8]>],
) -> Vec<u8> {
    let header = BatchHeader {
        collection: collection.key().to_owned(),
        head: head.to_owned(),
        link: Some(link.to_owned()),
    };
    let mut content = to_canonical_json(&header);
    for record in records {
        content.push(b'\n');
        content.extend_from_slice(record.as_ref());
    }
    content
}

/// Keeps the exported records whose canonical form changed since the last upload. `head` is this
/// device's roster head, `link` the profile link id, `now_ms` the time.
pub async fn outgoing_batches(
    pool: &SqlitePool,
    exported: Vec<OutgoingCollection>,
    head: &str,
    link: &str,
    now_ms: i64,
) -> Result<Outgoing, SyncError> {
    let mut outgoing = Outgoing {
        now_ms,
        ..Outgoing::default()
    };
    for exported in exported {
        let collection = exported.collection;
        let sent = sent_hashes(pool, link, collection).await?;
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
                outgoing.sent.push((link.to_owned(), collection, key, hash));
            }
        }
        for records in changed.chunks(RECORDS_PER_BATCH) {
            outgoing.batches.push(Batch {
                collection,
                content: batch_content(collection, head, link, records),
            });
        }
    }
    Ok(outgoing)
}

/// Records what was uploaded; call only after every batch reached the store.
pub async fn mark_sent(pool: &SqlitePool, outgoing: &Outgoing) -> Result<(), SyncError> {
    remember(pool, &outgoing.sent, outgoing.now_ms).await
}

/// The record of what was sent is the device's, in Default's database like the rest of the group's
/// state, while `pool` may be the running profile's.
async fn remember(pool: &SqlitePool, records: &[Sent], now_ms: i64) -> Result<(), SyncError> {
    let mut tx = crate::db::device::pool(pool).begin().await?;
    for (link, collection, key, hash) in records {
        sqlx::query("INSERT INTO sync2_sent_links (link, collection, record_key, hash, sent_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (link, collection, record_key) DO UPDATE SET hash = excluded.hash, sent_at = excluded.sent_at")
            .bind(link)
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
    /// The batch's length in bytes, which counts toward the next snapshot.
    pub size: usize,
    records: Vec<u8>,
}

impl IncomingBatch {
    /// A batch this device kept for a profile that wasn't running, read back.
    pub(super) fn kept(collection: &str, link: String, head: String, records: Vec<u8>) -> Self {
        Self {
            collection: collection_from_key(collection),
            link: Some(link),
            head,
            size: records.len(),
            records,
        }
    }

    pub(super) fn records(&self) -> &[u8] {
        &self.records
    }
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
        size: content.len(),
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
    let mut received: BTreeMap<(&str, String), BTreeSet<&str>> = BTreeMap::new();
    for batch in batches {
        let (Some(collection), Some(link)) = (batch.collection, batch.link.as_deref()) else {
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
                received
                    .entry((collection.key(), key))
                    .or_default()
                    .insert(link);
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
    let report = apply_stream_payload(pool, our_device_id, sender, &staged).await?;
    // Another app writes the same record in its own canonical form, so what counts as sent is this
    // device's export of each received record, or the next push would send it straight back.
    let mut collections: Vec<Collection> = Vec::new();
    for collection in staged.iter().map(|s| s.collection) {
        if !collections.contains(&collection) {
            collections.push(collection);
        }
    }
    let exported = export_collections(pool, our_device_id, &collections).await?;
    let mut known = Vec::new();
    for exported in exported {
        let collection = exported.collection;
        for line in exported
            .ndjson
            .split(|&b| b == b'\n')
            .filter(|l| !l.is_empty())
        {
            let record: Value = serde_json::from_slice(line)?;
            let Some(key) = record_key(collection, &record) else {
                continue;
            };
            let Some(links) = received.get(&(collection.key(), key.clone())) else {
                continue;
            };
            let hash = record_hash(collection, &record, line);
            for link in links {
                known.push(((*link).to_owned(), collection, key.clone(), hash.clone()));
            }
        }
    }
    remember(pool, &known, now_ms).await?;
    Ok(report)
}
