//! A recovery key doesn't outlast the device that set it (spec/protocol.md, Validation rule 8), and
//! devices tell the user when it changes (spec/protocol.md, Recovery).

mod sync2_common;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::membership::{leave_group, remove_devices};
use flow_desktop_lib::sync2::recovery::recovery_secret;
use flow_desktop_lib::sync2::recovery_flow::{replace_recovery_key, restore};
use flow_desktop_lib::sync2::recovery_notice::{forget_recovery_notice, recovery_notice};
use flow_desktop_lib::sync2::roster::{Role, devices_added_by, recovery_member};
use flow_desktop_lib::sync2::sealed::random_bytes;
use sqlx::SqlitePool;
use sync2_common::{Group, MemoryStore, device_pool, exported, group, head, watch};

async fn b_sets_the_key(g: &Group, pool_b: &SqlitePool) {
    let session = Session::open(pool_b, &g.store, &g.b).await.unwrap();
    replace_recovery_key(&session, &g.b).await.unwrap();
}

fn object_count(store: &MemoryStore) -> usize {
    store.0.lock().unwrap().objects.len()
}

#[tokio::test]
async fn removing_the_device_that_set_the_key_replaces_it_in_the_same_entry() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    b_sets_the_key(&g, &pool_b).await;
    let planted = recovery_member(&head(&g.store).members).unwrap().0.clone();

    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let words = remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap()
        .expect("new words");

    let state = head(&g.store);
    let (current, member) = recovery_member(&state.members).unwrap();
    assert_ne!(*current, planted);
    assert_eq!(
        member.installer.as_deref(),
        Some(hex::encode(g.a.did).as_str())
    );
    assert!(!state.recovery_due);
    assert!(recovery_secret(&words).is_some());
    let last = g.store.0.lock().unwrap().roster.last().unwrap().clone();
    assert!(!last.epoch.unwrap().to.contains(&planted));
}

#[tokio::test]
async fn removing_a_device_that_did_not_set_the_key_leaves_it() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let before = recovery_member(&head(&g.store).members).unwrap().0.clone();
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();

    let words = remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();

    assert!(words.is_none());
    assert_eq!(*recovery_member(&head(&g.store).members).unwrap().0, before);
}

#[tokio::test]
async fn nothing_is_written_after_the_device_that_set_the_key_left() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    b_sets_the_key(&g, &pool_b).await;
    let b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    leave_group(&b, &g.b).await.unwrap();
    watch(&pool_a, "aaaaaaaaaaa").await;
    let (objects, epoch) = (object_count(&g.store), head(&g.store).epoch);

    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    assert!(a.roster().recovery_due);
    assert_eq!(a.roster().epoch, epoch, "no rotate wraps to that key");
    assert_eq!(
        a.push(&pool_a, exported(&pool_a, "a").await).await.unwrap(),
        0
    );
    a.write_profiles_snapshot(&pool_a).await.unwrap();
    assert_eq!(object_count(&g.store), objects);

    replace_recovery_key(&a, &g.a).await.unwrap();
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    assert!(!a.roster().recovery_due);
    assert!(!a.roster().rotate);
    assert_eq!(a.roster().epoch, epoch + 1);
    assert!(a.push(&pool_a, exported(&pool_a, "a").await).await.unwrap() > 0);
}

#[tokio::test]
async fn a_login_can_t_be_written_while_the_key_is_due() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    b_sets_the_key(&g, &pool_b).await;
    let b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    leave_group(&b, &g.b).await.unwrap();
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let login = flow_desktop_lib::sync2::webdav::WebDavLogin {
        user: "u".into(),
        password: "p".into(),
    };
    assert!(matches!(
        a.write_login(&pool_a, &login).await,
        Err(EngineError::RecoveryDue)
    ));
}

#[tokio::test]
async fn another_device_changing_the_key_is_noticed_until_answered() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    b_sets_the_key(&g, &pool_b).await;

    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let notice = recovery_notice(&pool_a).await.unwrap().unwrap();
    assert_eq!(notice.device, hex::encode(g.b.did));

    forget_recovery_notice(&pool_a).await.unwrap();
    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    assert!(recovery_notice(&pool_a).await.unwrap().is_none());
}

#[tokio::test]
async fn this_device_changing_the_key_shows_no_notice() {
    let g = group().await;
    let pool_b = device_pool(&g).await;
    Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    b_sets_the_key(&g, &pool_b).await;
    Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    assert!(recovery_notice(&pool_b).await.unwrap().is_none());
}

#[tokio::test]
async fn a_restore_is_noticed_with_the_device_it_added() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let restored = member_secrets(random_bytes(), random_bytes());
    let meta = DeviceMeta {
        app: "app".into(),
        name: "Restored".into(),
        platform: "linux".into(),
    };
    restore(&&g.store, &&g.store, &g.recovery, &restored, &meta)
        .await
        .unwrap();

    Session::open(&pool_a, &g.store, &g.a).await.unwrap();

    let notice = recovery_notice(&pool_a).await.unwrap().unwrap();
    assert_eq!(notice.device, hex::encode(restored.did));
}

#[tokio::test]
async fn what_a_device_added_is_followed_through_the_devices_it_added() {
    let g = group().await;
    let entries = g.store.0.lock().unwrap().roster.clone();
    let a = hex::encode(g.a.did);
    let b = hex::encode(g.b.did);
    assert_eq!(devices_added_by(&entries, &a), vec![b.clone()]);
    assert!(devices_added_by(&entries, &b).is_empty());
    let state = head(&g.store);
    assert_eq!(state.members[&a].role, Role::Device);
}
