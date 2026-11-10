//! LibreTube's backup JSON, FreeTube's history, and Metrolist's backup zip.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::Value;

use super::db_file::{are_real_tables, copy_to_temp, fetch_rows, int_at, open_read_only, text_at};
use super::takeout_activity::{read_activity_json, read_history_html};
use super::{
    Channel, Found, ImportError, MAX_ACTIVITY_BYTES, MAX_CHANNELS, MAX_JSON_BYTES, MAX_PLAYLISTS,
    TakenPlaylist, Track, Watch, clean, is_video_id, read_file_limited, video_id_of_url,
};

const METROLIST_ENTRY: &str = "song.db";

fn json_file(path: &Path) -> Result<Value, ImportError> {
    let bytes = read_file_limited(path, MAX_JSON_BYTES)?;
    serde_json::from_slice(&bytes).map_err(|_| ImportError::InvalidFormat)
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(clean)
        .unwrap_or_default()
}

pub fn read_libretube_subscriptions(path: &Path) -> Result<Found, ImportError> {
    let value = json_file(path)?;
    let entries = value
        .get("subscriptions")
        .and_then(Value::as_array)
        .ok_or(ImportError::InvalidFormat)?;
    let mut seen = HashSet::new();
    let channels: Vec<Channel> = entries
        .iter()
        .filter_map(|entry| {
            let id = text(entry, "channelId");
            (!id.is_empty() && id.len() <= 128 && seen.insert(id.clone())).then(|| Channel {
                name: text(entry, "name"),
                avatar: text(entry, "avatar"),
                id,
            })
        })
        .take(MAX_CHANNELS)
        .collect();
    if channels.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        channels,
        ..Found::default()
    })
}

fn deduped(tracks: impl Iterator<Item = Track>) -> Vec<Track> {
    let mut seen = HashSet::new();
    tracks
        .filter(|track| seen.insert(track.video_id.clone()))
        .collect()
}

/// LibreTube's own `localPlaylists`, and the Piped-format `playlists` its exports also use.
fn libretube_playlists(value: &Value, now: u64) -> Vec<TakenPlaylist> {
    let mut playlists = Vec::new();
    let locals = value.get("localPlaylists").and_then(Value::as_array);
    for (index, entry) in locals.into_iter().flatten().enumerate() {
        let name = entry
            .get("playlist")
            .map(|p| text(p, "name"))
            .unwrap_or_default();
        let tracks = deduped(
            entry
                .get("videos")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|video| {
                    let id = text(video, "videoId");
                    is_video_id(&id).then(|| Track {
                        video_id: id,
                        title: text(video, "title"),
                        artists: text(video, "uploader"),
                        thumbnail: text(video, "thumbnailUrl"),
                        duration_seconds: video
                            .get("duration")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        ..Track::default()
                    })
                }),
        );
        if !tracks.is_empty() {
            playlists.push(TakenPlaylist {
                key: format!("libretube_local_{index}"),
                name: if name.is_empty() {
                    "LibreTube playlist".into()
                } else {
                    name
                },
                created_at: now,
                tracks,
                ..TakenPlaylist::default()
            });
        }
    }
    let piped = value.get("playlists").and_then(Value::as_array);
    for (index, entry) in piped.into_iter().flatten().enumerate() {
        let name = text(entry, "name");
        let tracks = deduped(
            entry
                .get("videos")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|url| video_id_of_url(url.as_str()?))
                .map(|video_id| Track {
                    video_id,
                    ..Track::default()
                }),
        );
        if !tracks.is_empty() {
            playlists.push(TakenPlaylist {
                key: format!("libretube_piped_{index}"),
                name: if name.is_empty() {
                    "LibreTube playlist".into()
                } else {
                    name
                },
                created_at: now,
                tracks,
                ..TakenPlaylist::default()
            });
        }
    }
    playlists.truncate(MAX_PLAYLISTS);
    playlists
}

pub fn read_libretube_playlists(path: &Path, now: u64) -> Result<Found, ImportError> {
    let playlists = libretube_playlists(&json_file(path)?, now);
    if playlists.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        playlists,
        ..Found::default()
    })
}

/// Everything in a LibreTube backup that Flow keeps.
pub fn read_libretube_backup(path: &Path, now: u64) -> Result<Found, ImportError> {
    let channels =
        read_libretube_subscriptions(path).map_or_else(|_| Vec::new(), |found| found.channels);
    let playlists = libretube_playlists(&json_file(path)?, now);
    if channels.is_empty() && playlists.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        channels,
        playlists,
        ..Found::default()
    })
}

/// FreeTube keeps watch progress in seconds, though a fraction has been seen in older exports.
fn freetube_watch(line: &str, index: usize, now: u64) -> Option<Watch> {
    let entry: Value = serde_json::from_str(line).ok()?;
    let video_id = text(&entry, "videoId");
    let title = text(&entry, "title");
    if video_id.is_empty() || video_id.len() > 64 || title.is_empty() {
        return None;
    }
    let duration_seconds = entry
        .get("lengthSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let progress = entry
        .get("watchProgress")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0);
    let position = if progress <= 1.0 {
        progress * duration_seconds as f64
    } else {
        progress.min(duration_seconds as f64)
    };
    Some(Watch {
        video_id,
        title,
        channel_name: text(&entry, "author"),
        channel_id: text(&entry, "authorId"),
        watched_at: entry
            .get("timeWatched")
            .and_then(Value::as_u64)
            .unwrap_or_else(|| now.saturating_sub(index as u64)),
        is_music: false,
        duration_seconds,
        position_seconds: position as u64,
    })
}

/// A history file on its own, told apart by its first characters: Takeout's HTML or JSON, or
/// FreeTube's one JSON object per line.
pub fn read_history_file(path: &Path, now: u64) -> Result<Found, ImportError> {
    let bytes = read_file_limited(path, MAX_ACTIVITY_BYTES)?;
    let start = bytes
        .iter()
        .find(|byte| !byte.is_ascii_whitespace() && !matches!(**byte, 0xEF | 0xBB | 0xBF))
        .copied();
    let watches = match start {
        Some(b'<') => read_history_html(bytes.as_slice(), now, false)?,
        Some(b'[') => {
            read_activity_json(bytes.as_slice(), true)
                .ok_or(ImportError::InvalidFormat)?
                .watches
        }
        Some(b'{') => {
            let text = String::from_utf8_lossy(&bytes);
            text.lines()
                .filter(|line| !line.trim().is_empty())
                .enumerate()
                .filter_map(|(index, line)| freetube_watch(line, index, now))
                .collect()
        }
        _ => return Err(ImportError::InvalidFormat),
    };
    if watches.is_empty() {
        return Err(ImportError::NoEntries);
    }
    Ok(Found {
        watches,
        ..Found::default()
    })
}

/// Every song's artists in credit order, with the first artist's channel.
async fn metrolist_credits(pool: &sqlx::SqlitePool) -> HashMap<String, (String, String)> {
    let is_there = are_real_tables(pool, &["song_artist_map", "artist"])
        .await
        .unwrap_or(false);
    // Older backups predate the artist tables; their songs import without artists.
    let rows = if is_there {
        fetch_rows(
            pool,
            "SELECT m.songId, substr(a.name, 1, 2000), a.channelId, a.id FROM song_artist_map m
             JOIN artist a ON a.id = m.artistId ORDER BY m.songId, m.position LIMIT ?",
        )
        .await
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut credits: HashMap<String, (Vec<String>, String)> = HashMap::new();
    for row in &rows {
        let name = clean(&text_at(row, 1));
        if name.is_empty() {
            continue;
        }
        let credit = credits.entry(text_at(row, 0)).or_default();
        if credit.0.is_empty() {
            let channel = text_at(row, 2);
            let id = if channel.trim().is_empty() {
                text_at(row, 3)
            } else {
                channel
            };
            if id.starts_with("UC") {
                credit.1 = id;
            }
        }
        credit.0.push(name);
    }
    credits
        .into_iter()
        .map(|(song, (names, channel))| (song, (names.join(", "), channel)))
        .collect()
}

async fn read_metrolist_rows(
    pool: &sqlx::SqlitePool,
    now: u64,
) -> Result<Vec<TakenPlaylist>, ImportError> {
    if !are_real_tables(pool, &["playlist", "song", "playlist_song_map"]).await? {
        return Err(ImportError::InvalidFormat);
    }
    let credits = metrolist_credits(pool).await;
    let names = fetch_rows(
        pool,
        "SELECT id, substr(name, 1, 2000) FROM playlist WHERE isLocal = 0 LIMIT ?",
    )
    .await?;
    let rows = fetch_rows(
        pool,
        "SELECT m.playlistId, s.id, substr(s.title, 1, 2000), s.thumbnailUrl, s.duration
         FROM playlist_song_map m
         INNER JOIN song s ON s.id = m.songId AND s.isLocal = 0
         ORDER BY m.playlistId, m.position LIMIT ?",
    )
    .await?;
    let mut tracks: HashMap<String, Vec<Track>> = HashMap::new();
    for row in &rows {
        let video_id = text_at(row, 1);
        if !is_video_id(&video_id) {
            continue;
        }
        let (artists, channel_id) = credits.get(&video_id).cloned().unwrap_or_default();
        tracks.entry(text_at(row, 0)).or_default().push(Track {
            video_id,
            title: clean(&text_at(row, 2)),
            artists,
            channel_id,
            thumbnail: clean(&text_at(row, 3)),
            duration_seconds: u64::try_from(int_at(row, 4)).unwrap_or(0),
        });
    }
    Ok(names
        .iter()
        .take(MAX_PLAYLISTS)
        .filter_map(|row| {
            let id = text_at(row, 0);
            let list = deduped(tracks.remove(&id)?.into_iter());
            let name = clean(&text_at(row, 1));
            (!list.is_empty()).then(|| TakenPlaylist {
                key: format!("metrolist_{}", clean(&id)),
                name: if name.is_empty() {
                    "Metrolist playlist".into()
                } else {
                    name
                },
                is_music: true,
                created_at: now,
                tracks: list,
                ..TakenPlaylist::default()
            })
        })
        .collect())
}

pub async fn read_metrolist(path: &Path, now: u64) -> Result<Found, ImportError> {
    let source = path.to_path_buf();
    let temp = tokio::task::spawn_blocking(move || copy_to_temp(&source, METROLIST_ENTRY))
        .await
        .map_err(|error| ImportError::Failed(error.to_string()))??;
    let pool = open_read_only(&temp).await?;
    let playlists = read_metrolist_rows(&pool, now).await;
    pool.close().await;
    let playlists = playlists?;
    if playlists.is_empty() {
        return Err(ImportError::NoContent);
    }
    Ok(Found {
        playlists,
        ..Found::default()
    })
}

#[cfg(test)]
mod tests {
    use super::super::db_file::test_db;
    use super::super::test_support::TempDir;
    use super::*;
    use serde_json::json;

    #[test]
    fn libretube_subscriptions_read() {
        let dir = TempDir::new();
        let path = dir.file(
            "libretube.json",
            json!({ "format": "Piped", "subscriptions": [
                { "channelId": "UCa", "name": "A", "avatar": "a.png" },
                { "channelId": "UCa", "name": "Again" },
                { "name": "No id" },
            ]})
            .to_string()
            .as_bytes(),
        );
        let found = read_libretube_subscriptions(&path).unwrap();
        assert_eq!(found.channels.len(), 1);
        assert_eq!(found.channels[0].avatar, "a.png");
    }

    #[test]
    fn libretube_playlists_read_in_both_formats() {
        let value = json!({
            "localPlaylists": [{
                "playlist": { "name": "Local" },
                "videos": [
                    { "videoId": "abcdefghijk", "title": "One", "uploader": "U", "thumbnailUrl": "t", "duration": 9 },
                    { "videoId": "abcdefghijk", "title": "Repeat" },
                    { "videoId": "bad" },
                ],
            }, { "playlist": { "name": "Empty" }, "videos": [] }],
            "playlists": [{ "name": "Piped", "videos": ["https://www.youtube.com/watch?v=lmnopqrstuv", 5] }],
        });
        let playlists = libretube_playlists(&value, 1);
        assert_eq!(playlists.len(), 2);
        assert_eq!(playlists[0].name, "Local");
        assert_eq!(playlists[0].tracks.len(), 1);
        assert_eq!(playlists[0].tracks[0].duration_seconds, 9);
        assert_eq!(playlists[1].tracks[0].video_id, "lmnopqrstuv");
    }

    #[test]
    fn a_libretube_file_with_no_playlists_says_so() {
        let dir = TempDir::new();
        let path = dir.file("x.json", br#"{"subscriptions":[]}"#);
        assert!(matches!(
            read_libretube_playlists(&path, 0),
            Err(ImportError::NoContent)
        ));
    }

    #[test]
    fn history_files_are_told_apart_by_their_start() {
        let dir = TempDir::new();
        let freetube = dir.file(
            "ft.db",
            br#"{"videoId":"abcdefghijk","title":"T","author":"A","authorId":"UCa","timeWatched":5,"lengthSeconds":100,"watchProgress":40}
{"videoId":"lmnopqrstuv","title":"F","lengthSeconds":100,"watchProgress":0.5}
not json
"#,
        );
        let found = read_history_file(&freetube, 9).unwrap();
        assert_eq!(found.watches.len(), 2);
        assert_eq!(found.watches[0].watched_at, 5);
        assert_eq!(found.watches[0].position_seconds, 40);
        assert_eq!(found.watches[1].position_seconds, 50);
        assert_eq!(found.watches[1].watched_at, 8);

        let takeout = dir.file(
            "history.json",
            br#"[{"title":"Watched A","titleUrl":"https://www.youtube.com/watch?v=abcdefghijk","time":"2024-01-01T00:00:00Z"}]"#,
        );
        assert_eq!(read_history_file(&takeout, 9).unwrap().watches.len(), 1);

        let html = dir.file(
            "history.html",
            br#"<html><a href="https://www.youtube.com/watch?v=abcdefghijk">A</a></html>"#,
        );
        assert_eq!(read_history_file(&html, 9).unwrap().watches.len(), 1);

        let csv = dir.file("x.csv", b"a,b\n");
        assert!(matches!(
            read_history_file(&csv, 9),
            Err(ImportError::InvalidFormat)
        ));
        let empty = dir.file("y.json", b"[]");
        assert!(matches!(
            read_history_file(&empty, 9),
            Err(ImportError::NoEntries)
        ));
    }

    async fn metrolist_zip(dir: &TempDir, with_artists: bool) -> std::path::PathBuf {
        let path = dir.0.join("song.db");
        let mut statements = vec![
            "CREATE TABLE playlist (id TEXT, name TEXT, thumbnailUrl TEXT, isLocal INTEGER)",
            "CREATE TABLE song (id TEXT, title TEXT, thumbnailUrl TEXT, duration INTEGER, isLocal INTEGER)",
            "CREATE TABLE playlist_song_map (playlistId TEXT, songId TEXT, position INTEGER)",
            "INSERT INTO playlist VALUES ('LMa', 'Mix', '', 0)",
            "INSERT INTO playlist VALUES ('LOCAL', 'On device', '', 1)",
            "INSERT INTO song VALUES ('abcdefghijk', 'First', 't1', 120, 0)",
            "INSERT INTO song VALUES ('lmnopqrstuv', 'Second', '', 90, 0)",
            "INSERT INTO song VALUES ('localsong00', 'File', '', 90, 1)",
            "INSERT INTO playlist_song_map VALUES ('LMa', 'lmnopqrstuv', 1)",
            "INSERT INTO playlist_song_map VALUES ('LMa', 'abcdefghijk', 0)",
            "INSERT INTO playlist_song_map VALUES ('LMa', 'localsong00', 2)",
            "INSERT INTO playlist_song_map VALUES ('LOCAL', 'localsong00', 0)",
        ];
        if with_artists {
            statements.extend([
                "CREATE TABLE artist (id TEXT, name TEXT, channelId TEXT)",
                "CREATE TABLE song_artist_map (songId TEXT, artistId TEXT, position INTEGER)",
                "INSERT INTO artist VALUES ('a1', 'Band', 'UCband')",
                "INSERT INTO artist VALUES ('a2', 'Guest', NULL)",
                "INSERT INTO song_artist_map VALUES ('abcdefghijk', 'a2', 1)",
                "INSERT INTO song_artist_map VALUES ('abcdefghijk', 'a1', 0)",
            ]);
        }
        test_db::create(&path, &statements).await;
        let bytes = std::fs::read(&path).unwrap();
        dir.zip(
            "metrolist.zip",
            &[("settings.preferences_pb", b"x"), ("song.db", &bytes)],
        )
    }

    #[tokio::test]
    async fn metrolist_gives_music_playlists_with_credits() {
        let dir = TempDir::new();
        let zip = metrolist_zip(&dir, true).await;
        let found = read_metrolist(&zip, 1).await.unwrap();
        assert_eq!(
            found.playlists.len(),
            1,
            "playlists of local files stay behind"
        );
        let mix = &found.playlists[0];
        assert!(mix.is_music);
        assert_eq!(mix.tracks.len(), 2);
        assert_eq!(mix.tracks[0].title, "First");
        assert_eq!(mix.tracks[0].artists, "Band, Guest");
        assert_eq!(mix.tracks[0].channel_id, "UCband");
    }

    #[tokio::test]
    async fn an_older_metrolist_backup_still_imports() {
        let dir = TempDir::new();
        let zip = metrolist_zip(&dir, false).await;
        let found = read_metrolist(&zip, 1).await.unwrap();
        assert_eq!(found.playlists[0].tracks[0].artists, "");
    }
}
