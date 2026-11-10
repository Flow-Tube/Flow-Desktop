//! The Cache rows in Settings.

use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::cache_usage::{
    CacheKind, artwork_cache_dirs, clear_network_cache, dir_size, hold_network_cache_to,
    network_cache_size, trim_oldest_files,
};
use crate::errors::{AppError, ErrorResponse};
use crate::profiles::local_state;

const MB: u64 = 1024 * 1024;

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, ErrorResponse> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(format!("No app data dir: {error}")).into())
}

fn lyrics_dir(app: &AppHandle) -> Result<PathBuf, ErrorResponse> {
    Ok(app_data_dir(app)?.join("lyrics"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheRow {
    pub kind: CacheKind,
    pub bytes: u64,
    pub limit_mb: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub rows: Vec<CacheRow>,
    /// The artwork cache empties at the next start, so its size won't change until then.
    pub artwork_clear_pending: bool,
}

#[tauri::command]
pub async fn cache_usage(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<CacheUsage, ErrorResponse> {
    let dir = app_data_dir(&app)?;
    let state = local_state::read(&dir).cache;
    let config = app.config();
    let artwork_dirs = artwork_cache_dirs(
        &config.identifier,
        config.product_name.as_deref().unwrap_or_default(),
    );
    let lyrics = lyrics_dir(&app)?;
    let (artwork, lyrics) = tokio::task::spawn_blocking(move || {
        let artwork: u64 = artwork_dirs.iter().map(|dir| dir_size(dir)).sum();
        (artwork, dir_size(&lyrics))
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?;
    let network = network_cache_size(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    let row = |kind, bytes| CacheRow {
        kind,
        bytes,
        limit_mb: state.limit_mb(kind),
    };
    Ok(CacheUsage {
        rows: vec![
            row(CacheKind::Artwork, artwork),
            row(CacheKind::Lyrics, lyrics),
            row(CacheKind::Network, network),
        ],
        artwork_clear_pending: state.artwork_clear_pending,
    })
}

#[tauri::command]
pub async fn clear_cache(
    kind: CacheKind,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    match kind {
        CacheKind::Artwork => {
            local_state::update(&app_data_dir(&app)?, |state| {
                state.cache.artwork_clear_pending = true;
            });
            Ok(())
        }
        CacheKind::Lyrics => match tokio::fs::remove_dir_all(lyrics_dir(&app)?).await {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(AppError::Internal(error.to_string()).into())
            }
            _ => Ok(()),
        },
        CacheKind::Network => clear_network_cache(&pool)
            .await
            .map_err(ErrorResponse::from),
    }
}

/// Saves a limit and holds the cache to it now where that can be done while Flow runs.
#[tauri::command]
pub async fn set_cache_limit(
    kind: CacheKind,
    limit_mb: u64,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    local_state::update(&app_data_dir(&app)?, |state| {
        state.cache.set_limit_mb(kind, limit_mb);
    });
    match kind {
        CacheKind::Artwork => {}
        CacheKind::Lyrics => {
            let dir = lyrics_dir(&app)?;
            tokio::task::spawn_blocking(move || {
                trim_oldest_files(&dir, limit_mb.saturating_mul(MB));
            })
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        }
        CacheKind::Network => hold_network_cache_to(&pool, limit_mb)
            .await
            .map_err(ErrorResponse::from)?,
    }
    Ok(())
}

/// At launch, after the database is open: the two caches that can be held to their limits while
/// Flow runs. Never holds up startup.
pub fn spawn_startup_trim(app: AppHandle, pool: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        let Ok(dir) = app_data_dir(&app) else {
            return;
        };
        let state = local_state::read(&dir).cache;
        let lyrics = dir.join("lyrics");
        let lyrics_limit = state.limit_mb(CacheKind::Lyrics).saturating_mul(MB);
        let trimmed =
            tokio::task::spawn_blocking(move || trim_oldest_files(&lyrics, lyrics_limit)).await;
        if let Err(error) = trimmed {
            tracing::debug!(%error, "[cache] lyrics trim did not finish");
        }
        if let Err(error) = hold_network_cache_to(&pool, state.limit_mb(CacheKind::Network)).await {
            tracing::debug!(%error, "[cache] could not hold the network cache to its limit");
        }
    });
}
