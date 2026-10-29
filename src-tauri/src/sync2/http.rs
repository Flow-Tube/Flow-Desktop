//! The transport rules every HTTP store follows (spec/store.md, Transport security): HTTPS
//! anywhere, plain HTTP only to a private address or a `.local` name, and no redirects.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use reqwest::{Client, ClientBuilder, Url, redirect};

use super::server::{Result, StoreError};
use crate::sync::qr::is_local_ip;

pub struct Transport {
    /// A `.local` name over plain HTTP, checked and pinned so DNS can't move it afterwards.
    pinned: Option<(String, SocketAddr)>,
}

impl Transport {
    pub async fn for_url(url: &Url) -> Result<Self> {
        match url.scheme() {
            "https" => return Ok(Self { pinned: None }),
            "http" => {}
            _ => return Err(StoreError::Insecure),
        }
        let host = url
            .host_str()
            .ok_or(StoreError::Insecure)?
            .trim_matches(['[', ']']);
        if host.parse::<IpAddr>().is_ok_and(is_local_ip) {
            return Ok(Self { pinned: None });
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
            Some(first) if addresses.iter().all(|a| is_local_ip(a.ip())) => Ok(Self {
                pinned: Some((host.to_owned(), *first)),
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
