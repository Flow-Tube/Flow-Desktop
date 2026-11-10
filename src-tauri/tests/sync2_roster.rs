//! FLOW-SYNC/2 roster vectors from `Flow-Tube/flow-sync`: a full chain, the state after each
//! entry, the device names it carries, every rejection, and fork resolution.

use std::path::PathBuf;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::meta::open_device_meta;
use flow_desktop_lib::sync2::roster::{
    Entry, Role, RosterState, apply_entry, entry_hash, fork_winner, parse_entry, replay_roster,
};
use serde_json::{Value, json};

fn vectors() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/flow-sync-2/roster.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn entries(v: &Value) -> Vec<Entry> {
    v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| parse_entry(e).unwrap())
        .collect()
}

fn base(entries: &[Entry], count: &Value) -> RosterState {
    let count = usize::try_from(count.as_u64().unwrap()).unwrap();
    replay_roster(&entries[..count]).unwrap()
}

fn view(state: &RosterState) -> Value {
    let members: Vec<Value> = state
        .members
        .iter()
        .map(|(did, m)| {
            let mut view = json!({ "did": did, "role": if m.role == Role::Device { "device" } else { "recovery" }, "used": m.used });
            if let Some(installer) = &m.installer {
                view["installer"] = json!(installer);
            }
            view
        })
        .collect();
    let senders: Vec<Value> = state
        .senders
        .iter()
        .map(|(did, s)| {
            let mut view = json!({ "did": did, "role": if s.role == Role::Device { "device" } else { "recovery" }, "since": s.since });
            if let Some(until) = s.until {
                view["until"] = json!(until);
            }
            if let Some(cut) = &s.cut {
                view["cut"] = json!({ "seq": cut.seq, "hash": cut.hash });
            }
            view
        })
        .collect();
    json!({ "seq": state.seq, "head": state.head, "epoch": state.epoch, "rotate": state.rotate, "recoveryDue": state.recovery_due, "members": members, "senders": senders })
}

#[test]
fn every_prefix_of_the_chain_gives_the_expected_state() {
    let v = vectors();
    let entries = entries(&v);
    for (i, expected) in v["states"].as_array().unwrap().iter().enumerate() {
        assert_eq!(view(&replay_roster(&entries[..=i]).unwrap()), *expected);
    }
}

#[test]
fn device_names_open_with_the_roster_key_of_their_epoch() {
    let v = vectors();
    let entries = entries(&v);
    let group = hex::decode(v["group"].as_str().unwrap()).unwrap();
    for m in v["meta"].as_array().unwrap() {
        let seq = m["seq"].as_u64().unwrap();
        let epoch = u32::try_from(m["epoch"].as_u64().unwrap()).unwrap();
        let did = m["did"].as_str().unwrap();
        let sealed = entries[usize::try_from(seq).unwrap()]
            .meta
            .as_ref()
            .unwrap()[did]
            .clone();
        let key = hex::decode(v["epochKeys"][epoch as usize].as_str().unwrap()).unwrap();
        let did_bytes = hex::decode(did).unwrap();
        let content = open_device_meta(
            &key,
            &group,
            epoch,
            seq,
            &did_bytes,
            &URL_SAFE_NO_PAD.decode(sealed).unwrap(),
        )
        .unwrap();
        assert_eq!(content, m["content"].as_str().unwrap());
    }
}

#[test]
fn invalid_entries_are_rejected_for_the_named_reason() {
    let v = vectors();
    let entries = entries(&v);
    for n in v["negatives"].as_array().unwrap() {
        let state = base(&entries, &n["base"]);
        let error = parse_entry(&n["entry"])
            .and_then(|entry| apply_entry(Some(&state), &entry))
            .unwrap_err();
        assert_eq!(error.code(), n["error"].as_str().unwrap(), "{}", n["name"]);
    }
}

#[test]
fn an_entry_that_skipped_the_parser_is_refused_for_its_meta_too() {
    let v = vectors();
    let entries = entries(&v);
    let named = |name: &&Value| name["name"].as_str().unwrap().contains("meta");
    let negatives = v["negatives"].as_array().unwrap().iter().filter(named);
    let mut seen = 0;
    for n in negatives {
        let Ok(entry) = serde_json::from_value::<Entry>(n["entry"].clone()) else {
            continue;
        };
        let state = base(&entries, &n["base"]);
        let error = apply_entry(Some(&state), &entry).unwrap_err();
        assert_eq!(error.code(), n["error"].as_str().unwrap(), "{}", n["name"]);
        seen += 1;
    }
    assert!(seen >= 6);
}

#[test]
fn replaying_a_stored_chain_refuses_a_key_with_a_small_order_part() {
    let v = vectors();
    let negatives = v["negatives"].as_array().unwrap();
    let n = negatives
        .iter()
        .find(|n| n["name"] == "mixed-order-key")
        .unwrap();
    let mut chain = entries(&v);
    chain.truncate(1);
    chain.push(parse_entry(&n["entry"]).unwrap());
    assert_eq!(replay_roster(&chain).unwrap_err().code(), "roster-key");
}

#[test]
fn a_genesis_must_match_its_group_id() {
    for n in vectors()["geneses"].as_array().unwrap() {
        let entry = parse_entry(&n["entry"]).unwrap();
        let error = apply_entry(None, &entry).unwrap_err();
        assert_eq!(error.code(), n["error"].as_str().unwrap());
    }
}

#[test]
fn forks_resolve_to_the_same_winner() {
    let v = vectors();
    let entries = entries(&v);
    for f in v["forks"].as_array().unwrap() {
        let state = base(&entries, &f["base"]);
        let mut candidates: Vec<Entry> = f["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| parse_entry(c).unwrap())
            .collect();
        for candidate in &candidates {
            apply_entry(Some(&state), candidate).unwrap();
        }
        assert_eq!(
            entry_hash(fork_winner(&candidates).unwrap()),
            f["winner"].as_str().unwrap()
        );
        candidates.reverse();
        assert_eq!(
            entry_hash(fork_winner(&candidates).unwrap()),
            f["winner"].as_str().unwrap()
        );
    }
}

#[test]
fn a_null_field_is_not_an_absent_one() {
    let v = vectors();
    let mut with_null = v["entries"][1].clone();
    with_null["remove"] = Value::Null;
    assert_eq!(parse_entry(&with_null).unwrap_err().code(), "roster-format");
}

#[test]
fn a_removal_replaces_a_recovery_key_set_by_a_device_that_is_gone() {
    let v = vectors();
    let entries = entries(&v);
    for case in v["replacements"].as_array().unwrap() {
        let mut state = match case.get("base") {
            Some(count) => base(&entries, count),
            None => replay_roster(&entries).unwrap(),
        };
        let steps: Vec<Entry> = case["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|step| parse_entry(step).unwrap())
            .collect();
        let (last, before) = steps.split_last().unwrap();
        for step in before {
            state = apply_entry(Some(&state), step).unwrap();
        }
        let applied = apply_entry(Some(&state), last);
        match case.get("error") {
            Some(error) => assert_eq!(
                applied.unwrap_err().code(),
                error.as_str().unwrap(),
                "{}",
                case["name"]
            ),
            None => assert_eq!(view(&applied.unwrap()), case["state"], "{}", case["name"]),
        }
    }
}
