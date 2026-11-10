//! Walks the chosen folders and files what it finds. Every step can be cancelled, and the walk,
//! the number of files and the work done at once are all bounded, so a huge or slow disk costs
//! a slow scan and nothing else.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sqlx::SqlitePool;

use super::probe::{Probed, probe_file};
use super::{FolderRole, LocalMediaFile, MediaKind, file_id, formats};
use crate::db::local_media as db;
use crate::errors::AppResult;

const MAX_DEPTH: usize = 32;
const MAX_FILES: usize = 100_000;
/// Files read at once. Tags sit at both ends of a file, so on a spinning disk more only thrashes.
const PROBE_CONCURRENCY: usize = 2;
const WRITE_BATCH: usize = 64;

/// Folder names that hold no media a person chose, on any system.
const SKIPPED_FOLDERS: [&str; 5] = [
    "node_modules",
    "$RECYCLE.BIN",
    "System Volume Information",
    "__MACOSX",
    "lost+found",
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub running: bool,
    pub done: usize,
    pub total: usize,
    /// More files than the limit: the rest aren't listed.
    pub truncated: bool,
    pub failed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeenFile {
    pub path: PathBuf,
    pub kind: MediaKind,
    pub size_bytes: i64,
    pub modified_ms: i64,
    pub added_ms: i64,
}

#[derive(Debug, Default)]
pub struct Walk {
    pub files: Vec<SeenFile>,
    pub truncated: bool,
}

pub fn millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |elapsed| {
        i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
    })
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn skips_folder(name: &str) -> bool {
    is_hidden(name)
        || SKIPPED_FOLDERS.contains(&name)
        || std::path::Path::new(name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
}

/// Links are not followed: one could lead out of the chosen folder, or round in a circle.
pub fn walk(
    roots: &[PathBuf],
    excludes: &[PathBuf],
    max_files: usize,
    cancel: &AtomicBool,
) -> Walk {
    let mut found = Walk::default();
    let mut visited = HashSet::new();
    let mut stack: Vec<(PathBuf, usize)> = roots.iter().map(|root| (root.clone(), 0)).collect();
    while let Some((dir, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) || found.truncated {
            break;
        }
        if excludes.iter().any(|excluded| dir.starts_with(excluded)) || !visited.insert(dir.clone())
        {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let entries: Vec<_> = entries.flatten().collect();
        if entries.iter().any(|entry| entry.file_name() == ".nomedia") {
            continue;
        }
        for entry in entries {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if file_type.is_dir() {
                if depth < MAX_DEPTH && !skips_folder(&name) {
                    stack.push((entry.path(), depth + 1));
                }
            } else if file_type.is_file() && !is_hidden(&name) {
                let path = entry.path();
                let Some(kind) = formats::kind_of(&path) else {
                    continue;
                };
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if found.files.len() >= max_files {
                    found.truncated = true;
                    break;
                }
                let modified_ms = metadata.modified().map_or(0, millis);
                found.files.push(SeenFile {
                    path,
                    kind,
                    size_bytes: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
                    modified_ms,
                    added_ms: metadata.created().map_or(modified_ms, millis),
                });
            }
        }
    }
    found
}

fn stem_of(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The row a found file becomes. A file with no title tag is listed under its name.
pub fn to_row(seen: &SeenFile, probed: Probed) -> LocalMediaFile {
    let path = &seen.path;
    LocalMediaFile {
        id: file_id(path),
        path: path.to_string_lossy().into_owned(),
        folder_path: path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_default(),
        kind: seen.kind.as_str().to_string(),
        title: probed.title.unwrap_or_else(|| stem_of(path)),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        artist: probed.artist.unwrap_or_default(),
        album: probed.album.unwrap_or_default(),
        duration_ms: i64::try_from(probed.duration_ms).unwrap_or(i64::MAX),
        size_bytes: seen.size_bytes,
        added_ms: seen.added_ms,
        modified_ms: seen.modified_ms,
        width: i64::from(probed.width),
        height: i64::from(probed.height),
        frame_rate: probed.frame_rate,
        bitrate_kbps: probed.bitrate_kbps.map(i64::from),
        video_codec: probed.video_codec,
        audio_codec: probed.audio_codec,
    }
}

/// The folders of one role that can be reached now, resolved so `starts_with` compares like
/// with like.
pub fn resolved_folders(folders: &[(String, FolderRole)], role: FolderRole) -> Vec<PathBuf> {
    folders
        .iter()
        .filter(|(_, folder_role)| *folder_role == role)
        .filter_map(|(path, _)| std::fs::canonicalize(path).ok())
        .collect()
}

/// One full pass: new and changed files are read, unchanged ones are left alone, and rows for
/// files that are gone are dropped. Rows under a folder that can't be reached stay, so an
/// unplugged drive doesn't cost its index. A cancelled or truncated pass deletes nothing.
pub async fn run(
    device_pool: &SqlitePool,
    cancel: &Arc<AtomicBool>,
    report: impl Fn(ScanStatus),
) -> AppResult<ScanStatus> {
    run_with(device_pool, cancel, report, probe_file).await
}

async fn run_with(
    device_pool: &SqlitePool,
    cancel: &Arc<AtomicBool>,
    report: impl Fn(ScanStatus),
    probe: impl Fn(&Path, MediaKind) -> Probed + Send + Sync + 'static,
) -> AppResult<ScanStatus> {
    let folders = db::folders(device_pool).await?;
    let roots = resolved_folders(&folders, FolderRole::Include);
    let excludes = resolved_folders(&folders, FolderRole::Exclude);

    let walked = {
        let (roots, excludes, cancel) = (roots.clone(), excludes.clone(), Arc::clone(cancel));
        tokio::task::spawn_blocking(move || walk(&roots, &excludes, MAX_FILES, &cancel))
            .await
            .unwrap_or_default()
    };
    let mut status = ScanStatus {
        running: true,
        done: 0,
        total: walked.files.len(),
        truncated: walked.truncated,
        failed: false,
    };
    report(status);

    let known = db::known_files(device_pool).await?;
    let seen_ids: HashSet<String> = walked
        .files
        .iter()
        .map(|seen| file_id(&seen.path))
        .collect();
    let changed = changed_files(walked.files, &known);
    status.done = status.total - changed.len();
    report(status);

    let last_pass = db::reading_marker(device_pool).await?;
    let in_last_pass = |seen: &SeenFile| last_pass.ids.contains(&file_id(&seen.path));
    let (marked, unmarked): (Vec<SeenFile>, Vec<SeenFile>) =
        changed.into_iter().partition(in_last_pass);
    let (to_read_alone, unread) = if last_pass.alone {
        (Vec::new(), marked)
    } else {
        (marked, Vec::new())
    };

    // These stopped the app twice. Named by their file name, they can't stop it a third time.
    let rows: Vec<LocalMediaFile> = unread
        .iter()
        .map(|seen| to_row(seen, Probed::default()))
        .collect();
    db::upsert_files(device_pool, &rows).await?;
    status.done += rows.len();

    // A pass also stops when the app simply quits, so a marked file gets one more read, on its own
    // so that a file read beside the bad one isn't blamed with it.
    let groups = to_read_alone
        .into_iter()
        .map(|seen| (vec![seen], true))
        .chain(
            unmarked
                .chunks(PROBE_CONCURRENCY)
                .map(|group| (group.to_vec(), false)),
        );
    let probe = Arc::new(probe);
    let mut pending = Vec::with_capacity(WRITE_BATCH);
    for (group, alone) in groups {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let ids = group.iter().map(|seen| file_id(&seen.path)).collect();
        db::set_reading_marker(device_pool, &db::ReadingMarker { ids, alone }).await?;
        let reads = group.into_iter().map(|seen| {
            let probe = Arc::clone(&probe);
            tokio::task::spawn_blocking(move || to_row(&seen, probe(&seen.path, seen.kind)))
        });
        for row in futures_util::future::join_all(reads).await {
            // Only a build that unwinds gets an error here; a release build has already aborted.
            if let Ok(row) = row {
                pending.push(row);
            }
            status.done += 1;
        }
        if alone || pending.len() >= WRITE_BATCH {
            db::upsert_files(device_pool, &pending).await?;
            pending.clear();
            report(status);
        }
    }
    db::upsert_files(device_pool, &pending).await?;
    db::set_reading_marker(device_pool, &db::ReadingMarker::default()).await?;

    if !cancel.load(Ordering::Relaxed) && !status.truncated {
        let gone: Vec<String> = known
            .into_iter()
            .filter(|(id, row)| {
                !seen_ids.contains(id) && (!row_is_on_a_missing_root(&row.path, &folders))
            })
            .map(|(id, _)| id)
            .collect();
        db::delete_files(device_pool, &gone).await?;
    }
    status.running = false;
    Ok(status)
}

fn row_is_on_a_missing_root(path: &str, folders: &[(String, FolderRole)]) -> bool {
    folders.iter().any(|(root, role)| {
        *role == FolderRole::Include
            && Path::new(path).starts_with(root)
            && !Path::new(root).is_dir()
    })
}

fn changed_files(seen: Vec<SeenFile>, known: &HashMap<String, db::KnownFile>) -> Vec<SeenFile> {
    seen.into_iter()
        .filter(|file| {
            known.get(&file_id(&file.path)).is_none_or(|row| {
                row.size_bytes != file.size_bytes || row.modified_ms != file.modified_ms
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::local_media::tests::memory_pool;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("flow-scan-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(std::fs::canonicalize(path).unwrap())
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"x").unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn names(walked: &Walk) -> Vec<String> {
        let mut names: Vec<String> = walked
            .files
            .iter()
            .map(|file| {
                file.path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn lists_media_and_skips_everything_else() {
        let dir = TempDir::new();
        dir.file("film.mp4");
        dir.file("album/song.FLAC");
        dir.file("notes.txt");
        dir.file(".hidden.mp3");
        dir.file(".cache/secret.mp3");
        dir.file("node_modules/pkg/sound.mp3");
        dir.file("quiet/.nomedia");
        dir.file("quiet/ringtone.mp3");
        let walked = walk(
            std::slice::from_ref(&dir.0),
            &[],
            MAX_FILES,
            &AtomicBool::new(false),
        );
        assert_eq!(names(&walked), vec!["film.mp4", "song.FLAC"]);
        assert!(!walked.truncated);
    }

    #[test]
    fn an_excluded_folder_is_not_walked() {
        let dir = TempDir::new();
        dir.file("keep/a.mp3");
        dir.file("skip/b.mp3");
        dir.file("skip/deep/c.mp3");
        let walked = walk(
            std::slice::from_ref(&dir.0),
            &[dir.0.join("skip")],
            MAX_FILES,
            &AtomicBool::new(false),
        );
        assert_eq!(names(&walked), vec!["a.mp3"]);
    }

    #[test]
    fn nested_folders_list_a_file_once() {
        let dir = TempDir::new();
        dir.file("album/song.mp3");
        let roots = [dir.0.clone(), dir.0.join("album")];
        let walked = walk(&roots, &[], MAX_FILES, &AtomicBool::new(false));
        assert_eq!(names(&walked), vec!["song.mp3"]);
    }

    #[test]
    fn stops_at_the_limit_and_when_cancelled() {
        let dir = TempDir::new();
        for index in 0..5 {
            dir.file(&format!("{index}.mp3"));
        }
        let walked = walk(
            std::slice::from_ref(&dir.0),
            &[],
            3,
            &AtomicBool::new(false),
        );
        assert_eq!(walked.files.len(), 3);
        assert!(walked.truncated);
        let cancelled = walk(
            std::slice::from_ref(&dir.0),
            &[],
            MAX_FILES,
            &AtomicBool::new(true),
        );
        assert!(cancelled.files.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_followed_out_of_the_folder() {
        let inside = TempDir::new();
        let outside = TempDir::new();
        outside.file("private/secret.mp3");
        let secret = outside.file("loose.mp3");
        std::os::unix::fs::symlink(outside.0.join("private"), inside.0.join("linked")).unwrap();
        std::os::unix::fs::symlink(secret, inside.0.join("linked.mp3")).unwrap();
        let walked = walk(
            std::slice::from_ref(&inside.0),
            &[],
            MAX_FILES,
            &AtomicBool::new(false),
        );
        assert!(walked.files.is_empty());
    }

    #[test]
    fn a_file_with_no_tags_is_listed_under_its_name() {
        let seen = SeenFile {
            path: PathBuf::from("/music/album/Song name.mp3"),
            kind: MediaKind::Audio,
            size_bytes: 1,
            modified_ms: 2,
            added_ms: 3,
        };
        let row = to_row(&seen, Probed::default());
        assert_eq!(row.title, "Song name");
        assert_eq!(row.file_name, "Song name.mp3");
        assert_eq!(row.folder_path, "/music/album");
        assert_eq!(row.kind, "audio");
    }

    #[tokio::test]
    async fn a_pass_adds_new_files_keeps_unchanged_ones_and_drops_the_gone() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        let root = dir.0.to_string_lossy().into_owned();
        db::add_folder(&pool, &root, FolderRole::Include, 1)
            .await
            .unwrap();
        let first = dir.file("first.mp3");
        let second = dir.file("second.mp3");
        let cancel = Arc::new(AtomicBool::new(false));

        let status = run(&pool, &cancel, |_| {}).await.unwrap();
        assert_eq!((status.done, status.total, status.running), (2, 2, false));
        assert_eq!(db::files(&pool).await.unwrap().len(), 2);

        // A row edited here proves an unchanged file isn't read again.
        sqlx::query("UPDATE local_media_files SET title = 'kept' WHERE path = ?")
            .bind(second.to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .unwrap();
        std::fs::remove_file(&first).unwrap();
        run(&pool, &cancel, |_| {}).await.unwrap();
        let rows = db::files(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "kept");
    }

    /// Runs a pass, noting each file it reads and what the marker said while it read it.
    async fn pass_noting_reads(pool: &SqlitePool) -> Vec<(String, db::ReadingMarker)> {
        let reads = Arc::new(std::sync::Mutex::new(Vec::new()));
        let noted = Arc::clone(&reads);
        let probe_pool = pool.clone();
        let runtime = tokio::runtime::Handle::current();
        let cancel = Arc::new(AtomicBool::new(false));
        run_with(
            pool,
            &cancel,
            |_| {},
            move |path, _| {
                let marker = runtime.block_on(db::reading_marker(&probe_pool)).unwrap();
                noted.lock().unwrap().push((stem_of(path), marker));
                Probed {
                    title: Some("read".into()),
                    ..Probed::default()
                }
            },
        )
        .await
        .unwrap();
        Arc::try_unwrap(reads).unwrap().into_inner().unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_marker_names_a_file_before_it_is_read_and_clears_after() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        db::add_folder(&pool, &dir.0.to_string_lossy(), FolderRole::Include, 1)
            .await
            .unwrap();
        let song = dir.file("song.mp3");
        let reads = pass_noting_reads(&pool).await;
        assert_eq!(reads.len(), 1);
        assert_eq!(
            reads[0].1,
            db::ReadingMarker {
                ids: vec![file_id(&song)],
                alone: false
            }
        );
        assert_eq!(
            db::reading_marker(&pool).await.unwrap(),
            db::ReadingMarker::default()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_file_a_pass_stopped_on_is_read_again_alone() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        db::add_folder(&pool, &dir.0.to_string_lossy(), FolderRole::Include, 1)
            .await
            .unwrap();
        let suspect = dir.file("suspect.mp3");
        dir.file("other.mp3");
        let ids = vec![file_id(&suspect)];
        db::set_reading_marker(
            &pool,
            &db::ReadingMarker {
                ids: ids.clone(),
                alone: false,
            },
        )
        .await
        .unwrap();

        let reads = pass_noting_reads(&pool).await;
        assert_eq!(reads.len(), 2);
        assert_eq!(
            reads[0],
            (
                "suspect".to_string(),
                db::ReadingMarker { ids, alone: true }
            )
        );
        assert!(
            db::files(&pool)
                .await
                .unwrap()
                .iter()
                .all(|row| row.title == "read")
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_file_that_stopped_a_pass_twice_is_listed_unread() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        db::add_folder(&pool, &dir.0.to_string_lossy(), FolderRole::Include, 1)
            .await
            .unwrap();
        let bad = dir.file("bad.mp3");
        dir.file("fine.mp3");
        db::set_reading_marker(
            &pool,
            &db::ReadingMarker {
                ids: vec![file_id(&bad)],
                alone: true,
            },
        )
        .await
        .unwrap();

        let reads = pass_noting_reads(&pool).await;
        assert_eq!(
            reads
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            ["fine"]
        );
        let rows = db::files(&pool).await.unwrap();
        let listed = rows.iter().find(|row| row.id == file_id(&bad)).unwrap();
        assert_eq!(listed.title, "bad");
        assert_eq!(
            db::reading_marker(&pool).await.unwrap(),
            db::ReadingMarker::default()
        );

        assert!(
            pass_noting_reads(&pool).await.is_empty(),
            "it stays listed, unread"
        );
    }

    #[tokio::test]
    async fn a_cancelled_pass_deletes_nothing() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        let root = dir.0.to_string_lossy().into_owned();
        db::add_folder(&pool, &root, FolderRole::Include, 1)
            .await
            .unwrap();
        dir.file("song.mp3");
        run(&pool, &Arc::new(AtomicBool::new(false)), |_| {})
            .await
            .unwrap();
        run(&pool, &Arc::new(AtomicBool::new(true)), |_| {})
            .await
            .unwrap();
        assert_eq!(db::files(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_unplugged_folder_keeps_its_rows() {
        let pool = memory_pool().await;
        let dir = TempDir::new();
        let root = dir.0.join("drive");
        std::fs::create_dir_all(&root).unwrap();
        let root_text = root.to_string_lossy().into_owned();
        db::add_folder(&pool, &root_text, FolderRole::Include, 1)
            .await
            .unwrap();
        dir.file("drive/song.mp3");
        let cancel = Arc::new(AtomicBool::new(false));
        run(&pool, &cancel, |_| {}).await.unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        run(&pool, &cancel, |_| {}).await.unwrap();
        assert_eq!(db::files(&pool).await.unwrap().len(), 1);
    }
}
