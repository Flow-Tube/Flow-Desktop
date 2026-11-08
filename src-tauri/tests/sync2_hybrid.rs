//! A server group that also syncs over the LAN (spec/live.md, LAN groups: "Groups on a store sync
//! the same way"): with the server out of reach, a change still goes from one device to another
//! on the LAN, and reaches the server once it answers again.

mod sync2_common;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::held::HeldStore;
use flow_desktop_lib::sync2::hybrid::HybridStore;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::lan_sync::{meet, serve};
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::paths::{kc_name, log_path};
use flow_desktop_lib::sync2::recovery_flow::restore;
use flow_desktop_lib::sync2::roster::Entry;
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result, StoreError};
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, load_group, save_group};
use flow_desktop_lib::sync2::store::Store;
use sqlx::SqlitePool;
use sync2_common::{
    LINK, MemoryStore, device_pool, empty_pool, exported, group, head, watch, watched,
};
use tokio::net::TcpListener;

/// The server's answer to every request: none while it works, else a 503 with this code.
type Outage = Arc<Mutex<Option<&'static str>>>;

/// The fixture's server, out of order during an outage.
struct Server<'a> {
    store: &'a MemoryStore,
    outage: Outage,
}

impl Server<'_> {
    fn check(&self) -> Result<()> {
        match *self.outage.lock().unwrap() {
            Some(code) => Err(StoreError::Refused {
                status: 503,
                code: code.into(),
            }),
            None => Ok(()),
        }
    }
}

impl Store for Server<'_> {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        self.check()?;
        self.store.roster_after(after).await
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        self.check()?;
        self.store.append_roster(head, entry, wraps, chain).await
    }

    async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.check()?;
        self.store.key(epoch, kc, name).await
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.check()?;
        self.store.put_object(path, bytes).await
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.check()?;
        self.store.get_object(path).await
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.check()?;
        self.store.delete_object(path).await
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        self.check()?;
        self.store.changes(cursor).await
    }
}

async fn hybrid<'a>(
    store: &'a MemoryStore,
    outage: &Outage,
    pool: &SqlitePool,
    device: &MemberSecrets,
) -> HybridStore<Server<'a>> {
    let server = Server {
        store,
        outage: Arc::clone(outage),
    };
    HybridStore::new(server, pool.clone(), hex::encode(device.did))
        .await
        .unwrap()
}

async fn pending(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM sync2_pending")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_change_crosses_the_lan_while_the_server_is_down_and_reaches_it_later() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let outage: Outage = Arc::default();
    // A first sync with the server up holds each device's roster and wrap.
    for (pool, device) in [(&pool_a, &g.a), (&pool_b, &g.b)] {
        Session::open(pool, hybrid(&g.store, &outage, pool, device).await, device)
            .await
            .unwrap();
    }

    *outage.lock().unwrap() = Some("unavailable");
    watch(&pool_a, "aaaaaaaaaaa").await;
    let mut a = Session::open(
        &pool_a,
        hybrid(&g.store, &outage, &pool_a, &g.a).await,
        &g.a,
    )
    .await
    .unwrap();
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    let path = log_path(&hex::encode(g.a.did), 1);
    let kept = pending(&pool_a).await;
    assert!(kept > 0, "kept for the server");
    assert!(!g.store.0.lock().unwrap().objects.contains_key(&path));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(
        listener,
        pool_a.clone(),
        g.a.clone(),
        |_| {},
        Arc::new(|_| {}),
    ));
    let met = meet(
        &pool_b,
        &g.b,
        ("127.0.0.1", port),
        None,
        &[],
        Arc::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(i64::try_from(met.taken).unwrap(), kept);

    let mut b = Session::open(
        &pool_b,
        hybrid(&g.store, &outage, &pool_b, &g.b).await,
        &g.b,
    )
    .await
    .unwrap();
    let pulled = b.pull(&pool_b).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&pool_b, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    b.finish(&pool_b, pulled).await.unwrap();
    assert_eq!(watched(&pool_b).await, ["aaaaaaaaaaa"]);

    *outage.lock().unwrap() = None;
    hybrid(&g.store, &outage, &pool_a, &g.a)
        .await
        .upload_pending()
        .await
        .unwrap();
    assert_eq!(pending(&pool_a).await, 0);
    assert!(g.store.0.lock().unwrap().objects.contains_key(&path));
}

#[tokio::test]
async fn a_server_that_lost_the_group_is_not_covered_for() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let outage: Outage = Arc::default();
    let store = hybrid(&g.store, &outage, &pool, &g.a).await;
    *outage.lock().unwrap() = Some("unavailable");
    assert!(
        store.roster_after(-1).await.is_ok(),
        "a passing failure reads what is held"
    );
    *outage.lock().unwrap() = Some("unclaimed");
    assert!(
        store.roster_after(-1).await.is_err(),
        "a reset server is not hidden"
    );
}

/// A server that sends a damaged wrap, or damaged bytes for one path, until told to stop.
struct Damaging<'a> {
    store: &'a MemoryStore,
    wrap: Mutex<bool>,
    path: Mutex<Option<String>>,
}

impl<'a> Damaging<'a> {
    fn new(store: &'a MemoryStore) -> Self {
        Self {
            store,
            wrap: Mutex::new(false),
            path: Mutex::new(None),
        }
    }

    fn heal(&self) {
        *self.wrap.lock().unwrap() = false;
        *self.path.lock().unwrap() = None;
    }
}

impl Store for &Damaging<'_> {
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
        if *self.wrap.lock().unwrap() {
            return Ok(Some(vec![7; 80]));
        }
        self.store.key(epoch, kc, name).await
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.store.put_object(path, bytes).await
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let damaged = self.path.lock().unwrap().as_deref() == Some(path);
        let found = self.store.get_object(path).await?;
        Ok(found.map(|mut bytes| {
            if damaged {
                bytes[150] ^= 1;
            }
            bytes
        }))
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.store.delete_object(path).await
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        self.store.changes(cursor).await
    }
}

async fn over<'a>(
    server: &'a Damaging<'a>,
    pool: &SqlitePool,
    device: &MemberSecrets,
) -> HybridStore<&'a Damaging<'a>> {
    HybridStore::new(server, pool.clone(), hex::encode(device.did))
        .await
        .unwrap()
}

#[tokio::test]
async fn a_damaged_wrap_is_not_kept_and_the_good_one_opens_the_session_later() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let server = Damaging::new(&g.store);
    *server.wrap.lock().unwrap() = true;
    assert!(
        Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
            .await
            .is_err()
    );

    server.heal();
    Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
        .await
        .unwrap();
}

/// A wrap that verified is kept, so a session opens while the server is out of reach.
#[tokio::test]
async fn a_wrap_that_opened_is_kept() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let server = Damaging::new(&g.store);
    Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
        .await
        .unwrap();
    let held: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync2_held_keys")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(held > 0);
}

#[tokio::test]
async fn a_damaged_wrap_held_from_before_gives_way_to_the_good_one() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let commitment = URL_SAFE_NO_PAD.decode(&head(&g.store).kc).unwrap();
    HeldStore::new(pool.clone())
        .hold_key(0, &kc_name(&commitment), &hex::encode(g.b.did), &[7; 80])
        .await
        .unwrap();
    let server = Damaging::new(&g.store);
    assert!(
        Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
            .await
            .is_err()
    );
    Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
        .await
        .unwrap();
}

/// On a LAN group a member can hand over a wrap this device can't check when it takes it.
#[tokio::test]
async fn a_damaged_wrap_taken_from_a_member_is_dropped_for_the_next_meeting() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let server = Damaging::new(&g.store);
    Session::open(&pool, over(&server, &pool, &g.b).await, &g.b)
        .await
        .unwrap();
    let held = HeldStore::new(pool.clone());
    let commitment = URL_SAFE_NO_PAD.decode(&head(&g.store).kc).unwrap();
    let (kc, name) = (kc_name(&commitment), hex::encode(g.b.did));
    held.forget_key(0, &kc, &name).await.unwrap();
    held.hold_key(0, &kc, &name, &[7; 80]).await.unwrap();

    assert!(Session::open(&pool, held.clone(), &g.b).await.is_err());
    assert_eq!(held.key(0, &kc, &name).await.unwrap(), None);
}

#[tokio::test]
async fn a_damaged_object_is_not_kept_and_the_good_one_is_read_later() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    let path = log_path(&hex::encode(g.a.did), 1);

    let server = Damaging::new(&g.store);
    *server.path.lock().unwrap() = Some(path.clone());
    let mut b = Session::open(&pool_b, over(&server, &pool_b, &g.b).await, &g.b)
        .await
        .unwrap();
    assert!(b.pull(&pool_b).await.unwrap().batches.is_empty());
    assert_eq!(held_object(&pool_b, &path).await, None);
    drop(b);

    server.heal();
    let mut b = Session::open(&pool_b, over(&server, &pool_b, &g.b).await, &g.b)
        .await
        .unwrap();
    assert!(!b.pull(&pool_b).await.unwrap().batches.is_empty());
    assert!(held_object(&pool_b, &path).await.is_some());
}

#[tokio::test]
async fn a_damaged_object_held_from_before_gives_way_to_the_good_one() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    let path = log_path(&hex::encode(g.a.did), 1);
    let mut damaged = (&g.store).get_object(&path).await.unwrap().unwrap();
    damaged[150] ^= 1;
    HeldStore::new(pool_b.clone())
        .put_object(&path, damaged)
        .await
        .unwrap();

    let server = Damaging::new(&g.store);
    let mut b = Session::open(&pool_b, over(&server, &pool_b, &g.b).await, &g.b)
        .await
        .unwrap();
    assert!(b.pull(&pool_b).await.unwrap().batches.is_empty());
    assert!(!b.pull(&pool_b).await.unwrap().batches.is_empty());
}

async fn held_object(pool: &SqlitePool, path: &str) -> Option<Vec<u8>> {
    HeldStore::new(pool.clone()).get_object(path).await.unwrap()
}

#[tokio::test]
async fn a_restore_does_not_remove_devices_while_the_server_is_down() {
    let g = group().await;
    let device = member_secrets(random_bytes(), random_bytes());
    let meta = DeviceMeta {
        app: "app-new".into(),
        name: "New".into(),
        platform: "linux".into(),
    };
    let restored = restore(&&g.store, &&g.store, &g.recovery, &device, &meta)
        .await
        .unwrap();
    let pool = empty_pool().await;
    add_roster_entries(&pool, &restored.entries).await.unwrap();
    let record = GroupRecord::new(hex::encode(g.group), "memory".into(), None, LINK.into())
        .restored_keeping(&[]);
    save_group(&pool, &record).await.unwrap();
    let epoch = head(&g.store).epoch;
    let outage: Outage = Arc::default();

    // One try with the server up holds this device's wrap, so only the check below can stop it.
    g.store.0.lock().unwrap().refuse_appends = true;
    let store = hybrid(&g.store, &outage, &pool, &device).await;
    assert!(Session::open(&pool, store, &device).await.is_err());
    g.store.0.lock().unwrap().refuse_appends = false;

    *outage.lock().unwrap() = Some("unavailable");
    let store = hybrid(&g.store, &outage, &pool, &device).await;
    assert!(matches!(
        Session::open(&pool, store, &device).await,
        Err(EngineError::Store(StoreError::Refused { status: 503, .. }))
    ));
    assert_eq!(head(&g.store).epoch, epoch);
    assert!(
        load_group(&pool)
            .await
            .unwrap()
            .unwrap()
            .restore_kept
            .is_some()
    );

    *outage.lock().unwrap() = None;
    let store = hybrid(&g.store, &outage, &pool, &device).await;
    Session::open(&pool, store, &device).await.unwrap();
    assert_eq!(head(&g.store).epoch, epoch + 1);
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

/// A server that refuses one path, as it does an object it holds different bytes for.
struct RefusingPath<'a> {
    store: &'a MemoryStore,
    path: Mutex<Option<String>>,
}

impl Store for &RefusingPath<'_> {
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
        if self.path.lock().unwrap().as_deref() == Some(path) {
            return Err(StoreError::Refused {
                status: 409,
                code: "conflict".into(),
            });
        }
        self.store.put_object(path, bytes).await
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.store.get_object(path).await
    }

    async fn delete_object(&self, path: &str) -> Result<bool> {
        self.store.delete_object(path).await
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        self.store.changes(cursor).await
    }
}

#[tokio::test]
async fn a_refused_object_waits_in_order_and_reads_go_on() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_b, "bbbbbbbbbbb").await;
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    b.push(&pool_b, exported(&pool_b, "app-b").await)
        .await
        .unwrap();

    let me = hex::encode(g.a.did);
    let (first, second) = (log_path(&me, 1), log_path(&me, 2));
    let server = RefusingPath {
        store: &g.store,
        path: Mutex::new(Some(first.clone())),
    };
    let store = HybridStore::new(&server, pool_a.clone(), me).await.unwrap();
    let mut a = Session::open(&pool_a, store, &g.a).await.unwrap();

    watch(&pool_a, "aaaaaaaaaaa").await;
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    let pulled = a.pull(&pool_a).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&pool_a, "app-a", sender, batches, now_ms())
            .await
            .unwrap();
    }
    a.finish(&pool_a, pulled).await.unwrap();
    assert_eq!(watched(&pool_a).await, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    assert!(matches!(
        a.store().upload_pending().await,
        Err(StoreError::Refused { status: 409, .. })
    ));
    let waiting = pending(&pool_a).await;
    assert!(waiting >= 2, "the ack waits behind the batch");
    let objects = |path: &str| g.store.0.lock().unwrap().objects.contains_key(path);
    assert!(!objects(&first));
    assert!(!objects(&second), "nothing goes ahead of what was refused");

    *server.path.lock().unwrap() = None;
    a.store().upload_pending().await.unwrap();
    assert_eq!(pending(&pool_a).await, 0);
    assert!(objects(&first) && objects(&second));

    let pulled = b.pull(&pool_b).await.unwrap();
    assert!(pulled.batches.contains_key(&hex::encode(g.a.did)));
}

#[test]
fn a_refused_sign_in_or_a_lost_group_is_not_a_refused_write() {
    let refused = |status, code: &str| StoreError::Refused {
        status,
        code: code.into(),
    };
    assert!(refused(409, "conflict").refused_write());
    assert!(refused(507, "quota").refused_write());
    assert!(!refused(401, "unauthorized").refused_write());
    assert!(!refused(503, "unclaimed").refused_write());
    assert!(!StoreError::SignInRefused.refused_write());
}
