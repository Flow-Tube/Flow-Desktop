//! The listen rules every scrobbling service shares: a track longer than 30 seconds counts once it
//! has played for half its length or four minutes, whichever comes first.

use serde::Deserialize;

use super::models::{LoveEntry, ScrobbleEntry};

const MIN_DURATION_MS: u64 = 30_000;
const MAX_THRESHOLD_MS: u64 = 4 * 60_000;
const TOPIC_SUFFIX: &str = " - Topic";
const UNKNOWN_ALBUM: &str = "Unknown Album";

/// The song as the music player knows it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub title: String,
    #[serde(default)]
    pub artists: Vec<String>,
    #[serde(default)]
    pub album: Option<String>,
    pub duration_ms: u64,
}

/// How long a track must play before it counts; `None` when it is too short to ever count.
pub fn threshold_ms(duration_ms: u64) -> Option<u64> {
    (duration_ms > MIN_DURATION_MS).then(|| (duration_ms / 2).min(MAX_THRESHOLD_MS))
}

pub fn counts(duration_ms: u64, played_ms: u64) -> bool {
    threshold_ms(duration_ms).is_some_and(|threshold| played_ms >= threshold)
}

/// `None` when the track has no artist or title to send.
pub fn entry_for(track: &TrackInfo, started_at_ms: i64) -> Option<ScrobbleEntry> {
    let (artist, title) = artist_and_title(track)?;
    let album = track
        .album
        .as_deref()
        .map(str::trim)
        .filter(|album| !album.eq_ignore_ascii_case(UNKNOWN_ALBUM))
        .unwrap_or_default()
        .to_string();
    Some(ScrobbleEntry {
        artist,
        title,
        album,
        duration_sec: u32::try_from(track.duration_ms / 1000).unwrap_or(u32::MAX),
        timestamp_sec: started_at_ms / 1000,
        from_youtube: true,
    })
}

pub fn love_for(track: &TrackInfo, loved: bool) -> Option<LoveEntry> {
    let (artist, title) = artist_and_title(track)?;
    Some(LoveEntry {
        artist,
        title,
        loved,
    })
}

/// The first credited artist: joining every name makes Last.fm invent a new artist.
fn artist_and_title(track: &TrackInfo) -> Option<(String, String)> {
    let first = track
        .artists
        .first()
        .map(String::as_str)
        .unwrap_or_default();
    let artist = first.strip_suffix(TOPIC_SUFFIX).unwrap_or(first).trim();
    let title = track.title.trim();
    (!artist.is_empty() && !title.is_empty()).then(|| (artist.to_string(), title.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(artists: &[&str], album: Option<&str>) -> TrackInfo {
        TrackInfo {
            title: " Song ".into(),
            artists: artists.iter().map(|a| (*a).to_string()).collect(),
            album: album.map(str::to_string),
            duration_ms: 200_000,
        }
    }

    #[test]
    fn a_listen_counts_at_half_the_track_or_four_minutes() {
        assert!(!counts(200_000, 99_000));
        assert!(counts(200_000, 100_000));
        assert!(counts(20 * 60_000, 4 * 60_000));
        assert!(!counts(30_000, 30_000));
    }

    #[test]
    fn the_threshold_is_half_capped_at_four_minutes_and_absent_for_short_tracks() {
        assert_eq!(threshold_ms(200_000), Some(100_000));
        assert_eq!(threshold_ms(20 * 60_000), Some(4 * 60_000));
        assert_eq!(threshold_ms(30_000), None);
        assert_eq!(threshold_ms(30_001), Some(15_000));
    }

    #[test]
    fn the_entry_takes_the_first_artist_and_drops_the_topic_suffix() {
        let entry = entry_for(&track(&["Artist - Topic"], Some("Album")), 5_000_000).unwrap();
        assert_eq!(entry.artist, "Artist");
        let entry = entry_for(&track(&["Lead", "Guest"], None), 5_000_000).unwrap();
        assert_eq!(entry.artist, "Lead");
        assert_eq!(entry.title, "Song");
        assert_eq!(entry.timestamp_sec, 5_000);
        assert_eq!(entry.duration_sec, 200);
    }

    #[test]
    fn placeholder_albums_are_left_out() {
        let entry = entry_for(&track(&["A"], Some("Unknown Album")), 0).unwrap();
        assert!(entry.album.is_empty());
        let entry = entry_for(&track(&["A"], Some(" Record ")), 0).unwrap();
        assert_eq!(entry.album, "Record");
    }

    #[test]
    fn nothing_is_sent_without_an_artist_or_title() {
        assert!(entry_for(&track(&[" "], None), 0).is_none());
        assert!(entry_for(&track(&[], None), 0).is_none());
        let mut untitled = track(&["A"], None);
        untitled.title = "  ".into();
        assert!(entry_for(&untitled, 0).is_none());
    }

    #[test]
    fn a_love_uses_the_same_artist_as_the_scrobble() {
        assert_eq!(
            love_for(&track(&["Artist - Topic"], None), true),
            Some(LoveEntry {
                artist: "Artist".into(),
                title: "Song".into(),
                loved: true
            })
        );
    }
}
