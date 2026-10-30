//! A group on a store that its devices also sync over the LAN (spec/live.md, LAN groups: "Groups
//! on a store sync the same way"). Everything read from or written to the store is also held, as
//! a LAN group holds it, so it can be served to members on the LAN. While the store is out of
//! reach, reads and listings come from what is held, and new objects wait to be uploaded. Roster
//! appends still need the store, which orders them.

use std::collections::BTreeMap;

use sqlx::SqlitePool;

use super::held::HeldStore;
use super::mailbox::Mailbox;
use super::paths::parse_log_path;
use super::roster::Entry;
use super::server::{Appended, ChangedObject, Result, StoreError};
use super::state::roster_entries;
use super::store::Store;

pub struct HybridStore<S> {
    pub store: S,
    held: HeldStore,
    pool: SqlitePool,
    /// This device's `did`: its own log is never something to read.
    me: String,
}

/// The store can't be reached, or failed on its side: what is held stands in for it. A server
/// that no longer has the group (`unclaimed`) is not a passing failure.
fn unreachable(error: &StoreError) -> bool {
    match error {
        StoreError::Network(_) => true,
        StoreError::Refused { status, code } => (500..=599).contains(status) && code != "unclaimed",
        _ => false,
    }
}

impl<S: Store> HybridStore<S> {
    /// Also holds the roster this device verified before it held anything, so a LAN session can
    /// open on it.
    pub async fn new(store: S, pool: SqlitePool, me: String) -> Result<Self> {
        let held = HeldStore::new(pool.clone());
        let local = roster_entries(&pool)
            .await
            .map_err(|_| StoreError::Malformed)?;
        if held.candidates_after(-1).await?.len() < local.len() {
            for entry in &local {
                held.hold_entry(entry).await?;
            }
        }
        Ok(Self {
            store,
            held,
            pool,
            me,
        })
    }

    /// Uploads, in order, the objects written while the store was out of reach. Stops at the
    /// first one the store can't take yet.
    pub async fn upload_pending(&self) -> Result<()> {
        let pending: Vec<(i64, String)> =
            sqlx::query_as("SELECT id, path FROM sync2_pending ORDER BY id")
                .fetch_all(&self.pool)
                .await
                .map_err(StoreError::Local)?;
        for (id, path) in pending {
            if let Some(bytes) = self.held.get_object(&path).await? {
                self.store.put_object(&path, bytes).await?;
            }
            sqlx::query("DELETE FROM sync2_pending WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(StoreError::Local)?;
        }
        Ok(())
    }
}

impl<S> HybridStore<S> {
    async fn held_above(
        &self,
        read: &BTreeMap<String, u64>,
        cursor: u64,
    ) -> Result<(Vec<ChangedObject>, u64)> {
        let (paths, _) = self.held.listing(read).await?;
        let objects = paths
            .into_iter()
            .filter(|path| parse_log_path(path).is_some_and(|(did, _)| did != self.me))
            .map(|path| ChangedObject { path, size: 0 })
            .collect();
        Ok((objects, cursor))
    }
}

impl<S: Store + Sync> Store for HybridStore<S> {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        match self.store.roster_after(after).await {
            Ok(entries) => {
                for entry in &entries {
                    self.held.hold_entry(entry).await?;
                }
                Ok(entries)
            }
            Err(error) if unreachable(&error) => self.held.roster_after(after).await,
            Err(error) => Err(error),
        }
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let appended = self.store.append_roster(head, entry, wraps, chain).await?;
        if appended == Appended::Done
            && self.held.append_roster(head, entry, wraps, chain).await? != Appended::Done
        {
            self.held.hold_entry(entry).await?;
        }
        Ok(appended)
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        if let Some(bytes) = self.held.key(epoch, name).await? {
            return Ok(Some(bytes));
        }
        let fetched = self.store.key(epoch, name).await?;
        if let Some(bytes) = &fetched {
            self.held.hold_key(epoch, name, bytes).await?;
        }
        Ok(fetched)
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.held.put_object(path, bytes.clone()).await?;
        match self.store.put_object(path, bytes).await {
            Err(error) if unreachable(&error) => {
                sqlx::query("INSERT OR IGNORE INTO sync2_pending (path) VALUES (?)")
                    .bind(path)
                    .execute(&self.pool)
                    .await
                    .map_err(StoreError::Local)?;
                Ok(())
            }
            other => other,
        }
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        if let Some(bytes) = self.held.get_object(path).await? {
            return Ok(Some(bytes));
        }
        let fetched = self.store.get_object(path).await?;
        if let Some(bytes) = &fetched {
            self.held.put_object(path, bytes.clone()).await?;
        }
        Ok(fetched)
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.held.delete_object(path).await?;
        self.store.delete_object(path).await
    }

    /// The store's changes; while it is out of reach, every log object held, listed once, as
    /// plain storage lists them.
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        match self.store.changes(cursor).await {
            Err(error) if unreachable(&error) && cursor == 0 => {
                self.held_above(&BTreeMap::new(), 1).await
            }
            Err(error) if unreachable(&error) => Ok((Vec::new(), cursor)),
            other => other,
        }
    }

    /// The store's new objects; while it is out of reach, those held above each read position.
    async fn new_objects(
        &self,
        cursor: u64,
        read: &BTreeMap<String, u64>,
    ) -> Result<(Vec<ChangedObject>, u64)> {
        match self.store.new_objects(cursor, read).await {
            Err(error) if unreachable(&error) => self.held_above(read, cursor).await,
            other => other,
        }
    }
}

impl<S: Mailbox + Sync> Mailbox for HybridStore<S> {
    async fn open_slot(&self, slot: &str) -> Result<()> {
        self.store.open_slot(slot).await
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        self.store.put_message(slot, name, bytes).await
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.store.get_message(slot, name).await
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        self.store.close_slot(slot).await
    }
}
