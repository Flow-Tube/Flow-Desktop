//! How pairing messages travel (spec/protocol.md, Channel): through a store's mailbox, or over a
//! LAN WebSocket. Either way two clear messages come first: the scanner's key with its proof, then
//! the shower's key.

use std::future::Future;
use std::net::IpAddr;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream::FuturesUnordered;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{Instant, timeout};
use tokio_tungstenite::{accept_async_with_config, connect_async_with_config};

use super::engine::{EngineError, Result};
use super::lan_link::lan_socket_config;
use super::mailbox::Mailbox;
use super::pairing::pairing_proof;
use super::paths::pair_message_name;
use crate::sync::qr::is_local_address;
use crate::sync::transport::{ClientStream, WsChannel, bind, lan_ip_candidates, ws_url};

const PAIR_PATH: &str = "/flow-sync/2/pair";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the shower waits after the last message for the scanner to close (spec/live.md).
const LINGER: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
pub const SLOT_LIFETIME: Duration = Duration::from_secs(180);
/// How long a LAN connection has to prove it read the code.
const FIRST_MESSAGE: Duration = Duration::from_secs(5);
/// LAN connections waited on at once, so silent ones can't hold up the real scanner.
const WAITING: usize = 8;
/// Addresses a code lists, best first, as many as FLOW-SYNC/1 codes carry.
const LAN_ADDRESSES: usize = 3;
pub const KEY_SIZE: usize = 32;

/// One entry of a code's `l`: where the device showing it listens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LanAddress {
    pub a: String,
    pub p: u16,
}

pub trait Pipe {
    fn send(&mut self, bytes: Vec<u8>) -> impl Future<Output = Result<()>> + Send;
    fn receive(&mut self) -> impl Future<Output = Result<Vec<u8>>> + Send;
    /// Ends pairing after the last message.
    fn close(&mut self) -> impl Future<Output = ()> + Send;
    /// The other device's address, when the pipe runs over the LAN.
    fn peer(&self) -> Option<String> {
        None
    }
}

/// The scanner's key, when `first` is that key followed by a proof that it read the code.
pub fn scanner_key(first: &[u8], token: &[u8; 16]) -> Option<[u8; KEY_SIZE]> {
    let (key, proof) = first.split_first_chunk::<KEY_SIZE>()?;
    bool::from(proof.ct_eq(&pairing_proof(token, key))).then_some(*key)
}

/// A slot of a store's pairing mailbox.
pub struct MailboxPipe<'m, M> {
    mailbox: &'m M,
    slot: String,
    /// Names this side writes and reads: `a` from the shower, `b` from the scanner.
    directions: (char, char),
    sent: u64,
    received: u64,
}

impl<'m, M: Mailbox + Sync> MailboxPipe<'m, M> {
    pub fn new(mailbox: &'m M, slot: String, shower: bool) -> Self {
        Self {
            mailbox,
            slot,
            directions: if shower { ('a', 'b') } else { ('b', 'a') },
            sent: 0,
            received: 0,
        }
    }

    /// The scanner's first message. After a wrong proof this path stays quiet until the slot ends,
    /// which leaves the LAN path open.
    pub async fn first_message(&mut self, token: &[u8; 16]) -> Result<[u8; KEY_SIZE]> {
        let deadline = Instant::now() + SLOT_LIFETIME;
        let first = self.receive().await?;
        if let Some(key) = scanner_key(&first, token) {
            return Ok(key);
        }
        tokio::time::sleep_until(deadline).await;
        Err(EngineError::TimedOut)
    }
}

impl<M: Mailbox + Sync> Pipe for MailboxPipe<'_, M> {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<()> {
        let name = pair_message_name(self.directions.0, self.sent);
        self.mailbox.put_message(&self.slot, &name, bytes).await?;
        self.sent += 1;
        Ok(())
    }

    async fn receive(&mut self) -> Result<Vec<u8>> {
        let name = pair_message_name(self.directions.1, self.received);
        let deadline = Instant::now() + SLOT_LIFETIME;
        loop {
            if let Some(bytes) = self.mailbox.get_message(&self.slot, &name).await? {
                self.received += 1;
                return Ok(bytes);
            }
            if Instant::now() >= deadline {
                return Err(EngineError::TimedOut);
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    fn close(&mut self) -> impl Future<Output = ()> + Send {
        std::future::ready(())
    }
}

/// A WebSocket to the other device on the same network.
pub struct LanPipe<S> {
    socket: WsChannel<S>,
    shower: bool,
    peer: Option<String>,
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> Pipe for LanPipe<S> {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<()> {
        Ok(self.socket.send_binary(bytes).await?)
    }

    async fn receive(&mut self) -> Result<Vec<u8>> {
        timeout(SLOT_LIFETIME, self.socket.recv_binary())
            .await
            .map_err(|_| EngineError::TimedOut)?
            .map_err(EngineError::from)
    }

    /// The shower waits a little for the scanner to close, so the last message isn't cut off.
    async fn close(&mut self) {
        if self.shower {
            let _ = timeout(LINGER, async {
                while self.socket.recv_binary().await.is_ok() {}
            })
            .await;
        }
        self.socket.close().await;
    }

    fn peer(&self) -> Option<String> {
        self.peer.clone()
    }
}

/// Whichever way the other device reached this one.
pub enum AnyPipe<'m, M, S> {
    Mailbox(MailboxPipe<'m, M>),
    Lan(Box<LanPipe<S>>),
}

impl<M, S> Pipe for AnyPipe<'_, M, S>
where
    M: Mailbox + Sync,
    S: AsyncRead + AsyncWrite + Unpin + Send,
{
    async fn send(&mut self, bytes: Vec<u8>) -> Result<()> {
        match self {
            Self::Mailbox(pipe) => pipe.send(bytes).await,
            Self::Lan(pipe) => pipe.send(bytes).await,
        }
    }

    async fn receive(&mut self) -> Result<Vec<u8>> {
        match self {
            Self::Mailbox(pipe) => pipe.receive().await,
            Self::Lan(pipe) => pipe.receive().await,
        }
    }

    async fn close(&mut self) {
        match self {
            Self::Mailbox(pipe) => pipe.close().await,
            Self::Lan(pipe) => pipe.close().await,
        }
    }

    fn peer(&self) -> Option<String> {
        match self {
            Self::Mailbox(_) => None,
            Self::Lan(pipe) => pipe.peer(),
        }
    }
}

/// Where this device listens while it shows a code.
pub struct Listening {
    listener: TcpListener,
    pub addresses: Vec<LanAddress>,
}

/// Listens on every interface, and lists the local addresses another device may reach. `None`
/// when this device has no LAN address.
pub async fn listen() -> Result<Option<Listening>> {
    let addresses: Vec<String> = lan_ip_candidates()
        .into_iter()
        .map(|c| c.ip)
        .filter(|ip| is_local_address(ip))
        .take(LAN_ADDRESSES)
        .collect();
    if addresses.is_empty() {
        return Ok(None);
    }
    listen_on(addresses).await.map(Some)
}

/// Listens on every interface, and lists `addresses` as where to reach this device.
pub async fn listen_on(addresses: Vec<String>) -> Result<Listening> {
    let (listener, port) = bind().await?;
    Ok(Listening {
        listener,
        addresses: addresses
            .into_iter()
            .map(|a| LanAddress { a, p: port })
            .collect(),
    })
}

impl Listening {
    /// Waits for a scanner that read the code and returns its key. Connections that don't prove
    /// that are dropped, and none is served after the one that does.
    pub async fn accept(self, token: &[u8; 16]) -> Result<(LanPipe<TcpStream>, [u8; KEY_SIZE])> {
        let waiting = async {
            let mut waiting = FuturesUnordered::new();
            loop {
                tokio::select! {
                    accepted = self.listener.accept(), if waiting.len() < WAITING => {
                        let (stream, peer) = accepted.map_err(crate::sync::error::SyncError::from)?;
                        waiting.push(timeout(FIRST_MESSAGE, first_message(stream, peer.ip(), token)));
                    }
                    Some(first) = waiting.next() => {
                        if let Ok(Some(found)) = first {
                            return Ok(found);
                        }
                    }
                }
            }
        };
        timeout(SLOT_LIFETIME, waiting)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }
}

async fn first_message(
    stream: TcpStream,
    peer: IpAddr,
    token: &[u8; 16],
) -> Option<(LanPipe<TcpStream>, [u8; KEY_SIZE])> {
    let socket = accept_async_with_config(stream, Some(lan_socket_config()))
        .await
        .ok()?;
    let mut pipe = LanPipe {
        socket: WsChannel::new(socket),
        shower: true,
        peer: Some(peer.to_string()),
    };
    let first = pipe.receive().await.ok()?;
    let key = scanner_key(&first, token)?;
    Some((pipe, key))
}

/// Dials the addresses a code lists, in order, each for a few seconds.
pub async fn dial(addresses: &[LanAddress]) -> Option<LanPipe<ClientStream>> {
    for address in addresses.iter().filter(|a| is_local_address(&a.a)) {
        let url = ws_url(&address.a, address.p, PAIR_PATH);
        if let Ok(Ok((socket, _))) = timeout(
            CONNECT_TIMEOUT,
            connect_async_with_config(url.as_str(), Some(lan_socket_config()), false),
        )
        .await
        {
            return Some(LanPipe {
                socket: WsChannel::new(socket),
                shower: false,
                peer: Some(address.a.clone()),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    proptest! {
        #[test]
        fn only_a_key_with_its_proof_is_a_first_message(
            key in any::<[u8; KEY_SIZE]>(),
            token in any::<[u8; 16]>(),
            extra in prop::collection::vec(any::<u8>(), 1..16),
        ) {
            let proof = pairing_proof(&token, &key);
            let good = [&key[..], &proof[..]].concat();
            prop_assert_eq!(scanner_key(&good, &token), Some(key));
            prop_assert_eq!(scanner_key(&key, &token), None);
            prop_assert_eq!(scanner_key(&[&good[..], &extra[..]].concat(), &token), None);
            let mut wrong = good;
            wrong[KEY_SIZE] ^= 1;
            prop_assert_eq!(scanner_key(&wrong, &token), None);
        }
    }
}
