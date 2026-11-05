//! Where a removed device's log ends (spec/store.md, Reading an envelope): readers stop at the
//! object its removal names, along the chain that reaches it.

mod sync2_common;

use std::collections::BTreeMap;

use flow_desktop_lib::sync2::engine::{Session, verify_logged};
use flow_desktop_lib::sync2::membership::{leave_group, remove_devices};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::state::{load_group, streams};
use sqlx::SqlitePool;
use sync2_common::{Group, MemoryStore, device_pool, exported, group, head, watch};

async fn write(pool: &SqlitePool, session: &mut Session<'_, &MemoryStore>, video: &str) {
    watch(pool, video).await;
    session
        .push(pool, exported(pool, "app").await)
        .await
        .unwrap();
}

async fn read_all(pool: &SqlitePool, session: &mut Session<'_, &MemoryStore>) {
    let pulled = session.pull(pool).await.unwrap();
    session.finish(pool, pulled).await.unwrap();
}

async fn own_seq(pool: &SqlitePool) -> u64 {
    let record = load_group(pool).await.unwrap().unwrap();
    record.own_seq.unsigned_abs()
}

/// How many batches of B a device that has read nothing gets now.
async fn batches_a_new_reader_gets(g: &Group) -> usize {
    let pool = device_pool(g).await;
    let mut reader = Session::open(&pool, &g.store, &g.a).await.unwrap();
    let pulled = reader.pull(&pool).await.unwrap();
    pulled
        .batches
        .get(&hex::encode(g.b.did))
        .map_or(0, Vec::len)
}

/// Takes B's log out of the store.
fn take_log(g: &Group) -> BTreeMap<u64, Vec<u8>> {
    let did = hex::encode(g.b.did);
    let mut memory = g.store.0.lock().unwrap();
    let mut taken = BTreeMap::new();
    for seq in 1..=64 {
        if let Some((_, bytes)) = memory.objects.remove(&log_path(&did, seq)) {
            taken.insert(seq, bytes);
        }
    }
    taken
}

fn put_log(g: &Group, log: &BTreeMap<u64, Vec<u8>>) {
    let did = hex::encode(g.b.did);
    for (seq, bytes) in log {
        g.store.put(&log_path(&did, *seq), bytes.clone());
    }
}

/// B's log as a second copy of B would write it, kept out of the store.
async fn other_copy(g: &Group, videos: &[&str]) -> BTreeMap<u64, Vec<u8>> {
    let genuine = take_log(g);
    let pool = device_pool(g).await;
    let mut copy = Session::open(&pool, &g.store, &g.b).await.unwrap();
    for video in videos {
        write(&pool, &mut copy, video).await;
    }
    let other = take_log(g);
    put_log(g, &genuine);
    other
}

#[tokio::test]
async fn what_a_removed_device_writes_later_is_not_read() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    let before = batches_a_new_reader_gets(&g).await;
    read_all(&pool_a, &mut a).await;
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    write(&pool_b, &mut b, "bbbbbbbbbbb").await;

    assert!(before > 0);
    assert_eq!(batches_a_new_reader_gets(&g).await, before);
}

#[tokio::test]
async fn what_a_removed_device_writes_later_is_deleted() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    read_all(&pool_a, &mut a).await;
    let cut = own_seq(&pool_b).await;
    let did = hex::encode(g.b.did);
    remove_devices(&pool_a, &a, &g.a, std::slice::from_ref(&did))
        .await
        .unwrap();
    write(&pool_b, &mut b, "bbbbbbbbbbb").await;

    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    read_all(&pool_a, &mut a).await;

    let objects = g.store.0.lock().unwrap();
    assert!(objects.objects.contains_key(&log_path(&did, cut)));
    assert!(!objects.objects.contains_key(&log_path(&did, cut + 1)));
}

#[tokio::test]
async fn a_removal_that_read_nothing_of_a_log_ends_it_at_the_start() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    assert!(batches_a_new_reader_gets(&g).await > 0);
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    assert_eq!(batches_a_new_reader_gets(&g).await, 0);
}

#[tokio::test]
async fn an_object_replaced_below_the_cut_is_not_applied() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    write(&pool_b, &mut b, "bbbbbbbbbbb").await;
    assert!(batches_a_new_reader_gets(&g).await > 0);
    read_all(&pool_a, &mut a).await;
    let other = other_copy(&g, &["ccccccccccc", "ddddddddddd"]).await;
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    g.store
        .put(&log_path(&hex::encode(g.b.did), 1), other[&1].clone());

    assert_eq!(batches_a_new_reader_gets(&g).await, 0);
}

#[tokio::test]
async fn an_object_replaced_at_the_cut_stops_the_log_before_anything_is_applied() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    write(&pool_b, &mut b, "bbbbbbbbbbb").await;
    read_all(&pool_a, &mut a).await;
    let last = own_seq(&pool_b).await;
    let other = other_copy(&g, &["aaaaaaaaaaa", "ccccccccccc"]).await;
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    g.store
        .put(&log_path(&hex::encode(g.b.did), last), other[&last].clone());

    assert_eq!(batches_a_new_reader_gets(&g).await, 0);
}

#[tokio::test]
async fn a_device_that_read_past_the_cut_keeps_its_place() {
    let g = group().await;
    let (pool_a, pool_b, pool_r) = (
        device_pool(&g).await,
        device_pool(&g).await,
        device_pool(&g).await,
    );
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let mut reader = Session::open(&pool_r, &g.store, &g.a).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    read_all(&pool_a, &mut a).await;
    write(&pool_b, &mut b, "bbbbbbbbbbb").await;
    read_all(&pool_r, &mut reader).await;
    let did = hex::encode(g.b.did);
    let reached = own_seq(&pool_b).await;
    assert_eq!(streams(&pool_r).await.unwrap()[&did].seq, reached);
    assert!(streams(&pool_a).await.unwrap()[&did].seq < reached);
    remove_devices(&pool_a, &a, &g.a, std::slice::from_ref(&did))
        .await
        .unwrap();

    let mut reader = Session::open(&pool_r, &g.store, &g.a).await.unwrap();
    read_all(&pool_r, &mut reader).await;

    assert_eq!(streams(&pool_r).await.unwrap()[&did].seq, reached);
}

#[tokio::test]
async fn a_leave_names_the_device_s_own_last_object() {
    let g = group().await;
    let pool_b = device_pool(&g).await;
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    let before = batches_a_new_reader_gets(&g).await;
    let record = load_group(&pool_b).await.unwrap().unwrap();
    leave_group(&b, &g.b).await.unwrap();

    let did = hex::encode(g.b.did);
    let cut = head(&g.store).senders[&did].cut.clone().unwrap();
    assert_eq!(cut.seq, record.own_seq.unsigned_abs());
    assert_eq!(cut.hash, record.own_prev);

    write(&pool_b, &mut b, "bbbbbbbbbbb").await;
    assert_eq!(batches_a_new_reader_gets(&g).await, before);
}

#[tokio::test]
async fn a_lan_peer_can_t_hand_over_an_object_above_the_cut() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    write(&pool_b, &mut b, "aaaaaaaaaaa").await;
    read_all(&pool_a, &mut a).await;
    let did = hex::encode(g.b.did);
    let cut = own_seq(&pool_b).await;
    remove_devices(&pool_a, &a, &g.a, std::slice::from_ref(&did))
        .await
        .unwrap();
    write(&pool_b, &mut b, "bbbbbbbbbbb").await;

    let senders = head(&g.store).senders;
    let at = g.store.take(&log_path(&did, cut));
    let above = g.store.take(&log_path(&did, cut + 1));
    assert!(verify_logged(&at, &g.group, &senders, &did, cut).is_ok());
    assert!(verify_logged(&above, &g.group, &senders, &did, cut + 1).is_err());
}

#[tokio::test]
async fn a_snapshot_of_a_removed_device_counts_only_if_its_chain_reaches_the_cut() {
    for replaced in [false, true] {
        let g = group().await;
        let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
        let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
        let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
        write(&pool_b, &mut b, "aaaaaaaaaaa").await;
        b.write_snapshot(&pool_b, exported(&pool_b, "app").await)
            .await
            .unwrap();
        read_all(&pool_a, &mut a).await;
        let manifest = own_seq(&pool_b).await;
        let did = hex::encode(g.b.did);

        // Only the manifest goes back: bootstrapping needs a log that doesn't start at its first object.
        let genuine = take_log(&g);
        let copy_pool = device_pool(&g).await;
        let mut copy = Session::open(&copy_pool, &g.store, &g.b).await.unwrap();
        write(&copy_pool, &mut copy, "ccccccccccc").await;
        copy.write_snapshot(&copy_pool, exported(&copy_pool, "app").await)
            .await
            .unwrap();
        let other = take_log(&g);
        assert_eq!(own_seq(&copy_pool).await, manifest);
        g.store
            .put(&log_path(&did, manifest), genuine[&manifest].clone());

        remove_devices(&pool_a, &a, &g.a, std::slice::from_ref(&did))
            .await
            .unwrap();
        if replaced {
            g.store
                .put(&log_path(&did, manifest), other[&manifest].clone());
        }

        let got = batches_a_new_reader_gets(&g).await;
        assert_eq!(got > 0, !replaced, "replaced: {replaced}");
    }
}
