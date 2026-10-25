use std::path::PathBuf;

use crate::errors::{AppError, ErrorResponse};

const MAX_BACKUP_BYTES: usize = 25 * 1024 * 1024;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_save_path_needs_its_extension_and_an_existing_folder() {
        let dir = std::env::temp_dir();
        let lrc = dir.join("song.lrc");
        let lrc = lrc.to_str().unwrap();
        assert!(checked_save_path(lrc, "[00:01.00]Line", &["lrc"], 10, "Lyrics").is_err());
        assert!(checked_save_path(lrc, "[00:01]", &["lrc"], 1024, "Lyrics").is_ok());
        assert!(checked_save_path(lrc, "x", &["json", "txt"], 1024, "Export").is_err());
        assert!(
            checked_save_path("/no/such/folder/song.lrc", "x", &["lrc"], 1024, "Lyrics").is_err()
        );
        assert!(checked_save_path("  ", "x", &["lrc"], 1024, "Lyrics").is_err());
    }
}
