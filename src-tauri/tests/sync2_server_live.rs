//! Desktop against a real flow-sync server: claim, sign in, unwrap the epoch key, and round-trip a
//! sealed object. Ignored by default; run it against a fresh instance:
//!
//! `FLOW_SYNC_TEST_URL=http://127.0.0.1:8080/ FLOW_SYNC_TEST_ADMIN=<token> cargo test --test sync2_server_live -- --ignored`

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::entries::{Draft, build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::envelope::{
    Header, ObjectType, ZERO_HASH, open_object, parse_object, seal_object, verify_object,
};
use flow_desktop_lib::sync2::epoch::{Purpose, check_epoch_key, purpose_key};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::payload::{decode_payload, encode_payload};
use flow_desktop_lib::sync2::recovery::recovery_keys;
use flow_desktop_lib::sync2::roster::{Op, Role, apply_entry};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::ServerStore;
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::wrap::{unwrap_epoch_key, wrap_epoch_key};

#[tokio::test]
#[ignore = "needs a running flow-sync server"]
async fn desktop_talks_to_a_real_server() {
    let url = std::env::var("FLOW_SYNC_TEST_URL").expect("FLOW_SYNC_TEST_URL");
    let admin = std::env::var("FLOW_SYNC_TEST_ADMIN").expect("FLOW_SYNC_TEST_ADMIN");
    let device = member_secrets(random_bytes(), random_bytes());
    let recovery = recovery_keys(&random_bytes());
    let group: [u8; 16] = random_bytes();
    let epoch_key: [u8; 32] = random_bytes();

    let draft = Draft {
        op: Op::Genesis,
        signer: hex::encode(device.did),
        add: Some(vec![
            member_subject(&device.sig_public, &device.kem_public, Role::Device),
            member_subject(&recovery.sig_public, &recovery.kem_public, Role::Recovery),
        ]),
        remove: None,
        epoch: Some(epoch_draft(
            &epoch_key,
            &group,
            0,
            &[device.did, recovery.did],
        )),
        meta: None,
    };
    let genesis = build_entry(&group, None, draft, &[&device, &recovery]);
    let mut wraps = BTreeMap::new();
    for member in [&device, &recovery] {
        let wrap = wrap_epoch_key(&member.kem_public, &group, 0, &member.did, &epoch_key).unwrap();
        wraps.insert(hex::encode(member.did), URL_SAFE_NO_PAD.encode(wrap));
    }

    let store = ServerStore::connect(&url, device.clone(), None, Some(hex::encode(group)))
        .await
        .unwrap();
    store.claim(&admin, &genesis, &wraps).await.unwrap();
    let entries = store.roster_after(-1).await.unwrap();
    let state = apply_entry(None, &entries[0]).unwrap();
    assert_eq!(entries, [genesis]);

    let wrap = store
        .key(0, &hex::encode(device.did))
        .await
        .unwrap()
        .unwrap();
    let unwrapped = unwrap_epoch_key(&device.kem_secret, &group, 0, &device.did, &wrap).unwrap();
    check_epoch_key(
        &unwrapped,
        &group,
        0,
        &URL_SAFE_NO_PAD.decode(&state.kc).unwrap(),
    )
    .unwrap();

    let header = Header {
        object_type: ObjectType::Changes,
        group,
        epoch: 0,
        sender: device.did,
        seq: 1,
        prev: ZERO_HASH,
    };
    let key = purpose_key(&epoch_key, &group, 0, Purpose::Changes);
    let object = seal_object(
        &header,
        &key,
        &encode_payload(b"hello from Rust").unwrap(),
        &device.sig_seed,
    );
    let path = log_path(&hex::encode(device.did), 1);
    store.put_object(&path, object.clone()).await.unwrap();
    store.put_object(&path, object.clone()).await.unwrap();

    let (changes, cursor) = store.changes(0).await.unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, path);
    assert!(cursor > 0);
    let fetched = store.get_object(&path).await.unwrap().unwrap();
    let parsed = parse_object(&fetched, &group).unwrap();
    verify_object(&parsed, &device.sig_public).unwrap();
    assert_eq!(
        decode_payload(&open_object(&parsed, &key).unwrap()).unwrap(),
        b"hello from Rust"
    );
}

#[tokio::test]
#[ignore = "needs a fresh flow-sync server"]
async fn a_group_is_created_paired_with_and_restored_through_the_server() {
    use flow_desktop_lib::sync2::codes::{new_offer, read_code};
    use flow_desktop_lib::sync2::engine::Session;
    use flow_desktop_lib::sync2::linking::{DeviceMeta, add_device, join};
    use flow_desktop_lib::sync2::setup::{create_group, restore_group};
    use flow_desktop_lib::sync2::state::load_group;
    use sqlx::sqlite::SqlitePoolOptions;

    let url = std::env::var("FLOW_SYNC_TEST_URL").expect("FLOW_SYNC_TEST_URL");
    let admin = std::env::var("FLOW_SYNC_TEST_ADMIN").expect("FLOW_SYNC_TEST_ADMIN");
    let pool = || async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    };
    let meta = |name: &str| DeviceMeta {
        app: format!("app-{name}"),
        name: name.into(),
        platform: "macos".into(),
    };
    let (pool_a, pool_b) = (pool().await, pool().await);
    let a = member_secrets(random_bytes(), random_bytes());
    let b = member_secrets(random_bytes(), random_bytes());

    let words = create_group(&pool_a, &url, &admin, &a, &meta("A"), "default-link")
        .await
        .unwrap();
    assert_eq!(words.split(' ').count(), 24);
    let record = load_group(&pool_a).await.unwrap().unwrap();
    let store_a = ServerStore::connect(
        &url,
        a.clone(),
        record.instance.clone(),
        Some(record.group_id.clone()),
    )
    .await
    .unwrap();
    let session = Session::open(&pool_a, store_a, &a).await.unwrap();

    let offer = new_offer(Some(&url), "A", None);
    let code = read_code(&offer.qr).unwrap();
    let store_b = ServerStore::connect(&url, b.clone(), None, None)
        .await
        .unwrap();
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &a, |_| async { true }),
        join(&pool_b, &store_b, &code, &b, meta("B"), |_| async { true }),
    );
    assert_eq!(added.unwrap(), hex::encode(b.did));
    joined.unwrap();
    let joined_record = load_group(&pool_b).await.unwrap().unwrap();
    assert_eq!(
        (
            &joined_record.group_id,
            &joined_record.instance,
            &joined_record.link
        ),
        (&record.group_id, &record.instance, &record.link)
    );

    let restored = member_secrets(random_bytes(), random_bytes());
    let pool_c = pool().await;
    let next_words = restore_group(&pool_c, &url, &words, &restored, &meta("C"))
        .await
        .unwrap();
    assert_ne!(next_words, words);
    let restored_record = load_group(&pool_c).await.unwrap().unwrap();
    assert_eq!(restored_record.group_id, joined_record.group_id);
    let store_c = ServerStore::connect(
        &url,
        restored.clone(),
        restored_record.instance.clone(),
        Some(restored_record.group_id.clone()),
    )
    .await
    .unwrap();
    assert_eq!(
        Session::open(&pool_c, store_c, &restored)
            .await
            .unwrap()
            .roster()
            .epoch,
        2
    );
    assert!(
        restore_group(
            &pool().await,
            &url,
            &words,
            &member_secrets(random_bytes(), random_bytes()),
            &meta("D"),
        )
        .await
        .is_err()
    );
}
