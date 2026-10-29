//! The store a group syncs through: its Flow server, or what its devices hold on the LAN.

use std::collections::BTreeMap;

use super::held::HeldStore;
use super::mailbox::Mailbox;
use super::roster::Entry;
use super::server::{Appended, ChangedObject, Result, ServerStore};
use super::store::Store;

pub enum GroupStore {
    Server(Box<ServerStore>),
    Held(HeldStore),
}

impl GroupStore {
    /// The Flow server, for a server group.
    pub fn server(&self) -> Option<&ServerStore> {
        match self {
            Self::Server(store) => Some(store),
            Self::Held(_) => None,
        }
    }
}

impl Store for GroupStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        match self {
            Self::Server(store) => store.roster_after(after).await,
            Self::Held(store) => store.roster_after(after).await,
        }
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        match self {
            Self::Server(store) => store.append_roster(head, entry, wraps, chain).await,
            Self::Held(store) => store.append_roster(head, entry, wraps, chain).await,
        }
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        match self {
            Self::Server(store) => store.key(epoch, name).await,
            Self::Held(store) => store.key(epoch, name).await,
        }
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        match self {
            Self::Server(store) => store.put_object(path, bytes).await,
            Self::Held(store) => store.put_object(path, bytes).await,
        }
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        match self {
            Self::Server(store) => store.get_object(path).await,
            Self::Held(store) => store.get_object(path).await,
        }
    }

    async fn delete_object(&self, path: &str) -> Result<()> {
        match self {
            Self::Server(store) => store.delete_object(path).await,
            Self::Held(store) => store.delete_object(path).await,
        }
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        match self {
            Self::Server(store) => store.changes(cursor).await,
            Self::Held(store) => store.changes(cursor).await,
        }
    }
}

/// A LAN group has no mailbox: its slot never receives anything, so pairing runs over the LAN.
impl Mailbox for GroupStore {
    async fn open_slot(&self, slot: &str) -> Result<()> {
        match self {
            Self::Server(store) => store.open_slot(slot).await,
            Self::Held(_) => Ok(()),
        }
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        match self {
            Self::Server(store) => store.put_message(slot, name, bytes).await,
            Self::Held(_) => Ok(()),
        }
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        match self {
            Self::Server(store) => store.get_message(slot, name).await,
            Self::Held(_) => Ok(None),
        }
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        match self {
            Self::Server(store) => store.close_slot(slot).await,
            Self::Held(_) => Ok(()),
        }
    }
}
