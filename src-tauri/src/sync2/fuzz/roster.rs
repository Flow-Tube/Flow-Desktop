use std::sync::LazyLock;

use proptest::prelude::*;
use serde_json::Value;

use super::{json, member, mutations};
use crate::sync::canonical::to_canonical_json;
use crate::sync2::entries::{Draft, build_entry, epoch_draft, member_subject};
use crate::sync2::keys::{MemberSecrets, group_id};
use crate::sync2::roster::{
    Entry, Op, Role, RosterState, apply_entry, fork_winner, parse_entry, replay_roster,
};
use crate::sync2::{Error, Result, array};

struct Roster {
    group: [u8; 16],
    device: MemberSecrets,
    state: RosterState,
    add: Entry,
}

static ROSTER: LazyLock<Roster> = LazyLock::new(|| {
    let (device, recovery, joiner) = (member(), member(), member());
    let group = group_id(
        (&device.sig_public, &device.kem_public),
        (&recovery.sig_public, &recovery.kem_public),
    );
    let draft = |op, add| Draft {
        op,
        signer: hex::encode(device.did),
        add: Some(add),
        remove: None,
        cut: None,
        epoch: None,
        meta: None,
    };
    let mut genesis = draft(
        Op::Genesis,
        vec![
            member_subject(&device.sig_public, &device.kem_public, Role::Device),
            member_subject(&recovery.sig_public, &recovery.kem_public, Role::Recovery),
        ],
    );
    genesis.epoch = Some(epoch_draft(
        &[1; 32],
        &group,
        0,
        &[device.did, recovery.did],
    ));
    let genesis = build_entry(&group, None, genesis, &[&device, &recovery]);
    let state = apply_entry(None, &genesis).unwrap();
    let joining = vec![member_subject(
        &joiner.sig_public,
        &joiner.kem_public,
        Role::Device,
    )];
    let add = build_entry(
        &group,
        Some(&state),
        draft(Op::Add, joining),
        &[&device, &joiner],
    );
    Roster {
        group,
        device,
        state,
        add,
    }
});

fn add_value() -> Value {
    serde_json::to_value(&ROSTER.add).unwrap()
}

/// Reads changed entry text the way a store answer is read, then applies it after genesis.
fn apply_text(text: &[u8]) -> Option<Result<RosterState>> {
    let value: Value = serde_json::from_slice(text).ok()?;
    (to_canonical_json(&value) != to_canonical_json(&ROSTER.add))
        .then(|| parse_entry(&value).and_then(|entry| apply_entry(Some(&ROSTER.state), &entry)))
}

fn edited() -> impl Strategy<Value = Value> {
    let fields: Vec<String> = add_value().as_object().unwrap().keys().cloned().collect();
    let with = |field: String, value: Option<Value>| {
        let mut entry = add_value();
        let object = entry.as_object_mut().unwrap();
        match value {
            Some(value) => object.insert(field, value),
            None => object.remove(&field),
        };
        entry
    };
    prop_oneof![
        (prop::sample::select(fields.clone()), json()).prop_map(move |(f, v)| with(f, Some(v))),
        prop::sample::select(fields).prop_map(move |f| with(f, None)),
        (any::<String>(), json()).prop_map(move |(f, v)| with(f, Some(v))),
    ]
}

proptest! {
    #[test]
    fn any_change_to_the_text_of_a_signed_entry_is_refused(
        changed in mutations(to_canonical_json(&ROSTER.add)),
    ) {
        if let Some(applied) = apply_text(&changed) {
            prop_assert!(applied.is_err());
        }
    }

    #[test]
    fn any_changed_removed_or_added_field_of_a_signed_entry_is_refused(changed in edited()) {
        if let Some(applied) = apply_text(&serde_json::to_vec(&changed).unwrap()) {
            prop_assert!(applied.is_err());
        }
    }

    #[test]
    fn arbitrary_json_is_refused_or_checked_without_panicking(value in json()) {
        if let Ok(entry) = parse_entry(&value) {
            let _ = apply_entry(Some(&ROSTER.state), &entry);
            let _ = replay_roster(std::slice::from_ref(&entry));
            let _ = fork_winner(&[entry, ROSTER.add.clone()]);
        }
    }

    #[test]
    fn an_entry_must_take_the_next_seq(seq: u64) {
        let mut entry = ROSTER.add.clone();
        entry.seq = seq;
        let applied = apply_entry(Some(&ROSTER.state), &entry);
        if seq == 1 {
            prop_assert!(applied.is_ok());
        } else {
            prop_assert_eq!(applied, Err(Error::RosterChain));
        }
    }

    #[test]
    fn a_rotation_must_start_the_next_epoch(n: u32) {
        let Roster { device, state, .. } = &*ROSTER;
        let members: Vec<[u8; 16]> =
            state.members.keys().map(|d| array(&hex::decode(d).unwrap())).collect();
        let draft = Draft {
            op: Op::Rotate,
            signer: hex::encode(device.did),
            add: None,
            remove: None,
            cut: None,
            epoch: Some(epoch_draft(&[2; 32], &ROSTER.group, n, &members)),
            meta: None,
        };
        let applied = apply_entry(Some(state), &build_entry(&ROSTER.group, Some(state), draft, &[device]));
        if n == 1 {
            prop_assert_eq!(applied.unwrap().epoch, 1);
        } else {
            prop_assert_eq!(applied, Err(Error::RosterEpoch));
        }
    }
}
