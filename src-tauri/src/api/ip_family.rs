//! The Prefer IPv4 setting: host names resolve to IPv4 addresses only, when the host has any.
//!
//! Some ISPs' IPv6 ranges are flagged by `YouTube`, so every video asks to confirm you're not
//! a bot until the network's IPv6 is switched off. Each client asks [`FamilyResolver`] on every new
//! connection, so one built before the setting loaded, or before the user changed it,
//! still follows it. A host with no IPv4 address keeps its IPv6 ones, so IPv6-only and
//! NAT64 networks still connect.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

pub const PREFER_IPV4_SETTING: &str = "network_prefer_ipv4";

static PREFER_IPV4: AtomicBool = AtomicBool::new(false);

/// Whether `key` is the Prefer IPv4 setting; if so, the new value is in force.
pub fn apply_setting(key: &str, value: Option<&str>) -> bool {
    if key != PREFER_IPV4_SETTING {
        return false;
    }
    let prefer_ipv4 = value.is_some_and(|value| value.eq_ignore_ascii_case("true"));
    if PREFER_IPV4.swap(prefer_ipv4, Ordering::Relaxed) != prefer_ipv4 {
        tracing::info!(prefer_ipv4, "network address preference changed");
    }
    true
}

/// The system resolver, narrowed to IPv4 while Prefer IPv4 is on.
pub struct FamilyResolver;

impl Resolve for FamilyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            // Port 0 is replaced by the URL's port, as with reqwest's own resolver.
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            let addrs = filter_family(addrs, PREFER_IPV4.load(Ordering::Relaxed));
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn filter_family(addrs: Vec<SocketAddr>, prefer_ipv4: bool) -> Vec<SocketAddr> {
    if !prefer_ipv4 || !addrs.iter().any(SocketAddr::is_ipv4) {
        return addrs;
    }
    addrs.into_iter().filter(SocketAddr::is_ipv4).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addrs(list: &[&str]) -> Vec<SocketAddr> {
        list.iter().map(|addr| addr.parse().unwrap()).collect()
    }

    #[test]
    fn keeps_every_address_when_off() {
        let mixed = addrs(&["[2001:db8::1]:0", "192.0.2.1:0"]);
        assert_eq!(filter_family(mixed.clone(), false), mixed);
    }

    #[test]
    fn keeps_only_ipv4_when_on() {
        let mixed = addrs(&[
            "[2001:db8::1]:0",
            "192.0.2.1:0",
            "[2001:db8::2]:0",
            "192.0.2.2:0",
        ]);
        assert_eq!(
            filter_family(mixed, true),
            addrs(&["192.0.2.1:0", "192.0.2.2:0"])
        );
    }

    #[test]
    fn falls_back_to_ipv6_when_the_host_has_no_ipv4() {
        let ipv6_only = addrs(&["[2001:db8::1]:0", "[64:ff9b::c000:201]:0"]);
        assert_eq!(filter_family(ipv6_only.clone(), true), ipv6_only);
        assert!(filter_family(Vec::new(), true).is_empty());
    }

    // One test, because the setting is process-wide.
    #[tokio::test]
    async fn a_client_built_before_the_setting_follows_it() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let client = reqwest::Client::builder()
            .dns_resolver(FamilyResolver)
            .build()
            .unwrap();
        assert!(!apply_setting("proxy_enabled", Some("true")));
        assert!(apply_setting(PREFER_IPV4_SETTING, Some("true")));

        let resolved: Vec<SocketAddr> = FamilyResolver
            .resolve("localhost".parse().unwrap())
            .await
            .unwrap()
            .collect();
        assert!(!resolved.is_empty());
        assert!(resolved.iter().all(SocketAddr::is_ipv4), "{resolved:?}");

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let response = client
            .get(format!("http://localhost:{port}/"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        server.await.unwrap();

        apply_setting(PREFER_IPV4_SETTING, Some("false"));
    }
}
