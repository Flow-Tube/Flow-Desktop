//! A server group that also syncs over the LAN (spec/live.md, LAN groups: "Groups on a store sync
//! the same way"): with the server out of reach, a change still goes from one device to another
//! on the LAN, and reaches the server once it answers again.

mod sync2_common;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::hybrid::HybridStore;
use flow_desktop_lib::sync2::keys::MemberSecrets;
use flow_desktop_lib::sync2::lan_sync::{meet, serve};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::roster::Entry;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result, StoreError};
use flow_desktop_lib::sync2::store::Store;
use sqlx::SqlitePool;
use sync2_common::{MemoryStore, device_pool, exported, group, watch, watched};
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

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.check()?;
        self.store.key(epoch, name).await
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
    let met = meet(&pool_b, &g.b, ("127.0.0.1", port), &[], Arc::new(|_| {}))
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
