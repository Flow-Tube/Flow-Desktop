//! What the Profiles card under Linked devices shows and changes (spec/protocol.md, Profiles):
//! which local profiles sync which link, and the profiles other devices sync.

use std::collections::BTreeSet;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::actions::{local, state_pool};
use super::engine::{EngineError, Result};
use super::profile_links::{Reading, forget_link, link_profile, linked, reading, unlink};
use super::profile_names::{name_missing, records, set};
use super::service::{push_soon, sync_soon};
use super::state::{load_group, read_from_snapshot, save_group};
use crate::services::profile_service::ProfileService;
use crate::sync::error::SyncError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfile {
    pub id: String,
    /// The link it syncs, if any.
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedProfile {
    pub link: String,
    /// Blank when no device named it yet.
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProfiles {
    pub local: Vec<LocalProfile>,
    /// Profiles other devices sync that no local profile syncs.
    pub synced: Vec<SyncedProfile>,
    /// A restored device found several synced profiles, and Default joins the one the user picks.
    pub choose_for_default: bool,
}

/// The link the running profile syncs. Reads no keys, so local edits can ask it.
pub async fn running_link(app: &AppHandle) -> Result<Option<String>> {
    Ok(current(app).await?.and_then(|(reading, _)| reading.active))
}

/// The running profile's view of the links, and Default's id; `None` outside a group.
async fn current(app: &AppHandle) -> Result<Option<(Reading, String)>> {
    let pool = state_pool(app);
    let Some(record) = load_group(&pool).await? else {
        return Ok(None);
    };
    let profiles = app.state::<ProfileService>();
    let default = profiles.default_profile_id()?;
    let running = profiles.running_profile_id()?;
    let reading = reading(&pool, &record.link, &running, &default).await?;
    Ok(Some((reading, default)))
}

/// The linked profiles, once a group joined before profiles chose links has Default's.
async fn links_now(app: &AppHandle, pool: &sqlx::SqlitePool) -> Result<Vec<(String, String)>> {
    current(app).await?;
    Ok(linked(pool).await?)
}

async fn known_links(pool: &sqlx::SqlitePool) -> Result<Vec<String>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT link FROM sync2_links")
        .fetch_all(pool)
        .await
        .map_err(SyncError::from)?;
    Ok(rows
        .iter()
        .filter_map(|json| serde_json::from_str::<Option<String>>(json).ok().flatten())
        .collect())
}

pub async fn profiles(app: &AppHandle) -> Result<LinkedProfiles> {
    let pool = state_pool(app);
    if current(app).await?.is_none() {
        return Err(EngineError::NotLinked);
    }
    let links = linked(&pool).await?;
    let local = app
        .state::<ProfileService>()
        .profiles()?
        .into_iter()
        .map(|profile| LocalProfile {
            link: links
                .iter()
                .find(|(id, _)| *id == profile.id)
                .map(|(_, link)| link.clone()),
            id: profile.id,
        })
        .collect();
    let named = records(&pool).await?;
    let deleted: BTreeSet<&str> = named
        .iter()
        .filter(|r| r.deleted)
        .map(|r| r.link.as_str())
        .collect();
    let mut synced: Vec<SyncedProfile> = named
        .iter()
        .filter(|r| !r.deleted)
        .map(|r| SyncedProfile {
            link: r.link.clone(),
            name: r.name.clone(),
        })
        .collect();
    for link in known_links(&pool).await? {
        if !deleted.contains(link.as_str()) && synced.iter().all(|s| s.link != link) {
            synced.push(SyncedProfile {
                link,
                name: String::new(),
            });
        }
    }
    synced.retain(|s| links.iter().all(|(_, link)| *link != s.link));
    let restored = load_group(&pool)
        .await?
        .is_some_and(|record| record.link.is_empty());
    Ok(LinkedProfiles {
        choose_for_default: restored && links.is_empty() && synced.len() > 1,
        local,
        synced,
    })
}

fn name_of(app: &AppHandle, profile: &str) -> Result<String> {
    Ok(app
        .state::<ProfileService>()
        .profiles()?
        .into_iter()
        .find(|p| p.id == profile)
        .map(|p| p.name)
        .unwrap_or_default())
}

/// Syncs `profile`: under a link of its own, or joining `link`, another device's profile.
pub async fn sync_profile(app: &AppHandle, profile: &str, link: Option<&str>) -> Result<()> {
    let local = local(app).await?;
    let pool = &local.pool;
    let links = links_now(app, pool).await?;
    let link = link.unwrap_or(profile);
    if links.iter().any(|(id, l)| id == profile || l == link) {
        return Err(EngineError::ProfileTaken);
    }
    link_profile(pool, profile, link).await?;
    if link == profile {
        set(pool, &local.meta.app, link, &name_of(app, profile)?, false).await?;
    } else {
        read_from_snapshot(pool, link).await?;
    }
    sync_soon(app);
    Ok(())
}

/// Stops syncing `profile` on this device; its data stays.
pub async fn stop_profile(app: &AppHandle, profile: &str) -> Result<()> {
    let pool = state_pool(app);
    let links = links_now(app, &pool).await?;
    if links.iter().all(|(id, _)| id == profile) {
        return Err(EngineError::LastProfile);
    }
    unlink(&pool, profile).await?;
    Ok(())
}

/// Stops syncing `link` on every device; each keeps its data.
pub async fn delete_everywhere(app: &AppHandle, link: &str) -> Result<()> {
    let local = local(app).await?;
    let pool = &local.pool;
    let links = links_now(app, pool).await?;
    if links.iter().all(|(_, l)| l == link) {
        return Err(EngineError::LastProfile);
    }
    let name = records(pool)
        .await?
        .into_iter()
        .find(|r| r.link == link)
        .map(|r| r.name)
        .unwrap_or_default();
    set(pool, &local.meta.app, link, &name, true).await?;
    forget_link(pool, link).await?;
    sync_soon(app);
    Ok(())
}

/// A restored device's Default joins `link`, or starts a link of its own when `None`.
pub async fn choose_for_default(app: &AppHandle, link: Option<&str>) -> Result<()> {
    let pool = state_pool(app);
    let Some(mut record) = load_group(&pool).await? else {
        return Err(EngineError::NotLinked);
    };
    let default = app.state::<ProfileService>().default_profile_id()?;
    let link = link.unwrap_or(&default);
    link_profile(&pool, &default, link).await?;
    record.link = link.to_owned();
    save_group(&pool, &record).await?;
    sync_soon(app);
    Ok(())
}

/// A linked profile was renamed: its name goes to the other devices.
pub async fn renamed(app: &AppHandle, profile: &str, name: &str) -> Result<()> {
    let local = local(app).await?;
    let links = links_now(app, &local.pool).await?;
    let Some((_, link)) = links.iter().find(|(id, _)| id == profile) else {
        return Ok(());
    };
    set(&local.pool, &local.meta.app, link, name, false).await?;
    push_soon(app);
    Ok(())
}

/// A deleted profile stops syncing here.
pub async fn deleted(app: &AppHandle, profile: &str) -> Result<()> {
    Ok(unlink(&state_pool(app), profile).await?)
}

/// Names every link a local profile syncs that has no `profiles` record yet.
pub async fn name_linked(app: &AppHandle, pool: &sqlx::SqlitePool, device_id: &str) -> Result<()> {
    let profiles = app.state::<ProfileService>().profiles()?;
    let named: Vec<(String, String)> = linked(pool)
        .await?
        .into_iter()
        .filter_map(|(id, link)| {
            let profile = profiles.iter().find(|p| p.id == id)?;
            Some((link, profile.name.clone()))
        })
        .collect();
    Ok(name_missing(pool, device_id, &named).await?)
}

/// Whether the running profile's edits are recorded for sync: Default's always (FLOW-SYNC/1
/// syncs it), another profile's while it syncs a link.
pub async fn edits_sync(app: &AppHandle) -> bool {
    app.state::<crate::profiles::ActiveProfile>().is_default || syncs_link(app).await
}

/// Whether the running profile syncs a link; an unreadable group counts as no.
pub async fn syncs_link(app: &AppHandle) -> bool {
    matches!(running_link(app).await, Ok(Some(_)))
}
