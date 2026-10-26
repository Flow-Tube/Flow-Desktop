use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::api::innertube::download::{
    DownloadContainer, DownloadableFormat, pair_downloadable_formats,
};
use crate::db::download_collections::DownloadCollectionRecord;
use crate::db::download_jobs::DownloadJobRow;
use crate::db::downloads::DownloadRecord;
use crate::errors::{AppError, ErrorResponse};
use crate::models::music_stream::MusicAudioQuality;
use crate::security::validation::validate_video_id;
use crate::services::youtube_service::YoutubeService;
use crate::streaming::proxy::StreamingManager;

mod cover;
mod job;
mod metadata;
mod muxer;
mod naming;
mod progress;
mod sidecars;
mod source;
pub mod tags;
mod transfer;

use job::DownloadJob;
use progress::{DownloadProgress, DownloadStatus, ProgressEmitter};

const MAX_ACTIVE_DOWNLOADS: usize = 3;
/// Logs of this many recent downloads stay readable in the details view.
const MAX_REMEMBERED_LOGS: usize = 100;

/// The formats a video can be downloaded in. Only the choice travels back to
/// `start_download`; links are resolved when the download runs.
#[tauri::command]
pub async fn get_download_formats(
    video_id: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<Vec<DownloadableFormat>, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    let stream_info = youtube_service
        .get_stream_info(&video_id, false)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(pair_downloadable_formats(&stream_info))
}

#[derive(Clone)]
pub struct DownloadManager {
    registry: Arc<Mutex<DownloadRegistry>>,
    permits: Arc<Semaphore>,
    /// Interrupted downloads are picked up once per run of the app.
    restored: Arc<AtomicBool>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(DownloadRegistry::default())),
            permits: Arc::new(Semaphore::new(MAX_ACTIVE_DOWNLOADS)),
            restored: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Default)]
struct DownloadRegistry {
    /// Jobs that are running, waiting for a slot or paused.
    controls: HashMap<String, Arc<DownloadControl>>,
    reserved_paths: HashSet<PathBuf>,
    logs: HashMap<String, Arc<Mutex<Vec<String>>>>,
    log_order: VecDeque<String>,
    /// The latest event of every unfinished download, for a window that opens later.
    snapshots: HashMap<String, DownloadProgress>,
}

impl DownloadManager {
    fn lock(&self) -> Result<MutexGuard<'_, DownloadRegistry>, ErrorResponse> {
        self.registry
            .lock()
            .map_err(|_| download_error("Download manager is unavailable"))
    }

    fn logs_for(&self, id: &str) -> Arc<Mutex<Vec<String>>> {
        let Ok(mut registry) = self.registry.lock() else {
            return Arc::default();
        };
        if let Some(logs) = registry.logs.get(id) {
            return logs.clone();
        }
        let logs: Arc<Mutex<Vec<String>>> = Arc::default();
        registry.logs.insert(id.to_string(), logs.clone());
        registry.log_order.push_back(id.to_string());
        while registry.log_order.len() > MAX_REMEMBERED_LOGS {
            if let Some(oldest) = registry.log_order.pop_front() {
                registry.logs.remove(&oldest);
            }
        }
        logs
    }

    fn remember(&self, progress: DownloadProgress) {
        let Ok(mut registry) = self.registry.lock() else {
            return;
        };
        if matches!(
            progress.status,
            DownloadStatus::Completed | DownloadStatus::Cancelled
        ) {
            registry.snapshots.remove(&progress.id);
        } else {
            registry.snapshots.insert(progress.id.clone(), progress);
        }
    }

    fn forget(&self, id: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.snapshots.remove(id);
        }
    }

    fn snapshots(&self) -> Vec<DownloadProgress> {
        self.registry
            .lock()
            .map(|registry| registry.snapshots.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Takes a job off the running list once its task ends.
    fn finish(&self, id: &str, file_path: &Path) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.controls.remove(id);
            registry.reserved_paths.remove(file_path);
        }
    }

    fn control(&self, id: &str) -> Option<Arc<DownloadControl>> {
        self.registry
            .lock()
            .ok()
            .and_then(|registry| registry.controls.get(id).cloned())
    }

    /// Registers a job as running and returns its control, or `None` when it already is.
    fn register(&self, id: &str, file_path: &Path) -> Option<Arc<DownloadControl>> {
        let mut registry = self.registry.lock().ok()?;
        if registry.controls.contains_key(id) {
            return None;
        }
        let control = Arc::new(DownloadControl::new(self.permits.clone()));
        registry.controls.insert(id.to_string(), control.clone());
        registry.reserved_paths.insert(file_path.to_path_buf());
        Some(control)
    }
}

pub struct DownloadControl {
    cancelled: AtomicBool,
    paused: AtomicBool,
    changed: Notify,
    permits: Arc<Semaphore>,
    has_slot: AtomicBool,
    slot: tokio::sync::Mutex<Option<OwnedSemaphorePermit>>,
}

impl DownloadControl {
    fn new(permits: Arc<Semaphore>) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            changed: Notify::new(),
            permits,
            has_slot: AtomicBool::new(false),
            slot: tokio::sync::Mutex::new(None),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        self.changed.notify_waiters();
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
        self.changed.notify_waiters();
    }

    fn holds_slot(&self) -> bool {
        self.has_slot.load(Ordering::Relaxed)
    }

    /// Keeps `permit` unless another worker of the job already took a slot, in which
    /// case it goes back; true when this permit became the job's slot.
    async fn take_slot(&self, permit: OwnedSemaphorePermit) -> bool {
        let mut slot = self.slot.lock().await;
        if slot.is_some() {
            return false;
        }
        *slot = Some(permit);
        self.has_slot.store(true, Ordering::Relaxed);
        true
    }

    /// Gives the slot back; true when this call is the one that held it.
    async fn release_slot(&self) -> bool {
        let released = self.slot.lock().await.take().is_some();
        self.has_slot.store(false, Ordering::Relaxed);
        released
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadRequest {
    pub video_id: String,
    pub media_kind: DownloadMediaKind,
    pub title: String,
    pub quality_label: String,
    pub destination_directory: Option<String>,
    pub parallel: bool,
    pub threads: u8,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
    pub duration_seconds: Option<u64>,
    pub collection_db_id: Option<i64>,
    /// How much louder than the site's target the saved stream plays, so the offline copy is
    /// normalized like the streamed one.
    pub loudness_db: Option<f64>,
    /// What the caller already knows about the item (artists, album, track number,
    /// date…). The kind, id and title come from the request itself.
    #[serde(default)]
    pub tags: Option<tags::DownloadTags>,
    /// The video format chosen, for a video download.
    #[serde(default)]
    pub video: Option<VideoSelection>,
    /// The audio quality chosen, for a song.
    #[serde(default)]
    pub music: Option<MusicSelection>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSelection {
    pub format_id: String,
    pub height: Option<u64>,
    pub fps: Option<u64>,
    pub video_codec: String,
    pub container: DownloadContainer,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicSelection {
    pub quality: MusicAudioQuality,
    pub prefer_aac: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadMediaKind {
    Video,
    Music,
    Audio,
}

impl DownloadMediaKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Music => "music",
            Self::Audio => "audio",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStarted {
    pub id: String,
    pub file_path: String,
}

fn planned_extension(request: &StartDownloadRequest) -> &'static str {
    match (&request.video, &request.music) {
        (Some(video), _) => match video.container {
            DownloadContainer::Mp4 => "mp4",
            DownloadContainer::Mkv => "mkv",
        },
        (None, Some(music)) if !music.prefer_aac => "webm",
        _ => "m4a",
    }
}

#[tauri::command]
pub async fn start_download(
    mut request: StartDownloadRequest,
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<DownloadStarted, ErrorResponse> {
    validate_video_id(&request.video_id).map_err(ErrorResponse::from)?;
    request.title = request.title.trim().to_string();
    if request.title.is_empty() || request.title.chars().count() > 240 {
        return Err(ErrorResponse::from(AppError::Validation(
            "Download title must contain between 1 and 240 characters".into(),
        )));
    }
    let valid_choice = matches!(
        (&request.video, &request.music, request.media_kind),
        (Some(_), None, DownloadMediaKind::Video)
            | (
                None,
                Some(_),
                DownloadMediaKind::Music | DownloadMediaKind::Audio
            )
    );
    if !valid_choice {
        return Err(ErrorResponse::from(AppError::Validation(
            "A download needs one video quality or one music quality".into(),
        )));
    }

    let directory = naming::resolve_destination_directory(
        &app,
        request.media_kind,
        request.destination_directory.as_deref(),
    )?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| download_error(format!("Could not create download folder: {error}")))?;

    let tags = job::request_download_tags(&request);
    let stem = naming::download_file_stem(
        &request.title,
        request.media_kind,
        &tags,
        request.collection_db_id.is_some(),
    );
    let id = Uuid::new_v4().to_string();
    let file_path = {
        let registry = manager.lock()?;
        naming::available_file_path(
            &directory,
            &stem,
            planned_extension(&request),
            &registry.reserved_paths,
        )
    };
    let control = manager
        .register(&id, &file_path)
        .ok_or_else(|| download_error("Download manager is unavailable"))?;
    let request_json = serde_json::to_string(&request)
        .map_err(|error| download_error(format!("Could not save the download: {error}")))?;
    if let Err(error) = crate::db::download_jobs::insert_job(
        &pool,
        &id,
        &request_json,
        &file_path.to_string_lossy(),
    )
    .await
    {
        manager.finish(&id, &file_path);
        return Err(ErrorResponse::from(error));
    }

    let job = DownloadJob {
        id: id.clone(),
        request,
        file_path: file_path.clone(),
        tags,
        control,
    };
    ProgressEmitter::new(&app, &manager, job.progress_info()).emit(DownloadStatus::Queued, None);
    spawn_job(&app, &manager, &pool, job);
    Ok(DownloadStarted {
        id,
        file_path: file_path.to_string_lossy().into_owned(),
    })
}

fn spawn_job(app: &AppHandle, manager: &DownloadManager, pool: &SqlitePool, job: DownloadJob) {
    tauri::async_runtime::spawn(job::run_job(
        app.clone(),
        manager.clone(),
        pool.clone(),
        job,
    ));
}

/// Rebuilds a job from its saved row. `None` when another task is already running it.
fn job_from_row(manager: &DownloadManager, row: &DownloadJobRow) -> Option<DownloadJob> {
    let request: StartDownloadRequest = serde_json::from_str(&row.request_json).ok()?;
    let file_path = PathBuf::from(&row.file_path);
    let control = manager.register(&row.id, &file_path)?;
    Some(DownloadJob {
        id: row.id.clone(),
        tags: job::request_download_tags(&request),
        request,
        file_path,
        control,
    })
}

#[tauri::command]
pub async fn cancel_download(
    id: String,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    if let Some(control) = manager.control(&id) {
        control.cancel();
        return Ok(true);
    }
    discard_idle_job(&id, &manager, &pool).await
}

/// Removes a failed download that is not running: its partial files, its row and
/// its card.
#[tauri::command]
pub async fn discard_download(
    id: String,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    cancel_download(id, manager, pool).await
}

async fn discard_idle_job(
    id: &str,
    manager: &DownloadManager,
    pool: &SqlitePool,
) -> Result<bool, ErrorResponse> {
    manager.forget(id);
    let Some(row) = crate::db::download_jobs::job(pool, id)
        .await
        .map_err(ErrorResponse::from)?
    else {
        return Ok(false);
    };
    if let Some(job) = job_from_row(manager, &row) {
        job::remove_partial_files(&job).await;
        manager.finish(&job.id, &job.file_path);
    }
    crate::db::download_jobs::delete_job(pool, id)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

#[tauri::command]
pub async fn pause_download(
    id: String,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    set_download_paused(&id, true, &manager, &pool).await
}

#[tauri::command]
pub async fn resume_download(
    id: String,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    set_download_paused(&id, false, &manager, &pool).await
}

async fn set_download_paused(
    id: &str,
    paused: bool,
    manager: &DownloadManager,
    pool: &SqlitePool,
) -> Result<bool, ErrorResponse> {
    let Some(control) = manager.control(id) else {
        return Ok(false);
    };
    control.set_paused(paused);
    let status = if paused { "paused" } else { "queued" };
    crate::db::download_jobs::set_status(pool, id, status, None)
        .await
        .map_err(ErrorResponse::from)?;
    Ok(true)
}

/// Starts a failed download again; it continues from its partial files.
#[tauri::command]
pub async fn retry_download(
    id: String,
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<bool, ErrorResponse> {
    let Some(row) = crate::db::download_jobs::job(&pool, &id)
        .await
        .map_err(ErrorResponse::from)?
    else {
        return Ok(false);
    };
    let Some(job) = job_from_row(&manager, &row) else {
        return Ok(false);
    };
    crate::db::download_jobs::set_status(&pool, &id, "queued", None)
        .await
        .map_err(ErrorResponse::from)?;
    ProgressEmitter::new(&app, &manager, job.progress_info()).emit(DownloadStatus::Queued, None);
    spawn_job(&app, &manager, &pool, job);
    Ok(true)
}

/// Picks up downloads a previous run left unfinished (once per run) and returns the
/// state of every unfinished download, so a window can show them straight away.
#[tauri::command]
pub async fn restore_downloads(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DownloadProgress>, ErrorResponse> {
    if !manager.restored.swap(true, Ordering::Relaxed) {
        let rows = crate::db::download_jobs::list_jobs(&pool)
            .await
            .map_err(ErrorResponse::from)?;
        remove_orphaned_partials(&app, &pool, &rows).await;
        for row in &rows {
            let Some(job) = job_from_row(&manager, row) else {
                continue;
            };
            let emitter = ProgressEmitter::new(&app, &manager, job.progress_info());
            match row.status.as_str() {
                "failed" => {
                    manager.finish(&job.id, &job.file_path);
                    emitter.emit(DownloadStatus::Failed, row.error.clone());
                }
                status => {
                    if status == "paused" {
                        job.control.set_paused(true);
                    }
                    emitter.emit(DownloadStatus::Queued, None);
                    spawn_job(&app, &manager, &pool, job);
                }
            }
        }
    }
    Ok(manager.snapshots())
}

/// Deletes hidden partial files that no saved download owns, left by a crash or by
/// downloads from before jobs were saved.
async fn remove_orphaned_partials(app: &AppHandle, pool: &SqlitePool, rows: &[DownloadJobRow]) {
    let owned: HashSet<&str> = rows.iter().map(|row| row.id.as_str()).collect();
    let mut folders: HashSet<PathBuf> = rows
        .iter()
        .filter_map(|row| Path::new(&row.file_path).parent().map(Path::to_path_buf))
        .collect();
    for kind in [DownloadMediaKind::Video, DownloadMediaKind::Music] {
        if let Ok(folder) = naming::resolve_destination_directory(app, kind, None) {
            folders.insert(folder);
        }
    }
    for key in ["download_location", "music_download_location"] {
        if let Ok(Some(custom)) = crate::db::settings::get_setting(pool, key).await
            && !custom.trim().is_empty()
        {
            folders.insert(PathBuf::from(custom.trim()));
        }
    }
    if let Ok(collections) = crate::db::download_collections::list_collections(pool).await {
        folders.extend(
            collections
                .into_iter()
                .map(|collection| PathBuf::from(collection.folder_path)),
        );
    }
    for folder in folders {
        let Ok(mut entries) = tokio::fs::read_dir(&folder).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_orphaned_partial(&name, &owned) {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
}

fn is_orphaned_partial(name: &str, owned: &HashSet<&str>) -> bool {
    if !name.contains(".flowpart") {
        return false;
    }
    if name.contains(".retag.flowpart") {
        return true;
    }
    let Some(rest) = name.strip_prefix('.') else {
        return false;
    };
    let id = rest.split('.').next().unwrap_or_default();
    Uuid::parse_str(id).is_ok() && !owned.contains(id)
}

#[tauri::command]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // Tauri commands deserialize owned arguments and State.
pub fn get_download_logs(id: String, manager: State<'_, DownloadManager>) -> Vec<String> {
    manager
        .logs_for(&id)
        .lock()
        .map(|logs| logs.clone())
        .unwrap_or_default()
}

fn download_error(message: impl Into<String>) -> ErrorResponse {
    ErrorResponse::from(AppError::Streaming(message.into()))
}

#[tauri::command]
pub async fn list_downloads(
    pool: State<'_, SqlitePool>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Vec<DownloadRecord>, ErrorResponse> {
    let mut records = crate::db::downloads::list_downloads(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    for record in &mut records {
        record.cover_url = cover_url(&streaming_manager, record);
    }
    Ok(records)
}

/// A stable loopback link to a download's stored cover, served on the image port
/// so artwork shows without a network connection.
fn cover_url(streaming_manager: &StreamingManager, record: &DownloadRecord) -> Option<String> {
    let path = record.cover_path.as_deref()?;
    if !Path::new(path).is_file() {
        return None;
    }
    let token = format!("download-cover-{}", record.id?);
    streaming_manager.register_local_session(
        token.clone(),
        path.to_string(),
        "image/jpeg".to_string(),
    );
    Some(format!(
        "http://127.0.0.1:{}/stream/{token}",
        streaming_manager.get_image_port()
    ))
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
        remove_download_files(record).await;
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
        remove_download_files(record).await;
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
    /// The loudness recorded when the file was downloaded.
    pub loudness_db: Option<f64>,
}

/// Downloads saved before Flow kept its own cover copy have their poster next to
/// the media file instead; this finds it by name.
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

    let record =
        crate::db::downloads::download_by_video_id(&pool, &video_id, media_kind_names(media_kind))
            .await
            .map_err(ErrorResponse::from)?
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

    let stored_cover = match record.cover_path.as_deref() {
        Some(path) if tokio::fs::try_exists(path).await.unwrap_or(false) => {
            Some((path.to_string(), "image/jpeg".to_string()))
        }
        _ => None,
    };
    let artwork = match stored_cover {
        Some(cover) => Some(cover),
        None => find_artwork_sidecar(&record.file_path).await,
    };
    let artwork_url = match artwork {
        Some((path, image_type)) => {
            let artwork_token = Uuid::new_v4().to_string();
            streaming_manager.register_local_session(artwork_token.clone(), path, image_type);
            let image_port = streaming_manager.get_image_port();
            Some(format!(
                "http://127.0.0.1:{image_port}/stream/{artwork_token}"
            ))
        }
        None => None,
    };

    Ok(OfflineStreamInfo {
        url: format!("http://127.0.0.1:{port}/stream/{token}"),
        content_type,
        artwork_url,
        lyrics: read_lyrics_sidecar(&record.file_path).await,
        loudness_db: record.loudness_db,
    })
}

/// The stored kinds that can play on a surface: a song is not a video.
fn media_kind_names(requested: DownloadMediaKind) -> &'static [&'static str] {
    match requested {
        DownloadMediaKind::Video => &["video"],
        DownloadMediaKind::Music | DownloadMediaKind::Audio => &["music", "audio"],
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
    /// The user's video or music download folder, when they chose one.
    #[serde(default)]
    pub destination_directory: Option<String>,
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

    let base = naming::resolve_destination_directory(
        &app,
        media_kind,
        request.destination_directory.as_deref(),
    )?;
    let folder_name = match (&request.kind[..], request.author.as_deref()) {
        ("album", Some(artist)) if !artist.trim().is_empty() => {
            format!("{} - {title}", artist.trim())
        }
        _ => title.clone(),
    };
    let folder = base.join(naming::sanitize_file_stem(&folder_name));
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
        cover_url: None,
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
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Vec<DownloadCollectionRecord>, ErrorResponse> {
    let mut collections = crate::db::download_collections::list_collections(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    let records = crate::db::downloads::list_downloads(&pool)
        .await
        .map_err(ErrorResponse::from)?;
    for collection in &mut collections {
        // Records arrive newest first, so the last match is the first item saved.
        collection.cover_url = records
            .iter()
            .rev()
            .filter(|record| {
                record.collection_db_id.is_some() && record.collection_db_id == collection.id
            })
            .find_map(|record| cover_url(&streaming_manager, record));
    }
    Ok(collections)
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
                remove_download_files(record).await;
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

/// Puts lyrics that arrived after a download finished into the file's `©lyr` tag.
/// Only MP4/M4A files Flow wrote progressively can be retagged.
pub async fn embed_download_lyrics(media_path: &Path, lyrics: String) -> Result<bool, String> {
    let is_mp4 = media_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "m4a" | "mp4"));
    if !is_mp4 {
        return Ok(false);
    }
    let path = media_path.to_path_buf();
    tokio::task::spawn_blocking(move || muxer::retag::set_mp4_lyrics(&path, &lyrics))
        .await
        .map_err(|error| format!("Lyrics tagging stopped unexpectedly: {error}"))??;
    Ok(true)
}

/// Removes a downloaded media file, its companion files and Flow's cover copy.
async fn remove_download_files(record: &DownloadRecord) {
    let media_path = Path::new(&record.file_path);
    let _ = tokio::fs::remove_file(media_path).await;
    for extension in ["jpg", "png", "webp", "sponsorblock.json", "lrc"] {
        let _ = tokio::fs::remove_file(media_path.with_extension(extension)).await;
    }
    if let Some(cover) = record.cover_path.as_deref() {
        let _ = tokio::fs::remove_file(cover).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{DownloadMediaKind, is_orphaned_partial, offline_content_type};
    use std::collections::HashSet;

    #[test]
    fn only_unowned_partials_are_orphans() {
        let owned: HashSet<&str> = ["0b8f8d1e-1c47-4e43-9a4c-2f0f3f6f1a10"]
            .into_iter()
            .collect();
        assert!(!is_orphaned_partial(
            ".0b8f8d1e-1c47-4e43-9a4c-2f0f3f6f1a10.video.flowpart",
            &owned
        ));
        assert!(is_orphaned_partial(
            ".5d0c1f73-8b1a-4c4f-8e0f-1b2c3d4e5f60.flowpart.part2",
            &owned
        ));
        assert!(is_orphaned_partial("Song.retag.flowpart", &owned));
        assert!(!is_orphaned_partial(".hidden.flowpart", &owned));
        assert!(!is_orphaned_partial("Song.m4a", &owned));
    }

    #[test]
    fn offline_files_get_a_playable_type() {
        assert_eq!(
            offline_content_type("/a/b.m4a", DownloadMediaKind::Music),
            "audio/mp4"
        );
        assert_eq!(
            offline_content_type("/a/b.mkv", DownloadMediaKind::Video),
            "video/webm"
        );
        assert_eq!(
            offline_content_type("/a/b.mp4", DownloadMediaKind::Video),
            "video/mp4"
        );
    }
}
