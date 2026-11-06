//! Which files the library lists, and how the proxy labels them.

use std::path::Path;

use super::MediaKind;

const VIDEO_EXTENSIONS: [&str; 17] = [
    "mp4", "m4v", "mov", "mkv", "webm", "ogv", "avi", "wmv", "flv", "ts", "m2ts", "mts", "mpg",
    "mpeg", "3gp", "3g2", "asf",
];
const AUDIO_EXTENSIONS: [&str; 14] = [
    "mp3", "m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "wav", "aif", "aiff", "wma", "ape",
    "mka",
];

pub fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub fn kind_of(path: &Path) -> Option<MediaKind> {
    let extension = extension_of(path);
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some(MediaKind::Video)
    } else if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        Some(MediaKind::Audio)
    } else {
        None
    }
}

/// The label a file is served under. Matroska goes out as `WebM`, as a download does, because
/// that is the name Chromium accepts for that family; a media element then reads the bytes.
pub fn content_type(path: &Path) -> &'static str {
    match extension_of(path).as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" | "webm" => "video/webm",
        "ogv" => "video/ogg",
        "avi" => "video/x-msvideo",
        "wmv" | "asf" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "ts" | "m2ts" | "mts" => "video/mp2t",
        "mpg" | "mpeg" => "video/mpeg",
        "3gp" | "3g2" => "video/3gpp",
        "mp3" => "audio/mpeg",
        "m4a" | "m4b" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "wav" => "audio/wav",
        "aif" | "aiff" => "audio/aiff",
        "wma" => "audio/x-ms-wma",
        "ape" => "audio/ape",
        "mka" => "audio/webm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_are_told_apart_by_extension_in_any_case() {
        assert_eq!(kind_of(Path::new("a/film.MKV")), Some(MediaKind::Video));
        assert_eq!(kind_of(Path::new("a/song.Flac")), Some(MediaKind::Audio));
        assert_eq!(kind_of(Path::new("a/cover.jpg")), None);
        assert_eq!(kind_of(Path::new("a/no_extension")), None);
    }

    #[test]
    fn every_listed_extension_has_a_label() {
        for extension in VIDEO_EXTENSIONS.iter().chain(&AUDIO_EXTENSIONS) {
            let name = format!("file.{extension}");
            assert_ne!(content_type(Path::new(&name)), "application/octet-stream");
        }
    }
}
