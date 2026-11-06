//! The folder library's commands. The webview names a file by its id, and folders are picked in
//! a native dialog opened from here, so it never hands the backend a path to read.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::db::{device, local_media as db};
use crate::errors::{AppError, AppResult, ErrorResponse};
use crate::local_media::scan::{ScanStatus, millis, resolved_folders};
use crate::local_media::scanner::LocalMediaScanner;
use crate::local_media::{FolderRole, LocalMediaFile, LocalMediaFolder, LocalMediaPlay, formats};
use crate::security::validation::{
    validate_library_file, validate_library_folder, validate_local_media_id,
};
use crate::streaming::proxy::StreamingManager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaLibrary {
    pub folders: Vec<LocalMediaFolder>,
    pub files: Vec<LocalMediaFile>,
    pub plays: Vec<LocalMediaPlay>,
    pub scan: ScanStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStreamInfo {
    pub url: String,
    pub content_type: String,
    pub title: String,
    pub artist: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub duration_seconds: f64,
    /// Where the last play of this file stopped.
    pub position_seconds: f64,
}

/// What the rows say is reachable: inside a chosen folder that exists, outside the excluded ones.
fn visible_files(
    files: Vec<LocalMediaFile>,
    folders: &[(String, FolderRole)],
) -> Vec<LocalMediaFile> {
    let roots = resolved_folders(folders, FolderRole::Include);
    let excludes = resolved_folders(folders, FolderRole::Exclude);
    files
        .into_iter()
        .filter(|file| {
            let path = Path::new(&file.path);
            roots.iter().any(|root| path.starts_with(root))
                && !excludes.iter().any(|folder| path.starts_with(folder))
        })
        .collect()
}

#[tauri::command]
pub async fn local_media_library(
    pool: State<'_, SqlitePool>,
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<LocalMediaLibrary, ErrorResponse> {
    let device_pool = device::pool(&pool);
    let folders = db::folders(device_pool).await?;
    let files = db::files(device_pool).await?;
    let plays = db::plays(&pool).await?;
    let scan = scanner.status();
    // Canonicalizing touches the disk, and a sleeping drive can take seconds to answer.
    let (folders, files) = tokio::task::spawn_blocking(move || {
        let files = visible_files(files, &folders);
        let folders = folders
            .into_iter()
            .map(|(path, role)| LocalMediaFolder {
                available: Path::new(&path).is_dir(),
                role: role.as_str().to_string(),
                path,
            })
            .collect();
        (folders, files)
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))
    .map_err(ErrorResponse::from)?;
    Ok(LocalMediaLibrary {
        folders,
        files,
        plays,
        scan,
    })
}

/// Asks the person for a folder and adds it. `None` when they cancel the dialog.
#[tauri::command]
pub async fn local_media_add_folder(
    title: String,
    exclude: bool,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<Option<String>, ErrorResponse> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .pick_folder(move |folder| {
            let _ = sender.send(folder);
        });
    let picked = receiver
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
        .map_err(ErrorResponse::from)?;
    let Some(picked) = picked.and_then(|folder| folder.into_path().ok()) else {
        return Ok(None);
    };
    let role = if exclude {
        FolderRole::Exclude
    } else {
        FolderRole::Include
    };
    let resolved = validate_library_folder(&picked)?;
    let path = resolved.to_string_lossy().into_owned();
    let device_pool = device::pool(&pool);
    db::add_folder(device_pool, &path, role, now_ms()).await?;
    scanner.request(app, device_pool.clone());
    Ok(Some(path))
}

#[tauri::command]
pub async fn local_media_remove_folder(
    path: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<(), ErrorResponse> {
    let device_pool = device::pool(&pool);
    db::remove_folder(device_pool, &path).await?;
    scanner.request(app, device_pool.clone());
    Ok(())
}

/// Hides a folder the library already lists. It can only ever narrow what is served, and only
/// a folder inside a chosen one is taken.
#[tauri::command]
pub async fn local_media_exclude_folder(
    path: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<(), ErrorResponse> {
    let device_pool = device::pool(&pool);
    let folders = db::folders(device_pool).await?;
    let roots = resolved_folders(&folders, FolderRole::Include);
    if !roots.iter().any(|root| Path::new(&path).starts_with(root)) {
        return Err(AppError::Validation("That folder isn't in your library".into()).into());
    }
    db::add_folder(device_pool, &path, FolderRole::Exclude, now_ms()).await?;
    scanner.request(app, device_pool.clone());
    Ok(())
}

#[tauri::command]
pub async fn local_media_rescan(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<(), ErrorResponse> {
    scanner.request(app, device::pool(&pool).clone());
    Ok(())
}

#[tauri::command]
pub async fn local_media_cancel_scan(
    scanner: State<'_, Arc<LocalMediaScanner>>,
) -> Result<(), ErrorResponse> {
    scanner.cancel();
    Ok(())
}

/// Saves how far a file played: the library's own history, which no engine and no sync reads.
#[tauri::command]
pub async fn local_media_report_playback(
    id: String,
    position_seconds: f64,
    duration_seconds: f64,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    validate_local_media_id(&id)?;
    db::record_play(
        &pool,
        &LocalMediaPlay {
            file_id: id,
            position_ms: seconds_to_ms(position_seconds),
            duration_ms: seconds_to_ms(duration_seconds),
            last_played_ms: now_ms(),
        },
    )
    .await?;
    Ok(())
}

/// Plays a library file through the same loopback path a download uses, with no network. Takes
/// an id only: the path comes from the index, and is checked again against the folders.
#[tauri::command]
pub async fn get_local_stream(
    id: String,
    pool: State<'_, SqlitePool>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<LocalStreamInfo, ErrorResponse> {
    validate_local_media_id(&id)?;
    let device_pool = device::pool(&pool);
    let file = db::file(device_pool, &id).await?.ok_or_else(|| {
        AppError::LocalFileMissing("This file isn't in the library any more".into())
    })?;
    let path = served_path(device_pool, &file.path).await?;
    let content_type = formats::content_type(&path).to_string();

    let token = Uuid::new_v4().to_string();
    streaming_manager.register_local_session(
        token.clone(),
        path.to_string_lossy().into_owned(),
        content_type.clone(),
    );
    let play = db::play(&pool, &id).await?;

    Ok(LocalStreamInfo {
        url: format!(
            "http://127.0.0.1:{}/stream/{token}",
            streaming_manager.get_port()
        ),
        content_type,
        title: file.title,
        artist: file.artist,
        video_codec: file.video_codec,
        audio_codec: file.audio_codec,
        duration_seconds: ms_to_seconds(file.duration_ms),
        position_seconds: play.map_or(0.0, |play| ms_to_seconds(play.position_ms)),
    })
}

/// The indexed path, resolved and checked against the folders as they are right now.
async fn served_path(device_pool: &SqlitePool, indexed: &str) -> AppResult<PathBuf> {
    let folders = db::folders(device_pool).await?;
    let indexed = PathBuf::from(indexed);
    tokio::task::spawn_blocking(move || {
        let roots = resolved_folders(&folders, FolderRole::Include);
        let excludes = resolved_folders(&folders, FolderRole::Exclude);
        validate_library_file(&indexed, &roots, &excludes, |file| {
            formats::kind_of(file).is_some()
        })
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?
}

fn now_ms() -> i64 {
    millis(std::time::SystemTime::now())
}

#[allow(clippy::cast_possible_truncation)] // Floats have no `TryFrom`, and `as` saturates, as wanted.
fn seconds_to_ms(seconds: f64) -> i64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds * 1000.0) as i64
    } else {
        0
    }
}

fn ms_to_seconds(ms: i64) -> f64 {
    ms as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_at(path: &str) -> LocalMediaFile {
        LocalMediaFile {
            id: "local_0123456789abcdef".into(),
            path: path.into(),
            folder_path: String::new(),
            kind: "audio".into(),
            title: "t".into(),
            file_name: "f".into(),
            artist: String::new(),
            album: String::new(),
            duration_ms: 0,
            size_bytes: 0,
            added_ms: 0,
            modified_ms: 0,
            width: 0,
            height: 0,
            frame_rate: None,
            bitrate_kbps: None,
            video_codec: String::new(),
            audio_codec: String::new(),
        }
    }

    #[test]
    fn a_folder_taken_off_the_list_stops_showing_its_files_at_once() {
        let dir = std::env::temp_dir().join(format!("flow-visible-{}", Uuid::new_v4()));
        let keep = dir.join("keep");
        let hidden = dir.join("keep/hidden");
        let other = dir.join("other");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let keep = std::fs::canonicalize(keep).unwrap();
        let hidden = std::fs::canonicalize(hidden).unwrap();
        let other = std::fs::canonicalize(other).unwrap();

        let files = vec![
            file_at(&keep.join("a.mp3").to_string_lossy()),
            file_at(&hidden.join("b.mp3").to_string_lossy()),
            file_at(&other.join("c.mp3").to_string_lossy()),
        ];
        let folders = vec![
            (keep.to_string_lossy().into_owned(), FolderRole::Include),
            (hidden.to_string_lossy().into_owned(), FolderRole::Exclude),
        ];
        let shown = visible_files(files, &folders);
        assert_eq!(shown.len(), 1);
        assert!(shown[0].path.ends_with("a.mp3"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_bad_position_saves_as_zero() {
        assert_eq!(seconds_to_ms(f64::NAN), 0);
        assert_eq!(seconds_to_ms(-1.0), 0);
        assert_eq!(seconds_to_ms(1.5), 1500);
    }
}
