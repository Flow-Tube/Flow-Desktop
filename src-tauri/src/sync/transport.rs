//! WebSocket transport for Flow Local Sync.
//!
//! The transport is **plaintext `ws://`** — confidentiality and integrity come from the AES-GCM
//! payload encryption (`crypto.rs`), which sidesteps the impossibility of trusted TLS certs for
//! ephemeral LAN IPs. This module only moves opaque binary frames; it knows nothing about their
//! contents.
//!
//! The host binds an ephemeral port and accepts one connection (it advertises its LAN IP + port
//! in the QR). The client connects to that address. [`WsChannel`] is generic over the stream so
//! the same code serves both the accepted `TcpStream` and the client's `MaybeTlsStream`.

#![allow(clippy::must_use_candidate)]

use std::net::IpAddr;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, accept_async, connect_async};

use crate::sync::error::SyncError;

/// A binary-message channel over a WebSocket. Text frames are ignored; pings are answered;
/// a close (or stream end) surfaces as [`SyncError::ConnectionClosed`].
pub struct WsChannel<S> {
    ws: WebSocketStream<S>,
}

impl<S> WsChannel<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    pub fn new(ws: WebSocketStream<S>) -> Self {
        Self { ws }
    }

    /// Send one binary message.
    pub async fn send_binary(&mut self, data: Vec<u8>) -> Result<(), SyncError> {
        self.ws.send(Message::Binary(data.into())).await?;
        Ok(())
    }

    /// Receive the next binary message, transparently answering pings and skipping text/pong.
    pub async fn recv_binary(&mut self) -> Result<Vec<u8>, SyncError> {
        loop {
            match self.ws.next().await {
                Some(Ok(Message::Binary(payload))) => return Ok(payload.to_vec()),
                Some(Ok(Message::Ping(p))) => {
                    self.ws.send(Message::Pong(p)).await?;
                }
                Some(Ok(Message::Close(_))) | None => return Err(SyncError::ConnectionClosed),
                Some(Ok(_)) => {} // ignore text / pong / raw frame
                Some(Err(e)) => return Err(e.into()),
            }
        }
    }

    /// Best-effort graceful close.
    pub async fn close(&mut self) {
        let _ = self.ws.close(None).await;
    }
}

/// Bind an ephemeral port on all interfaces. Returns the listener and the chosen port.
pub async fn bind() -> Result<(TcpListener, u16), SyncError> {
    let listener = TcpListener::bind("0.0.0.0:0").await?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

/// The fixed WebSocket path both platforms dial/serve.
pub const WS_PATH: &str = "/flow-sync";

/// Accept one inbound connection and complete the WebSocket handshake (host role). The request
/// path is not enforced (any path the peer dials is accepted), but we serve `/flow-sync`.
pub async fn accept(listener: &TcpListener) -> Result<WsChannel<TcpStream>, SyncError> {
    let (stream, addr) = listener.accept().await?;
    tracing::info!(target: "flow::sync::transport", peer = %addr, "accepted TCP connection; upgrading to WebSocket");
    let ws = accept_async(stream).await.map_err(|e| {
        tracing::warn!(target: "flow::sync::transport", peer = %addr, "WebSocket upgrade failed: {e}");
        SyncError::from(e)
    })?;
    Ok(WsChannel::new(ws))
}

/// Connect to a host and complete the WebSocket handshake (client role). Dials the fixed
/// `/flow-sync` path so a host that enforces the path accepts us.
pub async fn connect(
    ip: &str,
    port: u16,
) -> Result<WsChannel<MaybeTlsStream<TcpStream>>, SyncError> {
    let url = format!("ws://{ip}:{port}{WS_PATH}");
    tracing::info!(target: "flow::sync::transport", %url, "dialing host");
    let (ws, _resp) = connect_async(&url).await.map_err(|e| {
        tracing::warn!(target: "flow::sync::transport", %url, "WebSocket connect failed: {e}");
        SyncError::from(e)
    })?;
    Ok(WsChannel::new(ws))
}

/// Interface-name prefixes that mean "virtual, container, or VPN adapter". Matched on the start of
/// the lowercased name so `wg0-mullvad`, `tun0` and `utun3` are caught without false-positiving on
/// an arbitrary substring.
const VIRTUAL_IFACE_PREFIXES: [&str; 8] = ["tun", "tap", "utun", "wg", "ppp", "veth", "br-", "zt"];

/// Distinctive fragments that mean the same thing but can appear anywhere in the (often verbose)
/// Windows/macOS adapter name, e.g. `vEthernet (WSL)`.
const VIRTUAL_IFACE_SUBSTRINGS: [&str; 8] = [
    "docker",
    "virbr",
    "vboxnet",
    "vmnet",
    "tailscale",
    "vethernet",
    "mullvad",
    "wsl",
];

/// One candidate address for the QR, with the interface it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LanCandidate {
    pub interface: String,
    pub ip: String,
    /// True when the interface looks virtual/VPN — such an address is only ever a last resort.
    pub virtual_iface: bool,
}

fn is_virtual_iface(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    VIRTUAL_IFACE_PREFIXES.iter().any(|p| n.starts_with(p))
        || VIRTUAL_IFACE_SUBSTRINGS.iter().any(|s| n.contains(s))
}

/// How plausible this address is as "reachable from another device on the same LAN" — lower is
/// better. `None` rejects the address outright.
fn address_rank(name: &str, v4: std::net::Ipv4Addr) -> Option<u8> {
    if v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_multicast() {
        return None;
    }
    let o = v4.octets();
    let range_rank = match o {
        [192, 168, _, _] => 0,
        [10, ..] => 1,
        // Docker's default bridge (172.17/16) is demoted rather than rejected, so a host whose only
        // address really is in it still gets a QR.
        [172, 17, _, _] => 4,
        [172, b, _, _] if (16..=31).contains(&b) => 2,
        // CGNAT / Tailscale — routable for that overlay, almost never the LAN the phone is on.
        [100, b, _, _] if (64..=127).contains(&b) => 5,
        // A public address: unusual, but some networks hand them out on the same L2 segment.
        _ => 3,
    };
    // A physical interface always beats a virtual one, whatever the range: a VirtualBox host-only
    // 192.168.56.1 is unreachable, while a physical CGNAT address at least might work.
    Some(if is_virtual_iface(name) {
        8 + range_rank
    } else {
        range_rank
    })
}

/// Rank `interfaces` (as returned by [`local_ip_address::list_afinet_netifas`]) into QR candidates,
/// best first. Split out from [`lan_ip_candidates`] so the selection policy is testable without
/// real network interfaces.
///
/// Ordering matters because the winner is what the QR tells the phone to dial. The old "first
/// address that isn't loopback/link-local" rule handed out whatever the OS happened to enumerate
/// first, which with a VPN up is frequently the tunnel address (Mullvad allocates from `10.64/10`)
/// — an address that exists only inside the tunnel, so the phone's connection never arrives and the
/// desktop logs nothing at all (issue #41). Preference order mirrors Android's `LanAddress.resolve`
/// so both ends of a pair pick comparably.
pub fn rank_lan_candidates(interfaces: Vec<(String, IpAddr)>) -> Vec<LanCandidate> {
    let mut ranked: Vec<(u8, LanCandidate)> = interfaces
        .into_iter()
        .filter_map(|(name, ip)| {
            let IpAddr::V4(v4) = ip else { return None };
            let rank = address_rank(&name, v4)?;
            Some((
                rank,
                LanCandidate {
                    virtual_iface: is_virtual_iface(&name),
                    interface: name,
                    ip: v4.to_string(),
                },
            ))
        })
        .collect();
    // Stable, so equally-ranked addresses keep the OS enumeration order.
    ranked.sort_by_key(|(rank, _)| *rank);
    ranked.into_iter().map(|(_, c)| c).collect()
}

/// Every plausible LAN IPv4 on this host, best first — see [`rank_lan_candidates`].
pub fn lan_ip_candidates() -> Vec<LanCandidate> {
    local_ip_address::list_afinet_netifas()
        .map(rank_lan_candidates)
        .unwrap_or_default()
}

/// Best-effort LAN IPv4 for the QR code. See [`lan_ip_candidates`] for how the winner is chosen.
pub fn lan_ip() -> Option<String> {
    lan_ip_candidates().into_iter().next().map(|c| c.ip)
}
