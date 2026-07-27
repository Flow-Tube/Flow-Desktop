use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

use sqlx::SqlitePool;

use crate::api::innertube::download::{
    DownloadContainer, DownloadableFormat, container_from_mime, pair_downloadable_formats,
};
use crate::db::download_collections::DownloadCollectionRecord;
use crate::db::downloads::DownloadRecord;
use crate::errors::{AppError, ErrorResponse};
use crate::security::validation::validate_video_id;
use crate::services::youtube_service::YoutubeService;
use crate::streaming::proxy::{StreamSession, StreamSessionKind, StreamingManager};

mod muxer;
mod sidecars;

const DOWNLOAD_EVENT: &str = "download-progress";
const MIN_PARALLEL_FILE_BYTES: u64 = 4 * 1024 * 1024;
const COPY_BUFFER_BYTES: usize = 256 * 1024;
const PROGRESS_EMIT_BYTES: u64 = 256 * 1024;
const MAX_ACTIVE_DOWNLOADS: usize = 3;
const RETRY_DELAY_MAX_SECS: u64 = 30;

#[tauri::command]
pub async fn get_download_formats(
    video_id: String,
    youtube_service: State<'_, YoutubeService>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Vec<DownloadableFormat>, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    let stream_info = youtube_service
        .get_stream_info(&video_id)
        .await
        .map_err(ErrorResponse::from)?;
    let dynamic_user_agent = stream_info
        .expires_at
        .split_once('|')
        .map(|(_, user_agent)| user_agent)
        .unwrap_or_default()
        .to_string();
    let mut formats = pair_downloadable_formats(&stream_info);
    let proxy_port = streaming_manager.get_port();

    for format in &mut formats {
        let video_token = Uuid::new_v4().to_string();
        streaming_manager.register_session(
            video_token.clone(),
            format.video_url.clone(),
            container_mime_type(&format.video_mime_type),
            dynamic_user_agent.clone(),
        );
        format.video_url = format!("http://127.0.0.1:{proxy_port}/stream/{video_token}");

        let audio_user_agent = stream_info
            .download_audio_tracks
            .iter()
            .find(|track| track.local_url == format.audio_url)
            .and_then(|track| track.user_agent.clone())
            .unwrap_or_else(|| dynamic_user_agent.clone());
        let audio_token = Uuid::new_v4().to_string();
        streaming_manager.register_session(
            audio_token.clone(),
            format.audio_url.clone(),
            container_mime_type(&format.audio_mime_type),
            audio_user_agent,
        );
        format.audio_url = format!("http://127.0.0.1:{proxy_port}/stream/{audio_token}");
    }

    Ok(formats)
}

fn container_mime_type(mime_type: &str) -> String {
    mime_type
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string()
}

#[derive(Clone)]
pub struct DownloadManager {
    registry: Arc<Mutex<DownloadRegistry>>,
    permits: Arc<Semaphore>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(DownloadRegistry::default())),
            permits: Arc::new(Semaphore::new(MAX_ACTIVE_DOWNLOADS)),
        }
    }
}

#[derive(Default)]
struct DownloadRegistry {
    controls: HashMap<String, Arc<DownloadControl>>,
    reserved_paths: HashSet<PathBuf>,
}

#[derive(Default)]
struct DownloadControl {
    cancelled: AtomicBool,
    paused: AtomicBool,
    changed: Notify,
}

impl DownloadControl {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        self.changed.notify_waiters();
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
        self.changed.notify_waiters();
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadRequest {
    pub source_url: Option<String>,
    pub adaptive: Option<AdaptiveDownloadRequest>,
    pub title: String,
    pub media_kind: DownloadMediaKind,
    pub quality_label: String,
    pub destination_directory: Option<String>,
    pub parallel: bool,
    pub threads: u8,
    /// Source identifiers used to fetch companion files (poster, `SponsorBlock`, lyrics)
    /// and to populate the persisted downloads library.
    pub video_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
    pub duration_seconds: Option<u64>,
    pub collection_db_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdaptiveDownloadRequest {
    pub video_url: String,
    pub audio_url: String,
    pub container: DownloadContainer,
    pub video_mime_type: String,
    pub audio_mime_type: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadMediaKind {
    Video,
    Music,
    Audio,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStarted {
    pub id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    title: String,
    media_kind: DownloadMediaKind,
    quality_label: String,
    file_path: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    status: DownloadStatus,
    error: Option<String>,
    error_kind: Option<String>,
    logs: Vec<String>,
    video_id: Option<String>,
    thumbnail_url: Option<String>,
    collection_db_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    WaitingForNetwork,
    Muxing,
    Completed,
    Failed,
    Cancelled,
}

struct DownloadContext {
    id: String,
    title: String,
    media_kind: DownloadMediaKind,
    quality_label: String,
    file_path: PathBuf,
    temp_path: PathBuf,
    session: Option<StreamSession>,
    adaptive: Option<AdaptiveDownloadContext>,
    parallel: bool,
    threads: u8,
    control: Arc<DownloadControl>,
    video_id: Option<String>,
    thumbnail_url: Option<String>,
    author: Option<String>,
    duration_seconds: Option<u64>,
    collection_db_id: Option<i64>,
    pool: SqlitePool,
}

struct AdaptiveSources {
    video_session: StreamSession,
    audio_session: StreamSession,
    output_container: DownloadContainer,
    video_container: DownloadContainer,
    audio_container: DownloadContainer,
}

struct AdaptiveDownloadContext {
    video_session: StreamSession,
    audio_session: StreamSession,
    container: DownloadContainer,
    video_container: DownloadContainer,
    audio_container: DownloadContainer,
    video_path: PathBuf,
    audio_path: PathBuf,
}

struct MediaFileInspection {
    size: u64,
    prefix: Vec<u8>,
    valid: bool,
}

#[derive(Clone)]
struct ProgressEmitter {
    app: AppHandle,
    id: String,
    title: String,
    media_kind: DownloadMediaKind,
    quality_label: String,
    file_path: String,
    downloaded: Arc<AtomicU64>,
    last_emitted: Arc<AtomicU64>,
    total: Option<u64>,
    logs: Arc<Mutex<Vec<String>>>,
    video_id: Option<String>,
    thumbnail_url: Option<String>,
    collection_db_id: Option<i64>,
}

impl ProgressEmitter {
    fn emit(&self, status: DownloadStatus, error: Option<String>) {
        // Terminal failures never cross the AppError->ErrorResponse boundary (they
        // are emitted as events from a background task), so log them here or they
        // would leave no trace in the persistent log / Diagnostics page.
        let error_kind = match (&status, &error) {
            (DownloadStatus::Failed, Some(message)) => {
                tracing::warn!(id = %self.id, video_id = ?self.video_id, error = %message, "download_failed");
                Some("download".to_string())
            }
            _ => None,
        };
        let _ = self.app.emit(
            DOWNLOAD_EVENT,
            DownloadProgress {
                id: self.id.clone(),
                title: self.title.clone(),
                media_kind: self.media_kind,
                quality_label: self.quality_label.clone(),
                file_path: self.file_path.clone(),
                downloaded_bytes: self.downloaded.load(Ordering::Relaxed),
                total_bytes: self.total,
                status,
                error,
                error_kind,
                logs: self
                    .logs
                    .lock()
                    .map(|logs| logs.clone())
                    .unwrap_or_default(),
                video_id: self.video_id.clone(),
                thumbnail_url: self.thumbnail_url.clone(),
                collection_db_id: self.collection_db_id,
            },
        );
    }

    fn log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(message.into());
            if logs.len() > 100 {
                logs.remove(0);
            }
        }
    }

    fn emit_downloading(&self) {
        let current = self.downloaded.load(Ordering::Relaxed);
        let previous = self.last_emitted.load(Ordering::Relaxed);
        if current.saturating_sub(previous) < PROGRESS_EMIT_BYTES {
            return;
        }
        if self
            .last_emitted
            .compare_exchange(previous, current, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            self.emit(DownloadStatus::Downloading, None);
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_lines)] // Coordinates validation, path reservation, and task startup.
pub async fn start_download(
    request: StartDownloadRequest,
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    streaming_manager: State<'_, StreamingManager>,
    pool: State<'_, SqlitePool>,
) -> Result<DownloadStarted, ErrorResponse> {
    let download_manager = manager.inner().clone();
    let streaming_manager = streaming_manager.inner().clone();
    let pool = pool.inner().clone();
    let StartDownloadRequest {
        source_url,
        adaptive,
        title,
        media_kind,
        quality_label,
        destination_directory,
        parallel,
        threads,
        video_id,
        thumbnail_url,
        author,
        duration_seconds,
        collection_db_id,
    } = request;
    let title = title.trim().to_string();

    if title.is_empty() || title.chars().count() > 240 {
        return Err(ErrorResponse::from(AppError::Validation(
            "Download title must contain between 1 and 240 characters".into(),
        )));
    }

    let (session, adaptive_sessions, extension) = match (source_url.as_deref(), adaptive) {
        (Some(source_url), None) => {
            let session = resolve_remote_stream_session(source_url, &streaming_manager)?;
            let extension = extension_for_content_type(&session.content_type, media_kind);
            (Some(session), None, extension)
        }
        (None, Some(adaptive)) if matches!(media_kind, DownloadMediaKind::Video) => {
            let video_session =
                resolve_remote_stream_session(&adaptive.video_url, &streaming_manager)?;
            let audio_session =
                resolve_remote_stream_session(&adaptive.audio_url, &streaming_manager)?;
            let extension = match adaptive.container {
                DownloadContainer::Mp4 => "mp4",
                DownloadContainer::Mkv => "mkv",
            };
            (
                None,
                Some(AdaptiveSources {
                    video_session,
                    audio_session,
                    output_container: adaptive.container,
                    video_container: container_from_mime(&adaptive.video_mime_type),
                    audio_container: container_from_mime(&adaptive.audio_mime_type),
                }),
                extension,
            )
        }
        _ => {
            return Err(ErrorResponse::from(AppError::Validation(
                "Provide either one media stream or one adaptive video/audio pair".into(),
            )));
        }
    };

    let directory =
        resolve_destination_directory(&app, media_kind, destination_directory.as_deref())?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| download_error(format!("Could not create download folder: {error}")))?;

    let id = Uuid::new_v4().to_string();
    let control = Arc::new(DownloadControl::default());
    let file_path = {
        let mut registry = download_manager
            .registry
            .lock()
            .map_err(|_| download_error("Download manager is unavailable"))?;
        let path = available_file_path(
            &directory,
            &sanitize_file_stem(&title),
            extension,
            &registry.reserved_paths,
        );
        registry.reserved_paths.insert(path.clone());
        registry.controls.insert(id.clone(), control.clone());
        path
    };
    let temp_path = directory.join(format!(".{id}.flowpart"));
    let adaptive_context = adaptive_sessions.map(|sources| AdaptiveDownloadContext {
        video_session: sources.video_session,
        audio_session: sources.audio_session,
        container: sources.output_container,
        video_container: sources.video_container,
        audio_container: sources.audio_container,
        video_path: directory.join(format!(".{id}.video.flowpart")),
        audio_path: directory.join(format!(".{id}.audio.flowpart")),
    });

    if let Err(error) = tokio::fs::File::create(&temp_path).await {
        let mut registry = download_manager
            .registry
            .lock()
            .map_err(|_| download_error("Download manager is unavailable"))?;
        registry.controls.remove(&id);
        registry.reserved_paths.remove(&file_path);
        return Err(download_error(format!(
            "Could not create a temporary download file: {error}"
        )));
    }

    let context = DownloadContext {
        id: id.clone(),
        title: title.clone(),
        media_kind,
        quality_label,
        file_path: file_path.clone(),
        temp_path,
        session,
        adaptive: adaptive_context,
        parallel,
        threads: threads.clamp(1, 8),
        control,
        video_id,
        thumbnail_url,
        author,
        duration_seconds,
        collection_db_id,
        pool,
    };
    let _ = app.emit(
        DOWNLOAD_EVENT,
        DownloadProgress {
            id: id.clone(),
            title,
            media_kind,
            quality_label: context.quality_label.clone(),
            file_path: file_path.to_string_lossy().into_owned(),
            downloaded_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Queued,
            error: None,
            error_kind: None,
            logs: vec!["Download added to the queue".to_string()],
            video_id: context.video_id.clone(),
            thumbnail_url: context.thumbnail_url.clone(),
            collection_db_id: context.collection_db_id,
        },
    );
    let app_for_task = app.clone();
    let manager_for_task = download_manager;
    let task_id = id.clone();
    let reserved_path = file_path.clone();
    let permits = manager_for_task.permits.clone();
    tauri::async_runtime::spawn(async move {
        match permits.acquire_owned().await {
            Ok(_permit) => run_download(context, app_for_task).await,
            Err(error) => emit_terminal_error(
                &context,
                &app_for_task,
                format!("Download queue stopped unexpectedly: {error}"),
                "internal",
            ),
        }
        if let Ok(mut registry) = manager_for_task.registry.lock() {
            registry.controls.remove(&task_id);
            registry.reserved_paths.remove(&reserved_path);
        }
    });

    Ok(DownloadStarted {
        id,
        file_path: file_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments and State.
pub fn cancel_download(
    id: String,
    manager: State<'_, DownloadManager>,
) -> Result<bool, ErrorResponse> {
    let registry = manager
        .registry
        .lock()
        .map_err(|_| download_error("Download manager is unavailable"))?;
    let Some(control) = registry.controls.get(&id) else {
        return Ok(false);
    };
    control.cancel();
    Ok(true)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn pause_download(
    id: String,
    manager: State<'_, DownloadManager>,
) -> Result<bool, ErrorResponse> {
    set_download_paused(&id, true, manager.inner())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn resume_download(
    id: String,
    manager: State<'_, DownloadManager>,
) -> Result<bool, ErrorResponse> {
    set_download_paused(&id, false, manager.inner())
}

fn set_download_paused(
    id: &str,
    paused: bool,
    manager: &DownloadManager,
) -> Result<bool, ErrorResponse> {
    let registry = manager
        .registry
        .lock()
        .map_err(|_| download_error("Download manager is unavailable"))?;
    let Some(control) = registry.controls.get(id) else {
        return Ok(false);
    };
    control.set_paused(paused);
    Ok(true)
}

fn resolve_stream_session(
    source_url: &str,
    streaming_manager: &StreamingManager,
) -> Result<StreamSession, ErrorResponse> {
    let url = reqwest::Url::parse(source_url)
        .map_err(|_| download_error("Invalid download stream URL"))?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(streaming_manager.get_port())
    {
        return Err(download_error(
            "Downloads must use a stream resolved by Flow",
        ));
    }

    let token = url
        .path()
        .strip_prefix("/stream/")
        .filter(|token| !token.is_empty() && !token.contains('/'))
        .ok_or_else(|| download_error("Invalid Flow stream token"))?;

    streaming_manager
        .get_session(token)
        .ok_or_else(|| download_error("The media stream expired; reopen the download dialog"))
}

fn resolve_remote_stream_session(
    source_url: &str,
    streaming_manager: &StreamingManager,
) -> Result<StreamSession, ErrorResponse> {
    let session = resolve_stream_session(source_url, streaming_manager)?;
    if !matches!(session.kind, StreamSessionKind::Remote { .. }) {
        return Err(ErrorResponse::from(AppError::Validation(
            "Only remote media streams can be downloaded".into(),
        )));
    }
    Ok(session)
}

fn resolve_destination_directory(
    app: &AppHandle,
    media_kind: DownloadMediaKind,
    custom_directory: Option<&str>,
) -> Result<PathBuf, ErrorResponse> {
    if let Some(custom) = custom_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(custom);
        if !path.is_absolute() {
            return Err(download_error(
                "The custom download folder must be absolute",
            ));
        }
        return Ok(path);
    }

    let base = match media_kind {
        DownloadMediaKind::Video => app.path().video_dir(),
        DownloadMediaKind::Music | DownloadMediaKind::Audio => app.path().audio_dir(),
    }
    .or_else(|_| app.path().download_dir())
    .map_err(|error| download_error(format!("Could not resolve a download folder: {error}")))?;

    Ok(base.join("Flow"))
}

fn extension_for_content_type(content_type: &str, media_kind: DownloadMediaKind) -> &'static str {
    let content_type = content_type.to_ascii_lowercase();
    if content_type.contains("webm") {
        "webm"
    } else if content_type.contains("ogg") || content_type.contains("opus") {
        "ogg"
    } else if content_type.contains("mpeg") && !matches!(media_kind, DownloadMediaKind::Video) {
        "mp3"
    } else if matches!(media_kind, DownloadMediaKind::Video) {
        "mp4"
    } else {
        "m4a"
    }
}

fn sanitize_file_stem(title: &str) -> String {
    let mut value = title
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}' => '_',
            _ => character,
        })
        .collect::<String>();
    value = value.trim().trim_end_matches(['.', ' ']).to_string();
    if value.is_empty() {
        value = "Flow download".to_string();
    }
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.iter().any(|name| value.eq_ignore_ascii_case(name)) {
        value.insert(0, '_');
    }
    value.chars().take(180).collect()
}

fn available_file_path(
    directory: &Path,
    stem: &str,
    extension: &str,
    reserved_paths: &HashSet<PathBuf>,
) -> PathBuf {
    let first = directory.join(format!("{stem}.{extension}"));
    if !first.exists() && !reserved_paths.contains(&first) {
        return first;
    }
    for index in 2..10_000 {
        let candidate = directory.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() && !reserved_paths.contains(&candidate) {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.{}", Uuid::new_v4(), extension))
}

async fn run_download(mut context: DownloadContext, app: AppHandle) {
    if context.control.cancelled.load(Ordering::Relaxed) {
        emit_cancelled(&context, &app);
        return;
    }
    if let Some(adaptive) = context.adaptive.take() {
        run_adaptive_download(context, adaptive, app).await;
        return;
    }

    let Some(session) = context.session.as_ref() else {
        emit_terminal_error(
            &context,
            &app,
            "The download has no media stream".into(),
            "streaming",
        );
        return;
    };
    let remote_url = match &session.kind {
        StreamSessionKind::Remote { remote_url } => remote_url.clone(),
        StreamSessionKind::Inline { .. } | StreamSessionKind::Local { .. } => return,
    };
    let client = match build_download_client(&session.user_agent) {
        Ok(client) => client,
        Err(error) => {
            emit_terminal_error(
                &context,
                &app,
                format!("Could not initialize download: {error}"),
                "network",
            );
            return;
        }
    };

    let total = probe_content_length(&client, &remote_url).await;
    let downloaded = Arc::new(AtomicU64::new(0));
    let emitter = ProgressEmitter {
        app: app.clone(),
        id: context.id.clone(),
        title: context.title.clone(),
        media_kind: context.media_kind,
        quality_label: context.quality_label.clone(),
        file_path: context.file_path.to_string_lossy().into_owned(),
        downloaded: downloaded.clone(),
        last_emitted: Arc::new(AtomicU64::new(0)),
        total,
        logs: Arc::new(Mutex::new(vec!["Download started".to_string()])),
        video_id: context.video_id.clone(),
        thumbnail_url: context.thumbnail_url.clone(),
        collection_db_id: context.collection_db_id,
    };
    emitter.emit(DownloadStatus::Queued, None);

    let result = download_to_temp(&client, &remote_url, &context, &emitter, total, true).await;

    match result {
        Ok(()) if context.control.cancelled.load(Ordering::Relaxed) => {
            cleanup_partial_files(&context).await;
            emitter.emit(DownloadStatus::Cancelled, None);
        }
        Ok(()) => {
            if let Err(error) = finalize_download_file(&context.temp_path, &context.file_path).await
            {
                cleanup_partial_files(&context).await;
                emitter.emit(DownloadStatus::Failed, Some(error));
                return;
            }
            if let Ok(metadata) = tokio::fs::metadata(&context.file_path).await {
                downloaded.store(metadata.len(), Ordering::Relaxed);
            }
            sidecars::write_sidecars(
                &app,
                context.media_kind,
                &context.file_path,
                context.video_id.as_deref(),
                context.thumbnail_url.as_deref(),
                &emitter,
            )
            .await;
            record_completed_download(&context).await;
            emitter.log("Download completed successfully");
            emitter.emit(DownloadStatus::Completed, None);
        }
        Err(error) => {
            emitter.log(format!("Download failed: {error}"));
            cleanup_partial_files(&context).await;
            let status = if context.control.cancelled.load(Ordering::Relaxed) {
                DownloadStatus::Cancelled
            } else {
                DownloadStatus::Failed
            };
            emitter.emit(
                status,
                (!matches!(status, DownloadStatus::Cancelled)).then_some(error),
            );
        }
    }
}

#[allow(clippy::too_many_lines)] // Coordinates two downloads, muxing, cancellation, cleanup, and terminal events.
async fn run_adaptive_download(
    context: DownloadContext,
    adaptive: AdaptiveDownloadContext,
    app: AppHandle,
) {
    let video_url = match &adaptive.video_session.kind {
        StreamSessionKind::Remote { remote_url } => remote_url.clone(),
        StreamSessionKind::Inline { .. } | StreamSessionKind::Local { .. } => return,
    };
    let audio_url = match &adaptive.audio_session.kind {
        StreamSessionKind::Remote { remote_url } => remote_url.clone(),
        StreamSessionKind::Inline { .. } | StreamSessionKind::Local { .. } => return,
    };
    let video_client = match build_download_client(&adaptive.video_session.user_agent) {
        Ok(client) => client,
        Err(error) => {
            emit_terminal_error(
                &context,
                &app,
                format!("Could not initialize video download: {error}"),
                "network",
            );
            return;
        }
    };
    let audio_client = match build_download_client(&adaptive.audio_session.user_agent) {
        Ok(client) => client,
        Err(error) => {
            emit_terminal_error(
                &context,
                &app,
                format!("Could not initialize audio download: {error}"),
                "network",
            );
            return;
        }
    };
    let (video_total, audio_total) = tokio::join!(
        probe_content_length(&video_client, &video_url),
        probe_content_length(&audio_client, &audio_url)
    );
    let total = match (video_total, audio_total) {
        (Some(video), Some(audio)) => video.checked_add(audio),
        _ => None,
    };
    let downloaded = Arc::new(AtomicU64::new(0));
    let emitter = ProgressEmitter {
        app: app.clone(),
        id: context.id.clone(),
        title: context.title.clone(),
        media_kind: context.media_kind,
        quality_label: context.quality_label.clone(),
        file_path: context.file_path.to_string_lossy().into_owned(),
        downloaded: downloaded.clone(),
        last_emitted: Arc::new(AtomicU64::new(0)),
        total,
        logs: Arc::new(Mutex::new(vec![
            "Adaptive video and audio download started".to_string(),
        ])),
        video_id: context.video_id.clone(),
        thumbnail_url: context.thumbnail_url.clone(),
        collection_db_id: context.collection_db_id,
    };
    emitter.emit(DownloadStatus::Downloading, None);

    let video_context = child_download_context(&context, adaptive.video_path.clone());
    let audio_context = child_download_context(&context, adaptive.audio_path.clone());
    let video_emitter = emitter.clone();
    let audio_emitter = emitter.clone();
    let video_client_for_task = video_client.clone();
    let audio_client_for_task = audio_client.clone();
    let video_url_for_task = video_url.clone();
    let audio_url_for_task = audio_url.clone();
    let video_task = tokio::spawn(async move {
        download_to_temp(
            &video_client_for_task,
            &video_url_for_task,
            &video_context,
            &video_emitter,
            video_total,
            false,
        )
        .await
    });
    let audio_task = tokio::spawn(async move {
        download_to_temp(
            &audio_client_for_task,
            &audio_url_for_task,
            &audio_context,
            &audio_emitter,
            audio_total,
            false,
        )
        .await
    });
    let result = match tokio::try_join!(video_task, audio_task) {
        Ok((video, audio)) => video.and(audio),
        Err(error) => Err(format!(
            "Adaptive download worker stopped unexpectedly: {error}"
        )),
    };
    if let Err(error) = result {
        emitter.log(format!("Adaptive track download failed: {error}"));
        cleanup_adaptive_files(&context, &adaptive).await;
        let status = if context.control.cancelled.load(Ordering::Relaxed) {
            DownloadStatus::Cancelled
        } else {
            DownloadStatus::Failed
        };
        emitter.emit(
            status,
            (!matches!(status, DownloadStatus::Cancelled)).then_some(error),
        );
        return;
    }
    if context.control.cancelled.load(Ordering::Relaxed) {
        cleanup_adaptive_files(&context, &adaptive).await;
        emitter.emit(DownloadStatus::Cancelled, None);
        return;
    }

    if let Err(error) = ensure_valid_adaptive_sources(
        &context,
        &adaptive,
        &video_client,
        &video_url,
        video_total,
        &audio_client,
        &audio_url,
        audio_total,
        &emitter,
    )
    .await
    {
        emitter.log(format!(
            "Adaptive source integrity recovery failed: {error}"
        ));
        emitter.log(format!(
            "Forensic staging files preserved: video=`{}`, audio=`{}`",
            adaptive.video_path.display(),
            adaptive.audio_path.display()
        ));
        emitter.emit(DownloadStatus::Failed, Some(error));
        return;
    }

    emitter.emit(DownloadStatus::Muxing, None);
    emitter.log("Track downloads completed; starting native muxer");
    let video_path = adaptive.video_path.clone();
    let audio_path = adaptive.audio_path.clone();
    let output_path = context.temp_path.clone();
    let control = context.control.clone();
    let output_container = adaptive.container;
    let video_container = adaptive.video_container;
    let audio_container = adaptive.audio_container;
    let mux_result = tokio::task::spawn_blocking(move || {
        muxer::mux_adaptive_tracks(
            output_container,
            video_container,
            &video_path,
            audio_container,
            &audio_path,
            &output_path,
            &control.cancelled,
        )
    })
    .await
    .map_err(|error| format!("Media muxer stopped unexpectedly: {error}"))
    .and_then(|result| result);

    match mux_result {
        Ok(()) if context.control.cancelled.load(Ordering::Relaxed) => {
            cleanup_adaptive_files(&context, &adaptive).await;
            emitter.emit(DownloadStatus::Cancelled, None);
        }
        Ok(()) => {
            let _ = tokio::fs::remove_file(&adaptive.video_path).await;
            let _ = tokio::fs::remove_file(&adaptive.audio_path).await;
            if let Err(error) = finalize_download_file(&context.temp_path, &context.file_path).await
            {
                cleanup_adaptive_files(&context, &adaptive).await;
                emitter.emit(DownloadStatus::Failed, Some(error));
                return;
            }
            sidecars::write_sidecars(
                &app,
                context.media_kind,
                &context.file_path,
                context.video_id.as_deref(),
                context.thumbnail_url.as_deref(),
                &emitter,
            )
            .await;
            record_completed_download(&context).await;
            emitter.log("Download and native mux completed successfully");
            emitter.emit(DownloadStatus::Completed, None);
        }
        Err(error) => {
            emitter.log(format!("Muxer failed: {error}"));
            let _ = tokio::fs::remove_file(&context.temp_path).await;
            emitter.log(format!(
                "Forensic staging files preserved after mux failure: video=`{}`, audio=`{}`",
                adaptive.video_path.display(),
                adaptive.audio_path.display()
            ));
            let status = if context.control.cancelled.load(Ordering::Relaxed) {
                DownloadStatus::Cancelled
            } else {
                DownloadStatus::Failed
            };
            emitter.emit(
                status,
                (!matches!(status, DownloadStatus::Cancelled)).then_some(error),
            );
        }
    }
}

fn child_download_context(context: &DownloadContext, temp_path: PathBuf) -> DownloadContext {
    DownloadContext {
        id: context.id.clone(),
        title: context.title.clone(),
        media_kind: context.media_kind,
        quality_label: context.quality_label.clone(),
        file_path: context.file_path.clone(),
        temp_path,
        session: None,
        adaptive: None,
        parallel: context.parallel,
        threads: context.threads,
        control: context.control.clone(),
        video_id: None,
        thumbnail_url: None,
        author: None,
        duration_seconds: None,
        collection_db_id: None,
        pool: context.pool.clone(),
    }
}

fn build_download_client(user_agent: &str) -> Result<Client, reqwest::Error> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .user_agent(user_agent)
        .build()
}

async fn download_to_temp(
    client: &Client,
    remote_url: &str,
    context: &DownloadContext,
    emitter: &ProgressEmitter,
    expected_total: Option<u64>,
    reset_progress_on_fallback: bool,
) -> Result<(), String> {
    let use_parallel = context.parallel
        && context.threads > 1
        && expected_total.is_some_and(|bytes| bytes >= MIN_PARALLEL_FILE_BYTES);
    let before = emitter.downloaded.load(Ordering::Relaxed);
    let mut result = if use_parallel {
        download_parallel(
            client,
            remote_url,
            context,
            emitter,
            expected_total.unwrap_or(0),
        )
        .await
    } else {
        download_sequential(client, remote_url, context, emitter, expected_total).await
    };
    if result.is_err()
        && use_parallel
        && reset_progress_on_fallback
        && !context.control.cancelled.load(Ordering::Relaxed)
    {
        cleanup_partial_files(context).await;
        let after = emitter.downloaded.load(Ordering::Relaxed);
        emitter
            .downloaded
            .fetch_sub(after.saturating_sub(before), Ordering::Relaxed);
        if reset_progress_on_fallback {
            emitter.last_emitted.store(before, Ordering::Relaxed);
        }
        result = download_sequential(client, remote_url, context, emitter, expected_total).await;
    }
    result
}

async fn probe_content_length(client: &Client, url: &str) -> Option<u64> {
    if let Ok(response) = client.head(url).send().await
        && response.status().is_success()
        && let Some(length) = response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
    {
        return Some(length);
    }

    let response = client
        .get(url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
}

async fn download_sequential(
    client: &Client,
    url: &str,
    context: &DownloadContext,
    emitter: &ProgressEmitter,
    expected_total: Option<u64>,
) -> Result<(), String> {
    emitter.emit(DownloadStatus::Downloading, None);
    download_range_resumable(
        client,
        url,
        &context.temp_path,
        0,
        expected_total.map(|total| total.saturating_sub(1)),
        &context.control,
        emitter,
        "media stream",
    )
    .await
}

async fn download_parallel(
    client: &Client,
    url: &str,
    context: &DownloadContext,
    emitter: &ProgressEmitter,
    total: u64,
) -> Result<(), String> {
    let worker_count = u64::from(context.threads).min(total.max(1));
    let chunk_size = total.div_ceil(worker_count);
    let mut tasks = tokio::task::JoinSet::new();
    emitter.emit(DownloadStatus::Downloading, None);

    for worker in 0..worker_count {
        let start = worker * chunk_size;
        if start >= total {
            break;
        }
        let end = ((worker + 1) * chunk_size).min(total) - 1;
        let part_path = part_path(&context.temp_path, worker);
        let client = client.clone();
        let url = url.to_string();
        let control = context.control.clone();
        let progress = emitter.clone();
        tasks.spawn(async move {
            download_range_resumable(
                &client,
                &url,
                &part_path,
                start,
                Some(end),
                &control,
                &progress,
                &format!("fragment {}", worker + 1),
            )
            .await
        });
    }

    while let Some(result) = tasks.join_next().await {
        result.map_err(|error| format!("Download worker stopped unexpectedly: {error}"))??;
    }

    let mut output = tokio::fs::File::create(&context.temp_path)
        .await
        .map_err(|error| format!("Could not assemble the download: {error}"))?;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    for worker in 0..worker_count {
        let path = part_path(&context.temp_path, worker);
        let mut part = tokio::fs::File::open(&path)
            .await
            .map_err(|error| format!("Could not read a download fragment: {error}"))?;
        loop {
            let read = part
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Could not read a download fragment: {error}"))?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .await
                .map_err(|error| format!("Could not assemble the download: {error}"))?;
        }
        let _ = tokio::fs::remove_file(path).await;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("Could not flush the assembled download: {error}"))
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_lines)]
async fn download_range_resumable(
    client: &Client,
    url: &str,
    path: &Path,
    range_start: u64,
    range_end: Option<u64>,
    control: &DownloadControl,
    emitter: &ProgressEmitter,
    label: &str,
) -> Result<(), String> {
    let expected_length = range_end.map(|end| end.saturating_sub(range_start) + 1);
    let mut existing = tokio::fs::metadata(path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if expected_length.is_some_and(|expected| existing > expected) {
        return Err(format!(
            "The partial {label} is larger than its expected range ({existing} bytes)"
        ));
    }
    if expected_length == Some(existing) {
        return Ok(());
    }
    if existing > 0 {
        emitter.downloaded.fetch_add(existing, Ordering::Relaxed);
        emitter.log(format!(
            "Resuming {label} from byte {}",
            range_start + existing
        ));
    }

    let mut retry = 0_u32;
    loop {
        wait_if_paused(control, emitter).await?;
        let request_start = range_start + existing;
        let range = range_end.map_or_else(
            || format!("bytes={request_start}-"),
            |end| format!("bytes={request_start}-{end}"),
        );
        let response = match client.get(url).header(RANGE, range.clone()).send().await {
            Ok(response) => response,
            Err(error) => {
                retry = retry.saturating_add(1);
                wait_for_retry(
                    control,
                    emitter,
                    retry,
                    format!("{label} request failed at byte {request_start}: {error}"),
                )
                .await?;
                continue;
            }
        };

        let status = response.status();
        if status != StatusCode::PARTIAL_CONTENT
            && !(status.is_success() && request_start == 0 && range_end.is_none())
        {
            if is_retryable_status(status) {
                retry = retry.saturating_add(1);
                wait_for_retry(
                    control,
                    emitter,
                    retry,
                    format!("{label} server returned HTTP {status} for {range}"),
                )
                .await?;
                continue;
            }
            return Err(format!(
                "{label} cannot resume: media server returned HTTP {status} for {range}"
            ));
        }
        if status == StatusCode::PARTIAL_CONTENT {
            let content_range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    format!("{label} response omitted Content-Range for requested {range}")
                })?;
            let (actual_start, actual_end, _) = parse_content_range(content_range).ok_or_else(|| {
                format!(
                    "{label} response returned malformed Content-Range `{content_range}` for requested {range}"
                )
            })?;
            if actual_start != request_start
                || range_end.is_some_and(|requested_end| actual_end > requested_end)
            {
                return Err(format!(
                    "{label} response range mismatch: requested {range}, received `{content_range}`"
                ));
            }
            if retry > 0 || request_start == 0 {
                emitter.log(format!(
                    "{label} accepted {range}; server returned `{content_range}`"
                ));
            }
        }

        let mut output = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .map_err(|error| format!("Could not open partial {label}: {error}"))?;
        let mut stream = response.bytes_stream();
        let mut interrupted = None;
        while let Some(chunk) = stream.next().await {
            wait_if_paused(control, emitter).await?;
            match chunk {
                Ok(chunk) => {
                    if existing == 0 {
                        emitter.log(format!("{label} first bytes: {}", hex_preview(&chunk, 16)));
                    }
                    output
                        .write_all(&chunk)
                        .await
                        .map_err(|error| format!("Could not write {label}: {error}"))?;
                    let chunk_len = chunk.len() as u64;
                    existing = existing.saturating_add(chunk_len);
                    emitter.downloaded.fetch_add(chunk_len, Ordering::Relaxed);
                    emitter.emit_downloading();
                }
                Err(error) => {
                    interrupted = Some(format!(
                        "{label} stream interrupted at byte {}: {error}",
                        range_start + existing
                    ));
                    break;
                }
            }
        }
        output
            .flush()
            .await
            .map_err(|error| format!("Could not flush partial {label}: {error}"))?;

        if expected_length.is_none() && interrupted.is_none() {
            return Ok(());
        }
        if expected_length == Some(existing) {
            return Ok(());
        }
        if expected_length.is_some_and(|expected| existing > expected) {
            return Err(format!(
                "{label} exceeded its expected size ({existing} bytes received)"
            ));
        }

        retry = retry.saturating_add(1);
        wait_for_retry(
            control,
            emitter,
            retry,
            interrupted.unwrap_or_else(|| {
                format!(
                    "{label} ended early at byte {}; reconnecting",
                    range_start + existing
                )
            }),
        )
        .await?;
    }
}

fn parse_content_range(value: &str) -> Option<(u64, u64, Option<u64>)> {
    let value = value.strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((
        start.parse().ok()?,
        end.parse().ok()?,
        (total != "*").then(|| total.parse().ok()).flatten(),
    ))
}

fn hex_preview(bytes: &[u8], limit: usize) -> String {
    bytes
        .iter()
        .take(limit)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[allow(clippy::too_many_arguments)]
async fn ensure_valid_adaptive_sources(
    context: &DownloadContext,
    adaptive: &AdaptiveDownloadContext,
    video_client: &Client,
    video_url: &str,
    video_total: Option<u64>,
    audio_client: &Client,
    audio_url: &str,
    audio_total: Option<u64>,
    emitter: &ProgressEmitter,
) -> Result<(), String> {
    ensure_valid_adaptive_source(
        context,
        adaptive.video_container,
        "video track",
        &adaptive.video_path,
        video_client,
        video_url,
        video_total,
        emitter,
    )
    .await?;
    ensure_valid_adaptive_source(
        context,
        adaptive.audio_container,
        "audio track",
        &adaptive.audio_path,
        audio_client,
        audio_url,
        audio_total,
        emitter,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn ensure_valid_adaptive_source(
    context: &DownloadContext,
    container: DownloadContainer,
    label: &str,
    path: &Path,
    client: &Client,
    url: &str,
    total: Option<u64>,
    emitter: &ProgressEmitter,
) -> Result<(), String> {
    let initial = inspect_media_file(path, container).await?;
    emitter.log(format!(
        "{label} integrity check: path=`{}`, size={} bytes, prefix={}, expected={}",
        path.display(),
        initial.size,
        hex_preview(&initial.prefix, 16),
        expected_container_signature(container)
    ));
    if initial.valid {
        return Ok(());
    }

    emitter.log(format!(
        "{label} failed its container signature check; deleting the staged file and retrying once with a single clean ranged stream"
    ));
    emitter.downloaded.fetch_sub(
        initial.size.min(emitter.downloaded.load(Ordering::Relaxed)),
        Ordering::Relaxed,
    );
    let repair_context = DownloadContext {
        id: context.id.clone(),
        title: context.title.clone(),
        media_kind: context.media_kind,
        quality_label: context.quality_label.clone(),
        file_path: context.file_path.clone(),
        temp_path: path.to_path_buf(),
        session: None,
        adaptive: None,
        parallel: false,
        threads: 1,
        control: context.control.clone(),
        video_id: None,
        thumbnail_url: None,
        author: None,
        duration_seconds: None,
        collection_db_id: None,
        pool: context.pool.clone(),
    };
    cleanup_partial_files(&repair_context).await;
    download_sequential(client, url, &repair_context, emitter, total).await?;

    let repaired = inspect_media_file(path, container).await?;
    emitter.log(format!(
        "{label} recovery check: path=`{}`, size={} bytes, prefix={}, expected={}",
        path.display(),
        repaired.size,
        hex_preview(&repaired.prefix, 16),
        expected_container_signature(container)
    ));
    if repaired.valid {
        Ok(())
    } else {
        Err(format!(
            "{label} is not a valid {} source after a clean retry. File: `{}`. Size: {} bytes. Expected leading signature: {}. Actual first bytes: {}. The media origin returned bytes that do not match the selected container.",
            match container {
                DownloadContainer::Mp4 => "MP4",
                DownloadContainer::Mkv => "WebM/Matroska",
            },
            path.display(),
            repaired.size,
            expected_container_signature(container),
            hex_preview(&repaired.prefix, 32),
        ))
    }
}

async fn inspect_media_file(
    path: &Path,
    container: DownloadContainer,
) -> Result<MediaFileInspection, String> {
    let mut file = tokio::fs::File::open(path).await.map_err(|error| {
        format!(
            "Could not inspect staged media `{}`: {error}",
            path.display()
        )
    })?;
    let size = file
        .metadata()
        .await
        .map_err(|error| {
            format!(
                "Could not read staged media size `{}`: {error}",
                path.display()
            )
        })?
        .len();
    let mut prefix = vec![0_u8; 32];
    let read = file.read(&mut prefix).await.map_err(|error| {
        format!(
            "Could not read staged media header `{}`: {error}",
            path.display()
        )
    })?;
    prefix.truncate(read);
    let valid = has_container_signature(&prefix, container);
    Ok(MediaFileInspection {
        size,
        prefix,
        valid,
    })
}

fn has_container_signature(prefix: &[u8], container: DownloadContainer) -> bool {
    match container {
        DownloadContainer::Mkv => prefix.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
        DownloadContainer::Mp4 => prefix.get(4..8).is_some_and(|box_type| box_type == b"ftyp"),
    }
}

fn expected_container_signature(container: DownloadContainer) -> &'static str {
    match container {
        DownloadContainer::Mkv => "1A 45 DF A3 (EBML)",
        DownloadContainer::Mp4 => "bytes 4..8 = 66 74 79 70 (`ftyp`)",
    }
}

fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

async fn wait_if_paused(
    control: &DownloadControl,
    emitter: &ProgressEmitter,
) -> Result<(), String> {
    let mut announced = false;
    while control.paused.load(Ordering::Relaxed) {
        if control.cancelled.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        if !announced {
            emitter.log("Download paused by the user");
            emitter.emit(DownloadStatus::Paused, None);
            announced = true;
        }
        control.changed.notified().await;
    }
    if control.cancelled.load(Ordering::Relaxed) {
        return Err("Download cancelled".into());
    }
    if announced {
        emitter.log("Download resumed");
        emitter.emit(DownloadStatus::Downloading, None);
    }
    Ok(())
}

async fn wait_for_retry(
    control: &DownloadControl,
    emitter: &ProgressEmitter,
    attempt: u32,
    reason: String,
) -> Result<(), String> {
    let shift = attempt.saturating_sub(1).min(5);
    let delay = (1_u64 << shift).min(RETRY_DELAY_MAX_SECS);
    emitter.log(format!("{reason}; retrying in {delay}s"));
    emitter.emit(DownloadStatus::WaitingForNetwork, Some(reason));
    tokio::select! {
        () = tokio::time::sleep(Duration::from_secs(delay)) => {}
        () = control.changed.notified() => {}
    }
    wait_if_paused(control, emitter).await?;
    emitter.emit(DownloadStatus::Downloading, None);
    Ok(())
}

fn part_path(temp_path: &Path, worker: u64) -> PathBuf {
    PathBuf::from(format!("{}.part{worker}", temp_path.to_string_lossy()))
}

async fn finalize_download_file(temp_path: &Path, file_path: &Path) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 12;
    let mut attempt = 1;
    loop {
        match tokio::fs::rename(temp_path, file_path).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                if attempt >= MAX_ATTEMPTS || !is_transient_file_lock(&error) {
                    return Err(format!("Could not finish the download: {error}"));
                }
                tokio::time::sleep(Duration::from_millis(150 * u64::from(attempt))).await;
                attempt += 1;
            }
        }
    }
}

fn is_transient_file_lock(error: &std::io::Error) -> bool {
    // Windows: 32 = ERROR_SHARING_VIOLATION, 5 = ERROR_ACCESS_DENIED (a scanner holds the file).
    matches!(error.raw_os_error(), Some(5 | 32))
}

/// Persists a finished download into the library table so it shows on the Downloads
/// page and marks its source as downloaded. Best-effort — a DB error never fails it.
async fn record_completed_download(context: &DownloadContext) {
    let file_size_bytes = tokio::fs::metadata(&context.file_path)
        .await
        .ok()
        .and_then(|metadata| i64::try_from(metadata.len()).ok());
    let media_kind = match context.media_kind {
        DownloadMediaKind::Video => "video",
        DownloadMediaKind::Music => "music",
        DownloadMediaKind::Audio => "audio",
    };
    let record = DownloadRecord {
        id: None,
        video_id: context.video_id.clone(),
        title: context.title.clone(),
        author: context.author.clone(),
        media_kind: media_kind.to_string(),
        file_path: context.file_path.to_string_lossy().into_owned(),
        thumbnail_url: context.thumbnail_url.clone(),
        duration_seconds: context
            .duration_seconds
            .and_then(|seconds| i64::try_from(seconds).ok()),
        quality_label: Some(context.quality_label.clone()),
        file_size_bytes,
        collection_db_id: context.collection_db_id,
        created_at: String::new(),
    };
    if let Err(error) = crate::db::downloads::upsert_download(&context.pool, &record).await {
        tracing::warn!(%error, "Failed to record completed download in the library");
    }
}

async fn cleanup_partial_files(context: &DownloadContext) {
    let _ = tokio::fs::remove_file(&context.temp_path).await;
    for worker in 0..u64::from(context.threads) {
        let _ = tokio::fs::remove_file(part_path(&context.temp_path, worker)).await;
    }
}

async fn cleanup_adaptive_files(context: &DownloadContext, adaptive: &AdaptiveDownloadContext) {
    cleanup_partial_files(context).await;
    let video_context = child_download_context(context, adaptive.video_path.clone());
    let audio_context = child_download_context(context, adaptive.audio_path.clone());
    cleanup_partial_files(&video_context).await;
    cleanup_partial_files(&audio_context).await;
}

fn emit_terminal_error(context: &DownloadContext, app: &AppHandle, error: String, kind: &str) {
    tracing::warn!(id = %context.id, video_id = ?context.video_id, kind, error = %error, "download_failed");
    let _ = app.emit(
        DOWNLOAD_EVENT,
        DownloadProgress {
            id: context.id.clone(),
            title: context.title.clone(),
            media_kind: context.media_kind,
            quality_label: context.quality_label.clone(),
            file_path: context.file_path.to_string_lossy().into_owned(),
            downloaded_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Failed,
            error: Some(error.clone()),
            error_kind: Some(kind.to_string()),
            logs: vec![error],
            video_id: context.video_id.clone(),
            thumbnail_url: context.thumbnail_url.clone(),
            collection_db_id: context.collection_db_id,
        },
    );
}

fn emit_cancelled(context: &DownloadContext, app: &AppHandle) {
    let _ = app.emit(
        DOWNLOAD_EVENT,
        DownloadProgress {
            id: context.id.clone(),
            title: context.title.clone(),
            media_kind: context.media_kind,
            quality_label: context.quality_label.clone(),
            file_path: context.file_path.to_string_lossy().into_owned(),
            downloaded_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Cancelled,
            error: None,
            error_kind: None,
            logs: vec!["Download cancelled while queued".to_string()],
            video_id: context.video_id.clone(),
            thumbnail_url: context.thumbnail_url.clone(),
            collection_db_id: context.collection_db_id,
        },
    );
}

fn download_error(message: impl Into<String>) -> ErrorResponse {
    ErrorResponse::from(AppError::Streaming(message.into()))
}

#[tauri::command]
pub async fn list_downloads(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DownloadRecord>, ErrorResponse> {
    crate::db::downloads::list_downloads(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_downloaded_video_ids(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<String>, ErrorResponse> {
    crate::db::downloads::downloaded_video_ids(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_downloads(
    ids: Vec<i64>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    let records = crate::db::downloads::downloads_by_ids(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)?;
    for record in &records {
        remove_download_files(Path::new(&record.file_path)).await;
    }
    crate::db::downloads::delete_downloads(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn clear_downloads(pool: State<'_, SqlitePool>) -> Result<(), ErrorResponse> {
    let records = crate::db::downloads::list_downloads(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    for record in &records {
        remove_download_files(Path::new(&record.file_path)).await;
    }
    crate::db::downloads::clear_downloads(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineStreamInfo {
    pub url: String,
    pub content_type: String,
    /// Loopback URL for the cover art saved beside the media file, when present.
    pub artwork_url: Option<String>,
    /// Text of the lyrics saved beside the media file, when present.
    pub lyrics: Option<String>,
}

/// Cover art and lyrics are written next to the media file when a download
/// finishes (see `sidecars::write_sidecars`). They are located by convention
/// rather than recorded in the database, so downloads saved before this was
/// wired up are picked up too.
async fn find_artwork_sidecar(media_path: &str) -> Option<(String, String)> {
    for (extension, content_type) in [
        ("jpg", "image/jpeg"),
        ("png", "image/png"),
        ("webp", "image/webp"),
    ] {
        let candidate = Path::new(media_path).with_extension(extension);
        if tokio::fs::metadata(&candidate).await.is_ok() {
            return Some((
                candidate.to_string_lossy().into_owned(),
                content_type.to_string(),
            ));
        }
    }
    None
}

async fn read_lyrics_sidecar(media_path: &str) -> Option<String> {
    let path = Path::new(media_path).with_extension("lrc");
    tokio::fs::read_to_string(path)
        .await
        .ok()
        .filter(|text| !text.trim().is_empty())
}

/// Resolves a loopback URL that serves a downloaded file straight from disk, so
/// playback is fully offline — no stream re-resolution, no network. The path is
/// taken from the persisted download record (never from the caller), and the
/// kind must match the playback surface (a saved audio track is not a video).
#[tauri::command]
pub async fn get_offline_stream(
    video_id: String,
    media_kind: DownloadMediaKind,
    pool: State<'_, SqlitePool>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<OfflineStreamInfo, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    let record = crate::db::downloads::download_by_video_id(&pool, &video_id)
        .await
        .map_err(ErrorResponse::from)?
        .filter(|record| media_kind_matches(&record.media_kind, media_kind))
        .ok_or_else(|| download_error("No saved download for this item"))?;

    if tokio::fs::metadata(&record.file_path).await.is_err() {
        return Err(download_error("The downloaded file is no longer available"));
    }

    let content_type = offline_content_type(&record.file_path, media_kind);
    let token = Uuid::new_v4().to_string();
    streaming_manager.register_local_session(
        token.clone(),
        record.file_path.clone(),
        content_type.clone(),
    );
    let port = streaming_manager.get_port();

    let artwork_url = match find_artwork_sidecar(&record.file_path).await {
        Some((path, image_type)) => {
            let artwork_token = Uuid::new_v4().to_string();
            streaming_manager.register_local_session(artwork_token.clone(), path, image_type);
            Some(format!("http://127.0.0.1:{port}/stream/{artwork_token}"))
        }
        None => None,
    };

    Ok(OfflineStreamInfo {
        url: format!("http://127.0.0.1:{port}/stream/{token}"),
        content_type,
        artwork_url,
        lyrics: read_lyrics_sidecar(&record.file_path).await,
    })
}

fn media_kind_matches(stored: &str, requested: DownloadMediaKind) -> bool {
    match requested {
        DownloadMediaKind::Video => stored == "video",
        DownloadMediaKind::Music | DownloadMediaKind::Audio => {
            stored == "music" || stored == "audio"
        }
    }
}

// Best-effort MIME from the file extension. Our Matroska output (.mkv) carries
// WebM-family codecs (VP8/VP9/AV1 + Opus), which Chromium plays when labelled
// as webm.
fn offline_content_type(path: &str, media_kind: DownloadMediaKind) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_video = matches!(media_kind, DownloadMediaKind::Video);
    match extension.as_str() {
        "mp4" | "m4v" => {
            if is_video {
                "video/mp4"
            } else {
                "audio/mp4"
            }
        }
        "m4a" => "audio/mp4",
        "webm" | "mkv" => {
            if is_video {
                "video/webm"
            } else {
                "audio/webm"
            }
        }
        "opus" | "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        _ => {
            if is_video {
                "video/mp4"
            } else {
                "audio/mp4"
            }
        }
    }
    .to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCollectionRequest {
    pub collection_id: String,
    pub kind: String,
    pub title: String,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
    pub total_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCollection {
    pub id: i64,
    pub folder_path: String,
    /// Items already saved in this collection, so the orchestrator can skip them.
    pub existing_video_ids: Vec<String>,
}

/// Creates (or reuses) a playlist/album collection folder and DB row, returning the
/// destination folder each item should download into. Re-downloading the same
/// collection resumes into the existing folder instead of duplicating it.
#[tauri::command]
pub async fn create_download_collection(
    request: CreateCollectionRequest,
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<CreatedCollection, ErrorResponse> {
    let title = request.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 240 {
        return Err(ErrorResponse::from(AppError::Validation(
            "Collection title must contain between 1 and 240 characters".into(),
        )));
    }
    let media_kind = match request.kind.as_str() {
        "album" => DownloadMediaKind::Music,
        "playlist" => DownloadMediaKind::Video,
        other => {
            return Err(ErrorResponse::from(AppError::Validation(format!(
                "Unknown collection kind `{other}`"
            ))));
        }
    };

    if let Some(existing) = crate::db::download_collections::find_collection(
        &pool,
        &request.collection_id,
        &request.kind,
    )
    .await
    .map_err(ErrorResponse::from)?
    {
        let id = existing.id.unwrap_or_default();
        crate::db::download_collections::set_total_count(&pool, id, request.total_count)
            .await
            .map_err(ErrorResponse::from)?;
        let existing_video_ids = crate::db::download_collections::collection_video_ids(&pool, id)
            .await
            .map_err(ErrorResponse::from)?;
        tokio::fs::create_dir_all(&existing.folder_path)
            .await
            .map_err(|error| {
                download_error(format!("Could not open collection folder: {error}"))
            })?;
        return Ok(CreatedCollection {
            id,
            folder_path: existing.folder_path,
            existing_video_ids,
        });
    }

    let base = resolve_destination_directory(&app, media_kind, None)?;
    let folder = base.join(sanitize_file_stem(&title));
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|error| download_error(format!("Could not create collection folder: {error}")))?;
    let folder_path = folder.to_string_lossy().into_owned();

    let record = DownloadCollectionRecord {
        id: None,
        collection_id: request.collection_id,
        kind: request.kind,
        title,
        author: request.author,
        thumbnail_url: request.thumbnail_url,
        folder_path: folder_path.clone(),
        total_count: request.total_count,
        created_at: String::new(),
        downloaded_count: 0,
    };
    let id = crate::db::download_collections::insert_collection(&pool, &record)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(CreatedCollection {
        id,
        folder_path,
        existing_video_ids: Vec::new(),
    })
}

#[tauri::command]
pub async fn list_download_collections(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DownloadCollectionRecord>, ErrorResponse> {
    crate::db::download_collections::list_collections(&pool)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn delete_download_collections(
    ids: Vec<i64>,
    pool: State<'_, SqlitePool>,
) -> Result<(), ErrorResponse> {
    let collections = crate::db::download_collections::collections_by_ids(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)?;
    for collection in &collections {
        if let Some(id) = collection.id {
            let records = crate::db::downloads::downloads_for_collection(&pool, id)
                .await
                .unwrap_or_default();
            for record in &records {
                remove_download_files(Path::new(&record.file_path)).await;
            }
        }
        // Only removes the folder if our files left it empty (never nukes unrelated content).
        let _ = tokio::fs::remove_dir(&collection.folder_path).await;
    }
    crate::db::download_collections::delete_collection_items(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)?;
    crate::db::download_collections::delete_collections(&pool, &ids)
        .await
        .map_err(ErrorResponse::from)
}

/// Removes a downloaded media file along with its best-effort companion sidecars.
async fn remove_download_files(media_path: &Path) {
    let _ = tokio::fs::remove_file(media_path).await;
    for extension in ["jpg", "png", "webp", "sponsorblock.json", "lrc"] {
        let _ = tokio::fs::remove_file(media_path.with_extension(extension)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DownloadContainer, DownloadMediaKind, extension_for_content_type, has_container_signature,
        parse_content_range, sanitize_file_stem,
    };

    #[test]
    fn sanitizes_cross_platform_file_names() {
        assert_eq!(sanitize_file_stem("A/B:C*D?"), "A_B_C_D_");
        assert_eq!(sanitize_file_stem("CON"), "_CON");
        assert_eq!(sanitize_file_stem("  title.  "), "title");
    }

    #[test]
    fn preserves_the_source_container() {
        assert_eq!(
            extension_for_content_type("audio/webm; codecs=opus", DownloadMediaKind::Music),
            "webm"
        );
        assert_eq!(
            extension_for_content_type("audio/mp4; codecs=mp4a", DownloadMediaKind::Music),
            "m4a"
        );
        assert_eq!(
            extension_for_content_type("video/mp4", DownloadMediaKind::Video),
            "mp4"
        );
    }

    #[test]
    fn parses_and_validates_http_content_ranges() {
        assert_eq!(
            parse_content_range("bytes 1048576-2097151/8388608"),
            Some((1_048_576, 2_097_151, Some(8_388_608)))
        );
        assert_eq!(parse_content_range("bytes 0-99/*"), Some((0, 99, None)));
        assert_eq!(parse_content_range("garbage"), None);
    }

    #[test]
    fn recognizes_muxer_input_container_signatures() {
        assert!(has_container_signature(
            &[0x1A, 0x45, 0xDF, 0xA3, 0x9F],
            DownloadContainer::Mkv
        ));
        assert!(has_container_signature(
            &[0, 0, 0, 24, b'f', b't', b'y', b'p'],
            DownloadContainer::Mp4
        ));
        assert!(!has_container_signature(
            &[0, 0, 0, 0, 0, 0, 0, 0],
            DownloadContainer::Mkv
        ));
    }
}
