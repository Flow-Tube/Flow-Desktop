//! LAN sync while the app is open (spec/live.md, Discovery and LAN groups): answer sessions from
//! other members, advertise `_flow._tcp` with this hour's group tag, meet every member whose tag
//! matches, and carry live messages to the members met lately.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use super::actions::{Local, local};
use super::engine::{Result, Session, now_ms};
use super::epoch::{Purpose, purpose_key};
use super::held::HeldStore;
use super::lan::lan_tag;
use super::lan_link::LiveSink;
use super::lan_sync::{Met, meet, serve};
use super::live_hub::{receive, subscribe};
use super::sealed::random_bytes;
use super::service::sync_soon;
use super::state::{StoreKind, load_group};
use crate::sync::qr::is_local_ip;

const SERVICE_TYPE: &str = "_flow._tcp.local.";
const CHECK_EVERY: Duration = Duration::from_mins(1);
const MEET_EVERY_MS: i64 = 5 * 60 * 1000;
/// A member met this recently counts as on the same network.
const NEARBY_MS: i64 = 10 * 60 * 1000;

/// When this device last met each member on the LAN, and where it reached the ones it called.
#[derive(Default)]
pub struct LanPeers {
    seen: Mutex<BTreeMap<String, i64>>,
    addresses: Mutex<BTreeMap<String, (String, u16)>>,
}

/// When this device last met each member on the LAN.
pub fn met(app: &AppHandle) -> BTreeMap<String, i64> {
    app.state::<LanPeers>()
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

fn note(app: &AppHandle, met: &Met, address: Option<(String, u16)>) {
    let peers = app.state::<LanPeers>();
    if let Ok(mut seen) = peers.seen.lock() {
        seen.insert(met.peer.clone(), now_ms());
    }
    if let Some(address) = address
        && let Ok(mut addresses) = peers.addresses.lock()
    {
        addresses.insert(met.peer.clone(), address);
    }
    if met.taken > 0 {
        sync_soon(app);
    }
}

/// This hour's tag and the ones before and after it, for the group this device is in when it
/// meets members on the LAN: a LAN group, or a server group.
async fn group_tags(local: &Local) -> Result<Option<[String; 3]>> {
    match load_group(&local.pool).await? {
        Some(record) if matches!(record.kind, StoreKind::Lan | StoreKind::Server) => {}
        _ => return Ok(None),
    }
    let held = HeldStore::new(local.pool.clone());
    let session = Session::open_as_peer(&local.pool, held, &local.device).await?;
    let lan_key = purpose_key(
        session.current_key(),
        session.group(),
        session.roster().epoch,
        Purpose::Lan,
    );
    let now = u64::try_from(now_ms() / 1000).unwrap_or(0);
    Ok(Some(
        [now.saturating_sub(3600), now, now + 3600].map(|at| hex::encode(lan_tag(&lan_key, at))),
    ))
}

/// A member's service as last resolved, and when this device last met it.
struct Found {
    addresses: Vec<String>,
    port: u16,
    tag: String,
    met_ms: i64,
}

/// Hands live envelopes that arrive in LAN sessions to the live channel.
fn live_sink(app: &AppHandle) -> LiveSink {
    let app = app.clone();
    Arc::new(move |envelope| {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { receive(&app, &envelope).await });
    })
}

/// Runs for the app's lifetime in the Default profile.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app).await {
            tracing::warn!(target: "flow::sync2", kind = error.kind(), "LAN sync stopped");
        }
    });
}

/// Sends every live envelope this device seals to the members it met on the LAN lately, each
/// in a session of its own.
async fn deliver_live(app: AppHandle, local: Local) {
    let mut outgoing = subscribe(&app);
    loop {
        let envelope = match outgoing.recv().await {
            Ok(envelope) => envelope,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        };
        let near = nearby(&app);
        let addresses = app
            .state::<LanPeers>()
            .addresses
            .lock()
            .map(|addresses| addresses.clone())
            .unwrap_or_default();
        for (did, (address, port)) in addresses.into_iter().filter(|(did, _)| near.contains(did)) {
            let (app, local, envelope) = (app.clone(), local.clone(), envelope.clone());
            tokio::spawn(async move {
                let sink = live_sink(&app);
                let reached = (address.as_str(), port);
                if let Err(error) =
                    meet(&local.pool, &local.device, reached, &[envelope], sink).await
                {
                    tracing::debug!(target: "flow::sync2", kind = error.kind(), %did, "LAN live message not delivered");
                }
            });
        }
    }
}

async fn run(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    tokio::spawn(deliver_live(app.clone(), local.clone()));
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(crate::sync::error::SyncError::from)?;
    let port = listener
        .local_addr()
        .map_err(crate::sync::error::SyncError::from)?
        .port();
    let answered = app.clone();
    tokio::spawn(serve(
        listener,
        local.pool.clone(),
        local.device.clone(),
        move |met| note(&answered, &met, None),
        live_sink(app),
    ));

    let Ok(daemon) = ServiceDaemon::new() else {
        tracing::warn!(target: "flow::sync2", "mDNS is unavailable; LAN groups meet only when asked");
        return Ok(());
    };
    let instance = format!("Flow-{}", hex::encode(random_bytes::<2>()));
    let mut advertised: Option<(String, String)> = None;
    let events = daemon.browse(SERVICE_TYPE).ok();
    let mut found: BTreeMap<String, Found> = BTreeMap::new();
    let mut timer = tokio::time::interval(CHECK_EVERY);
    loop {
        let event = tokio::select! {
            _ = timer.tick() => None,
            event = async { events.as_ref()?.recv_async().await.ok() } => event,
        };
        let tags = group_tags(&local).await.unwrap_or(None);
        let current = tags.as_ref().map(|t| t[1].clone());
        if advertised.as_ref().map(|(_, tag)| tag) != current.as_ref() {
            if let Some((fullname, _)) = advertised.take() {
                let _ = daemon.unregister(&fullname);
            }
            if let Some(tag) = current {
                let properties = [("v", "2"), ("t", tag.as_str())];
                let host = format!("{instance}.local.");
                if let Ok(info) =
                    ServiceInfo::new(SERVICE_TYPE, &instance, &host, "", port, &properties[..])
                    && daemon.register(info.clone().enable_addr_auto()).is_ok()
                {
                    advertised = Some((info.get_fullname().to_owned(), tag));
                }
            }
        }
        if let Some(ServiceEvent::ServiceResolved(info)) = event
            && Some(info.get_fullname()) != advertised.as_ref().map(|(name, _)| name.as_str())
        {
            let addresses = info
                .get_addresses_v4()
                .into_iter()
                .filter(|ip| is_local_ip((*ip).into()))
                .map(|ip| ip.to_string())
                .collect();
            let met_ms = found.get(info.get_fullname()).map_or(0, |f| f.met_ms);
            found.insert(
                info.get_fullname().to_owned(),
                Found {
                    addresses,
                    port: info.get_port(),
                    tag: info
                        .get_property_val_str("t")
                        .unwrap_or_default()
                        .to_owned(),
                    met_ms,
                },
            );
        }
        let Some(tags) = tags else { continue };
        for member in found.values_mut().filter(|f| tags.contains(&f.tag)) {
            if now_ms() - member.met_ms < MEET_EVERY_MS {
                continue;
            }
            member.met_ms = now_ms();
            for address in &member.addresses {
                let reached = (address.as_str(), member.port);
                if let Ok(met) =
                    meet(&local.pool, &local.device, reached, &[], live_sink(app)).await
                {
                    note(app, &met, Some((address.clone(), member.port)));
                    break;
                }
            }
        }
    }
}
