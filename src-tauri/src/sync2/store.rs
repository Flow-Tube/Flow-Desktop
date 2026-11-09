//! What the sync engine needs from a store: the Flow server, what devices hold on the LAN, and a
//! `WebDAV` folder.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::paths::kc_name;
use super::roster::Entry;
use super::server::{Appended, ChangedObject, Result, StoreError};

/// The epoch and `<kc:16>` an entry's wraps go under: the epoch it starts, or else the one in
/// force on the chain `below` it.
pub fn wraps_epoch(entry: &Entry, below: &[Entry]) -> Result<(u32, String)> {
    let epoch = entry
        .epoch
        .as_ref()
        .or_else(|| below.iter().rev().find_map(|e| e.epoch.as_ref()))
        .ok_or(StoreError::Malformed)?;
    let kc = URL_SAFE_NO_PAD
        .decode(&epoch.kc)
        .map_err(|_| StoreError::Malformed)?;
    Ok((epoch.n, kc_name(&kc)))
}

pub trait Store {
    fn roster_after(&self, after: i64) -> impl Future<Output = Result<Vec<Entry>>> + Send;
    /// Every roster entry the store shows, fork candidates included.
    fn roster_view(&self) -> impl Future<Output = Result<Vec<Entry>>> + Send {
        self.roster_after(-1)
    }
    /// Whether the store orders appends, so it has no honest way to change an entry it answered
    /// with.
    fn is_linear(&self) -> bool {
        true
    }
    /// Fails while the store itself is out of reach, even if held copies could answer for it.
    fn store_answers(&self) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }
    /// The entries this device chose between sides of a contested roster, for a store that picks
    /// a winner itself when it appends.
    fn use_pins(&self, _pins: &BTreeSet<String>) {}
    fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> impl Future<Output = Result<Appended>> + Send;
    /// A wrap or chain box: `kc` is the `<kc:16>` of its path.
    fn key(
        &self,
        epoch: u32,
        kc: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    fn put_object(&self, path: &str, bytes: Vec<u8>) -> impl Future<Output = Result<()>> + Send;
    fn get_object(&self, path: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    /// A wrap or chain box from [`Store::key`] that opened. A store that serves copies keeps it.
    fn keep_key(
        &self,
        _epoch: u32,
        _kc: &str,
        _name: &str,
        _bytes: &[u8],
    ) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }
    /// A wrap or chain box from [`Store::key`] that didn't open. A store that serves copies drops
    /// its copy, so the next read can get a good one.
    fn drop_key(
        &self,
        _epoch: u32,
        _kc: &str,
        _name: &str,
    ) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }
    /// An object from [`Store::get_object`] that verified.
    fn keep_object(&self, _path: &str, _bytes: &[u8]) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }
    /// An object from [`Store::get_object`] that didn't verify.
    fn drop_object(&self, _path: &str) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }
    /// Deletes an object, and says whether it was still there.
    fn delete_object(&self, path: &str) -> impl Future<Output = Result<bool>> + Send;
    /// Every object that arrived after `cursor`, and the cursor to pass next time.
    fn changes(
        &self,
        cursor: u64,
    ) -> impl Future<Output = Result<(Vec<ChangedObject>, u64)>> + Send;
    /// The log objects to read next, given how far each sender's log was read (`read`). A store
    /// with a change cursor lists by cursor; `WebDAV` looks only past each position.
    fn new_objects(
        &self,
        cursor: u64,
        read: &BTreeMap<String, u64>,
    ) -> impl Future<Output = Result<(Vec<ChangedObject>, u64)>> + Send {
        let _ = read;
        self.changes(cursor)
    }
}
