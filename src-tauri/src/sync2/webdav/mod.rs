//! A group kept in a `WebDAV` folder (spec/store.md): the same objects under the same names as on
//! a Flow server, each written once. With no server to order appends, concurrent roster entries
//! both stay and every device picks the same winner (spec/protocol.md, Forks).

mod client;

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::sync::Mutex as StdMutex;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use tokio::sync::Mutex;

pub use self::client::{WebDav, WebDavLogin};
use super::envelope::MAX_OBJECT_SIZE;
use super::forks::winning_chain;
use super::mailbox::Mailbox;
use super::paths::{chain_path, log_path, roster_path, wrap_path};
use super::read_budget::ReadBudget;
use super::roster::{Entry, entry_hash, parse_entry};
use super::sealed::random_bytes;
use super::server::{Appended, ChangedObject, Result, StoreError, one_item};
use super::store::{Store, wraps_epoch};
use crate::sync::canonical::to_canonical_json;

/// Objects per log shard (spec/store.md, Layout).
const SHARD: u64 = 1024;
/// Roster files a folder may hold, and their bytes in all. A roster stays far below both, and
/// leaving a file out could change which entry wins a fork, so past them the read fails.
const ROSTER_FILES: usize = 16_384;
const ROSTER_BYTES: usize = 64 * 1024 * 1024;

/// Roster files already read, by store name, with the entry each holds; each is written once and
/// never changes.
#[derive(Default)]
struct RosterFiles {
    entries: BTreeMap<String, Option<Entry>>,
    bytes: usize,
}

pub struct WebDavStore {
    client: WebDav,
    /// This device's `did`: its own log is never something to read.
    me: String,
    roster: Mutex<RosterFiles>,
    pins: StdMutex<BTreeSet<String>>,
}

impl WebDavStore {
    /// The folder at `url`, as the device `me` reads it.
    pub async fn connect(url: &str, login: WebDavLogin, me: String) -> Result<Self> {
        Ok(Self::new(WebDav::connect(url, login).await?, me))
    }

    pub fn new(client: WebDav, me: String) -> Self {
        Self {
            client,
            me,
            roster: Mutex::default(),
            pins: StdMutex::new(BTreeSet::new()),
        }
    }

    async fn candidates(&self) -> Result<Vec<Entry>> {
        let mut held = self.roster.lock().await;
        for name in self.client.list("roster/").await? {
            let path = format!("roster/{name}");
            if name.strip_suffix(".r").is_none() || held.entries.contains_key(&path) {
                continue;
            }
            let bytes = match self.client.get(&path).await {
                Ok(None) => continue,
                read => one_item(read)?,
            };
            // One that can't be read counts too, or each read would fetch it again without end.
            held.bytes += bytes.as_ref().map_or(MAX_OBJECT_SIZE, Vec::len);
            if held.entries.len() >= ROSTER_FILES || held.bytes > ROSTER_BYTES {
                return Err(StoreError::Malformed);
            }
            // A file that isn't an entry is ignored, as a losing fork candidate would be.
            let entry = bytes
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .and_then(|value| parse_entry(&value).ok());
            held.entries.insert(path, entry);
        }
        Ok(held.entries.values().flatten().cloned().collect())
    }

    async fn chain(&self) -> Result<Vec<Entry>> {
        let candidates = self.candidates().await?;
        let pins = self.pins.lock().map(|p| p.clone()).unwrap_or_default();
        Ok(winning_chain(&candidates, &pins))
    }

    /// Checks that the storage takes, returns and deletes a file (spec/store.md, Setup probe).
    pub async fn probe(&self) -> Result<()> {
        let path = format!("probe/{}", hex::encode(random_bytes::<16>()));
        let marker = b"FLOW-SYNC/2 probe".to_vec();
        self.client.put(&path, marker.clone()).await?;
        let read = self.client.get(&path).await?;
        self.client.delete(&path).await?;
        if read.as_deref() == Some(marker.as_slice()) {
            Ok(())
        } else {
            Err(StoreError::Malformed)
        }
    }

    /// Names the group this storage holds, once, when the group is created here.
    pub async fn mark(&self, group: &str) -> Result<()> {
        let marker = json!({ "format": "FLOW-SYNC/2", "group": group });
        self.client
            .put("store.json", to_canonical_json(&marker))
            .await
    }

    /// The group this storage holds, if any.
    pub async fn group(&self) -> Result<Option<String>> {
        let Some(bytes) = self.client.get("store.json").await? else {
            return Ok(None);
        };
        let marker: Value = serde_json::from_slice(&bytes).map_err(|_| StoreError::Malformed)?;
        Ok(marker["group"].as_str().map(str::to_owned))
    }

    /// The other devices' logs, by `did`.
    async fn senders(&self) -> Result<Vec<String>> {
        Ok(self
            .client
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
            .client
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

impl Store for WebDavStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        Ok(self
            .chain()
            .await?
            .into_iter()
            .filter(|e| i64::try_from(e.seq).is_ok_and(|seq| seq > after))
            .collect())
    }

    async fn roster_view(&self) -> Result<Vec<Entry>> {
        self.candidates().await
    }

    fn is_linear(&self) -> bool {
        false
    }

    fn use_pins(&self, pins: &BTreeSet<String>) {
        if let Ok(mut held) = self.pins.lock() {
            held.clone_from(pins);
        }
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
        let before = self.chain().await?;
        let current = before.last().map(entry_hash).unwrap_or_default();
        if current != head {
            return Ok(Appended::Conflict { head: current });
        }
        let (epoch, kc) = wraps_epoch(entry, &before)?;
        let decode = |b64: &str| {
            URL_SAFE_NO_PAD
                .decode(b64)
                .map_err(|_| StoreError::Malformed)
        };
        for (did, wrap) in wraps {
            self.client
                .put(&wrap_path(epoch, &kc, did), decode(wrap)?)
                .await?;
        }
        if let Some(chain) = chain {
            self.client
                .put(&chain_path(epoch, &kc), decode(chain)?)
                .await?;
        }
        let hash = entry_hash(entry);
        self.client
            .put(&roster_path(entry.seq, &hash), to_canonical_json(entry))
            .await?;
        let after = self.chain().await?;
        match after.iter().find(|e| e.seq == entry.seq) {
            Some(winner) if entry_hash(winner) == hash => Ok(Appended::Done),
            _ => Ok(Appended::Conflict {
                head: after.last().map(entry_hash).unwrap_or_default(),
            }),
        }
    }

    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        one_item(self.client.get(&wrap_path(epoch, kc, name)).await)
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.client.put(path, bytes).await
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        one_item(self.client.get(path).await)
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.client.delete(path).await
    }

    /// Every log object, once: `WebDAV` has no change cursor, so the first call lists all
    /// of them and later calls none.
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        if cursor > 0 {
            return Ok((Vec::new(), cursor));
        }
        let mut objects = Vec::new();
        let mut budget = ReadBudget::default();
        for did in self.senders().await? {
            for shard in self.client.list(&format!("dev/{did}/log/")).await? {
                let Some(shard) = shard
                    .strip_suffix('/')
                    .and_then(|s| u64::from_str_radix(s, 16).ok())
                else {
                    continue;
                };
                let held = self.shard(&did, shard).await?;
                // A partial list could pick a snapshot that doesn't cover the logs left out.
                if !budget.take(held.len()) {
                    return Err(StoreError::TooLong);
                }
                objects.extend(held.into_iter().map(|seq| changed(&did, seq)));
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
        let mut budget = ReadBudget::default();
        'senders: for did in self.senders().await? {
            let Some(next) = read.get(&did).map_or(Some(1), |seq| seq.checked_add(1)) else {
                continue;
            };
            let mut shard = next / SHARD;
            loop {
                let last = shard * SHARD + (SHARD - 1);
                let held = self.shard(&did, shard).await?;
                let full = held.contains(&last);
                let within = budget.take(held.len());
                objects.extend(
                    held.into_iter()
                        .filter(|seq| *seq >= next)
                        .map(|seq| changed(&did, seq)),
                );
                // What is listed gets read, and the next sync lists on from there.
                if !within {
                    break 'senders;
                }
                if !full || last == u64::MAX {
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
impl Mailbox for WebDavStore {
    fn open_slot(&self, _slot: &str) -> impl Future<Output = Result<()>> + Send {
        std::future::ready(Ok(()))
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        self.client.put(&format!("pair/{slot}/{name}"), bytes).await
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.client.get(&format!("pair/{slot}/{name}")).await
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        let dir = format!("pair/{slot}/");
        for name in self.client.list(&dir).await? {
            self.client.delete(&format!("{dir}{name}")).await?;
        }
        self.client.delete(&dir).await?;
        Ok(())
    }
}
