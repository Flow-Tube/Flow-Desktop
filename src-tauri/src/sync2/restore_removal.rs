//! The end of a restore (spec/protocol.md, Recovery, step 6): the keys it started were wrapped to
//! every member, so the devices the user didn't keep go before this device seals anything.

use std::collections::BTreeSet;
use std::sync::Mutex;

use sqlx::SqlitePool;

use super::actions::set_recovery_saved;
use super::engine::{EngineError, Pulled, Result, Session};
use super::membership::remove_at;
use super::roster::Role;
use super::snapshot::snapshot_soon;
use super::state::{RestoreRead, restore_read, save_restore_read, streams};
use super::store::Store;

/// Words rule 8 made during this step, which has no screen of its own, until the page asks.
static REPLACED_WORDS: Mutex<Option<String>> = Mutex::new(None);

/// The recovery words the end of a restore had to make, once.
pub fn take_replaced_words() -> Option<String> {
    REPLACED_WORDS.lock().ok()?.take()
}

impl<S: Store> Session<'_, S> {
    /// Removes the devices not on the restore's list, ending their logs where this device could
    /// read them, which only an unsaved read can say: its saved positions are still empty. A read
    /// that hits this device's limits keeps its place and removes nobody yet. It runs again on the
    /// next open until none is left, so a stop anywhere resumes.
    pub(super) async fn finish_restore(&mut self, pool: &SqlitePool) -> Result<()> {
        let Some(kept) = self.record().restore_kept() else {
            return Ok(());
        };
        let removed = self.not_kept(&kept);
        if !removed.is_empty() {
            self.store().store_answers().await?;
            let read = self.read_every_log(pool).await?;
            if read.stalled {
                save_restore_read(pool, Some(&read.place())).await?;
                return Err(EngineError::RestorePending);
            }
            let replaced = remove_at(self, self.device(), &removed, read.positions()).await?;
            // Before the re-read, which can fail: these words open nothing else, and can't be asked for again.
            if let Some(words) = replaced {
                set_recovery_saved(pool, false).await?;
                if let Ok(mut slot) = REPLACED_WORDS.lock() {
                    *slot = Some(words);
                }
            }
            self.refresh(pool).await?;
            if !self.not_kept(&kept).is_empty() {
                return Err(EngineError::RestorePending);
            }
            snapshot_soon(pool).await?;
        }
        self.restore_finished(pool).await
    }

    async fn read_every_log(&mut self, pool: &SqlitePool) -> Result<Pulled> {
        let place = match restore_read(pool).await? {
            Some(place) => place,
            None => RestoreRead {
                positions: streams(pool).await?,
                cursor: self.record().cursor,
                from_first: false,
            },
        };
        self.read_from(pool, Pulled::to_the_end(place), None).await
    }

    fn not_kept(&self, kept: &BTreeSet<String>) -> Vec<String> {
        let me = hex::encode(self.device().did);
        self.roster()
            .members
            .iter()
            .filter(|(did, member)| {
                member.role == Role::Device && **did != me && !kept.contains(*did)
            })
            .map(|(did, _)| did.clone())
            .collect()
    }
}
