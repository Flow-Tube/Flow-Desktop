//! The FLOW-SYNC/2 server client against a stand-in server: transport rules, sign-in, instance
//! pinning, re-sign-in after a refused token, no redirects, and append conflicts.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::curve::verify;
use flow_desktop_lib::sync2::kdf::tag;
use flow_desktop_lib::sync2::keys::{MemberSecrets, member_secrets};
use flow_desktop_lib::sync2::server::{ServerStore, StoreError};
use flow_desktop_lib::sync2::store::Store;
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const INSTANCE: &str = "0102030405060708090a0b0c0d0e0f10";
const GROUP: &str = "a1a2a3a4a5a6a7a8a9aaabacadaeafb0";

fn member() -> MemberSecrets {
    member_secrets([7; 32], [9; 32])
}

/// Issues `t1`, `t2`, … only for a valid signature over the challenge it handed out.
struct TokenIssuer {
    member: [u8; 32],
    issued: Arc<AtomicUsize>,
}

impl Respond for TokenIssuer {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let challenge = URL_SAFE_NO_PAD
            .decode(body["challenge"].as_str().unwrap())
            .unwrap();
        let message = [
            tag("auth"),
            hex::decode(INSTANCE).unwrap(),
            hex::decode(GROUP).unwrap(),
            challenge,
        ]
        .concat();
        let sig = URL_SAFE_NO_PAD
            .decode(body["sig"].as_str().unwrap())
            .unwrap();
        if !verify(&self.member, &message, &sig) {
            return ResponseTemplate::new(401).set_body_json(json!({ "error": "unauthorized" }));
        }
        let n = self.issued.fetch_add(1, Ordering::SeqCst) + 1;
        ResponseTemplate::new(200)
            .set_body_json(json!({ "token": format!("t{n}"), "expires": u64::MAX / 2 }))
    }
}

async fn server(instance: &str) -> (MockServer, Arc<AtomicUsize>) {
    let server = MockServer::start().await;
    let challenge = json!({ "challenge": URL_SAFE_NO_PAD.encode([5; 32]), "instance": instance, "group": GROUP, "time": 0 });
    Mock::given(method("POST"))
        .and(path("/v1/auth/challenge"))
        .respond_with(ResponseTemplate::new(200).set_body_json(challenge))
        .mount(&server)
        .await;
    let issued = Arc::new(AtomicUsize::new(0));
    let issuer = TokenIssuer {
        member: member().sig_public,
        issued: Arc::clone(&issued),
    };
    Mock::given(method("POST"))
        .and(path("/v1/auth/token"))
        .respond_with(issuer)
        .mount(&server)
        .await;
    (server, issued)
}

async fn insecure(url: &str) -> bool {
    matches!(
        ServerStore::connect(url, member(), None, None).await,
        Err(StoreError::Insecure)
    )
}

#[tokio::test]
async fn plain_http_is_allowed_only_to_private_addresses() {
    assert!(!insecure("https://sync.example.org/").await);
    assert!(!insecure("http://192.168.1.5:8080/").await);
    assert!(!insecure("http://100.101.102.103/").await);
    assert!(!insecure("http://[::ffff:10.0.0.2]:8080/").await);
    assert!(!insecure("http://[fd12::1]/").await);
    assert!(insecure("http://203.0.113.5/").await);
    assert!(insecure("http://sync.example.org/").await);
    assert!(insecure("http://[::ffff:203.0.113.5]/").await);
    assert!(insecure("ftp://192.168.1.5/").await);
}

#[tokio::test]
async fn requests_carry_a_token_from_a_signed_challenge() {
    let (server, _) = server(INSTANCE).await;
    Mock::given(method("GET"))
        .and(path("/v1/roster"))
        .and(header("authorization", "Bearer t1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "entries": [] })))
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    assert!(store.roster_after(-1).await.unwrap().is_empty());
    assert_eq!(
        store.identity().await,
        (Some(INSTANCE.to_owned()), Some(GROUP.to_owned()))
    );
}

#[tokio::test]
async fn a_different_instance_is_refused() {
    let (server, _) = server("ffffffffffffffffffffffffffffffff").await;
    let store = ServerStore::connect(
        &format!("{}/", server.uri()),
        member(),
        Some(INSTANCE.to_owned()),
        None,
    )
    .await
    .unwrap();
    assert!(matches!(
        store.roster_after(-1).await,
        Err(StoreError::InstanceChanged)
    ));
}

#[tokio::test]
async fn a_refused_token_is_renewed_once() {
    let (server, issued) = server(INSTANCE).await;
    Mock::given(method("GET"))
        .and(path("/v1/roster"))
        .and(header("authorization", "Bearer t2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "entries": [] })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/roster"))
        .and(header("authorization", "Bearer t1"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "unauthorized" })))
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    assert!(store.roster_after(-1).await.unwrap().is_empty());
    assert_eq!(issued.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn redirects_are_not_followed() {
    let (server, _) = server(INSTANCE).await;
    Mock::given(method("GET"))
        .and(path("/v1/objects/dev/x"))
        .respond_with(
            ResponseTemplate::new(302).insert_header("location", "https://elsewhere.example/"),
        )
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    assert!(matches!(
        store.get_object("dev/x").await,
        Err(StoreError::Refused { status: 302, .. })
    ));
}

#[tokio::test]
async fn a_lost_append_reports_the_current_head() {
    let (server, _) = server(INSTANCE).await;
    Mock::given(method("POST"))
        .and(path("/v1/roster"))
        .and(header("if-match", "\"stale\""))
        .respond_with(
            ResponseTemplate::new(409)
                .set_body_json(json!({ "error": "conflict", "head": "newer" })),
        )
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    let entry = serde_json::from_value(json!({
        "v": 2, "group": GROUP, "seq": 1, "prev": "00".repeat(32), "op": "rename",
        "signer": "00".repeat(16), "meta": { "00000000000000000000000000000000": "x" }, "sigs": {}
    }))
    .unwrap();
    let outcome = store
        .append_roster("stale", &entry, &Default::default(), None)
        .await
        .unwrap();
    assert_eq!(
        outcome,
        flow_desktop_lib::sync2::server::Appended::Conflict {
            head: "newer".to_owned()
        }
    );
}

#[tokio::test]
async fn claiming_a_server_that_has_a_group_says_so() {
    let (server, _) = server(INSTANCE).await;
    Mock::given(method("POST"))
        .and(path("/v1/claim"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({ "error": "conflict" })))
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    let genesis = serde_json::from_value(json!({
        "v": 2, "group": GROUP, "seq": 0, "prev": "00".repeat(32), "op": "rename",
        "signer": "00".repeat(16), "meta": { "00000000000000000000000000000000": "x" }, "sigs": {}
    }))
    .unwrap();
    assert!(matches!(
        store.claim("admin", &genesis, &Default::default()).await,
        Err(StoreError::AlreadyClaimed)
    ));
}

#[tokio::test]
async fn a_join_request_waits_for_a_member_s_code() {
    use flow_desktop_lib::sync2::codes::{Code, StoreLocation, new_offer};
    use flow_desktop_lib::sync2::join_requests::wait_for_code;
    use wiremock::matchers::path_regex;

    let (server, _) = server(INSTANCE).await;
    Mock::given(method("POST"))
        .and(path("/v1/join"))
        .and(header("authorization", "Bearer admin"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "expires": 1 })))
        .mount(&server)
        .await;
    let answer = "^/v1/join/[0-9a-f]{32}$";
    Mock::given(method("GET"))
        .and(path_regex(answer))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "not_found" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let code = new_offer(
        Some(StoreLocation::server(&server.uri())),
        "Desktop A",
        None,
    )
    .qr;
    Mock::given(method("GET"))
        .and(path_regex(answer))
        .and(header("authorization", "Bearer admin"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "code": code })))
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    let answered = wait_for_code(&store, "admin", "New desktop").await.unwrap();
    assert!(matches!(answered, Code::Member { .. }));
    let posted: Value = serde_json::from_slice(
        &server
            .received_requests()
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.url.path() == "/v1/join")
            .unwrap()
            .body,
    )
    .unwrap();
    assert_eq!(posted["name"], "New desktop");
    assert_eq!(posted["id"].as_str().unwrap().len(), 32);
}

#[tokio::test]
async fn members_list_answer_and_decline_join_requests_with_their_token() {
    let (server, _) = server(INSTANCE).await;
    let id = "ab".repeat(16);
    Mock::given(method("GET"))
        .and(path("/v1/join"))
        .and(header("authorization", "Bearer t1"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(
                json!({ "requests": [{ "id": id, "name": "Phone", "expires": 5 }] }),
            ),
        )
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path(format!("/v1/join/{id}")))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/v1/join/{id}")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let store = ServerStore::connect(&format!("{}/", server.uri()), member(), None, None)
        .await
        .unwrap();
    let requests = store.join_requests().await.unwrap();
    assert_eq!(
        (requests[0].id.as_str(), requests[0].name.as_str()),
        (id.as_str(), "Phone")
    );
    store.answer_join(&id, "{}").await.unwrap();
    store.decline_join(&id).await.unwrap();
}
