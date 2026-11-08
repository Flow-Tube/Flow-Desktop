//! The transport rules every HTTP store follows (spec/store.md, Transport security): HTTPS
//! anywhere, plain HTTP only to a private address or a `.local` name, no redirects, and bounded
//! responses (Untrusted input).

use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use reqwest::{Client, ClientBuilder, Response, Url, redirect};

use super::server::{Result, StoreError};
use crate::sync::qr::is_local_ip;

/// The most a response other than an object or a blob may hold.
pub const MAX_RESPONSE: usize = 16 * 1024 * 1024;

/// Reads a body of at most `limit` bytes, failing as soon as more arrive.
pub async fn read_body(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(StoreError::Network)? {
        if body.len() + chunk.len() > limit {
            return Err(StoreError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// `is_local_ip` leaves out IPv6 link-local for QR codes, which can't carry a zone id; a store's
/// address can reach one, and `.local` names often resolve to one.
fn private_address(ip: IpAddr) -> bool {
    is_local_ip(ip) || matches!(ip, IpAddr::V6(v6) if link_local(v6))
}

fn link_local(ip: Ipv6Addr) -> bool {
    ip.segments()[0] & 0xffc0 == 0xfe80
}

pub struct Transport {
    /// A `.local` name over plain HTTP, checked and pinned so DNS can't move it afterwards.
    pinned: Option<(String, SocketAddr)>,
    /// A proxy would move a plain request, credentials included, off the checked address.
    direct: bool,
}

impl Transport {
    pub async fn for_url(url: &Url) -> Result<Self> {
        match url.scheme() {
            "https" => {
                return Ok(Self {
                    pinned: None,
                    direct: false,
                });
            }
            "http" => {}
            _ => return Err(StoreError::Insecure),
        }
        let host = url
            .host_str()
            .ok_or(StoreError::Insecure)?
            .trim_matches(['[', ']']);
        if host.parse::<IpAddr>().is_ok_and(private_address) {
            return Ok(Self {
                pinned: None,
                direct: true,
            });
        }
        if !host.to_ascii_lowercase().ends_with(".local") {
            return Err(StoreError::Insecure);
        }
        let port = url.port_or_known_default().unwrap_or(80);
        let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| StoreError::Insecure)?
            .collect();
        match addresses.first() {
            Some(first) if addresses.iter().all(|a| private_address(a.ip())) => Ok(Self {
                pinned: Some((host.to_owned(), *first)),
                direct: true,
            }),
            _ => Err(StoreError::Insecure),
        }
    }

    pub fn builder(&self) -> ClientBuilder {
        let builder = Client::builder()
            .tls_backend_rustls()
            .redirect(redirect::Policy::none())
            .user_agent(concat!("FlowDesktop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10));
        let builder = if self.direct {
            builder.no_proxy()
        } else {
            builder
        };
        match &self.pinned {
            Some((host, address)) => builder.resolve(host, *address),
            None => builder,
        }
    }

    /// A client for ordinary requests, each bounded to a minute.
    pub fn client(&self) -> Result<Client> {
        self.builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(StoreError::Network)
    }
}
