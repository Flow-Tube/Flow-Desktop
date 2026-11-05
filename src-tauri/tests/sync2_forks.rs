//! Settling the roster from a store's answer (spec/protocol.md, Forks), against the shared vectors
//! and through a session.

mod sync2_common;

use std::collections::BTreeSet;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::entries::{build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::epoch::epoch_commitment;
use flow_desktop_lib::sync2::forks::{Settlement, settle_roster};
use flow_desktop_lib::sync2::held::HeldStore;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::paths::kc_name;
use flow_desktop_lib::sync2::roster::{
    Entry, Op, Role, RosterState, apply_entry, entry_hash, parse_entry,
};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::state::{StoreKind, add_roster_pin, roster_entries};
use serde_json::Value;
use sqlx::SqlitePool;
use sync2_common::{Group, device_pool, draft, group, head};

fn vectors() -> Value {
    serde_json::from_str(include_str!("fixtures/flow-sync-2/forks.json")).unwrap()
}

fn named(v: &Value, list: &Value) -> Vec<Entry> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|name| parse_entry(&v["entries"][name.as_str().unwrap()]).unwrap())
        .collect()
}

fn names(v: &Value, entries: &[Entry]) -> Vec<String> {
    let pool = v["entries"].as_object().unwrap();
    let mut found: Vec<String> = entries
        .iter()
        .map(|e| {
            let hash = entry_hash(e);
            pool.iter()
                .find(|(_, candidate)| entry_hash(&parse_entry(candidate).unwrap()) == hash)
                .map(|(name, _)| name.clone())
                .unwrap()
        })
        .collect();
    found.sort();
    found
}

fn chain_names(v: &Value, chain: &[Entry]) -> Vec<String> {
    chain
        .iter()
        .flat_map(|e| names(v, std::slice::from_ref(e)))
        .collect()
}

fn outcome(v: &Value, settled: Settlement) -> Value {
    match settled {
        Settlement::Apply {
            chain,
            standing,
            extends_applied,
        } => serde_json::json!({
            "outcome": "apply",
            "chain": chain_names(v, &chain),
            "standing": names(v, &standing),
            "extendsApplied": extends_applied,
        }),
        Settlement::Contested { contested, sides } => serde_json::json!({
            "outcome": "contested",
            "contested": names(v, &contested),
            "sides": names(v, &sides),
        }),
        Settlement::Rollback => serde_json::json!({ "outcome": "rollback" }),
        Settlement::Rewritten => serde_json::json!({ "outcome": "rewritten" }),
    }
}

#[test]
fn every_case_settles_as_the_vectors_say_in_any_order() {
    let v = vectors();
    for case in v["cases"].as_array().unwrap() {
        let applied = named(&v, &case["applied"]);
        let mut view = named(&v, &case["view"]);
        let pins: BTreeSet<String> = named(&v, &case["pins"]).iter().map(entry_hash).collect();
        let linear = case["linear"].as_bool().unwrap();
        for _ in 0..2 {
            let settled =
                settle_roster(v["group"].as_str().unwrap(), &applied, &view, &pins, linear)
                    .unwrap();
            assert_eq!(outcome(&v, settled), case["expect"], "{}", case["name"]);
            view.reverse();
        }
    }
}

fn new_member() -> MemberSecrets {
    member_secrets(random_bytes(), random_bytes())
}

/// A group where C joined last, and the state before the next entry.
async fn with_c(g: &Group) -> (MemberSecrets, RosterState) {
    let c = new_member();
    let state = head(&g.store);
    let mut add = draft(Op::Add, &g.a);
    add.add = Some(vec![member_subject(
        &c.sig_public,
        &c.kem_public,
        Role::Device,
    )]);
    let add = build_entry(&g.group, Some(&state), add, &[&g.a, &c]);
    let after = apply_entry(Some(&state), &add).unwrap();
    g.store.0.lock().unwrap().roster.push(add);
    (c, after)
}

fn removing(
    g: &Group,
    state: &RosterState,
    signer: &MemberSecrets,
    target: &MemberSecrets,
    stays: &[&MemberSecrets],
) -> (Entry, [u8; 32]) {
    let key: [u8; 32] = random_bytes();
    let mut draft = draft(Op::Remove, signer);
    draft.remove = Some(vec![hex::encode(target.did)]);
    let dids: Vec<[u8; 16]> = stays.iter().map(|m| m.did).collect();
    draft.epoch = Some(epoch_draft(&key, &g.group, state.epoch + 1, &dids));
    (build_entry(&g.group, Some(state), draft, &[signer]), key)
}

/// B, on a LAN group, has applied everything in the store and holds it.
async fn holding(g: &Group) -> (SqlitePool, HeldStore) {
    let pool = device_pool(g).await;
    sqlx::query("UPDATE sync2_group SET kind = ?")
        .bind(StoreKind::Lan)
        .execute(&pool)
        .await
        .unwrap();
    let held = HeldStore::new(pool.clone());
    let roster = g.store.0.lock().unwrap().roster.clone();
    for entry in roster {
        held.hold_entry(&entry).await.unwrap();
    }
    let keys = g.store.0.lock().unwrap().keys.clone();
    for ((epoch, kc, name), wrap) in keys {
        held.hold_key(epoch, &kc, &name, &wrap).await.unwrap();
    }
    Session::open_as_peer(&pool, held.clone(), &g.b)
        .await
        .unwrap();
    (pool, held)
}

async fn hold_wrap(
    held: &HeldStore,
    g: &Group,
    epoch: u32,
    key: &[u8; 32],
    member: &MemberSecrets,
) {
    let wrap = flow_desktop_lib::sync2::wrap::wrap_epoch_key(
        &member.kem_public,
        &g.group,
        epoch,
        &member.did,
        key,
    )
    .unwrap();
    let kc = kc_name(&epoch_commitment(key, &g.group, epoch));
    held.hold_key(epoch, &kc, &hex::encode(member.did), &wrap)
        .await
        .unwrap();
}

#[tokio::test]
async fn two_devices_that_removed_each_other_pause_sync_until_the_user_keeps_one() {
    let g = group().await;
    let (c, state) = with_c(&g).await;
    let (pool, held) = holding(&g).await;
    let (keep, key) = removing(&g, &state, &g.a, &c, &[&g.a, &g.b, &g.recovery]);
    let (other, _) = removing(&g, &state, &c, &g.a, &[&g.b, &c, &g.recovery]);
    hold_wrap(&held, &g, 1, &key, &g.b).await;
    held.hold_entry(&keep).await.unwrap();
    held.hold_entry(&other).await.unwrap();
    let before = roster_entries(&pool).await.unwrap();

    let paused = Session::open_as_peer(&pool, held.clone(), &g.b).await;
    assert!(matches!(paused, Err(EngineError::Contested)));
    assert_eq!(
        roster_entries(&pool).await.unwrap(),
        before,
        "nothing was adopted"
    );

    add_roster_pin(&pool, &entry_hash(&keep)).await.unwrap();
    let session = Session::open_as_peer(&pool, held, &g.b).await.unwrap();
    assert_eq!(session.roster().head, entry_hash(&keep));
    assert!(!session.roster().members.contains_key(&hex::encode(c.did)));
}

#[tokio::test]
async fn a_device_that_removed_nobody_is_not_asked_about_a_removed_signer() {
    let g = group().await;
    let (c, state) = with_c(&g).await;
    let (pool, held) = holding(&g).await;
    let (removal, key) = removing(&g, &state, &g.a, &c, &[&g.a, &g.b, &g.recovery]);
    let d = new_member();
    let mut other = draft(Op::Add, &c);
    other.add = Some(vec![member_subject(
        &d.sig_public,
        &d.kem_public,
        Role::Device,
    )]);
    let other = build_entry(&g.group, Some(&state), other, &[&c, &d]);
    hold_wrap(&held, &g, 1, &key, &g.b).await;
    held.hold_entry(&other).await.unwrap();
    held.hold_entry(&removal).await.unwrap();

    let session = Session::open_as_peer(&pool, held, &g.b).await.unwrap();
    assert_eq!(session.roster().head, entry_hash(&removal));
}

/// B read an entry that later lost, so it returns to the last common entry and takes the winner.
#[tokio::test]
async fn a_device_that_applied_a_losing_entry_adopts_the_winner() {
    let g = group().await;
    let (c, state) = with_c(&g).await;
    let (pool, held) = holding(&g).await;
    let d = new_member();
    let mut losing = draft(Op::Add, &c);
    losing.add = Some(vec![member_subject(
        &d.sig_public,
        &d.kem_public,
        Role::Device,
    )]);
    let losing = build_entry(&g.group, Some(&state), losing, &[&c, &d]);
    held.hold_entry(&losing).await.unwrap();
    Session::open_as_peer(&pool, held.clone(), &g.b)
        .await
        .unwrap();
    assert_eq!(roster_entries(&pool).await.unwrap().last(), Some(&losing));

    let (winner, key) = removing(&g, &state, &g.a, &c, &[&g.a, &g.b, &g.recovery]);
    hold_wrap(&held, &g, 1, &key, &g.b).await;
    held.hold_entry(&winner).await.unwrap();
    let session = Session::open_as_peer(&pool, held, &g.b).await.unwrap();
    assert_eq!(session.roster().head, entry_hash(&winner));
    assert_eq!(roster_entries(&pool).await.unwrap().last(), Some(&winner));
    assert_eq!(session.current_key(), key);
}

#[tokio::test]
async fn a_device_left_out_by_a_changed_roster_deletes_nothing_by_itself() {
    let g = group().await;
    let (c, state) = with_c(&g).await;
    let (pool, held) = holding(&g).await;
    let mut applied = draft(Op::Rename, &g.b);
    applied.meta = Some(std::iter::once((hex::encode(g.b.did), "x".to_owned())).collect());
    let applied = build_entry(&g.group, Some(&state), applied, &[&g.b]);
    held.hold_entry(&applied).await.unwrap();
    Session::open_as_peer(&pool, held.clone(), &g.b)
        .await
        .unwrap();

    let (removal, _) = removing(&g, &state, &g.a, &g.b, &[&g.a, &c, &g.recovery]);
    held.hold_entry(&removal).await.unwrap();
    let opened = Session::open_as_peer(&pool, held, &g.b).await;
    assert!(matches!(opened, Err(EngineError::RemovalUnconfirmed)));
    assert_eq!(roster_entries(&pool).await.unwrap().last(), Some(&applied));
}

#[tokio::test]
async fn a_removal_that_extends_what_was_applied_says_removed() {
    let g = group().await;
    let (c, state) = with_c(&g).await;
    let (pool, held) = holding(&g).await;
    let (removal, _) = removing(&g, &state, &g.a, &g.b, &[&g.a, &c, &g.recovery]);
    held.hold_entry(&removal).await.unwrap();
    let opened = Session::open_as_peer(&pool, held, &g.b).await;
    assert!(matches!(opened, Err(EngineError::Removed)));
}

#[tokio::test]
async fn a_store_that_drops_an_applied_entry_stops_the_device() {
    let g = group().await;
    let pool = device_pool(&g).await;
    Session::open(&pool, &g.store, &g.b).await.unwrap();
    g.store.0.lock().unwrap().roster.truncate(1);
    let opened = Session::open(&pool, &g.store, &g.b).await;
    assert!(matches!(opened, Err(EngineError::RosterRolledBack)));
}

/// A server's answer holds another entry next to one the device applied, and the other one wins.
#[tokio::test]
async fn a_linear_store_that_changes_an_applied_entry_stops_the_device() {
    let g = group().await;
    with_c(&g).await;
    let pool = device_pool(&g).await;
    Session::open(&pool, &g.store, &g.b).await.unwrap();

    let roster = g.store.0.lock().unwrap().roster.clone();
    let before_c =
        flow_desktop_lib::sync2::roster::replay_roster(&roster[..roster.len() - 1]).unwrap();
    let (other, _) = removing(&g, &before_c, &g.a, &g.b, &[&g.a, &g.recovery]);
    g.store.0.lock().unwrap().roster.push(other);

    let opened = Session::open(&pool, &g.store, &g.b).await;
    assert!(matches!(
        opened,
        Err(EngineError::RosterRewritten | EngineError::RemovalUnconfirmed)
    ));
}
