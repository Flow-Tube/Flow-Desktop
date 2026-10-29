//! FLOW-SYNC/2 pairing: one device shows a code, the other answers it through the mailbox or over
//! the LAN, both confirm the same six digits, and the new device ends up in the roster able to sync.

mod sync2_common;

use std::sync::Mutex;

use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{Code, StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::{
    DeviceMeta, add_device, add_scanned, answer_shown, finish_join, join,
};
use flow_desktop_lib::sync2::pipe::listen_on;
use flow_desktop_lib::sync2::sealed::random_bytes;
use sync2_common::{device_pool, empty_pool, exported, group, head, memory_welcome};

fn meta() -> DeviceMeta {
    DeviceMeta {
        app: "app-new".into(),
        name: "New desktop".into(),
        platform: "linux".into(),
    }
}

#[tokio::test]
async fn a_new_device_pairs_and_then_syncs() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES ('aaaaaaaaaaa', 'title', NULL, NULL, '2025-01-01T00:00:00+00:00', 10, 600, 0, 0, '100:0:dA')",
    )
    .execute(&pool_a)
    .await
    .unwrap();
    let mut session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    session
        .push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(Some(StoreLocation::server("memory")), "Desktop A", None);
    let code = read_code(&offer.qr).unwrap();
    let codes = Mutex::new(Vec::new());
    let shown = |sas: String| {
        codes.lock().unwrap().push(sas);
        async { true }
    };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), &shown),
        join(&pool_n, &store, &code, &newcomer, meta(), &shown),
    );
    let did = added.unwrap();
    joined.unwrap();
    let codes = codes.into_inner().unwrap();
    assert_eq!(codes.len(), 2);
    assert_eq!(codes[0], codes[1]);
    assert_eq!(did, hex::encode(newcomer.did));
    assert!(head(&g.store).members.contains_key(&did));

    let mut joined_session = Session::open(&pool_n, &g.store, &newcomer).await.unwrap();
    let pulled = joined_session.pull(&pool_n).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&pool_n, "app-new", sender, batches, now_ms())
            .await
            .unwrap();
    }
    joined_session.finish(&pool_n, pulled).await.unwrap();
    let ids: Vec<String> = sqlx::query_scalar("SELECT video_id FROM watch_history")
        .fetch_all(&pool_n)
        .await
        .unwrap();
    assert_eq!(ids, ["aaaaaaaaaaa"]);
}

#[tokio::test]
async fn declining_the_code_adds_nobody() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let roster_before = head(&g.store).seq;
    let offer = new_offer(Some(StoreLocation::server("memory")), "Desktop A", None);
    let code = read_code(&offer.qr).unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let declined = |_sas: String| async { false };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), declined),
        join(&pool_n, &store, &code, &newcomer, meta(), declined),
    );
    assert!(matches!(added, Err(EngineError::Declined)));
    assert!(matches!(joined, Err(EngineError::Declined)));
    assert_eq!(head(&g.store).seq, roster_before);
}

#[test]
fn codes_this_build_cannot_answer_are_refused() {
    let member = new_offer(Some(StoreLocation::server("memory")), "Desktop A", None).qr;
    let without_store = member.replace(r#","s":{"k":"server","u":"memory"}"#, "");
    let new_without_lan = member.replace(r#""r":"m""#, r#""r":"n""#);
    let flow_sync_1 = r#"{"v":1,"sid":"AAAAAAAAAAAAAAAAAAAAAA","k":"AAAA","ip":"192.168.1.2","p":1,"d":"x","exp":0}"#;
    for text in [&without_store, &new_without_lan, flow_sync_1, "not json"] {
        assert!(
            matches!(read_code(text), Err(EngineError::Unexpected)),
            "{text}"
        );
    }
    assert!(matches!(read_code(&member), Ok(Code::Member { .. })));
}

/// Asserts that both sides were shown the same six digits.
fn assert_same_digits(codes: Mutex<Vec<String>>) {
    let codes = codes.into_inner().unwrap();
    assert_eq!(codes.len(), 2);
    assert_eq!(codes[0], codes[1]);
}

fn loopback() -> Vec<String> {
    vec!["127.0.0.1".into()]
}

#[tokio::test]
async fn a_member_scans_a_new_device_code_over_the_lan() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(
        None,
        "New desktop",
        Some(listen_on(loopback()).await.unwrap()),
    );
    let code = read_code(&offer.qr).unwrap();
    assert!(matches!(code, Code::New { .. }));

    let codes = Mutex::new(Vec::new());
    let shown = |sas: String| {
        codes.lock().unwrap().push(sas);
        async { true }
    };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_scanned(&session, &code, &g.a, memory_welcome(), &shown),
        async {
            let welcomed = answer_shown(offer, &newcomer, meta(), &shown).await?;
            finish_join(&pool_n, &store, welcomed).await
        }
    );
    joined.unwrap();
    assert_same_digits(codes);
    let did = added.unwrap();
    assert_eq!(did, hex::encode(newcomer.did));
    assert!(head(&g.store).members.contains_key(&did));
    assert!(Session::open(&pool_n, &g.store, &newcomer).await.is_ok());
}

#[tokio::test]
async fn a_new_device_reaches_a_member_over_the_lan_first() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(
        Some(StoreLocation::server("memory")),
        "Desktop A",
        Some(listen_on(loopback()).await.unwrap()),
    );
    let code = read_code(&offer.qr).unwrap();

    let codes = Mutex::new(Vec::new());
    let shown = |sas: String| {
        codes.lock().unwrap().push(sas);
        async { true }
    };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), &shown),
        join(&pool_n, &store, &code, &newcomer, meta(), &shown),
    );
    joined.unwrap();
    assert_same_digits(codes);
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
}

#[tokio::test]
async fn a_new_device_falls_back_to_the_mailbox_when_the_lan_does_not_answer() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(Some(StoreLocation::server("memory")), "Desktop A", None);
    let unanswered = offer
        .qr
        .replacen('{', r#"{"l":[{"a":"127.0.0.1","p":9}],"#, 1);
    let code = read_code(&unanswered).unwrap();

    let codes = Mutex::new(Vec::new());
    let shown = |sas: String| {
        codes.lock().unwrap().push(sas);
        async { true }
    };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), &shown),
        join(&pool_n, &store, &code, &newcomer, meta(), &shown),
    );
    joined.unwrap();
    assert_same_digits(codes);
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
}
