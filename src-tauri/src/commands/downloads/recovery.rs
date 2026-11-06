//! Finding files Flow saved that this library no longer lists, by the tags in them, and tagging
//! older downloads saved before Flow wrote tags. Field names match Android's `FlowTagFields`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::SqlitePool;

use super::muxer::{self, EmbeddedMetadata};
use super::tags::{DownloadTags, TagKind};
use crate::db::downloads::DownloadRecord;
use crate::errors::{AppError, AppResult};

/// Album and playlist folders sit one level under the download folder; a little more allows for
/// folders the viewer sorted by hand, without walking a whole drive.
const MAX_FOLDER_DEPTH: usize = 3;
const MAX_FILES: usize = 50_000;

/// The files under `folder` that could be downloads, skipping hidden names and partials.
fn media_files(folder: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        if found.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if depth < MAX_FOLDER_DEPTH {
                media_files(&path, depth + 1, found);
            }
        } else if kind.is_file() && extension(&path).is_some_and(|ext| is_media_extension(&ext)) {
            found.push(path);
        }
    }
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
}

fn is_media_extension(ext: &str) -> bool {
    matches!(ext, "mp4" | "m4a" | "mkv" | "webm")
}

fn is_mp4_extension(ext: &str) -> bool {
    matches!(ext, "mp4" | "m4a")
}

/// A file's Flow tags and length, whichever container it is in; `None` when it has none.
fn read_file_tags(path: &Path) -> Option<(HashMap<String, String>, Option<i64>)> {
    let ext = extension(path)?;
    let (fields, duration) = if is_mp4_extension(&ext) {
        let read = muxer::retag::read_mp4_flow_tags(path).ok()?;
        (read.fields, read.duration_seconds)
    } else {
        (muxer::matroska::read_flow_tags(path).ok()?, None)
    };
    (!fields.is_empty()).then_some((fields, duration))
}

/// What the library should hold for a file with these tags; `None` without a well-formed id.
fn record_from_tags(
    path: &Path,
    fields: &HashMap<String, String>,
    duration_seconds: Option<i64>,
    file_size_bytes: Option<i64>,
) -> Option<DownloadRecord> {
    let field = |name: &str| fields.get(name).filter(|value| !value.is_empty()).cloned();
    let video_id = field("videoid")?;
    crate::security::validation::validate_video_id(&video_id).ok()?;
    let is_music = field("kind").as_deref() == Some("MUSIC");
    let artists: Vec<String> = field("artists")
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    let author = (!artists.is_empty())
        .then(|| artists.join(", "))
        .or_else(|| field("channelname"));
    let title = field("title").or_else(|| {
        path.file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
    })?;
    Some(DownloadRecord {
        video_id: Some(video_id),
        title,
        author,
        media_kind: if is_music { "music" } else { "video" }.to_string(),
        file_path: path.to_string_lossy().into_owned(),
        thumbnail_url: field("thumbnailurl"),
        duration_seconds,
        file_size_bytes,
        artists_json: field("artists"),
        album: field("album"),
        album_id: field("albumid"),
        album_artist: field("albumartist"),
        track_number: field("tracknumber").and_then(|n| n.parse().ok()),
        track_total: field("tracktotal").and_then(|n| n.parse().ok()),
        release_date: field("releasedate"),
        description: field("description"),
        channel_id: field("channelid"),
        container: extension(path),
        ..DownloadRecord::default()
    })
}

/// Adds the tagged files under `folders` that the library doesn't list, and returns how many.
/// A download already listed for that video keeps its place: adding another would replace it and
/// delete its file.
pub async fn find_earlier_downloads(pool: &SqlitePool, folders: Vec<PathBuf>) -> AppResult<usize> {
    let existing = crate::db::downloads::list_downloads(pool).await?;
    let listed_paths: HashSet<String> = existing.iter().map(|r| r.file_path.clone()).collect();

    let (records, mut listed_items) = tokio::task::spawn_blocking(move || {
        // A row whose file has gone holds no place, so the moved file can take it over.
        let listed_items: HashSet<(String, String)> = existing
            .iter()
            .filter(|r| r.collection_db_id.is_none() && Path::new(&r.file_path).is_file())
            .filter_map(|r| Some((r.video_id.clone()?, r.media_kind.clone())))
            .collect();
        let mut files = Vec::new();
        for folder in &folders {
            media_files(folder, 0, &mut files);
        }
        let records = files
            .into_iter()
            .filter(|path| !listed_paths.contains(path.to_string_lossy().as_ref()))
            .filter_map(|path| {
                let (fields, duration) = read_file_tags(&path)?;
                let size = std::fs::metadata(&path)
                    .ok()
                    .and_then(|meta| i64::try_from(meta.len()).ok());
                record_from_tags(&path, &fields, duration, size)
            })
            .collect::<Vec<_>>();
        (records, listed_items)
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))?;

    let mut added = 0;
    for record in records {
        let Some(video_id) = record.video_id.clone() else {
            continue;
        };
        if listed_items.insert((video_id, record.media_kind.clone())) {
            crate::db::downloads::upsert_download(pool, &record).await?;
            added += 1;
        }
    }
    Ok(added)
}

/// The tags Flow would have written, from what the library kept about the download.
fn tags_from_record(record: &DownloadRecord) -> Option<DownloadTags> {
    let is_music = record.media_kind != "video";
    let artists: Vec<String> = record
        .artists_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();
    Some(DownloadTags {
        kind: if is_music {
            TagKind::Music
        } else {
            TagKind::Video
        },
        video_id: record.video_id.clone()?,
        title: record.title.clone(),
        artists,
        channel_id: record.channel_id.clone(),
        channel_name: record.author.clone(),
        album: record.album.clone(),
        album_id: record.album_id.clone(),
        album_artist: record.album_artist.clone(),
        track_number: record.track_number.and_then(|n| u32::try_from(n).ok()),
        track_total: record.track_total.and_then(|n| u32::try_from(n).ok()),
        release_date: record.release_date.clone(),
        description: record.description.clone(),
        thumbnail_url: record.thumbnail_url.clone(),
        ..DownloadTags::default()
    })
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetagResult {
    pub tagged: usize,
    pub skipped: usize,
}

/// Tags one download if it needs it: `Some(true)` tagged, `Some(false)` could not be, `None` had
/// its tags already. Only MP4 and M4A can be changed in place.
fn retag_file(record: &DownloadRecord) -> Option<bool> {
    let path = Path::new(&record.file_path);
    if !path.is_file() || !extension(path).is_some_and(|ext| is_mp4_extension(&ext)) {
        return Some(false);
    }
    let Ok(read) = muxer::retag::read_mp4_flow_tags(path) else {
        return Some(false);
    };
    if read.fields.contains_key("videoid") {
        return None;
    }
    let Some(tags) = tags_from_record(record) else {
        return Some(false);
    };
    let cover = record
        .cover_path
        .as_deref()
        .and_then(|cover| std::fs::read(cover).ok());
    let metadata = EmbeddedMetadata {
        tags,
        cover,
        chapters: Vec::new(),
    };
    Some(muxer::retag::set_mp4_tags(path, &metadata).is_ok())
}

/// Tags the downloads saved before Flow wrote tags.
pub async fn retag_older_downloads(pool: &SqlitePool) -> AppResult<RetagResult> {
    let records = crate::db::downloads::list_downloads(pool).await?;
    tokio::task::spawn_blocking(move || {
        let mut result = RetagResult::default();
        for record in &records {
            match retag_file(record) {
                Some(true) => result.tagged += 1,
                Some(false) => result.skipped += 1,
                None => {}
            }
        }
        result
    })
    .await
    .map_err(|error| AppError::Internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "dQw4w9WgXcQ";

    fn fields(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect()
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flow-recovery-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    /// A small song Flow wrote, tagged with `id`.
    fn tagged_song(dir: &Path, name: &str, id: &str) -> PathBuf {
        let path = dir.join(name);
        muxer::write_test_song(&path);
        muxer::retag::set_mp4_tags(
            &path,
            &EmbeddedMetadata {
                tags: DownloadTags {
                    kind: TagKind::Music,
                    video_id: id.into(),
                    title: "Song".into(),
                    artists: vec!["A".into(), "B".into()],
                    album: Some("Album".into()),
                    ..DownloadTags::default()
                },
                ..EmbeddedMetadata::default()
            },
        )
        .unwrap();
        path
    }

    #[test]
    fn a_record_comes_from_the_tags() {
        let record = record_from_tags(
            Path::new("/music/Band - Song.m4a"),
            &fields(&[
                ("videoid", ID),
                ("kind", "MUSIC"),
                ("title", "Song"),
                ("artists", r#"["A","B"]"#),
                ("tracknumber", "3"),
                ("channelid", "UC1"),
            ]),
            Some(200),
            Some(1_000),
        )
        .unwrap();
        assert_eq!(record.video_id.as_deref(), Some(ID));
        assert_eq!(record.media_kind, "music");
        assert_eq!(record.author.as_deref(), Some("A, B"));
        assert_eq!(record.track_number, Some(3));
        assert_eq!(record.container.as_deref(), Some("m4a"));
        assert_eq!(record.duration_seconds, Some(200));
    }

    #[test]
    fn a_video_uses_its_channel_and_a_missing_title_its_file_name() {
        let record = record_from_tags(
            Path::new("/videos/Clip.mp4"),
            &fields(&[("videoid", ID), ("kind", "VIDEO"), ("channelname", "Chan")]),
            None,
            None,
        )
        .unwrap();
        assert_eq!(record.media_kind, "video");
        assert_eq!(record.author.as_deref(), Some("Chan"));
        assert_eq!(record.title, "Clip");
    }

    #[test]
    fn a_file_without_a_good_id_makes_no_record() {
        let path = Path::new("/videos/Clip.mp4");
        assert!(record_from_tags(path, &fields(&[("title", "x")]), None, None).is_none());
        assert!(record_from_tags(path, &fields(&[("videoid", "../etc")]), None, None).is_none());
    }

    #[tokio::test]
    async fn finds_tagged_files_once_and_leaves_listed_ones_alone() {
        let pool = pool().await;
        let dir = scratch_dir("find");
        std::fs::create_dir_all(dir.join("Album")).unwrap();
        tagged_song(&dir, "one.m4a", ID);
        tagged_song(&dir.join("Album"), "two.m4a", "aaaaaaaaaaa");
        std::fs::write(dir.join("notes.txt"), "not media").unwrap();
        std::fs::write(dir.join("junk.mp4"), "not an mp4").unwrap();
        std::fs::write(dir.join(".hidden.m4a"), "partial").unwrap();

        let added = find_earlier_downloads(&pool, vec![dir.clone()])
            .await
            .unwrap();
        assert_eq!(added, 2);
        let listed = crate::db::downloads::list_downloads(&pool).await.unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|record| record.media_kind == "music"));

        assert_eq!(
            find_earlier_downloads(&pool, vec![dir.clone()])
                .await
                .unwrap(),
            0
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_second_copy_never_replaces_a_listed_download() {
        let pool = pool().await;
        let dir = scratch_dir("copy");
        let first = tagged_song(&dir, "first.m4a", ID);
        assert_eq!(
            find_earlier_downloads(&pool, vec![dir.clone()])
                .await
                .unwrap(),
            1
        );

        tagged_song(&dir, "second.m4a", ID);
        assert_eq!(
            find_earlier_downloads(&pool, vec![dir.clone()])
                .await
                .unwrap(),
            0
        );
        assert!(first.is_file());
        assert_eq!(
            crate::db::downloads::list_downloads(&pool)
                .await
                .unwrap()
                .len(),
            1
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_moved_download_is_found_in_its_new_place() {
        let pool = pool().await;
        let dir = scratch_dir("moved");
        let first = tagged_song(&dir, "first.m4a", ID);
        find_earlier_downloads(&pool, vec![dir.clone()])
            .await
            .unwrap();

        let moved = dir.join("moved.m4a");
        std::fs::rename(&first, &moved).unwrap();
        assert_eq!(
            find_earlier_downloads(&pool, vec![dir.clone()])
                .await
                .unwrap(),
            1
        );
        let listed = crate::db::downloads::list_downloads(&pool).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_path, moved.to_string_lossy());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn retags_what_has_no_tags_and_counts_what_it_cant() {
        let pool = pool().await;
        let dir = scratch_dir("retag");
        let untagged = dir.join("old.m4a");
        muxer::write_test_song(&untagged);
        let already = tagged_song(&dir, "new.m4a", "aaaaaaaaaaa");
        let matroska = dir.join("clip.mkv");
        std::fs::write(&matroska, "x").unwrap();
        for (path, id) in [
            (&untagged, ID),
            (&already, "aaaaaaaaaaa"),
            (&matroska, "bbbbbbbbbbb"),
        ] {
            crate::db::downloads::upsert_download(
                &pool,
                &DownloadRecord {
                    video_id: Some(id.into()),
                    title: "Title".into(),
                    media_kind: "music".into(),
                    file_path: path.to_string_lossy().into_owned(),
                    ..DownloadRecord::default()
                },
            )
            .await
            .unwrap();
        }

        let result = retag_older_downloads(&pool).await.unwrap();
        assert_eq!(
            result,
            RetagResult {
                tagged: 1,
                skipped: 1
            }
        );
        let read = muxer::retag::read_mp4_flow_tags(&untagged).unwrap();
        assert_eq!(read.fields.get("videoid").map(String::as_str), Some(ID));
        assert_eq!(
            retag_older_downloads(&pool).await.unwrap(),
            RetagResult {
                tagged: 0,
                skipped: 1
            }
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
