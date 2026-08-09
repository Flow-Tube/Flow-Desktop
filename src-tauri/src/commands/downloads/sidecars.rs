//! Best-effort companion files written next to a finished download: the poster
//! image (both kinds), `SponsorBlock` segments for video, and lyrics for music.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::{DownloadMediaKind, ProgressEmitter};
use crate::commands::youtube::fetch_sponsorblock_segments;
use crate::db::settings::get_setting;
use crate::services::music_service::MusicService;

const IMAGE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const THUMBNAILS_ENABLED_KEY: &str = "download_thumbnails_enabled";
const THUMBNAIL_MODE_KEY: &str = "download_thumbnail_mode";

#[derive(Clone, Copy, PartialEq, Eq)]
enum ThumbnailMode {
    Sidecar,
    Embed,
    Both,
}

pub async fn write_sidecars(
    app: &AppHandle,
    media_kind: DownloadMediaKind,
    media_path: &Path,
    video_id: Option<&str>,
    thumbnail_url: Option<&str>,
    emitter: &ProgressEmitter,
    pool: &SqlitePool,
) {
    write_poster(media_kind, media_path, thumbnail_url, emitter, pool).await;

    let Some(video_id) = video_id.map(str::trim).filter(|id| !id.is_empty()) else {
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

async fn write_poster(
    media_kind: DownloadMediaKind,
    media_path: &Path,
    thumbnail_url: Option<&str>,
    emitter: &ProgressEmitter,
    pool: &SqlitePool,
) {
    let Some(url) = thumbnail_url.map(str::trim).filter(|url| !url.is_empty()) else {
        return;
    };

    let enabled = get_setting(pool, THUMBNAILS_ENABLED_KEY)
        .await
        .ok()
        .flatten()
        .map(|value| value != "false")
        .unwrap_or(true);
    if !enabled {
        return;
    }
    let mode = match get_setting(pool, THUMBNAIL_MODE_KEY)
        .await
        .ok()
        .flatten()
        .as_deref()
    {
        Some("EMBED") => ThumbnailMode::Embed,
        Some("BOTH") => ThumbnailMode::Both,
        _ => ThumbnailMode::Sidecar,
    };

    let (bytes, extension) = match fetch_poster(url).await {
        Ok(poster) => poster,
        Err(error) => {
            emitter.log(format!("Could not fetch the poster image: {error}"));
            return;
        }
    };

    // Embedding is only tractable for taggable audio containers; video downloads
    // (WebM/MKV/fMP4 video) always fall back to a sidecar file.
    let wants_embed = mode != ThumbnailMode::Sidecar
        && matches!(
            media_kind,
            DownloadMediaKind::Music | DownloadMediaKind::Audio
        );
    let mut embedded = false;
    if wants_embed {
        match embed_poster(media_path.to_path_buf(), bytes.clone(), extension).await {
            Ok(()) => {
                embedded = true;
                emitter.log("Embedded cover art into the media file");
            }
            Err(error) => {
                emitter.log(format!(
                    "Could not embed cover art (saving separately instead): {error}"
                ));
            }
        }
    }

    // EMBED falls back to a sidecar when embedding fails or is unsupported, so
    // the artwork is never silently lost.
    if mode != ThumbnailMode::Embed || !embedded {
        match write_poster_file(media_path, &bytes, extension).await {
            Ok(path) => emitter.log(format!("Saved poster image to `{}`", path.display())),
            Err(error) => emitter.log(format!("Could not save the poster image: {error}")),
        }
    }
}

async fn fetch_poster(url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let client = reqwest::Client::builder()
        .user_agent(IMAGE_USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("client error: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("image server returned {}", response.status()));
    }
    let extension = poster_extension(&response, url);
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("could not read image: {error}"))?;
    if bytes.is_empty() {
        return Err("image was empty".to_string());
    }
    Ok((bytes.to_vec(), extension))
}

async fn write_poster_file(
    media_path: &Path,
    bytes: &[u8],
    extension: &'static str,
) -> Result<PathBuf, String> {
    let path = media_path.with_extension(extension);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| format!("could not write image: {error}"))?;
    Ok(path)
}

async fn embed_poster(
    media_path: PathBuf,
    bytes: Vec<u8>,
    extension: &'static str,
) -> Result<(), String> {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::probe::Probe;
    use lofty::tag::{Tag, TagExt};

    // MP4 `covr` and ID3 `APIC` only reliably support JPEG/PNG payloads.
    let mime = match extension {
        "jpg" => MimeType::Jpeg,
        "png" => MimeType::Png,
        other => return Err(format!("{other} artwork is not supported for embedding")),
    };

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
        tag.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(mime),
            None,
            bytes,
        ));
        tag.save_to_path(&media_path, WriteOptions::default())
            .map_err(|error| format!("could not write cover art: {error}"))
    })
    .await
    .map_err(|error| format!("embed task failed: {error}"))?
}

fn poster_extension(response: &reqwest::Response, url: &str) -> &'static str {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let url_extension = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if content_type.contains("png") || url_extension == "png" {
        "png"
    } else if content_type.contains("webp") || url_extension == "webp" {
        "webp"
    } else {
        "jpg"
    }
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
    let Some(text) = lyrics.filter(|text| !text.trim().is_empty()) else {
        return Ok(None);
    };
    let path = media_path.with_extension("lrc");
    tokio::fs::write(&path, text.as_bytes())
        .await
        .map_err(|error| format!("could not write lyrics: {error}"))?;
    Ok(Some(path))
}
