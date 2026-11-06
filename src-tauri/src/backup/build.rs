//! Builds a backup file's contents from a profile's database.

use std::collections::HashMap;
use std::path::Path;

use base64::Engine;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::backup::android_brain::{music_brain_to_android, user_brain_to_android};
use crate::backup::app_data::{AppDataParts, to_app_data};
use crate::backup::archive::{Archive, Slice};
use crate::commands::backup::{BackupExport, export_backup, get_setting_value, raw_settings};
use crate::flow_neuro::scoring::UserBrain;
use crate::music_brain::model::MusicBrain;
use crate::services::profile_service::ProfileService;
use crate::sync::apply::{MUSIC_BRAIN_KEY, NEURO_BRAIN_KEY};
use crate::sync::brain_rekey::align_flow;
use crate::sync::error::SyncError;
use crate::sync::merge::MergedFlowNeuroBrain;

#[must_use]
pub fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0).cast_unsigned()
}

fn iso_now(now: u64) -> String {
    chrono::DateTime::from_timestamp_millis(i64::try_from(now).unwrap_or(0))
        .unwrap_or_default()
        .to_rfc3339()
}

async fn stored_brain(pool: &SqlitePool) -> Result<Option<UserBrain>, SyncError> {
    let Some(raw) = get_setting_value(pool, NEURO_BRAIN_KEY).await? else {
        return Ok(None);
    };
    let Ok(mut brain) = serde_json::from_str::<UserBrain>(&raw) else {
        return Ok(None);
    };
    align_flow(Some(&mut brain), &mut MergedFlowNeuroBrain::default(), None);
    Ok(Some(brain))
}

async fn stored_music(pool: &SqlitePool) -> Result<Option<MusicBrain>, SyncError> {
    let Some(raw) = get_setting_value(pool, MUSIC_BRAIN_KEY).await? else {
        return Ok(None);
    };
    Ok(serde_json::from_str(&raw).ok())
}

fn desktop_section(export: &BackupExport, settings: &HashMap<String, String>, now: u64) -> Value {
    json!({
        "schemaVersion": 2,
        "app": { "name": "Flow", "version": env!("CARGO_PKG_VERSION") },
        "exportedAt": iso_now(now),
        "scope": export.scope,
        "settings": settings,
        "collections": export.collections,
        "deviceId": export.device_id,
    })
}

/// One profile's files. `scope` is `MASTER`, `APP_DATA` or `BRAIN`; each writes only what it covers.
pub async fn build_slice(
    pool: &SqlitePool,
    scope: &str,
    setting_keys: &[String],
    with_device_keys: bool,
    now: u64,
) -> Result<Slice, SyncError> {
    let export = export_backup(pool, scope).await?;
    let is_brain_only = scope == "BRAIN";
    let settings = if is_brain_only {
        HashMap::new()
    } else {
        raw_settings(pool, setting_keys, with_device_keys).await?
    };
    let brain = stored_brain(pool).await?;
    let content_preferences = if is_brain_only {
        None
    } else {
        brain.as_ref().map(|brain| {
            json!({
                "preferredTopics": brain.preferred_topics,
                "blockedTopics": brain.blocked_topics,
                "blockedChannels": brain.blocked_channels,
            })
        })
    };
    let app_data = to_app_data(AppDataParts {
        collections: &export.collections,
        settings: (!is_brain_only).then_some(&settings),
        content_preferences,
        desktop: desktop_section(&export, &settings, now),
        now_ms: now,
    });
    let with_brains = scope != "APP_DATA";
    Ok(Slice {
        app_data,
        engine: brain
            .filter(|_| with_brains)
            .map(|brain| user_brain_to_android(&brain)),
        music: stored_music(pool)
            .await?
            .filter(|_| with_brains)
            .map(|music| music_brain_to_android(&music)),
    })
}

/// A zip holding the running profile's brains, restorable as a master backup on either app.
pub async fn brain_archive(
    pool: &SqlitePool,
    with_device_keys: bool,
    now: u64,
) -> Result<Archive, SyncError> {
    Ok(Archive {
        root: build_slice(pool, "BRAIN", &[], with_device_keys, now).await?,
        manifest: None,
        profiles: Vec::new(),
        avatars: Vec::new(),
    })
}

/// Every profile: the running one through its live pool, the others from their closed databases.
pub async fn master_archive(
    pool: &SqlitePool,
    profiles: &ProfileService,
    setting_keys: &[String],
    now: u64,
) -> Result<Archive, SyncError> {
    let protocol = |error: crate::errors::AppError| SyncError::Protocol(error.to_string());
    let running = profiles.running_profile_id().map_err(protocol)?;
    let view = profiles.list().map_err(protocol)?;
    let mut root = None;
    let mut others = Vec::new();
    let mut included = Vec::new();
    for profile in &view.profiles {
        let is_default = profile.id == view.default_id;
        let slice = if profile.id == running {
            build_slice(pool, "MASTER", setting_keys, is_default, now).await?
        } else {
            let (closed, _) = profiles.open_closed(&profile.id).await.map_err(protocol)?;
            let slice = build_slice(&closed, "MASTER", setting_keys, is_default, now).await;
            closed.close().await;
            slice?
        };
        included.push(profile.id.clone());
        if is_default {
            root = Some(slice);
        } else {
            others.push((profile.id.clone(), slice));
        }
    }
    let root = root.ok_or_else(|| SyncError::Protocol("no default profile to back up".into()))?;
    let avatars = view
        .profiles
        .iter()
        .filter_map(|profile| {
            let photo = view.photos.get(&profile.id)?;
            let encoded = photo.split_once(',')?.1;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()?;
            Some((profile.id.clone(), bytes))
        })
        .collect();
    Ok(Archive {
        root,
        manifest: Some(json!({
            "format": "flow-master",
            "version": 1,
            "defaultId": view.default_id,
            "profiles": view.profiles,
            "included": included,
        })),
        profiles: others,
        avatars,
    })
}

/// Writes one backup to `path`, as a zip or as JSON by its scope. Callers flush the resident
/// brains first.
pub async fn write_backup(
    pool: &SqlitePool,
    profiles: &ProfileService,
    scope: &str,
    setting_keys: &[String],
    path: &Path,
) -> Result<(), SyncError> {
    let now = now_ms();
    let protocol = |error: crate::errors::AppError| SyncError::Protocol(error.to_string());
    let is_default = {
        let view = profiles.list().map_err(protocol)?;
        profiles.running_profile_id().map_err(protocol)? == view.default_id
    };
    let target = path.to_path_buf();
    let io_error = |error: std::io::Error| SyncError::Protocol(format!("backup write: {error}"));
    match scope {
        "APP_DATA" => {
            let slice = build_slice(pool, scope, setting_keys, is_default, now).await?;
            run_blocking(move || crate::backup::archive::write_json(&target, &slice.app_data))
                .await
                .map_err(io_error)
        }
        "BRAIN" => {
            let archive = brain_archive(pool, is_default, now).await?;
            run_blocking(move || crate::backup::archive::write_archive(&target, &archive))
                .await
                .map_err(io_error)
        }
        "MASTER" => {
            let archive = master_archive(pool, profiles, setting_keys, now).await?;
            run_blocking(move || crate::backup::archive::write_archive(&target, &archive))
                .await
                .map_err(io_error)
        }
        other => Err(SyncError::Protocol(format!(
            "unknown backup scope: {other}"
        ))),
    }
}

/// Compressing a whole history takes seconds, which must not hold up an async worker.
async fn run_blocking(
    work: impl FnOnce() -> std::io::Result<()> + Send + 'static,
) -> std::io::Result<()> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(std::io::Error::other)?
}
