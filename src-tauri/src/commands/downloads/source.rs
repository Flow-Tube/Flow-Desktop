//! Stream links for a download. They are resolved when the job starts, not when it
//! is queued, and again when the media server refuses one (links expire, and a
//! client can be cut off mid-download), so a queued or resumed job never starts
//! with a stale link.

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::{DownloadMediaKind, MusicSelection, StartDownloadRequest, VideoSelection};
use crate::api::innertube::download::{
    DownloadContainer, DownloadableFormat, container_from_mime, pair_downloadable_formats_with,
    video_codec_name,
};
use crate::models::video::{CaptionTrack, StreamInfo};
use crate::services::music_service::MusicService;
use crate::services::youtube_service::YoutubeService;

/// Fresh resolutions one job may ask for after a refusal.
const MAX_REFRESHES: u32 = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct StreamSource {
    pub url: String,
    pub user_agent: String,
    pub mime_type: String,
    /// A song's loudness, kept so it is normalized offline too.
    pub loudness_db: Option<f64>,
}

#[derive(Debug, Clone)]
pub enum Resolved {
    Single(StreamSource),
    Pair {
        video: StreamSource,
        audio: StreamSource,
        output: DownloadContainer,
        /// The format the links belong to; a refresh must find the same one.
        format_id: String,
        /// The video's caption tracks, for a subtitle chosen with the download.
        captions: Vec<CaptionTrack>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Single,
    Video,
    Audio,
}

struct SlotState {
    resolved: Resolved,
    refreshes: u32,
}

/// The links of one job, shared by every worker downloading its tracks.
pub struct SourceSlot {
    app: AppHandle,
    request: StartDownloadRequest,
    state: Mutex<SlotState>,
}

impl SourceSlot {
    pub async fn open(app: &AppHandle, request: &StartDownloadRequest) -> Result<Self, String> {
        let resolved = resolve(app, request, false).await?;
        Ok(Self {
            app: app.clone(),
            request: request.clone(),
            state: Mutex::new(SlotState {
                resolved,
                refreshes: 0,
            }),
        })
    }

    pub async fn resolved(&self) -> Resolved {
        self.state.lock().await.resolved.clone()
    }

    pub async fn current(&self, role: Role) -> StreamSource {
        source_for(&self.state.lock().await.resolved, role)
    }

    /// Replaces a refused link. `stale_url` is the one that failed: when another
    /// worker has already replaced it, nothing is resolved again.
    pub async fn refresh(&self, role: Role, stale_url: &str) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if source_for(&state.resolved, role).url != stale_url {
            return Ok(());
        }
        if state.refreshes >= MAX_REFRESHES {
            return Err(format!(
                "The media server kept refusing the stream after {MAX_REFRESHES} fresh links"
            ));
        }
        state.refreshes += 1;
        let fresh = resolve(&self.app, &self.request, true).await?;
        if let (Resolved::Pair { format_id: old, .. }, Resolved::Pair { format_id: new, .. }) =
            (&state.resolved, &fresh)
            && old != new
        {
            return Err("The chosen quality is no longer offered for this video".into());
        }
        state.resolved = fresh;
        Ok(())
    }
}

fn source_for(resolved: &Resolved, role: Role) -> StreamSource {
    match (resolved, role) {
        (Resolved::Single(source), _) | (Resolved::Pair { video: source, .. }, Role::Video) => {
            source.clone()
        }
        (Resolved::Pair { audio, .. }, Role::Audio | Role::Single) => audio.clone(),
    }
}

async fn resolve(
    app: &AppHandle,
    request: &StartDownloadRequest,
    refresh: bool,
) -> Result<Resolved, String> {
    match (&request.video, &request.music, request.media_kind) {
        (Some(selection), None, DownloadMediaKind::Video) => {
            let service = app
                .try_state::<YoutubeService>()
                .ok_or("The video service is unavailable")?
                .inner()
                .clone();
            let info = service
                .get_stream_info(&request.video_id, refresh)
                .await
                .map_err(|error| error.to_string())?;
            resolve_video(&info, selection)
        }
        (None, Some(selection), DownloadMediaKind::Music | DownloadMediaKind::Audio) => {
            resolve_music(app, &request.video_id, selection).await
        }
        _ => Err("A download needs one video quality or one music quality".into()),
    }
}

async fn resolve_music(
    app: &AppHandle,
    video_id: &str,
    selection: &MusicSelection,
) -> Result<Resolved, String> {
    let service = app
        .try_state::<MusicService>()
        .ok_or("The music service is unavailable")?
        .inner()
        .clone();
    let info = service
        .resolve_stream(video_id, selection.quality, selection.prefer_aac)
        .await
        .map_err(|error| error.to_string())?;
    Ok(Resolved::Single(StreamSource {
        url: info.audio_url,
        user_agent: info.user_agent,
        mime_type: info.mime_type,
        loudness_db: info.loudness_db,
    }))
}

fn resolve_video(info: &StreamInfo, selection: &VideoSelection) -> Result<Resolved, String> {
    let formats = pair_downloadable_formats_with(info, selection.audio_track.as_deref());
    let format = pick_format(&formats, selection)
        .ok_or("This video has no downloadable video and audio pair")?;
    let fallback_agent = info
        .expires_at
        .split_once('|')
        .map(|(_, agent)| agent.to_string())
        .unwrap_or_default();
    let audio_agent = info
        .download_audio_tracks
        .iter()
        .find(|track| track.local_url == format.audio_url)
        .and_then(|track| track.user_agent.clone())
        .unwrap_or_else(|| fallback_agent.clone());
    Ok(Resolved::Pair {
        video: StreamSource {
            url: format.video_url.clone(),
            user_agent: fallback_agent,
            mime_type: format.video_mime_type.clone(),
            loudness_db: None,
        },
        audio: StreamSource {
            url: format.audio_url.clone(),
            user_agent: audio_agent,
            mime_type: format.audio_mime_type.clone(),
            loudness_db: info.loudness_db,
        },
        output: format.container,
        format_id: format.format_id.clone(),
        captions: info.captions.clone(),
    })
}

/// The exact format the user chose when it is still offered; otherwise the closest:
/// same height and codec (and frame rate when one was chosen), then same height,
/// then the tallest below it, preferring the same codec.
pub fn pick_format<'a>(
    formats: &'a [DownloadableFormat],
    selection: &VideoSelection,
) -> Option<&'a DownloadableFormat> {
    if let Some(exact) = formats
        .iter()
        .find(|format| format.format_id == selection.format_id)
    {
        return Some(exact);
    }
    let Some(height) = selection.height else {
        return formats.first();
    };
    let same_codec = |format: &&DownloadableFormat| format.video_codec == selection.video_codec;
    let same_height = |format: &&DownloadableFormat| format.height == Some(height);
    let below = |format: &&DownloadableFormat| format.height.unwrap_or(0) <= height;
    // Formats arrive tallest first, so the first match below is the tallest one.
    formats
        .iter()
        .filter(same_height)
        .filter(same_codec)
        .find(|format| selection.fps.is_none_or(|fps| format.fps == Some(fps)))
        .or_else(|| formats.iter().filter(same_height).find(same_codec))
        .or_else(|| formats.iter().find(same_height))
        .or_else(|| formats.iter().filter(below).find(same_codec))
        .or_else(|| formats.iter().find(below))
        .or_else(|| formats.last())
}

impl Resolved {
    /// The container each downloaded track's bytes arrive in.
    pub fn track_containers(&self) -> (DownloadContainer, DownloadContainer) {
        match self {
            Self::Single(source) => {
                let container = container_from_mime(&source.mime_type);
                (container, container)
            }
            Self::Pair { video, audio, .. } => (
                container_from_mime(&video.mime_type),
                container_from_mime(&audio.mime_type),
            ),
        }
    }

    pub fn video_codec(&self) -> Option<&'static str> {
        match self {
            Self::Single(_) => None,
            Self::Pair { video, .. } => Some(video_codec_name(&video.mime_type)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{VideoSelection, pick_format};
    use crate::api::innertube::download::{DownloadContainer, DownloadableFormat};

    fn format(id: &str, height: u64, fps: u64, codec: &str) -> DownloadableFormat {
        DownloadableFormat {
            format_id: id.into(),
            resolution: format!("{height}p"),
            width: None,
            height: Some(height),
            fps: Some(fps),
            container: DownloadContainer::Mp4,
            video_codec: codec.into(),
            audio_codec: "AAC".into(),
            video_mime_type: String::new(),
            audio_mime_type: String::new(),
            video_bitrate: None,
            audio_bitrate: None,
            video_size_bytes: None,
            audio_size_bytes: None,
            estimated_size_bytes: None,
            video_url: String::new(),
            audio_url: String::new(),
        }
    }

    fn selection(id: &str, height: u64, fps: u64, codec: &str) -> VideoSelection {
        VideoSelection {
            format_id: id.into(),
            height: Some(height),
            fps: Some(fps),
            video_codec: codec.into(),
            container: DownloadContainer::Mp4,
            audio_track: None,
        }
    }

    #[test]
    fn keeps_the_exact_format_then_the_closest() {
        let formats = [
            format("303+a", 1080, 60, "VP9"),
            format("299+a", 1080, 60, "H.264"),
            format("247+a", 720, 30, "VP9"),
        ];
        let pick = |s: VideoSelection| pick_format(&formats, &s).map(|f| f.format_id.clone());
        assert_eq!(
            pick(selection("299+a", 1080, 60, "H.264")).as_deref(),
            Some("299+a")
        );
        assert_eq!(
            pick(selection("gone", 1080, 60, "H.264")).as_deref(),
            Some("299+a")
        );
        assert_eq!(
            pick(selection("gone", 1080, 30, "AV1")).as_deref(),
            Some("303+a")
        );
        assert_eq!(
            pick(selection("gone", 1440, 60, "VP9")).as_deref(),
            Some("303+a")
        );
        assert_eq!(
            pick(selection("gone", 480, 30, "VP9")).as_deref(),
            Some("247+a")
        );
    }
}
