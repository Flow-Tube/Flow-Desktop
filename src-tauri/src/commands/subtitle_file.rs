//! Reads a subtitle file the user picked or dropped on the player.

use crate::errors::{AppError, ErrorResponse};
use std::path::Path;

const MAX_SUBTITLE_FILE_BYTES: u64 = 20 * 1024 * 1024;
const SUBTITLE_EXTENSIONS: [&str; 2] = ["srt", "vtt"];

/// The text of a subtitle file. Older subtitle files are often not UTF-8: a byte order mark settles
/// UTF-16, and anything else that isn't valid UTF-8 is read as Latin-1, which keeps accented letters
/// where a lossy UTF-8 read would turn them into replacement marks.
fn decode_subtitle_bytes(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(rest, u16::from_le_bytes);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(rest, u16::from_be_bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|byte| char::from(*byte)).collect(),
    }
}

fn decode_utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().copied().map(unit).collect();
    String::from_utf16_lossy(&units)
}

fn has_subtitle_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUBTITLE_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
}

async fn read_subtitle_file_inner(path: &Path) -> crate::errors::AppResult<String> {
    if !has_subtitle_extension(path) {
        return Err(AppError::Validation("Not a subtitle file".to_string()));
    }
    let metadata = tokio::fs::metadata(path).await?;
    if metadata.len() > MAX_SUBTITLE_FILE_BYTES {
        return Err(AppError::Validation(
            "Subtitle file is too large".to_string(),
        ));
    }
    Ok(decode_subtitle_bytes(&tokio::fs::read(path).await?))
}

#[tauri::command]
pub async fn read_subtitle_file(path: String) -> Result<String, ErrorResponse> {
    read_subtitle_file_inner(Path::new(&path))
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_encodings_subtitle_files_come_in() {
        assert_eq!(decode_subtitle_bytes("déjà".as_bytes()), "déjà");
        assert_eq!(
            decode_subtitle_bytes(&[0xEF, 0xBB, 0xBF, b'h', b'i']),
            "hi",
            "the mark would otherwise hide the WEBVTT header"
        );
        assert_eq!(decode_subtitle_bytes(&[0xFF, 0xFE, b'h', 0, b'i', 0]), "hi");
        assert_eq!(decode_subtitle_bytes(&[0xFE, 0xFF, 0, b'h', 0, b'i']), "hi");
        assert_eq!(decode_subtitle_bytes(&[b'd', 0xE9, b'j', 0xE0]), "déjà");
    }

    #[tokio::test]
    async fn refuses_anything_but_a_subtitle_file() {
        let dir = std::env::temp_dir().join(format!("flow-subs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let secret = dir.join("notes.txt");
        std::fs::write(&secret, "secret").unwrap();
        assert!(read_subtitle_file_inner(&secret).await.is_err());

        let subtitle = dir.join("Movie.SRT");
        std::fs::write(&subtitle, "1\n00:00:01,000 --> 00:00:02,000\nhi\n").unwrap();
        assert!(
            read_subtitle_file_inner(&subtitle)
                .await
                .unwrap()
                .contains("hi")
        );

        assert!(
            read_subtitle_file_inner(&dir.join("missing.vtt"))
                .await
                .is_err()
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn refuses_a_file_too_large_to_be_subtitles() {
        let dir = std::env::temp_dir().join(format!("flow-subs-big-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.vtt");
        let file = std::fs::File::create(&big).unwrap();
        file.set_len(MAX_SUBTITLE_FILE_BYTES + 1).unwrap();
        assert!(read_subtitle_file_inner(&big).await.is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
