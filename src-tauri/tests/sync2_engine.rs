//! The FLOW-SYNC/2 engine between two databases through an in-memory store with the server's
//! rules: push and pull, acknowledgements, a hostile store, missing objects, removal, and a new
//! device reading objects from an earlier epoch.

mod sync2_common;

use std::collections::BTreeMap;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::entries::{build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::epoch::seal_chain;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::roster::{Entry, Op, Role};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result};
use flow_desktop_lib::sync2::store::Store;
use sqlx::SqlitePool;
use sync2_common::{MemoryStore, device_pool, draft, exported, group, head, watch, watched, wraps};

/// One full sync: push, pull, apply what was read, finish.
async fn sync<S: Store>(
    pool: &SqlitePool,
    store: S,
    device: &MemberSecrets,
    app_id: &str,
) -> std::result::Result<usize, EngineError> {
    let mut session = Session::open(pool, store, device).await?;
    session.push(pool, exported(pool, app_id).await).await?;
    let pulled = session.pull(pool).await?;
    for (sender, batches) in &pulled.batches {
        apply_batches(pool, app_id, sender, batches, now_ms()).await?;
    }
    let read = pulled.batches.values().map(Vec::len).sum();
    session.finish(pool, pulled).await?;
    Ok(read)
}

#[tokio::test]
async fn two_devices_exchange_changes_and_acknowledgements() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    watch(&pool_b, "bbbbbbbbbbb").await;

    assert_eq!(sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap(), 0);
    assert!(sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap() > 0);
    assert!(sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap() > 0);
    assert_eq!(watched(&pool_a).await, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap();
    let before = g.store.0.lock().unwrap().objects.len();
    for _ in 0..3 {
        assert_eq!(sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap(), 0);
        assert_eq!(sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap(), 0);
    }
    let after = g.store.0.lock().unwrap().objects.len();
    assert_eq!(after, before, "acks aren't acknowledged");
}

/// Pushes only watch history, so each change is one batch, then reads and acknowledges.
async fn sync_history(pool: &SqlitePool, store: &MemoryStore, device: &MemberSecrets) -> i64 {
    let mut session = Session::open(pool, store, device).await.unwrap();
    let history = export_collections(pool, "app", &[Collection::WatchHistory])
        .await
        .unwrap();
    session.push(pool, history).await.unwrap();
    let pulled = session.pull(pool).await.unwrap();
    session.finish(pool, pulled).await.unwrap();
    session.record().own_seq
}

#[tokio::test]
async fn idle_devices_stop_after_one_batch_and_one_ack_each() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    watch(&pool_b, "bbbbbbbbbbb").await;
    for _ in 0..4 {
        sync_history(&pool_a, &g.store, &g.a).await;
        sync_history(&pool_b, &g.store, &g.b).await;
    }
    assert_eq!(sync_history(&pool_a, &g.store, &g.a).await, 2);
    assert_eq!(sync_history(&pool_b, &g.store, &g.b).await, 2);
}

#[tokio::test]
async fn a_tampered_object_is_refused() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();
    let path = log_path(&hex::encode(g.a.did), 1);
    let mut bytes = g.store.take(&path);
    bytes[150] ^= 1;
    g.store.put(&path, bytes);
    let error = sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap_err();
    assert!(matches!(error, EngineError::Protocol(e) if e.code() == "signature"));
    assert!(watched(&pool_b).await.is_empty());
}

#[tokio::test]
async fn a_missing_object_stalls_reading_until_it_arrives() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();
    watch(&pool_a, "ccccccccccc").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();

    let first = log_path(&hex::encode(g.a.did), 1);
    let withheld = g.store.take(&first);
    assert_eq!(sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap(), 0);
    assert!(watched(&pool_b).await.is_empty());

    g.store.put(&first, withheld);
    sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa", "ccccccccccc"]);
}

#[tokio::test]
async fn a_removed_device_stops_and_a_new_device_reads_the_old_epoch() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let pool_b = device_pool(&g).await;
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();

    let next_key: [u8; 32] = random_bytes();
    let mut remove = draft(Op::Remove, &g.a);
    remove.remove = Some(vec![hex::encode(g.b.did)]);
    remove.epoch = Some(epoch_draft(
        &next_key,
        &g.group,
        1,
        &[g.a.did, g.recovery.did],
    ));
    let state = head(&g.store);
    let entry = build_entry(&g.group, Some(&state), remove, &[&g.a]);
    let chain = URL_SAFE_NO_PAD.encode(seal_chain(&next_key, &g.group, 1, &g.epoch_key));
    let kept = wraps(&g.group, 1, &next_key, &[&g.a, &g.recovery]).await;
    (&g.store)
        .append_roster(&state.head, &entry, &kept, Some(&chain))
        .await
        .unwrap();
    assert!(matches!(
        sync(&pool_b, &g.store, &g.b, "app-b").await,
        Err(EngineError::Removed)
    ));

    let c = member_secrets(random_bytes(), random_bytes());
    let mut add = draft(Op::Add, &g.a);
    add.add = Some(vec![member_subject(
        &c.sig_public,
        &c.kem_public,
        Role::Device,
    )]);
    let state = head(&g.store);
    let entry = build_entry(&g.group, Some(&state), add, &[&g.a, &c]);
    (&g.store)
        .append_roster(
            &state.head,
            &entry,
            &wraps(&g.group, 1, &next_key, &[&c]).await,
            None,
        )
        .await
        .unwrap();
    let pool_c = device_pool(&g).await;
    sync(&pool_c, &g.store, &c, "app-c").await.unwrap();
    assert_eq!(watched(&pool_c).await, ["aaaaaaaaaaa"]);
}

/// A store whose change cursor never moves: it hands out every object on each call.
struct Repeating<'a>(&'a MemoryStore);

impl Store for Repeating<'_> {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        self.0.roster_after(after).await
    }
    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        self.0.append_roster(head, entry, wraps, chain).await
    }
    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.0.key(epoch, name).await
    }
    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.0.put_object(path, bytes).await
    }
    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.0.get_object(path).await
    }
    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.0.delete_object(path).await
    }
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        // Lets the test's timeout fire on a reader that never stops.
        tokio::task::yield_now().await;
        Ok((self.0.changes(0).await?.0, cursor))
    }
}

#[tokio::test]
async fn a_page_that_does_not_advance_ends_the_read() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();

    let read = tokio::time::timeout(
        Duration::from_secs(10),
        sync(&pool_b, Repeating(&g.store), &g.b, "app-b"),
    )
    .await
    .expect("the read ends");
    assert!(read.unwrap() > 0);
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa"]);
}
