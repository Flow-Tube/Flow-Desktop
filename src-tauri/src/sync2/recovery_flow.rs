//! Restoring a group with the recovery key (spec/protocol.md, Recovery): the recovery member adds
//! a new device and starts an epoch, then the new device replaces the used key straight away. Any
//! device can replace the key the same way, so leaked words stop working.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{EngineError, Result, Session};
use super::entries::{Draft, build_entry, member_subject};
use super::epoch::{check_epoch_key, open_chain};
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::membership::{append_checked, members_after, new_epoch};
use super::meta::seal_device_meta;
use super::names::open_sealed_name;
use super::paths::kc_name;
use super::recovery::{recovery_keys, recovery_words};
use super::roster::{Entry, Op, Role, RosterState, apply_entry, replay_roster};
use super::sealed::random_bytes;
use super::server::Appended;
use super::store::Store;
use super::wrap::unwrap_epoch_key;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;

/// The roster after a restore, and the new recovery words to show once.
pub struct Restored {
    pub entries: Vec<Entry>,
    pub words: String,
}

async fn append<S: Store>(
    store: &S,
    state: &RosterState,
    entry: &Entry,
    wraps: &BTreeMap<String, String>,
    chain: &str,
) -> Result<RosterState> {
    let after = apply_entry(Some(state), entry)?;
    match store
        .append_roster(&state.head, entry, wraps, Some(chain))
        .await?
    {
        Appended::Done => Ok(after),
        Appended::Conflict { .. } => Err(Error::RosterChain.into()),
    }
}

/// A `recovery` entry that replaces the recovery member `old` and starts an epoch it never
/// receives, with its wraps and chain box, and the new key's words.
struct Replacement {
    entry: Entry,
    wraps: BTreeMap<String, String>,
    chain: String,
    words: String,
}

fn replacement(
    group: &[u8; 16],
    state: &RosterState,
    device: &MemberSecrets,
    old: &str,
    current_key: &[u8],
) -> Result<Replacement> {
    let secret: [u8; 32] = random_bytes();
    let next = recovery_keys(&secret);
    let epoch = new_epoch(
        group,
        state.epoch + 1,
        &members_after(state, &[old.to_owned()], &[&next])?,
        current_key,
    )?;
    let draft = Draft {
        op: Op::Recovery,
        signer: hex::encode(device.did),
        add: Some(vec![member_subject(
            &next.sig_public,
            &next.kem_public,
            Role::Recovery,
        )]),
        remove: Some(vec![old.to_owned()]),
        cut: None,
        epoch: Some(epoch.field),
        meta: None,
    };
    Ok(Replacement {
        entry: build_entry(group, Some(state), draft, &[device, &next]),
        wraps: epoch.wraps,
        chain: epoch.chain,
        words: recovery_words(&secret),
    })
}

/// Replaces the group's recovery key from this device and returns the new words to show once.
pub async fn replace_recovery_key<S: Store>(
    session: &Session<'_, S>,
    device: &MemberSecrets,
) -> Result<String> {
    let state = session.roster();
    let old = state
        .members
        .iter()
        .find(|(_, member)| member.role == Role::Recovery)
        .map(|(did, _)| did.clone())
        .ok_or(Error::RosterFormat)?;
    let replaced = replacement(session.group(), state, device, &old, session.current_key())?;
    append_checked(
        session,
        &replaced.entry,
        &replaced.wraps,
        Some(&replaced.chain),
    )
    .await?;
    Ok(replaced.words)
}

/// What the recovery key can see of a group before anything is written.
struct RecoveryView {
    entries: Vec<Entry>,
    state: RosterState,
    group: [u8; 16],
    current: Vec<u8>,
}

/// Reads and verifies the roster, and opens the latest key from the recovery member's wrap.
async fn recovery_view<S: Store>(store: &S, recovery: &MemberSecrets) -> Result<RecoveryView> {
    let entries = store.roster_after(-1).await?;
    let state = replay_roster(&entries)?;
    let recovery_id = hex::encode(recovery.did);
    if state.members.get(&recovery_id).is_none_or(|m| m.used) {
        return Err(EngineError::RecoveryUsed);
    }
    let group: [u8; 16] = array(&hex::decode(&state.group).map_err(|_| Error::Group)?);
    let commitment = decode_kc(&state.kc)?;
    let wrap = store
        .key(state.epoch, &kc_name(&commitment), &recovery_id)
        .await?
        .ok_or(Error::KeyCommitment)?;
    let current = unwrap_epoch_key(
        &recovery.kem_secret,
        &group,
        state.epoch,
        &recovery.did,
        &wrap,
    )?;
    check_epoch_key(&current, &group, state.epoch, &commitment)?;
    Ok(RecoveryView {
        entries,
        state,
        group,
        current,
    })
}

fn decode_kc(kc: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(kc)
        .map_err(|_| Error::RosterFormat.into())
}

/// A device the user is asked about before a restore. Its name is `None` when it can't be read.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RestoreDevice {
    pub did: String,
    pub name: Option<String>,
    pub platform: Option<String>,
}

/// The group's current devices, for the user to choose from. Writes nothing.
pub async fn preview_restore<S: Store>(
    store: &S,
    recovery: &MemberSecrets,
) -> Result<Vec<RestoreDevice>> {
    let view = recovery_view(store, recovery).await?;
    let names = names_on_roster(store, &view).await?;
    Ok(view
        .state
        .members
        .iter()
        .filter(|(_, member)| member.role == Role::Device)
        .map(|(did, _)| {
            let meta = names.get(did);
            RestoreDevice {
                did: did.clone(),
                name: meta.map(|m| m.name.clone()),
                platform: meta.map(|m| m.platform.clone()),
            }
        })
        .collect())
}

/// The latest readable name of each device, walking the history chain down from the latest key
/// as far as the store gives it.
async fn names_on_roster<S: Store>(
    store: &S,
    view: &RecoveryView,
) -> Result<BTreeMap<String, DeviceMeta>> {
    let mut sealed = Vec::new();
    let mut state = None;
    for entry in &view.entries {
        let after = apply_entry(state.as_ref(), entry)?;
        for (did, name) in entry.meta.iter().flatten() {
            sealed.push((after.epoch, entry.seq, did, name));
        }
        state = Some(after);
    }
    let commitments: BTreeMap<u32, &str> = view
        .entries
        .iter()
        .filter_map(|e| e.epoch.as_ref())
        .map(|e| (e.n, e.kc.as_str()))
        .collect();
    let mut names = BTreeMap::new();
    let (mut epoch, mut key) = (view.state.epoch, view.current.clone());
    // Newest first, so the first name found for a device is its latest.
    for (at, seq, did, name) in sealed.into_iter().rev() {
        while epoch > at {
            let Some(previous) =
                previous_key(store, &view.group, &commitments, epoch, &key).await?
            else {
                return Ok(names);
            };
            key = previous;
            epoch -= 1;
        }
        if !names.contains_key(did)
            && let Some(meta) = open_sealed_name(&key, &view.group, (at, seq), did, name)
        {
            names.insert(did.clone(), meta);
        }
    }
    Ok(names)
}

/// The key of `epoch - 1` from the history chain box of `epoch`, or `None` when it can't be had.
async fn previous_key<S: Store>(
    store: &S,
    group: &[u8; 16],
    commitments: &BTreeMap<u32, &str>,
    epoch: u32,
    key: &[u8],
) -> Result<Option<Vec<u8>>> {
    let (Some(kc), Some(below)) = (commitments.get(&epoch), commitments.get(&(epoch - 1))) else {
        return Ok(None);
    };
    let Some(chain) = store.key(epoch, &kc_name(&decode_kc(kc)?), "chain").await? else {
        return Ok(None);
    };
    let below = decode_kc(below)?;
    Ok(open_chain(key, group, epoch, &chain)
        .and_then(|previous| {
            check_epoch_key(&previous, group, epoch - 1, &below).map(|()| previous)
        })
        .ok())
}

/// `as_recovery` is the store signed in as the recovery member, `as_device` as the new device.
pub async fn restore<S: Store>(
    as_recovery: &S,
    as_device: &S,
    recovery: &MemberSecrets,
    device: &MemberSecrets,
    meta: &DeviceMeta,
) -> Result<Restored> {
    let RecoveryView {
        state,
        group,
        current,
        ..
    } = recovery_view(as_recovery, recovery).await?;
    let recovery_id = hex::encode(recovery.did);

    let restored = new_epoch(
        &group,
        state.epoch + 1,
        &members_after(&state, &[], &[device])?,
        &current,
    )?;
    let sealed_meta = seal_device_meta(
        &restored.key,
        &group,
        state.epoch + 1,
        state.seq + 1,
        &device.did,
        &to_canonical_json(meta),
    )?;
    let draft = Draft {
        op: Op::Restore,
        signer: recovery_id.clone(),
        add: Some(vec![member_subject(
            &device.sig_public,
            &device.kem_public,
            Role::Device,
        )]),
        remove: None,
        cut: None,
        epoch: Some(restored.field),
        meta: Some(BTreeMap::from([(
            hex::encode(device.did),
            URL_SAFE_NO_PAD.encode(sealed_meta),
        )])),
    };
    let entry = build_entry(&group, Some(&state), draft, &[recovery, device]);
    let state = append(
        as_recovery,
        &state,
        &entry,
        &restored.wraps,
        &restored.chain,
    )
    .await?;

    let replaced = replacement(&group, &state, device, &recovery_id, &restored.key)?;
    append(
        as_device,
        &state,
        &replaced.entry,
        &replaced.wraps,
        &replaced.chain,
    )
    .await?;

    Ok(Restored {
        entries: as_device.roster_after(-1).await?,
        words: replaced.words,
    })
}
