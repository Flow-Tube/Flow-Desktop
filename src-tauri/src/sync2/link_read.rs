//! Reading a link from its snapshot (spec/protocol.md), for a profile that joins a link this
//! device hasn't been reading: the link's newest snapshot, then its batches in each log up to
//! where this device had read.

use sqlx::SqlitePool;

use super::bootstrap::{merged, position};
use super::engine::{Content, Result, Session};
use super::envelope::{StreamPosition, next_in_stream};
use super::gc::{Logged, manifests};
use super::kept::Kept;
use super::paths::log_path;
use super::state::{Floors, streams};
use super::store::Store;

/// What was read of a link: its batches, oldest first, and where its snapshot stops including
/// each sender's.
pub struct LinkRead {
    pub batches: Vec<Kept>,
    pub floors: Floors,
}

impl<S: Store> Session<'_, S> {
    /// Reads `link` up to where this device has read the other logs; `None` while an object is
    /// still missing from the store.
    pub async fn read_link(&mut self, pool: &SqlitePool, link: &str) -> Result<Option<LinkRead>> {
        let me = hex::encode(self.device().did);
        let mut read = LinkRead {
            batches: Vec::new(),
            floors: Floors::new(),
        };
        let start = self.newest_snapshot(pool, link).await?;
        let tips = start
            .as_ref()
            .map(|(logged, _)| logged.manifest.vv.clone())
            .unwrap_or_default();
        if let Some((logged, epoch)) = start {
            let batches = self
                .snapshot_batches(&logged.did, epoch, &logged.manifest)
                .await?;
            for (part, batch) in (1..).zip(batches) {
                read.batches
                    .push(kept(link, &logged.did, logged.seq, part, batch));
            }
        }
        for (did, reached) in streams(pool).await?.iter().filter(|(did, _)| **did != me) {
            let mut last: Option<StreamPosition> = tips.get(did).map(position).transpose()?;
            if let Some(tip) = &last {
                read.floors.insert((link.to_owned(), did.clone()), tip.seq);
            }
            let from = last.as_ref().map_or(1, |tip| tip.seq + 1);
            for seq in from..=reached.seq {
                let Some(bytes) = self.store().get_object(&log_path(did, seq)).await? else {
                    return Ok(None);
                };
                let object = self.verified(&bytes, did, seq)?;
                last = Some(next_in_stream(last.as_ref(), &object)?);
                if let Content::Batch(batch) = self.open_content(&object).await?
                    && batch.link.as_deref() == Some(link)
                {
                    read.batches.push(kept(link, did, seq, 0, batch));
                }
            }
        }
        Ok(Some(read))
    }

    /// The newest snapshot of `link` seen that is still in the store, and its epoch.
    async fn newest_snapshot(
        &mut self,
        pool: &SqlitePool,
        link: &str,
    ) -> Result<Option<(Logged, u32)>> {
        let mut candidates: Vec<Logged> = manifests(pool)
            .await?
            .into_iter()
            .filter(|logged| logged.manifest.link.as_deref() == Some(link))
            .collect();
        candidates.sort_by_key(|logged| std::cmp::Reverse(merged(&logged.manifest)));
        for logged in candidates {
            let Some(bytes) = self
                .store()
                .get_object(&log_path(&logged.did, logged.seq))
                .await?
            else {
                continue;
            };
            let epoch = self.verified(&bytes, &logged.did, logged.seq)?.header.epoch;
            return Ok(Some((logged, epoch)));
        }
        Ok(None)
    }
}

fn kept(
    link: &str,
    sender: &str,
    seq: u64,
    part: u32,
    batch: super::batches::IncomingBatch,
) -> Kept {
    Kept {
        link: link.to_owned(),
        sender: sender.to_owned(),
        seq,
        part,
        batch,
    }
}
