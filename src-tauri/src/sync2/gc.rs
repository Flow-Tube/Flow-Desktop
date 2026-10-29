//! Garbage collection (spec/protocol.md, Acknowledgements and Garbage collection): a device
//! deletes its own log objects, and those of removed devices, once every current device has
//! acknowledged them and an acknowledged snapshot covers them.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::engine::{Result, Session};
use super::paths::{blob_path, log_path};
use super::roster::Role;
use super::snapshot::Manifest;
use super::store::Store;
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;

/// Deletions per sync, so one run stays short.
const BUDGET: usize = 500;

pub type VersionVector = BTreeMap<String, u64>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ack {
    pub vv: VersionVector,
}

/// A snapshot manifest and where it sits in its writer's log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Logged {
    pub did: String,
    pub seq: u64,
    pub manifest: Manifest,
}

fn json(value: &impl Serialize) -> String {
    String::from_utf8_lossy(&to_canonical_json(value)).into_owned()
}

fn to_i64(value: u64) -> Result<i64> {
    Ok(i64::try_from(value).map_err(|_| SyncError::Protocol("log too long".into()))?)
}

pub async fn record_ack(pool: &SqlitePool, did: &str, vv: &VersionVector) -> Result<()> {
    sqlx::query(
        "INSERT INTO sync2_acks (did, vv) VALUES (?, ?) ON CONFLICT (did) DO UPDATE SET vv = excluded.vv",
    )
    .bind(did)
    .bind(json(vv))
    .execute(pool)
    .await
    .map_err(SyncError::from)?;
    Ok(())
}

pub async fn record_manifest(pool: &SqlitePool, logged: &Logged) -> Result<()> {
    sqlx::query("INSERT OR IGNORE INTO sync2_manifests (did, seq, manifest) VALUES (?, ?, ?)")
        .bind(&logged.did)
        .bind(to_i64(logged.seq)?)
        .bind(json(&logged.manifest))
        .execute(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(())
}

async fn acks(pool: &SqlitePool) -> Result<BTreeMap<String, VersionVector>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT did, vv FROM sync2_acks")
        .fetch_all(pool)
        .await
        .map_err(SyncError::from)?;
    rows.into_iter()
        .map(|(did, vv)| Ok((did, serde_json::from_str(&vv).map_err(SyncError::from)?)))
        .collect()
}

async fn manifests(pool: &SqlitePool) -> Result<Vec<Logged>> {
    let rows: Vec<(String, i64, String)> =
        sqlx::query_as("SELECT did, seq, manifest FROM sync2_manifests")
            .fetch_all(pool)
            .await
            .map_err(SyncError::from)?;
    rows.into_iter()
        .map(|(did, seq, manifest)| {
            Ok(Logged {
                did,
                seq: u64::try_from(seq).unwrap_or(0),
                manifest: serde_json::from_str(&manifest).map_err(SyncError::from)?,
            })
        })
        .collect()
}

async fn collected(pool: &SqlitePool) -> Result<VersionVector> {
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT did, through FROM sync2_collected")
        .fetch_all(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(rows
        .into_iter()
        .map(|(did, through)| (did, u64::try_from(through).unwrap_or(0)))
        .collect())
}

/// What may be deleted now: per log a range of `seq`s (manifests excluded), and the manifests
/// that a newer acknowledged snapshot supersedes.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub logs: BTreeMap<String, (u64, u64)>,
    pub manifests: Vec<(String, u64)>,
}

/// The facts garbage collection decides on.
pub struct Facts<'a> {
    /// Current devices, whose acks count.
    pub current: &'a BTreeSet<String>,
    /// Logs this device may delete from: its own and removed devices'.
    pub collectable: &'a BTreeSet<String>,
    pub link: &'a str,
    pub acks: &'a BTreeMap<String, VersionVector>,
    pub manifests: &'a [Logged],
    pub collected: &'a VersionVector,
}

impl Facts<'_> {
    /// The highest `seq` of `did`'s log that every current device has consumed. A device has all
    /// of its own log.
    fn acked(&self, did: &str) -> u64 {
        self.current
            .iter()
            .map(|reader| {
                if reader == did {
                    u64::MAX
                } else {
                    self.acks
                        .get(reader)
                        .and_then(|vv| vv.get(did))
                        .copied()
                        .unwrap_or(0)
                }
            })
            .min()
            .unwrap_or(0)
    }

    fn acknowledged(&self) -> impl Iterator<Item = &Logged> {
        self.manifests.iter().filter(|m| {
            m.manifest.link.as_deref() == Some(self.link) && self.acked(&m.did) >= m.seq
        })
    }

    fn superseded(&self, old: &Logged) -> bool {
        self.acknowledged().any(|newer| {
            (newer.did != old.did || newer.seq != old.seq)
                && newer.manifest.link == old.manifest.link
                && old
                    .manifest
                    .vv
                    .iter()
                    .all(|(did, seq)| newer.manifest.vv.get(did).is_some_and(|n| n >= seq))
        })
    }

    pub fn plan(&self) -> Plan {
        let mut plan = Plan::default();
        for did in self.collectable {
            let covered = self
                .acknowledged()
                .filter_map(|m| m.manifest.vv.get(did).copied())
                .max()
                .unwrap_or(0);
            let through = self.acked(did).min(covered);
            let from = self.collected.get(did).map_or(1, |c| c + 1);
            if through >= from {
                plan.logs.insert(did.clone(), (from, through));
            }
        }
        plan.manifests = self
            .manifests
            .iter()
            .filter(|m| self.collectable.contains(&m.did) && self.superseded(m))
            .map(|m| (m.did.clone(), m.seq))
            .collect();
        plan
    }
}

impl<S: Store> Session<'_, S> {
    /// Deletes what [`Facts::plan`] allows, a bounded amount per call.
    pub async fn collect_garbage(&self, pool: &SqlitePool) -> Result<()> {
        let current: BTreeSet<String> = self
            .roster()
            .members
            .iter()
            .filter(|(_, m)| m.role == Role::Device)
            .map(|(did, _)| did.clone())
            .collect();
        let me = hex::encode(self.device().did);
        let collectable: BTreeSet<String> = self
            .entries()
            .iter()
            .flat_map(|e| e.add.iter().flatten())
            .filter(|s| s.role == Role::Device && (s.did == me || !current.contains(&s.did)))
            .map(|s| s.did.clone())
            .collect();
        let (acks, manifests, collected) = (
            acks(pool).await?,
            manifests(pool).await?,
            collected(pool).await?,
        );
        let plan = Facts {
            current: &current,
            collectable: &collectable,
            link: &self.record().link,
            acks: &acks,
            manifests: &manifests,
            collected: &collected,
        }
        .plan();

        let mut budget = BUDGET;
        for (did, seq) in &plan.manifests {
            let Some(logged) = manifests.iter().find(|m| m.did == *did && m.seq == *seq) else {
                continue;
            };
            if budget < logged.manifest.parts.len() + 1 {
                return Ok(());
            }
            for part in &logged.manifest.parts {
                self.store()
                    .delete_object(&blob_path(did, &part.blob))
                    .await?;
            }
            self.store().delete_object(&log_path(did, *seq)).await?;
            sqlx::query("DELETE FROM sync2_manifests WHERE did = ? AND seq = ?")
                .bind(did)
                .bind(to_i64(*seq)?)
                .execute(pool)
                .await
                .map_err(SyncError::from)?;
            budget -= logged.manifest.parts.len() + 1;
        }
        for (did, (from, through)) in plan.logs {
            if budget == 0 {
                break;
            }
            let kept: BTreeSet<u64> = manifests
                .iter()
                .filter(|m| m.did == did)
                .map(|m| m.seq)
                .collect();
            let mut done = from - 1;
            for n in (from..=through).filter(|n| !kept.contains(n)).take(budget) {
                self.store().delete_object(&log_path(&did, n)).await?;
                budget -= 1;
                done = n;
            }
            if budget > 0 {
                done = through;
            }
            sqlx::query(
                "INSERT INTO sync2_collected (did, through) VALUES (?, ?)
                 ON CONFLICT (did) DO UPDATE SET through = excluded.through",
            )
            .bind(&did)
            .bind(to_i64(done)?)
            .execute(pool)
            .await
            .map_err(SyncError::from)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINK: &str = "link";

    fn vv(pairs: &[(&str, u64)]) -> VersionVector {
        pairs.iter().map(|(d, s)| ((*d).to_owned(), *s)).collect()
    }

    fn snapshot(did: &str, seq: u64, covers: &[(&str, u64)]) -> Logged {
        Logged {
            did: did.into(),
            seq,
            manifest: Manifest {
                head: String::new(),
                link: Some(LINK.into()),
                parts: Vec::new(),
                vv: vv(covers),
            },
        }
    }

    fn set(dids: &[&str]) -> BTreeSet<String> {
        dids.iter().map(|d| (*d).to_owned()).collect()
    }

    fn plan(
        current: &[&str],
        collectable: &[&str],
        acks: &[(&str, VersionVector)],
        manifests: &[Logged],
    ) -> Plan {
        let acks = acks
            .iter()
            .map(|(d, v)| ((*d).to_owned(), v.clone()))
            .collect();
        Facts {
            current: &set(current),
            collectable: &set(collectable),
            link: LINK,
            acks: &acks,
            manifests,
            collected: &VersionVector::new(),
        }
        .plan()
    }

    #[test]
    fn nothing_goes_before_every_device_acked_it_and_a_snapshot_covers_it() {
        let snap = [snapshot("a", 6, &[("a", 5)])];
        assert_eq!(plan(&["a", "b"], &["a"], &[], &snap), Plan::default());
        let acked = [("b", vv(&[("a", 6)]))];
        assert_eq!(plan(&["a", "b"], &["a"], &acked, &[]), Plan::default());
        assert_eq!(
            plan(&["a", "b"], &["a"], &acked, &snap).logs,
            BTreeMap::from([("a".to_owned(), (1, 5))])
        );
        let partly = [("b", vv(&[("a", 3)]))];
        assert_eq!(plan(&["a", "b"], &["a"], &partly, &snap), Plan::default());
    }

    #[test]
    fn a_removed_device_log_goes_once_the_remaining_devices_acked_it() {
        let snap = [snapshot("a", 9, &[("a", 8), ("gone", 4)])];
        let acks = [
            ("b", vv(&[("a", 9), ("gone", 4)])),
            ("a", vv(&[("gone", 4)])),
        ];
        let plan = plan(&["a", "b"], &["a", "gone"], &acks, &snap);
        assert_eq!(plan.logs["gone"], (1, 4));
    }

    #[test]
    fn a_snapshot_goes_once_a_newer_acknowledged_one_covers_it() {
        let old = snapshot("a", 3, &[("a", 2), ("b", 1)]);
        let new = snapshot("a", 7, &[("a", 6), ("b", 4)]);
        let acks = [("b", vv(&[("a", 7)]))];
        let manifests = [old, new];
        assert_eq!(
            plan(&["a", "b"], &["a"], &acks, &manifests).manifests,
            [("a".to_owned(), 3)]
        );
        let unacked = [("b", vv(&[("a", 4)]))];
        assert!(
            plan(&["a", "b"], &["a"], &unacked, &manifests)
                .manifests
                .is_empty()
        );
    }
}
