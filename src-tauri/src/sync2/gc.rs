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

/// Deletions per sync, well inside the server's 600 requests per device per minute.
const BUDGET: usize = 100;

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

/// Remembers the links batches named, so garbage collection waits for a snapshot of each.
pub async fn record_links(pool: &SqlitePool, links: &[Option<String>]) -> Result<()> {
    for link in links.iter().collect::<BTreeSet<_>>() {
        sqlx::query("INSERT OR IGNORE INTO sync2_links (link) VALUES (?)")
            .bind(json(link))
            .execute(pool)
            .await
            .map_err(SyncError::from)?;
    }
    Ok(())
}

async fn links(pool: &SqlitePool) -> Result<BTreeSet<Option<String>>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT link FROM sync2_links")
        .fetch_all(pool)
        .await
        .map_err(SyncError::from)?;
    rows.iter()
        .map(|link| Ok(serde_json::from_str(link).map_err(SyncError::from)?))
        .collect()
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
    /// Every link batches named, each of which needs an acknowledged snapshot.
    pub links: &'a BTreeSet<Option<String>>,
    pub acks: &'a BTreeMap<String, VersionVector>,
    pub manifests: &'a [Logged],
    pub collected: &'a VersionVector,
}

impl Facts<'_> {
    /// The highest `seq` of `did`'s log that every current device other than `did` has acked.
    fn acked(&self, did: &str) -> u64 {
        self.current
            .iter()
            .filter(|reader| *reader != did)
            .map(|reader| {
                self.acks
                    .get(reader)
                    .and_then(|vv| vv.get(did))
                    .copied()
                    .unwrap_or(0)
            })
            .min()
            .unwrap_or(u64::MAX)
    }

    /// Snapshots of `link` that every current device has acked.
    fn acknowledged<'s>(&'s self, link: Option<&'s str>) -> impl Iterator<Item = &'s Logged> {
        self.manifests
            .iter()
            .filter(move |m| m.manifest.link.as_deref() == link && self.acked(&m.did) >= m.seq)
    }

    fn superseded(&self, old: &Logged) -> bool {
        self.acknowledged(old.manifest.link.as_deref())
            .any(|newer| {
                (newer.did != old.did || newer.seq != old.seq)
                    && old.manifest.vv.iter().all(|(did, tip)| {
                        newer.manifest.vv.get(did).is_some_and(|n| n.seq >= tip.seq)
                    })
            })
    }

    /// The highest `seq` of `did`'s log that an acknowledged snapshot of every link includes.
    fn covered(&self, did: &str) -> u64 {
        self.links
            .iter()
            .map(|link| {
                self.acknowledged(link.as_deref())
                    .filter_map(|m| m.manifest.vv.get(did).map(|tip| tip.seq))
                    .max()
                    .unwrap_or(0)
            })
            .min()
            .unwrap_or(0)
    }

    pub fn plan(&self) -> Plan {
        let mut plan = Plan::default();
        for did in self.collectable {
            let covered = self.covered(did);
            let through = self.acked(did).min(covered);
            let from = self.collected.get(did).map_or(1, |c| c + 1);
            if through >= from {
                plan.logs.insert(did.clone(), (from, through));
            }
        }
        // A manifest is an object of its writer's log too: readers wait at a gap, so it stays until
        // every other current device has read past it (flow-sync#43).
        plan.manifests = self
            .manifests
            .iter()
            .filter(|m| {
                self.collectable.contains(&m.did)
                    && self.superseded(m)
                    && self.acked(&m.did) >= m.seq
            })
            .map(|m| (m.did.clone(), m.seq))
            .collect();
        plan
    }
}

impl<S: Store> Session<'_, S> {
    /// Deletes one object, and whether it was still there; `None` when the store refused, which
    /// ends the pass so collecting never crowds out the requests that sync (a 429 among them).
    async fn delete_or_stop(&self, path: &str) -> Option<bool> {
        match self.store().delete_object(path).await {
            Ok(found) => Some(found),
            Err(error) => {
                tracing::debug!(target: "flow::sync2", %error, "garbage collection paused");
                None
            }
        }
    }

    /// Deletes `did`'s log objects in `from..=through`, all but the `kept` manifests, and saves how
    /// far it got. False when the store refused, which ends the pass.
    async fn collect_log(
        &self,
        pool: &SqlitePool,
        did: &str,
        (from, through): (u64, u64),
        kept: &BTreeSet<u64>,
        budget: &mut usize,
    ) -> Result<bool> {
        let mut done = from - 1;
        let mut stopped = false;
        for n in (from..=through).filter(|n| !kept.contains(n)) {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            match self.delete_or_stop(&log_path(did, n)).await {
                Some(true) => done = n,
                // Gone already: another device collected this range, or this one did before.
                Some(false) => {
                    done = through;
                    break;
                }
                None => {
                    stopped = true;
                    break;
                }
            }
        }
        if *budget > 0 && !stopped {
            done = through;
        }
        sqlx::query(
            "INSERT INTO sync2_collected (did, through) VALUES (?, ?)
             ON CONFLICT (did) DO UPDATE SET through = excluded.through",
        )
        .bind(did)
        .bind(to_i64(done)?)
        .execute(pool)
        .await
        .map_err(SyncError::from)?;
        Ok(!stopped)
    }

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
        let mut links = links(pool).await?;
        links.insert(Some(self.record().link.clone()));
        let plan = Facts {
            current: &current,
            collectable: &collectable,
            links: &links,
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
            let paths = logged
                .manifest
                .parts
                .iter()
                .map(|part| blob_path(did, &part.blob))
                .chain([log_path(did, *seq)]);
            for path in paths {
                if self.delete_or_stop(&path).await.is_none() {
                    return Ok(());
                }
            }
            sqlx::query("DELETE FROM sync2_manifests WHERE did = ? AND seq = ?")
                .bind(did)
                .bind(to_i64(*seq)?)
                .execute(pool)
                .await
                .map_err(SyncError::from)?;
            budget -= logged.manifest.parts.len() + 1;
        }
        for (did, range) in plan.logs {
            let kept: BTreeSet<u64> = manifests
                .iter()
                .filter(|m| m.did == did)
                .map(|m| m.seq)
                .collect();
            if budget == 0
                || !self
                    .collect_log(pool, &did, range, &kept, &mut budget)
                    .await?
            {
                break;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync2::snapshot::Tip;

    const LINK: &str = "link";

    fn vv(pairs: &[(&str, u64)]) -> VersionVector {
        pairs.iter().map(|(d, s)| ((*d).to_owned(), *s)).collect()
    }

    fn snapshot(did: &str, seq: u64, covers: &[(&str, u64)]) -> Logged {
        snapshot_of(Some(LINK), did, seq, covers)
    }

    fn snapshot_of(link: Option<&str>, did: &str, seq: u64, covers: &[(&str, u64)]) -> Logged {
        let tip = |seq: u64| Tip {
            hash: String::new(),
            seq,
        };
        Logged {
            did: did.into(),
            seq,
            manifest: Manifest {
                head: String::new(),
                link: link.map(str::to_owned),
                parts: Vec::new(),
                vv: covers
                    .iter()
                    .map(|(d, s)| ((*d).to_owned(), tip(*s)))
                    .collect(),
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
        plan_for(&[Some(LINK)], current, collectable, acks, manifests)
    }

    fn plan_for(
        links: &[Option<&str>],
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
            links: &links.iter().map(|l| l.map(str::to_owned)).collect(),
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

    #[test]
    fn every_link_batches_name_needs_an_acknowledged_snapshot() {
        let acks = [("b", vv(&[("a", 9)]))];
        let snap = [snapshot("a", 6, &[("a", 5)])];
        let links = [Some(LINK), None];
        assert_eq!(
            plan_for(&links, &["a", "b"], &["a"], &acks, &snap),
            Plan::default()
        );
        let both = [
            snapshot("a", 6, &[("a", 5)]),
            snapshot_of(None, "a", 8, &[("a", 7)]),
        ];
        assert_eq!(
            plan_for(&links, &["a", "b"], &["a"], &acks, &both).logs,
            BTreeMap::from([("a".to_owned(), (1, 5))])
        );
    }

    #[test]
    fn a_superseded_snapshot_stays_until_every_device_read_past_it() {
        let own = snapshot("a", 573, &[("a", 572), ("b", 540)]);
        let newer = snapshot("b", 544, &[("a", 572), ("b", 543)]);
        let manifests = [own, newer];
        let read_to_572 = [("a", vv(&[("b", 544)])), ("b", vv(&[("a", 572)]))];
        assert!(
            plan(&["a", "b"], &["a"], &read_to_572, &manifests)
                .manifests
                .is_empty()
        );
        let read_past = [("a", vv(&[("b", 544)])), ("b", vv(&[("a", 573)]))];
        assert_eq!(
            plan(&["a", "b"], &["a"], &read_past, &manifests).manifests,
            [("a".to_owned(), 573)]
        );
    }
}
