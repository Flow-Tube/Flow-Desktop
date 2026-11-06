//! The folder library: files the user keeps in folders they chose. Desktop has no `MediaStore`, so
//! the folders are walked here and the result kept in SQLite.
//!
//! A `local_<hash>` id never names a `YouTube` video (it is never 11 characters, so
//! `validate_video_id` refuses it). Nothing keyed by one reaches a sync collection, a
//! recommendation engine or the network.

pub mod formats;
pub mod probe;
pub mod scan;
pub mod scanner;

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const LOCAL_ID_PREFIX: &str = "local_";
const LOCAL_ID_HASH_CHARS: usize = 16;

/// The stable id of the file at `path`, the same on every rescan.
pub fn file_id(path: &Path) -> String {
    let digest = Sha256::digest(path.as_os_str().as_encoded_bytes());
    let hash = hex::encode(digest);
    format!("{LOCAL_ID_PREFIX}{}", &hash[..LOCAL_ID_HASH_CHARS])
}

pub fn is_local_id(id: &str) -> bool {
    id.strip_prefix(LOCAL_ID_PREFIX).is_some_and(|hash| {
        hash.len() == LOCAL_ID_HASH_CHARS
            && hash
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Video => "video",
            MediaKind::Audio => "audio",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderRole {
    Include,
    Exclude,
}

impl FolderRole {
    pub fn as_str(self) -> &'static str {
        match self {
            FolderRole::Include => "include",
            FolderRole::Exclude => "exclude",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaFile {
    pub id: String,
    pub path: String,
    pub folder_path: String,
    pub kind: String,
    pub title: String,
    pub file_name: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub size_bytes: i64,
    pub added_ms: i64,
    pub modified_ms: i64,
    pub width: i64,
    pub height: i64,
    pub frame_rate: Option<f64>,
    pub bitrate_kbps: Option<i64>,
    pub video_codec: String,
    pub audio_codec: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaFolder {
    pub path: String,
    pub role: String,
    /// False while the folder can't be reached, such as an unplugged drive.
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaPlay {
    pub file_id: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub last_played_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::validation::validate_video_id;

    #[test]
    fn an_id_is_stable_and_can_never_pass_as_a_youtube_id() {
        let id = file_id(Path::new("/music/song.mp3"));
        assert_eq!(id, file_id(Path::new("/music/song.mp3")));
        assert_ne!(id, file_id(Path::new("/music/other.mp3")));
        assert!(is_local_id(&id));
        assert!(validate_video_id(&id).is_err());
    }

    #[test]
    fn only_the_exact_shape_is_a_local_id() {
        assert!(!is_local_id("dQw4w9WgXcQ"));
        assert!(!is_local_id("local_12345"));
        assert!(!is_local_id("local_ABCDEF0123456789"));
        assert!(!is_local_id("local_../../etc/passwd0"));
    }
}
