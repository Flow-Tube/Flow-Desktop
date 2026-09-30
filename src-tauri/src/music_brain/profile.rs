//! Display-ready projection of the `MusicBrain` taste state.
//!
//! This is the **single source of taste truth** consumed by two surfaces: the music-home
//! dynamic section planner (which artists to expand, how much to lean into discovery) and
//! the Control Center music profile (top artists, genres, listening rhythm). Computing it
//! once on the backend means the frontend never re-derives taste from raw history.
//!
//! Purely read-only over a borrowed `&MusicBrain` — it touches none of the video engine's
//! learning entry points (only the shared, read-only `TimeBucket` enum), so the leak guard
//! in `eval.rs` stays satisfied.

use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::{Datelike, Local, TimeZone, Timelike, Weekday};
use serde::Serialize;

use crate::flow_neuro::scoring::TimeBucket;

use super::model::MusicBrain;
use super::rank::heavy_rotation;

/// How many of each list to surface. Small, display-oriented caps.
const TOP_ARTISTS: usize = 12;
const TOP_GENRES: usize = 8;
const BUCKET_TOP_GENRES: usize = 4;
/// Probe depth for the On Repeat count (matches what the shelf would show).
const ON_REPEAT_PROBE: usize = 50;

/// Maturity tiers by counted listens (`total_plays`). Drives the home's dynamic planner:
/// cold accounts get a comfort/charts-led home, mature accounts unlock artist-graph
/// discovery. Tuned to roughly "a handful of sessions" → warming, "settled habit" → mature.
const MATURITY_COLD_MAX: u32 = 15; // < 15  => cold_start
const MATURITY_WARMING_MAX: u32 = 80; // 15..=80 => warming, > 80 => mature

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopArtist {
    /// Affinity key: a routable browseId when `id_keyed`, else a normalized name.
    pub key: String,
    /// Display name resolved from `track_meta`; falls back to the key.
    pub name: String,
    pub score: f64,
    pub plays: u32,
    pub liked: bool,
    /// Whether `key` can be opened at `/music/artist/:key` (and seed an artist-graph fetch).
    pub id_keyed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreWeight {
    pub genre: String,
    pub weight: f64,
}

/// One time-of-day cell: how many counted listens fell in this bucket and the genres that
/// led it. `plays` is derived from real play timestamps so it is populated even when no
/// genre tags exist (the common case); `top_genres` is empty until genres are known.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeOfDayBucket {
    /// PascalCase `TimeBucket` variant name (e.g. `"WeekdayMorning"`) — matches the
    /// frontend's existing `TimePatterns` convention exactly.
    pub bucket: String,
    pub plays: u32,
    pub top_genres: Vec<GenreWeight>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTasteProfile {
    pub top_artists: Vec<TopArtist>,
    pub top_genres: Vec<GenreWeight>,
    pub discovery_appetite: f64,
    pub total_plays: u32,
    pub distinct_artists: usize,
    pub tracked_tracks: usize,
    pub on_repeat_count: usize,
    /// `"cold_start" | "warming" | "mature"`.
    pub maturity: String,
    /// Always all 8 buckets, in `TimeBucket::values()` order (zero-play buckets included so
    /// the frontend can render a complete week × time grid).
    pub time_of_day: Vec<TimeOfDayBucket>,
}

/// Whether an artist key is a routable browseId rather than a normalized name. Name keys are
/// force-lowercased in `commands::music_brain::artist_key`, while YouTube Music browseIds
/// (`UC…`) keep their case — so any uppercase char means the key is id-like and can be
/// opened at `/music/artist/:key`. Conservative: a false negative merely skips the
/// artist-graph for that artist; a false positive can't happen for a lowercased name.
fn is_id_keyed(key: &str) -> bool {
    key.starts_with("UC") || key.chars().any(|c| c.is_ascii_uppercase())
}

fn maturity_label(total_plays: u32) -> &'static str {
    if total_plays < MATURITY_COLD_MAX {
        "cold_start"
    } else if total_plays <= MATURITY_WARMING_MAX {
        "warming"
    } else {
        "mature"
    }
}

fn desc(a: f64, b: f64) -> Ordering {
    b.partial_cmp(&a).unwrap_or(Ordering::Equal)
}

/// Sorts a `genre → weight` map descending and takes the top `n`.
fn top_genres(map: &HashMap<String, f64>, n: usize) -> Vec<GenreWeight> {
    let mut genres: Vec<GenreWeight> = map
        .iter()
        .map(|(genre, &weight)| GenreWeight {
            genre: genre.clone(),
            weight,
        })
        .collect();
    genres.sort_by(|a, b| desc(a.weight, b.weight));
    genres.truncate(n);
    genres
}

/// Buckets a millisecond timestamp into a `TimeBucket` using local time, reusing the
/// canonical hour→bucket mapping (`TimeBucket::from_parts`) so the logic isn't duplicated.
pub(super) fn bucket_for(ms: u64) -> Option<TimeBucket> {
    let dt = Local.timestamp_millis_opt(ms as i64).single()?;
    let is_weekend = matches!(dt.weekday(), Weekday::Sat | Weekday::Sun);
    Some(TimeBucket::from_parts(dt.hour(), is_weekend))
}

/// Builds the full taste profile from a borrowed brain. Cheap: a few linear scans over the
/// bounded maps, no clones of the brain itself.
pub fn taste_profile(brain: &MusicBrain, now_ms: u64) -> MusicTasteProfile {
    // artist_key -> display name (first non-empty wins).
    let mut names: HashMap<&str, &str> = HashMap::new();
    for meta in brain.track_meta.values() {
        if meta.artist_key.is_empty() || meta.artist.is_empty() {
            continue;
        }
        names
            .entry(meta.artist_key.as_str())
            .or_insert(meta.artist.as_str());
    }

    // Top artists by affinity score, excluding hard-blocked ("don't recommend") artists.
    let mut ranked: Vec<(&String, f64, u32, bool)> = brain
        .artist_affinity
        .iter()
        .filter(|(key, _)| !brain.is_artist_blocked(key))
        .map(|(key, aff)| (key, aff.score, aff.plays, aff.liked))
        .collect();
    let distinct_artists = ranked.len();
    ranked.sort_by(|a, b| desc(a.1, b.1));
    let top_artists: Vec<TopArtist> = ranked
        .into_iter()
        .take(TOP_ARTISTS)
        .map(|(key, score, plays, liked)| TopArtist {
            key: key.clone(),
            name: names
                .get(key.as_str())
                .copied()
                .unwrap_or(key.as_str())
                .to_string(),
            score,
            plays,
            liked,
            id_keyed: is_id_keyed(key),
        })
        .collect();

    // Listening rhythm: count real play timestamps into time-of-day buckets so the view is
    // populated even without genre tags. Genre histograms (when present) label each bucket.
    let mut bucket_plays: HashMap<TimeBucket, u32> = HashMap::new();
    for stamps in brain.track_plays.values() {
        for &ts in stamps {
            if let Some(bucket) = bucket_for(ts) {
                *bucket_plays.entry(bucket).or_insert(0) += 1;
            }
        }
    }
    let time_of_day: Vec<TimeOfDayBucket> = TimeBucket::values()
        .into_iter()
        .map(|bucket| TimeOfDayBucket {
            bucket: format!("{bucket:?}"),
            plays: bucket_plays.get(&bucket).copied().unwrap_or(0),
            top_genres: brain
                .time_buckets
                .get(&bucket)
                .map(|hist| top_genres(hist, BUCKET_TOP_GENRES))
                .unwrap_or_default(),
        })
        .collect();

    MusicTasteProfile {
        top_artists,
        top_genres: top_genres(&brain.genre_affinity, TOP_GENRES),
        discovery_appetite: brain.discovery_appetite,
        total_plays: brain.total_plays,
        distinct_artists,
        tracked_tracks: brain.track_plays.len(),
        on_repeat_count: heavy_rotation(brain, now_ms, ON_REPEAT_PROBE).len(),
        maturity: maturity_label(brain.total_plays).to_string(),
        time_of_day,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music_brain::learn::{
        MusicSignal, apply_music_signal, block_music_artist, newly_crossed,
    };
    use crate::music_brain::model::Affinity;

    fn listen(brain: &mut MusicBrain, track: &str, key: &str, display: &str, now: u64) {
        let sig = MusicSignal {
            track_id: track.to_string(),
            artist_key: key.to_string(),
            genre: None,
            percent_played: 1.0,
            is_explicit_like: false,
            title: Some(format!("{display} song")),
            artist_display: Some(display.to_string()),
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &newly_crossed(0.0, 1.0), now, None);
    }

    #[test]
    fn cold_start_brain_yields_an_empty_but_well_formed_profile() {
        let p = taste_profile(&MusicBrain::default(), 10_000);
        assert_eq!(p.maturity, "cold_start");
        assert!(p.top_artists.is_empty());
        assert!(p.top_genres.is_empty());
        assert_eq!(p.total_plays, 0);
        assert_eq!(p.distinct_artists, 0);
        // The grid is always all 8 buckets, even when empty.
        assert_eq!(p.time_of_day.len(), 8);
        assert!(p.time_of_day.iter().all(|b| b.plays == 0));
    }

    #[test]
    fn resolves_display_names_and_falls_back_to_the_key() {
        let mut brain = MusicBrain::default();
        listen(&mut brain, "t1", "UCdrake", "Drake", 1_000);
        // An affinity-only artist with no track_meta (e.g. from backfill) keeps its key.
        brain.artist_affinity.insert(
            "nameonly".to_string(),
            Affinity {
                plays: 9,
                score: 0.99,
                last_played: 1,
                liked: false,
            },
        );
        let p = taste_profile(&brain, 2_000);
        let drake = p
            .top_artists
            .iter()
            .find(|a| a.key == "UCdrake")
            .expect("drake present");
        assert_eq!(drake.name, "Drake");
        assert!(drake.id_keyed, "UC-prefixed key is routable");
        let nameonly = p
            .top_artists
            .iter()
            .find(|a| a.key == "nameonly")
            .expect("present");
        assert_eq!(nameonly.name, "nameonly");
        assert!(!nameonly.id_keyed, "lowercase name key is not routable");
    }

    #[test]
    fn excludes_hard_blocked_artists() {
        let mut brain = MusicBrain::default();
        listen(&mut brain, "t1", "UCbanned", "Banned", 1_000);
        listen(&mut brain, "t2", "UCok", "Okay", 2_000);
        block_music_artist(&mut brain, "UCbanned");
        let p = taste_profile(&brain, 3_000);
        assert!(p.top_artists.iter().all(|a| a.key != "UCbanned"));
        assert!(p.top_artists.iter().any(|a| a.key == "UCok"));
    }

    #[test]
    fn maturity_boundaries_are_inclusive_of_warming() {
        let mut brain = MusicBrain::default();
        brain.total_plays = 14;
        assert_eq!(taste_profile(&brain, 0).maturity, "cold_start");
        brain.total_plays = 15;
        assert_eq!(taste_profile(&brain, 0).maturity, "warming");
        brain.total_plays = 80;
        assert_eq!(taste_profile(&brain, 0).maturity, "warming");
        brain.total_plays = 81;
        assert_eq!(taste_profile(&brain, 0).maturity, "mature");
    }
}
