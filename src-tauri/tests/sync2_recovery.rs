//! Restoring with the recovery key: a new device joins without any other device, the used key is
//! replaced at once, and it can never be used again.

mod sync2_common;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::recovery::{recovery_keys, recovery_secret};
use flow_desktop_lib::sync2::recovery_flow::restore;
use flow_desktop_lib::sync2::roster::Role;
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, load_group, save_group};
use sqlx::SqlitePool;
use sync2_common::{Group, LINK, device_pool, empty_pool, exported, group, head};

fn meta() -> DeviceMeta {
    DeviceMeta {
        app: "app-restored".into(),
        name: "Restored".into(),
        platform: "linux".into(),
    }
}

#[tokio::test]
async fn a_restored_device_joins_and_the_recovery_key_is_replaced() {
    let g = group().await;
    let restored = member_secrets(random_bytes(), random_bytes());
    let result = restore(&&g.store, &&g.store, &g.recovery, &restored, &meta())
        .await
        .unwrap();

    let state = head(&g.store);
    assert_eq!(state.epoch, 2);
    let next = recovery_keys(&recovery_secret(&result.words).unwrap());
    assert_eq!(state.members[&hex::encode(next.did)].role, Role::Recovery);
    assert!(!state.members.contains_key(&hex::encode(g.recovery.did)));
    for device in [&restored, &g.a, &g.b] {
        let pool = device_pool(&g).await;
        assert_eq!(
            Session::open(&pool, &g.store, device)
                .await
                .unwrap()
                .roster()
                .epoch,
            2
        );
    }
}

#[tokio::test]
async fn a_replaced_recovery_key_cannot_restore_again() {
    let g = group().await;
    restore(
        &&g.store,
        &&g.store,
        &g.recovery,
        &member_secrets(random_bytes(), random_bytes()),
        &meta(),
    )
    .await
    .unwrap();
    let again = restore(
        &&g.store,
        &&g.store,
        &g.recovery,
        &member_secrets(random_bytes(), random_bytes()),
        &meta(),
    )
    .await;
    assert!(matches!(again, Err(EngineError::RecoveryUsed)));
}

/// A device restored onto an empty database, as `restore_group` leaves it: no link chosen yet.
async fn restored_device(g: &Group) -> (MemberSecrets, SqlitePool) {
    let device = member_secrets(random_bytes(), random_bytes());
    let restored = restore(&&g.store, &&g.store, &g.recovery, &device, &meta())
        .await
        .unwrap();
    let pool = empty_pool().await;
    add_roster_entries(&pool, &restored.entries).await.unwrap();
    let record = GroupRecord::new(hex::encode(g.group), "memory".into(), None, String::new());
    save_group(&pool, &record).await.unwrap();
    (device, pool)
}

#[tokio::test]
async fn a_restored_device_joins_the_link_other_devices_sync() {
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
    let mut session_a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    session_a
        .push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let (device, pool) = restored_device(&g).await;
    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();
    assert!(session.adopt_link(&pool, "own-profile").await.unwrap());
    assert_eq!(load_group(&pool).await.unwrap().unwrap().link, LINK);
    let pulled = session.pull(&pool).await.unwrap();
    assert!(pulled.batches.contains_key(&hex::encode(g.a.did)));
}

#[tokio::test]
async fn a_restored_device_starts_its_own_link_when_nothing_was_synced() {
    let g = group().await;
    let (device, pool) = restored_device(&g).await;
    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();
    assert!(session.adopt_link(&pool, "own-profile").await.unwrap());
    assert_eq!(
        load_group(&pool).await.unwrap().unwrap().link,
        "own-profile"
    );
}

#[tokio::test]
async fn a_restored_device_finds_the_link_in_a_snapshot() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let mut session_a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    session_a
        .write_snapshot(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let (device, pool) = restored_device(&g).await;
    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();
    assert!(session.adopt_link(&pool, "own-profile").await.unwrap());
    assert_eq!(load_group(&pool).await.unwrap().unwrap().link, LINK);
}
