//! Google Takeout's CSV files, told apart by their shape because Takeout translates their names.
//! A port of Android's `TakeoutCsvReader` and `YouTubeTakeoutCsvParser`, with its limits.

use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::Path;

use chrono::DateTime;

use super::{Channel, Found, ImportError, TakenPlaylist, Track, clean, is_channel_id, is_video_id};

const MAX_CSV_BYTES: usize = 16 * 1024 * 1024;
const MAX_IGNORED_CSV_BYTES: usize = 64 * 1024 * 1024;
const MAX_ARCHIVE_CSV_BYTES: u64 = 256 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 64 * 1024;
const MAX_RECORDS: usize = 100_000;
const MAX_FIELDS: usize = 64;
const MAX_ARCHIVE_CSV_ENTRIES: usize = 10_000;
const MAX_IMPORTED_ROWS: u64 = 500_000;
const MAX_IMPORTED_BYTES: u64 = 16 * 1024 * 1024;
const LIBRARY_COLUMNS: std::ops::RangeInclusive<usize> = 3..=8;

/// What every CSV of one import may add up to.
#[derive(Default)]
pub struct CsvBudget {
    bytes_read: u64,
    entries: usize,
    rows: u64,
    accepted_bytes: u64,
}

impl CsvBudget {
    pub fn start_entry(&mut self) -> Result<(), ImportError> {
        self.entries += 1;
        if self.entries > MAX_ARCHIVE_CSV_ENTRIES {
            return Err(ImportError::TooLarge);
        }
        Ok(())
    }

    fn accept(&mut self, rows: u64, bytes: u64) -> Result<(), ImportError> {
        if self.rows + rows > MAX_IMPORTED_ROWS || self.accepted_bytes + bytes > MAX_IMPORTED_BYTES
        {
            return Err(ImportError::TooLarge);
        }
        self.rows += rows;
        self.accepted_bytes += bytes;
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct PlaylistInfo {
    pub id: String,
    pub title: String,
    pub created_at: Option<u64>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct LibrarySong {
    pub video_id: String,
    pub title: String,
    pub artists: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CsvContent {
    Subscriptions(Vec<Channel>),
    PlaylistVideos(Vec<String>),
    PlaylistMetadata(Vec<PlaylistInfo>),
    MusicLibrarySongs(Vec<LibrarySong>),
    Unsupported,
}

enum Record {
    Fields(Vec<String>),
    End,
    Malformed,
}

struct CsvReader<'a, R: Read> {
    bytes: std::io::Bytes<BufReader<R>>,
    budget: &'a mut CsvBudget,
    read: usize,
    records: usize,
    pending: Option<u8>,
    pending_rows: u64,
    pending_bytes: u64,
}

impl<'a, R: Read> CsvReader<'a, R> {
    fn new(reader: R, budget: &'a mut CsvBudget) -> Self {
        Self {
            bytes: BufReader::new(reader).bytes(),
            budget,
            read: 0,
            records: 0,
            pending: None,
            pending_rows: 0,
            pending_bytes: 0,
        }
    }

    fn next_byte(&mut self, limit: usize) -> Result<Option<u8>, ImportError> {
        if let Some(byte) = self.pending.take() {
            return Ok(Some(byte));
        }
        let Some(byte) = self.bytes.next().transpose()? else {
            return Ok(None);
        };
        self.budget.bytes_read += 1;
        self.read += 1;
        if self.budget.bytes_read > MAX_ARCHIVE_CSV_BYTES || self.read > limit {
            return Err(ImportError::TooLarge);
        }
        Ok(Some(byte))
    }

    fn line_feed_after(&mut self, byte: u8) -> Result<(), ImportError> {
        if byte == b'\r' {
            match self.next_byte(MAX_CSV_BYTES)? {
                Some(b'\n') | None => {}
                Some(other) => self.pending = Some(other),
            }
        }
        Ok(())
    }

    fn record(&mut self) -> Result<Record, ImportError> {
        if self.records >= MAX_RECORDS {
            return match self.next_byte(MAX_CSV_BYTES)? {
                None => Ok(Record::End),
                Some(_) => Err(ImportError::TooLarge),
            };
        }
        let mut fields: Vec<String> = Vec::new();
        let mut field: Vec<u8> = Vec::new();
        let mut record_bytes = 0;
        let mut in_quotes = false;
        let mut closed_quote = false;
        let mut has_input = false;

        let finish = |fields: &mut Vec<String>, field: &mut Vec<u8>| {
            fields.push(String::from_utf8_lossy(field).into_owned());
            field.clear();
        };
        loop {
            let Some(byte) = self.next_byte(MAX_CSV_BYTES)? else {
                if !has_input {
                    return Ok(Record::End);
                }
                if in_quotes {
                    return Ok(Record::Malformed);
                }
                finish(&mut fields, &mut field);
                self.records += 1;
                return Ok(Record::Fields(fields));
            };
            has_input = true;
            record_bytes += 1;
            if record_bytes > MAX_RECORD_BYTES {
                return Err(ImportError::TooLarge);
            }
            if in_quotes {
                if byte == b'"' {
                    match self.next_byte(MAX_CSV_BYTES)? {
                        Some(b'"') => field.push(b'"'),
                        next => {
                            self.pending = next;
                            in_quotes = false;
                            closed_quote = true;
                        }
                    }
                } else {
                    field.push(byte);
                }
                continue;
            }
            match byte {
                b',' => {
                    if fields.len() >= MAX_FIELDS - 1 {
                        return Err(ImportError::TooLarge);
                    }
                    finish(&mut fields, &mut field);
                    closed_quote = false;
                }
                b'\r' | b'\n' => {
                    self.line_feed_after(byte)?;
                    finish(&mut fields, &mut field);
                    self.records += 1;
                    return Ok(Record::Fields(fields));
                }
                b' ' | b'\t' if closed_quote => {}
                _ if closed_quote => return Ok(Record::Malformed),
                b'"' if field.is_empty() => in_quotes = true,
                b'"' => return Ok(Record::Malformed),
                _ => field.push(byte),
            }
        }
    }

    fn next_non_blank(&mut self) -> Result<Record, ImportError> {
        loop {
            match self.record()? {
                Record::Fields(fields) if fields.iter().all(|f| f.trim().is_empty()) => {}
                other => return Ok(other),
            }
        }
    }

    /// Reads to the end, so the budget still counts what an ignored file holds.
    fn drain_as_unsupported(&mut self, limit: usize) -> Result<CsvContent, ImportError> {
        while self.next_byte(limit)?.is_some() {}
        Ok(CsvContent::Unsupported)
    }

    fn rows<T>(
        &mut self,
        first: T,
        weight: impl Fn(&T) -> usize,
        parse: impl Fn(&[String]) -> Option<T>,
        build: impl FnOnce(Vec<T>) -> CsvContent,
    ) -> Result<CsvContent, ImportError> {
        self.stage(weight(&first));
        let mut rows = vec![first];
        loop {
            match self.next_non_blank()? {
                Record::End => {
                    self.budget.accept(self.pending_rows, self.pending_bytes)?;
                    return Ok(build(rows));
                }
                Record::Malformed => return self.drain_as_unsupported(MAX_CSV_BYTES),
                Record::Fields(fields) => {
                    if let Some(row) = parse(&fields) {
                        self.stage(weight(&row));
                        rows.push(row);
                    }
                }
            }
        }
    }

    fn stage(&mut self, bytes: usize) {
        self.pending_rows += 1;
        self.pending_bytes += bytes as u64;
    }
}

fn strip_bom(field: &str) -> &str {
    field.trim().trim_start_matches('\u{FEFF}')
}

fn name_of(field: &str) -> Option<String> {
    let trimmed = field.trim();
    let valid = !trimmed.is_empty()
        && trimmed.chars().count() <= super::MAX_TEXT
        && !trimmed
            .chars()
            .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}');
    valid.then(|| trimmed.to_string())
}

fn is_date(field: &str) -> bool {
    DateTime::parse_from_rfc3339(field.trim()).is_ok()
}

fn to_subscription(fields: &[String]) -> Option<Channel> {
    if fields.len() < 3 {
        return None;
    }
    let id = strip_bom(&fields[0]);
    if !is_channel_id(id) {
        return None;
    }
    let url = fields[1].trim();
    let path = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let path = path
        .strip_prefix("www.youtube.com")
        .or_else(|| path.strip_prefix("youtube.com"))?;
    let expected = format!("/channel/{id}");
    if path != expected && path != format!("{expected}/") {
        return None;
    }
    Some(Channel {
        id: id.to_string(),
        name: name_of(&fields[2])?,
        avatar: String::new(),
    })
}

fn to_playlist_video(fields: &[String]) -> Option<String> {
    if fields.len() != 2 {
        return None;
    }
    let id = strip_bom(&fields[0]);
    let stamp = fields[1].trim();
    (is_video_id(id) && (stamp.is_empty() || is_date(stamp))).then(|| id.to_string())
}

fn is_playlist_id(id: &str) -> bool {
    id.len() >= 18
        && id.starts_with("PL")
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The create timestamp is found by its shape, not its column: the first field that reads as a date.
fn to_playlist_info(fields: &[String]) -> Option<PlaylistInfo> {
    if fields.len() < 11 {
        return None;
    }
    let id = strip_bom(&fields[0]);
    if !is_playlist_id(id) {
        return None;
    }
    let created_at = fields[1..].iter().find_map(|field| {
        let date = DateTime::parse_from_rfc3339(field.trim()).ok()?;
        u64::try_from(date.timestamp_millis()).ok()
    });
    Some(PlaylistInfo {
        id: id.to_string(),
        title: name_of(&fields[10])?,
        created_at,
    })
}

/// A YouTube Music library row. The account's own uploads also start with a video id, but carry
/// dates and channel ids, which no library row does.
fn to_library_song(fields: &[String]) -> Option<LibrarySong> {
    if !LIBRARY_COLUMNS.contains(&fields.len()) {
        return None;
    }
    let id = strip_bom(&fields[0]);
    if !is_video_id(id) {
        return None;
    }
    let rest = &fields[1..];
    if rest
        .iter()
        .any(|field| is_channel_id(field.trim()) || is_date(field))
    {
        return None;
    }
    let artists: Vec<String> = rest.iter().skip(2).filter_map(|f| name_of(f)).collect();
    Some(LibrarySong {
        video_id: id.to_string(),
        title: name_of(&rest[0])?,
        artists: artists.join(", "),
    })
}

/// Reads one CSV and says what it holds.
pub fn read_csv<R: Read>(reader: R, budget: &mut CsvBudget) -> Result<CsvContent, ImportError> {
    let mut csv = CsvReader::new(reader, budget);
    let Record::Fields(header) = csv.next_non_blank()? else {
        return csv.drain_as_unsupported(MAX_IGNORED_CSV_BYTES);
    };
    let Record::Fields(first) = csv.next_non_blank()? else {
        return csv.drain_as_unsupported(MAX_IGNORED_CSV_BYTES);
    };

    if header.len() >= 3
        && to_subscription(&header).is_none()
        && let Some(row) = to_subscription(&first)
    {
        return csv.rows(
            row,
            |row| row.id.len() + row.name.len(),
            to_subscription,
            CsvContent::Subscriptions,
        );
    }
    if header.len() == 2
        && to_playlist_video(&header).is_none()
        && let Some(row) = to_playlist_video(&first)
    {
        return csv.rows(
            row,
            String::len,
            to_playlist_video,
            CsvContent::PlaylistVideos,
        );
    }
    if header.len() >= 11
        && to_playlist_info(&header).is_none()
        && let Some(row) = to_playlist_info(&first)
    {
        return csv.rows(
            row,
            |row| row.id.len() + row.title.len(),
            to_playlist_info,
            CsvContent::PlaylistMetadata,
        );
    }
    if LIBRARY_COLUMNS.contains(&header.len())
        && to_library_song(&header).is_none()
        && let Some(row) = to_library_song(&first)
    {
        return csv.rows(
            row,
            |row| row.video_id.len() + row.title.len() + row.artists.len(),
            to_library_song,
            CsvContent::MusicLibrarySongs,
        );
    }
    csv.drain_as_unsupported(MAX_IGNORED_CSV_BYTES)
}

/// A subscriptions file on its own.
pub fn read_subscriptions_file(path: &Path) -> Result<Found, ImportError> {
    let file = std::fs::File::open(path)?;
    match read_csv(file, &mut CsvBudget::default())? {
        CsvContent::Subscriptions(channels) => Ok(Found {
            channels,
            ..Found::default()
        }),
        _ => Err(ImportError::InvalidFormat),
    }
}

fn leaf_stem(path: &str) -> &str {
    let leaf = path.rsplit(['/', '\\']).next().unwrap_or(path);
    leaf.rsplit_once('.').map_or(leaf, |(stem, _)| stem)
}

fn without_videos_suffix(stem: &str) -> &str {
    stem.len()
        .checked_sub(7)
        .filter(|&at| stem.is_char_boundary(at) && stem[at..].eq_ignore_ascii_case("-videos"))
        .map_or(stem, |at| &stem[..at])
}

/// A short id from a name: FNV-1a, which stays the same between runs, unlike the std hasher.
pub(crate) fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// One playlist CSV picked on its own, named after its file.
pub fn read_playlist_file(
    path: &Path,
    is_music: bool,
    force_watch_later: bool,
    now_ms: u64,
) -> Result<Found, ImportError> {
    let file_name = path.to_string_lossy();
    let name = clean(without_videos_suffix(leaf_stem(&file_name)));
    let file = std::fs::File::open(path)?;
    let CsvContent::PlaylistVideos(ids) = read_csv(file, &mut CsvBudget::default())? else {
        return Err(ImportError::NoVideos);
    };
    let is_watch_later = force_watch_later || name.eq_ignore_ascii_case("watch later");
    let mut seen = std::collections::HashSet::new();
    let tracks = ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .map(|video_id| Track {
            video_id,
            ..Track::default()
        })
        .collect();
    Ok(Found {
        playlists: vec![TakenPlaylist {
            key: format!("yt_import_{:016x}", stable_hash(&name.to_lowercase())),
            name: if name.is_empty() {
                "Imported playlist".into()
            } else {
                name
            },
            is_music: is_music && !is_watch_later,
            is_watch_later,
            created_at: now_ms,
            tracks,
        }],
        ..Found::default()
    })
}

fn normalized(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || !c.is_ascii())
        .collect()
}

/// Matches a folder's playlist files to the titles `playlists.csv` gives, Android's
/// `resolveYouTubeTakeoutPlaylistNames`: the file names are translated and may be cut short.
#[must_use]
pub fn resolve_names(files: &[String], titles: &[String]) -> HashMap<String, String> {
    let mut remaining_files: Vec<String> = files.to_vec();
    let mut remaining_titles: Vec<String> = titles
        .iter()
        .filter(|title| !title.trim().is_empty())
        .cloned()
        .collect();
    let file_keys: HashMap<&String, String> = files
        .iter()
        .map(|file| (file, normalized(without_videos_suffix(leaf_stem(file)))))
        .collect();

    let mut groups: HashMap<String, Vec<String>> = HashMap::new();
    for title in &remaining_titles {
        groups
            .entry(normalized(title))
            .or_default()
            .push(title.clone());
    }
    let mut candidates: Vec<(usize, String, Vec<String>)> = groups
        .into_iter()
        .filter(|(key, _)| !key.is_empty())
        .filter_map(|(key, group)| {
            let matches = file_keys
                .values()
                .filter(|file| file.contains(&key))
                .count();
            (matches > 0).then_some((matches, key, group))
        })
        .collect();
    candidates.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.len().cmp(&a.1.len())));

    let mut resolved = HashMap::new();
    for (_, key, group) in candidates {
        let matching: Vec<String> = remaining_files
            .iter()
            .filter(|file| file_keys.get(*file).is_some_and(|name| name.contains(&key)))
            .cloned()
            .collect();
        let one_title = group.iter().all(|title| *title == group[0]);
        if one_title && matching.len() == group.len() {
            for (file, title) in matching.iter().zip(&group) {
                resolved.insert(file.clone(), title.clone());
                remaining_titles.retain(|other| other != title);
            }
            remaining_files.retain(|file| !matching.contains(file));
        }
    }
    if let ([file], [title]) = (remaining_files.as_slice(), remaining_titles.as_slice()) {
        resolved.insert(file.clone(), title.clone());
        remaining_files.clear();
    }
    for file in remaining_files {
        let fallback = clean(
            without_videos_suffix(leaf_stem(&file))
                .trim_matches(|c: char| c.is_whitespace() || c == '-' || c == '_'),
        );
        let name = if fallback.is_empty() {
            "Imported playlist".to_string()
        } else {
            fallback
        };
        resolved.insert(file, name);
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::super::test_support::TempDir;
    use super::*;

    const CHANNEL: &str = "UCaaaaaaaaaaaaaaaaaaaaaa";

    fn csv(text: &str) -> CsvContent {
        read_csv(text.as_bytes(), &mut CsvBudget::default()).unwrap()
    }

    #[test]
    fn subscriptions_are_told_by_their_shape_in_any_language() {
        let text = format!(
            "\u{FEFF}Kanal-ID,Kanal-URL,Kanalname\r\n{CHANNEL},https://www.youtube.com/channel/{CHANNEL},\"Comma, Inc\"\r\n"
        );
        let CsvContent::Subscriptions(rows) = csv(&text) else {
            panic!("reads as subscriptions");
        };
        assert_eq!(rows[0].id, CHANNEL);
        assert_eq!(rows[0].name, "Comma, Inc");
    }

    #[test]
    fn a_channel_link_elsewhere_is_not_a_subscription() {
        let text = format!("a,b,c\n{CHANNEL},https://evil.example/channel/{CHANNEL},Name\n");
        assert_eq!(csv(&text), CsvContent::Unsupported);
    }

    #[test]
    fn playlist_files_give_their_video_ids() {
        let text = "Video ID,Playlist Video Creation Timestamp\nwxmYUyLS47w,2026-02-25T19:35:57+00:00\nabcdefghijk,\nnot a video,2026-02-25T19:35:57+00:00\n";
        assert_eq!(
            csv(text),
            CsvContent::PlaylistVideos(vec!["wxmYUyLS47w".into(), "abcdefghijk".into()])
        );
    }

    #[test]
    fn playlist_metadata_finds_its_title_and_date() {
        let mut row = vec!["x".to_string(); 11];
        row[0] = "PLabcdefghijklmnopqrst".into();
        row[3] = "2020-01-02T03:04:05+00:00".into();
        row[10] = "My list".into();
        let text = format!("{}\n{}\n", ["h"; 11].join(","), row.join(","));
        let CsvContent::PlaylistMetadata(rows) = csv(&text) else {
            panic!("reads as metadata");
        };
        assert_eq!(rows[0].title, "My list");
        assert_eq!(rows[0].created_at, Some(1_577_934_245_000));
    }

    #[test]
    fn library_songs_are_kept_apart_from_uploads() {
        let songs = "Video ID,Song,Album,Artist 1,Artist 2\nabcdefghijk,Title,Album,One,Two\n";
        let CsvContent::MusicLibrarySongs(rows) = csv(songs) else {
            panic!("reads as library songs");
        };
        assert_eq!(rows[0].artists, "One, Two");

        let uploads = "Video ID,Title,Created\nabcdefghijk,Mine,2020-01-02T03:04:05+00:00\n";
        assert_eq!(csv(uploads), CsvContent::Unsupported);
    }

    #[test]
    fn an_unclosed_quote_never_counts_as_data() {
        let text = "Video ID,Timestamp\nabcdefghijk,\n\"zzzzzzzzzzz,oops\n";
        assert_eq!(csv(text), CsvContent::Unsupported);
    }

    #[test]
    fn a_hostile_csv_stops_at_its_limits() {
        let long_record = "a".repeat(MAX_RECORD_BYTES + 1);
        assert!(matches!(
            read_csv(long_record.as_bytes(), &mut CsvBudget::default()),
            Err(ImportError::TooLarge)
        ));
        let wide = vec!["a"; MAX_FIELDS + 1].join(",");
        assert!(matches!(
            read_csv(wide.as_bytes(), &mut CsvBudget::default()),
            Err(ImportError::TooLarge)
        ));
        let mut budget = CsvBudget {
            bytes_read: MAX_ARCHIVE_CSV_BYTES,
            ..CsvBudget::default()
        };
        assert!(matches!(
            read_csv(&b"a,b\n"[..], &mut budget),
            Err(ImportError::TooLarge)
        ));
        let mut budget = CsvBudget {
            entries: MAX_ARCHIVE_CSV_ENTRIES,
            ..CsvBudget::default()
        };
        assert!(matches!(budget.start_entry(), Err(ImportError::TooLarge)));
    }

    #[test]
    fn a_picked_playlist_is_named_after_its_file() {
        let dir = TempDir::new();
        let path = dir.file(
            "Road trip-videos.csv",
            b"Video ID,Stamp\nabcdefghijk,\nabcdefghijk,\nlmnopqrstuv,\n",
        );
        let found = read_playlist_file(&path, true, false, 5).unwrap();
        let playlist = &found.playlists[0];
        assert_eq!(playlist.name, "Road trip");
        assert!(playlist.is_music);
        assert_eq!(playlist.tracks.len(), 2, "a repeat is one entry");
        let again = read_playlist_file(&path, true, false, 9).unwrap();
        assert_eq!(
            again.playlists[0].key, playlist.key,
            "same list on a re-import"
        );
    }

    #[test]
    fn watch_later_is_recognised_or_forced() {
        let dir = TempDir::new();
        let named = dir.file("Watch later-videos.csv", b"Video ID,Stamp\nabcdefghijk,\n");
        assert!(
            read_playlist_file(&named, false, false, 0)
                .unwrap()
                .playlists[0]
                .is_watch_later
        );
        let other = dir.file("Spater ansehen.csv", b"Video ID,Stamp\nabcdefghijk,\n");
        assert!(
            !read_playlist_file(&other, false, false, 0)
                .unwrap()
                .playlists[0]
                .is_watch_later
        );
        let forced = read_playlist_file(&other, true, true, 0).unwrap();
        assert!(forced.playlists[0].is_watch_later);
        assert!(!forced.playlists[0].is_music);
    }

    #[test]
    fn a_file_with_no_videos_says_so() {
        let dir = TempDir::new();
        let path = dir.file("empty.csv", b"Video ID,Stamp\n");
        assert!(matches!(
            read_playlist_file(&path, false, false, 0),
            Err(ImportError::NoVideos)
        ));
    }

    #[test]
    fn playlist_names_come_from_metadata_where_they_match() {
        let files = vec![
            "Takeout/YouTube/playlists/Road trip-videos.csv".to_string(),
            "Takeout/YouTube/playlists/Watch later-videos.csv".to_string(),
            "Takeout/YouTube/playlists/Unlisted one.csv".to_string(),
        ];
        let titles = vec!["Road Trip!".to_string(), "Watch later".to_string()];
        let names = resolve_names(&files, &titles);
        assert_eq!(names[&files[0]], "Road Trip!");
        assert_eq!(names[&files[1]], "Watch later");
        assert_eq!(names[&files[2]], "Unlisted one");
    }
}
