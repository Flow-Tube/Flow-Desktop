//! One download from its slot to its library row: resolve links, transfer the
//! tracks, package them into a tagged file, then record it. A failed job keeps its
//! partial files and its row so Retry continues where it stopped.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::AppHandle;

use super::metadata::{self, PreparedMetadata};
use super::progress::{DownloadStatus, ProgressEmitter, ProgressInfo};
use super::source::{Resolved, Role, SourceSlot};
use super::tags::{DownloadTags, TagKind};
use super::transfer::{self, TrackFetch};
use super::{
    DownloadControl, DownloadManager, DownloadMediaKind, StartDownloadRequest, muxer, sidecars,
    subtitles,
};
use crate::api::innertube::download::DownloadContainer;
use crate::db::downloads::DownloadRecord;
use crate::models::video::CaptionTrack;

pub struct DownloadJob {
    pub id: String,
    pub request: StartDownloadRequest,
    /// The planned final file; its extension is settled once the streams are known.
    pub file_path: PathBuf,
    pub tags: DownloadTags,
    pub control: Arc<DownloadControl>,
}

/// What a finished transfer produced.
struct Packaged {
    file: PathBuf,
    cover_in_file: bool,
    video_codec: Option<&'static str>,
    loudness_db: Option<f64>,
    captions: Vec<CaptionTrack>,
}

impl DownloadJob {
    fn dir(&self) -> PathBuf {
        self.file_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default()
    }

    fn staged(&self, suffix: &str) -> PathBuf {
        self.dir().join(format!(".{}{suffix}.flowpart", self.id))
    }

    /// Every partial file this job can leave behind.
    pub fn partial_files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for base in [
            self.staged(""),
            self.staged(".video"),
            self.staged(".audio"),
        ] {
            for worker in 0..u64::from(self.request.threads.clamp(1, 8)) {
                files.push(transfer::part_path(&base, worker));
            }
            files.push(PathBuf::from(format!("{}.m4a", base.to_string_lossy())));
            files.push(base);
        }
        files
    }

    pub fn progress_info(&self) -> ProgressInfo {
        ProgressInfo {
            id: self.id.clone(),
            title: self.request.title.clone(),
            media_kind: self.request.media_kind,
            quality_label: self.request.quality_label.clone(),
            file_path: self.file_path.to_string_lossy().into_owned(),
            video_id: Some(self.request.video_id.clone()),
            thumbnail_url: self.request.thumbnail_url.clone(),
            collection_db_id: self.request.collection_db_id,
            artist: self.tags.display_artist(),
        }
    }
}

pub async fn remove_partial_files(job: &DownloadJob) {
    for path in job.partial_files() {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub async fn run_job(app: AppHandle, manager: DownloadManager, pool: SqlitePool, job: DownloadJob) {
    let emitter = ProgressEmitter::new(&app, &manager, job.progress_info());
    let outcome = run(&app, &pool, &job, &emitter).await;
    job.control.release_slot().await;
    let cancelled = job.control.cancelled.load(Ordering::Relaxed);
    match outcome {
        Ok(()) => {
            let _ = crate::db::download_jobs::delete_job(&pool, &job.id).await;
            emitter.log("Download completed successfully");
            emitter.emit(DownloadStatus::Completed, None);
        }
        Err(_) if cancelled => {
            remove_partial_files(&job).await;
            let _ = crate::db::download_jobs::delete_job(&pool, &job.id).await;
            emitter.emit(DownloadStatus::Cancelled, None);
        }
        Err(failure) => {
            let _ = crate::db::download_jobs::set_status(
                &pool,
                &job.id,
                "failed",
                Some(&failure.message),
            )
            .await;
            emitter.emit_failure(failure.message, failure.kind);
        }
    }
    manager.finish(&job.id, &job.file_path);
}

struct Failure {
    message: String,
    kind: &'static str,
}

fn fail(kind: &'static str) -> impl Fn(String) -> Failure {
    move |message| Failure { message, kind }
}

async fn run(
    app: &AppHandle,
    pool: &SqlitePool,
    job: &DownloadJob,
    emitter: &ProgressEmitter,
) -> Result<(), Failure> {
    transfer::wait_ready(&job.control, emitter)
        .await
        .map_err(fail("internal"))?;
    let metadata_task = tokio::spawn(metadata::prepare(
        app.clone(),
        job.tags.clone(),
        job.request.thumbnail_url.clone(),
        emitter.clone(),
    ));
    // A download restored after a restart may point at a folder that is gone.
    tokio::fs::create_dir_all(job.dir())
        .await
        .map_err(|error| format!("Could not create the download folder: {error}"))
        .map_err(fail("internal"))?;
    let source = SourceSlot::open(app, &job.request)
        .await
        .map_err(fail("streaming"))?;
    let finished = match source.resolved().await {
        Resolved::Single(_) => run_single(job, &source, metadata_task, emitter).await,
        Resolved::Pair { .. } => run_pair(job, &source, metadata_task, emitter).await,
    }
    .map_err(fail("download"))?;
    finish(app, pool, job, finished, emitter).await;
    Ok(())
}

async fn run_single(
    job: &DownloadJob,
    source: &SourceSlot,
    metadata_task: tokio::task::JoinHandle<PreparedMetadata>,
    emitter: &ProgressEmitter,
) -> Result<(Packaged, PreparedMetadata), String> {
    let path = job.staged("");
    let fetch = track_fetch(job, source, Role::Single, &path, emitter, "media stream");
    let total = transfer::probe_length(&fetch).await;
    emitter.set_total(total);
    emitter.emit(DownloadStatus::Downloading, None);
    transfer::fetch_track(&fetch, total).await?;
    let prepared = metadata_task.await.unwrap_or_default();
    let mime = source.current(Role::Single).await.mime_type;
    let is_aac = mime.to_ascii_lowercase().starts_with("audio/mp4");
    let file = if is_aac {
        package_song(job, &path, &prepared, emitter).await?
    } else {
        path
    };
    let cover_in_file = is_aac && file != job.staged("") && prepared.cover.is_some();
    let extension = if is_aac {
        "m4a"
    } else {
        extension_for_mime(&mime)
    };
    Ok((
        Packaged {
            file: settle_extension(job, &file, extension).await?,
            cover_in_file,
            video_codec: None,
            loudness_db: source.current(Role::Single).await.loudness_db,
            captions: Vec::new(),
        },
        prepared,
    ))
}

async fn run_pair(
    job: &DownloadJob,
    source: &SourceSlot,
    metadata_task: tokio::task::JoinHandle<PreparedMetadata>,
    emitter: &ProgressEmitter,
) -> Result<(Packaged, PreparedMetadata), String> {
    let resolved = source.resolved().await;
    let Resolved::Pair {
        output, captions, ..
    } = resolved.clone()
    else {
        return Err("Expected a video and audio pair".into());
    };
    let (video_container, audio_container) = resolved.track_containers();
    let video_path = job.staged(".video");
    let audio_path = job.staged(".audio");
    let video = track_fetch(
        job,
        source,
        Role::Video,
        &video_path,
        emitter,
        "video track",
    );
    let audio = track_fetch(
        job,
        source,
        Role::Audio,
        &audio_path,
        emitter,
        "audio track",
    );
    let (video_total, audio_total) = tokio::join!(
        transfer::probe_length(&video),
        transfer::probe_length(&audio)
    );
    emitter.set_total(video_total.zip(audio_total).map(|(v, a)| v + a));
    emitter.emit(DownloadStatus::Downloading, None);
    let (video_result, audio_result) = tokio::join!(
        transfer::fetch_track(&video, video_total),
        transfer::fetch_track(&audio, audio_total)
    );
    video_result?;
    audio_result?;
    transfer::ensure_valid_track(&video, video_container, video_total).await?;
    transfer::ensure_valid_track(&audio, audio_container, audio_total).await?;

    emitter.emit(DownloadStatus::Muxing, None);
    let prepared = metadata_task.await.unwrap_or_default();
    let tracks = MuxTracks {
        output,
        video: (video_path.clone(), video_container),
        audio: (audio_path.clone(), audio_container),
    };
    mux_pair(job, source, &tracks, &prepared, emitter).await?;
    let _ = tokio::fs::remove_file(&video_path).await;
    let _ = tokio::fs::remove_file(&audio_path).await;
    let extension = match output {
        DownloadContainer::Mp4 => "mp4",
        DownloadContainer::Mkv => "mkv",
    };
    Ok((
        Packaged {
            file: settle_extension(job, &job.staged(""), extension).await?,
            cover_in_file: prepared.cover.is_some(),
            video_codec: resolved.video_codec(),
            loudness_db: None,
            captions,
        },
        prepared,
    ))
}

struct MuxTracks {
    output: DownloadContainer,
    video: (PathBuf, DownloadContainer),
    audio: (PathBuf, DownloadContainer),
}

/// Writes the two downloaded tracks into the tagged output file and checks it.
async fn mux_pair(
    job: &DownloadJob,
    source: &SourceSlot,
    tracks: &MuxTracks,
    prepared: &PreparedMetadata,
    emitter: &ProgressEmitter,
) -> Result<(), String> {
    let embedded = muxer::EmbeddedMetadata {
        tags: prepared.tags.clone(),
        cover: prepared.cover.clone(),
        chapters: prepared
            .chapters
            .iter()
            .map(|chapter| muxer::EmbeddedChapter {
                start_ms: chapter.start_seconds.saturating_mul(1000),
                title: chapter.title.clone(),
            })
            .collect(),
    };
    let expectation = muxer::validate::OutputExpectation {
        video: true,
        audio: true,
        duration_seconds: expected_seconds(job),
    };
    let video_mime = source.current(Role::Video).await.mime_type;
    let audio_mime = source.current(Role::Audio).await.mime_type;
    let output = tracks.output;
    let (video_path, video_container) = tracks.video.clone();
    let (audio_path, audio_container) = tracks.audio.clone();
    let output_path = job.staged("");
    let control = job.control.clone();
    emitter.log("Tracks downloaded; writing the file");
    tokio::task::spawn_blocking(move || {
        muxer::mux_adaptive_tracks(
            output,
            muxer::TrackInput {
                path: &video_path,
                container: video_container,
                mime_type: &video_mime,
            },
            muxer::TrackInput {
                path: &audio_path,
                container: audio_container,
                mime_type: &audio_mime,
            },
            &output_path,
            Some(&embedded),
            &control.cancelled,
        )?;
        match output {
            DownloadContainer::Mp4 => muxer::validate::validate_mp4(&output_path, expectation),
            DownloadContainer::Mkv => muxer::validate::validate_matroska(&output_path, expectation),
        }
    })
    .await
    .map_err(|error| format!("The muxer stopped unexpectedly: {error}"))?
}

fn track_fetch<'a>(
    job: &'a DownloadJob,
    source: &'a SourceSlot,
    role: Role,
    path: &'a Path,
    emitter: &'a ProgressEmitter,
    label: &'static str,
) -> TrackFetch<'a> {
    TrackFetch {
        source,
        role,
        path,
        parallel: job.request.parallel,
        threads: job.request.threads.clamp(1, 8),
        control: &job.control,
        emitter,
        label,
    }
}

fn expected_seconds(job: &DownloadJob) -> Option<f64> {
    job.request
        .duration_seconds
        .map(|seconds| f64::from(u32::try_from(seconds).unwrap_or(u32::MAX)))
}

fn extension_for_mime(mime: &str) -> &'static str {
    let mime = mime.to_ascii_lowercase();
    if mime.contains("webm") {
        "webm"
    } else if mime.contains("ogg") || mime.contains("opus") {
        "ogg"
    } else if mime.contains("mpeg") {
        "mp3"
    } else {
        "m4a"
    }
}

/// Moves the packaged file to its final name, changing the planned extension when
/// the streams turned out to need another container.
async fn settle_extension(
    job: &DownloadJob,
    packaged: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    let planned = &job.file_path;
    let target = if planned
        .extension()
        .is_some_and(|current| current.eq_ignore_ascii_case(extension))
    {
        planned.clone()
    } else {
        let stem = planned
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        super::naming::available_file_path(&job.dir(), &stem, extension, &HashSet::default())
    };
    finalize_download_file(packaged, &target).await?;
    Ok(target)
}

/// Turns a downloaded AAC song into a progressive, tagged M4A and returns the file to
/// finalize. A song whose length is wrong fails the download; a remux error keeps the
/// original stream, which still plays.
async fn package_song(
    job: &DownloadJob,
    input: &Path,
    prepared: &PreparedMetadata,
    emitter: &ProgressEmitter,
) -> Result<PathBuf, String> {
    emitter.emit(DownloadStatus::Muxing, None);
    let output = PathBuf::from(format!("{}.m4a", input.to_string_lossy()));
    let metadata = muxer::EmbeddedMetadata {
        tags: prepared.tags.clone(),
        cover: prepared.cover.clone(),
        chapters: Vec::new(),
    };
    let expectation = muxer::validate::OutputExpectation {
        video: false,
        audio: true,
        duration_seconds: expected_seconds(job),
    };
    let control = job.control.clone();
    let (source, staged) = (input.to_path_buf(), output.clone());
    let remuxed = tokio::task::spawn_blocking(move || {
        muxer::remux_audio_to_m4a(&source, &staged, Some(&metadata), &control.cancelled)
    })
    .await
    .map_err(|error| format!("Audio packaging stopped unexpectedly: {error}"))?;
    if let Err(error) = remuxed {
        let _ = tokio::fs::remove_file(&output).await;
        emitter.log(format!("Kept the song as it was downloaded: {error}"));
        return Ok(input.to_path_buf());
    }
    let checked = output.clone();
    let valid =
        tokio::task::spawn_blocking(move || muxer::validate::validate_mp4(&checked, expectation))
            .await
            .map_err(|error| format!("The song check stopped unexpectedly: {error}"))?;
    if let Err(error) = valid {
        let _ = tokio::fs::remove_file(&output).await;
        return Err(error);
    }
    let _ = tokio::fs::remove_file(input).await;
    Ok(output)
}

pub async fn finalize_download_file(temp_path: &Path, file_path: &Path) -> Result<(), String> {
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

/// Everything after the file has its final name: Flow's cover copy, companion files
/// and the library row.
async fn finish(
    app: &AppHandle,
    pool: &SqlitePool,
    job: &DownloadJob,
    (packaged, prepared): (Packaged, PreparedMetadata),
    emitter: &ProgressEmitter,
) {
    if let Ok(metadata) = tokio::fs::metadata(&packaged.file).await {
        emitter.downloaded.store(metadata.len(), Ordering::Relaxed);
    }
    let cover_path = match prepared.cover.as_deref() {
        Some(cover) => sidecars::store_cover(app, &job.id, cover).await,
        None => None,
    };
    sidecars::write_sidecars(
        &sidecars::FinishedFile {
            media_kind: job.request.media_kind,
            media_path: &packaged.file,
            cover: prepared.cover.as_deref(),
            cover_in_file: packaged.cover_in_file,
        },
        emitter,
        pool,
    )
    .await;
    let sponsorblock = if matches!(job.request.media_kind, DownloadMediaKind::Video) {
        sidecars::sponsorblock_segments(pool, &job.request.video_id, emitter).await
    } else {
        None
    };
    let subtitles = save_subtitles(app, job, &packaged, emitter).await;
    record_completed_download(
        pool,
        job,
        &packaged,
        &prepared,
        Extras {
            cover_path,
            sponsorblock_json: sponsorblock,
            subtitles_json: subtitles,
        },
    )
    .await;
}

async fn save_subtitles(
    app: &AppHandle,
    job: &DownloadJob,
    packaged: &Packaged,
    emitter: &ProgressEmitter,
) -> Option<String> {
    let choice = job.request.subtitle.as_ref()?;
    let Some(track) = subtitles::pick_track(&packaged.captions, choice) else {
        emitter.log(format!(
            "This video has no {} subtitles to save",
            choice.language_code
        ));
        return None;
    };
    let saved = subtitles::save_subtitle(app, &job.id, &packaged.file, track, emitter).await?;
    serde_json::to_string(&[saved]).ok()
}

/// What `finish` saved beside the file, recorded with it.
struct Extras {
    cover_path: Option<String>,
    sponsorblock_json: Option<String>,
    subtitles_json: Option<String>,
}

/// Persists a finished download into the library. A download of the same item and
/// kind in the same place replaces the old one, whose file is then removed.
async fn record_completed_download(
    pool: &SqlitePool,
    job: &DownloadJob,
    packaged: &Packaged,
    prepared: &PreparedMetadata,
    extras: Extras,
) {
    let file_size_bytes = tokio::fs::metadata(&packaged.file)
        .await
        .ok()
        .and_then(|metadata| i64::try_from(metadata.len()).ok());
    let request = &job.request;
    let tags = &prepared.tags;
    let record = DownloadRecord {
        id: None,
        video_id: Some(request.video_id.clone()),
        title: request.title.clone(),
        author: tags.display_artist().or_else(|| request.author.clone()),
        media_kind: request.media_kind.as_str().to_string(),
        file_path: packaged.file.to_string_lossy().into_owned(),
        thumbnail_url: request.thumbnail_url.clone(),
        duration_seconds: request
            .duration_seconds
            .and_then(|seconds| i64::try_from(seconds).ok()),
        quality_label: Some(request.quality_label.clone()),
        file_size_bytes,
        collection_db_id: request.collection_db_id,
        loudness_db: request
            .loudness_db
            .or(packaged.loudness_db)
            .filter(|db| db.is_finite()),
        created_at: String::new(),
        cover_path: extras.cover_path,
        artists_json: (!tags.artists.is_empty())
            .then(|| serde_json::to_string(&tags.artists).ok())
            .flatten(),
        album: tags.album.clone(),
        album_id: tags.album_id.clone(),
        album_artist: tags.album_artist.clone(),
        track_number: tags.track_number.map(i64::from),
        track_total: tags.track_total.map(i64::from),
        release_date: tags.release_date.clone(),
        description: tags.description.clone(),
        channel_id: tags.channel_id.clone(),
        container: packaged
            .file
            .extension()
            .map(|extension| extension.to_string_lossy().to_ascii_lowercase()),
        video_codec: packaged.video_codec.map(ToOwned::to_owned),
        chapters_json: (!prepared.chapters.is_empty())
            .then(|| serde_json::to_string(&prepared.chapters).ok())
            .flatten(),
        sponsorblock_json: extras.sponsorblock_json,
        subtitles_json: extras.subtitles_json,
        cover_url: None,
    };
    match crate::db::downloads::upsert_download(pool, &record).await {
        Ok(replaced) => {
            for old in replaced {
                if old.file_path != record.file_path {
                    super::remove_download_files(&old).await;
                }
            }
        }
        Err(error) => {
            tracing::warn!(%error, "Failed to record completed download in the library");
        }
    }
}

/// The tags a request starts with: what the caller sent, plus the kind, id, title and
/// channel the request itself names.
pub fn request_download_tags(request: &StartDownloadRequest) -> DownloadTags {
    let mut tags = request.tags.clone().unwrap_or_default();
    tags.kind = match request.media_kind {
        DownloadMediaKind::Video => TagKind::Video,
        DownloadMediaKind::Music | DownloadMediaKind::Audio => TagKind::Music,
    };
    tags.video_id.clone_from(&request.video_id);
    tags.title.clone_from(&request.title);
    if tags.channel_name.is_none() {
        tags.channel_name = request.author.clone().filter(|name| !name.is_empty());
    }
    if tags.thumbnail_url.is_none() {
        tags.thumbnail_url.clone_from(&request.thumbnail_url);
    }
    tags.lyrics = None;
    tags
}
