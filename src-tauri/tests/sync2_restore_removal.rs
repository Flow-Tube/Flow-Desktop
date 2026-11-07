//! A restore asks which devices the user still has, and signs out the rest before this device
//! seals anything under the keys it started (spec/protocol.md, Recovery).

mod sync2_common;

use std::collections::BTreeSet;

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::envelope::{ObjectType, open_object, parse_object};
use flow_desktop_lib::sync2::epoch::{open_chain, purpose_key};
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::live_seal::LiveKeys;
use flow_desktop_lib::sync2::membership::{remove_devices, rename_device};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::profile_names::set;
use flow_desktop_lib::sync2::recovery::{recovery_keys, recovery_secret};
use flow_desktop_lib::sync2::recovery_flow::{preview_restore, replace_recovery_key, restore};
use flow_desktop_lib::sync2::recovery_notice::recovery_notice;
use flow_desktop_lib::sync2::restore_removal::take_replaced_words;
use flow_desktop_lib::sync2::roster::{Op, Role, replay_roster};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::state::{GroupRecord, add_roster_entries, load_group, save_group};
use flow_desktop_lib::sync2::webdav::WebDavLogin;
use flow_desktop_lib::sync2::wrap::unwrap_epoch_key;
use sqlx::SqlitePool;
use sync2_common::{
    Group, LINK, MemoryStore, device_pool, empty_pool, exported, group, head, watch,
};

const FROM_A: &str = "aaaaaaaaaaa";

fn meta(name: &str) -> DeviceMeta {
    DeviceMeta {
        app: format!("app-{name}"),
        name: name.into(),
        platform: "linux".into(),
    }
}

/// A device just restored with only `kept` chosen, under `link`, as the setup code leaves it.
async fn restored_keeping(g: &Group, kept: &[String], link: &str) -> (MemberSecrets, SqlitePool) {
    let device = member_secrets(random_bytes(), random_bytes());
    let restored = restore(&&g.store, &&g.store, &g.recovery, &device, &meta("New"))
        .await
        .unwrap();
    let pool = empty_pool().await;
    add_roster_entries(&pool, &restored.entries).await.unwrap();
    let record = GroupRecord::new(hex::encode(g.group), "memory".into(), None, link.to_owned())
        .restored_keeping(kept);
    save_group(&pool, &record).await.unwrap();
    (device, pool)
}

/// A has written something for others to read.
async fn a_wrote(g: &Group) {
    let pool = device_pool(g).await;
    watch(&pool, FROM_A).await;
    Session::open(&pool, &g.store, &g.a)
        .await
        .unwrap()
        .push(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
}

fn objects_of(store: &MemoryStore, device: &MemberSecrets) -> Vec<String> {
    let did = hex::encode(device.did);
    store
        .0
        .lock()
        .unwrap()
        .objects
        .keys()
        .filter(|path| path.contains(&did))
        .cloned()
        .collect()
}

/// How much the store holds of each kind.
fn stored(store: &MemoryStore) -> (usize, usize, usize) {
    let memory = store.0.lock().unwrap();
    (memory.roster.len(), memory.keys.len(), memory.objects.len())
}

fn devices(store: &MemoryStore) -> BTreeSet<String> {
    head(store)
        .members
        .into_iter()
        .filter(|(_, member)| member.role == Role::Device)
        .map(|(did, _)| did)
        .collect()
}

#[tokio::test]
async fn previewing_lists_the_devices_and_writes_nothing() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&a, &g.a, &hex::encode(g.a.did), &meta("Old phone"))
        .await
        .unwrap();
    let before = stored(&g.store);

    let found = preview_restore(&&g.store, &g.recovery).await.unwrap();

    assert_eq!(before, stored(&g.store));
    assert_eq!(found.len(), 2);
    let named = found
        .iter()
        .find(|d| d.did == hex::encode(g.a.did))
        .unwrap();
    assert_eq!(named.name.as_deref(), Some("Old phone"));
    let unnamed = found
        .iter()
        .find(|d| d.did == hex::encode(g.b.did))
        .unwrap();
    assert_eq!(unnamed.name, None);
}

#[tokio::test]
async fn a_preview_reads_a_name_sealed_under_an_older_key_and_survives_a_missing_chain() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    rename_device(&a, &g.a, &hex::encode(g.a.did), &meta("Old phone"))
        .await
        .unwrap();
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(g.b.did)])
        .await
        .unwrap();
    assert_eq!(head(&g.store).epoch, 1);

    let found = preview_restore(&&g.store, &g.recovery).await.unwrap();
    assert_eq!(found[0].name.as_deref(), Some("Old phone"));

    g.store
        .0
        .lock()
        .unwrap()
        .keys
        .retain(|(_, _, name), _| name != "chain");
    let found = preview_restore(&&g.store, &g.recovery).await.unwrap();
    assert_eq!(found[0].did, hex::encode(g.a.did));
    assert_eq!(found[0].name, None);
}

#[tokio::test]
async fn a_restore_signs_out_every_device_not_kept_and_still_reads_what_they_wrote() {
    let g = group().await;
    a_wrote(&g).await;
    let (device, pool) = restored_keeping(&g, &[], "").await;

    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(devices(&g.store), BTreeSet::from([hex::encode(device.did)]));
    let entries = g.store.0.lock().unwrap().roster.clone();
    let removal = entries.last().unwrap();
    assert_eq!(removal.op, Op::Remove);
    assert!(
        removal
            .cut
            .as_ref()
            .unwrap()
            .contains_key(&hex::encode(g.a.did))
    );
    assert_eq!(head(&g.store).epoch, 3);
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);

    assert!(session.adopt_link(&pool, "own").await.unwrap());
    assert_eq!(session.record().link, LINK);
    let pulled = session.pull(&pool).await.unwrap();
    assert!(pulled.batches.contains_key(&hex::encode(g.a.did)));
    watch(&pool, "bbbbbbbbbbb").await;
    assert!(
        session
            .push(&pool, exported(&pool, "app-new").await)
            .await
            .unwrap()
            > 0
    );
}

#[tokio::test]
async fn a_device_the_user_kept_stays_and_is_told_about_the_restore() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let (device, pool) = restored_keeping(&g, &[hex::encode(g.a.did)], LINK).await;

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(
        devices(&g.store),
        BTreeSet::from([hex::encode(g.a.did), hex::encode(device.did)])
    );
    assert_eq!(head(&g.store).epoch, 3);
    Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let notice = recovery_notice(&pool_a).await.unwrap().unwrap();
    assert_eq!(notice.device, hex::encode(device.did));
}

#[tokio::test]
async fn keeping_every_device_appends_no_removal() {
    let g = group().await;
    let kept = [hex::encode(g.a.did), hex::encode(g.b.did)];
    let (device, pool) = restored_keeping(&g, &kept, LINK).await;
    let epoch = head(&g.store).epoch;

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(head(&g.store).epoch, epoch);
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

#[tokio::test]
async fn a_device_that_appears_after_the_question_is_removed_too() {
    let g = group().await;
    let asked = preview_restore(&&g.store, &g.recovery).await.unwrap();
    let kept: Vec<String> = asked.into_iter().map(|d| d.did).collect();
    let (device, pool) = restored_keeping(&g, &kept, LINK).await;
    let late = member_secrets(random_bytes(), random_bytes());
    sync2_common::add_device(&g, &late).await;

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert!(!devices(&g.store).contains(&hex::encode(late.did)));
    assert!(devices(&g.store).contains(&hex::encode(g.a.did)));
}

#[tokio::test]
async fn a_log_that_stalls_ends_at_the_position_reached() {
    let g = group().await;
    a_wrote(&g).await;
    g.store.tamper(&log_path(&hex::encode(g.a.did), 1));
    let (device, pool) = restored_keeping(&g, &[], "").await;

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(devices(&g.store), BTreeSet::from([hex::encode(device.did)]));
    let entries = g.store.0.lock().unwrap().roster.clone();
    assert_eq!(
        entries.last().unwrap().cut,
        None,
        "nothing of A's log was read"
    );
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

#[tokio::test]
async fn a_stop_before_the_removal_resumes_on_the_next_open() {
    let g = group().await;
    a_wrote(&g).await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    let epoch = head(&g.store).epoch;
    g.store.0.lock().unwrap().refuse_appends = true;

    assert!(Session::open(&pool, &g.store, &device).await.is_err());
    assert_eq!(head(&g.store).epoch, epoch);
    assert!(objects_of(&g.store, &device).is_empty());
    assert!(
        load_group(&pool)
            .await
            .unwrap()
            .unwrap()
            .restore_kept
            .is_some()
    );

    g.store.0.lock().unwrap().refuse_appends = false;
    Session::open(&pool, &g.store, &device).await.unwrap();
    assert_eq!(devices(&g.store), BTreeSet::from([hex::encode(device.did)]));
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

#[tokio::test]
async fn a_stop_after_the_removal_was_appended_does_not_remove_again() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    Session::open(&pool, &g.store, &device).await.unwrap();
    let length = g.store.0.lock().unwrap().roster.len();
    let record = load_group(&pool)
        .await
        .unwrap()
        .unwrap()
        .restored_keeping(&[]);
    save_group(&pool, &record).await.unwrap();

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(g.store.0.lock().unwrap().roster.len(), length);
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

#[tokio::test]
async fn words_another_device_set_meanwhile_are_replaced_with_its_removal() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    replace_recovery_key(&a, &g.a).await.unwrap();

    Session::open(&pool, &g.store, &device).await.unwrap();

    let state = head(&g.store);
    assert!(!state.recovery_due);
    assert!(!state.members.contains_key(&hex::encode(g.a.did)));
    let words = take_replaced_words().expect("the new words reach the page");
    assert!(take_replaced_words().is_none(), "shown once");
    let next = recovery_keys(&recovery_secret(&words).unwrap());
    assert_eq!(state.members[&hex::encode(next.did)].role, Role::Recovery);
    let saved: String =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'sync2_recovery_saved'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        saved, "0",
        "Linked devices warns if the words never reach the page"
    );
}

/// A session of a device that hasn't finished its restore, which [`Session::open`] never gives:
/// the seal paths have to refuse it on their own.
async fn unfinished<'a>(
    g: &'a Group,
    device: &'a MemberSecrets,
    pool: &SqlitePool,
) -> Session<'a, &'a MemoryStore> {
    let mut session = Session::on_applied(pool, &g.store, device).await.unwrap();
    session.prepare_names().await.unwrap();
    session
}

#[tokio::test]
async fn while_unfinished_no_batch_is_sealed() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    watch(&pool, FROM_A).await;
    let mut session = unfinished(&g, &device, &pool).await;
    let pushed = session.push(&pool, exported(&pool, "app-new").await).await;
    assert!(matches!(pushed, Err(EngineError::RestorePending)));
    assert!(objects_of(&g.store, &device).is_empty());
}

#[tokio::test]
async fn while_unfinished_no_profile_record_is_sealed() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    set(&pool, "app-new", LINK, "Home", false).await.unwrap();
    let mut session = unfinished(&g, &device, &pool).await;
    assert!(matches!(
        session.push_profiles(&pool).await,
        Err(EngineError::RestorePending)
    ));
    assert!(objects_of(&g.store, &device).is_empty());
}

#[tokio::test]
async fn while_unfinished_no_ack_is_sealed() {
    let g = group().await;
    a_wrote(&g).await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    let mut session = unfinished(&g, &device, &pool).await;
    let pulled = session.pull(&pool).await.unwrap();
    assert!(matches!(
        session.finish(&pool, pulled).await,
        Err(EngineError::RestorePending)
    ));
    assert!(objects_of(&g.store, &device).is_empty());
}

#[tokio::test]
async fn while_unfinished_no_snapshot_is_sealed() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    watch(&pool, FROM_A).await;
    let mut session = unfinished(&g, &device, &pool).await;
    let written = session
        .write_snapshot(&pool, exported(&pool, "app-new").await)
        .await;
    assert!(matches!(written, Err(EngineError::RestorePending)));
    assert!(matches!(
        session.write_profiles_snapshot(&pool).await,
        Err(EngineError::RestorePending)
    ));
    assert!(objects_of(&g.store, &device).is_empty(), "no blob either");
}

#[tokio::test]
async fn while_unfinished_no_login_is_sealed() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    let mut session = unfinished(&g, &device, &pool).await;
    let login = WebDavLogin {
        user: "u".into(),
        password: "p".into(),
    };
    assert!(matches!(
        session.write_login(&pool, &login).await,
        Err(EngineError::RestorePending)
    ));
    assert!(objects_of(&g.store, &device).is_empty());
}

#[tokio::test]
async fn while_unfinished_no_live_message_is_sealed() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    let session = unfinished(&g, &device, &pool).await;
    assert!(matches!(
        LiveKeys::of(&session),
        Err(EngineError::RestorePending)
    ));
}

#[tokio::test]
async fn while_unfinished_lan_sessions_stay_up() {
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    assert!(
        Session::open_for_lan(&pool, &g.store, &device)
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn a_device_on_an_older_roster_can_open_only_keys_that_seal_nothing() {
    // B stands for a device removed on a roster this store doesn't show: it holds its real keys.
    let g = group().await;
    let (device, pool) = restored_keeping(&g, &[], LINK).await;
    assert!(objects_of(&g.store, &device).is_empty());
    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();
    watch(&pool, FROM_A).await;
    assert!(
        session
            .push(&pool, exported(&pool, "app-new").await)
            .await
            .unwrap()
            > 0
    );

    let entries = g.store.0.lock().unwrap().roster.clone();
    let state = replay_roster(&entries).unwrap();
    let last = state.epoch;
    assert_eq!(last, 3);
    let b_did = hex::encode(g.b.did);
    let keys = g.store.0.lock().unwrap().keys.clone();
    let wrap_for = |epoch: u32, did: &str| {
        keys.iter()
            .find(|((e, _, name), _)| *e == epoch && name == did)
            .map(|(_, wrap)| wrap.clone())
    };

    let second = unwrap_epoch_key(
        &g.b.kem_secret,
        &g.group,
        2,
        &g.b.did,
        &wrap_for(2, &b_did).expect("rule 5 wraps the restore's keys to everyone"),
    )
    .unwrap();
    assert!(wrap_for(last, &b_did).is_none(), "the removal leaves B out");
    let own = wrap_for(last, &hex::encode(device.did)).unwrap();
    assert!(unwrap_epoch_key(&g.b.kem_secret, &g.group, last, &g.b.did, &own).is_err());
    let chain = keys
        .iter()
        .find(|((e, _, name), _)| *e == last && name == "chain")
        .map(|(_, chain)| chain.clone())
        .unwrap();
    assert!(open_chain(&second, &g.group, last, &chain).is_err());

    let sealed = objects_of(&g.store, &device);
    assert!(!sealed.is_empty());
    for path in sealed {
        let bytes = g.store.0.lock().unwrap().objects[&path].1.clone();
        let object = parse_object(&bytes, &g.group).unwrap();
        assert_eq!(
            object.header.epoch, last,
            "nothing is sealed under the earlier keys"
        );
        let guess = purpose_key(&second, &g.group, last, ObjectType::Changes.purpose());
        assert!(open_object(&object, &guess).is_err());
    }
}
