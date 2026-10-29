//! What a device holds for a LAN group (spec/live.md, LAN groups): every roster entry it has seen,
//! every wrap and chain box, and the log objects and blobs it wrote or fetched. It is the group's
//! store on this device, and what the device serves to the others.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::paths::{parse_log_path, roster_path};
use super::roster::{Entry, apply_entry, entry_hash, fork_winner, parse_entry};
use super::server::{Appended, ChangedObject, Result, StoreError};
use super::store::Store;
use crate::sync::canonical::to_canonical_json;

/// Objects listed per call of [`Store::changes`].
const PAGE: i64 = 500;

#[derive(Clone)]
pub struct HeldStore {
    pool: SqlitePool,
}

impl HeldStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Every entry held with a `seq` above `after`, fork candidates included, by `seq`.
    pub async fn candidates_after(&self, after: i64) -> Result<Vec<Entry>> {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT entry FROM sync2_held_roster WHERE seq > ? ORDER BY seq, name",
        )
        .bind(after)
        .fetch_all(&self.pool)
        .await
        .map_err(StoreError::Local)?;
        rows.iter()
            .map(|json| {
                let value = serde_json::from_str(json).map_err(|_| StoreError::Malformed)?;
                Ok(parse_entry(&value)?)
            })
            .collect()
    }

    /// Keeps an entry under its store name; one already held is left as it is.
    pub async fn hold_entry(&self, entry: &Entry) -> Result<()> {
        let seq = i64::try_from(entry.seq).map_err(|_| StoreError::Malformed)?;
        sqlx::query("INSERT OR IGNORE INTO sync2_held_roster (name, seq, entry) VALUES (?, ?, ?)")
            .bind(roster_path(entry.seq, &entry_hash(entry)))
            .bind(seq)
            .bind(String::from_utf8_lossy(&to_canonical_json(entry)).into_owned())
            .execute(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(())
    }

    pub async fn hold_key(&self, epoch: u32, name: &str, bytes: &[u8]) -> Result<()> {
        sqlx::query("INSERT OR IGNORE INTO sync2_held_keys (epoch, name, bytes) VALUES (?, ?, ?)")
            .bind(epoch)
            .bind(name)
            .bind(bytes)
            .execute(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(())
    }

    /// The log objects held above `vv`, and every blob held.
    pub async fn listing(&self, vv: &BTreeMap<String, u64>) -> Result<(Vec<String>, Vec<String>)> {
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT path FROM sync2_held_objects ORDER BY id")
                .fetch_all(&self.pool)
                .await
                .map_err(StoreError::Local)?;
        let (logs, blobs): (Vec<String>, Vec<String>) = rows
            .into_iter()
            .partition(|path| parse_log_path(path).is_some());
        let paths = logs
            .into_iter()
            .filter(|path| {
                parse_log_path(path)
                    .is_some_and(|(did, seq)| vv.get(&did).is_none_or(|known| seq > *known))
            })
            .collect();
        Ok((
            paths,
            blobs.into_iter().filter(|p| p.contains("/blob/")).collect(),
        ))
    }

    /// For each log, the last `seq` held with none missing before it, counted from the oldest
    /// held (older ones may have been collected).
    pub async fn held_vv(&self) -> Result<BTreeMap<String, u64>> {
        let rows: Vec<String> = sqlx::query_scalar("SELECT path FROM sync2_held_objects")
            .fetch_all(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        let mut logs: BTreeMap<String, BTreeSet<u64>> = BTreeMap::new();
        for (did, seq) in rows.iter().filter_map(|p| parse_log_path(p)) {
            logs.entry(did).or_default().insert(seq);
        }
        Ok(logs
            .into_iter()
            .filter_map(|(did, seqs)| {
                let first = *seqs.first()?;
                let last = seqs
                    .iter()
                    .zip(first..)
                    .take_while(|(held, expected)| **held == *expected)
                    .last()?;
                Some((did, *last.0))
            })
            .collect())
    }

    /// The highest `seq` of any roster entry held, or -1.
    pub async fn highest_seq(&self) -> Result<i64> {
        let seq: Option<i64> = sqlx::query_scalar("SELECT MAX(seq) FROM sync2_held_roster")
            .fetch_one(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(seq.unwrap_or(-1))
    }
}

/// The entries that win, in order: at each `seq`, the fork winner among the candidates valid
/// against the state before them (spec/protocol.md, Forks).
pub fn winning_chain(candidates: &[Entry]) -> Vec<Entry> {
    let mut by_seq: BTreeMap<u64, Vec<&Entry>> = BTreeMap::new();
    for entry in candidates {
        by_seq.entry(entry.seq).or_default().push(entry);
    }
    let mut chain: Vec<Entry> = Vec::new();
    let mut state = None;
    for seq in 0.. {
        let Some(at_seq) = by_seq.get(&seq) else {
            break;
        };
        let valid: Vec<Entry> = at_seq
            .iter()
            .filter(|e| apply_entry(state.as_ref(), e).is_ok())
            .map(|e| (*e).clone())
            .collect();
        let Some(winner) = fork_winner(&valid) else {
            break;
        };
        state = apply_entry(state.as_ref(), winner).ok();
        chain.push(winner.clone());
    }
    chain
}

impl Store for HeldStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        let chain = winning_chain(&self.candidates_after(-1).await?);
        Ok(chain
            .into_iter()
            .filter(|e| i64::try_from(e.seq).is_ok_and(|seq| seq > after))
            .collect())
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let current = winning_chain(&self.candidates_after(-1).await?)
            .last()
            .map(entry_hash)
            .unwrap_or_default();
        if current != head {
            return Ok(Appended::Conflict { head: current });
        }
        let epoch = match &entry.epoch {
            Some(epoch) => epoch.n,
            None => self.current_epoch().await?,
        };
        let decode = |b64: &str| {
            URL_SAFE_NO_PAD
                .decode(b64)
                .map_err(|_| StoreError::Malformed)
        };
        for (did, wrap) in wraps {
            self.hold_key(epoch, did, &decode(wrap)?).await?;
        }
        if let Some(chain) = chain {
            self.hold_key(epoch, "chain", &decode(chain)?).await?;
        }
        self.hold_entry(entry).await?;
        Ok(Appended::Done)
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        sqlx::query_scalar("SELECT bytes FROM sync2_held_keys WHERE epoch = ? AND name = ?")
            .bind(epoch)
            .bind(name)
            .fetch_optional(&self.pool)
            .await
            .map_err(StoreError::Local)
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        sqlx::query("INSERT OR IGNORE INTO sync2_held_objects (path, bytes) VALUES (?, ?)")
            .bind(path)
            .bind(bytes)
            .execute(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(())
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        sqlx::query_scalar("SELECT bytes FROM sync2_held_objects WHERE path = ?")
            .bind(path)
            .fetch_optional(&self.pool)
            .await
            .map_err(StoreError::Local)
    }

    async fn delete_object(&self, path: &str) -> Result<()> {
        sqlx::query("DELETE FROM sync2_held_objects WHERE path = ?")
            .bind(path)
            .execute(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(())
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        let rows: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT id, path, length(bytes) FROM sync2_held_objects WHERE id > ? ORDER BY id LIMIT ?",
        )
        .bind(i64::try_from(cursor).unwrap_or(i64::MAX))
        .bind(PAGE)
        .fetch_all(&self.pool)
        .await
        .map_err(StoreError::Local)?;
        let next = rows
            .last()
            .map_or(cursor, |(id, _, _)| u64::try_from(*id).unwrap_or(cursor));
        let objects = rows
            .into_iter()
            .map(|(_, path, size)| ChangedObject {
                path,
                size: u64::try_from(size).unwrap_or(0),
            })
            .collect();
        Ok((objects, next))
    }
}

impl HeldStore {
    async fn current_epoch(&self) -> Result<u32> {
        Ok(winning_chain(&self.candidates_after(-1).await?)
            .iter()
            .filter_map(|e| e.epoch.as_ref().map(|epoch| epoch.n))
            .next_back()
            .unwrap_or(0))
    }
}
