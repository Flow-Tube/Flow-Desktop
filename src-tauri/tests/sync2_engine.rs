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
use flow_desktop_lib::sync2::batches::{apply_batches, batch_content};
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::entries::{build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::envelope::{Header, ObjectType, ZERO_HASH, seal_object};
use flow_desktop_lib::sync2::epoch::{Purpose, purpose_key, seal_chain};
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::payload::encode_payload;
use flow_desktop_lib::sync2::roster::{Entry, Op, Role};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result};
use flow_desktop_lib::sync2::store::Store;
use sqlx::SqlitePool;
use sync2_common::{
    Group, MemoryStore, device_pool, draft, exported, group, head, watch, watched, wraps,
};

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

/// Adds device C to the group, wrapping it the key of `epoch`.
async fn add_device(g: &Group, epoch: u32, key: &[u8; 32]) -> MemberSecrets {
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
            &wraps(&g.group, epoch, key, &[&c]).await,
            None,
        )
        .await
        .unwrap();
    c
}

#[tokio::test]
async fn a_tampered_object_stops_only_its_sender_s_log() {
    let g = group().await;
    let c = add_device(&g, 0, &g.epoch_key).await;
    let (pool_a, pool_b, pool_c) = (
        device_pool(&g).await,
        device_pool(&g).await,
        device_pool(&g).await,
    );
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();
    watch(&pool_c, "ccccccccccc").await;
    sync(&pool_c, &g.store, &c, "app-c").await.unwrap();
    let path = log_path(&hex::encode(g.a.did), 1);
    let genuine = g.store.tamper(&path);

    sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap();
    assert_eq!(watched(&pool_b).await, ["ccccccccccc"]);

    g.store.put(&path, genuine);
    sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa", "ccccccccccc"]);
}

/// `sender`'s first batch, sealed and signed correctly, holding `content`.
fn first_batch(g: &Group, sender: &MemberSecrets, content: &[u8]) {
    let header = Header {
        object_type: ObjectType::Changes,
        group: g.group,
        epoch: 0,
        sender: sender.did,
        seq: 1,
        prev: ZERO_HASH,
    };
    let key = purpose_key(&g.epoch_key, &g.group, 0, Purpose::Changes);
    let object = seal_object(
        &header,
        &key,
        &encode_payload(content).unwrap(),
        &sender.sig_seed,
    );
    g.store.put(&log_path(&hex::encode(sender.did), 1), object);
}

#[tokio::test]
async fn a_signed_batch_this_build_cannot_parse_stops_only_its_sender_s_log() {
    let g = group().await;
    let c = add_device(&g, 0, &g.epoch_key).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    first_batch(&g, &c, b"not a header");
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();

    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let pulled = b.pull(&pool_b).await.unwrap();
    assert!(pulled.batches.contains_key(&hex::encode(g.a.did)));
    assert!(!pulled.batches.contains_key(&hex::encode(c.did)));
}

#[tokio::test]
async fn a_batch_with_an_unreadable_record_does_not_end_the_run() {
    let g = group().await;
    let c = add_device(&g, 0, &g.epoch_key).await;
    let pool_b = device_pool(&g).await;
    let content = batch_content(
        "watch_history",
        &head(&g.store).head,
        Some("default-link"),
        &[b"not json".as_slice()],
    );
    first_batch(&g, &c, &content);

    sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap();
    assert_eq!(sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap(), 0);
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

    let c = add_device(&g, 1, &next_key).await;
    let pool_c = device_pool(&g).await;
    sync(&pool_c, &g.store, &c, "app-c").await.unwrap();
    assert_eq!(watched(&pool_c).await, ["aaaaaaaaaaa"]);
}

/// Answers `changes` with one object per page, as a server does past its page limit.
struct OnePerPage<'a>(&'a MemoryStore);

impl Store for OnePerPage<'_> {
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
    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.0.key(epoch, kc, name).await
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
        let memory = self.0.0.lock().unwrap();
        let first = memory
            .objects
            .iter()
            .filter(|(_, (at, _))| *at > cursor)
            .min_by_key(|(_, (at, _))| *at);
        Ok(first.map_or((Vec::new(), cursor), |(path, (at, bytes))| {
            let size = bytes.len() as u64;
            (
                vec![ChangedObject {
                    path: path.clone(),
                    size,
                }],
                *at,
            )
        }))
    }
}

/// C's first object arrived before anything of A's. Returns the path and C's genuine bytes.
async fn a_tampered_object_before_another_sender(
    g: &Group,
    c: &MemberSecrets,
    pool_a: &SqlitePool,
    pool_c: &SqlitePool,
) -> (String, Vec<u8>) {
    watch(pool_c, "ccccccccccc").await;
    sync(pool_c, &g.store, c, "app-c").await.unwrap();
    let path = log_path(&hex::encode(c.did), 1);
    let genuine = g.store.tamper(&path);
    watch(pool_a, "aaaaaaaaaaa").await;
    sync(pool_a, &g.store, &g.a, "app-a").await.unwrap();
    (path, genuine)
}

#[tokio::test]
async fn a_sender_that_stopped_does_not_hide_others_on_later_pages() {
    let g = group().await;
    let c = add_device(&g, 0, &g.epoch_key).await;
    let (pool_a, pool_b, pool_c) = (
        device_pool(&g).await,
        device_pool(&g).await,
        device_pool(&g).await,
    );
    let (path, genuine) = a_tampered_object_before_another_sender(&g, &c, &pool_a, &pool_c).await;

    sync(&pool_b, OnePerPage(&g.store), &g.b, "app-b")
        .await
        .unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa"]);

    // Same place in the listing: the next sync has to list that page again.
    g.store.0.lock().unwrap().objects.get_mut(&path).unwrap().1 = genuine;
    sync(&pool_b, OnePerPage(&g.store), &g.b, "app-b")
        .await
        .unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa", "ccccccccccc"]);
}

#[tokio::test]
async fn a_log_listed_backwards_across_pages_is_still_read() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();
    watch(&pool_a, "ccccccccccc").await;
    sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap();

    let first = log_path(&hex::encode(g.a.did), 1);
    let bytes = g.store.take(&first);
    g.store.put(&first, bytes);

    sync(&pool_b, OnePerPage(&g.store), &g.b, "app-b")
        .await
        .unwrap();
    sync(&pool_b, OnePerPage(&g.store), &g.b, "app-b")
        .await
        .unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa", "ccccccccccc"]);
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
    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.0.key(epoch, kc, name).await
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

/// A store whose cursor keeps advancing, naming a new object of `sender`'s on every page.
struct Endless<'a> {
    store: &'a MemoryStore,
    sender: String,
}

impl Store for Endless<'_> {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        self.store.roster_after(after).await
    }
    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        self.store.append_roster(head, entry, wraps, chain).await
    }
    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.store.key(epoch, kc, name).await
    }
    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.store.put_object(path, bytes).await
    }
    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.store.get_object(path).await
    }
    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.store.delete_object(path).await
    }
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        // Lets the test's timeout fire on a reader that never stops.
        tokio::task::yield_now().await;
        let path = log_path(&self.sender, cursor + 2);
        Ok((vec![ChangedObject { path, size: 0 }], cursor + 1))
    }
}

#[tokio::test]
async fn a_scan_for_a_new_reader_ends_on_a_cursor_that_never_runs_out() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let store = Endless {
        store: &g.store,
        sender: hex::encode(g.a.did),
    };
    let mut b = Session::open(&pool, store, &g.b).await.unwrap();
    let read = tokio::time::timeout(Duration::from_secs(20), b.pull(&pool))
        .await
        .expect("the scan ends");
    assert!(read.is_err(), "a partial scan can't pick a starting point");
}

#[tokio::test]
async fn a_read_ends_on_a_cursor_that_never_runs_out_and_keeps_its_place() {
    let g = group().await;
    let pool = device_pool(&g).await;
    sqlx::query("UPDATE sync2_group SET cursor = 5")
        .execute(&pool)
        .await
        .unwrap();
    let store = Endless {
        store: &g.store,
        // This device's own log, which a reader skips.
        sender: hex::encode(g.b.did),
    };
    let mut b = Session::open(&pool, store, &g.b).await.unwrap();
    let pulled = tokio::time::timeout(Duration::from_secs(20), b.pull(&pool))
        .await
        .expect("the read ends")
        .unwrap();
    b.finish(&pool, pulled).await.unwrap();
    assert!(b.record().cursor > 5, "the next sync goes on from here");
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
