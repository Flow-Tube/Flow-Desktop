//! The signed, hash-chained roster (spec/protocol.md, Roster).

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::curve::{is_valid_signing_key, verify};
use super::kdf::{sha256, tag};
use super::keys::member_id;
use super::{Error, Result, array};
use crate::sync::canonical::to_canonical_json;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Device,
    Recovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Genesis,
    Add,
    Remove,
    Leave,
    Rotate,
    Rename,
    Restore,
    Recovery,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Subject {
    pub did: String,
    pub sig: String,
    pub kem: String,
    pub role: Role,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EpochField {
    pub n: u32,
    pub kc: String,
    pub to: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub v: u8,
    pub group: String,
    pub seq: u64,
    pub prev: String,
    pub op: Op,
    pub signer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add: Option<Vec<Subject>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<EpochField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<BTreeMap<String, String>>,
    pub sigs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub sig: [u8; 32],
    pub kem: [u8; 32],
    pub role: Role,
    pub used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterState {
    pub group: String,
    pub seq: u64,
    pub head: String,
    pub epoch: u32,
    pub kc: String,
    /// A device left in this epoch, so the next device to write must rotate first.
    pub rotate: bool,
    pub members: BTreeMap<String, Member>,
    pub seen: BTreeSet<String>,
}

fn is_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn b64<const N: usize>(value: &str) -> Option<[u8; N]> {
    URL_SAFE_NO_PAD
        .decode(value)
        .ok()
        .filter(|bytes| bytes.len() == N)
        .map(|bytes| array(&bytes))
}

fn well_formed(entry: &Entry) -> bool {
    let dids = |list: &[String]| !list.is_empty() && list.iter().all(|d| is_hex(d, 16));
    entry.v == 2
        && is_hex(&entry.group, 16)
        && is_hex(&entry.prev, 32)
        && is_hex(&entry.signer, 16)
        && entry.add.as_ref().is_none_or(|add| {
            !add.is_empty()
                && add.iter().all(|s| {
                    is_hex(&s.did, 16) && b64::<32>(&s.sig).is_some() && b64::<32>(&s.kem).is_some()
                })
        })
        && entry.remove.as_deref().is_none_or(dids)
        && entry
            .epoch
            .as_ref()
            .is_none_or(|e| b64::<32>(&e.kc).is_some() && dids(&e.to))
        && entry
            .meta
            .as_ref()
            .is_none_or(|m| m.iter().all(|(d, v)| is_hex(d, 16) && !v.is_empty()))
        && entry
            .sigs
            .iter()
            .all(|(d, s)| is_hex(d, 16) && b64::<64>(s).is_some())
}

/// Accepts only an entry that re-serializes to exactly the canonical JSON it came from, so no
/// two implementations can read one entry differently.
pub fn parse_entry(value: &Value) -> Result<Entry> {
    let entry: Entry = serde_json::from_value(value.clone()).map_err(|_| Error::RosterFormat)?;
    if !well_formed(&entry) || to_canonical_json(&entry) != to_canonical_json(value) {
        return Err(Error::RosterFormat);
    }
    Ok(entry)
}

pub fn signing_bytes(entry: &Entry) -> Vec<u8> {
    let mut value = serde_json::to_value(entry).unwrap_or_default();
    if let Some(object) = value.as_object_mut() {
        object.remove("sigs");
    }
    [tag("roster"), to_canonical_json(&value)].concat()
}

pub fn entry_hash(entry: &Entry) -> String {
    hex::encode(sha256(&to_canonical_json(entry)))
}

fn strictly_sorted<'a>(mut values: impl Iterator<Item = &'a String>) -> bool {
    let Some(mut previous) = values.next() else {
        return true;
    };
    values.all(|value| std::mem::replace(&mut previous, value) < value)
}

/// The op table from protocol.md: how many subjects an op adds, and whether it removes or
/// starts an epoch.
fn check_shape(entry: &Entry) -> Result<()> {
    let (add, remove, epoch) = match entry.op {
        Op::Genesis => (2, false, true),
        Op::Add | Op::Restore => (1, false, entry.op == Op::Restore),
        Op::Remove => (0, true, true),
        Op::Leave => (0, true, false),
        Op::Rotate => (0, false, true),
        Op::Rename => (0, false, false),
        Op::Recovery => (1, true, true),
    };
    let added = entry.add.as_ref().map_or(0, Vec::len);
    if added != add || remove != entry.remove.is_some() || epoch != entry.epoch.is_some() {
        return Err(Error::RosterOp);
    }
    let sorted = entry
        .add
        .as_ref()
        .is_none_or(|a| strictly_sorted(a.iter().map(|s| &s.did)))
        && entry
            .remove
            .as_ref()
            .is_none_or(|r| strictly_sorted(r.iter()))
        && entry
            .epoch
            .as_ref()
            .is_none_or(|e| strictly_sorted(e.to.iter()));
    if !sorted {
        return Err(Error::RosterFormat);
    }
    let mut roles: Vec<Role> = entry.add.iter().flatten().map(|s| s.role).collect();
    roles.sort();
    let expected: &[Role] = match entry.op {
        Op::Genesis => &[Role::Device, Role::Recovery],
        Op::Recovery => &[Role::Recovery],
        _ => &[Role::Device],
    };
    if added > 0 && roles != expected {
        return Err(Error::RosterOp);
    }
    Ok(())
}

fn check_subject(subject: &Subject, seen: &BTreeSet<String>) -> Result<Member> {
    let (Some(sig), Some(kem)) = (b64::<32>(&subject.sig), b64::<32>(&subject.kem)) else {
        return Err(Error::RosterFormat);
    };
    if !is_valid_signing_key(&sig)
        || hex::encode(member_id(&sig, &kem)) != subject.did
        || seen.contains(&subject.did)
    {
        return Err(Error::RosterKey);
    }
    Ok(Member {
        sig,
        kem,
        role: subject.role,
        used: false,
    })
}

fn check_signer(
    entry: &Entry,
    state: Option<&RosterState>,
    added: &BTreeMap<String, Member>,
) -> Result<Member> {
    let signer = if entry.op == Op::Genesis {
        added.get(&entry.signer).filter(|m| m.role == Role::Device)
    } else {
        let wanted = if entry.op == Op::Restore {
            Role::Recovery
        } else {
            Role::Device
        };
        state
            .and_then(|s| s.members.get(&entry.signer))
            .filter(|m| m.role == wanted && !m.used)
    };
    signer.cloned().ok_or(Error::RosterSigner)
}

fn check_chain(state: Option<&RosterState>, entry: &Entry) -> Result<()> {
    let linked = match state {
        Some(state) => {
            entry.group == state.group
                && entry.seq == state.seq + 1
                && entry.prev == state.head
                && entry.op != Op::Genesis
        }
        None => entry.op == Op::Genesis && entry.seq == 0 && entry.prev == hex::encode([0; 32]),
    };
    if linked {
        Ok(())
    } else {
        Err(Error::RosterChain)
    }
}

/// Applies one entry to the state before it, or says why it is not valid.
pub fn apply_entry(state: Option<&RosterState>, entry: &Entry) -> Result<RosterState> {
    check_chain(state, entry)?;
    check_shape(entry)?;

    let mut seen = state.map(|s| s.seen.clone()).unwrap_or_default();
    let mut added = BTreeMap::new();
    for subject in entry.add.iter().flatten() {
        added.insert(subject.did.clone(), check_subject(subject, &seen)?);
    }

    let signer = check_signer(entry, state, &added)?;
    let signers: BTreeSet<&String> = std::iter::once(&entry.signer).chain(added.keys()).collect();
    if !entry.sigs.keys().eq(signers.iter().copied()) {
        return Err(Error::RosterSignature);
    }
    let message = signing_bytes(entry);
    for (id, signature) in &entry.sigs {
        let key = if *id == entry.signer {
            signer.sig
        } else {
            added[id].sig
        };
        let valid = b64::<64>(signature).is_some_and(|sig| verify(&key, &message, &sig));
        if !valid {
            return Err(Error::RosterSignature);
        }
    }

    let mut members = state.map(|s| s.members.clone()).unwrap_or_default();
    let removed_role = if entry.op == Op::Recovery {
        Role::Recovery
    } else {
        Role::Device
    };
    for id in entry.remove.iter().flatten() {
        let wrong_target = (*id == entry.signer) != (entry.op == Op::Leave);
        if wrong_target || members.get(id).is_none_or(|m| m.role != removed_role) {
            return Err(Error::RosterOp);
        }
        members.remove(id);
    }
    if entry.op == Op::Leave && !members.values().any(|m| m.role == Role::Device) {
        return Err(Error::RosterOp);
    }
    if entry.op == Op::Restore {
        members.insert(
            entry.signer.clone(),
            Member {
                used: true,
                ..signer
            },
        );
    }
    for (id, member) in added {
        seen.insert(id.clone());
        members.insert(id, member);
    }

    match &entry.meta {
        Some(meta) => {
            let renamed_device = meta.len() == 1
                && meta
                    .keys()
                    .all(|id| members.get(id).is_some_and(|m| m.role == Role::Device));
            if !meta.keys().all(|id| members.contains_key(id))
                || (entry.op == Op::Rename && !renamed_device)
            {
                return Err(Error::RosterMeta);
            }
        }
        None if entry.op == Op::Rename => return Err(Error::RosterMeta),
        None => {}
    }

    if let Some(epoch) = &entry.epoch {
        let expected = state.map_or(0, |s| s.epoch + 1);
        if epoch.n != expected || !epoch.to.iter().eq(members.keys()) {
            return Err(Error::RosterEpoch);
        }
    }

    Ok(RosterState {
        group: entry.group.clone(),
        seq: entry.seq,
        head: entry_hash(entry),
        epoch: entry
            .epoch
            .as_ref()
            .map_or_else(|| state.map_or(0, |s| s.epoch), |e| e.n),
        kc: entry.epoch.as_ref().map_or_else(
            || state.map(|s| s.kc.clone()).unwrap_or_default(),
            |e| e.kc.clone(),
        ),
        rotate: entry.op == Op::Leave || (entry.epoch.is_none() && state.is_some_and(|s| s.rotate)),
        members,
        seen,
    })
}

pub fn replay_roster(entries: &[Entry]) -> Result<RosterState> {
    let mut state = None;
    for entry in entries {
        state = Some(apply_entry(state.as_ref(), entry)?);
    }
    state.ok_or(Error::RosterChain)
}

fn rank(op: Op) -> u8 {
    match op {
        Op::Remove => 0,
        Op::Leave => 1,
        Op::Recovery => 2,
        Op::Restore => 3,
        Op::Rotate => 4,
        Op::Add => 5,
        Op::Rename => 6,
        Op::Genesis => 7,
    }
}

/// Picks the winner among valid entries competing for the same `seq` on a store without
/// ordering: removal first, then the lowest entry hash.
pub fn fork_winner(candidates: &[Entry]) -> Option<&Entry> {
    candidates
        .iter()
        .min_by_key(|entry| (rank(entry.op), entry_hash(entry)))
}
