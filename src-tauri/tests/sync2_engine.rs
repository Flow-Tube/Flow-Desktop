//! The FLOW-SYNC/2 engine between two databases through an in-memory store with the server's
//! rules: push and pull, acknowledgements, a hostile store, missing objects, removal, and a new
//! device reading objects from an earlier epoch.

use std::collections::BTreeMap;
use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::entries::{Draft, build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::epoch::seal_chain;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::roster::{Entry, Op, Role, RosterState, replay_roster};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result};
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, save_group};
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::wrap::wrap_epoch_key;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

const LINK: &str = "default-link";

#[derive(Default)]
struct Memory {
    roster: Vec<Entry>,
    keys: BTreeMap<(u32, String), Vec<u8>>,
    objects: BTreeMap<String, (u64, Vec<u8>)>,
    cursor: u64,
}

/// The server's rules in memory: linear roster appends, immutable objects, one change cursor.
#[derive(Default)]
struct MemoryStore(Mutex<Memory>);

impl MemoryStore {
    fn put(&self, path: &str, bytes: Vec<u8>) {
        let mut memory = self.0.lock().unwrap();
        memory.cursor += 1;
        let cursor = memory.cursor;
        memory.objects.insert(path.to_owned(), (cursor, bytes));
    }

    fn take(&self, path: &str) -> Vec<u8> {
        self.0.lock().unwrap().objects.remove(path).unwrap().1
    }
}

impl Store for &MemoryStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        let memory = self.0.lock().unwrap();
        Ok(memory
            .roster
            .iter()
            .filter(|e| i64::try_from(e.seq).unwrap() > after)
            .cloned()
            .collect())
    }

    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let mut memory = self.0.lock().unwrap();
        let current = replay_roster(&memory.roster).unwrap().head;
        if current != head {
            return Ok(Appended::Conflict { head: current });
        }
        let epoch = entry
            .epoch
            .as_ref()
            .map_or_else(|| replay_roster(&memory.roster).unwrap().epoch, |e| e.n);
        for (did, wrap) in wraps {
            memory
                .keys
                .insert((epoch, did.clone()), URL_SAFE_NO_PAD.decode(wrap).unwrap());
        }
        if let Some(chain) = chain {
            memory.keys.insert(
                (epoch, "chain".to_owned()),
                URL_SAFE_NO_PAD.decode(chain).unwrap(),
            );
        }
        memory.roster.push(entry.clone());
        Ok(Appended::Done)
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .keys
            .get(&(epoch, name.to_owned()))
            .cloned())
    }

    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.put(path, bytes);
        Ok(())
    }

    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .objects
            .get(path)
            .map(|(_, bytes)| bytes.clone()))
    }

    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        let memory = self.0.lock().unwrap();
        let mut changes: Vec<(u64, &String, &Vec<u8>)> = memory
            .objects
            .iter()
            .filter(|(_, (c, _))| *c > cursor)
            .map(|(p, (c, b))| (*c, p, b))
            .collect();
        changes.sort();
        let next = changes.last().map_or(cursor, |(c, _, _)| *c);
        let objects = changes
            .into_iter()
            .map(|(_, path, bytes)| ChangedObject {
                path: path.clone(),
                size: bytes.len() as u64,
            })
            .collect();
        Ok((objects, next))
    }
}

struct Group {
    store: MemoryStore,
    group: [u8; 16],
    epoch_key: [u8; 32],
    a: MemberSecrets,
    b: MemberSecrets,
    recovery: MemberSecrets,
}

async fn wraps(
    group: &[u8],
    epoch: u32,
    key: &[u8],
    members: &[&MemberSecrets],
) -> BTreeMap<String, String> {
    members
        .iter()
        .map(|m| {
            (
                hex::encode(m.did),
                URL_SAFE_NO_PAD
                    .encode(wrap_epoch_key(&m.kem_public, group, epoch, &m.did, key).unwrap()),
            )
        })
        .collect()
}

fn draft(op: Op, signer: &MemberSecrets) -> Draft {
    Draft {
        op,
        signer: hex::encode(signer.did),
        add: None,
        remove: None,
        epoch: None,
        meta: None,
    }
}

fn head(store: &MemoryStore) -> RosterState {
    replay_roster(&store.0.lock().unwrap().roster).unwrap()
}

/// A group of devices A and B, as A's genesis and A adding B.
async fn group() -> Group {
    let (a, b) = (
        member_secrets(random_bytes(), random_bytes()),
        member_secrets(random_bytes(), random_bytes()),
    );
    let recovery = member_secrets(random_bytes(), random_bytes());
    let (group, epoch_key): ([u8; 16], [u8; 32]) = (random_bytes(), random_bytes());
    let store = MemoryStore::default();
    let mut genesis = draft(Op::Genesis, &a);
    genesis.add = Some(vec![
        member_subject(&a, Role::Device),
        member_subject(&recovery, Role::Recovery),
    ]);
    genesis.epoch = Some(epoch_draft(&epoch_key, &group, 0, &[a.did, recovery.did]));
    store
        .0
        .lock()
        .unwrap()
        .roster
        .push(build_entry(&group, None, genesis, &[&a, &recovery]));
    for (did, wrap) in wraps(&group, 0, &epoch_key, &[&a, &recovery]).await {
        store
            .0
            .lock()
            .unwrap()
            .keys
            .insert((0, did), URL_SAFE_NO_PAD.decode(wrap).unwrap());
    }
    let mut add = draft(Op::Add, &a);
    add.add = Some(vec![member_subject(&b, Role::Device)]);
    let state = head(&store);
    let add = build_entry(&group, Some(&state), add, &[&a, &b]);
    let outcome = (&store)
        .append_roster(
            &state.head,
            &add,
            &wraps(&group, 0, &epoch_key, &[&b]).await,
            None,
        )
        .await
        .unwrap();
    assert_eq!(outcome, Appended::Done);
    Group {
        store,
        group,
        epoch_key,
        a,
        b,
        recovery,
    }
}

async fn device_pool(group: &Group) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let record = GroupRecord {
        group_id: hex::encode(group.group),
        store_url: "memory".into(),
        instance: None,
        link: LINK.into(),
        own_seq: 0,
        own_prev: hex::encode([0; 32]),
        cursor: 0,
    };
    save_group(&pool, &record).await.unwrap();
    let genesis = group.store.0.lock().unwrap().roster[0].clone();
    add_roster_entries(&pool, &[genesis]).await.unwrap();
    pool
}

async fn watch(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, 'title', NULL, NULL, '2025-01-01T00:00:00+00:00', 10, 600, 0, 0, '100:0:dA')",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

async fn watched(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT video_id FROM watch_history ORDER BY video_id")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// One full sync: push, pull, apply what was read, finish.
async fn sync(
    pool: &SqlitePool,
    store: &MemoryStore,
    device: &MemberSecrets,
    app_id: &str,
) -> std::result::Result<usize, EngineError> {
    let mut session = Session::open(pool, store, device).await?;
    session.push(pool, app_id).await?;
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

    let before = g.store.0.lock().unwrap().objects.len();
    assert_eq!(sync(&pool_a, &g.store, &g.a, "app-a").await.unwrap(), 0);
    assert_eq!(sync(&pool_b, &g.store, &g.b, "app-b").await.unwrap(), 0);
    let after = g.store.0.lock().unwrap().objects.len();
    assert_eq!(
        after - before,
        1,
        "only the ack of the other device's ack is new"
    );
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
    add.add = Some(vec![member_subject(&c, Role::Device)]);
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
