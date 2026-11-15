//! The AiSList channel filter's commands. It is optional and third-party, so nothing here fails
//! loudly: a list that cannot be fetched keeps the last good one.

// AiSList reads as code to this lint.
#![allow(clippy::doc_markdown)]

use tauri::{AppHandle, State};

use crate::ai_list::AiListService;
use crate::ai_list::matcher::AiVerdict;
use crate::ai_list::reporter::{self, AiReportCheck, AiReportResult};
use crate::ai_list::service::{
    AiListMatcherData, AiListRefresh, AiListStatus, ChannelRef, KEY_REPORT_NAME,
};
use crate::ai_list::source::{self, SourceSettings};
use crate::db;
use crate::errors::ErrorResponse;
use crate::security::validation::validate_video_id;

/// More than a page of cards never needs matching at once.
const MAX_CHANNELS: usize = 500;

#[tauri::command]
pub async fn ai_list_status(
    service: State<'_, AiListService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<Option<AiListStatus>, ErrorResponse> {
    Ok(service.status(&pool).await)
}

#[tauri::command]
pub async fn ai_list_refresh(
    app: AppHandle,
    service: State<'_, AiListService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<AiListRefresh, ErrorResponse> {
    Ok(service.refresh(&app, &pool).await)
}

#[tauri::command]
pub async fn ai_list_matcher_data(
    service: State<'_, AiListService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<Option<AiListMatcherData>, ErrorResponse> {
    Ok(service.matcher_data(&pool).await)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments and State.
pub fn ai_list_learn_handles(
    app: AppHandle,
    service: State<'_, AiListService>,
    channels: Vec<ChannelRef>,
) {
    service.learn(&app, &channels[..channels.len().min(MAX_CHANNELS)]);
}

#[tauri::command]
pub async fn ai_list_match_channels(
    service: State<'_, AiListService>,
    pool: State<'_, sqlx::SqlitePool>,
    channels: Vec<ChannelRef>,
) -> Result<Vec<AiVerdict>, ErrorResponse> {
    let channels = &channels[..channels.len().min(MAX_CHANNELS)];
    Ok(service.match_channels(&pool, channels).await)
}

/// What Settings should store for a source the viewer typed; `None` when it is not valid.
#[tauri::command]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments.
pub fn ai_list_source_settings(url: String, key: String) -> Option<SourceSettings> {
    source::settings_for(&url, &key)
}

#[tauri::command]
pub async fn ai_list_check_report(
    app: AppHandle,
    service: State<'_, AiListService>,
    pool: State<'_, sqlx::SqlitePool>,
    channel_id: String,
    handle: Option<String>,
) -> Result<AiReportCheck, ErrorResponse> {
    let channel = ChannelRef { channel_id, handle };
    Ok(service.check_report(&app, &pool, &channel).await)
}

#[tauri::command]
pub async fn ai_list_submit_report(
    pool: State<'_, sqlx::SqlitePool>,
    handle: String,
    video_id: String,
) -> Result<AiReportResult, ErrorResponse> {
    validate_video_id(&video_id)?;
    let Some(handle) = crate::ai_list::handle::for_report(&handle) else {
        return Ok(AiReportResult::Rejected);
    };
    let name = db::settings::get_setting(&pool, KEY_REPORT_NAME)
        .await?
        .unwrap_or_default();
    Ok(reporter::submit(&handle, &video_id, &name).await)
}
