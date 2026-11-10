use std::path::PathBuf;

use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::errors::{AppError, ErrorResponse};

// A master backup carries every profile, each with its whole history.
const MAX_BACKUP_BYTES: usize = 200 * 1024 * 1024;
const MAX_LYRICS_BYTES: usize = 1024 * 1024;

/// A path the user picked in a save dialog, checked for its extension, size and folder.
fn checked_save_path(
    path: &str,
    contents: &str,
    extensions: &[&str],
    max_bytes: usize,
    what: &str,
) -> Result<PathBuf, ErrorResponse> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err(ErrorResponse::from(AppError::Validation(format!(
            "{what} path cannot be empty"
        ))));
    }

    if contents.len() > max_bytes {
        return Err(ErrorResponse::from(AppError::Validation(format!(
            "{what} file is too large"
        ))));
    }

    let path = PathBuf::from(trimmed_path);
    let has_extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            extensions
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        });
    if !has_extension {
        let names = extensions
            .iter()
            .map(|ext| format!(".{ext}"))
            .collect::<Vec<_>>()
            .join(" or ");
        return Err(ErrorResponse::from(AppError::Validation(format!(
            "{what} path must end in {names}"
        ))));
    }

    let Some(parent) = path.parent() else {
        return Err(ErrorResponse::from(AppError::Validation(format!(
            "{what} path must include a parent directory"
        ))));
    };

    if !parent.exists() || !parent.is_dir() {
        return Err(ErrorResponse::from(AppError::Validation(format!(
            "{what} parent directory does not exist"
        ))));
    }

    Ok(path)
}

async fn write_text(path: PathBuf, contents: String) -> Result<(), ErrorResponse> {
    tokio::fs::write(&path, contents)
        .await
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))
}

#[tauri::command]
pub async fn write_backup_file(path: String, contents: String) -> Result<(), ErrorResponse> {
    // Backups are JSON; an equalizer export is EqualizerAPO text.
    let path = checked_save_path(
        &path,
        &contents,
        &["json", "txt"],
        MAX_BACKUP_BYTES,
        "Export",
    )?;
    write_text(path, contents).await
}

/// Saves lyrics as an `.lrc` file where the user chose to put it.
#[tauri::command]
pub async fn write_lyrics_file(path: String, contents: String) -> Result<(), ErrorResponse> {
    let path = checked_save_path(&path, &contents, &["lrc"], MAX_LYRICS_BYTES, "Lyrics")?;
    write_text(path, contents).await
}

const MAX_IMAGE_BASE64_BYTES: usize = 40 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn decode_png(base64: &str) -> Result<Vec<u8>, ErrorResponse> {
    let not_valid = || ErrorResponse::from(AppError::Validation("Image data is not valid".into()));
    if base64.len() > MAX_IMAGE_BASE64_BYTES {
        return Err(not_valid());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|_| not_valid())?;
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(not_valid());
    }
    Ok(bytes)
}

/// Some platforms' dialogs don't add the filter's extension to a bare name.
fn png_path(path: PathBuf) -> Result<PathBuf, ErrorResponse> {
    match path.extension().and_then(|ext| ext.to_str()) {
        None => Ok(path.with_extension("png")),
        Some(ext) if ext.eq_ignore_ascii_case("png") => Ok(path),
        Some(_) => Err(ErrorResponse::from(AppError::Validation(
            "Image path must end in .png".into(),
        ))),
    }
}

/// Asks where to save the Recap poster and writes it there, returning whether it was saved. The
/// dialog opens here so the webview never names a path this command writes to.
#[tauri::command]
pub async fn save_recap_poster(
    base64: String,
    suggested_name: String,
    title: String,
    app: AppHandle,
) -> Result<bool, ErrorResponse> {
    let bytes = decode_png(&base64)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(suggested_name)
        .add_filter("PNG", &["png"])
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let picked = receiver
        .await
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    let Some(path) = picked.and_then(|path| path.into_path().ok()) else {
        return Ok(false);
    };
    tokio::fs::write(png_path(path)?, bytes)
        .await
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    #[test]
    fn only_png_bytes_pass() {
        let png = [PNG_SIGNATURE.as_slice(), b"rest"].concat();
        assert_eq!(decode_png(&STANDARD.encode(&png)).unwrap(), png);
        assert!(decode_png(&STANDARD.encode(b"#!/bin/sh")).is_err());
        assert!(decode_png("not base64!").is_err());
    }

    #[test]
    fn a_poster_only_lands_in_a_png_file() {
        assert_eq!(
            png_path(PathBuf::from("/a/poster")).unwrap(),
            PathBuf::from("/a/poster.png")
        );
        assert!(png_path(PathBuf::from("/a/poster.PNG")).is_ok());
        assert!(png_path(PathBuf::from("/a/poster.exe")).is_err());
    }
}
