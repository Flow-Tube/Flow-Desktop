//! The all-in-one Google Takeout import. Takes every archive of one export, since Google splits a
//! large export and can put My Activity in a different part. Files are recognised by where they
//! sit and what they hold, because Takeout translates their names. Only the few entries that matter
//! are ever decompressed, so an archive that also holds hundreds of gigabytes of video stays cheap.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use super::takeout_activity::{Activity, read_activity_json, read_history_html};
use super::takeout_csv::{
    CsvBudget, CsvContent, LibrarySong, PlaylistInfo, read_csv, resolve_names, stable_hash,
};
use super::{
    Channel, Found, ImportError, MAX_ACTIVITY_BYTES, MAX_CHANNELS, MAX_PLAYLISTS, MAX_TRACKS,
    TakenPlaylist, Track, open_zip, read_file_limited, starts_with_zip_magic,
};

const ENGLISH_WATCH_HISTORY: &str = "history/watch-history.html";
const MAX_ENTRY_NAME: usize = 4_096;
const MAX_LEAF_NAME: usize = 512;
const MAX_ARCHIVES: usize = 100;
/// The share of a playlist's videos that must be known songs for it to count as music.
const MUSIC_SHARE: f64 = 0.6;
pub const MUSIC_LIBRARY_KEY: &str = "yt_takeout_music_library";

fn segments(name: &str) -> Option<Vec<&str>> {
    if name.len() > MAX_ENTRY_NAME || name.contains('\\') {
        return None;
    }
    let parts: Vec<&str> = name.split('/').collect();
    let product = *parts.get(1)?;
    let is_youtube = product.eq_ignore_ascii_case("YouTube")
        || (product.len() > 8
            && product[..8.min(product.len())].eq_ignore_ascii_case("YouTube ")
            && product.to_lowercase().ends_with("youtube music"));
    let valid = parts.len() >= 3
        && parts[0].eq_ignore_ascii_case("Takeout")
        && is_youtube
        && parts
            .iter()
            .all(|p| !p.is_empty() && *p != "." && *p != "..")
        && parts.last().is_some_and(|leaf| leaf.len() <= MAX_LEAF_NAME);
    valid.then_some(parts)
}

fn has_extension(leaf: &str, extension: &str) -> bool {
    leaf.rsplit_once('.')
        .is_some_and(|(_, ext)| ext.eq_ignore_ascii_case(extension))
}

fn is_csv_entry(name: &str) -> bool {
    segments(name).is_some_and(|parts| has_extension(parts[parts.len() - 1], "csv"))
}

/// One folder inside the YouTube product, where Takeout puts the history files in every language.
fn is_history_entry(name: &str, extension: &str) -> bool {
    segments(name).is_some_and(|parts| parts.len() == 4 && has_extension(parts[3], extension))
}

/// The YouTube activity file of a "My Activity" export, e.g. `Takeout/My Activity/YouTube/MyActivity.json`.
#[must_use]
pub fn is_my_activity_entry(name: &str) -> bool {
    let parts: Vec<&str> = name.split('/').collect();
    parts.len() >= 3
        && name.len() <= MAX_ENTRY_NAME
        && parts
            .iter()
            .all(|p| !p.is_empty() && *p != "." && *p != "..")
        && parts[parts.len() - 2].eq_ignore_ascii_case("YouTube")
        && has_extension(parts[parts.len() - 1], "json")
}

fn parent_of(name: &str) -> &str {
    name.rsplit_once('/').map_or("", |(parent, _)| parent)
}

#[derive(Default)]
struct Pieces {
    channels: Vec<Channel>,
    playlists_by_dir: BTreeMap<String, Vec<PlaylistInfo>>,
    playlist_videos: BTreeMap<String, Vec<String>>,
    library_songs: Vec<LibrarySong>,
    activity_likes: Option<Vec<super::TakenLike>>,
    watches: Vec<super::Watch>,
    music_ids: HashSet<String>,
}

fn read_archive(
    path: &Path,
    pieces: &mut Pieces,
    budget: &mut CsvBudget,
    now: u64,
) -> Result<(), ImportError> {
    let mut archive = open_zip(path)?;
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let english_history = name.to_ascii_lowercase().ends_with(ENGLISH_WATCH_HISTORY);
        let bounded = entry.take(MAX_ACTIVITY_BYTES);
        if english_history || is_history_entry(&name, "html") {
            // Each file is stamped below the last, so two history files never share a time.
            let start = now.saturating_sub(pieces.watches.len() as u64);
            pieces
                .watches
                .extend(read_history_html(bounded, start, !english_history)?);
        } else if is_history_entry(&name, "json") {
            if let Some(activity) = read_activity_json(bounded, true) {
                pieces.watches.extend(activity.watches);
            }
        } else if is_my_activity_entry(&name) {
            // It repeats the watch history, which the YouTube folder already gave.
            if let Some(Activity { likes, .. }) = read_activity_json(bounded, false) {
                pieces.activity_likes.get_or_insert(likes);
            }
        } else if is_csv_entry(&name) {
            budget.start_entry()?;
            match read_csv(bounded, budget)? {
                CsvContent::Subscriptions(rows) => pieces.channels.extend(rows),
                CsvContent::PlaylistVideos(ids) => {
                    pieces.playlist_videos.insert(name, ids);
                }
                CsvContent::PlaylistMetadata(rows) => pieces
                    .playlists_by_dir
                    .entry(parent_of(&name).to_string())
                    .or_default()
                    .extend(rows),
                CsvContent::MusicLibrarySongs(rows) => pieces.library_songs.extend(rows),
                CsvContent::Unsupported => {}
            }
        }
        if pieces.playlist_videos.len() > MAX_PLAYLISTS {
            return Err(ImportError::TooLarge);
        }
    }
    Ok(())
}

fn is_music_playlist(ids: &[String], known_music: &HashSet<String>) -> bool {
    let unique: HashSet<&String> = ids.iter().collect();
    !unique.is_empty()
        && unique
            .iter()
            .filter(|id| known_music.contains(**id))
            .count() as f64
            >= unique.len() as f64 * MUSIC_SHARE
}

fn build_playlists(pieces: &Pieces, now: u64) -> Vec<TakenPlaylist> {
    let mut by_dir: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for file in pieces.playlist_videos.keys() {
        by_dir
            .entry(parent_of(file))
            .or_default()
            .push(file.clone());
    }
    let mut built = Vec::new();
    let mut total_tracks = 0;
    for (dir, files) in by_dir {
        let infos = pieces.playlists_by_dir.get(dir);
        let titles: Vec<String> = infos
            .into_iter()
            .flatten()
            .map(|info| info.title.clone())
            .collect();
        let names: HashMap<String, String> = resolve_names(&files, &titles);
        let mut unclaimed: Vec<&PlaylistInfo> = infos.into_iter().flatten().collect();
        for file in &files {
            let Some(ids) = pieces.playlist_videos.get(file) else {
                continue;
            };
            if ids.is_empty() || total_tracks >= MAX_TRACKS {
                continue;
            }
            let name = names.get(file).cloned().unwrap_or_default();
            let info = unclaimed
                .iter()
                .position(|info| info.title == name)
                .map(|at| unclaimed.remove(at));
            let is_watch_later = name.eq_ignore_ascii_case("watch later");
            let key = if let Some(info) = info {
                format!("yt_takeout_{}", info.id)
            } else {
                let leaf = file.rsplit('/').next().unwrap_or(file);
                format!("yt_takeout_{:016x}", stable_hash(leaf))
            };
            let mut seen = HashSet::new();
            let tracks: Vec<Track> = ids
                .iter()
                .filter(|id| seen.insert(id.as_str()))
                .map(|id| Track {
                    video_id: id.clone(),
                    ..Track::default()
                })
                .collect();
            total_tracks += tracks.len();
            built.push(TakenPlaylist {
                key,
                name,
                is_music: !is_watch_later && is_music_playlist(ids, &pieces.music_ids),
                is_watch_later,
                created_at: info.and_then(|info| info.created_at).unwrap_or(now),
                tracks,
            });
        }
    }
    built
}

/// Every archive of one export, read in full before anything is saved.
pub fn read_archives(
    paths: &[PathBuf],
    library_name: &str,
    now: u64,
) -> Result<Found, ImportError> {
    if paths.len() > MAX_ARCHIVES {
        return Err(ImportError::TooLarge);
    }
    let mut pieces = Pieces::default();
    let mut budget = CsvBudget::default();
    for path in paths {
        read_archive(path, &mut pieces, &mut budget, now)?;
    }
    let likes = pieces.activity_likes.take().unwrap_or_default();

    let mut seen = HashSet::new();
    let library: Vec<Track> = std::mem::take(&mut pieces.library_songs)
        .into_iter()
        .filter(|song| seen.insert(song.video_id.clone()))
        .map(|song| Track {
            video_id: song.video_id,
            title: song.title,
            artists: song.artists,
            ..Track::default()
        })
        .collect();
    pieces
        .music_ids
        .extend(library.iter().map(|song| song.video_id.clone()));
    pieces.music_ids.extend(
        likes
            .iter()
            .filter(|like| like.is_music)
            .map(|like| like.video_id.clone()),
    );
    let music_watches: Vec<String> = pieces
        .watches
        .iter()
        .filter(|watch| watch.is_music)
        .map(|watch| watch.video_id.clone())
        .collect();
    pieces.music_ids.extend(music_watches);

    let mut playlists = build_playlists(&pieces, now);
    let library_song_count = library.len();
    if !library.is_empty() {
        playlists.push(TakenPlaylist {
            key: MUSIC_LIBRARY_KEY.into(),
            name: library_name.to_string(),
            is_music: true,
            is_watch_later: false,
            created_at: now,
            tracks: library,
        });
    }
    let mut seen_channels = HashSet::new();
    let channels = std::mem::take(&mut pieces.channels)
        .into_iter()
        .filter(|channel| seen_channels.insert(channel.id.clone()))
        .take(MAX_CHANNELS)
        .collect();
    let found = Found {
        channels,
        watches: std::mem::take(&mut pieces.watches),
        playlists,
        likes,
        library_song_count,
    };
    if found.channels.is_empty()
        && found.watches.is_empty()
        && found.playlists.is_empty()
        && found.likes.is_empty()
    {
        return Err(ImportError::NoContent);
    }
    Ok(found)
}

/// Likes from a My Activity JSON file, or the zip that holds it.
pub fn read_likes_file(path: &Path) -> Result<Found, ImportError> {
    let activity = if starts_with_zip_magic(path)? {
        let mut archive = open_zip(path)?;
        let name = archive
            .file_names()
            .find(|name| is_my_activity_entry(name))
            .map(str::to_string)
            .ok_or(ImportError::NoLikes)?;
        let entry = archive.by_name(&name)?;
        read_activity_json(entry.take(MAX_ACTIVITY_BYTES), false)
    } else {
        let bytes = read_file_limited(path, MAX_ACTIVITY_BYTES)?;
        read_activity_json(bytes.as_slice(), false)
    };
    let activity = activity.ok_or(ImportError::InvalidFormat)?;
    if activity.likes.is_empty() {
        return Err(ImportError::NoLikes);
    }
    Ok(Found {
        likes: activity.likes,
        ..Found::default()
    })
}

#[cfg(test)]
mod tests {
    use super::super::test_support::TempDir;
    use super::*;

    const CHANNEL: &str = "UCaaaaaaaaaaaaaaaaaaaaaa";

    fn subs_csv() -> Vec<u8> {
        format!("Channel Id,Channel Url,Channel Title\n{CHANNEL},https://www.youtube.com/channel/{CHANNEL},Chan\n").into_bytes()
    }

    #[test]
    fn entries_are_recognised_in_any_language() {
        assert!(is_csv_entry(
            "Takeout/YouTube and YouTube Music/subscriptions/abos.csv"
        ));
        assert!(is_csv_entry("Takeout/YouTube/playlists/x.csv"));
        assert!(is_csv_entry(
            "Takeout/YouTube und YouTube Music/playlists/x.csv"
        ));
        assert!(!is_csv_entry("Takeout/Drive/x.csv"));
        assert!(!is_csv_entry("Takeout/YouTube/../../evil.csv"));
        assert!(is_history_entry(
            "Takeout/YouTube/verlauf/wiedergabe.html",
            "html"
        ));
        assert!(!is_history_entry("Takeout/YouTube/a/b/c.html", "html"));
        assert!(is_my_activity_entry(
            "Takeout/My Activity/YouTube/MyActivity.json"
        ));
        assert!(is_my_activity_entry(
            "Takeout/Meine Aktivitäten/YouTube/x.json"
        ));
        assert!(!is_my_activity_entry("YouTube/x.json"));
    }

    #[test]
    fn a_split_export_reads_as_one() {
        let dir = TempDir::new();
        let part_one = dir.zip(
            "takeout-001.zip",
            &[
                (
                    "Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv",
                    &subs_csv(),
                ),
                (
                    "Takeout/YouTube and YouTube Music/playlists/Watch later-videos.csv",
                    b"Video ID,Stamp\nabcdefghijk,\n",
                ),
                (
                    "Takeout/YouTube and YouTube Music/playlists/Songs-videos.csv",
                    b"Video ID,Stamp\nlmnopqrstuv,\n",
                ),
                (
                    "Takeout/YouTube and YouTube Music/videos/big-video.mp4",
                    b"not read",
                ),
            ],
        );
        let part_two = dir.zip(
            "takeout-002.zip",
            &[
                (
                    "Takeout/YouTube and YouTube Music/history/watch-history.json",
                    br#"[{"title":"Watched A","titleUrl":"https://www.youtube.com/watch?v=zzzzzzzzzzz","time":"2024-01-01T00:00:00Z"}]"#,
                ),
                (
                    "Takeout/My Activity/YouTube/MyActivity.json",
                    br#"[{"title":"Liked Tune","titleUrl":"https://music.youtube.com/watch?v=lmnopqrstuv","header":"YouTube Music","time":"2024-01-01T00:00:00Z"}]"#,
                ),
            ],
        );
        let found = read_archives(&[part_one, part_two], "Library", 1_000).unwrap();
        assert_eq!(found.channels[0].id, CHANNEL);
        assert_eq!(found.watches.len(), 1);
        assert_eq!(found.likes[0].title, "Tune");

        let later = found.playlists.iter().find(|p| p.is_watch_later).unwrap();
        assert_eq!(later.tracks[0].video_id, "abcdefghijk");
        assert!(!later.is_music);
        let songs = found.playlists.iter().find(|p| p.name == "Songs").unwrap();
        assert!(songs.is_music, "every video in it is a known song");
    }

    #[test]
    fn the_music_library_becomes_one_playlist() {
        let dir = TempDir::new();
        let archive = dir.zip(
            "takeout.zip",
            &[(
                "Takeout/YouTube and YouTube Music/music/songs.csv",
                b"Video ID,Song,Album,Artist\nabcdefghijk,Tune,Album,Band\nabcdefghijk,Tune,Album,Band\n",
            )],
        );
        let found = read_archives(&[archive], "YouTube Music library", 1).unwrap();
        assert_eq!(found.library_song_count, 1);
        let library = &found.playlists[0];
        assert_eq!(library.key, MUSIC_LIBRARY_KEY);
        assert_eq!(library.name, "YouTube Music library");
        assert!(library.is_music);
        assert_eq!(library.tracks[0].artists, "Band");
    }

    #[test]
    fn a_zip_with_nothing_of_youtube_says_so() {
        let dir = TempDir::new();
        let archive = dir.zip("takeout.zip", &[("Takeout/Drive/file.csv", b"a,b\n1,2\n")]);
        assert!(matches!(
            read_archives(&[archive], "L", 1),
            Err(ImportError::NoContent)
        ));
    }

    #[test]
    fn too_many_archives_are_refused() {
        let paths = vec![PathBuf::from("x"); MAX_ARCHIVES + 1];
        assert!(matches!(
            read_archives(&paths, "L", 1),
            Err(ImportError::TooLarge)
        ));
    }

    #[test]
    fn likes_read_from_a_file_or_its_zip() {
        let dir = TempDir::new();
        let json = br#"[{"title":"Liked A","titleUrl":"https://www.youtube.com/watch?v=abcdefghijk","time":"2024-01-01T00:00:00Z"}]"#;
        let file = dir.file("MyActivity.json", json);
        assert_eq!(read_likes_file(&file).unwrap().likes.len(), 1);
        let zipped = dir.zip(
            "a.zip",
            &[("Takeout/My Activity/YouTube/MyActivity.json", json)],
        );
        assert_eq!(read_likes_file(&zipped).unwrap().likes.len(), 1);
        let other_language = dir.file(
            "de.json",
            br#"[{"title":"Mag A","titleUrl":"https://www.youtube.com/watch?v=abcdefghijk","time":"2024-01-01T00:00:00Z"}]"#,
        );
        assert!(matches!(
            read_likes_file(&other_language),
            Err(ImportError::NoLikes)
        ));
    }
}
