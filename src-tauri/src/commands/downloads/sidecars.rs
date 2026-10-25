//! Best-effort companion files written next to a finished download: the poster
//! image (both kinds), `SponsorBlock` segments for video, and lyrics for music.

use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::{DownloadMediaKind, ProgressEmitter};
use crate::commands::youtube::fetch_sponsorblock_segments;
use crate::db::settings::get_setting;
use crate::services::music_service::MusicService;

/// "Also save a poster image next to the file"; the cover is always embedded.
const POSTER_SIDECAR_KEY: &str = "download_poster_sidecar";
const COVER_STORE_DIR: &str = "download_covers";

/// Keeps Flow's own copy of the cover in app data, for the library and offline UI.
pub async fn store_cover(app: &AppHandle, id: &str, jpeg: &[u8]) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?.join(COVER_STORE_DIR);
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let path = dir.join(format!("{id}.jpg"));
    tokio::fs::write(&path, jpeg).await.ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// A download that has just been moved to its final name.
pub struct FinishedFile<'a> {
    pub media_kind: DownloadMediaKind,
    pub media_path: &'a Path,
    pub video_id: Option<&'a str>,
    pub cover: Option<&'a [u8]>,
    /// The muxer already put the cover inside the media file.
    pub cover_in_file: bool,
}

pub async fn write_sidecars(
    app: &AppHandle,
    file: &FinishedFile<'_>,
    emitter: &ProgressEmitter,
    pool: &SqlitePool,
) {
    let media_kind = file.media_kind;
    let media_path = file.media_path;
    if let Some(cover) = file.cover {
        write_cover(file, cover, emitter, pool).await;
    }

    let Some(video_id) = file.video_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return;
    };

    match media_kind {
        DownloadMediaKind::Video => match write_sponsorblock(media_path, video_id).await {
            Ok(Some(path)) => {
                emitter.log(format!(
                    "Saved SponsorBlock segments to `{}`",
                    path.display()
                ));
            }
            Ok(None) => {}
            Err(error) => emitter.log(format!("Could not save SponsorBlock segments: {error}")),
        },
        DownloadMediaKind::Music | DownloadMediaKind::Audio => {
            match write_lyrics(app, media_path, video_id).await {
                Ok(Some(path)) => emitter.log(format!("Saved lyrics to `{}`", path.display())),
                Ok(None) => {}
                Err(error) => emitter.log(format!("Could not save lyrics: {error}")),
            }
        }
    }
}

async fn write_cover(
    file: &FinishedFile<'_>,
    cover: &[u8],
    emitter: &ProgressEmitter,
    pool: &SqlitePool,
) {
    let mut embedded = file.cover_in_file;
    if !embedded
        && matches!(
            file.media_kind,
            DownloadMediaKind::Music | DownloadMediaKind::Audio
        )
    {
        // Audio saved as the original stream is tagged in place after the fact.
        match embed_cover(file.media_path.to_path_buf(), cover.to_vec()).await {
            Ok(()) => embedded = true,
            Err(error) => emitter.log(format!(
                "Could not embed cover art (saving it beside the file instead): {error}"
            )),
        }
    }
    if embedded {
        emitter.log("Embedded cover art into the media file");
    }

    let wants_sidecar = get_setting(pool, POSTER_SIDECAR_KEY)
        .await
        .ok()
        .flatten()
        .is_some_and(|value| value == "true");
    // A cover that could not go inside the file is never silently lost.
    if wants_sidecar || !embedded {
        match write_poster_file(file.media_path, cover).await {
            Ok(Some(path)) => emitter.log(format!("Saved poster image to `{}`", path.display())),
            Ok(None) => emitter.log("A file with the poster's name already exists; left it alone"),
            Err(error) => emitter.log(format!("Could not save the poster image: {error}")),
        }
    }
}

/// Writes `<media>.jpg` unless something else already owns that name.
async fn write_poster_file(media_path: &Path, jpeg: &[u8]) -> Result<Option<PathBuf>, String> {
    let path = media_path.with_extension("jpg");
    if tokio::fs::try_exists(&path).await.unwrap_or(true) {
        return Ok(None);
    }
    tokio::fs::write(&path, jpeg)
        .await
        .map_err(|error| format!("could not write image: {error}"))?;
    Ok(Some(path))
}

async fn embed_cover(media_path: PathBuf, jpeg: Vec<u8>) -> Result<(), String> {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::probe::Probe;
    use lofty::tag::{Tag, TagExt};

    tokio::task::spawn_blocking(move || {
        let tagged = Probe::open(&media_path)
            .map_err(|error| format!("could not probe media file: {error}"))?
            .read()
            .map_err(|error| format!("could not read media file: {error}"))?;
        let mut tag = tagged
            .primary_tag()
            .cloned()
            .unwrap_or_else(|| Tag::new(tagged.primary_tag_type()));
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(
            Picture::unchecked(jpeg)
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::Jpeg)
                .build(),
        );
        tag.save_to_path(&media_path, WriteOptions::default())
            .map_err(|error| format!("could not write cover art: {error}"))
    })
    .await
    .map_err(|error| format!("embed task failed: {error}"))?
}

async fn write_sponsorblock(media_path: &Path, video_id: &str) -> Result<Option<PathBuf>, String> {
    let segments = fetch_sponsorblock_segments(video_id, None)
        .await
        .map_err(|error| error.to_string())?;
    if segments.as_array().is_none_or(Vec::is_empty) {
        return Ok(None);
    }
    let body = serde_json::to_vec_pretty(&segments).map_err(|error| error.to_string())?;
    let path = media_path.with_extension("sponsorblock.json");
    tokio::fs::write(&path, body)
        .await
        .map_err(|error| format!("could not write segments: {error}"))?;
    Ok(Some(path))
}

async fn write_lyrics(
    app: &AppHandle,
    media_path: &Path,
    video_id: &str,
) -> Result<Option<PathBuf>, String> {
    let Some(music) = app.try_state::<MusicService>() else {
        return Err("music service is unavailable".to_string());
    };
    let lyrics = music
        .lyrics(video_id)
        .await
        .map_err(|error| error.to_string())?;
    let Some(text) = lyrics
        .map(|lyrics| lyrics.text)
        .filter(|text| !text.trim().is_empty())
    else {
        return Ok(None);
    };
    let path = media_path.with_extension("lrc");
    tokio::fs::write(&path, text.as_bytes())
        .await
        .map_err(|error| format!("could not write lyrics: {error}"))?;
    Ok(Some(path))
}
