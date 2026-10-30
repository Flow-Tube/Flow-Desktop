//! FLOW-SYNC/2 on WebDAV, against an in-process WebDAV server: two devices sync through it,
//! concurrent roster entries resolve by the fork rule, pairing uses its mailbox, and a refused
//! password stops every later request.

mod sync2_common;

use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use dav_server::DavHandler;
use dav_server::body::Body;
use dav_server::fakels::FakeLs;
use dav_server::memfs::MemFs;
use flow_desktop_lib::sync::canonical::to_canonical_json;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::{EngineError, Session, now_ms};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::{
    DeviceMeta, WelcomeStore, add_device, finish_join, join, join_on_lan,
};
use flow_desktop_lib::sync2::membership::rename_device;
use flow_desktop_lib::sync2::paths::{roster_path, wrap_path};
use flow_desktop_lib::sync2::pipe::listen_on;
use flow_desktop_lib::sync2::roster::entry_hash;
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::StoreError;
use flow_desktop_lib::sync2::setup::create_webdav_group;
use flow_desktop_lib::sync2::state::{StoreKind, load_group};
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::webdav::{WebDav, WebDavLogin, WebDavStore};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use sqlx::SqlitePool;
use sync2_common::{Group, device_pool, empty_pool, exported, group};
use tokio::net::TcpListener;

const USER: &str = "flow";
const PASSWORD: &str = "secret";

/// Serves an in-memory WebDAV folder that asks for `USER`:`PASSWORD`, counting requests.
async fn webdav_server() -> (String, Arc<AtomicUsize>) {
    let handler = DavHandler::builder()
        .filesystem(MemFs::new())
        .locksystem(FakeLs::new())
        .build_handler();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&requests);
    let expected = format!("Basic {}", STANDARD.encode(format!("{USER}:{PASSWORD}")));
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (handler, counted, expected) =
                (handler.clone(), Arc::clone(&counted), expected.clone());
            tokio::spawn(async move {
                let service = service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                    let (handler, counted, expected) =
                        (handler.clone(), Arc::clone(&counted), expected.clone());
                    async move {
                        counted.fetch_add(1, Ordering::SeqCst);
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
    for ((epoch, name), wrap) in keys {
        client.put(&wrap_path(epoch, &name), wrap).await.unwrap();
    }
    for entry in &roster {
        let path = roster_path(entry.seq, &entry_hash(entry));
        client.put(&path, to_canonical_json(entry)).await.unwrap();
    }
}

async fn store_for(url: &str, did: &[u8; 16]) -> WebDavStore {
    WebDavStore::new(webdav(url, PASSWORD).await, hex::encode(did))
}

async fn watch(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, 'title', NULL, NULL, '2025-01-01T00:00:00+00:00', 10, 600, 0, 0, '100:0:dA')",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
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
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
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
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
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
