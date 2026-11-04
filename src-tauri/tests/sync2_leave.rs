//! Leaving a group (spec/protocol.md, Leaving): the leaving device appends `leave`, and the next
//! remaining device to open a session starts an epoch it never receives with `rotate`.

mod sync2_common;

use std::collections::BTreeMap;
use std::sync::Mutex;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::entries::build_entry;
use flow_desktop_lib::sync2::membership::{leave_group, member_keys, new_epoch};
use flow_desktop_lib::sync2::roster::{Entry, Op, entry_hash};
use flow_desktop_lib::sync2::server::{Appended, ChangedObject, Result};
use flow_desktop_lib::sync2::store::Store;
use sync2_common::{Group, MemoryStore, device_pool, draft, group, head};

/// The group after A left: B and the recovery member remain, and a rotate is due.
async fn after_a_left() -> Group {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    leave_group(&session, &g.a).await.unwrap();
    g
}

#[tokio::test]
async fn the_next_device_to_open_a_session_rotates_without_the_one_that_left() {
    let g = after_a_left().await;
    assert!(head(&g.store).rotate);
    let pool_a = device_pool(&g).await;
    assert!(matches!(
        Session::open(&pool_a, &g.store, &g.a).await,
        Err(EngineError::Removed)
    ));

    let pool_b = device_pool(&g).await;
    let session = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let state = head(&g.store);
    assert_eq!(state.epoch, 1);
    assert!(!state.rotate);
    assert_eq!(session.roster().epoch, 1);
    let keys = g.store.0.lock().unwrap().keys.clone();
    for kept in [&g.b, &g.recovery] {
        assert!(keys.contains_key(&(1, hex::encode(kept.did))));
    }
    assert!(!keys.contains_key(&(1, hex::encode(g.a.did))));
    assert!(keys.contains_key(&(1, "chain".to_owned())));

    Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    assert_eq!(head(&g.store).epoch, 1, "one rotation is enough");
}

#[tokio::test]
async fn the_last_device_can_only_forget_the_group() {
    let g = after_a_left().await;
    let pool_b = device_pool(&g).await;
    let session = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let error = leave_group(&session, &g.b).await.unwrap_err();
    assert!(matches!(error, EngineError::Protocol(e) if e.code() == "roster-op"));
}

/// An entry with its wraps and chain box.
type Rival = (Entry, BTreeMap<String, String>, String);

/// A store where another session's entry lands just before the first append.
struct Beaten<'a> {
    store: &'a MemoryStore,
    rival: Mutex<Option<Rival>>,
}

impl Store for Beaten<'_> {
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
        let rival = self.rival.lock().unwrap().take();
        if let Some((rival, rival_wraps, rival_chain)) = rival {
            self.store
                .append_roster(head, &rival, &rival_wraps, Some(&rival_chain))
                .await?;
        }
        self.store.append_roster(head, entry, wraps, chain).await
    }

    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.store.key(epoch, name).await
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
        self.store.changes(cursor).await
    }
}

#[tokio::test]
async fn a_rotate_that_lost_adopts_the_winner_and_does_not_rotate_again() {
    let g = after_a_left().await;
    let state = head(&g.store);
    let epoch = new_epoch(
        &g.group,
        1,
        &member_keys(&state, None).unwrap(),
        &g.epoch_key,
    )
    .unwrap();
    let mut rotate = draft(Op::Rotate, &g.b);
    rotate.epoch = Some(epoch.field);
    let rival = build_entry(&g.group, Some(&state), rotate, &[&g.b]);
    let rival_hash = entry_hash(&rival);
    let beaten = Beaten {
        store: &g.store,
        rival: Mutex::new(Some((rival, epoch.wraps, epoch.chain))),
    };

    let pool_b = device_pool(&g).await;
    let session = Session::open(&pool_b, beaten, &g.b).await.unwrap();
    assert_eq!(session.roster().epoch, 1);
    assert_eq!(session.roster().head, rival_hash);
    assert_eq!(g.store.0.lock().unwrap().roster.len(), 4);
}
