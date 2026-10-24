use std::path::PathBuf;

use crate::errors::{AppError, ErrorResponse};

const MAX_BACKUP_BYTES: usize = 25 * 1024 * 1024;

#[tauri::command]
pub async fn write_backup_file(path: String, contents: String) -> Result<(), ErrorResponse> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err(ErrorResponse::from(AppError::Validation(
            "Backup path cannot be empty".into(),
        )));
    }

    if contents.len() > MAX_BACKUP_BYTES {
        return Err(ErrorResponse::from(AppError::Validation(
            "Backup file is too large".into(),
        )));
    }

    let path = PathBuf::from(trimmed_path);
    // Backups are JSON; an equalizer export is EqualizerAPO text.
    let is_allowed_path = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json") || ext.eq_ignore_ascii_case("txt"));
    if !is_allowed_path {
        return Err(ErrorResponse::from(AppError::Validation(
            "Export path must end in .json or .txt".into(),
        )));
    }

    let Some(parent) = path.parent() else {
        return Err(ErrorResponse::from(AppError::Validation(
            "Backup path must include a parent directory".into(),
        )));
    };

    if !parent.exists() || !parent.is_dir() {
        return Err(ErrorResponse::from(AppError::Validation(
            "Backup parent directory does not exist".into(),
        )));
    }

    tokio::fs::write(&path, contents)
        .await
        .map_err(|error| ErrorResponse::from(AppError::Internal(error.to_string())))?;

    Ok(())
}
