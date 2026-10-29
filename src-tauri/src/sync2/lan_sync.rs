//! Two members meeting on the LAN (spec/live.md, LAN groups, Syncing): each pulls the roster, the
//! keys and the objects it lacks from the other, and holds them to serve in turn.

use std::collections::{BTreeMap, BTreeSet};

use sqlx::SqlitePool;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, connect_async};

use super::engine::{EngineError, Result, Session, signing_keys, verify_logged};
use super::held::{HeldStore, winning_chain};
use super::kdf::sha256;
use super::keys::MemberSecrets;
use super::lan_link::{Holder, Link, SESSION_PATH, hello_as_client, hello_as_server};
use super::paths::parse_log_path;
use super::roster::Entry;
use super::store::Store;
use crate::sync::transport::{WsChannel, ws_url};

/// The wraps and chain boxes each epoch has: one per device that was a member during it.
fn key_names(chain: &[Entry]) -> BTreeMap<u32, BTreeSet<String>> {
    let mut names: BTreeMap<u32, BTreeSet<String>> = BTreeMap::new();
    let mut epoch = 0;
    for entry in chain {
        if let Some(started) = &entry.epoch {
            epoch = started.n;
            let held = names.entry(epoch).or_default();
            held.extend(started.to.iter().cloned());
            if epoch > 0 {
                held.insert("chain".to_owned());
            }
        }
        for subject in entry.add.iter().flatten() {
            names.entry(epoch).or_default().insert(subject.did.clone());
        }
    }
    names
}

/// A blob path names the SHA-256 of its bytes.
fn is_blob_of(path: &str, bytes: &[u8]) -> bool {
    path.rsplit_once("/blob/")
        .and_then(|(_, file)| file.strip_suffix(".b"))
        .is_some_and(|name| name == hex::encode(sha256(bytes)))
}

/// Pulls what `held` lacks from the peer behind `link`, and returns how many objects it took.
pub async fn pull_from(held: &HeldStore, link: &Link, group: &[u8; 16]) -> Result<usize> {
    for entry in link.roster(held.highest_seq().await?).await? {
        held.hold_entry(&entry).await?;
    }
    let chain = winning_chain(&held.candidates_after(-1).await?);
    for (epoch, names) in key_names(&chain) {
        for name in names {
            if held.key(epoch, &name).await?.is_none()
                && let Some(bytes) = link.key(epoch, &name).await?
            {
                held.hold_key(epoch, &name, &bytes).await?;
            }
        }
    }

    let keys = signing_keys(&chain)?;
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
            && verify_logged(&bytes, group, &keys, &did, seq).is_ok()
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

/// Opens a session to a member at `address`:`port` and pulls from it. The session also serves
/// the member's requests until the pull is done.
pub async fn meet(
    pool: &SqlitePool,
    device: &MemberSecrets,
    address: &str,
    port: u16,
) -> Result<usize> {
    let (socket, _) = connect_async(ws_url(address, port, SESSION_PATH).as_str())
        .await
        .map_err(|_| EngineError::LanUnreachable)?;
    let held = HeldStore::new(pool.clone());
    let session = Session::open(pool, held.clone(), device).await?;
    let (framed, _) = hello_as_client(WsChannel::new(socket), &session, device).await?;
    let link = Link::spawn(framed, Holder::of(held.clone(), &session));
    pull_from(&held, &link, session.group()).await
}

/// Answers sessions from other members for as long as `listener` lives, pulling from each.
pub async fn serve(listener: TcpListener, pool: SqlitePool, device: MemberSecrets) {
    while let Ok((stream, _)) = listener.accept().await {
        let (pool, device) = (pool.clone(), device.clone());
        tokio::spawn(async move {
            if let Err(error) = answer(stream, &pool, &device).await {
                tracing::debug!(target: "flow::sync2", kind = error.kind(), "LAN session ended");
            }
        });
    }
}

async fn answer(
    stream: tokio::net::TcpStream,
    pool: &SqlitePool,
    device: &MemberSecrets,
) -> Result<usize> {
    let socket = accept_async(stream)
        .await
        .map_err(|_| EngineError::LanUnreachable)?;
    let held = HeldStore::new(pool.clone());
    let mut session = Session::open(pool, held.clone(), device).await?;
    let (framed, _) = hello_as_server(WsChannel::new(socket), &mut session, device).await?;
    let link = Link::spawn(framed, Holder::of(held.clone(), &session));
    pull_from(&held, &link, session.group()).await
}
