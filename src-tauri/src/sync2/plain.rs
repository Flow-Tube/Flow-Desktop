//! A group kept on plain storage such as `WebDAV` or S3 (spec/store.md): the same objects under the
//! same names as on a Flow server, each written once, over a bucket that can only put, get, list
//! and delete. With no server to order appends, concurrent roster entries both stay and every
//! device picks the same winner (spec/protocol.md, Forks).

use std::collections::BTreeMap;
use std::future::Future;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use super::held::winning_chain;
use super::mailbox::Mailbox;
use super::paths::{chain_path, log_path, roster_path, wrap_path};
use super::roster::{Entry, entry_hash, parse_entry};
use super::sealed::random_bytes;
use super::server::{Appended, ChangedObject, Result, StoreError};
use super::store::Store;
use crate::sync::canonical::to_canonical_json;

/// Objects per log shard (spec/store.md, Layout).
const SHARD: u64 = 1024;

/// What plain storage offers.
pub trait Bucket: Send + Sync {
    fn put(&self, path: &str, bytes: Vec<u8>) -> impl Future<Output = Result<()>> + Send;
    fn get(&self, path: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    /// Deletes a file, or an empty folder, and says whether it was there.
    fn delete(&self, path: &str) -> impl Future<Output = Result<bool>> + Send;
    /// The names directly inside folder `dir` (which ends in `/`); folder names end in `/`.
    fn list(&self, dir: &str) -> impl Future<Output = Result<Vec<String>>> + Send;
}

pub struct PlainStore<B> {
    bucket: B,
    /// This device's `did`: its own log is never something to read.
    me: String,
    /// Roster entries already read, by store name; each is written once and never changes.
    roster: Mutex<BTreeMap<String, Entry>>,
}

impl<B: Bucket> PlainStore<B> {
    pub fn new(bucket: B, me: String) -> Self {
        Self {
            bucket,
            me,
            roster: Mutex::new(BTreeMap::new()),
        }
    }

    async fn candidates(&self) -> Result<Vec<Entry>> {
        let mut held = self.roster.lock().await;
        for name in self.bucket.list("roster/").await? {
            let path = format!("roster/{name}");
            if name.strip_suffix(".r").is_none() || held.contains_key(&path) {
                continue;
            }
            let Some(bytes) = self.bucket.get(&path).await? else {
                continue;
            };
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| StoreError::Malformed)?;
            held.insert(path, parse_entry(&value)?);
        }
        Ok(held.values().cloned().collect())
    }

    /// Checks that the storage takes, returns and deletes a file (spec/store.md, Setup probe).
    pub async fn probe(&self) -> Result<()> {
        let path = format!("probe/{}", hex::encode(random_bytes::<16>()));
        let marker = b"FLOW-SYNC/2 probe".to_vec();
        self.bucket.put(&path, marker.clone()).await?;
        let read = self.bucket.get(&path).await?;
        self.bucket.delete(&path).await?;
        if read.as_deref() == Some(marker.as_slice()) {
            Ok(())
        } else {
            Err(StoreError::Malformed)
        }
    }

    /// Names the group this storage holds, once, when the group is created here.
    pub async fn mark(&self, group: &str) -> Result<()> {
        let marker = json!({ "format": "FLOW-SYNC/2", "group": group });
        self.bucket
            .put("store.json", to_canonical_json(&marker))
            .await
    }

    /// The group this storage holds, if any.
    pub async fn group(&self) -> Result<Option<String>> {
        let Some(bytes) = self.bucket.get("store.json").await? else {
            return Ok(None);
        };
        let marker: Value = serde_json::from_slice(&bytes).map_err(|_| StoreError::Malformed)?;
        Ok(marker["group"].as_str().map(str::to_owned))
    }

    /// The other devices' logs, by `did`.
    async fn senders(&self) -> Result<Vec<String>> {
        Ok(self
            .bucket
            .list("dev/")
            .await?
            .into_iter()
            .filter_map(|name| name.strip_suffix('/').map(str::to_owned))
            .filter(|did| *did != self.me)
            .collect())
    }

    /// The `seq`s of `did`'s log held in `shard`.
    async fn shard(&self, did: &str, shard: u64) -> Result<Vec<u64>> {
        let dir = format!("dev/{did}/log/{shard:016x}/");
        Ok(self
            .bucket
            .list(&dir)
            .await?
            .iter()
            .filter_map(|name| u64::from_str_radix(name.strip_suffix(".o")?, 16).ok())
            .collect())
    }
}

fn changed(did: &str, seq: u64) -> ChangedObject {
    ChangedObject {
        path: log_path(did, seq),
        size: 0,
    }
}

impl<B: Bucket> Store for PlainStore<B> {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        Ok(winning_chain(&self.candidates().await?)
            .into_iter()
            .filter(|e| i64::try_from(e.seq).is_ok_and(|seq| seq > after))
            .collect())
    }

    /// Writes the wraps, then the entry, then reads the roster again: another device may have
    /// appended at the same `seq`, and only a winning entry counts.
    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let before = winning_chain(&self.candidates().await?);
        let current = before.last().map(entry_hash).unwrap_or_default();
        if current != head {
            return Ok(Appended::Conflict { head: current });
        }
        let epoch = match &entry.epoch {
            Some(epoch) => epoch.n,
            None => before
                .iter()
                .filter_map(|e| e.epoch.as_ref().map(|epoch| epoch.n))
                .next_back()
                .unwrap_or(0),
        };
        let decode = |b64: &str| {
            URL_SAFE_NO_PAD
                .decode(b64)
                .map_err(|_| StoreError::Malformed)
        };
        for (did, wrap) in wraps {
            self.bucket
                .put(&wrap_path(epoch, did), decode(wrap)?)
                .await?;
        }
        if let Some(chain) = chain {
            self.bucket.put(&chain_path(epoch), decode(chain)?).await?;
        }
        let hash = entry_hash(entry);
        self.bucket
            .put(&roster_path(entry.seq, &hash), to_canonical_json(entry))
            .await?;
        let after = winning_chain(&self.candidates().await?);
        match after.iter().find(|e| e.seq == entry.seq) {
            Some(winner) if entry_hash(winner) == hash => Ok(Appended::Done),
            _ => Ok(Appended::Conflict {
                head: after.last().map(entry_hash).unwrap_or_default(),
            }),
        }
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.bucket.get(&wrap_path(epoch, name)).await
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.bucket.put(path, bytes).await
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.bucket.get(path).await
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.bucket.delete(path).await
    }

    /// Every log object, once: plain storage has no change cursor, so the first call lists all
    /// of them and later calls none.
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        if cursor > 0 {
            return Ok((Vec::new(), cursor));
        }
        let mut objects = Vec::new();
        for did in self.senders().await? {
            for shard in self.bucket.list(&format!("dev/{did}/log/")).await? {
                let Some(shard) = shard
                    .strip_suffix('/')
                    .and_then(|s| u64::from_str_radix(s, 16).ok())
                else {
                    continue;
                };
                objects.extend(
                    self.shard(&did, shard)
                        .await?
                        .into_iter()
                        .map(|seq| changed(&did, seq)),
                );
            }
        }
        Ok((objects, 1))
    }

    /// Lists only the shard each log continues in, and the next one when that shard is full.
    async fn new_objects(
        &self,
        cursor: u64,
        read: &BTreeMap<String, u64>,
    ) -> Result<(Vec<ChangedObject>, u64)> {
        let mut objects = Vec::new();
        for did in self.senders().await? {
            let next = read.get(&did).map_or(1, |seq| seq + 1);
            let mut shard = next / SHARD;
            loop {
                let held = self.shard(&did, shard).await?;
                let full = held.contains(&(shard * SHARD + SHARD - 1));
                objects.extend(
                    held.into_iter()
                        .filter(|seq| *seq >= next)
                        .map(|seq| changed(&did, seq)),
                );
                if !full {
                    break;
                }
                shard += 1;
            }
        }
        objects.sort_by(|a, b| a.path.cmp(&b.path));
        Ok((objects, cursor))
    }
}

/// The pairing mailbox as files under `pair/<slot>/` (spec/store.md, Pairing mailbox).
impl<B: Bucket> Mailbox for PlainStore<B> {
    fn open_slot(&self, _slot: &str) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        self.bucket.put(&format!("pair/{slot}/{name}"), bytes).await
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.bucket.get(&format!("pair/{slot}/{name}")).await
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        let dir = format!("pair/{slot}/");
        for name in self.bucket.list(&dir).await? {
            self.bucket.delete(&format!("{dir}{name}")).await?;
        }
        self.bucket.delete(&dir).await?;
        Ok(())
    }
}
