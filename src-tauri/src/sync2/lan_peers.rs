//! The members this device meets on the LAN (spec/live.md, Discovery): when it last met each one,
//! and where it reached each one last, kept across launches so a member that mDNS can't find
//! (multicast dropped by the Wi-Fi) can still be dialed.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use super::engine::now_ms;
use super::lan_sync::Met;
use super::service::sync_soon;
use crate::db::settings::{get_setting, set_setting};

const ADDRESSES: &str = "sync2_lan_addresses";
const PORT: &str = "sync2_lan_port";
/// A member met this recently counts as on the same network.
const NEARBY_MS: i64 = 10 * 60 * 1000;

pub type Addresses = BTreeMap<String, (String, u16)>;

#[derive(Default)]
pub struct LanPeers {
    seen: Mutex<BTreeMap<String, i64>>,
    addresses: Mutex<Addresses>,
}

fn peers(app: &AppHandle) -> &LanPeers {
    app.state::<LanPeers>().inner()
}

/// When this device last met each member on the LAN.
pub fn met(app: &AppHandle) -> BTreeMap<String, i64> {
    peers(app)
        .seen
        .lock()
        .map(|seen| seen.clone())
        .unwrap_or_default()
}

/// The members met on the LAN in the last few minutes.
pub fn nearby(app: &AppHandle) -> BTreeSet<String> {
    let since = now_ms() - NEARBY_MS;
    met(app)
        .into_iter()
        .filter(|(_, at)| *at >= since)
        .map(|(did, _)| did)
        .collect()
}

/// Where each member was reached last.
pub fn addresses(app: &AppHandle) -> Addresses {
    peers(app)
        .addresses
        .lock()
        .map(|addresses| addresses.clone())
        .unwrap_or_default()
}

/// Records a session with a member, and syncs when it brought something.
pub fn note(app: &AppHandle, met: &Met) {
    let peers = peers(app);
    if let Ok(mut seen) = peers.seen.lock() {
        seen.insert(met.peer.clone(), now_ms());
    }
    if let Some(reach) = &met.reach
        && let Ok(mut addresses) = peers.addresses.lock()
    {
        addresses.insert(met.peer.clone(), reach.clone());
    }
    if met.taken > 0 {
        sync_soon(app);
    }
}

/// A member that couldn't be reached is no longer counted as on the network.
pub fn unreached(app: &AppHandle, did: &str) {
    if let Ok(mut seen) = peers(app).seen.lock() {
        seen.remove(did);
    }
}

/// Forgets everything about devices that are no longer `members`, as after a leave or a removal.
pub fn keep_only(app: &AppHandle, members: &BTreeSet<String>) {
    let peers = peers(app);
    if let Ok(mut seen) = peers.seen.lock() {
        seen.retain(|did, _| members.contains(did));
    }
    if let Ok(mut addresses) = peers.addresses.lock() {
        addresses.retain(|did, _| members.contains(did));
    }
}

/// Takes the addresses kept by the last launch.
pub async fn load_addresses(app: &AppHandle, pool: &SqlitePool) {
    let kept: Addresses = get_setting(pool, ADDRESSES)
        .await
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    if let Ok(mut addresses) = peers(app).addresses.lock() {
        addresses.extend(kept);
    }
}

/// Keeps the addresses for the next launch when they changed since `saved`.
pub async fn save_addresses(app: &AppHandle, pool: &SqlitePool, saved: &mut Addresses) {
    let now = addresses(app);
    if now != *saved
        && let Ok(json) = serde_json::to_string(&now)
        && set_setting(pool, ADDRESSES, &json).await.is_ok()
    {
        *saved = now;
    }
}

/// Listens on the port used last when it is free, so members that kept it still reach this device.
pub async fn listen(pool: &SqlitePool) -> std::io::Result<TcpListener> {
    let last = get_setting(pool, PORT)
        .await
        .ok()
        .flatten()
        .and_then(|port| port.parse::<u16>().ok());
    let reused = match last {
        Some(port) => TcpListener::bind(("0.0.0.0", port)).await.ok(),
        None => None,
    };
    let listener = match reused {
        Some(listener) => listener,
        None => TcpListener::bind("0.0.0.0:0").await?,
    };
    let port = listener.local_addr()?.port();
    if last != Some(port) {
        let _ = set_setting(pool, PORT, &port.to_string()).await;
    }
    Ok(listener)
}
