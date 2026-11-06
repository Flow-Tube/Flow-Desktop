//! What a device holds for a LAN group (spec/live.md, LAN groups): every roster entry it has seen,
//! every wrap and chain box, and the log objects and blobs it wrote or fetched. It is the group's
//! store on this device, and what the device serves to the others.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::forks::{ForkResolution, resolve_forks};
use super::paths::{parse_log_path, roster_path};
use super::roster::{Entry, entry_hash, parse_entry};
use super::server::{Appended, ChangedObject, Result, StoreError};
use super::state::{StoreKind, load_group, roster_entries, roster_pins};
use super::store::{Store, wraps_epoch};
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

    /// Keeps an entry under its store name; one already held is left as it is. Peers send entries
    /// as JSON, so one that wouldn't read back is refused.
    pub async fn hold_entry(&self, entry: &Entry) -> Result<()> {
        parse_entry(&serde_json::to_value(entry).map_err(|_| StoreError::Malformed)?)?;
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

    pub async fn hold_key(&self, epoch: u32, kc: &str, name: &str, bytes: &[u8]) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO sync2_held_keys (epoch, kc, name, bytes) VALUES (?, ?, ?, ?)",
        )
        .bind(epoch)
        .bind(kc)
        .bind(name)
        .bind(bytes)
        .execute(&self.pool)
        .await
        .map_err(StoreError::Local)?;
        Ok(())
    }

    pub async fn forget_key(&self, epoch: u32, kc: &str, name: &str) -> Result<()> {
        sqlx::query("DELETE FROM sync2_held_keys WHERE epoch = ? AND kc = ? AND name = ?")
            .bind(epoch)
            .bind(kc)
            .bind(name)
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

    /// What the rule makes of what this device holds, within the group it has verified.
    pub async fn resolved(&self) -> Result<ForkResolution> {
        let pins = roster_pins(&self.pool)
            .await
            .map_err(|_| StoreError::Malformed)?;
        let group = load_group(&self.pool)
            .await
            .map_err(|_| StoreError::Malformed)?
            .map(|record| record.group_id);
        let held = self.candidates_after(-1).await?;
        Ok(resolve_forks(group.as_deref(), &held, &pins, None).unwrap_or_default())
    }

    /// The chain the rule picks from what this device holds.
    pub async fn chain(&self) -> Result<Vec<Entry>> {
        Ok(self.resolved().await?.chain)
    }
}

impl Store for HeldStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        Ok(self
            .chain()
            .await?
            .into_iter()
            .filter(|e| i64::try_from(e.seq).is_ok_and(|seq| seq > after))
            .collect())
    }

    /// What this device holds, with what it has applied. On a server group, peers on the LAN can
    /// only extend the applied chain: its server orders the rest.
    async fn roster_view(&self) -> Result<Vec<Entry>> {
        let applied = roster_entries(&self.pool)
            .await
            .map_err(|_| StoreError::Malformed)?;
        let held = self.candidates_after(-1).await?;
        let server_group = load_group(&self.pool)
            .await
            .map_err(|_| StoreError::Malformed)?
            .is_some_and(|record| record.kind == StoreKind::Server);
        if !server_group {
            return Ok(applied.into_iter().chain(held).collect());
        }
        let mut reached: BTreeSet<String> = applied.last().map(entry_hash).into_iter().collect();
        let mut view = applied;
        for entry in held {
            if reached.contains(&entry.prev) {
                reached.insert(entry_hash(&entry));
                view.push(entry);
            }
        }
        Ok(view)
    }

    fn is_linear(&self) -> bool {
        false
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let below = self.chain().await?;
        let current = below.last().map(entry_hash).unwrap_or_default();
        if current != head {
            return Ok(Appended::Conflict { head: current });
        }
        let (epoch, kc) = wraps_epoch(entry, &below)?;
        let decode = |b64: &str| {
            URL_SAFE_NO_PAD
                .decode(b64)
                .map_err(|_| StoreError::Malformed)
        };
        for (did, wrap) in wraps {
            self.hold_key(epoch, &kc, did, &decode(wrap)?).await?;
        }
        if let Some(chain) = chain {
            self.hold_key(epoch, &kc, "chain", &decode(chain)?).await?;
        }
        self.hold_entry(entry).await?;
        Ok(Appended::Done)
    }

    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        sqlx::query_scalar(
            "SELECT bytes FROM sync2_held_keys WHERE epoch = ? AND kc = ? AND name = ?",
        )
        .bind(epoch)
        .bind(kc)
        .bind(name)
        .fetch_optional(&self.pool)
        .await
        .map_err(StoreError::Local)
    }

    /// A member can hand over a wrap this device can't check when it takes it. Without it, the
    /// next meeting can get a good one. Objects were verified when taken, and may be the only copy.
    async fn drop_key(&self, epoch: u32, kc: &str, name: &str) -> Result<()> {
        self.forget_key(epoch, kc, name).await
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

    async fn delete_object(&self, path: &str) -> Result<bool> {
        let deleted = sqlx::query("DELETE FROM sync2_held_objects WHERE path = ?")
            .bind(path)
            .execute(&self.pool)
            .await
            .map_err(StoreError::Local)?;
        Ok(deleted.rows_affected() > 0)
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
