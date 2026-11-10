//! A restore asks which devices the user still has, and signs out the rest before this device
//! seals anything under the keys it started (spec/protocol.md, Recovery).

mod sync2_common;

use std::collections::{BTreeMap, BTreeSet};

use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::envelope::{
    Header, ObjectType, open_object, parse_object, seal_object,
};
use flow_desktop_lib::sync2::epoch::{open_chain, purpose_key};
use flow_desktop_lib::sync2::kdf::sha256;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::linking::DeviceMeta;
use flow_desktop_lib::sync2::live_seal::LiveKeys;
use flow_desktop_lib::sync2::membership::{remove_devices, rename_device};
use flow_desktop_lib::sync2::paths::{log_path, parse_log_path};
use flow_desktop_lib::sync2::profile_names::set;
use flow_desktop_lib::sync2::read_budget::OBJECTS;
use flow_desktop_lib::sync2::recovery::{recovery_keys, recovery_secret};
use flow_desktop_lib::sync2::recovery_flow::{preview_restore, replace_recovery_key, restore};
use flow_desktop_lib::sync2::recovery_notice::recovery_notice;
use flow_desktop_lib::sync2::restore_removal::take_replaced_words;
use flow_desktop_lib::sync2::roster::{Cut, Op, Role, replay_roster};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::StoreError;
use flow_desktop_lib::sync2::state::{
    GroupRecord, add_roster_entries, load_group, restore_read, save_group,
};
use flow_desktop_lib::sync2::webdav::WebDavLogin;
use flow_desktop_lib::sync2::wrap::unwrap_epoch_key;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
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

/// A device just restored in `pool` with only `kept` chosen, under `link`, as the setup code leaves
/// it.
async fn restored_in(pool: &SqlitePool, g: &Group, kept: &[String], link: &str) -> MemberSecrets {
    let device = member_secrets(random_bytes(), random_bytes());
    let restored = restore(&&g.store, &&g.store, &g.recovery, &device, &meta("New"))
        .await
        .unwrap();
    add_roster_entries(pool, &restored.entries).await.unwrap();
    let record = GroupRecord::new(hex::encode(g.group), "memory".into(), None, link.to_owned())
        .restored_keeping(kept);
    save_group(pool, &record).await.unwrap();
    device
}

async fn restored_keeping(g: &Group, kept: &[String], link: &str) -> (MemberSecrets, SqlitePool) {
    let pool = empty_pool().await;
    let device = restored_in(&pool, g, kept, link).await;
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

/// `device` writes at least `count` batches to its log.
async fn wrote(g: &Group, device: &MemberSecrets, count: usize) {
    let pool = device_pool(g).await;
    let mut session = Session::open(&pool, &g.store, device).await.unwrap();
    let name = hex::encode(device.did);
    for n in 0..count {
        watch(&pool, &format!("{}{n:07}", &name[..4])).await;
        session
            .push(&pool, exported(&pool, &name).await)
            .await
            .unwrap();
    }
}

/// Where `device`'s log truly ends, as a removal would name it.
fn end_of(store: &MemoryStore, device: &MemberSecrets) -> Cut {
    let did = hex::encode(device.did);
    let memory = store.0.lock().unwrap();
    let (seq, bytes) = memory
        .objects
        .iter()
        .filter_map(|(path, (_, bytes))| {
            parse_log_path(path)
                .filter(|(sender, _)| *sender == did)
                .map(|(_, seq)| (seq, bytes))
        })
        .max_by_key(|(seq, _)| *seq)
        .unwrap();
    Cut {
        seq,
        hash: hex::encode(sha256(bytes)),
    }
}

/// Makes every read of `store` stop after one object, on its own limit.
fn one_object_per_read(store: &MemoryStore) {
    let mut memory = store.0.lock().unwrap();
    memory.page = Some(1);
    memory.padding = OBJECTS;
}

/// How many objects the logs hold.
fn log_objects(store: &MemoryStore) -> usize {
    let memory = store.0.lock().unwrap();
    memory
        .objects
        .keys()
        .filter(|path| parse_log_path(path).is_some())
        .count()
}

fn cuts(store: &MemoryStore) -> BTreeMap<String, Cut> {
    let memory = store.0.lock().unwrap();
    memory
        .roster
        .last()
        .unwrap()
        .cut
        .clone()
        .unwrap_or_default()
}

/// Opens `count` sessions, none of which may finish the restore or write to the store.
async fn stays_pending(g: &Group, device: &MemberSecrets, pool: &SqlitePool, count: usize) {
    let before = stored(&g.store);
    for _ in 0..count {
        assert!(matches!(
            Session::open(pool, &g.store, device).await,
            Err(EngineError::RestorePending)
        ));
        assert_eq!(stored(&g.store), before);
        assert!(g.store.0.lock().unwrap().deletes.is_empty());
        assert!(
            load_group(pool)
                .await
                .unwrap()
                .unwrap()
                .restore_kept
                .is_some()
        );
    }
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

#[tokio::test]
async fn a_read_cut_short_removes_only_once_it_reaches_the_end() {
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    wrote(&g, &g.b, 2).await;
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], "").await;

    stays_pending(&g, &device, &pool, log_objects(&g.store)).await;
    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(devices(&g.store), BTreeSet::from([hex::encode(device.did)]));
    assert_eq!(
        cuts(&g.store),
        BTreeMap::from([
            (hex::encode(g.a.did), end_of(&g.store, &g.a)),
            (hex::encode(g.b.did), end_of(&g.store, &g.b)),
        ])
    );
    assert!(end_of(&g.store, &g.a).seq >= 3);
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
    assert!(restore_read(&pool).await.unwrap().is_none());
}

#[tokio::test]
async fn a_read_cut_short_resumes_after_a_restart() {
    let folder = std::env::temp_dir().join(format!("flow-{}", hex::encode(random_bytes::<8>())));
    std::fs::create_dir_all(&folder).unwrap();
    let url = format!("sqlite:{}?mode=rwc", folder.join("flow.db").display());
    let reopen = || async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    };
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    one_object_per_read(&g.store);
    let mut pool = reopen().await;
    let device = restored_in(&pool, &g, &[], "").await;

    for _ in 0..log_objects(&g.store) {
        stays_pending(&g, &device, &pool, 1).await;
        pool.close().await;
        pool = reopen().await;
    }
    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(
        cuts(&g.store)[&hex::encode(g.a.did)],
        end_of(&g.store, &g.a)
    );
    pool.close().await;
    std::fs::remove_dir_all(&folder).unwrap();
}

#[tokio::test]
async fn a_missing_object_ends_only_its_own_log() {
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    wrote(&g, &g.b, 2).await;
    g.store.take(&log_path(&hex::encode(g.a.did), 2));
    g.store.0.lock().unwrap().page = Some(1);
    let (device, pool) = restored_keeping(&g, &[], "").await;

    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(devices(&g.store), BTreeSet::from([hex::encode(device.did)]));
    let cuts = cuts(&g.store);
    assert_eq!(cuts[&hex::encode(g.a.did)].seq, 1);
    assert_eq!(cuts[&hex::encode(g.b.did)], end_of(&g.store, &g.b));
}

#[tokio::test]
async fn a_missing_object_becomes_a_cut_only_once_the_read_reaches_the_end() {
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    wrote(&g, &g.b, 2).await;
    g.store.take(&log_path(&hex::encode(g.a.did), 2));
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], "").await;

    stays_pending(&g, &device, &pool, log_objects(&g.store)).await;
    Session::open(&pool, &g.store, &device).await.unwrap();

    let cuts = cuts(&g.store);
    assert_eq!(cuts[&hex::encode(g.a.did)].seq, 1);
    assert_eq!(cuts[&hex::encode(g.b.did)], end_of(&g.store, &g.b));
}

#[tokio::test]
async fn a_cursor_that_never_ends_ends_each_sync_and_finishes_nothing() {
    let g = group().await;
    wrote(&g, &g.a, 1).await;
    g.store.0.lock().unwrap().endless = true;
    let (device, pool) = restored_keeping(&g, &[], "").await;

    stays_pending(&g, &device, &pool, 1).await;
    let first = restore_read(&pool).await.unwrap().unwrap().cursor;
    stays_pending(&g, &device, &pool, 1).await;
    assert!(restore_read(&pool).await.unwrap().unwrap().cursor > first);
}

#[tokio::test]
async fn the_first_read_after_a_read_cut_short_takes_everything_once() {
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], "").await;
    let objects = log_objects(&g.store);
    stays_pending(&g, &device, &pool, objects).await;
    {
        let mut memory = g.store.0.lock().unwrap();
        memory.page = None;
        memory.padding = 0;
    }

    let mut session = Session::open(&pool, &g.store, &device).await.unwrap();

    assert!(session.adopt_link(&pool, "own").await.unwrap());
    let a = hex::encode(g.a.did);
    let pulled = session.pull(&pool).await.unwrap();
    assert_eq!(pulled.batches[&a].len(), objects);
    session.finish(&pool, pulled).await.unwrap();
    let again = session.pull(&pool).await.unwrap();
    assert!(again.batches.is_empty());
}

#[tokio::test]
async fn a_log_that_may_start_later_holds_a_read_too_long_to_list() {
    let g = group().await;
    wrote(&g, &g.a, 2).await;
    g.store.take(&log_path(&hex::encode(g.a.did), 1));
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], "").await;
    let before = stored(&g.store);

    for _ in 0..3 {
        assert!(matches!(
            Session::open(&pool, &g.store, &device).await,
            Err(EngineError::Store(StoreError::TooLong))
        ));
    }

    assert_eq!(stored(&g.store), before);
    assert!(
        load_group(&pool)
            .await
            .unwrap()
            .unwrap()
            .restore_kept
            .is_some()
    );
}

#[tokio::test]
async fn a_read_cut_short_goes_on_checking_the_chain_it_stopped_in() {
    let g = group().await;
    wrote(&g, &g.a, 3).await;
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], "").await;
    stays_pending(&g, &device, &pool, 1).await;

    let path = log_path(&hex::encode(g.a.did), 2);
    let genuine = g.store.take(&path);
    let header = parse_object(&genuine, &g.group).unwrap().header;
    let forged = Header {
        prev: [9; 32],
        ..header
    };
    g.store
        .put(&path, seal_object(&forged, &[0; 32], b"", &g.a.sig_seed));
    stays_pending(&g, &device, &pool, log_objects(&g.store) - 1).await;
    Session::open(&pool, &g.store, &device).await.unwrap();

    assert_eq!(cuts(&g.store)[&hex::encode(g.a.did)].seq, 1);
}

#[tokio::test]
async fn a_read_cut_short_reads_a_removed_senders_log_up_to_its_removal() {
    let g = group().await;
    wrote(&g, &g.b, 2).await;
    let pool_a = device_pool(&g).await;
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let pulled = a.pull(&pool_a).await.unwrap();
    a.finish(&pool_a, pulled).await.unwrap();
    let a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let b = hex::encode(g.b.did);
    remove_devices(&pool_a, &a, &g.a, std::slice::from_ref(&b))
        .await
        .unwrap();
    let cut = cuts(&g.store)[&b].clone();
    assert_eq!(cut, end_of(&g.store, &g.b));
    one_object_per_read(&g.store);
    let (device, pool) = restored_keeping(&g, &[], LINK).await;

    stays_pending(&g, &device, &pool, log_objects(&g.store)).await;
    let place = restore_read(&pool).await.unwrap().unwrap();
    assert_eq!(place.positions[&b].seq, cut.seq);

    Session::open(&pool, &g.store, &device).await.unwrap();
    assert_eq!(
        cuts(&g.store)[&hex::encode(g.a.did)],
        end_of(&g.store, &g.a)
    );
}
