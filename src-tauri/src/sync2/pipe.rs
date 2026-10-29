//! How pairing messages travel (spec/protocol.md, Channel): through a store's mailbox, or over a
//! LAN WebSocket. Either way the scanner's ephemeral key goes first, in the clear.

use std::future::Future;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{Instant, timeout, timeout_at};
use tokio_tungstenite::{accept_async, connect_async};

use super::engine::{EngineError, Result};
use super::mailbox::Mailbox;
use super::paths::pair_message_name;
use crate::sync::qr::is_local_address;
use crate::sync::transport::{ClientStream, WsChannel, bind, lan_ip_candidates, ws_url};

const PAIR_PATH: &str = "/flow-sync/2/pair";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the shower waits after the last message for the scanner to close (spec/live.md).
const LINGER: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_secs(2);
pub const SLOT_LIFETIME: Duration = Duration::from_secs(180);
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
    /// The scanner's first step: its ephemeral public key.
    fn send_key(&mut self, key: [u8; KEY_SIZE]) -> impl Future<Output = Result<()>> + Send;
    /// The shower's first step: the scanner's key, which it needs to open anything.
    fn receive_key(&mut self) -> impl Future<Output = Result<[u8; KEY_SIZE]>> + Send;
    /// Ends pairing after the last message.
    fn close(&mut self) -> impl Future<Output = ()> + Send;
}

fn split_key(bytes: &[u8]) -> Result<([u8; KEY_SIZE], &[u8])> {
    let (key, rest) = bytes
        .split_first_chunk::<KEY_SIZE>()
        .ok_or(EngineError::Unexpected)?;
    Ok((*key, rest))
}

/// A slot of a store's pairing mailbox. The scanner's key is the prefix of its first message.
pub struct MailboxPipe<'m, M> {
    mailbox: &'m M,
    slot: String,
    /// Names this side writes and reads: `a` from the shower, `b` from the scanner.
    directions: (char, char),
    sent: u64,
    received: u64,
    prefix: Vec<u8>,
    pending: Option<Vec<u8>>,
}

impl<'m, M: Mailbox + Sync> MailboxPipe<'m, M> {
    pub fn new(mailbox: &'m M, slot: String, shower: bool) -> Self {
        Self {
            mailbox,
            slot,
            directions: if shower { ('a', 'b') } else { ('b', 'a') },
            sent: 0,
            received: 0,
            prefix: Vec::new(),
            pending: None,
        }
    }
}

impl<M: Mailbox + Sync> Pipe for MailboxPipe<'_, M> {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<()> {
        let name = pair_message_name(self.directions.0, self.sent);
        let message = [std::mem::take(&mut self.prefix), bytes].concat();
        self.mailbox.put_message(&self.slot, &name, message).await?;
        self.sent += 1;
        Ok(())
    }

    async fn receive(&mut self) -> Result<Vec<u8>> {
        if let Some(bytes) = self.pending.take() {
            return Ok(bytes);
        }
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

    fn send_key(&mut self, key: [u8; KEY_SIZE]) -> impl Future<Output = Result<()>> + Send {
        self.prefix = key.to_vec();
        std::future::ready(Ok(()))
    }

    async fn receive_key(&mut self) -> Result<[u8; KEY_SIZE]> {
        let first = self.receive().await?;
        let (key, rest) = split_key(&first)?;
        self.pending = Some(rest.to_vec());
        Ok(key)
    }

    fn close(&mut self) -> impl Future<Output = ()> + Send {
        std::future::ready(())
    }
}

/// A WebSocket to the other device on the same network. The scanner's key is its own first frame.
pub struct LanPipe<S> {
    socket: WsChannel<S>,
    shower: bool,
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

    async fn send_key(&mut self, key: [u8; KEY_SIZE]) -> Result<()> {
        self.send(key.to_vec()).await
    }

    async fn receive_key(&mut self) -> Result<[u8; KEY_SIZE]> {
        let frame = self.receive().await?;
        match split_key(&frame)? {
            (key, []) => Ok(key),
            _ => Err(EngineError::Unexpected),
        }
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
}

/// Whichever way the other device reached this one.
pub enum AnyPipe<'m, M, S> {
    Mailbox(MailboxPipe<'m, M>),
    Lan(LanPipe<S>),
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

    async fn send_key(&mut self, key: [u8; KEY_SIZE]) -> Result<()> {
        match self {
            Self::Mailbox(pipe) => pipe.send_key(key).await,
            Self::Lan(pipe) => pipe.send_key(key).await,
        }
    }

    async fn receive_key(&mut self) -> Result<[u8; KEY_SIZE]> {
        match self {
            Self::Mailbox(pipe) => pipe.receive_key().await,
            Self::Lan(pipe) => pipe.receive_key().await,
        }
    }

    async fn close(&mut self) {
        match self {
            Self::Mailbox(pipe) => pipe.close().await,
            Self::Lan(pipe) => pipe.close().await,
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
    /// Waits for one scanner and reads its key. Other connections stay unanswered.
    pub async fn accept(self) -> Result<(LanPipe<TcpStream>, [u8; KEY_SIZE])> {
        let deadline = Instant::now() + SLOT_LIFETIME;
        let (stream, _) = timeout_at(deadline, self.listener.accept())
            .await
            .map_err(|_| EngineError::TimedOut)?
            .map_err(crate::sync::error::SyncError::from)?;
        let socket = timeout_at(deadline, accept_async(stream))
            .await
            .map_err(|_| EngineError::TimedOut)?
            .map_err(crate::sync::error::SyncError::from)?;
        let mut pipe = LanPipe {
            socket: WsChannel::new(socket),
            shower: true,
        };
        let key = pipe.receive_key().await?;
        Ok((pipe, key))
    }
}

/// Dials the addresses a code lists, in order, each for a few seconds.
pub async fn dial(addresses: &[LanAddress]) -> Option<LanPipe<ClientStream>> {
    for address in addresses.iter().filter(|a| is_local_address(&a.a)) {
        let url = ws_url(&address.a, address.p, PAIR_PATH);
        if let Ok(Ok((socket, _))) = timeout(CONNECT_TIMEOUT, connect_async(url.as_str())).await {
            return Some(LanPipe {
                socket: WsChannel::new(socket),
                shower: false,
            });
        }
    }
    None
}
