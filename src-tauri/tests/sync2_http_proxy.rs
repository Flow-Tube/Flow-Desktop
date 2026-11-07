//! Plain HTTP goes only to the private address that was checked (spec/store.md, Transport
//! security). This test runs alone in its process because it sets the proxy environment reqwest
//! reads.

use std::time::Duration;

use flow_desktop_lib::sync2::webdav::{WebDav, WebDavLogin};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Answers one request with 404 and returns the first line it read.
async fn answer_one(listener: TcpListener) -> String {
    let (mut stream, _) = listener.accept().await.unwrap();
    let mut request = vec![0; 4096];
    let read = stream.read(&mut request).await.unwrap();
    let _ = stream
        .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
        .await;
    let text = String::from_utf8_lossy(&request[..read]);
    text.lines().next().unwrap_or_default().to_owned()
}

#[tokio::test]
async fn plain_http_to_a_private_address_skips_a_system_proxy() {
    let proxy = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let store = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let store_address = store.local_addr().unwrap();
    // Before any client is built; nothing else in this process reads the environment.
    unsafe {
        let address = proxy.local_addr().unwrap();
        std::env::set_var("HTTP_PROXY", format!("http://{address}"));
        std::env::set_var("http_proxy", format!("http://{address}"));
        std::env::remove_var("NO_PROXY");
        std::env::remove_var("no_proxy");
    }
    let through_proxy = tokio::spawn(answer_one(proxy));
    let reached_store = tokio::spawn(answer_one(store));

    let login = WebDavLogin {
        user: "flow".into(),
        password: "secret".into(),
    };
    let client = WebDav::connect(&format!("http://{store_address}/flow-sync/"), login)
        .await
        .unwrap();
    client.get("x").await.unwrap();

    assert!(
        !through_proxy.is_finished(),
        "the request went through the proxy"
    );
    let line = tokio::time::timeout(Duration::from_secs(5), reached_store).await;
    assert_eq!(
        line.expect("the store didn't get the request").unwrap(),
        "GET /flow-sync/x HTTP/1.1"
    );
}
