//! The folder library's rows. Folders and files are the same for every profile, so callers pass
//! `db::device::pool`; plays belong to the profile and use its own pool. None of these rows is
//! read by sync.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

use crate::errors::{AppError, AppResult};
use crate::local_media::{FolderRole, LocalMediaFile, LocalMediaPlay};

const FILE_COLUMNS: &str = "id, path, folder_path, kind, title, file_name, artist, album, \
    duration_ms, size_bytes, added_ms, modified_ms, width, height, frame_rate, bitrate_kbps, \
    video_codec, audio_codec";

/// A panic while reading a file ends the process (release builds abort), so the scan notes what it
/// is about to read here, where the next pass can find it.
const READING_MARKER_KEY: &str = "local_media_reading";

/// The files a pass was reading if it never finished. `alone` means they were being read one at a
/// time because an earlier pass stopped on them: that second stop rules out a plain quit.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadingMarker {
    pub ids: Vec<String>,
    pub alone: bool,
}

pub async fn reading_marker(pool: &SqlitePool) -> AppResult<ReadingMarker> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(READING_MARKER_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(raw
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

pub async fn set_reading_marker(pool: &SqlitePool, marker: &ReadingMarker) -> AppResult<()> {
    let value =
        serde_json::to_string(marker).map_err(|error| AppError::Internal(error.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(READING_MARKER_KEY)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

/// SQLite takes at most this many bound values in one statement by default here.
const MAX_IDS_PER_DELETE: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownFile {
    pub path: String,
    pub size_bytes: i64,
    pub modified_ms: i64,
}

pub async fn folders(pool: &SqlitePool) -> AppResult<Vec<(String, FolderRole)>> {
    let rows = sqlx::query("SELECT path, role FROM local_media_folders ORDER BY added_ms, path")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let role = if row.get::<String, _>("role") == "exclude" {
                FolderRole::Exclude
            } else {
                FolderRole::Include
            };
            (row.get("path"), role)
        })
        .collect())
}

pub async fn add_folder(
    pool: &SqlitePool,
    path: &str,
    role: FolderRole,
    now_ms: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO local_media_folders (path, role, added_ms) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET role = excluded.role",
    )
    .bind(path)
    .bind(role.as_str())
    .bind(now_ms)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_folder(pool: &SqlitePool, path: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM local_media_folders WHERE path = ?")
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn files(pool: &SqlitePool) -> AppResult<Vec<LocalMediaFile>> {
    let query = format!("SELECT {FILE_COLUMNS} FROM local_media_files");
    Ok(
        sqlx::query_as::<_, LocalMediaFile>(sqlx::AssertSqlSafe(query))
            .fetch_all(pool)
            .await?,
    )
}

pub async fn file(pool: &SqlitePool, id: &str) -> AppResult<Option<LocalMediaFile>> {
    let query = format!("SELECT {FILE_COLUMNS} FROM local_media_files WHERE id = ?");
    Ok(
        sqlx::query_as::<_, LocalMediaFile>(sqlx::AssertSqlSafe(query))
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn known_files(pool: &SqlitePool) -> AppResult<HashMap<String, KnownFile>> {
    let rows = sqlx::query("SELECT id, path, size_bytes, modified_ms FROM local_media_files")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get("id"),
                KnownFile {
                    path: row.get("path"),
                    size_bytes: row.get("size_bytes"),
                    modified_ms: row.get("modified_ms"),
                },
            )
        })
        .collect())
}

pub async fn upsert_files(pool: &SqlitePool, rows: &[LocalMediaFile]) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut transaction = pool.begin().await?;
    for row in rows {
        sqlx::query(
            "INSERT INTO local_media_files (id, path, folder_path, kind, title, file_name, artist,
                album, duration_ms, size_bytes, added_ms, modified_ms, width, height, frame_rate,
                bitrate_kbps, video_codec, audio_codec)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, artist = excluded.artist, album = excluded.album,
                duration_ms = excluded.duration_ms, size_bytes = excluded.size_bytes,
                modified_ms = excluded.modified_ms, width = excluded.width,
                height = excluded.height, frame_rate = excluded.frame_rate,
                bitrate_kbps = excluded.bitrate_kbps, video_codec = excluded.video_codec,
                audio_codec = excluded.audio_codec",
        )
        .bind(&row.id)
        .bind(&row.path)
        .bind(&row.folder_path)
        .bind(&row.kind)
        .bind(&row.title)
        .bind(&row.file_name)
        .bind(&row.artist)
        .bind(&row.album)
        .bind(row.duration_ms)
        .bind(row.size_bytes)
        .bind(row.added_ms)
        .bind(row.modified_ms)
        .bind(row.width)
        .bind(row.height)
        .bind(row.frame_rate)
        .bind(row.bitrate_kbps)
        .bind(&row.video_codec)
        .bind(&row.audio_codec)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub async fn delete_files(pool: &SqlitePool, ids: &[String]) -> AppResult<()> {
    for chunk in ids.chunks(MAX_IDS_PER_DELETE) {
        let mut query = QueryBuilder::<Sqlite>::new("DELETE FROM local_media_files WHERE id IN (");
        let mut separated = query.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        query.build().execute(pool).await?;
    }
    Ok(())
}

pub async fn plays(pool: &SqlitePool) -> AppResult<Vec<LocalMediaPlay>> {
    Ok(sqlx::query_as::<_, LocalMediaPlay>(
        "SELECT file_id, position_ms, duration_ms, last_played_ms FROM local_media_plays",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn play(pool: &SqlitePool, id: &str) -> AppResult<Option<LocalMediaPlay>> {
    Ok(sqlx::query_as::<_, LocalMediaPlay>(
        "SELECT file_id, position_ms, duration_ms, last_played_ms FROM local_media_plays WHERE file_id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn record_play(pool: &SqlitePool, play: &LocalMediaPlay) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO local_media_plays (file_id, position_ms, duration_ms, last_played_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(file_id) DO UPDATE SET position_ms = excluded.position_ms,
            duration_ms = excluded.duration_ms, last_played_ms = excluded.last_played_ms",
    )
    .bind(&play.file_id)
    .bind(play.position_ms)
    .bind(play.duration_ms)
    .bind(play.last_played_ms)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_plays(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM local_media_plays")
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    pub(crate) async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn row(id: &str, path: &str) -> LocalMediaFile {
        LocalMediaFile {
            id: id.into(),
            path: path.into(),
            folder_path: "/m".into(),
            kind: "audio".into(),
            title: "t".into(),
            file_name: "f".into(),
            artist: String::new(),
            album: String::new(),
            duration_ms: 0,
            size_bytes: 1,
            added_ms: 1,
            modified_ms: 1,
            width: 0,
            height: 0,
            frame_rate: None,
            bitrate_kbps: None,
            video_codec: String::new(),
            audio_codec: String::new(),
        }
    }

    #[tokio::test]
    async fn a_rescan_keeps_when_the_file_was_first_added() {
        let pool = memory_pool().await;
        upsert_files(&pool, &[row("a", "/m/a.mp3")]).await.unwrap();
        let mut changed = row("a", "/m/a.mp3");
        changed.added_ms = 99;
        changed.title = "new".into();
        upsert_files(&pool, &[changed]).await.unwrap();
        let stored = file(&pool, "a").await.unwrap().unwrap();
        assert_eq!((stored.added_ms, stored.title.as_str()), (1, "new"));
    }

    #[tokio::test]
    async fn deletes_any_number_of_rows() {
        let pool = memory_pool().await;
        let rows: Vec<_> = (0..(MAX_IDS_PER_DELETE + 3))
            .map(|index| row(&format!("id{index}"), &format!("/m/{index}")))
            .collect();
        upsert_files(&pool, &rows).await.unwrap();
        let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
        delete_files(&pool, &ids).await.unwrap();
        assert!(files(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_folder_can_change_role_and_be_removed() {
        let pool = memory_pool().await;
        add_folder(&pool, "/m", FolderRole::Include, 1)
            .await
            .unwrap();
        add_folder(&pool, "/m", FolderRole::Exclude, 2)
            .await
            .unwrap();
        assert_eq!(
            folders(&pool).await.unwrap(),
            vec![("/m".to_string(), FolderRole::Exclude)]
        );
        remove_folder(&pool, "/m").await.unwrap();
        assert!(folders(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn plays_keep_the_latest_position_and_clear() {
        let pool = memory_pool().await;
        let mut record = LocalMediaPlay {
            file_id: "a".into(),
            position_ms: 1,
            duration_ms: 10,
            last_played_ms: 5,
        };
        record_play(&pool, &record).await.unwrap();
        record.position_ms = 9;
        record_play(&pool, &record).await.unwrap();
        assert_eq!(play(&pool, "a").await.unwrap().unwrap().position_ms, 9);
        clear_plays(&pool).await.unwrap();
        assert!(plays(&pool).await.unwrap().is_empty());
    }
}
