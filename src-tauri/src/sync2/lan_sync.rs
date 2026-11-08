//! Two members meeting on the LAN (spec/live.md, LAN groups, Syncing): each pulls the roster, the
//! keys and the objects it lacks from the other, and holds them to serve in turn.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::net::TcpListener;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::timeout;
use tokio_tungstenite::{accept_async_with_config, connect_async_with_config};

use super::engine::{EngineError, Result, Session, verify_logged};
use super::forks::ForkResolution;
use super::held::HeldStore;
use super::kdf::sha256;
use super::keys::MemberSecrets;
use super::lan_link::{
    Framed, HELLO_WITHIN, Holder, Link, LiveSink, SESSION_PATH, hello_as_client, hello_as_server,
    lan_socket_config,
};
use super::paths::parse_log_path;
use super::roster::{Entry, replay_roster};
use super::store::{Store, wraps_epoch};
use crate::sync::transport::{ClientStream, WsChannel, ws_url};

/// The wraps and chain boxes of `chain` and of the entries that lost and stand, as epoch, `<kc:16>`
/// and name: one wrap per device that was a member during an epoch.
fn key_names(resolved: &ForkResolution) -> Result<BTreeSet<(u32, String, String)>> {
    let mut names = BTreeSet::new();
    let mut add = |entry: &Entry, below: &[Entry]| -> Result<()> {
        let (epoch, kc) = wraps_epoch(entry, below)?;
        if let Some(field) = &entry.epoch {
            for did in &field.to {
                names.insert((epoch, kc.clone(), did.clone()));
            }
            if epoch > 0 {
                names.insert((epoch, kc.clone(), "chain".to_owned()));
            }
        }
        for subject in entry.add.iter().flatten() {
            names.insert((epoch, kc.clone(), subject.did.clone()));
        }
        Ok(())
    };
    for (index, entry) in resolved.chain.iter().enumerate() {
        add(entry, &resolved.chain[..index])?;
    }
    for entry in &resolved.standing {
        add(entry, &[])?;
    }
    Ok(names)
}

/// A blob path names the SHA-256 of its bytes.
fn is_blob_of(path: &str, bytes: &[u8]) -> bool {
    path.rsplit_once("/blob/")
        .and_then(|(_, file)| file.strip_suffix(".b"))
        .is_some_and(|name| name == hex::encode(sha256(bytes)))
}

/// Pulls what `held` lacks from the peer behind `link`, and returns how many objects it took.
pub async fn pull_from(held: &HeldStore, link: &Link, group: &[u8; 16]) -> Result<usize> {
    // From the start: an entry that lost can sit below this device's head, and its key still reads.
    for entry in link.roster(-1).await? {
        held.hold_entry(&entry).await?;
    }
    let resolved = held.resolved().await?;
    for (epoch, kc, name) in key_names(&resolved)? {
        if held.key(epoch, &kc, &name).await?.is_none()
            && let Some(bytes) = link.key(epoch, &kc, &name).await?
        {
            held.hold_key(epoch, &kc, &name, &bytes).await?;
        }
    }

    let senders = replay_roster(&resolved.chain)
        .map(|state| state.senders)
        .unwrap_or_default();
    let (paths, blobs) = link.list(held.held_vv().await?).await?;
    let mut taken = 0;
    for path in paths {
        let Some((did, seq)) = parse_log_path(&path) else {
            continue;
        };
        if held.get_object(&path).await?.is_some() {
            continue;
        }
        if let Some(bytes) = link.get(&path).await?
            && verify_logged(&bytes, group, &senders, &did, seq).is_ok()
        {
            held.put_object(&path, bytes).await?;
            taken += 1;
        }
    }
    for path in blobs {
        if held.get_object(&path).await?.is_none()
            && let Some(bytes) = link.get(&path).await?
            && is_blob_of(&path, &bytes)
        {
            held.put_object(&path, bytes).await?;
        }
    }
    Ok(taken)
}

/// How long dialing a member may take (spec/live.md, Discovery).
const CONNECT_WITHIN: Duration = Duration::from_secs(3);

/// How many epochs to try a member under, one lower each time (spec/live.md, Session).
const DIAL_ATTEMPTS: u32 = 4;

/// Connections that haven't proved themselves yet, beyond which new ones are closed at once, so
/// they can't use up this process's descriptors.
const HELLOS_AT_ONCE: usize = 16;

/// How soon to accept again after a failure such as running out of descriptors.
const ACCEPT_AGAIN: Duration = Duration::from_millis(100);

/// A session that ended: the member met, how many objects this device took from it, and where
/// the member can be reached for the next one, when known.
pub struct Met {
    pub peer: String,
    pub taken: usize,
    pub reach: Option<(String, u16)>,
}

/// Opens a session to a member at `address`:`port`, telling it the port this device `listening`
/// on, sends it the `live` envelopes, and pulls from it. The session also serves the member's
/// requests until the pull is done.
pub async fn meet(
    pool: &SqlitePool,
    device: &MemberSecrets,
    address: (&str, u16),
    listening: Option<u16>,
    live: &[Vec<u8>],
    sink: LiveSink,
) -> Result<Met> {
    let held = HeldStore::new(pool.clone());
    let mut session = Session::open_for_lan(pool, held.clone(), device).await?;
    let mut epoch = session.roster().epoch;
    for attempt in 1.. {
        let socket = dial(address).await?;
        let key = session.epoch_key(epoch).await?;
        match hello_as_client(socket, &session, device, (epoch, &key), listening).await {
            Err(EngineError::LanUnreachable) if attempt < DIAL_ATTEMPTS && epoch > 0 => epoch -= 1,
            hello => {
                let (framed, peer) = hello?;
                return pull_after_hello(framed, peer, &session, held, address, live, sink).await;
            }
        }
    }
    Err(EngineError::LanUnreachable)
}

/// [`meet`] as `session` sees the group, as a device that just appended its `leave` still does.
pub async fn meet_as<T: Store>(
    session: &Session<'_, T>,
    held: HeldStore,
    device: &MemberSecrets,
    (address, port): (&str, u16),
    listening: Option<u16>,
    live: &[Vec<u8>],
    sink: LiveSink,
) -> Result<Met> {
    let socket = dial((address, port)).await?;
    let current = (session.roster().epoch, session.current_key());
    let (framed, peer) = hello_as_client(socket, session, device, current, listening).await?;
    pull_after_hello(framed, peer, session, held, (address, port), live, sink).await
}

async fn dial((address, port): (&str, u16)) -> Result<WsChannel<ClientStream>> {
    let connect = connect_async_with_config(
        ws_url(address, port, SESSION_PATH),
        Some(lan_socket_config()),
        false,
    );
    match tokio::time::timeout(CONNECT_WITHIN, connect).await {
        Ok(Ok((socket, _))) => Ok(WsChannel::new(socket)),
        _ => Err(EngineError::LanUnreachable),
    }
}

async fn pull_after_hello<T: Store>(
    framed: Framed<ClientStream>,
    peer: String,
    session: &Session<'_, T>,
    held: HeldStore,
    (address, port): (&str, u16),
    live: &[Vec<u8>],
    sink: LiveSink,
) -> Result<Met> {
    let link = Link::spawn(framed, Holder::of(held.clone(), session, sink));
    for envelope in live {
        link.live(envelope.clone()).await?;
    }
    let taken = pull_from(&held, &link, session.group()).await?;
    Ok(Met {
        peer,
        taken,
        reach: Some((address.to_owned(), port)),
    })
}

/// Answers sessions from other members for as long as `listener` lives, pulling from each and
/// telling `met` about it.
pub async fn serve(
    listener: TcpListener,
    pool: SqlitePool,
    device: MemberSecrets,
    met: impl Fn(Met) + Clone + Send + 'static,
    sink: LiveSink,
) {
    let hellos = Arc::new(Semaphore::new(HELLOS_AT_ONCE));
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(ACCEPT_AGAIN).await;
            continue;
        };
        let Ok(hello) = Arc::clone(&hellos).try_acquire_owned() else {
            continue;
        };
        let (pool, device, met, sink) = (pool.clone(), device.clone(), met.clone(), sink.clone());
        tokio::spawn(async move {
            match answer(stream, hello, &pool, &device, sink).await {
                Ok(session) => met(session),
                Err(error) => {
                    tracing::debug!(target: "flow::sync2", kind = error.kind(), "LAN session ended");
                }
            }
        });
    }
}

async fn answer(
    stream: tokio::net::TcpStream,
    hello: OwnedSemaphorePermit,
    pool: &SqlitePool,
    device: &MemberSecrets,
    sink: LiveSink,
) -> Result<Met> {
    let address = stream.peer_addr().ok().map(|peer| peer.ip().to_string());
    let first_message = async {
        let socket = accept_async_with_config(stream, Some(lan_socket_config()))
            .await
            .map_err(|_| EngineError::LanUnreachable)?;
        let mut socket = WsChannel::new(socket);
        let first = socket.recv_binary().await?;
        Ok::<_, EngineError>((socket, first))
    };
    let (socket, first) = timeout(HELLO_WITHIN, first_message)
        .await
        .map_err(|_| EngineError::TimedOut)??;
    // Opening a session replays the roster, so a connection that says nothing doesn't cost that.
    let held = HeldStore::new(pool.clone());
    let mut session = Session::open_for_lan(pool, held.clone(), device).await?;
    let (framed, peer, listening) = hello_as_server(socket, &first, &mut session, device).await?;
    drop(hello);
    let link = Link::spawn(framed, Holder::of(held.clone(), &session, sink));
    let taken = pull_from(&held, &link, session.group()).await?;
    Ok(Met {
        peer,
        taken,
        reach: address.zip(listening),
    })
}
