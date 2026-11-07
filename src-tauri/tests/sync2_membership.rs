//! Removing and renaming devices: a removed device is shut out of the new epoch, the others go on,
//! and names come from the latest entry naming each device.

mod sync2_common;

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::entries::build_entry;
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::membership::{remove_devices, rename_device};
use flow_desktop_lib::sync2::meta::seal_device_meta;
use flow_desktop_lib::sync2::names::device_names;
use flow_desktop_lib::sync2::roster::Op;
use flow_desktop_lib::sync2::store::Store;
use sync2_common::{device_pool, draft, group, head};

fn meta(name: &str) -> DeviceMeta {
    DeviceMeta {
        app: "app".into(),
        name: name.into(),
        platform: "linux".into(),
    }
}

#[tokio::test]
async fn a_removed_device_is_shut_out_and_the_others_continue() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    remove_devices(&pool_a, &session, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    let state = head(&g.store);
    assert_eq!(state.epoch, 1);
    assert!(!state.members.contains_key(&hex::encode(g.b.did)));
    assert!(state.members.contains_key(&hex::encode(g.recovery.did)));
    assert!(matches!(
        Session::open(&pool_b, &g.store, &g.b).await,
        Err(EngineError::Removed)
    ));
    let reopened = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    assert_eq!(reopened.roster().epoch, 1);
}

#[tokio::test]
async fn a_lost_race_is_reported_not_overwritten() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let stale = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let fresh = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&fresh, &g.a, &hex::encode(g.a.did), &meta("First"))
        .await
        .unwrap();
    let error = rename_device(&stale, &g.a, &hex::encode(g.a.did), &meta("Second"))
        .await
        .unwrap_err();
    assert!(matches!(error, EngineError::Protocol(e) if e.code() == "roster-chain"));
}

#[tokio::test]
async fn names_come_from_the_latest_entry_and_survive_a_new_epoch() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&session, &g.a, &hex::encode(g.b.did), &meta("Studio"))
        .await
        .unwrap();
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&session, &g.a, &hex::encode(g.a.did), &meta("Laptop"))
        .await
        .unwrap();
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    remove_devices(&pool_a, &session, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    let mut session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let names = device_names(&mut session).await.unwrap();
    assert_eq!(names[&hex::encode(g.a.did)].name, "Laptop");
    assert_eq!(names[&hex::encode(g.b.did)].name, "Studio");
}

#[tokio::test]
async fn a_signed_name_that_can_not_be_read_is_left_out() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let a = hex::encode(g.a.did);
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&session, &g.a, &a, &meta("Laptop"))
        .await
        .unwrap();
    let not_json = |seq| seal_device_meta(&g.epoch_key, &g.group, 0, seq, &g.a.did, b"name");
    for sealed in [
        "A".to_owned(),
        URL_SAFE_NO_PAD.encode([0; 100]),
        URL_SAFE_NO_PAD.encode(not_json(head(&g.store).seq + 1).unwrap()),
    ] {
        let state = head(&g.store);
        let mut rename = draft(Op::Rename, &g.a);
        rename.meta = Some(BTreeMap::from([(a.clone(), sealed)]));
        let entry = build_entry(&g.group, Some(&state), rename, &[&g.a]);
        (&g.store)
            .append_roster(&state.head, &entry, &BTreeMap::new(), None)
            .await
            .unwrap();
    }

    let mut session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let names = device_names(&mut session).await.unwrap();
    assert_eq!(names[&a].name, "Laptop");
}
