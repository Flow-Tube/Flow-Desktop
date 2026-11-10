//! NewPipe: subscriptions from its JSON export; history and playlists from the SQLite database in
//! its backup zip, or the bare database file.

use std::collections::HashMap;
use std::path::Path;

use chrono::DateTime;
use serde_json::Value;

use super::db_file::{are_real_tables, copy_to_temp, fetch_rows, int_at, open_read_only, text_at};
use super::{
    Channel, Found, ImportError, MAX_CHANNELS, MAX_JSON_BYTES, MAX_PLAYLISTS, TakenPlaylist, Track,
    Watch, channel_id_of_url, clean, is_channel_id, read_file_limited, video_id_of_url,
};

const DB_ENTRY: &str = "newpipe.db";
const YOUTUBE_HOSTS: [&str; 4] = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
];
const YOUTUBE_SERVICE_ID: i64 = 0;

/// Timestamps are numbers or dates, depending on the NewPipe version.
fn timestamp_of(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    raw.parse::<u64>().ok().or_else(|| {
        let date = DateTime::parse_from_rfc3339(raw).ok()?;
        u64::try_from(date.timestamp_millis()).ok()
    })
}

async fn read_history_rows(pool: &sqlx::SqlitePool, now: u64) -> Result<Vec<Watch>, ImportError> {
    if !are_real_tables(pool, &["stream_history", "streams"]).await? {
        return Err(ImportError::InvalidFormat);
    }
    // Older NewPipe databases have no saved positions.
    let sql = if are_real_tables(pool, &["stream_state"]).await? {
        "SELECT s.url, substr(s.title, 1, 2000), s.duration, substr(s.uploader, 1, 2000),
                s.uploader_url, CAST(h.access_date AS TEXT), COALESCE(ss.progress_time, 0)
         FROM stream_history h
         INNER JOIN streams s ON s.uid = h.stream_id
         LEFT JOIN stream_state ss ON ss.stream_id = s.uid
         ORDER BY h.access_date DESC LIMIT ?"
    } else {
        "SELECT s.url, substr(s.title, 1, 2000), s.duration, substr(s.uploader, 1, 2000),
                s.uploader_url, CAST(h.access_date AS TEXT), 0
         FROM stream_history h
         INNER JOIN streams s ON s.uid = h.stream_id
         ORDER BY h.access_date DESC LIMIT ?"
    };
    let rows = fetch_rows(pool, sql).await?;
    let mut seen = std::collections::HashSet::new();
    let mut watches = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(video_id) = video_id_of_url(&text_at(row, 0)) else {
            continue;
        };
        let title = clean(&text_at(row, 1));
        // Listed newest first, so the first time a video appears is its last watch.
        if title.is_empty() || !seen.insert(video_id.clone()) {
            continue;
        }
        let duration_seconds = u64::try_from(int_at(row, 2)).unwrap_or(0);
        let position_ms = u64::try_from(int_at(row, 6)).unwrap_or(0);
        let position_seconds = position_ms / 1000;
        watches.push(Watch {
            video_id,
            title,
            channel_name: clean(&text_at(row, 3)),
            channel_id: channel_id_of_url(&text_at(row, 4)),
            watched_at: timestamp_of(&text_at(row, 5))
                .unwrap_or_else(|| now.saturating_sub(index as u64)),
            is_music: false,
            duration_seconds,
            position_seconds: if duration_seconds > 0 {
                position_seconds.min(duration_seconds)
            } else {
                position_seconds
            },
        });
    }
    Ok(watches)
}

async fn read_playlist_rows(
    pool: &sqlx::SqlitePool,
    now: u64,
) -> Result<Vec<TakenPlaylist>, ImportError> {
    if !are_real_tables(pool, &["playlists", "playlist_stream_join", "streams"]).await? {
        return Err(ImportError::InvalidFormat);
    }
    let names = fetch_rows(
        pool,
        "SELECT uid, substr(name, 1, 2000) FROM playlists ORDER BY uid LIMIT ?",
    )
    .await?;
    let mut tracks: HashMap<i64, Vec<Track>> = HashMap::new();
    let rows = fetch_rows(
        pool,
        "SELECT j.playlist_id, s.url, substr(s.title, 1, 2000), substr(s.uploader, 1, 2000),
                s.uploader_url, s.duration
         FROM playlist_stream_join j
         INNER JOIN streams s ON s.uid = j.stream_id
         ORDER BY j.playlist_id, j.join_index LIMIT ?",
    )
    .await?;
    for row in &rows {
        let Some(video_id) = video_id_of_url(&text_at(row, 1)) else {
            continue;
        };
        tracks.entry(int_at(row, 0)).or_default().push(Track {
            video_id,
            title: clean(&text_at(row, 2)),
            artists: clean(&text_at(row, 3)),
            channel_id: channel_id_of_url(&text_at(row, 4)),
            duration_seconds: u64::try_from(int_at(row, 5)).unwrap_or(0),
            ..Track::default()
        });
    }
    Ok(names
        .iter()
        .take(MAX_PLAYLISTS)
        .filter_map(|row| {
            let uid = int_at(row, 0);
            let mut seen = std::collections::HashSet::new();
            let list: Vec<Track> = tracks
                .remove(&uid)?
                .into_iter()
                .filter(|track| seen.insert(track.video_id.clone()))
                .collect();
            let name = clean(&text_at(row, 1));
            (!list.is_empty()).then(|| TakenPlaylist {
                key: format!("newpipe_pl_{uid}"),
                name: if name.is_empty() {
                    "NewPipe playlist".into()
                } else {
                    name
                },
                created_at: now,
                tracks: list,
                ..TakenPlaylist::default()
            })
        })
        .collect())
}

async fn with_database<T>(
    path: &Path,
    read: impl AsyncFnOnce(&sqlx::SqlitePool) -> Result<T, ImportError>,
) -> Result<T, ImportError> {
    let source = path.to_path_buf();
    let temp = tokio::task::spawn_blocking(move || copy_to_temp(&source, DB_ENTRY))
        .await
        .map_err(|error| ImportError::Failed(error.to_string()))??;
    let pool = open_read_only(&temp).await?;
    let result = read(&pool).await;
    pool.close().await;
    result
}

pub async fn read_history(path: &Path, now: u64) -> Result<Found, ImportError> {
    let watches = with_database(path, async |pool| read_history_rows(pool, now).await).await?;
    if watches.is_empty() {
        return Err(ImportError::NoEntries);
    }
    Ok(Found {
        watches,
        ..Found::default()
    })
}

pub async fn read_playlists(path: &Path, now: u64) -> Result<Found, ImportError> {
    let playlists = with_database(path, async |pool| read_playlist_rows(pool, now).await).await?;
    if playlists.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        playlists,
        ..Found::default()
    })
}

/// Everything a NewPipe backup holds that Flow keeps.
pub async fn read_backup(path: &Path, now: u64) -> Result<Found, ImportError> {
    let (watches, playlists) = with_database(path, async |pool| {
        Ok((
            read_history_rows(pool, now).await.unwrap_or_default(),
            read_playlist_rows(pool, now).await.unwrap_or_default(),
        ))
    })
    .await?;
    if watches.is_empty() && playlists.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        watches,
        playlists,
        ..Found::default()
    })
}

/// Where a NewPipe entry points: an id, or a link only YouTube can turn into one.
#[derive(Debug, PartialEq, Eq)]
pub enum ChannelRef {
    Id(String),
    Handle(String),
    Legacy(String),
}

fn is_handle(handle: &str) -> bool {
    !handle.is_empty()
        && handle.chars().count() <= 100
        && handle
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// A channel link as Android's `NewPipeSubscriptionCodec` reads it; `None` if it isn't one.
#[must_use]
pub fn parse_channel_url(url: &str) -> Option<ChannelRef> {
    let url = url.trim();
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let (host, path) = rest.split_once('/')?;
    if !YOUTUBE_HOSTS.contains(&host.to_lowercase().as_str()) {
        return None;
    }
    let path = path.split(['?', '#']).next()?;
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let first = parts.next()?;
    let second = parts.next();
    if first == "channel" {
        return second
            .filter(|id| is_channel_id(id))
            .map(|id| ChannelRef::Id(id.to_string()));
    }
    if let Some(handle) = first.strip_prefix('@') {
        return is_handle(handle).then(|| ChannelRef::Handle(handle.to_string()));
    }
    if first == "user" || first == "c" {
        return second
            .filter(|name| !name.trim().is_empty())
            .map(|name| ChannelRef::Legacy(format!("https://www.youtube.com/{first}/{name}")));
    }
    None
}

/// Channels with an id go straight in. A handle or an old link needs YouTube to resolve it, which
/// happens later and online: the handle or link stands in for the id until then.
fn subscriptions_from(value: &Value) -> Result<Vec<Channel>, ImportError> {
    let entries = value
        .get("subscriptions")
        .and_then(Value::as_array)
        .ok_or(ImportError::InvalidFormat)?;
    let mut seen = std::collections::HashSet::new();
    Ok(entries
        .iter()
        .filter(|entry| {
            entry
                .get("service_id")
                .and_then(Value::as_i64)
                .unwrap_or(YOUTUBE_SERVICE_ID)
                == YOUTUBE_SERVICE_ID
        })
        .filter_map(|entry| {
            let url = entry.get("url")?.as_str()?;
            let id = match parse_channel_url(url)? {
                ChannelRef::Id(id) => id,
                ChannelRef::Handle(handle) => format!("@{handle}"),
                ChannelRef::Legacy(link) => link,
            };
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .map(clean)
                .unwrap_or_default();
            seen.insert(id.clone()).then(|| Channel {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                avatar: String::new(),
            })
        })
        .take(MAX_CHANNELS)
        .collect())
}

pub fn read_subscriptions_file(path: &Path) -> Result<Found, ImportError> {
    let bytes = read_file_limited(path, MAX_JSON_BYTES)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ImportError::InvalidFormat)?;
    let channels = subscriptions_from(&value)?;
    if channels.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        channels,
        ..Found::default()
    })
}

#[cfg(test)]
mod tests {
    use super::super::db_file::test_db;
    use super::super::test_support::TempDir;
    use super::*;
    use serde_json::json;

    const SCHEMA: [&str; 4] = [
        "CREATE TABLE streams (uid INTEGER PRIMARY KEY, url TEXT, title TEXT, duration INTEGER, uploader TEXT, uploader_url TEXT, thumbnail_url TEXT)",
        "CREATE TABLE stream_history (stream_id INTEGER, access_date INTEGER, repeat_count INTEGER)",
        "CREATE TABLE stream_state (stream_id INTEGER, progress_time INTEGER)",
        "CREATE TABLE playlists (uid INTEGER PRIMARY KEY, name TEXT)",
    ];
    const SCHEMA_JOIN: &str = "CREATE TABLE playlist_stream_join (playlist_id INTEGER, stream_id INTEGER, join_index INTEGER)";

    async fn newpipe_db(dir: &TempDir) -> std::path::PathBuf {
        let path = dir.0.join("newpipe.db");
        let mut statements: Vec<&str> = SCHEMA.to_vec();
        statements.push(SCHEMA_JOIN);
        statements.extend([
            "INSERT INTO streams VALUES (1, 'https://www.youtube.com/watch?v=abcdefghijk', 'One', 100, 'Chan', 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', '')",
            "INSERT INTO streams VALUES (2, 'https://youtu.be/lmnopqrstuv', 'Two', 50, 'Other', '', '')",
            "INSERT INTO streams VALUES (3, 'https://soundcloud.com/x', 'Not YouTube', 50, 'S', '', '')",
            "INSERT INTO stream_history VALUES (1, 2000, 1)",
            "INSERT INTO stream_history VALUES (1, 1000, 1)",
            "INSERT INTO stream_history VALUES (2, 3000, 1)",
            "INSERT INTO stream_history VALUES (3, 4000, 1)",
            "INSERT INTO stream_state VALUES (1, 40000)",
            "INSERT INTO playlists VALUES (7, 'Road trip')",
            "INSERT INTO playlists VALUES (8, 'Only others')",
            "INSERT INTO playlist_stream_join VALUES (7, 2, 0)",
            "INSERT INTO playlist_stream_join VALUES (7, 1, 1)",
            "INSERT INTO playlist_stream_join VALUES (8, 3, 0)",
        ]);
        test_db::create(&path, &statements).await;
        path
    }

    #[tokio::test]
    async fn history_comes_from_the_database() {
        let dir = TempDir::new();
        let db = newpipe_db(&dir).await;
        let before = std::fs::read(&db).unwrap();
        let found = read_history(&db, 9_000).await.unwrap();
        assert_eq!(found.watches.len(), 2, "one row per video, YouTube only");
        let one = found
            .watches
            .iter()
            .find(|w| w.video_id == "abcdefghijk")
            .unwrap();
        assert_eq!(one.watched_at, 2000, "its newest watch");
        assert_eq!(one.position_seconds, 40);
        assert_eq!(one.channel_id, "UCaaaaaaaaaaaaaaaaaaaaaa");
        assert!(!one.is_music);
        assert_eq!(
            std::fs::read(&db).unwrap(),
            before,
            "the original is untouched"
        );
    }

    #[tokio::test]
    async fn playlists_come_from_the_database_in_order() {
        let dir = TempDir::new();
        let db = newpipe_db(&dir).await;
        let found = read_playlists(&db, 5).await.unwrap();
        assert_eq!(
            found.playlists.len(),
            1,
            "one with no YouTube video is left out"
        );
        let playlist = &found.playlists[0];
        assert_eq!(playlist.name, "Road trip");
        assert_eq!(playlist.key, "newpipe_pl_7");
        assert_eq!(playlist.tracks[0].video_id, "lmnopqrstuv");
        assert_eq!(playlist.tracks[1].title, "One");
    }

    #[tokio::test]
    async fn the_backup_zip_works_like_the_bare_file() {
        let dir = TempDir::new();
        let db = newpipe_db(&dir).await;
        let bytes = std::fs::read(&db).unwrap();
        let zip = dir.zip(
            "NewPipeData.zip",
            &[("newpipe.db", &bytes), ("newpipe.settings", b"x")],
        );
        let found = read_backup(&zip, 1).await.unwrap();
        assert_eq!(found.watches.len(), 2);
        assert_eq!(found.playlists.len(), 1);
    }

    #[tokio::test]
    async fn a_database_of_something_else_is_refused() {
        let dir = TempDir::new();
        let path = dir.0.join("other.db");
        test_db::create(&path, &["CREATE TABLE notes (a)"]).await;
        assert!(matches!(
            read_history(&path, 0).await,
            Err(ImportError::InvalidFormat)
        ));
        assert!(matches!(
            read_backup(&path, 0).await,
            Err(ImportError::NoContent)
        ));
    }

    #[tokio::test]
    async fn views_named_like_its_tables_do_not_run() {
        let dir = TempDir::new();
        let path = dir.0.join("hostile.db");
        test_db::create(
            &path,
            &[
                "CREATE TABLE streams (uid INTEGER, url TEXT, title TEXT, duration INTEGER, uploader TEXT, uploader_url TEXT)",
                "CREATE VIEW stream_history AS WITH RECURSIVE c(stream_id, access_date) AS (SELECT 1, 1 UNION ALL SELECT stream_id, access_date + 1 FROM c) SELECT * FROM c",
            ],
        )
        .await;
        assert!(matches!(
            read_history(&path, 0).await,
            Err(ImportError::InvalidFormat)
        ));
    }

    #[test]
    fn channel_links_read_as_android_reads_them() {
        let id = "UCaaaaaaaaaaaaaaaaaaaaaa";
        assert_eq!(
            parse_channel_url(&format!("https://www.youtube.com/channel/{id}/videos")),
            Some(ChannelRef::Id(id.to_string()))
        );
        assert_eq!(
            parse_channel_url("https://m.youtube.com/@name?x=1"),
            Some(ChannelRef::Handle("name".into()))
        );
        assert_eq!(
            parse_channel_url("youtube.com/user/old"),
            Some(ChannelRef::Legacy(
                "https://www.youtube.com/user/old".into()
            ))
        );
        assert_eq!(parse_channel_url("https://evil.example/channel/UCx"), None);
        assert_eq!(
            parse_channel_url("https://www.youtube.com/channel/short"),
            None
        );
    }

    #[test]
    fn a_subscription_file_keeps_only_youtube() {
        let id = "UCaaaaaaaaaaaaaaaaaaaaaa";
        let channels = subscriptions_from(&json!({ "subscriptions": [
            { "service_id": 0, "url": format!("https://www.youtube.com/channel/{id}"), "name": "A" },
            { "service_id": 0, "url": format!("https://www.youtube.com/channel/{id}"), "name": "Again" },
            { "service_id": 1, "url": "https://soundcloud.com/x", "name": "B" },
            { "service_id": 0, "url": "https://www.youtube.com/@handle", "name": "" },
        ]}))
        .unwrap();
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name, "A");
        assert_eq!(channels[1].id, "@handle");
        assert_eq!(channels[1].name, "@handle");
    }

    #[test]
    fn a_wrong_file_never_reads_as_an_empty_one() {
        assert!(matches!(
            subscriptions_from(&json!({ "other": [] })),
            Err(ImportError::InvalidFormat)
        ));
    }
}
