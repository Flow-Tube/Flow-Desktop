//! FLOW-SYNC/2 on plain storage, against an in-process WebDAV server and an in-process S3
//! server: two devices sync through it, concurrent roster entries resolve by the fork rule,
//! pairing uses its mailbox, and refused credentials stop every later request.

mod sync2_common;

use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use dav_server::DavHandler;
use dav_server::fakels::FakeLs;
use dav_server::memfs::MemFs;
use flow_desktop_lib::sync::canonical::to_canonical_json;
use flow_desktop_lib::sync2::batches::apply_batches;
use flow_desktop_lib::sync2::codes::{StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::{DeviceMeta, add_device, join};
use flow_desktop_lib::sync2::membership::rename_device;
use flow_desktop_lib::sync2::paths::{roster_path, wrap_path};
use flow_desktop_lib::sync2::plain::{Bucket, PlainStore};
use flow_desktop_lib::sync2::roster::entry_hash;
use flow_desktop_lib::sync2::s3::{S3, S3Location, S3Login};
use flow_desktop_lib::sync2::sealed::random_bytes;
use flow_desktop_lib::sync2::server::StoreError;
use flow_desktop_lib::sync2::store::Store;
use flow_desktop_lib::sync2::webdav::{WebDav, WebDavLogin};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use s3s::auth::SimpleAuth;
use s3s::service::S3ServiceBuilder;
use s3s_fs::FileSystem;
use sqlx::SqlitePool;
use sync2_common::{Group, device_pool, empty_pool, exported, group};
use tokio::net::TcpListener;

const USER: &str = "flow";
const PASSWORD: &str = "secret";

/// Serves `handle` on a local port, counting requests.
async fn serve<F, R, B>(handle: F) -> (u16, Arc<AtomicUsize>)
where
    F: Fn(Request<Incoming>) -> R + Clone + Send + Sync + 'static,
    R: Future<Output = Response<B>> + Send + 'static,
    B: hyper::body::Body + Send + 'static,
    B::Data: Send,
    B::Error: Into<Box<dyn Error + Send + Sync>>,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&requests);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (handle, counted) = (handle.clone(), Arc::clone(&counted));
            let service = service_fn(move |request| {
                counted.fetch_add(1, Ordering::SeqCst);
                let response = handle(request);
                async move { Ok::<_, std::convert::Infallible>(response.await) }
            });
            tokio::spawn(http1::Builder::new().serve_connection(TokioIo::new(stream), service));
        }
    });
    (port, requests)
}

/// An in-memory WebDAV folder that asks for `USER`:`PASSWORD`.
async fn webdav_server() -> (String, Arc<AtomicUsize>) {
    let handler = DavHandler::builder()
        .filesystem(MemFs::new())
        .locksystem(FakeLs::new())
        .build_handler();
    let expected = format!("Basic {}", STANDARD.encode(format!("{USER}:{PASSWORD}")));
    let (port, requests) = serve(move |request: Request<Incoming>| {
        let (handler, expected) = (handler.clone(), expected.clone());
        async move {
            let authorized = request
                .headers()
                .get("authorization")
                .is_some_and(|value| value.as_bytes() == expected.as_bytes());
            if authorized {
                handler.handle(request).await
            } else {
                let mut refused = Response::new(dav_server::body::Body::empty());
                *refused.status_mut() = StatusCode::UNAUTHORIZED;
                refused
            }
        }
    })
    .await;
    (format!("http://127.0.0.1:{port}/flow-sync/"), requests)
}

/// An S3 service over a temporary folder, with one bucket and the key `USER`:`PASSWORD`.
async fn s3_server() -> (S3Location, Arc<AtomicUsize>) {
    let root = std::env::temp_dir().join(format!("flow-s3-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("flow")).unwrap();
    let mut builder = S3ServiceBuilder::new(FileSystem::new(&root).unwrap());
    builder.set_auth(SimpleAuth::from_single(USER, PASSWORD));
    let service = builder.build();
    let (port, requests) = serve(move |request: Request<Incoming>| {
        let service = service.clone();
        async move { service.call(request.map(s3s::Body::from)).await.unwrap() }
    })
    .await;
    let location = S3Location {
        endpoint: format!("http://127.0.0.1:{port}"),
        bucket: "flow".into(),
        region: "us-east-1".into(),
        prefix: "groups/one".into(),
    };
    (location, requests)
}

async fn webdav(url: &str, password: &str) -> WebDav {
    let login = WebDavLogin {
        user: USER.into(),
        password: password.into(),
    };
    WebDav::connect(url, login).await.unwrap()
}

async fn s3(location: &S3Location, secret: &str) -> S3 {
    let login = S3Login {
        access_key: USER.into(),
        secret_key: secret.into(),
    };
    S3::connect(location, &login).await.unwrap()
}

/// The two-device group of `sync2_common`, written onto `bucket`.
async fn write_group(g: &Group, bucket: &impl Bucket) {
    let (roster, keys) = {
        let memory = g.store.0.lock().unwrap();
        (memory.roster.clone(), memory.keys.clone())
    };
    for ((epoch, name), wrap) in keys {
        bucket.put(&wrap_path(epoch, &name), wrap).await.unwrap();
    }
    for entry in &roster {
        let path = roster_path(entry.seq, &entry_hash(entry));
        bucket.put(&path, to_canonical_json(entry)).await.unwrap();
    }
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

fn named(name: &str) -> DeviceMeta {
    DeviceMeta {
        app: "app".into(),
        name: name.into(),
        platform: "linux".into(),
    }
}

async fn two_devices_sync<B: Bucket>(open: impl AsyncFn() -> B) {
    let g = group().await;
    write_group(&g, &open().await).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    watch(&pool_a, "aaaaaaaaaaa").await;

    let store_a = PlainStore::new(open().await, hex::encode(g.a.did));
    let mut a = Session::open(&pool_a, store_a, &g.a).await.unwrap();
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let store_b = PlainStore::new(open().await, hex::encode(g.b.did));
    let mut b = Session::open(&pool_b, store_b, &g.b).await.unwrap();
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

/// Two devices rename the same device at once, then the loser tries again on its stale head.
async fn roster_entries_resolve_by_the_fork_rule<B: Bucket>(open: impl AsyncFn() -> B) {
    let g = group().await;
    write_group(&g, &open().await).await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let a_did = hex::encode(g.a.did);
    let a = Session::open(&pool_a, PlainStore::new(open().await, a_did.clone()), &g.a)
        .await
        .unwrap();
    let b_did = hex::encode(g.b.did);
    let b = Session::open(&pool_b, PlainStore::new(open().await, b_did), &g.b)
        .await
        .unwrap();
    let (from_a, from_b) = (named("from A"), named("from B"));
    let (first, second) = tokio::join!(
        rename_device(&a, &g.a, &a_did, &from_a),
        rename_device(&b, &g.b, &a_did, &from_b),
    );
    assert!(first.is_ok() != second.is_ok(), "exactly one entry wins");
    let (stale, secrets) = if first.is_ok() {
        (&b, &g.b)
    } else {
        (&a, &g.a)
    };
    assert!(
        rename_device(stale, secrets, &a_did, &from_a)
            .await
            .is_err()
    );

    let reader = PlainStore::new(open().await, String::new());
    assert_eq!(reader.roster_after(-1).await.unwrap().len(), 3);
}

async fn pairing_runs_through_the_mailbox<B: Bucket>(open: impl AsyncFn() -> B) {
    let g = group().await;
    write_group(&g, &open().await).await;
    let pool_a = device_pool(&g).await;
    let store_a = PlainStore::new(open().await, hex::encode(g.a.did));
    let session = Session::open(&pool_a, store_a, &g.a).await.unwrap();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let offer = new_offer(Some(StoreLocation::server("memory")), "Desktop A", None);
    let code = read_code(&offer.qr).unwrap();
    let mailbox = PlainStore::new(open().await, hex::encode(newcomer.did));
    let yes = |_sas: String| async { true };
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, yes),
        join(&pool_n, &mailbox, &code, &newcomer, named("New"), yes),
    );
    joined.unwrap();
    assert_eq!(added.unwrap(), hex::encode(newcomer.did));
}

async fn the_probe_and_the_group_marker_work<B: Bucket>(bucket: B) {
    let store = PlainStore::new(bucket, String::new());
    store.probe().await.unwrap();
    assert_eq!(store.group().await.unwrap(), None);
    let group = "00112233445566778899aabbccddeeff";
    store.mark(group).await.unwrap();
    assert_eq!(store.group().await.unwrap().as_deref(), Some(group));
}

async fn refused_credentials_stop_every_later_request<B: Bucket>(
    bucket: B,
    requests: &AtomicUsize,
) {
    let wrong = PlainStore::new(bucket, String::new());
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
async fn two_devices_sync_through_webdav() {
    let (url, _) = webdav_server().await;
    two_devices_sync(async || webdav(&url, PASSWORD).await).await;
}

#[tokio::test]
async fn two_devices_sync_through_s3() {
    let (location, _) = s3_server().await;
    two_devices_sync(async || s3(&location, PASSWORD).await).await;
}

#[tokio::test]
async fn webdav_roster_entries_resolve_by_the_fork_rule() {
    let (url, _) = webdav_server().await;
    roster_entries_resolve_by_the_fork_rule(async || webdav(&url, PASSWORD).await).await;
}

#[tokio::test]
async fn s3_roster_entries_resolve_by_the_fork_rule() {
    let (location, _) = s3_server().await;
    roster_entries_resolve_by_the_fork_rule(async || s3(&location, PASSWORD).await).await;
}

#[tokio::test]
async fn pairing_runs_through_the_webdav_mailbox() {
    let (url, _) = webdav_server().await;
    pairing_runs_through_the_mailbox(async || webdav(&url, PASSWORD).await).await;
}

#[tokio::test]
async fn pairing_runs_through_the_s3_mailbox() {
    let (location, _) = s3_server().await;
    pairing_runs_through_the_mailbox(async || s3(&location, PASSWORD).await).await;
}

#[tokio::test]
async fn the_probe_and_the_group_marker_work_on_webdav() {
    let (url, _) = webdav_server().await;
    the_probe_and_the_group_marker_work(webdav(&url, PASSWORD).await).await;
}

#[tokio::test]
async fn the_probe_and_the_group_marker_work_on_s3() {
    let (location, _) = s3_server().await;
    the_probe_and_the_group_marker_work(s3(&location, PASSWORD).await).await;
}

#[tokio::test]
async fn a_refused_webdav_password_stops_every_later_request() {
    let (url, requests) = webdav_server().await;
    refused_credentials_stop_every_later_request(webdav(&url, "wrong").await, &requests).await;
}

#[tokio::test]
async fn a_refused_s3_secret_stops_every_later_request() {
    let (location, requests) = s3_server().await;
    refused_credentials_stop_every_later_request(s3(&location, "wrong").await, &requests).await;
}
