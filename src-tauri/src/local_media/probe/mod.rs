//! What a media file holds. Lofty reads the tags and audio properties. It has no Matroska reader
//! and no video properties, so two small container readers supply those and the codec names the
//! player needs to tell whether the webview can play a file.

mod matroska;
mod mp4;

use std::path::Path;
use std::time::Duration;

use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType, TaggedFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;

use super::MediaKind;
use super::formats::extension_of;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ContainerInfo {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codecs: Vec<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Probed {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub bitrate_kbps: Option<u32>,
    pub video_codec: String,
    pub audio_codec: String,
}

fn read_container(path: &Path) -> Option<ContainerInfo> {
    match extension_of(path).as_str() {
        "mp4" | "m4v" | "mov" | "m4a" | "m4b" | "3gp" | "3g2" => mp4::read(path),
        "mkv" | "webm" | "mka" => matroska::read(path),
        _ => None,
    }
}

fn read_tags(path: &Path) -> Option<TaggedFile> {
    Probe::open(path)
        .ok()?
        .options(ParseOptions::new().read_cover_art(false))
        .guess_file_type()
        .ok()?
        .read()
        .ok()
}

/// The name of the sound format an audio-only file carries, from what lofty recognised.
fn audio_codec_of(file_type: FileType) -> Option<&'static str> {
    match file_type {
        FileType::Aac => Some("aac"),
        FileType::Aiff | FileType::Wav => Some("pcm"),
        FileType::Ape => Some("ape"),
        FileType::Flac => Some("flac"),
        FileType::Mpeg => Some("mp3"),
        FileType::Opus => Some("opus"),
        FileType::Vorbis => Some("vorbis"),
        FileType::WavPack => Some("wavpack"),
        _ => None,
    }
}

fn non_blank(value: Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// Never fails: a file that can't be parsed is still listed under its file name.
pub fn probe_file(path: &Path, kind: MediaKind) -> Probed {
    let container = read_container(path).unwrap_or_default();
    let tagged = read_tags(path);

    let mut probed = Probed {
        title: container.title.clone(),
        duration_ms: container.duration_ms,
        width: container.width,
        height: container.height,
        frame_rate: container.frame_rate,
        video_codec: container.video_codec.clone().unwrap_or_default(),
        audio_codec: container.audio_codecs.first().cloned().unwrap_or_default(),
        ..Probed::default()
    };

    if let Some(tagged) = tagged {
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            probed.title = non_blank(tag.title()).or(probed.title);
            probed.artist = non_blank(tag.artist());
            probed.album = non_blank(tag.album());
        }
        let properties = tagged.properties();
        if probed.duration_ms == 0 {
            probed.duration_ms = duration_ms(properties.duration());
        }
        probed.bitrate_kbps = properties
            .overall_bitrate()
            .or_else(|| properties.audio_bitrate());
        if probed.audio_codec.is_empty() {
            probed.audio_codec = audio_codec_of(tagged.file_type())
                .unwrap_or_default()
                .to_string();
        }
    }

    if kind == MediaKind::Audio && probed.audio_codec.is_empty() {
        probed.audio_codec = extension_of(path);
    }
    probed
}

fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_that_cant_be_parsed_still_gives_an_empty_answer() {
        let dir = std::env::temp_dir().join(format!("flow-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("broken.mkv");
        std::fs::write(&video, b"not a real file").unwrap();
        let probed = probe_file(&video, MediaKind::Video);
        assert_eq!(probed.duration_ms, 0);
        assert_eq!(probed.video_codec, "");

        let song = dir.join("broken.wma");
        std::fs::write(&song, b"not a real file").unwrap();
        assert_eq!(probe_file(&song, MediaKind::Audio).audio_codec, "wma");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
