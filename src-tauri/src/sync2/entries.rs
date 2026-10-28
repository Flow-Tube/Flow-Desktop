//! Building and signing roster entries (the counterpart of `roster`, which checks them).

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;

use super::curve::sign;
use super::epoch::epoch_commitment;
use super::keys::MemberSecrets;
use super::roster::{Entry, EpochField, Op, Role, RosterState, Subject, signing_bytes};

/// What an entry says, before the chain fields and signatures are added.
pub struct Draft {
    pub op: Op,
    pub signer: String,
    pub add: Option<Vec<Subject>>,
    pub remove: Option<Vec<String>>,
    pub epoch: Option<EpochField>,
    pub meta: Option<BTreeMap<String, String>>,
}

pub fn member_subject(member: &MemberSecrets, role: Role) -> Subject {
    Subject {
        did: hex::encode(member.did),
        sig: URL_SAFE_NO_PAD.encode(member.sig_public),
        kem: URL_SAFE_NO_PAD.encode(member.kem_public),
        role,
    }
}

pub fn epoch_draft(epoch_key: &[u8], group: &[u8], n: u32, members: &[[u8; 16]]) -> EpochField {
    let mut to: Vec<String> = members.iter().map(hex::encode).collect();
    to.sort();
    EpochField {
        n,
        kc: URL_SAFE_NO_PAD.encode(epoch_commitment(epoch_key, group, n)),
        to,
    }
}

/// Adds the signature of `signer` to an entry.
pub fn sign_entry(entry: &mut Entry, signer: &MemberSecrets) {
    let signature = sign(&signer.sig_seed, &signing_bytes(entry));
    entry
        .sigs
        .insert(hex::encode(signer.did), URL_SAFE_NO_PAD.encode(signature));
}

/// Builds the entry that follows `previous` (the roster head, or none for genesis) and signs it.
pub fn build_entry(
    group: &[u8],
    previous: Option<&RosterState>,
    mut draft: Draft,
    signers: &[&MemberSecrets],
) -> Entry {
    if let Some(add) = &mut draft.add {
        add.sort_by(|a, b| a.did.cmp(&b.did));
    }
    if let Some(remove) = &mut draft.remove {
        remove.sort();
    }
    let mut entry = Entry {
        v: 2,
        group: hex::encode(group),
        seq: previous.map_or(0, |state| state.seq + 1),
        prev: previous.map_or_else(|| hex::encode([0; 32]), |state| state.head.clone()),
        op: draft.op,
        signer: draft.signer,
        add: draft.add,
        remove: draft.remove,
        epoch: draft.epoch,
        meta: draft.meta,
        sigs: BTreeMap::new(),
    };
    for signer in signers {
        sign_entry(&mut entry, signer);
    }
    entry
}
