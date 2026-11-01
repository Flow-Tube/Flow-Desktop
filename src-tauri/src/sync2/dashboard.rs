//! What the Sync page's dashboard shows about the group: where it lives, the store's usage,
//! recent failures, and each synced profile's state on this device. Devices come from
//! [`super::actions::devices`].

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::AppHandle;

use super::actions::local;
use super::engine::{EngineError, Result};
use super::error_log::{LoggedError, recent};
use super::kept::kept_count;
use super::profile_links::linked;
use super::server::{ServerInfo, ServerStore};
use super::snapshot::own_snapshot_ms;
use super::state::{GroupRecord, StoreKind, load_group};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    pub used: u64,
    pub quota: u64,
    pub objects: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileState {
    pub profile: String,
    pub link: String,
    /// Batches waiting for the profile to run.
    pub kept: i64,
    /// When this device last wrote a snapshot of the link.
    pub own_snapshot_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub kind: StoreKind,
    /// The server or folder; `None` for a group on the LAN.
    pub store_url: Option<String>,
    /// What a Flow server speaks, when it answered.
    pub server: Option<ServerInfo>,
    /// A Flow server's usage, when it answered. Other stores aren't listed to measure it.
    pub storage: Option<Storage>,
    pub errors: Vec<LoggedError>,
    pub profiles: Vec<ProfileState>,
}

pub async fn dashboard(app: &AppHandle) -> Result<Dashboard> {
    let local = local(app).await?;
    let record = load_group(&local.pool)
        .await?
        .ok_or(EngineError::NotLinked)?;
    let (server, storage) = match record.kind {
        StoreKind::Server => server_state(&record, &local.device).await,
        StoreKind::WebDav | StoreKind::Lan => (None, None),
    };
    Ok(Dashboard {
        kind: record.kind,
        store_url: (record.kind != StoreKind::Lan).then(|| record.store_url.clone()),
        server,
        storage,
        errors: recent(&local.pool).await?,
        profiles: profile_states(&local.pool, &hex::encode(local.device.did)).await?,
    })
}

/// Best effort: the rest of the dashboard shows when the server can't be asked.
async fn server_state(
    record: &GroupRecord,
    device: &super::keys::MemberSecrets,
) -> (Option<ServerInfo>, Option<Storage>) {
    let Ok(store) = ServerStore::connect(
        &record.store_url,
        device.clone(),
        record.instance.clone(),
        Some(record.group_id.clone()),
    )
    .await
    else {
        return (None, None);
    };
    let storage = store.status().await.ok().map(|status| Storage {
        used: status.used,
        quota: status.quota,
        objects: status.objects,
    });
    (store.info().await.ok(), storage)
}

async fn profile_states(pool: &SqlitePool, me: &str) -> Result<Vec<ProfileState>> {
    let mut states = Vec::new();
    for (profile, link) in linked(pool).await? {
        states.push(ProfileState {
            kept: kept_count(pool, &link).await?,
            own_snapshot_ms: own_snapshot_ms(pool, me, &link).await?,
            profile,
            link,
        });
    }
    Ok(states)
}
