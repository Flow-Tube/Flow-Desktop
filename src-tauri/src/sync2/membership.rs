//! Changing who is in the group: removing a device, which starts a new epoch, and renaming one.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::engine::{Result, Session};
use super::entries::{Draft, build_entry, epoch_draft, member_subject};
use super::envelope::StreamPosition;
use super::epoch::seal_chain;
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::meta::seal_device_meta;
use super::recovery::{recovery_keys, recovery_words};
use super::roster::{
    Cut, Entry, EpochField, Op, Role, RosterState, apply_entry, installer_gone, recovery_member,
};
use super::sealed::random_bytes;
use super::server::Appended;
use super::state::streams;
use super::store::Store;
use super::wrap::wrap_epoch_key;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;

/// A fresh epoch key, wrapped to every member after a change, with the previous key chained.
pub struct NewEpoch {
    pub key: [u8; 32],
    pub field: EpochField,
    pub wraps: BTreeMap<String, String>,
    pub chain: String,
}

/// `members` are the ids and X25519 keys of everyone in the group after the change.
pub fn new_epoch(
    group: &[u8; 16],
    n: u32,
    members: &[([u8; 16], [u8; 32])],
    previous_key: &[u8],
) -> Result<NewEpoch> {
    let key: [u8; 32] = random_bytes();
    let ids: Vec<[u8; 16]> = members.iter().map(|(did, _)| *did).collect();
    let mut wraps = BTreeMap::new();
    for (did, kem) in members {
        wraps.insert(
            hex::encode(did),
            URL_SAFE_NO_PAD.encode(wrap_epoch_key(kem, group, n, did, &key)?),
        );
    }
    Ok(NewEpoch {
        key,
        field: epoch_draft(&key, group, n, &ids),
        wraps,
        chain: URL_SAFE_NO_PAD.encode(seal_chain(&key, group, n, previous_key)),
    })
}

/// The ids and X25519 keys of every member, except `except`.
pub fn member_keys(state: &RosterState, except: Option<&str>) -> Result<Vec<([u8; 16], [u8; 32])>> {
    state
        .members
        .iter()
        .filter(|(did, _)| Some(did.as_str()) != except)
        .map(|(did, member)| hex::decode(did).map(|id| (array(&id), member.kem)))
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| Error::RosterFormat.into())
}

/// The ids and X25519 keys of everyone after `gone` leave and `joining` come in.
pub(super) fn members_after(
    state: &RosterState,
    gone: &[String],
    joining: &[&MemberSecrets],
) -> Result<Vec<([u8; 16], [u8; 32])>> {
    let mut members = Vec::new();
    for (did, member) in state.members.iter().filter(|(did, _)| !gone.contains(did)) {
        members.push((
            array(&hex::decode(did).map_err(|_| Error::RosterFormat)?),
            member.kem,
        ));
    }
    members.extend(joining.iter().map(|m| (m.did, m.kem_public)));
    Ok(members)
}

/// Checks an entry against the roster this session verified, then appends it.
pub async fn append_checked<S: Store>(
    session: &Session<'_, S>,
    entry: &Entry,
    wraps: &BTreeMap<String, String>,
    chain: Option<&str>,
) -> Result<()> {
    let state = session.roster();
    apply_entry(Some(state), entry)?;
    match session
        .store()
        .append_roster(&state.head, entry, wraps, chain)
        .await?
    {
        Appended::Done => Ok(()),
        Appended::Conflict { .. } => Err(Error::RosterChain.into()),
    }
}

/// Removes `removed` and starts a new epoch it never receives. The store also refuses it at once.
///
/// When the device that set the recovery key goes, the same entry replaces it (spec/protocol.md,
/// Validation rule 8), and this returns the new words to show once.
pub async fn remove_devices<S: Store>(
    pool: &SqlitePool,
    session: &Session<'_, S>,
    device: &MemberSecrets,
    removed: &[String],
) -> Result<Option<String>> {
    remove_at(session, device, removed, &streams(pool).await?).await
}

/// [`remove_devices`], ending each removed device's log at `positions`.
pub(super) async fn remove_at<S: Store>(
    session: &Session<'_, S>,
    device: &MemberSecrets,
    removed: &[String],
    positions: &BTreeMap<String, StreamPosition>,
) -> Result<Option<String>> {
    let state = session.roster();
    let cut: BTreeMap<String, Cut> = removed
        .iter()
        .filter_map(|did| {
            let position = positions.get(did)?;
            let cut = Cut {
                seq: position.seq,
                hash: hex::encode(position.hash),
            };
            Some((did.clone(), cut))
        })
        .collect();
    let secret: [u8; 32] = random_bytes();
    let next = recovery_keys(&secret);
    let replacing = installer_gone(&state.members, removed);
    let mut gone = removed.to_vec();
    if replacing {
        let (old, _) = recovery_member(&state.members).ok_or(Error::RosterFormat)?;
        gone.push(old.clone());
    }
    let joining: &[&MemberSecrets] = if replacing { &[&next] } else { &[] };
    let epoch = new_epoch(
        session.group(),
        state.epoch + 1,
        &members_after(state, &gone, joining)?,
        session.current_key(),
    )?;
    let draft = Draft {
        op: Op::Remove,
        signer: hex::encode(device.did),
        add: replacing.then(|| {
            vec![member_subject(
                &next.sig_public,
                &next.kem_public,
                Role::Recovery,
            )]
        }),
        remove: Some(gone),
        cut: (!cut.is_empty()).then_some(cut),
        epoch: Some(epoch.field),
        meta: None,
    };
    let signers: &[&MemberSecrets] = if replacing {
        &[device, &next]
    } else {
        &[device]
    };
    let entry = build_entry(session.group(), Some(state), draft, signers);
    append_checked(session, &entry, &epoch.wraps, Some(&epoch.chain)).await?;
    Ok(replacing.then(|| recovery_words(&secret)))
}

/// Takes this device out of the group with an entry that changes no keys: the devices that stay
/// start the next epoch (spec/protocol.md, Leaving).
pub async fn leave_group<S: Store>(session: &Session<'_, S>, device: &MemberSecrets) -> Result<()> {
    let me = hex::encode(device.did);
    let record = session.record();
    let cut = (record.own_seq > 0).then(|| {
        let cut = Cut {
            seq: record.own_seq.unsigned_abs(),
            hash: record.own_prev.clone(),
        };
        BTreeMap::from([(me.clone(), cut)])
    });
    let draft = Draft {
        op: Op::Leave,
        signer: me.clone(),
        add: None,
        remove: Some(vec![me]),
        cut,
        epoch: None,
        meta: None,
    };
    let entry = build_entry(session.group(), Some(session.roster()), draft, &[device]);
    append_checked(session, &entry, &BTreeMap::new(), None).await
}

/// Gives a device a new name; any device of the group may rename any other.
pub async fn rename_device<S: Store>(
    session: &Session<'_, S>,
    device: &MemberSecrets,
    did: &str,
    meta: &DeviceMeta,
) -> Result<()> {
    let state = session.roster();
    let did_bytes = hex::decode(did).map_err(|_| Error::RosterFormat)?;
    let sealed = seal_device_meta(
        session.current_key(),
        session.group(),
        state.epoch,
        state.seq + 1,
        &did_bytes,
        &to_canonical_json(meta),
    )?;
    let draft = Draft {
        op: Op::Rename,
        signer: hex::encode(device.did),
        add: None,
        remove: None,
        cut: None,
        epoch: None,
        meta: Some(BTreeMap::from([(
            did.to_owned(),
            URL_SAFE_NO_PAD.encode(sealed),
        )])),
    };
    let entry = build_entry(session.group(), Some(state), draft, &[device]);
    append_checked(session, &entry, &BTreeMap::new(), None).await
}
