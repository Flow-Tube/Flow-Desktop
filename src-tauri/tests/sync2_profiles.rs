//! FLOW-SYNC/2 with several linked profiles (spec/protocol.md, Profiles): the running profile's
//! batches apply, other linked profiles' are kept, each link starts from its own snapshot, and a
//! deleted link no longer holds back garbage collection.

mod sync2_common;

use std::collections::BTreeSet;

use flow_desktop_lib::sync2::batches::{IncomingBatch, apply_batches};
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::kept::kept;
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::profile_links::Reading;
use sqlx::SqlitePool;
use sync2_common::{Group, MemoryStore, device_pool, empty_pool, exported, group, watch, watched};

const HOME: &str = "link-home";
const KIDS: &str = "link-kids";

fn running(active: &str, kept: &[&str]) -> Reading {
    Reading {
        active: Some(active.to_owned()),
        kept: kept
            .iter()
            .map(|l| (*l).to_owned())
            .collect::<BTreeSet<_>>(),
    }
}

/// Pushes `data`, the data of the profile linked to `link`, from device A.
async fn push_as(
    session: &mut Session<'_, &MemoryStore>,
    state: &SqlitePool,
    link: &str,
    data: &SqlitePool,
) {
    session.set_reading(running(link, &[]));
    session
        .push(state, exported(data, "app-a").await)
        .await
        .unwrap();
}

async fn snapshot_as(
    session: &mut Session<'_, &MemoryStore>,
    state: &SqlitePool,
    link: &str,
    data: &SqlitePool,
) {
    session.set_reading(running(link, &[]));
    session
        .write_snapshot(state, exported(data, "app-a").await)
        .await
        .unwrap();
}

async fn apply_each(data: &SqlitePool, batches: &[(String, IncomingBatch)]) {
    for (sender, batch) in batches {
        apply_batches(data, "app-b", sender, std::slice::from_ref(batch), now_ms())
            .await
            .unwrap();
    }
}

async fn apply_kept(state: &SqlitePool, link: &str, data: &SqlitePool) {
    let kept: Vec<(String, IncomingBatch)> = kept(state, link)
        .await
        .unwrap()
        .into_iter()
        .map(|(_, sender, batch)| (sender, batch))
        .collect();
    apply_each(data, &kept).await;
}

/// The last object device A wrote.
fn last(session: &Session<'_, &MemoryStore>) -> u64 {
    u64::try_from(session.record().own_seq).unwrap()
}

fn has(g: &Group, seq: u64) -> bool {
    g.store
        .0
        .lock()
        .unwrap()
        .objects
        .contains_key(&log_path(&hex::encode(g.a.did), seq))
}

#[tokio::test]
async fn batches_of_a_profile_that_isnt_running_are_kept_until_it_runs() {
    let g = group().await;
    let a_state = device_pool(&g).await;
    let (a_home, a_kids) = (empty_pool().await, empty_pool().await);
    watch(&a_home, "hhhhhhhhhhh").await;
    watch(&a_kids, "kkkkkkkkkkk").await;
    let mut a = Session::open(&a_state, &g.store, &g.a).await.unwrap();
    push_as(&mut a, &a_state, HOME, &a_home).await;
    push_as(&mut a, &a_state, KIDS, &a_kids).await;

    let b_state = device_pool(&g).await;
    let (b_home, b_kids) = (empty_pool().await, empty_pool().await);
    let mut b = Session::open(&b_state, &g.store, &g.b).await.unwrap();
    b.set_reading(running(HOME, &[KIDS]));
    let pulled = b.pull(&b_state).await.unwrap();
    for (sender, batches) in &pulled.batches {
        assert!(batches.iter().all(|b| b.link.as_deref() == Some(HOME)));
        apply_batches(&b_home, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    b.finish(&b_state, pulled).await.unwrap();
    assert_eq!(watched(&b_home).await, ["hhhhhhhhhhh"]);
    assert!(watched(&b_kids).await.is_empty());

    apply_kept(&b_state, KIDS, &b_kids).await;
    assert_eq!(watched(&b_kids).await, ["kkkkkkkkkkk"]);
    assert_eq!(
        watched(&b_home).await,
        ["hhhhhhhhhhh"],
        "nothing leaks across profiles"
    );
    assert!(b.pull(&b_state).await.unwrap().kept.is_empty(), "kept once");
}

#[tokio::test]
async fn a_new_device_starts_each_profile_from_its_own_snapshot() {
    let g = group().await;
    let a_state = device_pool(&g).await;
    let (a_home, a_kids) = (empty_pool().await, empty_pool().await);
    watch(&a_home, "h1h1h1h1h1h").await;
    watch(&a_kids, "k1k1k1k1k1k").await;
    let mut a = Session::open(&a_state, &g.store, &g.a).await.unwrap();
    push_as(&mut a, &a_state, HOME, &a_home).await;
    let home_pushed = last(&a);
    snapshot_as(&mut a, &a_state, HOME, &a_home).await;
    push_as(&mut a, &a_state, KIDS, &a_kids).await;
    snapshot_as(&mut a, &a_state, KIDS, &a_kids).await;
    watch(&a_home, "h2h2h2h2h2h").await;
    push_as(&mut a, &a_state, HOME, &a_home).await;
    // Garbage collection removed what both snapshots include.
    for seq in 1..=home_pushed {
        g.store.take(&log_path(&hex::encode(g.a.did), seq));
    }

    let b_state = device_pool(&g).await;
    let (b_home, b_kids) = (empty_pool().await, empty_pool().await);
    let mut b = Session::open(&b_state, &g.store, &g.b).await.unwrap();
    b.set_reading(running(HOME, &[KIDS]));
    let pulled = b.pull(&b_state).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&b_home, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    b.finish(&b_state, pulled).await.unwrap();
    assert_eq!(watched(&b_home).await, ["h1h1h1h1h1h", "h2h2h2h2h2h"]);

    apply_kept(&b_state, KIDS, &b_kids).await;
    assert_eq!(watched(&b_kids).await, ["k1k1k1k1k1k"]);
    let changes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync2_kept WHERE part = 0")
        .fetch_one(&b_state)
        .await
        .unwrap();
    assert_eq!(
        changes, 0,
        "the kids batches are in its snapshot, read once"
    );
}

#[tokio::test]
async fn a_profile_that_joins_a_link_reads_it_from_its_snapshot() {
    let g = group().await;
    let a_state = device_pool(&g).await;
    let (a_home, a_kids) = (empty_pool().await, empty_pool().await);
    watch(&a_home, "hhhhhhhhhhh").await;
    watch(&a_kids, "k1k1k1k1k1k").await;
    let mut a = Session::open(&a_state, &g.store, &g.a).await.unwrap();
    push_as(&mut a, &a_state, HOME, &a_home).await;
    push_as(&mut a, &a_state, KIDS, &a_kids).await;
    let included = last(&a);
    snapshot_as(&mut a, &a_state, KIDS, &a_kids).await;
    watch(&a_kids, "k2k2k2k2k2k").await;
    push_as(&mut a, &a_state, KIDS, &a_kids).await;

    let b_state = device_pool(&g).await;
    let b_kids = empty_pool().await;
    let mut b = Session::open(&b_state, &g.store, &g.b).await.unwrap();
    b.set_reading(running(HOME, &[]));
    let pulled = b.pull(&b_state).await.unwrap();
    assert!(pulled.kept.is_empty(), "kids isn't linked here yet");
    b.finish(&b_state, pulled).await.unwrap();

    let read = b.read_link(&b_state, KIDS).await.unwrap().unwrap();
    assert!(
        read.batches.iter().all(|k| k.part > 0 || k.seq > included),
        "the batch the snapshot includes isn't read again"
    );
    let batches: Vec<(String, IncomingBatch)> = read
        .batches
        .into_iter()
        .map(|k| (k.sender, k.batch))
        .collect();
    apply_each(&b_kids, &batches).await;
    assert_eq!(watched(&b_kids).await, ["k1k1k1k1k1k", "k2k2k2k2k2k"]);
    assert_eq!(
        read.floors.get(&(KIDS.to_owned(), hex::encode(g.a.did))),
        Some(&included)
    );
}

#[tokio::test]
async fn a_deleted_profile_no_longer_holds_back_garbage_collection() {
    let g = group().await;
    let a_state = device_pool(&g).await;
    let (a_home, a_kids) = (empty_pool().await, empty_pool().await);
    watch(&a_home, "hhhhhhhhhhh").await;
    watch(&a_kids, "kkkkkkkkkkk").await;
    let mut a = Session::open(&a_state, &g.store, &g.a).await.unwrap();
    push_as(&mut a, &a_state, HOME, &a_home).await;
    push_as(&mut a, &a_state, KIDS, &a_kids).await;
    let pushed = last(&a);
    snapshot_as(&mut a, &a_state, HOME, &a_home).await;

    let b_state = device_pool(&g).await;
    let mut b = Session::open(&b_state, &g.store, &g.b).await.unwrap();
    b.set_reading(running(HOME, &[KIDS]));
    let pulled = b.pull(&b_state).await.unwrap();
    b.finish(&b_state, pulled).await.unwrap();
    a.set_reading(running(HOME, &[KIDS]));
    let pulled = a.pull(&a_state).await.unwrap();
    a.finish(&a_state, pulled).await.unwrap();

    a.collect_garbage(&a_state).await.unwrap();
    assert!(has(&g, 1), "kids has no snapshot yet");

    sqlx::query("INSERT INTO sync2_profiles (link, name, hlc, deleted) VALUES (?, 'Kids', '1:0:aaaaaaaa', 1)")
        .bind(KIDS)
        .execute(&a_state)
        .await
        .unwrap();
    a.collect_garbage(&a_state).await.unwrap();
    assert!((1..=pushed).all(|seq| !has(&g, seq)));
}
