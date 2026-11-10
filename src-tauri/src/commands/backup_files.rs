//! Commands for backup files on disk: export, read for restore, and the automatic schedule.

#![allow(clippy::doc_markdown)] // App names read as code to this lint.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::api::http::bounded_join;
use crate::api::innertube::extractors::resolve::ResolvedEndpoint;
use crate::api::original_title::original_title;
use crate::backup::archive::write_json;
use crate::backup::auto::{self, AutoBackupState, AutoBackupStatus};
use crate::backup::build::{now_ms, write_backup};
use crate::backup::exports;
use crate::backup::import::save::{ImportReport, save_found};
use crate::backup::import::{Found, ImportKind, read_import};
use crate::backup::reader::{BackupFile, ReadError, read_backup_file};
use crate::commands::backup::flush_brains;
use crate::errors::{AppError, ErrorResponse};
use crate::services::profile_service::ProfileService;
use crate::services::recommendation_service::RecommendationService;
use crate::services::youtube_service::YoutubeService;
use crate::sync::error::SyncError;

fn internal(error: impl std::fmt::Display) -> ErrorResponse {
    AppError::Internal(error.to_string()).into()
}

fn sync_err(error: SyncError) -> ErrorResponse {
    internal(error)
}

/// The path of a file the viewer chose in the save dialog, with the extension its kind requires.
fn save_path(path: &str, extension: &str) -> Result<PathBuf, ErrorResponse> {
    let path = PathBuf::from(path.trim());
    let matches = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension));
    let parent_exists = path.parent().is_some_and(std::path::Path::is_dir);
    if !path.is_absolute() || !matches || !parent_exists {
        return Err(AppError::Validation(format!(
            "backup path must be an absolute .{extension} path in an existing folder"
        ))
        .into());
    }
    Ok(path)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// Channels NewPipe couldn't open, left out of its file.
    pub skipped: usize,
}

/// Writes a backup or an export file where the viewer chose. A master or brain backup is a zip;
/// `settingKeys` is the schema's list of settings a backup may carry.
#[tauri::command]
pub async fn export_backup_file(
    kind: String,
    path: String,
    setting_keys: Vec<String>,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    profiles: State<'_, ProfileService>,
) -> Result<ExportResult, ErrorResponse> {
    match kind.as_str() {
        "MASTER" | "BRAIN" | "APP_DATA" => {
            let extension = if kind == "APP_DATA" { "json" } else { "zip" };
            let target = save_path(&path, extension)?;
            flush_brains(&app, false).await;
            write_backup(&pool, &profiles, &kind, &setting_keys, &target)
                .await
                .map_err(sync_err)?;
            Ok(ExportResult::default())
        }
        "WATCH_HISTORY" => {
            let target = save_path(&path, "json")?;
            let file = exports::watch_history(&pool).await.map_err(sync_err)?;
            write_json(&target, &file).map_err(internal)?;
            Ok(ExportResult::default())
        }
        "NEWPIPE_SUBSCRIPTIONS" => {
            let target = save_path(&path, "json")?;
            let (file, skipped) = exports::newpipe_subscriptions(&pool)
                .await
                .map_err(sync_err)?;
            write_json(&target, &file).map_err(internal)?;
            Ok(ExportResult { skipped })
        }
        other => Err(AppError::Validation(format!("unknown export: {other}")).into()),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReadBackup {
    Backup {
        data: Value,
    },
    Text {
        text: String,
    },
    /// Another app's backup; the page runs that app's import on it.
    External {
        kind: ImportKind,
    },
    /// A file that can't be read, by a reason the frontend words.
    Unreadable {
        reason: &'static str,
    },
}

/// Reads a picked file for the restore page: a Flow backup in the desktop's shape, whichever app
/// wrote it, or the text of a file for the format parsers.
#[tauri::command]
pub async fn read_backup(path: String) -> Result<ReadBackup, ErrorResponse> {
    let file =
        tokio::task::spawn_blocking(move || read_backup_file(&PathBuf::from(path), now_ms()))
            .await
            .map_err(internal)?;
    match file {
        Ok(BackupFile::Backup(data)) => Ok(ReadBackup::Backup { data }),
        Ok(BackupFile::Text(text)) => Ok(ReadBackup::Text { text }),
        Ok(BackupFile::External(kind)) => Ok(ReadBackup::External { kind }),
        Err(ReadError::TooLarge) => Ok(ReadBackup::Unreadable {
            reason: "too_large",
        }),
        Err(ReadError::NoBackup) => Ok(ReadBackup::Unreadable {
            reason: "no_backup",
        }),
        Err(error) => {
            tracing::warn!(%error, "[backup] could not read a backup file");
            Ok(ReadBackup::Unreadable { reason: "damaged" })
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ImportOutcome {
    Done {
        report: ImportReport,
    },
    /// Why nothing was imported, by a reason the frontend words.
    Failed {
        reason: &'static str,
    },
}

/// A handle stands in for its channel id until YouTube says which it is, and works as that if it
/// can't. An old `/user/` link doesn't, so one YouTube can't resolve is dropped. Unreachable YouTube
/// only costs what it can't look up.
async fn resolve_channel_links(found: &mut Found, youtube: &YoutubeService) {
    const AT_ONCE: usize = 5;
    let channels = std::mem::take(&mut found.channels);
    found.channels = bounded_join(channels, AT_ONCE, |mut channel| async move {
        let is_old_link = channel.id.starts_with("https://");
        if !is_old_link && !channel.id.starts_with('@') {
            return Some(channel);
        }
        let url = if is_old_link {
            channel.id.clone()
        } else {
            format!("https://www.youtube.com/{}", channel.id)
        };
        match youtube.resolve_url(&url).await {
            Ok(ResolvedEndpoint::Channel(id)) => {
                channel.id = id;
                Some(channel)
            }
            _ => (!is_old_link).then_some(channel),
        }
    })
    .await
    .into_iter()
    .flatten()
    .collect();
}

/// A playlist file holds bare video ids. The first of them get real titles from oEmbed; the rest,
/// and any lookup that fails, show the id until the video is opened, rather than an empty row.
async fn fill_blank_titles(found: &mut Found) {
    const AT_MOST: usize = 300;
    let mut wanted: Vec<String> = found
        .playlists
        .iter()
        .flat_map(|playlist| &playlist.tracks)
        .filter(|track| track.title.is_empty())
        .map(|track| track.video_id.clone())
        .collect();
    wanted.sort();
    wanted.dedup();
    wanted.truncate(AT_MOST);
    let titles: HashMap<String, String> = bounded_join(wanted, 4, |id| async move {
        original_title(&id).await.map(|title| (id, title))
    })
    .await
    .into_iter()
    .flatten()
    .collect();
    for track in found
        .playlists
        .iter_mut()
        .flat_map(|playlist| &mut playlist.tracks)
        .filter(|track| track.title.is_empty())
    {
        track.title = titles
            .get(&track.video_id)
            .cloned()
            .unwrap_or_else(|| track.video_id.clone());
    }
}

/// Runs one import from another app. `libraryName` is the worded name of the playlist the YouTube
/// Music library becomes. The engines learn only through the two bootstraps.
#[tauri::command]
pub async fn import_other_app(
    kind: ImportKind,
    paths: Vec<String>,
    library_name: String,
    pool: State<'_, SqlitePool>,
    youtube: State<'_, YoutubeService>,
    recommendations: State<'_, RecommendationService>,
) -> Result<ImportOutcome, ErrorResponse> {
    let paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let now = now_ms();
    let found = read_import(kind, &paths, &library_name, now).await;
    let mut found = match found {
        Ok(found) => found,
        Err(error) => {
            tracing::info!(reason = error.reason(), "[import] nothing imported");
            return Ok(ImportOutcome::Failed {
                reason: error.reason(),
            });
        }
    };
    resolve_channel_links(&mut found, &youtube).await;
    fill_blank_titles(&mut found).await;
    let saved = match save_found(&pool, &found, now).await {
        Ok(saved) => saved,
        Err(error) => {
            tracing::warn!(%error, "[import] could not save what was read");
            return Ok(ImportOutcome::Failed {
                reason: error.reason(),
            });
        }
    };
    if !saved.learn_from.is_empty()
        && let Err(error) = recommendations
            .bootstrap_from_history(saved.learn_from)
            .await
    {
        tracing::warn!(%error, "[import] the engine could not learn from the history");
    }
    if !saved.channel_names.is_empty()
        && let Err(error) = recommendations
            .bootstrap_from_subscriptions(saved.channel_names)
            .await
    {
        tracing::warn!(%error, "[import] the engine could not learn from the subscriptions");
    }
    Ok(ImportOutcome::Done {
        report: saved.report,
    })
}

/// Gives the schedule what only the frontend knows. Called once at launch; the worker starts then.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri hands a command its state by value.
pub fn auto_backup_register(
    setting_keys: Vec<String>,
    failure_title: String,
    state: State<'_, AutoBackupState>,
) {
    state.register(setting_keys, failure_title);
}

#[tauri::command]
pub async fn auto_backup_status(
    pool: State<'_, SqlitePool>,
    state: State<'_, AutoBackupState>,
) -> Result<AutoBackupStatus, ErrorResponse> {
    Ok(auto::status(&pool, &state).await)
}

/// Backs up into the chosen folder now. False when a backup is already running.
#[tauri::command]
pub async fn auto_backup_run_now(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    match auto::run_now(&app, &pool).await {
        None => Ok(false),
        Some(Ok(())) => Ok(true),
        Some(Err(error)) => Err(AppError::Validation(error).into()),
    }
}
