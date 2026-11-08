//! FLOW-SYNC/2 on WebDAV, against an in-process WebDAV server: two devices sync through it,
//! concurrent roster entries resolve by the fork rule, pairing uses its mailbox, and a refused
//! password stops every later request.

mod sync2_common;

use std::collections::{BTreeMap, BTreeSet};
use std::convert::Infallible;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use dav_server::DavHandler;
use dav_server::body::Body;
use dav_server::fakels::FakeLs;
use dav_server::memfs::MemFs;
use flow_desktop_lib::sync::canonical::to_canonical_json;
use flow_desktop_lib::sync2::actions::check_login;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::entries::{build_entry, epoch_draft, member_subject};
use flow_desktop_lib::sync2::envelope::{Header, ObjectType, seal_object};
use flow_desktop_lib::sync2::epoch::{Purpose, epoch_commitment, purpose_key, seal_chain};
use flow_desktop_lib::sync2::kdf::sha256;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::linking::{
    DeviceMeta, WelcomeStore, add_device, finish_join, join, join_on_lan,
};
use flow_desktop_lib::sync2::membership::{
    leave_group, member_keys, remove_devices, rename_device,
};
use flow_desktop_lib::sync2::paths::{chain_path, kc_name, log_path, roster_path, wrap_path};
use flow_desktop_lib::sync2::payload::encode_payload;
use flow_desktop_lib::sync2::pipe::listen_on;
use flow_desktop_lib::sync2::recovery_flow::restore;
use flow_desktop_lib::sync2::roster::{Op, Role, entry_hash};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::StoreError;
use flow_desktop_lib::sync2::setup::{create_webdav_group, restore_webdav_group};
use flow_desktop_lib::sync2::state::{
    GroupRecord, StoreKind, add_roster_entries, load_group, save_group, streams,
};
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::store_login::{login_due, login_waiting};
use flow_desktop_lib::sync2::webdav::{WebDav, WebDavLogin, WebDavStore};
use flow_desktop_lib::sync2::wrap::wrap_epoch_key;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use sqlx::SqlitePool;
use sync2_common::{Group, device_pool, draft, empty_pool, exported, group, head, watch};
use tokio::net::TcpListener;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

const USER: &str = "flow";
const PASSWORD: &str = "secret";

/// Serves an in-memory WebDAV folder that asks for `USER`:`PASSWORD`, counting requests.
async fn webdav_server() -> (String, Arc<AtomicUsize>) {
    webdav_server_with(Arc::new(Mutex::new(PASSWORD.to_owned()))).await
}

/// The same, asking for `USER` and whatever `password` holds at the time.
async fn webdav_server_with(password: Arc<Mutex<String>>) -> (String, Arc<AtomicUsize>) {
    let handler = DavHandler::builder()
        .filesystem(MemFs::new())
        .locksystem(FakeLs::new())
        .build_handler();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&requests);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (handler, counted, password) =
                (handler.clone(), Arc::clone(&counted), Arc::clone(&password));
            tokio::spawn(async move {
                let service = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                    let (handler, counted, password) =
                        (handler.clone(), Arc::clone(&counted), Arc::clone(&password));
                    async move {
                        counted.fetch_add(1, Ordering::SeqCst);
                        let expected = format!(
                            "Basic {}",
                            STANDARD.encode(format!("{USER}:{}", password.lock().unwrap()))
                        );
                        let authorized = request
                            .headers()
                            .get("authorization")
                            .is_some_and(|value| value.as_bytes() == expected.as_bytes());
                        if !authorized {
                            let mut refused = hyper::Response::new(Body::empty());
                            *refused.status_mut() = hyper::StatusCode::UNAUTHORIZED;
                            return Ok::<_, Infallible>(refused);
                        }
                        Ok(handler.handle(request).await)
                    }
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}/flow-sync/"), requests)
}

async fn webdav(url: &str, password: &str) -> WebDav {
    let login = WebDavLogin {
        user: USER.into(),
        password: password.into(),
    };
    WebDav::connect(url, login).await.unwrap()
}

/// The two-device group of `sync2_common`, written onto the WebDAV folder at `url`.
async fn onto_webdav(g: &Group, url: &str) {
    let client = webdav(url, PASSWORD).await;
    let (roster, keys) = {
        let memory = g.store.0.lock().unwrap();
        (memory.roster.clone(), memory.keys.clone())
    };
    for ((epoch, kc, name), wrap) in keys {
        client
            .put(&wrap_path(epoch, &kc, &name), wrap)
            .await
            .unwrap();
    }
    for entry in &roster {
        let path = roster_path(entry.seq, &entry_hash(entry));
        client.put(&path, to_canonical_json(entry)).await.unwrap();
    }
}

async fn store_for(url: &str, did: &[u8; 16]) -> WebDavStore {
    WebDavStore::new(webdav(url, PASSWORD).await, hex::encode(did))
}

#[tokio::test]
async fn two_devices_sync_through_a_webdav_folder() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;

    let mut a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let pulled = b.pull(&pool_b).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&pool_b, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    b.finish(&pool_b, pulled).await.unwrap();
    let ids: Vec<String> = sqlx::query_scalar("SELECT video_id FROM watch_history")
        .fetch_all(&pool_b)
        .await
        .unwrap();
    assert_eq!(ids, ["aaaaaaaaaaa"]);
    let again = b.pull(&pool_b).await.unwrap();
    assert!(again.batches.is_empty(), "nothing is read twice");
}

fn named(name: &str) -> DeviceMeta {
    DeviceMeta {
        app: "app".into(),
        name: name.into(),
        platform: "linux".into(),
    }
}

#[tokio::test]
async fn concurrent_roster_entries_on_webdav_resolve_by_the_fork_rule() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let a_did = hex::encode(g.a.did);
    let a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    let b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let renamed_a = rename_device(&a, &g.a, &a_did, &named("from A")).await;
    let renamed_b = rename_device(&b, &g.b, &a_did, &named("from B")).await;
    assert!(
        renamed_a.is_ok(),
        "the first entry wins until another one beats it"
    );
    // B appended on a head A already moved: it is told so, as on a server.
    assert!(renamed_b.is_err());

    let reader = store_for(&url, &g.b.did).await;
    let chain = reader.roster_after(-1).await.unwrap();
    assert_eq!(chain.len(), 3);
}

#[tokio::test]
async fn a_roster_file_that_is_not_an_entry_is_ignored() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let client = webdav(&url, PASSWORD).await;
    client
        .put(
            "roster/0000000000000002-0123456789abcdef.r",
            b"not json".to_vec(),
        )
        .await
        .unwrap();
    client
        .put(
            "roster/0000000000000002-fedcba9876543210.r",
            br#"{"seq":2}"#.to_vec(),
        )
        .await
        .unwrap();

    let roster = g.store.0.lock().unwrap().roster.clone();
    let reader = store_for(&url, &g.b.did).await;
    assert_eq!(reader.roster_after(-1).await.unwrap(), roster);
}

#[tokio::test]
async fn a_lost_concurrent_append_reports_the_winning_head() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let a_did = hex::encode(g.a.did);
    // Both devices read the same head, then append without seeing each other's entry.
    let a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    let b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let (from_a, from_b) = (named("from A"), named("from B"));
    let (first, second) = tokio::join!(
        rename_device(&a, &g.a, &a_did, &from_a),
        rename_device(&b, &g.b, &a_did, &from_b),
    );
    assert!(first.is_ok() != second.is_ok(), "exactly one entry wins");
    let chain = store_for(&url, &g.a.did)
        .await
        .roster_after(-1)
        .await
        .unwrap();
    assert_eq!(chain.len(), 3);
}

/// A new device that has the folder's login pairs through its mailbox when no LAN address answers.
#[tokio::test]
async fn pairing_runs_through_the_webdav_mailbox() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(Some(StoreLocation::webdav(&url)), "Desktop A", None);
    let code = read_code(&offer.qr).unwrap();
    let welcome = WelcomeStore::WebDav {
        u: url.clone(),
        n: USER.into(),
        w: PASSWORD.into(),
    };
    let mailbox = store_for(&url, &newcomer.did).await;
    let yes = |_sas: String| async { true };
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, welcome, yes),
        join(&pool_n, &mailbox, &code, &newcomer, named("New"), yes),
    );
    joined.unwrap();
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
    let record = load_group(&pool_n).await.unwrap().unwrap();
    assert_eq!(record.kind, StoreKind::WebDav);
}

#[tokio::test]
async fn a_group_created_in_a_folder_welcomes_a_device_paired_over_the_lan() {
    let (url, _) = webdav_server().await;
    let login = WebDavLogin {
        user: USER.into(),
        password: PASSWORD.into(),
    };
    let a = member_secrets(random_bytes(), random_bytes());
    let pool_a = empty_pool().await;
    let folder = store_for(&url, &a.did).await;
    create_webdav_group(&pool_a, &folder, &url, &a, &named("A"), "link")
        .await
        .unwrap();
    let other = empty_pool().await;
    let again = create_webdav_group(&other, &folder, &url, &a, &named("A"), "link").await;
    assert!(matches!(
        again,
        Err(EngineError::Store(StoreError::AlreadyClaimed))
    ));

    let session = Session::open(&pool_a, store_for(&url, &a.did).await, &a)
        .await
        .unwrap();
    let listening = listen_on(vec!["127.0.0.1".into()]).await.unwrap();
    let offer = new_offer(Some(StoreLocation::webdav(&url)), "A", Some(listening));
    let code = read_code(&offer.qr).unwrap();
    let welcome = WelcomeStore::WebDav {
        u: url.clone(),
        n: login.user.clone(),
        w: login.password.clone(),
    };
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let yes = |_sas: String| async { true };
    let (added, joined) = tokio::join!(add_device(&session, offer, &a, welcome, yes), async {
        let welcomed = join_on_lan(&code, &newcomer, named("New"), yes).await?;
        let WelcomeStore::WebDav { u, n, w } = welcomed.welcome.store.clone() else {
            panic!("the welcome names the folder");
        };
        let login = WebDavLogin {
            user: n,
            password: w,
        };
        let store = WebDavStore::connect(&u, login, hex::encode(newcomer.did)).await?;
        finish_join(&pool_n, &store, welcomed).await
    });
    joined.unwrap();
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
    let record = load_group(&pool_n).await.unwrap().unwrap();
    assert_eq!(
        (record.kind, record.store_url.as_str()),
        (StoreKind::WebDav, url.as_str())
    );
    let joined = Session::open(&pool_n, store_for(&url, &newcomer.did).await, &newcomer)
        .await
        .unwrap();
    assert_eq!(joined.roster().members.len(), 3);
}

#[tokio::test]
async fn a_group_in_a_folder_is_restored_with_its_recovery_words() {
    let (url, _) = webdav_server().await;
    let a = member_secrets(random_bytes(), random_bytes());
    let folder = store_for(&url, &a.did).await;
    let words = create_webdav_group(&empty_pool().await, &folder, &url, &a, &named("A"), "link")
        .await
        .unwrap();

    let c = member_secrets(random_bytes(), random_bytes());
    let pool_c = empty_pool().await;
    let store_c = store_for(&url, &c.did).await;
    let meta = named("C");
    let wrong = restore_webdav_group(&pool_c, &store_c, &url, "not words", &c, &meta, &[]).await;
    assert!(matches!(wrong, Err(EngineError::WrongWords)));
    let next = restore_webdav_group(&pool_c, &store_c, &url, &words, &c, &meta, &[])
        .await
        .unwrap();
    assert_ne!(next, words);

    let record = load_group(&pool_c).await.unwrap().unwrap();
    assert_eq!(record.kind, StoreKind::WebDav);
    assert_eq!(record.restore_kept(), Some(BTreeSet::new()));
    let session = Session::open(&pool_c, store_for(&url, &c.did).await, &c)
        .await
        .unwrap();
    assert!(session.roster().members.contains_key(&hex::encode(c.did)));
    assert!(
        !session.roster().members.contains_key(&hex::encode(a.did)),
        "a device not kept is signed out over WebDAV too"
    );
    assert_eq!(
        load_group(&pool_c).await.unwrap().unwrap().restore_kept,
        None
    );
    let other = empty_pool().await;
    let used = restore_webdav_group(&other, &store_c, &url, &words, &c, &meta, &[]).await;
    assert!(matches!(used, Err(EngineError::RecoveryUsed)));
}

#[tokio::test]
async fn a_client_reaches_only_paths_inside_its_folder() {
    let (root, _) = webdav_server().await;
    let account = webdav(&root.replace("flow-sync/", ""), PASSWORD).await;
    account
        .put("other/notes.txt", b"mine".to_vec())
        .await
        .unwrap();
    let client = webdav(&root, PASSWORD).await;
    client.put("x/inside.b", b"ours".to_vec()).await.unwrap();

    for path in [
        "../other/notes.txt",
        "x/../../other/notes.txt",
        "%2e%2e/other/notes.txt",
        "..%2fother/notes.txt",
        "/other/notes.txt",
        "../other/notes.txt#",
        "x/inside.b#",
        "x/inside.b?y",
        "x\\..\\..\\other",
    ] {
        assert!(
            matches!(client.get(path).await, Err(StoreError::Malformed)),
            "{path}"
        );
        assert!(
            matches!(client.delete(path).await, Err(StoreError::Malformed)),
            "{path}"
        );
        assert!(
            matches!(client.put(path, vec![1]).await, Err(StoreError::Malformed)),
            "{path}"
        );
    }
    assert_eq!(
        account.get("other/notes.txt").await.unwrap().unwrap(),
        b"mine"
    );
    assert_eq!(client.get("x/inside.b").await.unwrap().unwrap(), b"ours");
}

#[tokio::test]
async fn a_refused_password_stops_every_later_request() {
    let (url, requests) = webdav_server().await;
    let wrong = WebDavStore::new(webdav(&url, "wrong").await, String::new());
    assert!(matches!(wrong.probe().await, Err(StoreError::Unauthorized)));
    let made = requests.load(Ordering::SeqCst);
    assert!(matches!(wrong.group().await, Err(StoreError::Unauthorized)));
    assert_eq!(
        requests.load(Ordering::SeqCst),
        made,
        "nothing more was sent"
    );
}

#[tokio::test]
async fn the_probe_and_the_group_marker_work_on_a_fresh_folder() {
    let (url, _) = webdav_server().await;
    let store = WebDavStore::new(webdav(&url, PASSWORD).await, String::new());
    store.probe().await.unwrap();
    assert_eq!(store.group().await.unwrap(), None);
    store
        .mark("00112233445566778899aabbccddeeff")
        .await
        .unwrap();
    assert_eq!(
        store.group().await.unwrap().as_deref(),
        Some("00112233445566778899aabbccddeeff")
    );
}

#[tokio::test]
async fn answers_past_their_limit_are_refused() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0; (4 << 20) + 1]))
        .mount(&server)
        .await;
    Mock::given(method("PROPFIND"))
        .respond_with(ResponseTemplate::new(207).set_body_string(" ".repeat((16 << 20) + 1)))
        .mount(&server)
        .await;
    let dav = webdav(&server.uri(), PASSWORD).await;
    assert!(matches!(
        dav.get("dev/x.o").await,
        Err(StoreError::TooLarge)
    ));
    assert!(matches!(dav.list("dev/").await, Err(StoreError::TooLarge)));
}

/// Answers each `PROPFIND` with a page from `listing`, given the path asked for, and each `GET`
/// with `body`.
async fn scripted_webdav(listing: fn(&str) -> String, body: String) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let body = body.clone();
            tokio::spawn(async move {
                let service = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                    let body = body.clone();
                    async move {
                        let path = request.uri().path().to_owned();
                        let mut response = if request.method() == hyper::Method::GET {
                            hyper::Response::new(Body::from(body))
                        } else {
                            let xml = format!(
                                r#"<D:multistatus xmlns:D="DAV:">{}</D:multistatus>"#,
                                listing(&path)
                            );
                            let mut response = hyper::Response::new(Body::from(xml));
                            *response.status_mut() = hyper::StatusCode::MULTI_STATUS;
                            response
                        };
                        response
                            .headers_mut()
                            .insert("content-type", "application/xml".parse().unwrap());
                        Ok::<_, Infallible>(response)
                    }
                });
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
    format!("http://127.0.0.1:{port}/flow-sync/")
}

fn propfind_entry(href: &str, folder: bool) -> String {
    let kind = if folder { "<D:collection/>" } else { "" };
    format!(
        "<D:response><D:href>{href}</D:href><D:propstat><D:prop><D:resourcetype>{kind}</D:resourcetype></D:prop></D:propstat></D:response>"
    )
}

/// One sender, and every shard of its log ending in the shard's last object, so a reader looks at
/// the next shard.
fn always_full_shards(path: &str) -> String {
    if path.ends_with("/dev/") {
        return propfind_entry(&format!("{path}{}/", "ab".repeat(16)), true);
    }
    let shard = path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .and_then(|s| u64::from_str_radix(s, 16).ok())
        .unwrap_or(0);
    (0..1000)
        .map(|n| format!("{path}{:016x}.o", shard * 1024 + 1023 - n))
        .map(|href| propfind_entry(&href, false))
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_listing_ends_when_every_shard_of_a_log_looks_full() {
    let url = scripted_webdav(always_full_shards, String::new()).await;
    let store = store_for(&url, &random_bytes()).await;
    let (objects, _) = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        store.new_objects(0, &BTreeMap::new()),
    )
    .await
    .expect("the listing ends")
    .unwrap();
    assert!(!objects.is_empty(), "what was listed still gets read");
}

fn many_roster_files(path: &str) -> String {
    (0..64)
        .map(|n| propfind_entry(&format!("{path}{n:016x}.r"), false))
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_roster_folder_too_large_to_hold_is_refused() {
    for size in [4 << 20, (4 << 20) + 1] {
        let url = scripted_webdav(many_roster_files, " ".repeat(size)).await;
        let store = store_for(&url, &random_bytes()).await;
        assert!(matches!(
            store.roster_after(-1).await,
            Err(StoreError::Malformed)
        ));
    }
}

/// A member's snapshot can place a log at its last possible `seq`; listing past it must hold.
#[tokio::test]
async fn a_log_read_up_to_its_last_possible_seq_lists_nothing_more() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    let client = webdav(&url, PASSWORD).await;
    let a = hex::encode(g.a.did);
    for seq in [1, u64::MAX] {
        client.put(&log_path(&a, seq), vec![0]).await.unwrap();
    }
    let store = store_for(&url, &g.b.did).await;
    let listed = |read: u64| {
        let store = &store;
        let read = BTreeMap::from([(a.clone(), read)]);
        async move { store.new_objects(1, &read).await.unwrap().0 }
    };
    let last: Vec<String> = listed(u64::MAX - 1)
        .await
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert_eq!(last, [log_path(&a, u64::MAX)]);
    assert!(listed(u64::MAX).await.is_empty());
}

/// A folder with the group on it, whose password can change, and a device's database as a
/// `WebDAV` group.
async fn folder(g: &Group) -> (String, Arc<Mutex<String>>) {
    let password = Arc::new(Mutex::new(PASSWORD.to_owned()));
    let (url, _) = webdav_server_with(Arc::clone(&password)).await;
    onto_webdav(g, &url).await;
    let client = webdav(&url, PASSWORD).await;
    let id = hex::encode(g.group);
    let body = format!(r#"{{"format":"FLOW-SYNC/2","group":"{id}"}}"#);
    client.put("store.json", body.into_bytes()).await.unwrap();
    (url, password)
}

async fn webdav_pool(g: &Group, url: &str) -> SqlitePool {
    let pool = device_pool(g).await;
    sqlx::query("UPDATE sync2_group SET kind = ?, store_url = ?")
        .bind(StoreKind::WebDav)
        .bind(url)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

fn new_login() -> WebDavLogin {
    WebDavLogin {
        user: USER.into(),
        password: "the new one".into(),
    }
}

/// Writes `content` as a login object at the next `seq` of `did`'s log on the folder, sealed under
/// `key` as `epoch`, and returns the next position.
async fn plant_login(
    url: &str,
    g: &Group,
    signer: &MemberSecrets,
    (epoch, key): (u32, &[u8]),
    (seq, prev): (u64, [u8; 32]),
) -> (u64, [u8; 32]) {
    let header = Header {
        object_type: ObjectType::Login,
        group: g.group,
        epoch,
        sender: signer.did,
        seq,
        prev,
    };
    let sealed = seal_object(
        &header,
        &purpose_key(key, &g.group, epoch, Purpose::Store),
        &encode_payload(br#"{"k":"webdav","n":"u","w":"planted"}"#).unwrap(),
        &signer.sig_seed,
    );
    let hash = sha256(&sealed);
    webdav(url, PASSWORD)
        .await
        .put(&log_path(&hex::encode(signer.did), seq), sealed)
        .await
        .unwrap();
    (seq + 1, hash)
}

#[tokio::test]
async fn a_new_login_reaches_a_device_that_takes_it_once_the_folder_refuses_the_old_one() {
    let g = group().await;
    let (url, password) = folder(&g).await;
    let (pool_a, pool_b) = (webdav_pool(&g, &url).await, webdav_pool(&g, &url).await);

    let mut a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    a.write_login(&pool_a, &new_login()).await.unwrap();
    assert_eq!(login_waiting(&pool_a).await.unwrap().unwrap().len(), 1);

    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let pulled = b.pull(&pool_b).await.unwrap();
    assert_eq!(pulled.login, Some(new_login()));
    b.finish(&pool_b, pulled).await.unwrap();

    let mut a2 = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    let read_ack = a2.pull(&pool_a).await.unwrap();
    a2.finish(&pool_a, read_ack).await.unwrap();
    assert_eq!(login_waiting(&pool_a).await.unwrap(), Some(Vec::new()));

    "the new one".clone_into(&mut password.lock().unwrap());
    let record = load_group(&pool_b).await.unwrap().unwrap();
    let me = hex::encode(g.b.did);
    let old = WebDavLogin {
        user: USER.into(),
        password: PASSWORD.into(),
    };
    assert!(matches!(
        check_login(&record, me.clone(), &old).await,
        Err(EngineError::Store(StoreError::Unauthorized))
    ));
    check_login(&record, me, &new_login()).await.unwrap();
}

#[tokio::test]
async fn a_login_the_folder_refuses_is_reported_as_refused() {
    let g = group().await;
    let (url, password) = folder(&g).await;
    let pool = webdav_pool(&g, &url).await;
    "another".clone_into(&mut password.lock().unwrap());
    let record = load_group(&pool).await.unwrap().unwrap();
    assert!(matches!(
        check_login(&record, hex::encode(g.b.did), &new_login()).await,
        Err(EngineError::Store(StoreError::Unauthorized))
    ));
}

#[tokio::test]
async fn a_login_on_a_group_with_a_flow_server_is_ignored() {
    let g = group().await;
    let (url, _) = folder(&g).await;
    let pool_b = device_pool(&g).await;
    plant_login(&url, &g, &g.a, (0, &g.epoch_key), (1, [0; 32])).await;
    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    assert_eq!(b.pull(&pool_b).await.unwrap().login, None);
}

/// A `remove` wins over a `rotate` that lost and stands, so the rotate's key isn't the chain's.
#[tokio::test]
async fn a_login_outside_the_chains_current_key_is_ignored_and_the_log_goes_on() {
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
    let (url, _) = folder(&g).await;
    let pool_b = webdav_pool(&g, &url).await;
    let before = head(&g.store);

    Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let losing_key: [u8; 32] = random_bytes();
    let dids = [g.a.did, g.b.did, c.did, g.recovery.did];
    let mut rotate = draft(Op::Rotate, &g.b);
    rotate.epoch = Some(epoch_draft(&losing_key, &g.group, 1, &dids));
    let rotate = build_entry(&g.group, Some(&before), rotate, &[&g.b]);
    let client = webdav(&url, PASSWORD).await;
    let losing_wrap = wrap_epoch_key(&g.b.kem_public, &g.group, 1, &g.b.did, &losing_key).unwrap();
    let kc = kc_name(&epoch_commitment(&losing_key, &g.group, 1));
    client
        .put(&wrap_path(1, &kc, &hex::encode(g.b.did)), losing_wrap)
        .await
        .unwrap();
    client
        .put(
            &roster_path(rotate.seq, &entry_hash(&rotate)),
            to_canonical_json(&rotate),
        )
        .await
        .unwrap();

    let keys = member_keys(&before, Some(&hex::encode(c.did))).unwrap();
    let remove_key: [u8; 32] = random_bytes();
    let stays = [g.a.did, g.b.did, g.recovery.did];
    let mut remove = draft(Op::Remove, &g.a);
    remove.remove = Some(vec![hex::encode(c.did)]);
    remove.epoch = Some(epoch_draft(&remove_key, &g.group, 1, &stays));
    let remove = build_entry(&g.group, Some(&before), remove, &[&g.a]);
    let kc = kc_name(&epoch_commitment(&remove_key, &g.group, 1));
    for (did, kem) in keys {
        let wrap = wrap_epoch_key(&kem, &g.group, 1, &did, &remove_key).unwrap();
        client
            .put(&wrap_path(1, &kc, &hex::encode(did)), wrap)
            .await
            .unwrap();
    }
    client
        .put(
            &chain_path(1, &kc),
            seal_chain(&remove_key, &g.group, 1, &g.epoch_key),
        )
        .await
        .unwrap();
    client
        .put(
            &roster_path(remove.seq, &entry_hash(&remove)),
            to_canonical_json(&remove),
        )
        .await
        .unwrap();

    let next = plant_login(&url, &g, &c, (0, &g.epoch_key), (1, [0; 32])).await;
    plant_login(&url, &g, &c, (1, &losing_key), next).await;
    let next = plant_login(&url, &g, &g.a, (0, &g.epoch_key), (1, [0; 32])).await;
    let next = plant_login(&url, &g, &g.a, (1, &losing_key), next).await;
    let (seq, _) = plant_login(&url, &g, &g.a, (1, &remove_key), next).await;

    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    assert_eq!(b.roster().head, entry_hash(&remove));
    let pulled = b.pull(&pool_b).await.unwrap();
    assert_eq!(
        pulled.login,
        Some(WebDavLogin {
            user: "u".into(),
            password: "planted".into(),
        }),
        "only the last one, reached by reading past the others, counts"
    );
    b.finish(&pool_b, pulled).await.unwrap();
    let acked = held_position(&pool_b, &hex::encode(g.a.did)).await;
    assert_eq!(acked, seq - 1);
}

async fn held_position(pool: &SqlitePool, did: &str) -> u64 {
    streams(pool).await.unwrap()[did].seq
}

#[tokio::test]
async fn the_notice_follows_a_removal_and_not_a_leave_and_clears_with_a_login() {
    let g = group().await;
    let (url, _) = folder(&g).await;
    let (pool_a, pool_b) = (webdav_pool(&g, &url).await, webdav_pool(&g, &url).await);

    let mut a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    assert!(!login_due(&pool_a).await.unwrap());

    let c = member_secrets(random_bytes(), random_bytes());
    let state = a.roster().clone();
    let mut add = draft(Op::Add, &g.a);
    add.add = Some(vec![member_subject(
        &c.sig_public,
        &c.kem_public,
        Role::Device,
    )]);
    let add = build_entry(&g.group, Some(&state), add, &[&g.a, &c]);
    let wrap = wrap_epoch_key(&c.kem_public, &g.group, 0, &c.did, &g.epoch_key).unwrap();
    let wraps = BTreeMap::from([(hex::encode(c.did), URL_SAFE_NO_PAD.encode(wrap))]);
    a.store()
        .append_roster(&state.head, &add, &wraps, None)
        .await
        .unwrap();
    a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    remove_devices(&pool_a, &a, &g.a, &[hex::encode(c.did)])
        .await
        .unwrap();

    a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    assert!(login_due(&pool_a).await.unwrap());
    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    assert!(login_due(&pool_b).await.unwrap());

    a.write_login(&pool_a, &new_login()).await.unwrap();
    assert!(!login_due(&pool_a).await.unwrap());
    let pulled = b.pull(&pool_b).await.unwrap();
    b.finish(&pool_b, pulled).await.unwrap();
    assert!(!login_due(&pool_b).await.unwrap());
}

#[tokio::test]
async fn a_leave_calls_for_no_new_login() {
    let g = group().await;
    let (url, _) = folder(&g).await;
    let pool_a = webdav_pool(&g, &url).await;
    let pool_b = webdav_pool(&g, &url).await;
    let a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    leave_group(&a, &g.a).await.unwrap();
    Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    assert!(!login_due(&pool_b).await.unwrap());
}

/// One more object than `device` wrote, past the size any object may have, at the end of its log.
async fn too_large_at_the_end(url: &str, device: &MemberSecrets, wrote: i64) {
    let seq = u64::try_from(wrote + 1).unwrap();
    webdav(url, PASSWORD)
        .await
        .put(
            &log_path(&hex::encode(device.did), seq),
            vec![0; (4 << 20) + 1],
        )
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn an_object_past_the_size_limit_stops_only_its_own_log() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let pool_a = device_pool(&g).await;
    let mut a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    watch(&pool_a, "aaaaaaaaaaa").await;
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    too_large_at_the_end(&url, &g.a, a.record().own_seq).await;

    let pool_b = device_pool(&g).await;
    let mut b = Session::open(&pool_b, store_for(&url, &g.b.did).await, &g.b)
        .await
        .unwrap();
    let pulled = b.pull(&pool_b).await.unwrap();

    let sender = hex::encode(g.a.did);
    assert!(pulled.batches.contains_key(&sender));
    b.finish(&pool_b, pulled).await.unwrap();
    let read = streams(&pool_b).await.unwrap();
    assert_eq!(read[&sender].seq, a.record().own_seq.unsigned_abs());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_ends_a_log_at_an_object_past_the_size_limit() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    let pool_a = device_pool(&g).await;
    let mut a = Session::open(&pool_a, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();
    watch(&pool_a, "aaaaaaaaaaa").await;
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    too_large_at_the_end(&url, &g.a, a.record().own_seq).await;

    let device = member_secrets(random_bytes(), random_bytes());
    let store = store_for(&url, &device.did).await;
    let restored = restore(&store, &store, &g.recovery, &device, &named("New"))
        .await
        .unwrap();
    let pool = empty_pool().await;
    add_roster_entries(&pool, &restored.entries).await.unwrap();
    let record = GroupRecord::on_webdav(hex::encode(g.group), url.clone(), String::new())
        .restored_keeping(&[]);
    save_group(&pool, &record).await.unwrap();
    Session::open(&pool, store_for(&url, &device.did).await, &device)
        .await
        .unwrap();

    let roster = store.roster_after(-1).await.unwrap();
    let cut = roster.last().unwrap().cut.clone().unwrap();
    assert_eq!(
        cut[&hex::encode(g.a.did)].seq,
        a.record().own_seq.unsigned_abs()
    );
    assert_eq!(load_group(&pool).await.unwrap().unwrap().restore_kept, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_roster_file_past_the_size_limit_is_ignored() {
    let g = group().await;
    let (url, _) = webdav_server().await;
    onto_webdav(&g, &url).await;
    webdav(&url, PASSWORD)
        .await
        .put(
            "roster/ffffffffffffffff-ffffffffffffffff.r",
            vec![b' '; (4 << 20) + 1],
        )
        .await
        .unwrap();
    let pool = device_pool(&g).await;

    let session = Session::open(&pool, store_for(&url, &g.a.did).await, &g.a)
        .await
        .unwrap();

    assert_eq!(session.entries().len(), 2);
}

#[tokio::test]
async fn only_a_refusal_of_the_one_object_stops_only_that_object() {
    let answer = |status: u16| async move {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
        let store = store_for(&format!("{}/", server.uri()), &random_bytes()).await;
        let read = store.get_object("dev/x/log/o").await;
        let wrap = store.key(0, "kc", "name").await;
        (read, wrap)
    };
    for status in [400, 403, 410, 413, 451] {
        let (read, wrap) = answer(status).await;
        assert!(matches!(read, Ok(None)), "{status}");
        assert!(matches!(wrap, Ok(None)), "{status}");
    }
    for status in [401, 407, 408, 429, 500, 502, 503, 507] {
        let (read, wrap) = answer(status).await;
        assert!(read.is_err(), "{status}");
        assert!(wrap.is_err(), "{status}");
    }
}

#[tokio::test]
async fn an_unreachable_folder_still_fails_the_read() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let store = store_for(&format!("http://127.0.0.1:{port}/"), &random_bytes()).await;

    assert!(matches!(
        store.get_object("dev/x/log/o").await,
        Err(StoreError::Network(_))
    ));
}
