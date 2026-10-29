//! FLOW-SYNC/2 LAN groups over loopback sockets: two members holding a group exchange their
//! objects in one session, and a roster fork resolves the same way on both.

mod sync2_common;

use std::time::Duration;

use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::group_store::GroupStore;
use flow_desktop_lib::sync2::held::HeldStore;
use flow_desktop_lib::sync2::keys::MemberSecrets;
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::lan_sync::{meet, serve};
use flow_desktop_lib::sync2::linking::{
    DeviceMeta, WelcomeStore, add_device, add_scanned, answer_shown, finish_lan_join, join_on_lan,
};
use flow_desktop_lib::sync2::membership::rename_device;
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::pipe::listen_on;
use flow_desktop_lib::sync2::roster::{Entry, fork_winner};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, save_group};
use flow_desktop_lib::sync2::state::{StoreKind, load_group};
use flow_desktop_lib::sync2::store::Store;
use sqlx::SqlitePool;
use sync2_common::{Group, LINK, empty_pool, exported, group};
use tokio::net::TcpListener;

/// A device that holds the group as pairing leaves it: the roster and the wraps, no objects.
async fn holding(g: &Group) -> SqlitePool {
    let (roster, keys) = {
        let memory = g.store.0.lock().unwrap();
        (memory.roster.clone(), memory.keys.clone())
    };
    let pool = empty_pool().await;
    let held = HeldStore::new(pool.clone());
    for entry in &roster {
        held.hold_entry(entry).await.unwrap();
    }
    for ((epoch, name), bytes) in keys {
        held.hold_key(epoch, &name, &bytes).await.unwrap();
    }
    add_roster_entries(&pool, &roster[..1]).await.unwrap();
    let record = GroupRecord::on_lan(hex::encode(g.group), LINK.into());
    save_group(&pool, &record).await.unwrap();
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

async fn push(pool: &SqlitePool, device: &MemberSecrets) {
    let mut session = Session::open(pool, HeldStore::new(pool.clone()), device)
        .await
        .unwrap();
    session
        .push(pool, exported(pool, "app").await)
        .await
        .unwrap();
}

/// Starts `device` answering sessions on a loopback port.
async fn listening(pool: &SqlitePool, device: &MemberSecrets) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(listener, pool.clone(), device.clone(), |_| {}));
    port
}

/// Waits until `pool` holds `path`, which the answering side pulls on its own schedule.
async fn eventually_holds(pool: &SqlitePool, path: &str) -> bool {
    let held = HeldStore::new(pool.clone());
    for _ in 0..50 {
        if held.get_object(path).await.unwrap().is_some() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[tokio::test]
async fn two_members_exchange_their_objects_in_one_session() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;
    watch(&pool_b, "bbbbbbbbbbb").await;
    push(&pool_a, &g.a).await;
    push(&pool_b, &g.b).await;

    let port = listening(&pool_a, &g.a).await;
    let met = meet(&pool_b, &g.b, "127.0.0.1", port).await.unwrap();
    assert_eq!(met.peer, hex::encode(g.a.did));
    assert!(met.taken > 0);
    assert!(eventually_holds(&pool_a, &log_path(&hex::encode(g.b.did), 1)).await);

    let mut session = Session::open(&pool_b, HeldStore::new(pool_b.clone()), &g.b)
        .await
        .unwrap();
    let pulled = session.pull(&pool_b).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&pool_b, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    session.finish(&pool_b, pulled).await.unwrap();
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT video_id FROM watch_history ORDER BY video_id")
            .fetch_all(&pool_b)
            .await
            .unwrap();
    assert_eq!(ids, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
}

fn named(name: &str) -> DeviceMeta {
    DeviceMeta {
        app: "app".into(),
        name: name.into(),
        platform: "linux".into(),
    }
}

/// The entry at the top of what `pool` holds.
async fn head_of(pool: &SqlitePool) -> Entry {
    let held = HeldStore::new(pool.clone());
    held.roster_after(-1)
        .await
        .unwrap()
        .last()
        .cloned()
        .unwrap()
}

/// Both devices rename device A at the same `seq`, each on its own copy of the group.
async fn concurrent_renames(g: &Group) -> (SqlitePool, SqlitePool) {
    let (pool_a, pool_b) = (holding(g).await, holding(g).await);
    let a_did = hex::encode(g.a.did);
    for (pool, device, name) in [(&pool_a, &g.a, "from A"), (&pool_b, &g.b, "from B")] {
        let session = Session::open(pool, HeldStore::new(pool.clone()), device)
            .await
            .unwrap();
        rename_device(&session, device, &a_did, &named(name))
            .await
            .unwrap();
    }
    (pool_a, pool_b)
}

/// Waits until the two devices agree, since the answering side pulls on its own schedule.
async fn eventually_agree(pool_a: &SqlitePool, pool_b: &SqlitePool) -> (Entry, Entry) {
    for _ in 0..50 {
        let (on_a, on_b) = (head_of(pool_a).await, head_of(pool_b).await);
        if on_a == on_b {
            return (on_a, on_b);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    (head_of(pool_a).await, head_of(pool_b).await)
}

#[tokio::test]
async fn concurrent_renames_resolve_to_the_same_winner_on_both_devices() {
    let g = group().await;
    let (pool_a, pool_b) = concurrent_renames(&g).await;
    let port = listening(&pool_a, &g.a).await;
    meet(&pool_b, &g.b, "127.0.0.1", port).await.unwrap();
    let (on_a, on_b) = eventually_agree(&pool_a, &pool_b).await;
    assert_eq!(on_a.seq, 2);
    assert_eq!(on_a, on_b);
}

#[tokio::test]
async fn a_device_whose_entry_lost_learns_the_winner_from_a_peer_holding_both() {
    let g = group().await;
    let (pool_a, pool_b) = concurrent_renames(&g).await;
    let (entry_a, entry_b) = (head_of(&pool_a).await, head_of(&pool_b).await);
    let a_won = fork_winner(&[entry_a.clone(), entry_b.clone()]) == Some(&entry_a);
    let ((winner, winner_device), (loser, loser_device, losing)) = if a_won {
        ((&pool_a, &g.a), (&pool_b, &g.b, entry_b))
    } else {
        ((&pool_b, &g.b), (&pool_a, &g.a, entry_a))
    };
    // The winning device already fetched the losing entry, as when both pull at once.
    HeldStore::new(winner.clone())
        .hold_entry(&losing)
        .await
        .unwrap();

    let port = listening(winner, winner_device).await;
    meet(loser, loser_device, "127.0.0.1", port).await.unwrap();
    assert_eq!(head_of(loser).await, head_of(winner).await);
}

fn loopback() -> Vec<String> {
    vec!["127.0.0.1".into()]
}

/// After pairing, the new device holds the group and gets the member's objects when they meet.
async fn joined_and_synced(g: &Group, pool_a: &SqlitePool, pool_n: &SqlitePool, n: &MemberSecrets) {
    let record = load_group(pool_n).await.unwrap().unwrap();
    assert_eq!(record.kind, StoreKind::Lan);
    assert!(
        Session::open(pool_n, HeldStore::new(pool_n.clone()), n)
            .await
            .is_ok()
    );
    let port = listening(pool_a, &g.a).await;
    let met = meet(pool_n, n, "127.0.0.1", port).await.unwrap();
    assert!(met.taken > 0, "the member's objects arrive once they meet");
}

#[tokio::test]
async fn a_new_device_scans_a_lan_group_member_and_then_syncs() {
    let g = group().await;
    let pool_a = holding(&g).await;
    watch(&pool_a, "aaaaaaaaaaa").await;
    push(&pool_a, &g.a).await;
    let session = Session::open(
        &pool_a,
        GroupStore::Held(HeldStore::new(pool_a.clone())),
        &g.a,
    )
    .await
    .unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(
        Some(StoreLocation::lan()),
        "Desktop A",
        Some(listen_on(loopback()).await.unwrap()),
    );
    let code = read_code(&offer.qr).unwrap();
    let shown = |_sas: String| async { true };
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, WelcomeStore::Lan, shown),
        async {
            let welcomed = join_on_lan(&code, &newcomer, named("New"), shown).await?;
            finish_lan_join(&pool_n, &newcomer, welcomed).await
        },
    );
    joined.unwrap();
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
    joined_and_synced(&g, &pool_a, &pool_n, &newcomer).await;
}

#[tokio::test]
async fn a_lan_group_member_scans_a_new_device_code() {
    let g = group().await;
    let pool_a = holding(&g).await;
    watch(&pool_a, "aaaaaaaaaaa").await;
    push(&pool_a, &g.a).await;
    let session = Session::open(
        &pool_a,
        GroupStore::Held(HeldStore::new(pool_a.clone())),
        &g.a,
    )
    .await
    .unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(None, "New", Some(listen_on(loopback()).await.unwrap()));
    let code = read_code(&offer.qr).unwrap();
    let shown = |_sas: String| async { true };
    let (added, joined) = tokio::join!(
        add_scanned(&session, &code, &g.a, WelcomeStore::Lan, shown),
        async {
            let welcomed = answer_shown(offer, &newcomer, named("New"), shown).await?;
            finish_lan_join(&pool_n, &newcomer, welcomed).await
        }
    );
    joined.unwrap();
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
    joined_and_synced(&g, &pool_a, &pool_n, &newcomer).await;
}
