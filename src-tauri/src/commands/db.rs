use crate::api::app_proxy;
use crate::api::innertube::core::{locale, remote_decoder};
use crate::api::innertube::extractors::audio_preference;
use crate::commands::linked::err as linked_err;
use crate::db::settings;
use crate::db::watch_history::{self, WatchHistoryRecord};
use crate::errors::ErrorResponse;
use crate::sync::error::SyncError;
use crate::sync::local_edits;
use crate::sync2::actions::{leave_if_linked, reset_local_data};
use crate::sync2::profile_actions::{edits_sync, syncs_link};
use crate::sync2::service::push_soon;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

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
    app: AppHandle,
    record: WatchHistoryRecord,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::upsert_watch_record(&pool, &record)
        .await
        .map_err(ErrorResponse::from)?;
    if edits_sync(&app).await {
        push_soon(&app);
    }
    Ok(())
}

/// Undo of a removal, which unlike a new watch must beat the deletion it takes back.
#[tauri::command]
pub async fn restore_watch_record(
    app: AppHandle,
    record: WatchHistoryRecord,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::upsert_watch_record(&pool, &record)
        .await
        .map_err(ErrorResponse::from)?;
    note_sync_failure(local_edits::stamp_restored_watch(&pool, &record.video_id).await);
    if edits_sync(&app).await {
        push_soon(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn add_watch_records_bulk(
    app: AppHandle,
    records: Vec<WatchHistoryRecord>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    watch_history::upsert_watch_records_bulk(&pool, &records)
        .await
        .map_err(ErrorResponse::from)?;
    if edits_sync(&app).await {
        push_soon(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_watch_record(
    app: AppHandle,
    video_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if edits_sync(&app).await {
        note_sync_failure(local_edits::record_watch_deletion(&pool, Some(&video_id)).await);
        push_soon(&app);
    }
    watch_history::delete_watch_record(&pool, &video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_watch_records(
    video_ids: Vec<String>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<WatchHistoryRecord>, ErrorResponse> {
    watch_history::get_watch_records(&pool, &video_ids)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_watch_history_years(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<i64>, ErrorResponse> {
    watch_history::watch_history_years(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_short_watch_records(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if edits_sync(&app).await {
        let shorts = watch_history::short_video_ids(&pool)
            .await
            .map_err(ErrorResponse::from)?;
        note_sync_failure(local_edits::record_watch_deletions(&pool, shorts).await);
        push_soon(&app);
    }
    watch_history::delete_short_watch_records(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_watch_history(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if edits_sync(&app).await {
        note_sync_failure(local_edits::record_watch_deletion(&pool, None).await);
        push_soon(&app);
    }
    watch_history::clear_watch_history(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn reset_app_data(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if syncs_link(&app).await {
        leave_if_linked(&app).await.map_err(|e| linked_err(&e))?;
    }
    reset_local_data(&pool, edits_sync(&app).await)
        .await
        .map_err(|e| linked_err(&e))
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
    app: AppHandle,
    key: String,
    value: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    if edits_sync(&app).await {
        note_sync_failure(local_edits::record_blob_write(&pool, &key, &value).await);
        if local_edits::is_synced_setting(&key) {
            push_soon(&app);
        }
    }
    settings::set_setting(&pool, &key, &value)
        .await
        .map_err(ErrorResponse::from)?;
    apply_backend_setting(&key, Some(&value));
    Ok(())
}

/// Settings the backend acts on itself, applied at startup and whenever saved.
pub(crate) const BACKEND_SETTINGS: [&str; 10] = [
    remote_decoder::SETTING_KEY,
    audio_preference::STABLE_VOLUME_SETTING,
    locale::CONTENT_LANGUAGE_SETTING,
    locale::CONTENT_COUNTRY_SETTING,
    app_proxy::ENABLED_SETTING,
    app_proxy::TYPE_SETTING,
    app_proxy::HOST_SETTING,
    app_proxy::PORT_SETTING,
    app_proxy::USERNAME_SETTING,
    app_proxy::PASSWORD_SETTING,
];

pub(crate) fn apply_backend_setting(key: &str, value: Option<&str>) {
    if app_proxy::apply_setting(key, value) {
        return;
    }
    let enabled = value.is_some_and(|value| value.eq_ignore_ascii_case("true"));
    if key == remote_decoder::SETTING_KEY {
        remote_decoder::set_enabled(enabled);
    } else if key == audio_preference::STABLE_VOLUME_SETTING {
        audio_preference::set_stable_volume(enabled);
    } else if key == locale::CONTENT_LANGUAGE_SETTING {
        locale::set_content_language(value);
    } else if key == locale::CONTENT_COUNTRY_SETTING {
        locale::set_content_country(value);
    }
}

/// Only a profile that syncs records its edits for sync. Sync bookkeeping never blocks the user's own change; the worst case is that this one edit
/// syncs the way it did before this was recorded (a deletion a peer may undo).
fn note_sync_failure(result: Result<(), SyncError>) {
    if let Err(e) = result {
        tracing::warn!(target: "flow::sync::changes", error = %e, "could not record a local edit for sync");
    }
}
