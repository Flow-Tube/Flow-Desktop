//! Starting a device that has read nothing from a snapshot (spec/protocol.md, Snapshots), once
//! garbage collection has removed the beginning of some logs.

use std::collections::BTreeMap;

use super::Error;
use super::batches::{IncomingBatch, parse_batch};
use super::blob::open_blob;
use super::engine::{Content, Result, Session};
use super::envelope::{ObjectType, StreamPosition};
use super::epoch::purpose_key;
use super::paths::{blob_path, log_path, parse_log_path};
use super::payload::decode_payload;
use super::snapshot::Manifest;
use super::store::Store;

/// The snapshot a device starts from: its writer, its records, and where each log goes on.
pub struct Start {
    pub writer: String,
    pub manifest: Manifest,
    pub batches: Vec<IncomingBatch>,
    pub positions: BTreeMap<String, StreamPosition>,
}

/// Whether `manifest` covers every log that no longer starts at its first object.
fn covers(manifest: &Manifest, first: &BTreeMap<String, u64>) -> bool {
    first.iter().filter(|(_, seq)| **seq > 1).all(|(did, seq)| {
        manifest
            .vv
            .get(did)
            .is_some_and(|merged| merged + 1 >= *seq)
    })
}

impl<S: Store> Session<'_, S> {
    /// The snapshot to start from, or `None` when every log still starts at its first object, or
    /// when no snapshot covers the logs that don't.
    pub(super) async fn bootstrap(&mut self) -> Result<Option<Start>> {
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

        let mut best: Option<(String, u32, Manifest)> = None;
        for (did, seqs) in &mut logs {
            seqs.sort_unstable();
            if let Some((epoch, manifest)) = self.newest_manifest(did, seqs).await?
                && covers(&manifest, &first)
                && best.as_ref().is_none_or(|(_, _, b)| {
                    b.vv.values().sum::<u64>() < manifest.vv.values().sum::<u64>()
                })
            {
                best = Some((did.clone(), epoch, manifest));
            }
        }
        let Some((writer, epoch, manifest)) = best else {
            return Ok(None);
        };
        let batches = self.snapshot_batches(&writer, epoch, &manifest).await?;
        let positions = manifest
            .vv
            .iter()
            .filter(|(did, _)| **did != me)
            .map(|(did, seq)| (did.clone(), StreamPosition::after_snapshot(*seq)))
            .collect();
        Ok(Some(Start {
            writer,
            manifest,
            batches,
            positions,
        }))
    }

    /// The newest snapshot manifest in `did`'s log, searched from its last object back, and the
    /// epoch it was written in.
    async fn newest_manifest(
        &mut self,
        did: &str,
        seqs: &[u64],
    ) -> Result<Option<(u32, Manifest)>> {
        for &seq in seqs.iter().rev() {
            let Some(bytes) = self.store().get_object(&log_path(did, seq)).await? else {
                continue;
            };
            let object = self.verified(&bytes, did, seq)?;
            if object.header.object_type != ObjectType::Snapshot {
                continue;
            }
            if let Content::Snapshot(manifest) = self.open_content(&object).await? {
                return Ok(Some((object.header.epoch, manifest)));
            }
        }
        Ok(None)
    }

    async fn snapshot_batches(
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
