//! Imports from other apps. Each source's parser reads its files into [`Found`], touching nothing;
//! [`save`] then writes through the same collection restore as a backup, and the engines only ever
//! learn through the existing bootstraps. Files can come from anywhere, so every reader is bounded.

pub mod db_file;
pub mod newpipe;
pub mod other_apps;
pub mod save;
pub mod takeout;
pub mod takeout_activity;
pub mod takeout_csv;

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

/// One import the chooser offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImportKind {
    Takeout,
    YoutubeSubscriptions,
    YoutubeHistory,
    YoutubeLikes,
    YoutubePlaylist,
    WatchLater,
    YoutubeMusicPlaylist,
    NewpipeSubscriptions,
    NewpipeHistory,
    NewpipePlaylists,
    /// A NewPipe backup picked without saying which part: its history and its playlists.
    NewpipeBackup,
    LibretubeSubscriptions,
    LibretubePlaylists,
    /// A LibreTube backup picked without saying which part: its subscriptions and playlists.
    LibretubeBackup,
    FreetubeHistory,
    Metrolist,
}

/// Why an import stopped, in a form the frontend words.
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("invalid_format")]
    InvalidFormat,
    #[error("too_large")]
    TooLarge,
    #[error("no_content")]
    NoContent,
    #[error("no_entries")]
    NoEntries,
    #[error("no_videos")]
    NoVideos,
    #[error("no_likes")]
    NoLikes,
    #[error("failed: {0}")]
    Failed(String),
}

impl From<io::Error> for ImportError {
    fn from(error: io::Error) -> Self {
        Self::Failed(error.to_string())
    }
}

impl From<zip::result::ZipError> for ImportError {
    fn from(_: zip::result::ZipError) -> Self {
        Self::InvalidFormat
    }
}

impl From<sqlx::Error> for ImportError {
    fn from(_: sqlx::Error) -> Self {
        Self::InvalidFormat
    }
}

impl ImportError {
    /// The short reason the frontend switches on.
    #[must_use]
    pub fn reason(&self) -> &'static str {
        match self {
            Self::InvalidFormat => "invalid_format",
            Self::TooLarge => "too_large",
            Self::NoContent => "no_content",
            Self::NoEntries => "no_entries",
            Self::NoVideos => "no_videos",
            Self::NoLikes => "no_likes",
            Self::Failed(_) => "failed",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub avatar: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Watch {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: String,
    pub watched_at: u64,
    pub is_music: bool,
    pub position_seconds: u64,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TakenLike {
    pub video_id: String,
    pub title: String,
    pub channel_name: String,
    pub channel_id: String,
    pub liked_at: u64,
    pub is_music: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artists: String,
    pub channel_id: String,
    pub thumbnail: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TakenPlaylist {
    /// A stable id, so importing the same file again fills the same playlist.
    pub key: String,
    pub name: String,
    pub is_music: bool,
    pub is_watch_later: bool,
    pub created_at: u64,
    pub tracks: Vec<Track>,
}

/// Everything one import read, before any of it is saved.
#[derive(Debug, Default, PartialEq)]
pub struct Found {
    pub channels: Vec<Channel>,
    pub watches: Vec<Watch>,
    pub playlists: Vec<TakenPlaylist>,
    pub likes: Vec<TakenLike>,
    /// Songs saved to the YouTube Music library, kept as one playlist.
    pub library_song_count: usize,
}

pub(crate) const MAX_WATCHES: usize = 500_000;
pub(crate) const MAX_CHANNELS: usize = 100_000;
pub(crate) const MAX_PLAYLISTS: usize = 2_000;
pub(crate) const MAX_TRACKS: usize = 200_000;
pub(crate) const MAX_TEXT: usize = 1_000;
pub(crate) const MAX_ZIP_ENTRIES: u64 = 2_000_000;
pub(crate) const MAX_JSON_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_ACTIVITY_BYTES: u64 = 1024 * 1024 * 1024;

/// A display name from a file: no control characters, bounded, trimmed.
pub(crate) fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() && *c != '\u{2028}' && *c != '\u{2029}')
        .take(MAX_TEXT)
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn is_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub(crate) fn is_channel_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("UC")
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The video id of a YouTube watch or short link, as Android's `extractYouTubeVideoId`.
pub(crate) fn video_id_of_url(url: &str) -> Option<String> {
    let id = if url.contains("youtube.com/watch") {
        let (_, query) = url.split_once('?')?;
        query
            .split('&')
            .find_map(|part| part.strip_prefix("v="))?
            .split('#')
            .next()?
    } else if let Some((_, rest)) = url.split_once("youtu.be/") {
        rest.split(['?', '/', '#']).next()?
    } else {
        return None;
    };
    is_video_id(id).then(|| id.to_string())
}

/// The id at the end of a channel link, as Android's `extractImportedChannelId`.
pub(crate) fn channel_id_of_url(url: &str) -> String {
    let rest = ["/channel/", "/@", "/user/"]
        .iter()
        .find_map(|marker| url.split_once(marker).map(|(_, rest)| rest))
        .unwrap_or_default();
    let id = rest.split(['/', '?']).next().unwrap_or_default();
    clean(id)
}

/// The entry count a zip claims. Opening an archive reads its whole directory into memory, so a
/// hostile count is refused before that happens.
fn claimed_entries(file: &mut File) -> io::Result<Option<u64>> {
    const EOCD: [u8; 4] = [0x50, 0x4B, 0x05, 0x06];
    const ZIP64_LOCATOR: [u8; 4] = [0x50, 0x4B, 0x06, 0x07];
    const TAIL: u64 = 66 * 1024;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start))?;
    let mut tail = Vec::new();
    file.take(TAIL).read_to_end(&mut tail)?;
    let Some(at) = tail.windows(4).rposition(|window| window == EOCD) else {
        return Ok(None);
    };
    let Some(count) = tail.get(at + 10..at + 12) else {
        return Ok(None);
    };
    let count = u64::from(u16::from_le_bytes([count[0], count[1]]));
    if count != u64::from(u16::MAX) {
        return Ok(Some(count));
    }
    let Some(locator) = at
        .checked_sub(20)
        .and_then(|locator| tail.get(locator..at))
        .filter(|locator| locator[..4] == ZIP64_LOCATOR)
    else {
        return Ok(None);
    };
    let mut offset = [0_u8; 8];
    offset.copy_from_slice(&locator[8..16]);
    file.seek(SeekFrom::Start(u64::from_le_bytes(offset) + 32))?;
    let mut total = [0_u8; 8];
    file.read_exact(&mut total)?;
    Ok(Some(u64::from_le_bytes(total)))
}

/// Opens a zip after checking how many entries it claims.
pub fn open_zip(path: &Path) -> Result<ZipArchive<File>, ImportError> {
    let mut file = File::open(path)?;
    match claimed_entries(&mut file)? {
        None => return Err(ImportError::InvalidFormat),
        Some(count) if count > MAX_ZIP_ENTRIES => return Err(ImportError::TooLarge),
        Some(_) => {}
    }
    file.rewind()?;
    Ok(ZipArchive::new(file)?)
}

pub(crate) fn starts_with_zip_magic(path: &Path) -> Result<bool, ImportError> {
    let mut magic = [0_u8; 2];
    let read = File::open(path)?.read_exact(&mut magic);
    Ok(read.is_ok() && magic == *b"PK")
}

/// Reads a whole small file, refusing more than `limit`.
pub(crate) fn read_file_limited(path: &Path, limit: u64) -> Result<Vec<u8>, ImportError> {
    let file = File::open(path)?;
    if file.metadata()?.len() > limit {
        return Err(ImportError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(ImportError::TooLarge);
    }
    Ok(bytes)
}

/// Reads one import's files. Blocking; nothing is saved yet.
pub async fn read_import(
    kind: ImportKind,
    paths: &[std::path::PathBuf],
    library_name: &str,
    now_ms: u64,
) -> Result<Found, ImportError> {
    let first = paths.first().ok_or(ImportError::NoContent)?;
    match kind {
        ImportKind::NewpipeHistory => newpipe::read_history(first, now_ms).await,
        ImportKind::NewpipePlaylists => newpipe::read_playlists(first, now_ms).await,
        ImportKind::NewpipeBackup => newpipe::read_backup(first, now_ms).await,
        ImportKind::Metrolist => other_apps::read_metrolist(first, now_ms).await,
        _ => {
            let paths = paths.to_vec();
            let library_name = library_name.to_string();
            tokio::task::spawn_blocking(move || read_files(kind, &paths, &library_name, now_ms))
                .await
                .map_err(|error| ImportError::Failed(error.to_string()))?
        }
    }
}

fn read_files(
    kind: ImportKind,
    paths: &[std::path::PathBuf],
    library_name: &str,
    now_ms: u64,
) -> Result<Found, ImportError> {
    let first = paths.first().ok_or(ImportError::NoContent)?;
    match kind {
        ImportKind::Takeout => takeout::read_archives(paths, library_name, now_ms),
        ImportKind::YoutubeSubscriptions => takeout_csv::read_subscriptions_file(first),
        ImportKind::YoutubeHistory | ImportKind::FreetubeHistory => {
            other_apps::read_history_file(first, now_ms)
        }
        ImportKind::YoutubeLikes => takeout::read_likes_file(first),
        ImportKind::YoutubePlaylist => takeout_csv::read_playlist_file(first, false, false, now_ms),
        ImportKind::WatchLater => takeout_csv::read_playlist_file(first, false, true, now_ms),
        ImportKind::YoutubeMusicPlaylist => {
            takeout_csv::read_playlist_file(first, true, false, now_ms)
        }
        ImportKind::NewpipeSubscriptions => newpipe::read_subscriptions_file(first),
        ImportKind::LibretubeSubscriptions => other_apps::read_libretube_subscriptions(first),
        ImportKind::LibretubePlaylists => other_apps::read_libretube_playlists(first, now_ms),
        ImportKind::LibretubeBackup => other_apps::read_libretube_backup(first, now_ms),
        ImportKind::NewpipeHistory
        | ImportKind::NewpipePlaylists
        | ImportKind::NewpipeBackup
        | ImportKind::Metrolist => Err(ImportError::InvalidFormat),
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::{SimpleFileOptions, ZipWriter};

    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("flow-import-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        pub fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }

        pub fn zip(&self, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
            let path = self.0.join(name);
            let mut zip = ZipWriter::new(std::fs::File::create(&path).unwrap());
            for (entry, bytes) in entries {
                zip.start_file(*entry, SimpleFileOptions::default())
                    .unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::TempDir;
    use super::*;

    #[test]
    fn video_links_read_as_android_reads_them() {
        assert_eq!(
            video_id_of_url("https://www.youtube.com/watch?list=x&v=abcdefghijk&t=1").as_deref(),
            Some("abcdefghijk")
        );
        assert_eq!(
            video_id_of_url("https://youtu.be/abcdefghijk?si=1").as_deref(),
            Some("abcdefghijk")
        );
        assert_eq!(video_id_of_url("https://vimeo.com/123"), None);
        assert_eq!(
            video_id_of_url("https://www.youtube.com/watch?v=short"),
            None
        );
    }

    #[test]
    fn channel_links_give_their_last_part() {
        assert_eq!(
            channel_id_of_url("https://youtube.com/channel/UCa/videos"),
            "UCa"
        );
        assert_eq!(channel_id_of_url("https://youtube.com/@name?x=1"), "name");
        assert_eq!(channel_id_of_url("https://example.com"), "");
    }

    #[test]
    fn a_zip_is_not_opened_when_it_claims_too_many_entries() {
        let dir = TempDir::new();
        let good = dir.zip("good.zip", &[("a", b"1"), ("b", b"2")]);
        let mut file = File::open(&good).unwrap();
        assert_eq!(claimed_entries(&mut file).unwrap(), Some(2));
        assert_eq!(open_zip(&good).unwrap().len(), 2);

        let not_zip = dir.file("text.zip", b"PK this is not a zip");
        assert!(matches!(
            open_zip(&not_zip),
            Err(ImportError::InvalidFormat)
        ));

        // A forged zip64 directory record claiming billions of entries.
        let mut bomb = Vec::new();
        bomb.extend_from_slice(&[0x50, 0x4B, 0x06, 0x06]);
        bomb.extend_from_slice(&[0; 28]);
        bomb.extend_from_slice(&(u64::MAX / 2).to_le_bytes());
        bomb.extend_from_slice(&[0; 16]);
        bomb.extend_from_slice(&[0x50, 0x4B, 0x06, 0x07, 0, 0, 0, 0]);
        bomb.extend_from_slice(&0_u64.to_le_bytes());
        bomb.extend_from_slice(&[1, 0, 0, 0]);
        bomb.extend_from_slice(&[0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]);
        bomb.extend_from_slice(&[0; 10]);
        let forged = dir.file("forged.zip", &bomb);
        assert!(matches!(open_zip(&forged), Err(ImportError::TooLarge)));
    }

    #[test]
    fn a_small_file_read_stops_at_its_limit() {
        let dir = TempDir::new();
        let big = dir.file("big", &[0; 2048]);
        assert!(matches!(
            read_file_limited(&big, 1024),
            Err(ImportError::TooLarge)
        ));
        assert_eq!(read_file_limited(&big, 4096).unwrap().len(), 2048);
    }
}
