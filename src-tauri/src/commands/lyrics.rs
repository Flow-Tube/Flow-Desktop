//! The lyrics disk cache, one `lyrics/<videoId>.json` file per song in app data as on Android,
//! and the synced lyrics written next to a downloaded song.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, ErrorResponse};
use crate::security::validation::validate_video_id;

type CmdResult<T> = Result<T, ErrorResponse>;

/// Far above any song's lyrics, so a bad write cannot fill the disk.
const MAX_LYRICS_BYTES: usize = 2 * 1024 * 1024;

fn cache_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(format!("No app data dir: {error}")))?
        .join("lyrics"))
}

fn cache_file(app: &AppHandle, video_id: &str) -> CmdResult<PathBuf> {
    validate_video_id(video_id).map_err(ErrorResponse::from)?;
    Ok(cache_dir(app)?.join(format!("{}.json", video_id.trim())))
}

fn check_size(text: &str) -> CmdResult<()> {
    if text.len() > MAX_LYRICS_BYTES {
        return Err(ErrorResponse::from(AppError::Validation(
            "Lyrics are too large".into(),
        )));
    }
    Ok(())
}

fn io_error(error: &std::io::Error) -> ErrorResponse {
    ErrorResponse::from(AppError::Internal(error.to_string()))
}

/// Writes through a temporary file, so a crash mid-write never leaves half a cache entry.
async fn write_atomically(path: &Path, text: &str) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| io_error(&e))?;
    }
    let partial = path.with_extension("json.partial");
    tokio::fs::write(&partial, text)
        .await
        .map_err(|e| io_error(&e))?;
    tokio::fs::rename(&partial, path)
        .await
        .map_err(|e| io_error(&e))
}

#[tauri::command]
pub async fn get_cached_lyrics(app: AppHandle, video_id: String) -> CmdResult<Option<String>> {
    let path = cache_file(&app, &video_id)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(&error)),
    }
}

#[tauri::command]
pub async fn put_cached_lyrics(app: AppHandle, video_id: String, entries: String) -> CmdResult<()> {
    check_size(&entries)?;
    let path = cache_file(&app, &video_id)?;
    write_atomically(&path, &entries).await
}

#[tauri::command]
pub async fn evict_cached_lyrics(app: AppHandle, video_id: String) -> CmdResult<()> {
    let path = cache_file(&app, &video_id)?;
    match tokio::fs::remove_file(&path).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_error(&error)),
        _ => Ok(()),
    }
}

async fn dir_size(dir: &Path) -> u64 {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };
    let mut total = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(metadata) = entry.metadata().await
            && metadata.is_file()
        {
            total += metadata.len();
        }
    }
    total
}

#[tauri::command]
pub async fn lyrics_cache_size(app: AppHandle) -> CmdResult<u64> {
    Ok(dir_size(&cache_dir(&app)?).await)
}

#[tauri::command]
pub async fn clear_lyrics_cache(app: AppHandle) -> CmdResult<()> {
    match tokio::fs::remove_dir_all(cache_dir(&app)?).await {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_error(&error)),
        _ => Ok(()),
    }
}

/// "Save lyrics as an .lrc file" for downloaded songs; on unless turned off.
const LYRICS_FILE_KEY: &str = "download_lyrics_file";

/// Writes the lyrics the provider chain found into a downloaded song's tags, and into
/// an `.lrc` file beside it when they are synced and the user wants the file.
#[tauri::command]
pub async fn save_download_lyrics(
    video_id: String,
    lrc: String,
    pool: State<'_, SqlitePool>,
) -> CmdResult<bool> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    check_size(&lrc)?;
    if lrc.trim().is_empty() {
        return Ok(false);
    }
    let Some(record) = crate::db::downloads::download_by_video_id(&pool, video_id.trim())
        .await
        .map_err(ErrorResponse::from)?
        .filter(|record| record.media_kind == "music" || record.media_kind == "audio")
    else {
        return Ok(false);
    };
    if tokio::fs::metadata(&record.file_path).await.is_err() {
        return Ok(false);
    }
    let media_path = Path::new(&record.file_path);
    let wants_file = crate::db::settings::get_setting(&pool, LYRICS_FILE_KEY)
        .await
        .ok()
        .flatten()
        .is_none_or(|value| value != "false");
    if wants_file && is_synced_lrc(&lrc) {
        tokio::fs::write(media_path.with_extension("lrc"), &lrc)
            .await
            .map_err(|e| io_error(&e))?;
    }
    if let Err(error) = crate::commands::downloads::embed_download_lyrics(media_path, lrc).await {
        tracing::warn!(video_id = %video_id, %error, "Could not embed lyrics into a download");
    }
    Ok(true)
}

/// True when the text has at least one `[mm:ss…]` time tag.
fn is_synced_lrc(text: &str) -> bool {
    text.lines().any(|line| {
        let Some(rest) = line.trim_start().strip_prefix('[') else {
            return false;
        };
        let mut parts = rest.splitn(2, ':');
        let minutes = parts.next().unwrap_or_default();
        let seconds = parts.next().unwrap_or_default();
        !minutes.is_empty()
            && minutes.chars().all(|c| c.is_ascii_digit())
            && seconds.chars().next().is_some_and(|c| c.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_timed_text_counts_as_synced() {
        assert!(is_synced_lrc("[ar:M83]\n[00:12.30]Waiting in a car"));
        assert!(!is_synced_lrc("[ar:M83]\nWaiting in a car"));
        assert!(!is_synced_lrc("Waiting in a car"));
    }

    #[tokio::test]
    async fn the_cache_size_counts_every_file() {
        let dir = std::env::temp_dir().join(format!("flow-lyrics-test-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&dir).await;
        assert_eq!(dir_size(&dir).await, 0);
        write_atomically(&dir.join("aaaaaaaaaaa.json"), "[1]")
            .await
            .unwrap();
        write_atomically(&dir.join("bbbbbbbbbbb.json"), "[12]")
            .await
            .unwrap();
        assert_eq!(dir_size(&dir).await, 7);
        assert!(!dir.join("aaaaaaaaaaa.json.partial").exists());
        tokio::fs::remove_dir_all(&dir).await.unwrap();
    }

    #[test]
    fn oversized_lyrics_are_refused() {
        assert!(check_size("x").is_ok());
        assert!(check_size(&"x".repeat(MAX_LYRICS_BYTES + 1)).is_err());
    }
}
