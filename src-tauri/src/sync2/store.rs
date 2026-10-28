//! What the sync engine needs from a store. The Flow server implements it; the other backends
//! will implement the same calls.

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
    fn changes(
        &self,
        cursor: u64,
    ) -> impl Future<Output = Result<(Vec<ChangedObject>, u64)>> + Send;
}
