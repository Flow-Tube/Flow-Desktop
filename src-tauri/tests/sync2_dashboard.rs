//! What the Sync page's dashboard reads: the recent error log, and each synced profile's kept
//! batches and own snapshot.

mod sync2_common;

use flow_desktop_lib::sync2::engine::Session;
use flow_desktop_lib::sync2::error_log::{clear, note, recent};
use flow_desktop_lib::sync2::kept::kept_count;
use flow_desktop_lib::sync2::snapshot::own_snapshot_ms;
use sync2_common::{LINK, device_pool, empty_pool, exported, group};

#[tokio::test]
async fn the_error_log_keeps_only_the_newest_kinds_and_times() {
    let pool = empty_pool().await;
    for at in 0..25 {
        note(&pool, "linkedUnreachable", at).await.unwrap();
    }
    note(&pool, "linkedRefused", 99).await.unwrap();
    let errors = recent(&pool).await.unwrap();
    assert_eq!(errors.len(), 20);
    assert_eq!(
        (errors[0].kind.as_str(), errors[0].at_ms),
        ("linkedRefused", 99)
    );
    assert_eq!(errors[19].at_ms, 6);
    clear(&pool).await.unwrap();
    assert!(recent(&pool).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_profile_shows_its_own_snapshot_once_this_device_wrote_one() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let me = hex::encode(g.a.did);
    assert_eq!(own_snapshot_ms(&pool, &me, LINK).await.unwrap(), None);
    assert_eq!(kept_count(&pool, LINK).await.unwrap(), 0);

    let mut session = Session::open(&pool, &g.store, &g.a).await.unwrap();
    session
        .write_snapshot(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
    assert!(own_snapshot_ms(&pool, &me, LINK).await.unwrap().is_some());
}
