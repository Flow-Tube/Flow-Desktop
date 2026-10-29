//! The FLOW-SYNC/2 test fixture: an in-memory store with the server's rules (roster, keys,
//! objects, change cursor, pairing mailbox) and a group of two devices.

// Each test binary uses part of this module.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::protocol::OutgoingCollection;
use flow_desktop_lib::sync2::entries::{Draft, build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::mailbox::Mailbox;
use flow_desktop_lib::sync2::roster::{Entry, Op, Role, RosterState, replay_roster};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result};
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, save_group};
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::wrap::wrap_epoch_key;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

pub const LINK: &str = "default-link";

#[derive(Default)]
pub struct Memory {
    pub roster: Vec<Entry>,
    pub keys: BTreeMap<(u32, String), Vec<u8>>,
    pub objects: BTreeMap<String, (u64, Vec<u8>)>,
    pub mailbox: BTreeMap<String, Vec<u8>>,
    /// Every delete request made, found or not.
    pub deletes: Vec<String>,
    cursor: u64,
}

/// The server's rules in memory: linear roster appends, immutable objects, one change cursor.
#[derive(Default)]
pub struct MemoryStore(pub Mutex<Memory>);

impl MemoryStore {
    pub fn put(&self, path: &str, bytes: Vec<u8>) {
        let mut memory = self.0.lock().unwrap();
        memory.cursor += 1;
        let cursor = memory.cursor;
        memory.objects.insert(path.to_owned(), (cursor, bytes));
    }

    pub fn take(&self, path: &str) -> Vec<u8> {
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

    async fn delete_object(&self, path: &str) -> Result<bool> {
        let mut memory = self.0.lock().unwrap();
        memory.deletes.push(path.to_owned());
        Ok(memory.objects.remove(path).is_some())
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

pub struct Group {
    pub store: MemoryStore,
    pub group: [u8; 16],
    pub epoch_key: [u8; 32],
    pub a: MemberSecrets,
    pub b: MemberSecrets,
    pub recovery: MemberSecrets,
}

pub async fn wraps(
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

pub fn draft(op: Op, signer: &MemberSecrets) -> Draft {
    Draft {
        op,
        signer: hex::encode(signer.did),
        add: None,
        remove: None,
        epoch: None,
        meta: None,
    }
}

pub fn head(store: &MemoryStore) -> RosterState {
    replay_roster(&store.0.lock().unwrap().roster).unwrap()
}

/// A group of devices A and B, as A's genesis and A adding B.
pub async fn group() -> Group {
    let (a, b) = (
        member_secrets(random_bytes(), random_bytes()),
        member_secrets(random_bytes(), random_bytes()),
    );
    let recovery = member_secrets(random_bytes(), random_bytes());
    let (group, epoch_key): ([u8; 16], [u8; 32]) = (random_bytes(), random_bytes());
    let store = MemoryStore::default();
    let mut genesis = draft(Op::Genesis, &a);
    genesis.add = Some(vec![
        member_subject(&a.sig_public, &a.kem_public, Role::Device),
        member_subject(&recovery.sig_public, &recovery.kem_public, Role::Recovery),
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
    add.add = Some(vec![member_subject(
        &b.sig_public,
        &b.kem_public,
        Role::Device,
    )]);
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

pub async fn device_pool(group: &Group) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let record = GroupRecord::new(hex::encode(group.group), "memory".into(), None, LINK.into());
    save_group(&pool, &record).await.unwrap();
    let genesis = group.store.0.lock().unwrap().roster[0].clone();
    add_roster_entries(&pool, &[genesis]).await.unwrap();
    pool
}

impl Mailbox for &MemoryStore {
    async fn open_slot(&self, _slot: &str) -> Result<()> {
        Ok(())
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .mailbox
            .insert(format!("{slot}/{name}"), bytes);
        Ok(())
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .mailbox
            .get(&format!("{slot}/{name}"))
            .cloned())
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .mailbox
            .retain(|name, _| !name.starts_with(slot));
        Ok(())
    }
}

/// A migrated database with no group yet, for a device about to join.
pub async fn empty_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

/// Every collection, exported as the app would before a push.
pub async fn exported(pool: &SqlitePool, app_id: &str) -> Vec<OutgoingCollection> {
    export_collections(pool, app_id, &Collection::ALL)
        .await
        .unwrap()
}
