use serde::{Deserialize, Serialize};

use crate::models::video::{AudioTrack, StreamInfo, StreamVariant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadContainer {
    Mp4,
    Mkv,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadableFormat {
    pub format_id: String,
    pub resolution: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub fps: Option<u64>,
    pub container: DownloadContainer,
    pub video_codec: String,
    pub audio_codec: String,
    pub video_mime_type: String,
    pub audio_mime_type: String,
    pub video_bitrate: Option<u64>,
    pub audio_bitrate: Option<u64>,
    pub video_size_bytes: Option<u64>,
    pub audio_size_bytes: Option<u64>,
    pub estimated_size_bytes: Option<u64>,
    pub video_url: String,
    pub audio_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VideoCodec {
    H264,
    Hevc,
    Vp8,
    Vp9,
    Av1,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioCodec {
    Aac,
    Opus,
    Vorbis,
    Mp3,
    Unknown,
}

pub fn pair_downloadable_formats(stream_info: &StreamInfo) -> Vec<DownloadableFormat> {
    let mut formats = stream_info
        .variants
        .iter()
        .filter(|video| {
            video.is_playable
                && video.is_video_only
                && video.delivery_method == "adaptive"
                && !video.local_url.is_empty()
        })
        .filter_map(|video| pair_video_with_audio(video, &stream_info.download_audio_tracks))
        .collect::<Vec<_>>();

    formats.sort_by(|left, right| {
        right
            .height
            .unwrap_or(0)
            .cmp(&left.height.unwrap_or(0))
            .then_with(|| right.fps.unwrap_or(0).cmp(&left.fps.unwrap_or(0)))
            .then_with(|| codec_rank(&left.video_codec).cmp(&codec_rank(&right.video_codec)))
            .then_with(|| {
                right
                    .video_bitrate
                    .unwrap_or(0)
                    .cmp(&left.video_bitrate.unwrap_or(0))
            })
    });

    formats.dedup_by(|left, right| {
        left.height == right.height
            && left.fps == right.fps
            && left.video_codec == right.video_codec
            && left.container == right.container
    });
    formats
}

fn pair_video_with_audio(
    video: &StreamVariant,
    audio_tracks: &[AudioTrack],
) -> Option<DownloadableFormat> {
    let video_mime_type = video.mime_type.as_deref()?;
    let video_codec = video_codec(video_mime_type);
    let audio = select_compatible_audio(video_codec, audio_tracks)?;
    let audio_mime_type = audio.mime_type.as_deref()?;
    let container = output_container(video_codec, audio_codec(audio_mime_type))?;
    let duration_ms = video.approx_duration_ms.or(audio.approx_duration_ms);
    let video_size_bytes = video
        .content_length
        .or_else(|| estimate_size(video.bitrate, duration_ms));
    let audio_size_bytes = audio
        .content_length
        .or_else(|| estimate_size(audio.bitrate, duration_ms));
    let estimated_size_bytes = match (video_size_bytes, audio_size_bytes) {
        (Some(video_bytes), Some(audio_bytes)) => video_bytes.checked_add(audio_bytes),
        _ => None,
    };

    Some(DownloadableFormat {
        format_id: format!("{}+{}", video.id, audio.id),
        resolution: video.quality_label.clone(),
        width: video.width,
        height: video.height,
        fps: video.fps,
        container,
        video_codec: video_codec_label(video_codec).to_string(),
        audio_codec: audio_codec_label(audio_codec(audio_mime_type)).to_string(),
        video_mime_type: video_mime_type.to_string(),
        audio_mime_type: audio_mime_type.to_string(),
        video_bitrate: video.bitrate,
        audio_bitrate: audio.bitrate,
        video_size_bytes,
        audio_size_bytes,
        estimated_size_bytes,
        video_url: video.local_url.clone(),
        audio_url: audio.local_url.clone(),
    })
}

/// Every video codec MP4 can hold is paired with AAC, so the download is a tagged MP4
/// that plays everywhere. Opus is never put in MP4 (players misread its pre-skip), so
/// VP8, or a video with no AAC track at all, pairs with Opus and becomes MKV.
fn select_compatible_audio(
    video_codec: VideoCodec,
    audio_tracks: &[AudioTrack],
) -> Option<&AudioTrack> {
    let preferred: &[AudioCodec] = match video_codec {
        VideoCodec::H264 | VideoCodec::Hevc | VideoCodec::Vp9 | VideoCodec::Av1 => {
            &[AudioCodec::Aac, AudioCodec::Opus]
        }
        VideoCodec::Vp8 => &[AudioCodec::Opus],
        VideoCodec::Unknown => return None,
    };

    preferred.iter().find_map(|wanted| {
        audio_tracks
            .iter()
            .filter(|audio| {
                !audio.local_url.is_empty()
                    && audio
                        .mime_type
                        .as_deref()
                        .is_some_and(|mime| audio_codec(mime) == *wanted)
            })
            .max_by_key(|audio| (audio.is_default, audio.bitrate.unwrap_or(0)))
    })
}

fn video_codec(mime_type: &str) -> VideoCodec {
    let value = mime_type.to_ascii_lowercase();
    if value.contains("av01") || value.contains("av1") {
        VideoCodec::Av1
    } else if value.contains("vp09") || value.contains("vp9") {
        VideoCodec::Vp9
    } else if value.contains("vp08") || value.contains("vp8") {
        VideoCodec::Vp8
    } else if value.contains("hev1")
        || value.contains("hvc1")
        || value.contains("hevc")
        || value.contains("h265")
    {
        VideoCodec::Hevc
    } else if value.contains("avc1") || value.contains("h264") {
        VideoCodec::H264
    } else {
        VideoCodec::Unknown
    }
}

/// "H.264", "VP9", "AV1"… for a video mime type.
#[must_use]
pub fn video_codec_name(mime_type: &str) -> &'static str {
    video_codec_label(video_codec(mime_type))
}

fn audio_codec(mime_type: &str) -> AudioCodec {
    let value = mime_type.to_ascii_lowercase();
    if value.contains("opus") {
        AudioCodec::Opus
    } else if value.contains("vorbis") {
        AudioCodec::Vorbis
    } else if value.contains("mp4a") || value.contains("aac") || value.starts_with("audio/mp4") {
        AudioCodec::Aac
    } else if value.contains("mpeg") || value.contains("mp3") {
        AudioCodec::Mp3
    } else {
        AudioCodec::Unknown
    }
}

fn output_container(video: VideoCodec, audio: AudioCodec) -> Option<DownloadContainer> {
    match (video, audio) {
        (VideoCodec::Unknown, _) => None,
        (
            VideoCodec::H264 | VideoCodec::Hevc | VideoCodec::Vp9 | VideoCodec::Av1,
            AudioCodec::Aac,
        ) => Some(DownloadContainer::Mp4),
        _ => Some(DownloadContainer::Mkv),
    }
}

/// Container the raw bytes of a track actually arrive in, derived from its mime type.
/// WebM/Opus/Vorbis are EBML (`Mkv`); everything else is ISO-BMFF (`Mp4`). This is the
/// real on-disk container of a downloaded track, independent of the muxed output container.
#[must_use]
pub fn container_from_mime(mime_type: &str) -> DownloadContainer {
    if mime_type.to_ascii_lowercase().contains("webm") {
        DownloadContainer::Mkv
    } else {
        DownloadContainer::Mp4
    }
}

fn estimate_size(bitrate: Option<u64>, duration_ms: Option<u64>) -> Option<u64> {
    bitrate?.checked_mul(duration_ms?)?.checked_div(8_000)
}

fn video_codec_label(codec: VideoCodec) -> &'static str {
    match codec {
        VideoCodec::H264 => "H.264",
        VideoCodec::Hevc => "HEVC",
        VideoCodec::Vp8 => "VP8",
        VideoCodec::Vp9 => "VP9",
        VideoCodec::Av1 => "AV1",
        VideoCodec::Unknown => "Unknown",
    }
}

fn audio_codec_label(codec: AudioCodec) -> &'static str {
    match codec {
        AudioCodec::Aac => "AAC",
        AudioCodec::Opus => "Opus",
        AudioCodec::Vorbis => "Vorbis",
        AudioCodec::Mp3 => "MP3",
        AudioCodec::Unknown => "Unknown",
    }
}

fn codec_rank(codec: &str) -> u8 {
    match codec {
        "VP9" => 0,
        "H.264" => 1,
        "AV1" => 2,
        "VP8" => 3,
        "HEVC" => 4,
        _ => 5,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AudioCodec, DownloadContainer, VideoCodec, output_container, select_compatible_audio,
    };
    use crate::models::video::AudioTrack;

    fn track(id: &str, mime: &str, bitrate: u64) -> AudioTrack {
        AudioTrack {
            id: id.into(),
            label: String::new(),
            language_code: None,
            audio_track_type: None,
            local_url: format!("http://127.0.0.1/{id}"),
            mime_type: Some(mime.into()),
            bitrate: Some(bitrate),
            content_length: None,
            is_default: true,
            available: true,
            init_range_start: None,
            init_range_end: None,
            index_range_start: None,
            index_range_end: None,
            approx_duration_ms: None,
            user_agent: None,
        }
    }

    #[test]
    fn vp9_and_av1_pair_with_aac_into_mp4() {
        let tracks = [
            track("251", r#"audio/webm; codecs="opus""#, 150_000),
            track("140", r#"audio/mp4; codecs="mp4a.40.2""#, 130_000),
        ];
        for codec in [VideoCodec::Vp9, VideoCodec::Av1, VideoCodec::H264] {
            let audio = select_compatible_audio(codec, &tracks).expect("audio");
            assert_eq!(audio.id, "140");
            assert_eq!(
                output_container(codec, AudioCodec::Aac),
                Some(DownloadContainer::Mp4)
            );
        }
    }

    #[test]
    fn falls_back_to_opus_in_mkv_without_aac() {
        let tracks = [track("251", r#"audio/webm; codecs="opus""#, 150_000)];
        let audio = select_compatible_audio(VideoCodec::Vp9, &tracks).expect("audio");
        assert_eq!(audio.id, "251");
        assert_eq!(
            output_container(VideoCodec::Vp9, AudioCodec::Opus),
            Some(DownloadContainer::Mkv)
        );
        assert_eq!(
            output_container(VideoCodec::Vp8, AudioCodec::Opus),
            Some(DownloadContainer::Mkv)
        );
    }
}
