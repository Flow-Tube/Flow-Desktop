//! Text / `runs` helpers and byline (artist/album/duration) splitting.

use serde_json::Value;

use super::endpoint::{browse_id, page_type};
use crate::models::music::{Album, Artist};

/// Concatenate every `runs[].text`, or fall back to `simpleText`.
#[must_use]
pub fn runs_text(v: &Value) -> Option<String> {
    if let Some(arr) = v["runs"].as_array() {
        let joined: String = arr.iter().filter_map(|r| r["text"].as_str()).collect();
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    v["simpleText"].as_str().map(ToOwned::to_owned)
}

/// First run's text (or `simpleText`).
#[must_use]
pub fn first_run(v: &Value) -> Option<String> {
    v["runs"][0]["text"]
        .as_str()
        .or_else(|| v["simpleText"].as_str())
        .map(ToOwned::to_owned)
}

/// Text of a `musicResponsiveListItemRenderer` flex column (index `col`).
#[must_use]
pub fn flex_text(r: &Value, col: usize) -> Option<String> {
    first_run(&r["flexColumns"][col]["musicResponsiveListItemFlexColumnRenderer"]["text"])
}

/// Parse a `m:ss` / `h:mm:ss` duration string into seconds.
#[must_use]
pub fn parse_duration(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut total = 0u64;
    for part in &parts {
        let n = part.trim().parse::<u64>().ok()?;
        total = total * 60 + n;
    }
    Some(total)
}

/// A run that is a `•`/separator/whitespace and should be skipped.
fn is_separator(text: &str) -> bool {
    let t = text.trim();
    t.is_empty() || t == "•" || t == "·" || t == "&" || t == ","
}

/// Whether a run looks like a bare duration (`3:45`).
fn looks_like_duration(text: &str) -> bool {
    let t = text.trim();
    t.contains(':') && t.chars().all(|c| c.is_ascii_digit() || c == ':')
}

/// Whether a run is a play/view count (`3.4B plays`) — used for the Streams column.
/// The digit prefix + `plays`/`views` suffix avoids catching artists like `50 Cent`.
pub(super) fn looks_like_play_count(text: &str) -> bool {
    let t = text.trim();
    let lower = t.to_ascii_lowercase();
    (lower.ends_with("plays") || lower.ends_with("views"))
        && t.chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// Extract (artists, album, duration) from a song's flex-column byline.
///
/// Runs that link to an `ARTIST` page become artists; a run linking to an
/// `ALBUM` page becomes the album; a bare `m:ss` run becomes the duration.
/// When no linked artist runs exist, the first non-separator text run is used
/// as a plain artist name.
#[must_use]
pub fn parse_song_meta(r: &Value) -> (Vec<Artist>, Option<Album>, Option<u64>) {
    let mut artists: Vec<Artist> = Vec::new();
    let mut album: Option<Album> = None;
    let mut duration: Option<u64> = None;
    let mut fallback_name: Option<String> = None;

    for col in 1..4 {
        let Some(runs) = r["flexColumns"][col]["musicResponsiveListItemFlexColumnRenderer"]["text"]
            ["runs"]
            .as_array()
        else {
            continue;
        };
        for run in runs {
            let Some(text) = run["text"].as_str() else {
                continue;
            };
            if is_separator(text) {
                continue;
            }
            let nav = &run["navigationEndpoint"];
            match page_type(nav) {
                Some(pt) if pt.contains("ARTIST") || pt.contains("USER_CHANNEL") => {
                    artists.push(Artist {
                        name: text.to_string(),
                        id: browse_id(nav),
                    });
                    continue;
                }
                Some(pt) if pt.contains("ALBUM") || pt.contains("AUDIOBOOK") => {
                    album = Some(Album {
                        name: text.to_string(),
                        id: browse_id(nav).unwrap_or_default(),
                    });
                    continue;
                }
                _ => {}
            }
            if duration.is_none() && looks_like_duration(text) {
                duration = parse_duration(text);
                continue;
            }
            if fallback_name.is_none() && !looks_like_duration(text) {
                fallback_name = Some(text.to_string());
            }
        }
    }

    // Fixed-column duration (album/playlist track tables).
    if duration.is_none() {
        if let Some(t) =
            first_run(&r["fixedColumns"][0]["musicResponsiveListItemFixedColumnRenderer"]["text"])
        {
            if looks_like_duration(&t) {
                duration = parse_duration(&t);
            }
        }
    }

    if artists.is_empty() {
        if let Some(name) = fallback_name {
            artists.push(Artist { name, id: None });
        }
    }

    (artists, album, duration)
}

/// Parse artists + year from a two-row/responsive subtitle (albums/playlists).
#[must_use]
pub fn parse_artists_and_year(v: &Value) -> (Vec<Artist>, Option<i32>) {
    let mut artists = Vec::new();
    let mut year = None;
    if let Some(runs) = v["runs"].as_array() {
        for run in runs {
            let Some(text) = run["text"].as_str() else {
                continue;
            };
            if is_separator(text) {
                continue;
            }
            let nav = &run["navigationEndpoint"];
            if let Some(pt) = page_type(nav) {
                if pt.contains("ARTIST") || pt.contains("USER_CHANNEL") {
                    artists.push(Artist {
                        name: text.to_string(),
                        id: browse_id(nav),
                    });
                    continue;
                }
            }
            if let Ok(y) = text.trim().parse::<i32>() {
                if (1900..2100).contains(&y) {
                    year = Some(y);
                }
            }
        }
    }
    (artists, year)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_counts_are_recognized_and_artists_are_not() {
        assert!(looks_like_play_count("3.4B plays"));
        assert!(looks_like_play_count("1,234 views"));
        // A digit-leading band name must not be mistaken for a play count.
        assert!(!looks_like_play_count("12 Stones"));
        assert!(!looks_like_play_count("Coldplay"));
        assert!(!looks_like_play_count("2:47"));
    }
}
