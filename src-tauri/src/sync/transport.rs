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

use std::future::Future;
use std::net::IpAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{Instant, Interval, MissedTickBehavior, interval_at};
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, accept_async, connect_async};

use crate::sync::error::SyncError;

/// How often we ping while waiting. Android's `OkHttp` client drops the link when its own 20 s ping
/// goes unanswered, and a peer that vanished without a close is only noticed through traffic.
const PING_EVERY: Duration = Duration::from_secs(15);

fn ping_timer() -> Interval {
    let mut timer = interval_at(Instant::now() + PING_EVERY, PING_EVERY);
    timer.set_missed_tick_behavior(MissedTickBehavior::Delay);
    timer
}

/// A binary-message channel over a WebSocket. Text frames are ignored; pings are answered;
/// a close (or stream end) surfaces as [`SyncError::ConnectionClosed`].
pub struct WsChannel<S> {
    ws: WebSocketStream<S>,
    /// A data frame that arrived during [`keepalive_while`](Self::keepalive_while), handed out by
    /// the next [`recv_binary`](Self::recv_binary).
    pending: Option<Vec<u8>>,
}

impl<S> WsChannel<S>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    pub fn new(ws: WebSocketStream<S>) -> Self {
        Self { ws, pending: None }
    }

    /// Send one binary message.
    pub async fn send_binary(&mut self, data: Vec<u8>) -> Result<(), SyncError> {
        self.ws.send(Message::Binary(data.into())).await?;
        Ok(())
    }

    /// Receive the next binary message, answering pings, skipping text/pong, and pinging the peer
    /// while it is quiet.
    pub async fn recv_binary(&mut self) -> Result<Vec<u8>, SyncError> {
        if let Some(data) = self.pending.take() {
            return Ok(data);
        }
        let mut ping = ping_timer();
        loop {
            tokio::select! {
                msg = self.ws.next() => {
                    if let Some(data) = self.handle(msg).await? {
                        return Ok(data);
                    }
                }
                _ = ping.tick() => self.ws.send(Message::Ping(Bytes::new())).await?,
            }
        }
    }

    /// Run `fut` (a consent prompt, a database apply) while keeping the socket alive: pings are
    /// answered and sent, and a data frame that arrives meanwhile is kept for the next read. Without
    /// this the peer sees a dead link whenever the user takes longer than its ping timeout.
    pub async fn keepalive_while<F: Future>(&mut self, fut: F) -> Result<F::Output, SyncError> {
        tokio::pin!(fut);
        let mut ping = ping_timer();
        loop {
            tokio::select! {
                out = &mut fut => return Ok(out),
                msg = self.ws.next(), if self.pending.is_none() => {
                    if let Some(data) = self.handle(msg).await? {
                        self.pending = Some(data);
                    }
                }
                _ = ping.tick() => self.ws.send(Message::Ping(Bytes::new())).await?,
            }
        }
    }

    async fn handle(
        &mut self,
        msg: Option<Result<Message, WsError>>,
    ) -> Result<Option<Vec<u8>>, SyncError> {
        match msg {
            Some(Ok(Message::Binary(payload))) => Ok(Some(payload.to_vec())),
            Some(Ok(Message::Ping(p))) => {
                self.ws.send(Message::Pong(p)).await?;
                Ok(None)
            }
            Some(Ok(Message::Close(_))) | None => Err(SyncError::ConnectionClosed),
            Some(Ok(_)) => Ok(None), // text / pong / raw frame
            Some(Err(e)) => Err(e.into()),
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

/// The stream under a client-side [`WsChannel`].
pub type ClientStream = MaybeTlsStream<TcpStream>;

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
pub async fn connect(ip: &str, port: u16) -> Result<WsChannel<ClientStream>, SyncError> {
    let host = if ip.contains(':') {
        format!("[{ip}]")
    } else {
        ip.to_string()
    };
    let url = format!("ws://{host}:{port}{WS_PATH}");
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
/// Windows/macOS adapter name, e.g. `vEthernet (WSL)`. Windows reports friendly names, so
/// VirtualBox's host-only adapter is "VirtualBox Host-Only Network" rather than `vboxnet0`, and
/// ZeroTier's is "ZeroTier One [...]" rather than `zt...`.
const VIRTUAL_IFACE_SUBSTRINGS: [&str; 17] = [
    "docker",
    "virbr",
    "vboxnet",
    "virtualbox",
    "host-only",
    "vmnet",
    "vmware",
    "hyper-v",
    "tailscale",
    "vethernet",
    "mullvad",
    "wsl",
    "zerotier",
    "hamachi",
    "radmin",
    "nordlynx",
    "wireguard",
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
