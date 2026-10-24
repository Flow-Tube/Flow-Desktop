//! Saves and restores the music queue between launches, and where long tracks were left.

use sqlx::SqlitePool;
use tauri::State;

use crate::db::music_queue;
use crate::errors::{AppError, ErrorResponse};
use crate::security::validation::validate_video_id;

type CmdResult<T> = Result<T, ErrorResponse>;

/// A saved queue is a few hundred songs at most; anything far larger is not one.
const MAX_QUEUE_STATE_BYTES: usize = 4 * 1024 * 1024;

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

#[tauri::command]
pub async fn save_music_queue_state(state: String, pool: State<'_, SqlitePool>) -> CmdResult<()> {
    if state.len() > MAX_QUEUE_STATE_BYTES {
        return Err(AppError::Validation("Music queue state is too large".into()).into());
    }
    serde_json::from_str::<serde_json::Value>(&state).map_err(|_| {
        ErrorResponse::from(AppError::Validation("Music queue state is not JSON".into()))
    })?;
    music_queue::save_queue_state(&pool, &state, unix_ms())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn load_music_queue_state(pool: State<'_, SqlitePool>) -> CmdResult<Option<String>> {
    music_queue::load_queue_state(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_music_queue_state(pool: State<'_, SqlitePool>) -> CmdResult<()> {
    music_queue::clear_queue_state(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn save_music_resume_position(
    video_id: String,
    position_seconds: f64,
    duration_seconds: f64,
    pool: State<'_, SqlitePool>,
) -> CmdResult<()> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    if !position_seconds.is_finite() || !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err(AppError::Validation("Invalid resume position".into()).into());
    }
    music_queue::save_resume_position(
        &pool,
        video_id.trim(),
        position_seconds.clamp(0.0, duration_seconds),
        duration_seconds,
        unix_ms(),
    )
    .await
    .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_resume_position(
    video_id: String,
    pool: State<'_, SqlitePool>,
) -> CmdResult<Option<f64>> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    music_queue::get_resume_position(&pool, video_id.trim())
        .await
        .map_err(ErrorResponse::from)
}
