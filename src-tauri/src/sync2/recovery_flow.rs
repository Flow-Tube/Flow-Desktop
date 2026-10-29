//! Restoring a group with the recovery key (spec/protocol.md, Recovery): the recovery member adds
//! a new device and starts an epoch, then the new device replaces the used key straight away.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{EngineError, Result};
use super::entries::{Draft, build_entry, member_subject};
use super::epoch::check_epoch_key;
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::membership::new_epoch;
use super::meta::seal_device_meta;
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
    let wrap = as_recovery
        .key(state.epoch, &recovery_id)
        .await?
        .ok_or(Error::KeyCommitment)?;
    let current = unwrap_epoch_key(
        &recovery.kem_secret,
        &group,
        state.epoch,
        &recovery.did,
        &wrap,
    )?;
    check_epoch_key(
        &current,
        &group,
        state.epoch,
        &URL_SAFE_NO_PAD
            .decode(&state.kc)
            .map_err(|_| Error::RosterFormat)?,
    )?;

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

    let secret: [u8; 32] = random_bytes();
    let next = recovery_keys(&secret);
    let replaced = new_epoch(
        &group,
        state.epoch + 1,
        &members_with(&state, &recovery_id, &[&next])?,
        &restored.key,
    )?;
    let draft = Draft {
        op: Op::Recovery,
        signer: hex::encode(device.did),
        add: Some(vec![member_subject(
            &next.sig_public,
            &next.kem_public,
            Role::Recovery,
        )]),
        remove: Some(vec![recovery_id]),
        epoch: Some(replaced.field),
        meta: None,
    };
    let entry = build_entry(&group, Some(&state), draft, &[device, &next]);
    append(as_device, &state, &entry, &replaced.wraps, &replaced.chain).await?;

    Ok(Restored {
        entries: as_device.roster_after(-1).await?,
        words: recovery_words(&secret),
    })
}
