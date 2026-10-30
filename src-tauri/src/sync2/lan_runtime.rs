//! LAN sync while the app is open (spec/live.md, Discovery and LAN groups): answer sessions from
//! other members, advertise `_flow._tcp` with this hour's group tag, meet every member whose tag
//! matches or whose address this device kept, and carry live messages to the members met lately.

use std::collections::{BTreeMap, BTreeSet};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use mdns_sd::{DaemonEvent, Receiver, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};
use tauri::AppHandle;
use tokio::task::JoinSet;

use super::actions::{Local, local};
use super::device::DEVICE_KEYS;
use super::engine::{Result, Session, now_ms};
use super::epoch::{Purpose, purpose_key};
use super::held::HeldStore;
use super::keys::MemberSecrets;
use super::lan::lan_tag;
use super::lan_link::LiveSink;
use super::lan_peers::{
    addresses, keep_only, listen, load_addresses, met, nearby, note, save_addresses, unreached,
};
use super::lan_sync::{meet, serve};
use super::live_hub::{announce, changed, forget_keys, receive, subscribe};
use super::roster::Role;
use super::sealed::random_bytes;
use super::state::{StoreKind, load_group};
use crate::sync::qr::is_local_ip;

const SERVICE_TYPE: &str = "_flow._tcp.local.";
const CHECK_EVERY: Duration = Duration::from_mins(1);
const MEET_EVERY_MS: i64 = 5 * 60 * 1000;
/// How often a member not met lately is dialed at the address kept for it.
const DIAL_EVERY_MS: i64 = 60 * 1000;

/// The group this device meets members of on the LAN, a LAN group or a server group: this
/// hour's tag with the ones before and after it, and the group's other devices.
struct Meeting {
    tags: [String; 3],
    members: BTreeSet<String>,
}

async fn meeting(local: &Local) -> Result<Option<Meeting>> {
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
    let me = hex::encode(local.device.did);
    Ok(Some(Meeting {
        tags: [now.saturating_sub(3600), now, now + 3600]
            .map(|at| hex::encode(lan_tag(&lan_key, at))),
        members: session
            .roster()
            .members
            .iter()
            .filter(|(did, member)| member.role == Role::Device && **did != me)
            .map(|(did, _)| did.clone())
            .collect(),
    }))
}

/// A member's service as last resolved, and when this device last met it.
struct Found {
    addresses: Vec<String>,
    port: u16,
    tag: String,
    met_ms: i64,
}

/// This device on the LAN: its keys, and the port it listens on, which it tells the members it
/// dials.
struct Dialer<'a> {
    app: &'a AppHandle,
    local: &'a Local,
    port: u16,
}

impl Dialer<'_> {
    /// Meets the member at `address`, sending it `live`, and says whether it answered.
    async fn meet(&self, address: (&str, u16), live: &[Vec<u8>]) -> bool {
        let (pool, device) = (&self.local.pool, &self.local.device);
        let sink = live_sink(self.app);
        match meet(pool, device, address, Some(self.port), live, sink).await {
            Ok(met) => {
                note(self.app, &met);
                true
            }
            Err(error) => {
                tracing::debug!(target: "flow::sync2", kind = error.kind(), "LAN member not reached");
                false
            }
        }
    }

    /// Meets every member found over mDNS under one of `tags`, every few minutes.
    async fn meet_found(&self, found: &mut BTreeMap<String, Found>, tags: &[String; 3]) {
        for member in found.values_mut().filter(|f| tags.contains(&f.tag)) {
            if now_ms() - member.met_ms < MEET_EVERY_MS {
                continue;
            }
            member.met_ms = now_ms();
            for address in &member.addresses {
                if self.meet((address, member.port), &[]).await {
                    break;
                }
            }
        }
    }

    /// Dials the members not met since `since` at the address kept for each, at most once a
    /// minute each: mDNS may never find them on a network that drops multicast.
    async fn meet_kept(
        &self,
        members: &BTreeSet<String>,
        tried: &mut BTreeMap<String, i64>,
        since: i64,
    ) {
        let seen = met(self.app);
        for (did, (address, port)) in addresses(self.app) {
            let now = now_ms();
            if !members.contains(&did)
                || seen.get(&did).is_some_and(|at| *at >= since)
                || tried.get(&did).is_some_and(|at| now - at < DIAL_EVERY_MS)
            {
                continue;
            }
            tried.insert(did.clone(), now);
            if !self.meet((&address, port), &[]).await {
                unreached(self.app, &did);
            }
        }
    }
}

/// Hands live envelopes that arrive in LAN sessions to the live channel.
fn live_sink(app: &AppHandle) -> LiveSink {
    let app = app.clone();
    Arc::new(move |envelope| {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { receive(&app, &envelope).await });
    })
}

/// Runs for the app's lifetime in the Default profile, with the process's one mDNS daemon. A run
/// ends once this device's keys change for a new group, and starts again at once with them; one
/// that fails, for example on a locked keychain, starts again a minute later.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let daemon = ServiceDaemon::new().ok();
        if daemon.is_none() {
            tracing::warn!(target: "flow::sync2", "mDNS is unavailable; LAN members are met only at kept addresses");
        }
        loop {
            if let Err(error) = run(&app, daemon.as_ref()).await {
                tracing::warn!(target: "flow::sync2", kind = error.kind(), "LAN sync stopped");
                tokio::time::sleep(CHECK_EVERY).await;
            }
        }
    });
}

/// Whether this device has other keys than `device`: it created or joined a group.
fn renewed(device: &MemberSecrets) -> bool {
    DEVICE_KEYS
        .loaded()
        .is_some_and(|keys| keys.did != device.did)
}

/// The next event, `None` once its channel ended, and never without one.
async fn next_event<T>(events: Option<&Receiver<T>>) -> Option<T> {
    match events {
        Some(events) => events.recv_async().await.ok(),
        None => std::future::pending().await,
    }
}

/// Sends every live envelope this device seals to the members it met on the LAN lately, each
/// in a session of its own.
async fn deliver_live(app: AppHandle, local: Local, port: u16) {
    let mut outgoing = subscribe(&app);
    loop {
        let envelope = match outgoing.recv().await {
            Ok(envelope) => envelope,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        };
        let near = nearby(&app);
        for (did, (address, to)) in addresses(&app) {
            if !near.contains(&did) {
                continue;
            }
            let (app, local, envelope) = (app.clone(), local.clone(), envelope.clone());
            tokio::spawn(async move {
                let dialer = Dialer {
                    app: &app,
                    local: &local,
                    port,
                };
                if !dialer.meet((&address, to), &[envelope]).await {
                    unreached(&app, &did);
                }
            });
        }
    }
}

/// Advertises this device's service with `tag`, or withdraws it for `None`, unless `advertised`
/// (its full name and tag) already says so.
fn advertise(
    daemon: &ServiceDaemon,
    instance: &str,
    port: u16,
    advertised: &mut Option<(String, String)>,
    tag: Option<String>,
) {
    if advertised.as_ref().map(|(_, tag)| tag) == tag.as_ref() {
        return;
    }
    if let Some((fullname, _)) = advertised.take() {
        let _ = daemon.unregister(&fullname);
    }
    if let Some(tag) = tag {
        let properties = [("v", "2"), ("t", tag.as_str())];
        let host = format!("{instance}.local.");
        if let Ok(info) = ServiceInfo::new(SERVICE_TYPE, instance, &host, "", port, &properties[..])
            && daemon.register(info.clone().enable_addr_auto()).is_ok()
        {
            *advertised = Some((info.get_fullname().to_owned(), tag));
        }
    }
}

/// Keeps a resolved `_flow._tcp` service of another device.
fn record(found: &mut BTreeMap<String, Found>, info: &ResolvedService) {
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

/// Without the server's live socket the LAN is what makes "Play on" available: the page hears
/// when members come and go, and newcomers hear what this device is and plays.
async fn follow_nearby(app: &AppHandle, near: &mut BTreeSet<String>) {
    let now = nearby(app);
    if now == *near {
        return;
    }
    tracing::info!(target: "flow::sync2", members = now.len(), "LAN members nearby changed");
    changed(app);
    if !now.is_subset(near) {
        let _ = announce(app).await;
    }
    *near = now;
}

async fn run(app: &AppHandle, daemon: Option<&ServiceDaemon>) -> Result<()> {
    let local = local(app).await?;
    let listener = listen(&local.pool)
        .await
        .map_err(crate::sync::error::SyncError::from)?;
    let port = listener
        .local_addr()
        .map_err(crate::sync::error::SyncError::from)?
        .port();
    load_addresses(app, &local.pool).await;
    tracing::info!(target: "flow::sync2", "LAN sync started");
    // Dropped with the run, which aborts the tasks holding its keys.
    let mut tasks = JoinSet::new();
    tasks.spawn(deliver_live(app.clone(), local.clone(), port));
    let answered = app.clone();
    tasks.spawn(serve(
        listener,
        local.pool.clone(),
        local.device.clone(),
        move |met| note(&answered, &met),
        live_sink(app),
    ));

    let dialer = Dialer {
        app,
        local: &local,
        port,
    };
    let instance = format!("Flow-{}", hex::encode(random_bytes::<2>()));
    let mut advertised: Option<(String, String)> = None;
    let browse = || daemon.and_then(|daemon| daemon.browse(SERVICE_TYPE).ok());
    let mut events = browse();
    let mut network = daemon.and_then(|daemon| daemon.monitor().ok());
    let mut found: BTreeMap<String, Found> = BTreeMap::new();
    let mut near = nearby(app);
    let mut saved = addresses(app);
    let (mut tried, mut network_changed_at) = (BTreeMap::new(), 0);
    let mut timer = tokio::time::interval(CHECK_EVERY);
    loop {
        let event = tokio::select! {
            _ = timer.tick() => {
                if renewed(&local.device) {
                    break;
                }
                if events.is_none() {
                    events = browse();
                }
                None
            }
            event = next_event(events.as_ref()) => {
                // Browsing again waits for the next tick, so a browse that keeps ending can't spin.
                if event.is_none() {
                    events = None;
                }
                event
            }
            change = next_event(network.as_ref()) => match change {
                Some(DaemonEvent::IpAdd(IpAddr::V4(_))) => {
                    tracing::info!(target: "flow::sync2", "network changed; meeting LAN members again");
                    (tried, network_changed_at) = (BTreeMap::new(), now_ms());
                    None
                }
                Some(_) => continue,
                None => {
                    network = None;
                    continue;
                }
            },
        };
        let meeting = meeting(&local).await;
        if let Ok(meeting) = &meeting {
            keep_only(
                app,
                &meeting
                    .as_ref()
                    .map(|m| m.members.clone())
                    .unwrap_or_default(),
            );
        }
        let meeting = meeting.unwrap_or(None);
        if let Some(daemon) = daemon {
            let tag = meeting.as_ref().map(|m| m.tags[1].clone());
            advertise(daemon, &instance, port, &mut advertised, tag);
        }
        if let Some(ServiceEvent::ServiceResolved(info)) = event
            && Some(info.get_fullname()) != advertised.as_ref().map(|(name, _)| name.as_str())
        {
            record(&mut found, &info);
        }
        if let Some(meeting) = &meeting {
            dialer.meet_found(&mut found, &meeting.tags).await;
            let since = (now_ms() - MEET_EVERY_MS).max(network_changed_at);
            dialer.meet_kept(&meeting.members, &mut tried, since).await;
        }
        save_addresses(app, &local.pool, &mut saved).await;
        follow_nearby(app, &mut near).await;
    }
    if let Some(daemon) = daemon {
        advertise(daemon, &instance, port, &mut advertised, None);
    }
    // The live keys held were those of the group this device was in.
    forget_keys(app).await;
    Ok(())
}
