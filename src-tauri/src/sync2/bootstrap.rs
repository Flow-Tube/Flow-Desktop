//! Starting a device that has read nothing from snapshots (spec/protocol.md, Reading a link from
//! its snapshot), once garbage collection has removed the beginning of some logs. Each log goes on
//! from the lowest object the snapshots name, chained to its hash.

use std::collections::{BTreeMap, BTreeSet};

use super::batches::{IncomingBatch, parse_batch};
use super::blob::open_blob;
use super::engine::{Content, EngineError, Result, Session, contained};
use super::envelope::{ObjectType, ParsedObject, StreamPosition};
use super::epoch::purpose_key;
use super::paths::{blob_path, log_path, parse_log_path};
use super::payload::decode_payload;
use super::read_budget::ReadBudget;
use super::server::StoreError;
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

/// Snapshots looked at per link in each log, newest first: the newest, and the one before, which
/// garbage collection keeps until every device acked the newer one (spec/protocol.md).
const SNAPSHOTS_PER_LINK: usize = 2;

/// Per link, and `profiles` as `Some(None)`, the covering snapshots: writer, seq and epoch.
/// Without links to look for, the snapshots of any link, as `None`.
type Candidates = BTreeMap<Option<Option<String>>, Vec<(String, u64, u32, Manifest)>>;

/// How many objects of all logs the snapshot includes.
pub(super) fn merged(manifest: &Manifest) -> u64 {
    manifest
        .vv
        .values()
        .fold(0, |sum, tip| sum.saturating_add(tip.seq))
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
        .all(|(did, seq)| manifest.vv.get(did).is_some_and(|tip| tip.seq >= *seq - 1))
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
        let mut budget = ReadBudget::default();
        loop {
            let (changes, next) = self.store().changes(cursor).await?;
            for (did, seq) in changes.iter().filter_map(|c| parse_log_path(&c.path)) {
                logs.entry(did).or_default().push(seq);
            }
            // A cursor that doesn't move would hand out the same page forever.
            if changes.is_empty() || next <= cursor {
                break;
            }
            // A partial list could pick a snapshot that doesn't cover the logs left out.
            if !budget.take(changes.len()) {
                return Err(StoreError::TooLong.into());
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

        let mut candidates: Candidates = BTreeMap::new();
        for (did, seqs) in &mut logs {
            seqs.sort_unstable();
            for (seq, epoch, manifest) in self.manifests_from_newest(did, seqs, links).await? {
                let key = match (links, &manifest.link) {
                    (None, Some(_)) => None,
                    (Some(links), Some(link)) if !links.contains(link) => continue,
                    (Some(_), link) => Some(link.clone()),
                    (None, None) => continue,
                };
                if covers(&manifest, &first) {
                    candidates
                        .entry(key)
                        .or_default()
                        .push((did.clone(), seq, epoch, manifest));
                }
            }
        }
        let mut snapshots = Vec::new();
        for mut found in candidates.into_values() {
            found.sort_by_key(|(_, _, _, manifest)| std::cmp::Reverse(merged(manifest)));
            for (writer, seq, epoch, manifest) in found {
                let batches = self.snapshot_batches(&writer, epoch, &manifest).await;
                if let Some(batches) = contained(batches)? {
                    snapshots.push(Snapshot {
                        writer,
                        seq,
                        manifest,
                        batches,
                    });
                    break;
                }
            }
        }
        if snapshots.is_empty() {
            return Ok(None);
        }
        let chosen: Vec<&Manifest> = snapshots.iter().map(|s| &s.manifest).collect();
        let positions = lowest_tips(&chosen, &me)?;
        Ok(Some(Start {
            snapshots,
            positions,
        }))
    }

    /// Up to [`SNAPSHOTS_PER_LINK`] newest snapshot manifests of each of `links` and of `profiles`
    /// in `did`'s log (of any link when `None`): where each sits and the epoch it was written in.
    async fn manifests_from_newest(
        &mut self,
        did: &str,
        seqs: &[u64],
        links: Option<&BTreeSet<String>>,
    ) -> Result<Vec<(u64, u32, Manifest)>> {
        let wanted = links.map_or(1, |links| links.len() + 1) * SNAPSHOTS_PER_LINK;
        let mut found: Vec<(u64, u32, Manifest)> = Vec::new();
        for &seq in seqs.iter().rev() {
            if found.len() >= wanted {
                break;
            }
            let path = log_path(did, seq);
            let Some(bytes) = self.store().get_object(&path).await? else {
                continue;
            };
            let read = async {
                let object = self.verified_copy(&bytes, &path, did, seq).await?;
                if object.header.object_type != ObjectType::Snapshot {
                    return Ok(None);
                }
                self.check_manifest_chain(did, &object).await?;
                let content = self.open_content(&object).await?;
                Ok(Some((object.header.epoch, content)))
            };
            if let Some((epoch, Content::Snapshot(manifest))) = contained(read.await)?.flatten()
                && found
                    .iter()
                    .filter(|(_, _, m)| m.link == manifest.link)
                    .count()
                    < SNAPSHOTS_PER_LINK
            {
                found.push((seq, epoch, manifest));
            }
        }
        Ok(found)
    }

    /// A removed sender's manifest counts only if the walk down from its cut reaches it.
    async fn check_manifest_chain(&self, did: &str, object: &ParsedObject<'_>) -> Result<()> {
        if self
            .roster()
            .senders
            .get(did)
            .is_none_or(|s| s.until.is_none())
        {
            return Ok(());
        }
        let seq = object.header.seq;
        let walk = self.walk_cut(did, seq - 1, None).await?;
        if walk.get(&seq) == Some(&object.hash) {
            Ok(())
        } else {
            Err(Error::Prev.into())
        }
    }

    pub(super) async fn snapshot_batches(
        &mut self,
        writer: &str,
        epoch: u32,
        manifest: &Manifest,
    ) -> Result<Vec<IncomingBatch>> {
        let writer_id = hex::decode(writer).map_err(|_| Error::Sender)?;
        let group = *self.group();
        let mut batches = Vec::new();
        for part in &manifest.parts {
            let path = blob_path(writer, &part.blob);
            let blob = self
                .store()
                .get_object(&path)
                .await?
                .ok_or(Error::BlobHash)?;
            let hash = hex::decode(&part.blob).map_err(|_| Error::BlobHash)?;
            let payload = self
                .open_under(epoch, |key| {
                    let key = purpose_key(key, &group, epoch, ObjectType::Snapshot.purpose());
                    open_blob(&key, &group, epoch, &writer_id, &blob, &hash)
                })
                .await;
            match &payload {
                Ok(_) => self.store().keep_object(&path, &blob).await?,
                Err(EngineError::Protocol(_)) => self.store().drop_object(&path).await?,
                Err(_) => {}
            }
            let payload = payload?;
            batches.push(parse_batch(&decode_payload(&payload)?)?);
        }
        Ok(batches)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(tips: &[(&str, u64)]) -> Manifest {
        let tip = |seq| Tip {
            hash: String::new(),
            seq,
        };
        Manifest {
            head: String::new(),
            link: None,
            parts: Vec::new(),
            vv: tips
                .iter()
                .map(|(d, s)| ((*d).to_owned(), tip(*s)))
                .collect(),
        }
    }

    #[test]
    fn a_count_of_merged_objects_stops_at_the_largest_seq() {
        assert_eq!(merged(&manifest(&[("a", u64::MAX), ("b", 1)])), u64::MAX);
    }

    #[test]
    fn a_snapshot_at_the_largest_seq_covers_its_log() {
        let first = BTreeMap::from([("a".to_owned(), u64::MAX)]);
        assert!(covers(&manifest(&[("a", u64::MAX)]), &first));
    }
}
