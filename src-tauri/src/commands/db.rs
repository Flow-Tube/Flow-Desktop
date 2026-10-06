use crate::db::settings;
use crate::db::watch_history::{self, WatchHistoryRecord};
use crate::errors::ErrorResponse;
use crate::sync::error::SyncError;
use crate::sync::local_edits;
use sqlx::SqlitePool;
use tauri::State;

#[tauri::command]
pub async fn get_watch_history(
    limit: i64,
    offset: i64,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_watch_history(&pool, limit, offset)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_history(
    limit: i64,
    offset: i64,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_music_history(&pool, limit, offset)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn add_watch_record(
    record: WatchHistoryRecord,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::upsert_watch_record(&pool, &record)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn add_watch_records_bulk(
    records: Vec<WatchHistoryRecord>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::upsert_watch_records_bulk(&pool, &records)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_watch_record(
    video_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    note_sync_failure(local_edits::record_watch_deletion(&pool, Some(&video_id)).await);
    watch_history::delete_watch_record(&pool, &video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_watch_history(pool: State<'_, SqlitePool>) -> Result<(), ErrorResponse> {
    note_sync_failure(local_edits::record_watch_deletion(&pool, None).await);
    watch_history::clear_watch_history(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_setting(
    key: String,
    pool: State<'_, SqlitePool>,
) -> Result<Option<String>, ErrorResponse> {
    settings::get_setting(&pool, &key)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn set_setting(
    key: String,
    value: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    note_sync_failure(local_edits::record_blob_write(&pool, &key, &value).await);
    settings::set_setting(&pool, &key, &value)
        .await
        .map_err(ErrorResponse::from)
}

/// Sync bookkeeping never blocks the user's own change; the worst case is that this one edit
/// syncs the way it did before this was recorded (a deletion a peer may undo).
fn note_sync_failure(result: Result<(), SyncError>) {
    if let Err(e) = result {
        tracing::warn!(target: "flow::sync::changes", error = %e, "could not record a local edit for sync");
    }
}
