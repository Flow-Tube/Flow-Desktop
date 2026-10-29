//! FLOW-SYNC/2 pairing through the mailbox: a member shows a code, a new device answers it, both
//! confirm the same six digits, and the new device ends up in the roster able to sync.

mod sync2_common;

use std::sync::Mutex;

use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::{DeviceMeta, add_device, join, new_offer};
use flow_desktop_lib::sync2::sealed::random_bytes;
use sync2_common::{device_pool, empty_pool, group, head};

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
    session.push(&pool_a, "app-a").await.unwrap();

    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer("memory", "Desktop A");
    let qr = offer.qr.clone();
    let codes = Mutex::new(Vec::new());
    let shown = |sas: String| {
        codes.lock().unwrap().push(sas);
        async { true }
    };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, &shown),
        join(&pool_n, &store, &qr, &newcomer, meta(), &shown),
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
    let offer = new_offer("memory", "Desktop A");
    let qr = offer.qr.clone();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let declined = |_sas: String| async { false };
    let store = &g.store;
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, declined),
        join(&pool_n, &store, &qr, &newcomer, meta(), declined),
    );
    assert!(matches!(added, Err(EngineError::Declined)));
    assert!(matches!(joined, Err(EngineError::Declined)));
    assert_eq!(head(&g.store).seq, roster_before);
}

#[tokio::test]
async fn codes_that_are_not_a_member_offer_are_refused() {
    let g = group().await;
    let pool_n = empty_pool().await;
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let offer = new_offer("memory", "Desktop A");
    let from_new_device = offer.qr.replace("\"r\":\"m\"", "\"r\":\"n\"");
    let flow_sync_1 = r#"{"v":1,"sid":"AAAAAAAAAAAAAAAAAAAAAA","k":"AAAA","ip":"192.168.1.2","p":1,"d":"x","exp":0}"#;
    for qr in [from_new_device.as_str(), flow_sync_1, "not json"] {
        let result = join(&pool_n, &&g.store, qr, &newcomer, meta(), |_| async {
            true
        })
        .await;
        assert!(matches!(result, Err(EngineError::Unexpected)), "{qr}");
    }
}
