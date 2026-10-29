//! Changing who is in the group: removing a device, which starts a new epoch, and renaming one.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::engine::{Result, Session};
use super::entries::{Draft, build_entry, epoch_draft};
use super::epoch::seal_chain;
use super::keys::MemberSecrets;
use super::linking::DeviceMeta;
use super::meta::seal_device_meta;
use super::roster::{Entry, EpochField, Op, apply_entry};
use super::sealed::random_bytes;
use super::server::Appended;
use super::store::Store;
use super::wrap::wrap_epoch_key;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;

/// A fresh epoch key, wrapped to every member after a change, with the previous key chained.
pub struct NewEpoch {
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
        field: epoch_draft(&key, group, n, &ids),
        wraps,
        chain: URL_SAFE_NO_PAD.encode(seal_chain(&key, group, n, previous_key)),
    })
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
pub async fn remove_device<S: Store>(
    session: &Session<'_, S>,
    device: &MemberSecrets,
    removed: &str,
) -> Result<()> {
    let state = session.roster();
    let remaining: Vec<([u8; 16], [u8; 32])> = state
        .members
        .iter()
        .filter(|(did, _)| did.as_str() != removed)
        .map(|(did, member)| hex::decode(did).map(|id| (array(&id), member.kem)))
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| Error::RosterFormat)?;
    let epoch = new_epoch(
        session.group(),
        state.epoch + 1,
        &remaining,
        session.current_key(),
    )?;
    let draft = Draft {
        op: Op::Remove,
        signer: hex::encode(device.did),
        add: None,
        remove: Some(vec![removed.to_owned()]),
        epoch: Some(epoch.field),
        meta: None,
    };
    let entry = build_entry(session.group(), Some(state), draft, &[device]);
    append_checked(session, &entry, &epoch.wraps, Some(&epoch.chain)).await
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
        epoch: None,
        meta: Some(BTreeMap::from([(
            did.to_owned(),
            URL_SAFE_NO_PAD.encode(sealed),
        )])),
    };
    let entry = build_entry(session.group(), Some(state), draft, &[device]);
    append_checked(session, &entry, &BTreeMap::new(), None).await
}
