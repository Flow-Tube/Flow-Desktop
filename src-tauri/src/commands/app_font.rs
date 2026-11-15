//! The custom app font: one file kept in Flow's data folder, because a picked file's path may not
//! stay readable. It is never part of a backup; a profile that names it without the file falls
//! back to the system font.

use crate::errors::{AppError, ErrorResponse};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

/// Font files can be up to 10 MB, as on Android.
pub const MAX_FONT_BYTES: usize = 10 * 1024 * 1024;
const DIR: &str = "fonts";
const BASENAME: &str = "custom";
const INCOMING: &str = "incoming.tmp";

fn fonts_dir(app: &AppHandle) -> Result<PathBuf, ErrorResponse> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(DIR))
        .map_err(|error| {
            AppError::Internal(format!("Could not find Flow's data folder: {error}")).into()
        })
}

/// The extension a font file is kept under, from what its first bytes say it is.
#[must_use]
pub fn font_extension(bytes: &[u8]) -> Option<&'static str> {
    match bytes.get(..4)? {
        [0x00, 0x01, 0x00, 0x00] | b"true" => Some("ttf"),
        b"OTTO" => Some("otf"),
        _ => None,
    }
}

fn stored_font(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.is_file() && path.file_stem().is_some_and(|stem| stem == BASENAME))
}

/// Checks and stores a picked font, replacing the one before. The raw file is the request body.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments.
pub fn save_custom_font(app: AppHandle, request: Request<'_>) -> Result<(), ErrorResponse> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Validation("The font must be sent as raw bytes".into()).into());
    };
    if bytes.is_empty() || bytes.len() > MAX_FONT_BYTES {
        return Err(
            AppError::Validation("The font file is empty or larger than 10 MB".into()).into(),
        );
    }
    let Some(extension) = font_extension(bytes) else {
        return Err(
            AppError::Validation("The file is not a TrueType or OpenType font".into()).into(),
        );
    };
    let dir = fonts_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(AppError::from)?;
    let incoming = dir.join(INCOMING);
    std::fs::write(&incoming, bytes).map_err(AppError::from)?;
    if let Some(previous) = stored_font(&dir) {
        let _ = std::fs::remove_file(previous);
    }
    std::fs::rename(&incoming, dir.join(format!("{BASENAME}.{extension}"))).map_err(|error| {
        let _ = std::fs::remove_file(&incoming);
        AppError::from(error)
    })?;
    tracing::info!(bytes = bytes.len(), "custom app font saved");
    Ok(())
}

/// The stored font's bytes, or none when there is no file.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments.
pub fn read_custom_font(app: AppHandle) -> Result<Response, ErrorResponse> {
    let bytes = match stored_font(&fonts_dir(&app)?) {
        Some(path) => std::fs::read(path).map_err(AppError::from)?,
        None => Vec::new(),
    };
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_truetype_and_opentype() {
        assert_eq!(font_extension(&[0, 1, 0, 0, 9]), Some("ttf"));
        assert_eq!(font_extension(b"true...."), Some("ttf"));
        assert_eq!(font_extension(b"OTTO...."), Some("otf"));
    }

    #[test]
    fn rejects_other_files() {
        assert_eq!(font_extension(b"wOF2...."), None);
        assert_eq!(font_extension(b"\x89PNG"), None);
        assert_eq!(font_extension(b"ab"), None);
    }

    #[test]
    fn finds_the_stored_font_by_its_name() {
        let dir = std::env::temp_dir().join(format!("flow-font-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(INCOMING), b"x").unwrap();
        assert!(stored_font(&dir).is_none());
        std::fs::write(dir.join("custom.otf"), b"OTTO").unwrap();
        assert_eq!(stored_font(&dir), Some(dir.join("custom.otf")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
