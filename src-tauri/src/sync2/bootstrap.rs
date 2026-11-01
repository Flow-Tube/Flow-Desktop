//! Starting a device that has read nothing from snapshots (spec/protocol.md, Reading a link from
//! its snapshot), once garbage collection has removed the beginning of some logs. Each log goes on
//! from the lowest object the snapshots name, chained to its hash.

use std::collections::{BTreeMap, BTreeSet};

use super::batches::{IncomingBatch, parse_batch};
use super::blob::open_blob;
use super::engine::{Content, Result, Session};
use super::envelope::{ObjectType, StreamPosition};
use super::epoch::purpose_key;
use super::paths::{blob_path, log_path, parse_log_path};
use super::payload::decode_payload;
use super::snapshot::{Manifest, Tip};
use super::store::Store;
use super::{Error, array};

/// A snapshot a device starts from: its writer, where it sits in the writer's log, and its
/// records.
pub struct Snapshot {
    pub writer: String,
    pub seq: u64,
    pub manifest: Manifest,
    pub batches: Vec<IncomingBatch>,
}

/// The snapshots a device starts from, one per link, and where each log goes on.
pub struct Start {
    pub snapshots: Vec<Snapshot>,
    pub positions: BTreeMap<String, StreamPosition>,
}

/// Per link, and `profiles` as `Some(None)`, the best covering snapshot: writer, seq and epoch.
/// Without links to look for, the one best snapshot of any link, as `None`.
type Best = BTreeMap<Option<Option<String>>, (String, u64, u32, Manifest)>;

/// How many objects of all logs the snapshot includes.
pub(super) fn merged(manifest: &Manifest) -> u64 {
    manifest.vv.values().map(|tip| tip.seq).sum()
}

/// Where each log goes on: right after the lowest object the snapshots include. A log one of them
/// doesn't name is read from its first object.
fn lowest_tips(manifests: &[&Manifest], me: &str) -> Result<BTreeMap<String, StreamPosition>> {
    let mut positions = BTreeMap::new();
    let dids: BTreeSet<&String> = manifests.iter().flat_map(|m| m.vv.keys()).collect();
    for did in dids.into_iter().filter(|did| *did != me) {
        let tips: Option<Vec<_>> = manifests.iter().map(|m| m.vv.get(did)).collect();
        let Some(tip) = tips.and_then(|tips| tips.into_iter().min_by_key(|tip| tip.seq)) else {
            continue;
        };
        positions.insert(did.clone(), position(tip)?);
    }
    Ok(positions)
}

/// The place in a log right after the object a snapshot names.
pub(super) fn position(tip: &Tip) -> Result<StreamPosition> {
    let hash = hex::decode(&tip.hash)
        .ok()
        .filter(|h| h.len() == 32)
        .ok_or(Error::Prev)?;
    Ok(StreamPosition {
        seq: tip.seq,
        hash: array(&hash),
    })
}

/// Whether `manifest` covers every log that no longer starts at its first object.
fn covers(manifest: &Manifest, first: &BTreeMap<String, u64>) -> bool {
    first
        .iter()
        .filter(|(_, seq)| **seq > 1)
        .all(|(did, seq)| manifest.vv.get(did).is_some_and(|tip| tip.seq + 1 >= *seq))
}

impl<S: Store> Session<'_, S> {
    /// The snapshots to start from, the newest covering one of each of `links` (of any link when
    /// `None`), or `None` when every log still starts at its first object, or when no snapshot
    /// covers the logs that don't.
    pub(super) async fn bootstrap(
        &mut self,
        links: Option<&BTreeSet<String>>,
    ) -> Result<Option<Start>> {
        let me = hex::encode(self.device().did);
        let mut logs: BTreeMap<String, Vec<u64>> = BTreeMap::new();
        let mut cursor = 0;
        loop {
            let (changes, next) = self.store().changes(cursor).await?;
            if changes.is_empty() {
                break;
            }
            for (did, seq) in changes.iter().filter_map(|c| parse_log_path(&c.path)) {
                logs.entry(did).or_default().push(seq);
            }
            cursor = next;
        }
        logs.remove(&me);
        let first: BTreeMap<String, u64> = logs
            .iter()
            .filter_map(|(did, seqs)| Some((did.clone(), *seqs.iter().min()?)))
            .collect();
        if first.values().all(|seq| *seq == 1) {
            return Ok(None);
        }

        let mut best: Best = BTreeMap::new();
        for (did, seqs) in &mut logs {
            seqs.sort_unstable();
            for (seq, epoch, manifest) in self.manifests_from_newest(did, seqs, links).await? {
                let key = match (links, &manifest.link) {
                    (None, Some(_)) => None,
                    (Some(links), Some(link)) if !links.contains(link) => continue,
                    (Some(_), link) => Some(link.clone()),
                    (None, None) => continue,
                };
                if covers(&manifest, &first)
                    && best
                        .get(&key)
                        .is_none_or(|(_, _, _, b)| merged(b) < merged(&manifest))
                {
                    best.insert(key, (did.clone(), seq, epoch, manifest));
                }
            }
        }
        if best.is_empty() {
            return Ok(None);
        }
        let chosen: Vec<&Manifest> = best.values().map(|(_, _, _, m)| m).collect();
        let positions = lowest_tips(&chosen, &me)?;
        let mut snapshots = Vec::new();
        for (writer, seq, epoch, manifest) in best.into_values() {
            let batches = self.snapshot_batches(&writer, epoch, &manifest).await?;
            snapshots.push(Snapshot {
                writer,
                seq,
                manifest,
                batches,
            });
        }
        Ok(Some(Start {
            snapshots,
            positions,
        }))
    }

    /// The newest snapshot manifest of each of `links` and of `profiles` in `did`'s log (only the
    /// newest of any link when `None`): where it sits and the epoch it was written in.
    async fn manifests_from_newest(
        &mut self,
        did: &str,
        seqs: &[u64],
        links: Option<&BTreeSet<String>>,
    ) -> Result<Vec<(u64, u32, Manifest)>> {
        let wanted = links.map_or(1, |links| links.len() + 1);
        let mut found: Vec<(u64, u32, Manifest)> = Vec::new();
        for &seq in seqs.iter().rev() {
            if found.len() >= wanted {
                break;
            }
            let Some(bytes) = self.store().get_object(&log_path(did, seq)).await? else {
                continue;
            };
            let object = self.verified(&bytes, did, seq)?;
            if object.header.object_type != ObjectType::Snapshot {
                continue;
            }
            if let Content::Snapshot(manifest) = self.open_content(&object).await?
                && found.iter().all(|(_, _, m)| m.link != manifest.link)
            {
                found.push((seq, object.header.epoch, manifest));
            }
        }
        Ok(found)
    }

    pub(super) async fn snapshot_batches(
        &mut self,
        writer: &str,
        epoch: u32,
        manifest: &Manifest,
    ) -> Result<Vec<IncomingBatch>> {
        let writer_id = hex::decode(writer).map_err(|_| Error::Sender)?;
        let key = purpose_key(
            &self.epoch_key(epoch).await?,
            self.group(),
            epoch,
            ObjectType::Snapshot.purpose(),
        );
        let mut batches = Vec::new();
        for part in &manifest.parts {
            let blob = self
                .store()
                .get_object(&blob_path(writer, &part.blob))
                .await?
                .ok_or(Error::BlobHash)?;
            let hash = hex::decode(&part.blob).map_err(|_| Error::BlobHash)?;
            let payload = open_blob(&key, self.group(), epoch, &writer_id, &blob, &hash)?;
            batches.push(parse_batch(&decode_payload(&payload)?)?);
        }
        Ok(batches)
    }
}
