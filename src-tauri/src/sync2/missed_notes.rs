//! Notes that reached this device before it could keep them. Builds without notes read other
//! devices' notes batches and dropped them, and those devices never send an unchanged note again,
//! so what the store still keeps is read once more: each device's newest snapshot of the link,
//! then its log up to where this device had read. Objects already collected are skipped: a note
//! only in those stays on the device that wrote it until it is edited or sent over FLOW-SYNC/1.

use sqlx::SqlitePool;

use super::engine::{Content, Result, Session, contained};
use super::gc::{Logged, manifests};
use super::kept::Kept;
use super::paths::log_path;
use super::snapshot::Manifest;
use super::state::streams;
use super::store::Store;
use crate::sync::canonical::Collection;
use crate::sync::error::SyncError;

const MISSED_KEY: &str = "sync2_notes_missed";

pub async fn notes_missed(pool: &SqlitePool) -> Result<bool> {
    let row: Option<i64> = sqlx::query_scalar("SELECT 1 FROM settings WHERE key = ?")
        .bind(MISSED_KEY)
        .fetch_optional(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(row.is_some())
}

pub async fn notes_caught_up(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM settings WHERE key = ?")
        .bind(MISSED_KEY)
        .execute(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(())
}

impl<S: Store> Session<'_, S> {
    /// The notes batches of `link` the store still holds, from every other device's log.
    pub async fn missed_notes(&mut self, pool: &SqlitePool, link: &str) -> Result<Vec<Kept>> {
        let me = hex::encode(self.device().did);
        let logged = manifests(pool).await?;
        let mut read = Vec::new();
        for (did, reached) in streams(pool).await?.iter().filter(|(did, _)| **did != me) {
            let mut snapshots: Vec<&Logged> = logged
                .iter()
                .filter(|l| l.did == *did && l.manifest.link.as_deref() == Some(link))
                .collect();
            snapshots.sort_by_key(|l| std::cmp::Reverse(l.seq));
            let mut from = 1;
            for snapshot in snapshots {
                if self.snapshot_notes(link, snapshot, &mut read).await? {
                    from = snapshot.seq.saturating_add(1);
                    break;
                }
            }
            for seq in from..=reached.seq {
                let Some(bytes) = self.store().get_object(&log_path(did, seq)).await? else {
                    continue;
                };
                let content = async {
                    let object = self.verified(&bytes, did, seq)?;
                    self.open_content(&object).await
                };
                if let Some(Content::Batch(batch)) = contained(content.await)?
                    && batch.link.as_deref() == Some(link)
                    && batch.collection == Some(Collection::Notes)
                {
                    read.push(Kept {
                        link: link.to_owned(),
                        sender: did.clone(),
                        seq,
                        part: 0,
                        batch,
                    });
                }
            }
        }
        Ok(read)
    }

    /// Adds the notes of a snapshot that is still whole in the store, and says whether it was.
    async fn snapshot_notes(
        &mut self,
        link: &str,
        snapshot: &Logged,
        read: &mut Vec<Kept>,
    ) -> Result<bool> {
        let path = log_path(&snapshot.did, snapshot.seq);
        let Some(bytes) = self.store().get_object(&path).await? else {
            return Ok(false);
        };
        let Some(object) = contained(self.verified(&bytes, &snapshot.did, snapshot.seq))? else {
            return Ok(false);
        };
        let epoch = object.header.epoch;
        let notes = Manifest {
            parts: snapshot
                .manifest
                .parts
                .iter()
                .filter(|part| part.collection == Collection::Notes.key())
                .cloned()
                .collect(),
            ..snapshot.manifest.clone()
        };
        let batches = self.snapshot_batches(&snapshot.did, epoch, &notes).await;
        let Some(batches) = contained(batches)? else {
            return Ok(false);
        };
        for (part, batch) in (1..).zip(batches) {
            read.push(Kept {
                link: link.to_owned(),
                sender: snapshot.did.clone(),
                seq: snapshot.seq,
                part,
                batch,
            });
        }
        Ok(true)
    }
}
