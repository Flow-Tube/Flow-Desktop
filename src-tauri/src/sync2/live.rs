//! The live channel while the app is open (spec/live.md, Server relay): the server tells this
//! device when another one stored something, so it syncs within seconds instead of on the timer,
//! and relays live messages between the group's connected devices.

use std::collections::BTreeSet;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::{SinkExt, StreamExt};
use reqwest::StatusCode;
use reqwest::header::{CONNECTION, UPGRADE};
use serde::Deserialize;
use tauri::AppHandle;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::{Bytes, Message};

use super::actions::{local, stopped};
use super::engine::Result;
use super::live_hub::{announce, receive, set_server_online, subscribe};
use super::sealed::random_bytes;
use super::server::{self, ServerStore, StoreError};
use super::service::sync_after;
use super::state::{StoreKind, load_group};
use crate::sync::error::SyncError;

const PROTOCOL: &str = "flow-sync.v1";
const PING_EVERY: Duration = Duration::from_secs(15);
const RECONNECT_AFTER: Duration = Duration::from_secs(20);
/// Several devices may store at once: one sync shortly after covers them all.
const CHANGED_DELAY: Duration = Duration::from_secs(3);

/// A text frame from the server: `changed`, or `peers` with the devices connected.
#[derive(Deserialize)]
struct Notice {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    online: BTreeSet<String>,
}

impl ServerStore {
    /// Opens `GET /v1/live` with a fresh token. It goes over HTTP/1.1, which can be upgraded, and
    /// through the same client rules as every other request.
    pub async fn live_socket(&self) -> server::Result<WebSocketStream<reqwest::Upgraded>> {
        let token = self.token(true).await?;
        let key = STANDARD.encode(random_bytes::<16>());
        let response = self
            .live
            .get(self.url("v1/live")?)
            .header(CONNECTION, "Upgrade")
            .header(UPGRADE, "websocket")
            .header("sec-websocket-version", "13")
            .header("sec-websocket-key", &key)
            .header(
                "sec-websocket-protocol",
                format!("{PROTOCOL}, bearer.{token}"),
            )
            .send()
            .await
            .map_err(StoreError::Network)?;
        let accepted = response
            .headers()
            .get("sec-websocket-accept")
            .is_some_and(|accept| {
                accept.as_bytes() == derive_accept_key(key.as_bytes()).as_bytes()
            });
        if response.status() != StatusCode::SWITCHING_PROTOCOLS || !accepted {
            return Err(StoreError::Refused {
                status: response.status().as_u16(),
                code: "live".to_owned(),
            });
        }
        let upgraded = response.upgrade().await.map_err(StoreError::Network)?;
        Ok(WebSocketStream::from_raw_socket(upgraded, Role::Client, None).await)
    }
}

/// Keeps the live channel open for the app's lifetime while this device is in a server group.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = listen(&app).await {
                tracing::debug!(target: "flow::sync2", kind = error.kind(), "live channel closed");
            }
            tokio::time::sleep(RECONNECT_AFTER).await;
        }
    });
}

async fn listen(app: &AppHandle) -> Result<()> {
    let local = local(app).await?;
    let Some(record) = load_group(&local.pool).await? else {
        return Ok(());
    };
    if record.kind != StoreKind::Server || stopped(&local.pool).await?.is_some() {
        return Ok(());
    }
    let store = ServerStore::connect(
        &record.store_url,
        local.device.clone(),
        record.instance.clone(),
        Some(record.group_id.clone()),
    )
    .await?;
    let mut outgoing = subscribe(app);
    let mut socket = store.live_socket().await?;
    set_server_online(app, Some(BTreeSet::new()));
    announce(app).await?;
    let ended = relay(app, &mut socket, &mut outgoing).await;
    set_server_online(app, None);
    ended
}

async fn relay(
    app: &AppHandle,
    socket: &mut WebSocketStream<reqwest::Upgraded>,
    outgoing: &mut tokio::sync::broadcast::Receiver<Vec<u8>>,
) -> Result<()> {
    let mut ping = tokio::time::interval(PING_EVERY);
    loop {
        tokio::select! {
            message = socket.next() => match message {
                Some(Ok(Message::Text(text))) => match serde_json::from_str::<Notice>(&text) {
                    Ok(notice) if notice.kind == "changed" => sync_after(app, CHANGED_DELAY),
                    Ok(notice) if notice.kind == "peers" => {
                        set_server_online(app, Some(notice.online));
                    }
                    _ => {}
                },
                Some(Ok(Message::Binary(bytes))) => receive(app, &bytes).await,
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(SyncError::from(error).into()),
                None => return Ok(()),
            },
            sealed = outgoing.recv() => {
                // A lagging receiver skips what it missed; `now` is resent anyway.
                if let Ok(sealed) = sealed {
                    socket
                        .send(Message::Binary(sealed.into()))
                        .await
                        .map_err(SyncError::from)?;
                }
            }
            _ = ping.tick() => socket
                .send(Message::Ping(Bytes::new()))
                .await
                .map_err(SyncError::from)?,
        }
    }
}
