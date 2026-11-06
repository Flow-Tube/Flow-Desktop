use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::commands::backup::sync_err;
use crate::db::notes::{self, NoteRow};
use crate::errors::{AppError, ErrorResponse};
use crate::services::notes_service::{self, NoteSubject};
use crate::sync2::profile_actions::edits_sync;
use crate::sync2::service::push_soon;

async fn announce(app: &AppHandle) {
    if edits_sync(app).await {
        push_soon(app);
    }
}

/// Every note this build can show, newest edit first.
#[tauri::command]
pub async fn list_notes(pool: State<'_, SqlitePool>) -> Result<Vec<NoteRow>, ErrorResponse> {
    let rows = notes::all(&pool)
        .await
        .map_err(|e| ErrorResponse::from(AppError::from(e)))?;
    Ok(rows
        .into_iter()
        .filter(|row| row.kind == "Video" || row.kind == "Channel")
        .collect())
}

#[tauri::command]
pub async fn save_note(
    app: AppHandle,
    kind: String,
    target_id: String,
    text: String,
    subject: Option<NoteSubject>,
    pool: State<'_, SqlitePool>,
) -> Result<Option<NoteRow>, ErrorResponse> {
    if !matches!(kind.as_str(), "Video" | "Channel") || target_id.trim().is_empty() {
        return Err(AppError::Validation("Unknown note target".into()).into());
    }
    let saved = notes_service::save_note(&pool, &kind, &target_id, &text, subject)
        .await
        .map_err(sync_err)?;
    announce(&app).await;
    Ok(saved)
}

#[tauri::command]
pub async fn delete_notes(
    app: AppHandle,
    ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    notes_service::delete_notes(&pool, &ids)
        .await
        .map_err(sync_err)?;
    announce(&app).await;
    Ok(())
}
