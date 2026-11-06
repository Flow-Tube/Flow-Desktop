//! The dedicated, entity-based music taste model.
//!
//! This is deliberately **separate** from `flow_neuro`'s `UserBrain`. Music is an
//! entity-centric, repeat-dominated problem; modelling it as the video engine's
//! bag-of-title-tokens vector is a category error (see
//! `notes/music/music_recommendation_analysis.md`). The primitives here are
//! artists, tracks, and genres — never free-text title tokens.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::flow_neuro::scoring::TimeBucket;

pub const MUSIC_SCHEMA_VERSION: i32 = 1;

/// Resolves a stable artist key: the artist id when present, else a normalized name.
#[must_use]
pub fn artist_key(artist_id: Option<&str>, artist_name: &str) -> String {
    match artist_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None => artist_name.trim().to_lowercase(),
    }
}

// --- Bounded-growth caps (mobile-friendly; one small resident JSON blob) ---
pub const ARTIST_AFFINITY_MAX: usize = 600;
pub const ARTIST_AFFINITY_KEEP: usize = 500;
pub const TRACK_PLAYS_MAX: usize = 400;
pub const TRACK_PLAYS_KEEP: usize = 350;
/// Most recent play timestamps retained per track (ACT-R base-level history).
pub const TRACK_PLAYS_RING: usize = 8;
pub const RECENT_ROTATION_MAX: usize = 400;
pub const RECENT_ROTATION_KEEP: usize = 300;
pub const ARTIST_COOC_MAX: usize = 2000;
pub const ARTIST_COOC_KEEP: usize = 1500;
pub const GENRE_AFFINITY_MAX: usize = 200;
pub const SEEN_ARTISTS_MAX: usize = 3000;
pub const SEEN_ARTISTS_KEEP: usize = 2500;
pub const DISLIKED_MAX: usize = 200;
/// Hard-blocked artists ("don't recommend") — a permanent denylist, distinct from the
/// reversible `disliked_artists` cooldown. Generously capped; users rarely block this many.
pub const BLOCKED_ARTISTS_MAX: usize = 1000;

pub const DEFAULT_DISCOVERY_APPETITE: f64 = 0.3;

/// Minimal display metadata for a tracked track, so the "On Repeat" shelf can be
/// rendered entirely locally (no extra network calls). Stored only for tracks we keep
/// play-history for, so it stays bounded alongside `track_plays`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct TrackMeta {
    pub title: String,
    pub artist: String,
    /// The artist affinity key (id or normalized name) — lets Daily Mixes map a cluster
    /// of artists back to seed tracks.
    pub artist_key: String,
    pub thumbnail: String,
}

/// Long-term affinity for a single entity (artist).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Affinity {
    /// Number of counted listens (a "real listen" crossing the count milestone).
    pub plays: u32,
    /// EMA of completion-weighted listens in `0.0..=1.0`.
    pub score: f64,
    pub last_played: u64,
    pub liked: bool,
    /// The artist's name, for an artist known from a pick rather than from a played track.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub display: String,
}

/// The whole music taste state, persisted as one JSON blob under the settings key
/// `user_music_brain`. Every map is capped and pruned to keep the payload small.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MusicBrain {
    /// PRIMARY signal: artist → affinity. Keyed by artist id when available, else a
    /// normalized artist name.
    pub artist_affinity: HashMap<String, Affinity>,
    /// Coarse, derived genre affinity (populated when a genre tag is available).
    pub genre_affinity: HashMap<String, f64>,
    /// ACT-R base-level history: track → recent play timestamps (ms), newest last.
    pub track_plays: HashMap<String, Vec<u64>>,
    /// Display metadata for tracked tracks (kept in lock-step with `track_plays`).
    pub track_meta: HashMap<String, TrackMeta>,
    /// Medium-term "current rotation" overlay (fast decay). Artist key → weight.
    pub recent_rotation: HashMap<String, f64>,
    /// Local single-user item-item CF: "artistA|artistB" (sorted) → co-listen weight.
    pub artist_cooc: HashMap<String, f64>,
    /// Lightweight context: time bucket → genre histogram.
    pub time_buckets: HashMap<TimeBucket, HashMap<String, f64>>,
    /// Artists the user has been exposed to (for novelty/familiarity scoring).
    pub seen_artists: HashSet<String>,
    /// Cooldown timestamps (NOT permanent bans) for disliked artists.
    pub disliked_artists: HashMap<String, u64>,
    /// Hard-blocked artists ("don't recommend this artist") — a permanent denylist. These
    /// are never recommended in any surface and never appear in On Repeat / Daily Mixes.
    pub blocked_artists: HashSet<String>,
    /// Learned per-user exploration appetite in `0.05..=0.95`.
    pub discovery_appetite: f64,
    pub total_plays: u32,
    /// Day-stamp of the last lazy rotation decay pass (ms).
    pub last_rotation_decay: u64,
    pub schema_version: i32,
}

impl Default for MusicBrain {
    fn default() -> Self {
        Self {
            artist_affinity: HashMap::new(),
            genre_affinity: HashMap::new(),
            track_plays: HashMap::new(),
            track_meta: HashMap::new(),
            recent_rotation: HashMap::new(),
            artist_cooc: HashMap::new(),
            time_buckets: HashMap::new(),
            seen_artists: HashSet::new(),
            disliked_artists: HashMap::new(),
            blocked_artists: HashSet::new(),
            discovery_appetite: DEFAULT_DISCOVERY_APPETITE,
            total_plays: 0,
            last_rotation_decay: 0,
            schema_version: MUSIC_SCHEMA_VERSION,
        }
    }
}

/// Sorted, stable key for an unordered artist pair (item-item co-occurrence).
pub fn pair_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

impl MusicBrain {
    /// Whether an artist is on the permanent "don't recommend" denylist.
    pub fn is_artist_blocked(&self, artist_key: &str) -> bool {
        !artist_key.is_empty() && self.blocked_artists.contains(artist_key)
    }

    /// Top artists by affinity score (read side for ranking/shelves; descending).
    pub fn top_artists(&self, n: usize) -> Vec<(String, f64)> {
        let mut entries: Vec<(String, f64)> = self
            .artist_affinity
            .iter()
            .map(|(id, a)| (id.clone(), a.score))
            .collect();
        entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        entries.into_iter().take(n).collect()
    }
}
