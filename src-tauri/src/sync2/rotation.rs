//! Starting the next epoch after a device left (spec/protocol.md, Leaving): the leaving device
//! can't, so the first remaining device to open a session does, before it writes anything.

use sqlx::SqlitePool;

use super::Error;
use super::engine::{Result, Session};
use super::entries::{Draft, build_entry};
use super::membership::{member_keys, new_epoch};
use super::roster::{Op, apply_entry};
use super::server::Appended;
use super::snapshot::snapshot_soon;
use super::store::Store;

/// Rotations tried before giving up, each after a concurrent entry took the head.
const ATTEMPTS: usize = 3;

impl<S: Store> Session<'_, S> {
    /// Appends a `rotate` while a `leave` waits for one. When another entry wins the head, the
    /// roster is read again: a winner that started an epoch makes the rotation unnecessary.
    pub(super) async fn rotate_if_due(&mut self, pool: &SqlitePool) -> Result<()> {
        for _ in 0..ATTEMPTS {
            let state = self.roster();
            if !state.rotate {
                return Ok(());
            }
            let epoch = new_epoch(
                self.group(),
                state.epoch + 1,
                &member_keys(state, None)?,
                self.current_key(),
            )?;
            let draft = Draft {
                op: Op::Rotate,
                signer: hex::encode(self.device().did),
                add: None,
                remove: None,
                epoch: Some(epoch.field),
                meta: None,
            };
            let entry = build_entry(self.group(), Some(state), draft, &[self.device()]);
            apply_entry(Some(state), &entry)?;
            let appended = self
                .store()
                .append_roster(&state.head, &entry, &epoch.wraps, Some(&epoch.chain))
                .await?;
            self.refresh(pool).await?;
            if matches!(appended, Appended::Done) {
                return snapshot_soon(pool).await;
            }
        }
        if self.roster().rotate {
            return Err(Error::RosterChain.into());
        }
        Ok(())
    }
}
