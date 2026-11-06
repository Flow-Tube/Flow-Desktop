//! The folder library's commands. The webview names a file by its id, and folders are picked in
//! a native dialog opened from here, so it never hands the backend a path to read.

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::db::{device, local_media as db};
use crate::errors::{AppError, AppResult, ErrorResponse};
use crate::local_media::bounds::LibraryBounds;
use crate::local_media::covers::cached_cover;
use crate::local_media::lyrics::{LocalLyrics, read_lyrics};
use crate::local_media::scan::{ScanStatus, millis, resolved_folders};
use crate::local_media::scanner::LocalMediaScanner;
use crate::local_media::subtitles::{SUBTITLE_EXTENSIONS, read_as_vtt, subtitles_for};
use crate::local_media::text::system_legacy_encoding;
use crate::local_media::{
    FolderRole, LocalMediaFile, LocalMediaFolder, LocalMediaPlay, MediaKind, formats,
};
use crate::models::video::CaptionTrack;
use crate::security::validation::{validate_library_folder, validate_local_media_id};
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
    pub lyrics: Option<LocalLyrics>,
    pub captions: Vec<CaptionTrack>,
}

/// Covers being read at once: decoding a large scan is real work, and a grid asks for many.
#[derive(Debug)]
pub struct LocalCoverLimit(tokio::sync::Semaphore);

impl Default for LocalCoverLimit {
    fn default() -> Self {
        Self(tokio::sync::Semaphore::new(2))
    }
}

const PICKED_TOKEN_OFFSET: usize = 1000;

/// What the rows say is reachable: inside a chosen folder that exists, outside the excluded ones.
fn visible_files(files: Vec<LocalMediaFile>, bounds: &LibraryBounds) -> Vec<LocalMediaFile> {
    files
        .into_iter()
        .filter(|file| bounds.contains(Path::new(&file.path)))
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
        let bounds = LibraryBounds::new(
            resolved_folders(&folders, FolderRole::Include),
            resolved_folders(&folders, FolderRole::Exclude),
        );
        let files = visible_files(files, &bounds);
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
    streaming_manager: State<'_, StreamingManager>,
) -> Result<(), ErrorResponse> {
    let device_pool = device::pool(&pool);
    db::remove_folder(device_pool, &path).await?;
    streaming_manager.revoke_local_sessions_under(Path::new(&path));
    scanner.request(app, device_pool.clone());
    Ok(())
}

/// Only a folder inside a chosen one can be hidden: hiding a chosen folder would turn it from
/// included to excluded, and everything in it would leave the library.
fn check_can_hide(path: &Path, roots: &[PathBuf]) -> AppResult<()> {
    if roots.iter().any(|root| path == root) {
        return Err(AppError::Validation(
            "This is a folder you chose. Remove it in Settings instead".into(),
        ));
    }
    if !roots.iter().any(|root| path.starts_with(root)) {
        return Err(AppError::Validation(
            "That folder isn't in your library".into(),
        ));
    }
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
    streaming_manager: State<'_, StreamingManager>,
) -> Result<(), ErrorResponse> {
    let device_pool = device::pool(&pool);
    let folders = db::folders(device_pool).await?;
    let roots = resolved_folders(&folders, FolderRole::Include);
    check_can_hide(Path::new(&path), &roots)?;
    db::add_folder(device_pool, &path, FolderRole::Exclude, now_ms()).await?;
    streaming_manager.revoke_local_sessions_under(Path::new(&path));
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
    let bounds = LibraryBounds::load(device_pool).await?;
    let path = served_path(&bounds, &file.path).await?;
    let content_type = formats::content_type(&path).to_string();

    let token = Uuid::new_v4().to_string();
    streaming_manager.register_local_session(
        token.clone(),
        path.to_string_lossy().into_owned(),
        content_type.clone(),
    );
    let play = db::play(&pool, &id).await?;
    let picks = db::subtitle_picks(device_pool, &id).await?;

    let is_video = file.kind == MediaKind::Video.as_str();
    let reading = path.clone();
    let (lyrics, subtitles) = tokio::task::spawn_blocking(move || {
        let legacy = system_legacy_encoding();
        if is_video {
            (None, video_subtitles(&reading, &bounds, &picks, legacy))
        } else {
            (read_lyrics(&reading, &bounds, legacy), Vec::new())
        }
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))
    .map_err(ErrorResponse::from)?;
    let captions = subtitles
        .into_iter()
        .enumerate()
        .map(|(index, subtitle)| caption_track(&streaming_manager, &id, index, subtitle))
        .collect();

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
        lyrics,
        captions,
    })
}

/// A subtitle read and converted, ready to serve.
struct LoadedSubtitle {
    label: String,
    language: String,
    vtt: String,
}

/// What a video's own folder offers, then what was picked for it.
fn video_subtitles(
    video: &Path,
    bounds: &LibraryBounds,
    picks: &[(String, String)],
    legacy: Option<&'static encoding_rs::Encoding>,
) -> Vec<LoadedSubtitle> {
    let found = subtitles_for(video, bounds)
        .into_iter()
        .map(|(path, language)| {
            let label = file_label(&path);
            (path, language, label)
        });
    let picked = picks
        .iter()
        .map(|(path, name)| (PathBuf::from(path), String::new(), name.clone()));
    let mut seen = std::collections::HashSet::new();
    found
        .chain(picked)
        .filter(|(path, ..)| seen.insert(path.clone()))
        .filter_map(|(path, language, label)| {
            read_as_vtt(&path, legacy).map(|vtt| LoadedSubtitle {
                label,
                language,
                vtt,
            })
        })
        .collect()
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// A file's id comes from its path, and the proxy answers any origin, so a token made from the id
/// alone could be worked out by a page that guesses the path. The salt lives only in this process.
fn session_token(file_id: &str, what: &str) -> String {
    static SALT: LazyLock<Uuid> = LazyLock::new(Uuid::new_v4);
    format!("{}-{file_id}-{what}", SALT.simple())
}

fn caption_track(
    streaming_manager: &StreamingManager,
    file_id: &str,
    index: usize,
    subtitle: LoadedSubtitle,
) -> CaptionTrack {
    // The same token per file and position, so replaying a video replaces its sessions.
    let token = session_token(file_id, &format!("subtitle-{index}"));
    streaming_manager.register_inline_session(
        token.clone(),
        subtitle.vtt.into_bytes(),
        "text/vtt".to_string(),
    );
    CaptionTrack {
        id: format!("{file_id}-{index}"),
        label: subtitle.label,
        language_code: subtitle.language,
        url: format!(
            "http://127.0.0.1:{}/stream/{token}",
            streaming_manager.get_port()
        ),
        is_auto_generated: false,
        is_translation: false,
    }
}

/// A loopback link to the file's cover on the image port, or `None` when it has none.
#[tauri::command]
pub async fn local_media_cover(
    id: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    limit: State<'_, LocalCoverLimit>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Option<String>, ErrorResponse> {
    validate_local_media_id(&id)?;
    let device_pool = device::pool(&pool);
    let Some(file) = db::file(device_pool, &id).await? else {
        return Ok(None);
    };
    let bounds = LibraryBounds::load(device_pool).await?;
    let Ok(path) = served_path(&bounds, &file.path).await else {
        return Ok(None);
    };
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Internal(error.to_string()))?
        .join("local_covers");
    let _permit = limit
        .0
        .acquire()
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let cover =
        tokio::task::spawn_blocking(move || cached_cover(&cache_dir, &file, &path, &bounds))
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(cover.map(|cover| {
        let token = session_token(&id, "cover");
        streaming_manager.register_local_session(
            token.clone(),
            cover.to_string_lossy().into_owned(),
            "image/jpeg".to_string(),
        );
        format!(
            "http://127.0.0.1:{}/stream/{token}",
            streaming_manager.get_image_port()
        )
    }))
}

/// Asks the person for a subtitle file for a video and keeps it for next time. The path comes
/// from the system's file dialog, never from the webview, so one chosen outside the library's
/// folders is still a file the person chose; only its converted text is ever served.
#[tauri::command]
pub async fn local_media_pick_subtitle(
    id: String,
    title: String,
    filter_name: String,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Option<CaptionTrack>, ErrorResponse> {
    validate_local_media_id(&id)?;
    let device_pool = device::pool(&pool);
    if db::file(device_pool, &id).await?.is_none() {
        return Err(
            AppError::LocalFileMissing("This file isn't in the library any more".into()).into(),
        );
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, &SUBTITLE_EXTENSIONS)
        .pick_file(move |file| {
            let _ = sender.send(file);
        });
    let picked = receiver
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
        .map_err(ErrorResponse::from)?;
    let Some(picked) = picked.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    let reading = picked.clone();
    let vtt = tokio::task::spawn_blocking(move || read_as_vtt(&reading, system_legacy_encoding()))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
        .map_err(ErrorResponse::from)?
        .ok_or_else(|| AppError::Validation("That subtitle file can't be read".into()))?;

    let name = file_label(&picked);
    let resolved = std::fs::canonicalize(&picked).unwrap_or(picked);
    db::add_subtitle_pick(
        device_pool,
        &id,
        &resolved.to_string_lossy(),
        &name,
        now_ms(),
    )
    .await?;
    // Past what the video's folder offers, so a replay's positions never reuse this token.
    let index = db::subtitle_picks(device_pool, &id).await?.len() + PICKED_TOKEN_OFFSET;
    Ok(Some(caption_track(
        &streaming_manager,
        &id,
        index,
        LoadedSubtitle {
            label: name,
            language: String::new(),
            vtt,
        },
    )))
}

/// Moves a library file to the system's trash. It can be put back from there.
#[tauri::command]
pub async fn local_media_trash(
    id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    validate_local_media_id(&id)?;
    let device_pool = device::pool(&pool);
    let file = db::file(device_pool, &id).await?.ok_or_else(|| {
        AppError::LocalFileMissing("This file isn't in the library any more".into())
    })?;
    let bounds = LibraryBounds::load(device_pool).await?;
    let path = served_path(&bounds, &file.path).await?;
    tokio::task::spawn_blocking(move || move_to_trash(&path))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
        .map_err(ErrorResponse::from)?
        .map_err(|error| {
            tracing::warn!(%error, file = %id, "moving a local file to the trash failed");
            AppError::Internal("Couldn't move that file to the trash".into())
        })?;
    db::remove_file(device_pool, &id).await?;
    Ok(())
}

fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut context = trash::TrashContext::default();
    // The default asks Finder over Apple Events, which needs a permission prompt of its own.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path)
}

/// The indexed path, resolved and checked against the folders as they are right now.
async fn served_path(bounds: &LibraryBounds, indexed: &str) -> AppResult<PathBuf> {
    let bounds = bounds.clone();
    let indexed = PathBuf::from(indexed);
    tokio::task::spawn_blocking(move || bounds.media_file(&indexed))
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
    fn only_a_folder_inside_a_chosen_one_can_be_hidden() {
        let roots = [PathBuf::from("/music")];
        assert!(check_can_hide(Path::new("/music/album"), &roots).is_ok());
        assert!(check_can_hide(Path::new("/music"), &roots).is_err());
        assert!(check_can_hide(Path::new("/videos"), &roots).is_err());
    }

    #[test]
    fn a_session_token_cant_be_worked_out_from_the_file_id() {
        let token = session_token("local_0123456789abcdef", "cover");
        assert_eq!(token, session_token("local_0123456789abcdef", "cover"));
        assert!(!token.starts_with("local_"));
        assert!(token.len() > "local_0123456789abcdef-cover".len() + 32);
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
        let shown = visible_files(files, &LibraryBounds::new(vec![keep], vec![hidden]));
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
