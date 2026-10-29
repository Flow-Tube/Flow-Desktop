//! The live channel against a loopback stand-in for the server: the socket opens with the token as
//! a subprotocol, over an upgraded HTTP/1.1 request, and receives the server's `changed` notice.

use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::server::ServerStore;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::{Message, Utf8Bytes};

const INSTANCE: &str = "0102030405060708090a0b0c0d0e0f10";
const GROUP: &str = "a1a2a3a4a5a6a7a8a9aaabacadaeafb0";

/// Answers one sign-in request with canned JSON; the stand-in trusts every signature.
async fn answer_http(mut stream: TcpStream, head: String) {
    let mut request = vec![0; 8192];
    let _ = stream.read(&mut request).await;
    let body = if head.contains("/v1/auth/challenge") {
        json!({ "challenge": URL_SAFE_NO_PAD.encode([5; 32]), "instance": INSTANCE, "group": GROUP, "time": 0 })
    } else {
        json!({ "token": "t1", "expires": u64::MAX / 2 })
    };
    let body = body.to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

/// Serves sign-in and `/v1/live`, recording the subprotocols the live request offered.
async fn stand_in(offered: Arc<Mutex<String>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let mut first = [0; 4096];
            let read = stream.peek(&mut first).await.unwrap_or(0);
            let head = String::from_utf8_lossy(&first[..read]).into_owned();
            if !head.starts_with("GET /v1/live") {
                tokio::spawn(answer_http(stream, head));
                continue;
            }
            *offered.lock().unwrap() = head
                .lines()
                .find_map(|line| line.strip_prefix("sec-websocket-protocol: "))
                .unwrap_or_default()
                .to_owned();
            tokio::spawn(async move {
                let mut socket = accept_async(stream).await.unwrap();
                let changed = Utf8Bytes::from_static(r#"{"type":"changed"}"#);
                socket.send(Message::Text(changed)).await.unwrap();
                let _ = socket.next().await;
            });
        }
    });
    port
}

#[tokio::test]
async fn the_live_socket_carries_the_token_and_the_changed_notice() {
    let offered = Arc::new(Mutex::new(String::new()));
    let port = stand_in(Arc::clone(&offered)).await;
    let store = ServerStore::connect(
        &format!("http://127.0.0.1:{port}/"),
        member_secrets([7; 32], [9; 32]),
        None,
        None,
    )
    .await
    .unwrap();

    let mut socket = store.live_socket().await.unwrap();
    let notice = socket.next().await.unwrap().unwrap();
    assert_eq!(
        notice,
        Message::Text(Utf8Bytes::from_static(r#"{"type":"changed"}"#))
    );
    assert_eq!(*offered.lock().unwrap(), "flow-sync.v1, bearer.t1");
}
