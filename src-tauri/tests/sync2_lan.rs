//! FLOW-SYNC/2 LAN groups over loopback sockets: two members holding a group exchange their
//! objects in one session, and a roster fork resolves the same way on both.

mod sync2_common;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::Error;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::EngineError;
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::entries::{build_entry, member_subject};
use flow_desktop_lib::sync2::group_store::GroupStore;
use flow_desktop_lib::sync2::held::HeldStore;
use flow_desktop_lib::sync2::keys::MemberSecrets;
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::lan_link::LiveSink;
use flow_desktop_lib::sync2::lan_peers::listen;
use flow_desktop_lib::sync2::lan_sync::{Met, meet, meet_as, serve};
use flow_desktop_lib::sync2::linking::{
    DeviceMeta, WelcomeStore, add_device, add_scanned, answer_shown, finish_lan_join, join_on_lan,
};
use flow_desktop_lib::sync2::live_message::{LiveMessage, Now, PlayState};
use flow_desktop_lib::sync2::live_seal::LiveKeys;
use flow_desktop_lib::sync2::membership::{leave_group, member_keys, new_epoch, rename_device};
use flow_desktop_lib::sync2::pairing::pairing_proof;
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::pipe::{Pipe, listen_on};
use flow_desktop_lib::sync2::roster::{Entry, Op, Role, entry_hash, fork_winner};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::Appended;
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, roster_entries, save_group};
use flow_desktop_lib::sync2::state::{StoreKind, load_group};
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::wrap::wrap_epoch_key;
use futures_util::{SinkExt, StreamExt};
use sqlx::SqlitePool;
use sync2_common::{Group, LINK, draft, empty_pool, exported, group, head, watch};
use tokio::io::AsyncReadExt as _;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, connect_async};

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
    for ((epoch, kc, name), bytes) in keys {
        held.hold_key(epoch, &kc, &name, &bytes).await.unwrap();
    }
    add_roster_entries(&pool, &roster[..1]).await.unwrap();
    let record = GroupRecord::on_lan(hex::encode(g.group), LINK.into());
    save_group(&pool, &record).await.unwrap();
    pool
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

fn no_live() -> LiveSink {
    Arc::new(|_| {})
}

/// Starts `device` answering sessions on a loopback port, handing live envelopes to `sink`.
async fn listening_with(pool: &SqlitePool, device: &MemberSecrets, sink: LiveSink) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(listener, pool.clone(), device.clone(), |_| {}, sink));
    port
}

async fn listening(pool: &SqlitePool, device: &MemberSecrets) -> u16 {
    listening_with(pool, device, no_live()).await
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
async fn sessions_opened_together_keep_the_same_new_entry_once() {
    let g = group().await;
    let pool = holding(&g).await;
    let fresh = HeldStore::new(pool.clone()).roster_after(0).await.unwrap();
    // Both read the entry before either kept it.
    add_roster_entries(&pool, &fresh).await.unwrap();
    add_roster_entries(&pool, &fresh).await.unwrap();
    assert!(
        Session::open(&pool, HeldStore::new(pool.clone()), &g.b)
            .await
            .is_ok()
    );
}

/// A peer sends entries as JSON; one that isn't well formed must not make the held roster unreadable.
#[tokio::test]
async fn a_malformed_entry_from_a_peer_is_not_held() {
    let g = group().await;
    let held = HeldStore::new(holding(&g).await);
    let mut entry = g.store.0.lock().unwrap().roster[1].clone();
    entry.v = 3;
    let refused = held.hold_entry(&entry).await.is_err();
    assert_eq!(held.chain().await.unwrap().last().unwrap().seq, 1);
    assert!(refused);
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
    let met = meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
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

#[tokio::test]
async fn the_answering_member_learns_where_the_dialing_one_listens() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (told, mut heard) = tokio::sync::mpsc::unbounded_channel();
    let met = move |met: Met| {
        let _ = told.send(met.reach);
    };
    tokio::spawn(serve(listener, pool_a, g.a.clone(), met, no_live()));

    let met = meet(
        &pool_b,
        &g.b,
        ("127.0.0.1", port),
        Some(4321),
        &[],
        no_live(),
    )
    .await
    .unwrap();
    assert_eq!(met.reach, Some(("127.0.0.1".to_owned(), port)));
    assert_eq!(
        heard.recv().await.unwrap(),
        Some(("127.0.0.1".to_owned(), 4321))
    );
}

#[tokio::test]
async fn a_member_that_does_not_answer_is_given_up_on_within_seconds() {
    let g = group().await;
    let pool = holding(&g).await;
    // TEST-NET-1 (RFC 5737) routes nowhere.
    let dialed = tokio::time::timeout(
        Duration::from_secs(5),
        meet(&pool, &g.b, ("192.0.2.1", 40_000), None, &[], no_live()),
    )
    .await;
    assert!(matches!(dialed, Ok(Err(_))));
}

#[tokio::test]
async fn a_device_listens_again_on_the_port_it_used_last() {
    let pool = empty_pool().await;
    let first = listen(&pool).await.unwrap().local_addr().unwrap().port();
    let again = listen(&pool).await.unwrap().local_addr().unwrap().port();
    assert_eq!(first, again);
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
    meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
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
    meet(
        loser,
        loser_device,
        ("127.0.0.1", port),
        None,
        &[],
        no_live(),
    )
    .await
    .unwrap();
    assert_eq!(head_of(loser).await, head_of(winner).await);
}

#[tokio::test]
async fn a_leaving_member_passes_its_leave_to_a_member_it_reaches() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let held_a = HeldStore::new(pool_a.clone());
    let session = Session::open(&pool_a, held_a.clone(), &g.a).await.unwrap();
    leave_group(&session, &g.a).await.unwrap();
    let port = listening(&pool_b, &g.b).await;
    // Its roster no longer lists it, so only the session it left from can still meet.
    assert!(matches!(
        meet(&pool_a, &g.a, ("127.0.0.1", port), None, &[], no_live()).await,
        Err(EngineError::Removed)
    ));

    meet_as(
        &session,
        held_a,
        &g.a,
        ("127.0.0.1", port),
        None,
        &[],
        no_live(),
    )
    .await
    .unwrap();
    for _ in 0..50 {
        if head_of(&pool_b).await.op == Op::Leave {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the member never pulled the leave");
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
    let met = meet(pool_n, n, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
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
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
    joined_and_synced(&g, &pool_a, &pool_n, &newcomer).await;
}

#[tokio::test]
async fn devices_paired_over_the_lan_learn_where_each_other_listens() {
    listen(&empty_pool().await).await.unwrap();
    let g = group().await;
    let pool_a = holding(&g).await;
    let session = Session::open(
        &pool_a,
        GroupStore::Held(HeldStore::new(pool_a.clone())),
        &g.a,
    )
    .await
    .unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let offer = new_offer(
        Some(StoreLocation::lan()),
        "Desktop A",
        Some(listen_on(loopback()).await.unwrap()),
    );
    let code = read_code(&offer.qr).unwrap();
    let shown = |_sas: String| async { true };
    let (added, member) = tokio::join!(
        add_device(&session, offer, &g.a, WelcomeStore::Lan, shown),
        async {
            let welcomed = join_on_lan(&code, &newcomer, named("New"), shown).await?;
            let member = welcomed.reach.clone();
            finish_lan_join(&empty_pool().await, &newcomer, welcomed).await?;
            Ok::<_, EngineError>(member)
        },
    );
    let reach = member.unwrap().expect("the member said where it listens");
    assert_eq!(
        (reach.did.as_str(), reach.address.0.as_str()),
        (hex::encode(g.a.did).as_str(), "127.0.0.1")
    );
    let reach = added
        .unwrap()
        .1
        .expect("the new device said where it listens");
    assert_eq!(
        (reach.did, reach.address.0.as_str()),
        (hex::encode(newcomer.did), "127.0.0.1")
    );
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
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
    joined_and_synced(&g, &pool_a, &pool_n, &newcomer).await;
}

#[tokio::test]
async fn a_live_message_crosses_a_lan_session_and_opens_on_the_other_side() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let keys = |pool: &SqlitePool, device| {
        let pool = pool.clone();
        async move {
            let session = Session::open(&pool, HeldStore::new(pool.clone()), device)
                .await
                .unwrap();
            LiveKeys::of(&session).unwrap()
        }
    };
    let (keys_a, keys_b) = (keys(&pool_a, &g.a).await, keys(&pool_b, &g.b).await);
    let arrived = Arc::new(Mutex::new(Vec::new()));
    let into = Arc::clone(&arrived);
    let port = listening_with(
        &pool_a,
        &g.a,
        Arc::new(move |envelope| into.lock().unwrap().push(envelope)),
    )
    .await;

    let now = LiveMessage::Now(Now {
        video: Some("aaaaaaaaaaa".into()),
        title: "Title".into(),
        by: "Channel".into(),
        music: false,
        link: None,
        pos: 1000,
        dur: 60_000,
        state: PlayState::Playing,
        vol: 80,
        queue: vec!["aaaaaaaaaaa".into()],
        index: 0,
    });
    let sealed = keys_b.seal(7, &now).unwrap();
    meet(
        &pool_b,
        &g.b,
        ("127.0.0.1", port),
        None,
        &[sealed],
        no_live(),
    )
    .await
    .unwrap();

    let envelope = arrived.lock().unwrap().pop().expect("the envelope arrived");
    let received = keys_a.open(&envelope).unwrap();
    assert_eq!(
        (received.from, received.seq, received.message),
        (hex::encode(g.b.did), 7, now)
    );
    assert!(
        keys_b.open(&envelope).is_err(),
        "a device doesn't take its own messages"
    );
}

#[tokio::test]
async fn a_lan_message_past_a_frame_s_limit_is_refused() {
    let listening = listen_on(loopback()).await.unwrap();
    let url = format!(
        "ws://127.0.0.1:{}/flow-sync/2/pair",
        listening.addresses[0].p
    );
    let token = [7; 16];
    tokio::spawn(async move {
        let (mut socket, _) = connect_async(url).await.unwrap();
        let first = [&[0; 32][..], &pairing_proof(&token, &[0; 32])[..]].concat();
        let _ = socket.send(Message::Binary(first.into())).await;
        for len in [4 << 20, 5 << 20] {
            let _ = socket.send(Message::Binary(vec![0; len].into())).await;
        }
        let _ = socket.next().await;
    });
    let (mut pipe, _) = listening.accept(&token).await.unwrap();
    assert_eq!(pipe.receive().await.unwrap().len(), 4 << 20);
    assert!(pipe.receive().await.is_err());
}

/// `device`, alone on the LAN, starts the next epoch in what it holds.
async fn rotate_alone(g: &Group, pool: &SqlitePool, device: &MemberSecrets) -> Entry {
    let held = HeldStore::new(pool.clone());
    let session = Session::open_as_peer(pool, held.clone(), device)
        .await
        .unwrap();
    let state = session.roster().clone();
    let keys = member_keys(&state, None).unwrap();
    let epoch = new_epoch(&g.group, state.epoch + 1, &keys, session.current_key()).unwrap();
    let mut rotate = draft(Op::Rotate, device);
    rotate.epoch = Some(epoch.field);
    let entry = build_entry(&g.group, Some(&state), rotate, &[device]);
    let appended = held
        .append_roster(&state.head, &entry, &epoch.wraps, Some(&epoch.chain))
        .await
        .unwrap();
    assert_eq!(appended, Appended::Done);
    entry
}

/// What `device` reads from the logs it holds, by sender.
async fn read_senders(pool: &SqlitePool, device: &MemberSecrets) -> BTreeSet<String> {
    let mut session = Session::open_as_peer(pool, HeldStore::new(pool.clone()), device)
        .await
        .unwrap();
    let pulled = session.pull(pool).await.unwrap();
    pulled.batches.into_keys().collect()
}

/// Waits until `pool` holds `entry`.
async fn eventually_holds_entry(pool: &SqlitePool, entry: &Entry) -> bool {
    let held = HeldStore::new(pool.clone());
    for _ in 0..50 {
        if held.candidates_after(-1).await.unwrap().contains(entry) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

#[tokio::test]
async fn members_that_each_rotated_meet_and_settle_on_one_chain() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let from_a = rotate_alone(&g, &pool_a, &g.a).await;
    let from_b = rotate_alone(&g, &pool_b, &g.b).await;

    let port = listening(&pool_a, &g.a).await;
    meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
    assert!(eventually_holds_entry(&pool_a, &from_b).await);
    assert!(eventually_holds_entry(&pool_b, &from_a).await);

    let a = Session::open_as_peer(&pool_a, HeldStore::new(pool_a.clone()), &g.a)
        .await
        .unwrap();
    let b = Session::open_as_peer(&pool_b, HeldStore::new(pool_b.clone()), &g.b)
        .await
        .unwrap();
    assert_eq!(a.roster().head, b.roster().head);
    assert_eq!(a.current_key(), b.current_key());
}

#[tokio::test]
async fn objects_sealed_under_a_rotation_that_lost_are_read_after_settling() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    rotate_alone(&g, &pool_a, &g.a).await;
    rotate_alone(&g, &pool_b, &g.b).await;
    watch(&pool_a, "aaaaaaaaaaa").await;
    watch(&pool_b, "bbbbbbbbbbb").await;
    push(&pool_a, &g.a).await;
    push(&pool_b, &g.b).await;

    let port = listening(&pool_a, &g.a).await;
    meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
    assert!(eventually_holds(&pool_a, &log_path(&hex::encode(g.b.did), 1)).await);

    let (a, b) = (hex::encode(g.a.did), hex::encode(g.b.did));
    assert_eq!(read_senders(&pool_a, &g.a).await, BTreeSet::from([b]));
    assert_eq!(read_senders(&pool_b, &g.b).await, BTreeSet::from([a]));
}

#[tokio::test]
async fn an_object_sealed_under_an_entry_that_fell_stops_only_its_sender() {
    let g = group().await;
    let c = member_secrets(random_bytes(), random_bytes());
    let state = head(&g.store);
    let mut add = draft(Op::Add, &g.a);
    add.add = Some(vec![member_subject(
        &c.sig_public,
        &c.kem_public,
        Role::Device,
    )]);
    let add = build_entry(&g.group, Some(&state), add, &[&g.a, &c]);
    let wrap = wrap_epoch_key(&c.kem_public, &g.group, 0, &c.did, &g.epoch_key).unwrap();
    let wraps = BTreeMap::from([(hex::encode(c.did), URL_SAFE_NO_PAD.encode(wrap))]);
    (&g.store)
        .append_roster(&state.head, &add, &wraps, None)
        .await
        .unwrap();
    let (pool_a, pool_b, pool_c) = (holding(&g).await, holding(&g).await, holding(&g).await);

    rotate_alone(&g, &pool_c, &c).await;
    watch(&pool_c, "ccccccccccc").await;
    push(&pool_c, &c).await;
    let port_c = listening(&pool_c, &c).await;
    meet(&pool_b, &g.b, ("127.0.0.1", port_c), None, &[], no_live())
        .await
        .unwrap();

    let session = Session::open_as_peer(&pool_a, HeldStore::new(pool_a.clone()), &g.a)
        .await
        .unwrap();
    let state = session.roster().clone();
    let keys = member_keys(&state, Some(&hex::encode(c.did))).unwrap();
    let epoch = new_epoch(&g.group, state.epoch + 1, &keys, session.current_key()).unwrap();
    let mut remove = draft(Op::Remove, &g.a);
    remove.remove = Some(vec![hex::encode(c.did)]);
    remove.epoch = Some(epoch.field);
    let remove = build_entry(&g.group, Some(&state), remove, &[&g.a]);
    HeldStore::new(pool_a.clone())
        .append_roster(&state.head, &remove, &epoch.wraps, Some(&epoch.chain))
        .await
        .unwrap();
    watch(&pool_a, "aaaaaaaaaaa").await;
    push(&pool_a, &g.a).await;
    let port_a = listening(&pool_a, &g.a).await;
    meet(&pool_b, &g.b, ("127.0.0.1", port_a), None, &[], no_live())
        .await
        .unwrap();

    assert_eq!(
        read_senders(&pool_b, &g.b).await,
        BTreeSet::from([hex::encode(g.a.did)])
    );
}

#[tokio::test]
async fn a_device_missing_its_wrap_stays_on_its_chain_and_fetches_it_over_the_lan() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let opened = Session::open_as_peer(&pool_b, HeldStore::new(pool_b.clone()), &g.b)
        .await
        .unwrap();
    let applied = opened.roster().head.clone();
    drop(opened);
    let rotated = rotate_alone(&g, &pool_a, &g.a).await;
    HeldStore::new(pool_b.clone())
        .hold_entry(&rotated)
        .await
        .unwrap();

    let refused = Session::open_as_peer(&pool_b, HeldStore::new(pool_b.clone()), &g.b).await;
    assert!(matches!(
        refused.err(),
        Some(EngineError::Protocol(Error::KeyCommitment))
    ));
    assert_eq!(
        entry_hash(roster_entries(&pool_b).await.unwrap().last().unwrap()),
        applied
    );

    let port = listening(&pool_a, &g.a).await;
    meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
    let session = Session::open_as_peer(&pool_b, HeldStore::new(pool_b.clone()), &g.b)
        .await
        .unwrap();
    assert_eq!(session.roster().head, entry_hash(&rotated));
}

#[tokio::test]
async fn a_dial_tries_lower_epochs_and_stops_after_four_attempts() {
    let g = group().await;
    let pool = holding(&g).await;
    for _ in 0..5 {
        rotate_alone(&g, &pool, &g.b).await;
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let attempts = tokio::spawn(async move {
        let mut epochs = Vec::new();
        while let Ok(Ok((stream, _))) =
            tokio::time::timeout(Duration::from_secs(2), listener.accept()).await
        {
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            if let Some(Ok(Message::Binary(frame))) = socket.next().await {
                epochs.push(u32::from_be_bytes(frame[..4].try_into().unwrap()));
            }
        }
        epochs
    });

    let met = meet(&pool, &g.b, ("127.0.0.1", port), None, &[], no_live()).await;
    assert!(matches!(met.err(), Some(EngineError::LanUnreachable)));
    assert_eq!(attempts.await.unwrap(), [5, 4, 3, 2]);
}

/// Whether the other side has closed `stream`, once what it sent is read.
async fn closed_within(stream: &mut TcpStream, limit: Duration) -> bool {
    let mut bytes = [0; 1024];
    tokio::time::timeout(limit, async {
        while !matches!(stream.read(&mut bytes).await, Ok(0) | Err(_)) {}
    })
    .await
    .is_ok()
}

#[tokio::test]
async fn connections_that_say_nothing_are_closed_and_members_still_meet() {
    let g = group().await;
    let (pool_a, pool_b) = (holding(&g).await, holding(&g).await);
    let port = listening(&pool_a, &g.a).await;
    let mut silent = Vec::new();
    for _ in 0..64 {
        silent.push(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
    }
    let last = silent.last_mut().unwrap();
    assert!(
        closed_within(last, Duration::from_secs(1)).await,
        "over the limit, a connection is closed at once"
    );
    for stream in &mut silent {
        assert!(closed_within(stream, Duration::from_secs(5)).await);
    }
    meet(&pool_b, &g.b, ("127.0.0.1", port), None, &[], no_live())
        .await
        .unwrap();
}

#[tokio::test]
async fn a_websocket_that_says_nothing_is_closed() {
    let g = group().await;
    let pool = holding(&g).await;
    let port = listening(&pool, &g.a).await;
    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{port}/flow-sync/2"))
        .await
        .unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(_)) = socket.next().await {}
    })
    .await;
    assert!(ended.is_ok());
}

#[tokio::test]
async fn meeting_a_peer_that_stays_silent_after_connecting_ends() {
    let g = group().await;
    let pool = holding(&g).await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let _socket = accept_async(stream).await.unwrap();
        std::future::pending::<()>().await;
    });
    let met = tokio::time::timeout(
        Duration::from_secs(5),
        meet(&pool, &g.b, ("127.0.0.1", port), None, &[], no_live()),
    )
    .await;
    assert!(matches!(met, Ok(Err(EngineError::TimedOut))));
}

/// Run under a low descriptor limit, as a macOS GUI app has by default:
/// `bash -c 'ulimit -n 256; cargo test --test sync2_lan -- --ignored --exact <this test>'`.
#[tokio::test]
#[ignore = "needs ulimit -n 256"]
async fn the_service_keeps_accepting_after_running_out_of_descriptors() {
    let g = group().await;
    let pool = holding(&g).await;
    let port = listening(&pool, &g.a).await;
    let mut files = Vec::new();
    while let Ok(file) = std::fs::File::open("/dev/null") {
        files.push(file);
    }
    files.truncate(files.len() - 3);
    let mut streams = Vec::new();
    for _ in 0..3 {
        if let Ok(stream) = TcpStream::connect(("127.0.0.1", port)).await {
            streams.push(stream);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    drop(streams);
    drop(files);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let mut again = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    assert!(closed_within(&mut again, Duration::from_secs(5)).await);
}
