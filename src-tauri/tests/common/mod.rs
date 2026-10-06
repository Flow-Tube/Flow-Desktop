//! Helpers shared by the integration tests.

/// Loopback only: the client runs in-process, and listening on every interface (as the app's
/// `transport::bind` must) makes Windows ask for firewall access for each new test binary.
pub async fn bind_loopback() -> (tokio::net::TcpListener, u16) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}
