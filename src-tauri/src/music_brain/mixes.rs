//! Daily Mixes — Spotify-style auto-playlists built locally by clustering the user's
//! favorite artists on the **co-occurrence graph** (artists they actually listen to
//! together), then handing each cluster's representative tracks to the frontend to fill
//! out via YouTube Music's related endpoint. No genre taxonomy, no backend, no models —
//! the structure comes from the user's own listening.

use std::collections::HashSet;

use serde::Serialize;

use super::model::{MusicBrain, pair_key};
use super::rank::base_level_activation;

/// How many top artists are eligible to anchor/join a mix.
const MAX_CANDIDATE_ARTISTS: usize = 25;
/// Max artists pulled into one cluster (anchor + neighbors).
const CLUSTER_MAX_ARTISTS: usize = 5;
/// Minimum co-occurrence weight for a neighbor to join a cluster.
const MIN_COOC_WEIGHT: f64 = 1.0;

/// A mix the frontend can realize: a display label plus seed track ids to expand.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyMixSeed {
    pub label: String,
    pub seed_track_ids: Vec<String>,
}

/// Clusters the user's favorite artists on the co-occurrence graph and returns up to
/// `max_mixes` seed sets. Empty until there is enough cross-session listening to form a
/// co-occurrence graph (so new users simply don't get this shelf).
pub fn daily_mixes(
    brain: &MusicBrain,
    now_ms: u64,
    max_mixes: usize,
    seeds_per_mix: usize,
) -> Vec<DailyMixSeed> {
    if brain.artist_cooc.is_empty() || brain.track_meta.is_empty() {
        return Vec::new();
    }

    // Only artists we hold at least one seed track for can anchor a mix.
    let artists_with_tracks: HashSet<&str> = brain
        .track_meta
        .values()
        .map(|m| m.artist_key.as_str())
        .filter(|k| !k.is_empty())
        .collect();

    let candidates: Vec<String> = brain
        .top_artists(MAX_CANDIDATE_ARTISTS)
        .into_iter()
        .map(|(k, _)| k)
        .filter(|k| artists_with_tracks.contains(k.as_str()))
        // Never seed a Daily Mix from a hard-blocked artist.
        .filter(|k| !brain.is_artist_blocked(k))
        .collect();

    let mut assigned: HashSet<String> = HashSet::new();
    let mut mixes: Vec<DailyMixSeed> = Vec::new();

    for anchor in &candidates {
        if mixes.len() >= max_mixes {
            break;
        }
        if assigned.contains(anchor) {
            continue;
        }
        assigned.insert(anchor.clone());

        // Pull in the anchor's strongest co-occurring (still-unassigned) neighbors.
        let mut neighbors: Vec<(String, f64)> = candidates
            .iter()
            .filter(|c| c.as_str() != anchor.as_str() && !assigned.contains(*c))
            .filter_map(|c| {
                brain
                    .artist_cooc
                    .get(&pair_key(anchor, c))
                    .filter(|w| **w >= MIN_COOC_WEIGHT)
                    .map(|w| (c.clone(), *w))
            })
            .collect();
        neighbors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut cluster = vec![anchor.clone()];
        for (neighbor, _) in neighbors.into_iter().take(CLUSTER_MAX_ARTISTS - 1) {
            assigned.insert(neighbor.clone());
            cluster.push(neighbor);
        }

        if cluster.len() < 2 {
            continue; // a "mix" needs at least two artists
        }

        // One seed track per cluster artist (its most-activated track), labelled by the
        // anchor's display name.
        let mut seeds: Vec<String> = Vec::new();
        let mut label = String::new();
        for artist in &cluster {
            if let Some((track_id, display)) = top_track_for_artist(brain, artist, now_ms) {
                if label.is_empty() && !display.is_empty() {
                    label = display;
                }
                seeds.push(track_id);
                if seeds.len() >= seeds_per_mix {
                    break;
                }
            }
        }

        if seeds.is_empty() {
            continue;
        }
        if label.is_empty() {
            label = "Daily".to_string();
        }
        mixes.push(DailyMixSeed {
            label,
            seed_track_ids: seeds,
        });
    }

    mixes
}

/// The given artist's highest-activation track, returned as `(track_id, display_name)`.
fn top_track_for_artist(
    brain: &MusicBrain,
    artist_key: &str,
    now_ms: u64,
) -> Option<(String, String)> {
    brain
        .track_meta
        .iter()
        .filter(|(_, m)| m.artist_key == artist_key)
        .map(|(id, m)| {
            (
                id.clone(),
                m.artist.clone(),
                base_level_activation(brain, id, now_ms),
            )
        })
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(id, display, _)| (id, display))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music_brain::learn::{MusicSignal, apply_music_signal, newly_crossed};

    fn listen(brain: &mut MusicBrain, track: &str, artist: &str, display: &str, now: u64) {
        let sig = MusicSignal {
            track_id: track.to_string(),
            artist_key: artist.to_string(),
            genre: None,
            is_explicit_like: false,
            title: Some(format!("{display} song")),
            artist_display: Some(display.to_string()),
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &newly_crossed(0.0, 1.0), now, None);
    }

    #[test]
    fn empty_graph_yields_no_mixes() {
        let brain = MusicBrain::default();
        assert!(daily_mixes(&brain, 10_000, 4, 4).is_empty());
    }

    #[test]
    fn clusters_co_occurring_artists_into_a_mix() {
        let mut brain = MusicBrain::default();
        // Two artists the user plays and that co-occur in sessions.
        listen(&mut brain, "t_a", "artistA", "Artist A", 1_000);
        listen(&mut brain, "t_b", "artistB", "Artist B", 2_000);
        brain
            .artist_cooc
            .insert(pair_key("artistA", "artistB"), 4.0);

        let mixes = daily_mixes(&brain, 10_000, 4, 4);
        assert_eq!(mixes.len(), 1);
        let mix = &mixes[0];
        assert!(mix.seed_track_ids.len() >= 2);
        assert!(!mix.label.is_empty());
    }
}
