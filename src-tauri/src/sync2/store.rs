//! What the sync engine needs from a store: the Flow server, what devices hold on the LAN, and a
//! `WebDAV` folder.

use std::collections::BTreeMap;
use std::future::Future;

use super::roster::Entry;
use super::server::{Appended, ChangedObject, Result};

pub trait Store {
    fn roster_after(&self, after: i64) -> impl Future<Output = Result<Vec<Entry>>> + Send;
    fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> impl Future<Output = Result<Appended>> + Send;
    fn key(&self, epoch: u32, name: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    fn put_object(&self, path: &str, bytes: Vec<u8>) -> impl Future<Output = Result<()>> + Send;
    fn get_object(&self, path: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
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
