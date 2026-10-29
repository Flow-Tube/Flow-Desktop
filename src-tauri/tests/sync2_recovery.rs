//! Restoring with the recovery key: a new device joins without any other device, the used key is
//! replaced at once, and it can never be used again.

mod sync2_common;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::recovery::{recovery_keys, recovery_secret};
use flow_desktop_lib::sync2::recovery_flow::restore;
use flow_desktop_lib::sync2::roster::Role;
use flow_desktop_lib::sync2::sealed::random_bytes;
use sync2_common::{device_pool, group, head};

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
