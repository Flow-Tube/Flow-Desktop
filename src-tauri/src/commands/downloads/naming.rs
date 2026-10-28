//! Where a download goes and what it is called.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::tags::DownloadTags;
use super::{DownloadMediaKind, download_error};
use crate::errors::ErrorResponse;

pub fn resolve_destination_directory(
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

/// The file name (without extension): `Artist - Title` for a song, `NN - Title`
/// inside an album, the title for everything else.
pub fn download_file_stem(
    title: &str,
    media_kind: DownloadMediaKind,
    tags: &DownloadTags,
    in_collection: bool,
) -> String {
    if matches!(media_kind, DownloadMediaKind::Video) {
        return sanitize_file_stem(title);
    }
    if in_collection && let Some(number) = tags.track_number.filter(|number| *number > 0) {
        let width = tags
            .track_total
            .unwrap_or(number)
            .max(number)
            .to_string()
            .len()
            .max(2);
        return sanitize_file_stem(&format!("{number:0width$} - {title}"));
    }
    match tags.display_artist() {
        Some(artist) if !title.to_lowercase().contains(&artist.to_lowercase()) => {
            sanitize_file_stem(&format!("{artist} - {title}"))
        }
        _ => sanitize_file_stem(title),
    }
}

/// Longest file-name stem in bytes: 255 minus room for " (99).ext" and a margin.
pub const MAX_STEM_BYTES: usize = 239;

pub fn sanitize_file_stem(title: &str) -> String {
    let replaced = title
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}' | '\u{7f}' => {
                '_'
            }
            _ => character,
        })
        .collect::<String>();
    let mut value = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    value = value
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' '])
        .to_string();
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
    let mut stem: String = value.chars().take(180).collect();
    if stem.len() > MAX_STEM_BYTES {
        let mut end = MAX_STEM_BYTES;
        while !stem.is_char_boundary(end) {
            end -= 1;
        }
        stem.truncate(end);
        stem = stem.trim_end_matches(['.', ' ']).to_string();
    }
    stem
}

pub fn available_file_path(
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

#[cfg(test)]
mod tests {
    use super::{DownloadMediaKind, MAX_STEM_BYTES, download_file_stem, sanitize_file_stem};
    use crate::commands::downloads::tags::DownloadTags;

    #[test]
    fn sanitizes_cross_platform_file_names() {
        assert_eq!(sanitize_file_stem("A/B:C*D?"), "A_B_C_D_");
        assert_eq!(sanitize_file_stem("CON"), "_CON");
        assert_eq!(sanitize_file_stem("  title.  "), "title");
        assert_eq!(sanitize_file_stem("..hidden   name"), "hidden name");
        let long = "é".repeat(170);
        let stem = sanitize_file_stem(&long);
        assert!(stem.len() <= MAX_STEM_BYTES);
        assert!(stem.chars().all(|character| character == 'é'));
    }

    #[test]
    fn songs_are_named_by_artist_or_album_position() {
        let tags = DownloadTags {
            artists: vec!["M83".into()],
            track_number: Some(2),
            track_total: Some(22),
            ..DownloadTags::default()
        };
        assert_eq!(
            download_file_stem("Midnight City", DownloadMediaKind::Music, &tags, false),
            "M83 - Midnight City"
        );
        assert_eq!(
            download_file_stem("Midnight City", DownloadMediaKind::Music, &tags, true),
            "02 - Midnight City"
        );
        assert_eq!(
            download_file_stem(
                "M83 - Midnight City",
                DownloadMediaKind::Music,
                &tags,
                false
            ),
            "M83 - Midnight City"
        );
        assert_eq!(
            download_file_stem("Midnight City", DownloadMediaKind::Video, &tags, false),
            "Midnight City"
        );
        let long_album = DownloadTags {
            track_number: Some(7),
            track_total: Some(120),
            ..DownloadTags::default()
        };
        assert_eq!(
            download_file_stem("Song", DownloadMediaKind::Music, &long_album, true),
            "007 - Song"
        );
    }
}
