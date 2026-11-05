//! Restoring a group with the recovery key (spec/protocol.md, Recovery): the recovery member adds
//! a new device and starts an epoch, then the new device replaces the used key straight away. Any
//! device can replace the key the same way, so leaked words stop working.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{EngineError, Result, Session};
use super::entries::{Draft, build_entry, member_subject};
use super::epoch::check_epoch_key;
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::membership::{append_checked, new_epoch};
use super::meta::seal_device_meta;
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

fn members_with(
    state: &RosterState,
    without: &str,
    extra: &[&MemberSecrets],
) -> Result<Vec<([u8; 16], [u8; 32])>> {
    let mut members = Vec::new();
    for (did, member) in state
        .members
        .iter()
        .filter(|(did, _)| did.as_str() != without)
    {
        members.push((
            array(&hex::decode(did).map_err(|_| Error::RosterFormat)?),
            member.kem,
        ));
    }
    members.extend(extra.iter().map(|m| (m.did, m.kem_public)));
    Ok(members)
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
        &members_with(state, old, &[&next])?,
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

/// `as_recovery` is the store signed in as the recovery member, `as_device` as the new device.
pub async fn restore<S: Store>(
    as_recovery: &S,
    as_device: &S,
    recovery: &MemberSecrets,
    device: &MemberSecrets,
    meta: &DeviceMeta,
) -> Result<Restored> {
    let roster = as_recovery.roster_after(-1).await?;
    let state = replay_roster(&roster)?;
    let recovery_id = hex::encode(recovery.did);
    if state.members.get(&recovery_id).is_none_or(|m| m.used) {
        return Err(EngineError::RecoveryUsed);
    }
    let group: [u8; 16] = array(&hex::decode(&state.group).map_err(|_| Error::Group)?);
    let commitment = URL_SAFE_NO_PAD
        .decode(&state.kc)
        .map_err(|_| Error::RosterFormat)?;
    let wrap = as_recovery
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

    let restored = new_epoch(
        &group,
        state.epoch + 1,
        &members_with(&state, "", &[device])?,
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
