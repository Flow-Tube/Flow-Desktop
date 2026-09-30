//! Read-side ranking of YouTube Music candidates against the local `MusicBrain`.
//!
//! YouTube Music is the recall engine (it carries the cross-user collaborative signal
//! we cannot compute locally); this module is the local ranking stage that turns that
//! generic recall into a personal ordering — the two-stage recall→rank pattern, with
//! the rank stage on-device. Scoring follows the ACT-R triad: base-level activation
//! (recency+frequency), spreading (genre/co-listen proximity), and partial matching
//! (familiarity/affinity), plus a controlled discovery term.

use std::collections::VecDeque;

use crate::flow_neuro::scoring::TimeBucket;

use super::model::{DEFAULT_DISCOVERY_APPETITE, MusicBrain, pair_key};
use super::profile::bucket_for;

/// ACT-R base-level decay exponent (Anderson's standard ~0.5).
const ACT_DECAY: f64 = 0.5;
/// Disliked artists are suppressed (not banned) for this window.
const DISLIKE_COOLDOWN_MS: u64 = 14 * 86_400_000;
/// Max consecutive tracks from the same artist in a ranked list (music diversity ≠
/// video diversity — short artist runs are fine, long ones are not).
const MAX_CONSECUTIVE_ARTIST: usize = 2;

/// The minimal projection of a candidate the ranker needs.
#[derive(Debug, Clone)]
pub struct RankInput {
    pub track_id: String,
    pub artist_key: String,
    pub genre: Option<String>,
}

/// Per-surface weighting. Quick Picks loads familiarity/recency; Discover loads novelty.
/// `cooc` rewards candidates whose artist co-occurs with the user's favorites ("goes
/// together") — a coherence signal especially useful for radio and discovery. `ctx`
/// rewards candidates whose genre matches what the user reaches for at this time of day
/// (lean-back surfaces care most; explicit discovery cares least).
#[derive(Debug, Clone, Copy)]
pub struct SurfaceWeights {
    pub fam: f64,
    pub act: f64,
    pub rot: f64,
    pub prox: f64,
    pub cooc: f64,
    pub ctx: f64,
    pub discovery: f64,
}

pub fn surface_weights(surface: &str) -> SurfaceWeights {
    match surface {
        "quick_picks" | "heavy_rotation" => SurfaceWeights {
            fam: 0.50,
            act: 0.35,
            rot: 0.25,
            prox: 0.10,
            cooc: 0.15,
            ctx: 0.15,
            discovery: 0.05,
        },
        "radio" => SurfaceWeights {
            fam: 0.35,
            act: 0.20,
            rot: 0.20,
            prox: 0.15,
            cooc: 0.25,
            ctx: 0.20,
            discovery: 0.25,
        },
        "similar" | "discover" | "daily_discover" => SurfaceWeights {
            fam: 0.15,
            act: 0.05,
            rot: 0.10,
            prox: 0.20,
            cooc: 0.20,
            ctx: 0.08,
            discovery: 0.60,
        },
        // Balanced default.
        _ => SurfaceWeights {
            fam: 0.35,
            act: 0.20,
            rot: 0.20,
            prox: 0.15,
            cooc: 0.15,
            ctx: 0.12,
            discovery: 0.20,
        },
    }
}

/// Target fraction of the list that should be *novel* (unseen-artist) for a surface.
/// Discovery-leaning surfaces flex with the user's learned appetite; comfort surfaces stay
/// mostly familiar regardless.
fn surface_target_novelty(surface: &str, appetite: f64) -> f64 {
    let base = match surface {
        "quick_picks" | "heavy_rotation" => 0.15,
        "radio" => 0.35,
        "similar" => 0.55,
        "discover" | "daily_discover" => 0.75,
        _ => 0.30,
    };
    let flex = match surface {
        "radio" | "similar" | "discover" | "daily_discover" => {
            (appetite - DEFAULT_DISCOVERY_APPETITE) * 0.5
        }
        _ => 0.0,
    };
    (base + flex).clamp(0.05, 0.95)
}

/// ACT-R base-level activation `ln(Σ_j Δt_j^{-d})` over a track's recent plays.
/// High when a track is played frequently and recently (the "obsession" signal); decays
/// automatically as plays age — no separate decay job.
pub fn base_level_activation(brain: &MusicBrain, track_id: &str, now_ms: u64) -> f64 {
    let Some(timestamps) = brain.track_plays.get(track_id) else {
        return 0.0;
    };
    let sum: f64 = timestamps
        .iter()
        .map(|t| {
            let dt_hours = (now_ms.saturating_sub(*t) as f64 / 3_600_000.0).max(0.05);
            dt_hours.powf(-ACT_DECAY)
        })
        .sum();
    if sum <= 0.0 { 0.0 } else { sum.ln().max(0.0) }
}

/// The user's current "On Repeat" set: tracks ranked by ACT-R activation (most
/// frequently + recently played first). Returns track ids; the caller resolves display
/// metadata from `MusicBrain::track_meta`.
pub fn heavy_rotation(brain: &MusicBrain, now_ms: u64, limit: usize) -> Vec<String> {
    let mut scored: Vec<(String, f64)> = brain
        .track_plays
        .keys()
        // Drop tracks by hard-blocked artists so On Repeat never resurfaces them.
        .filter(|track| {
            brain
                .track_meta
                .get(*track)
                .map_or(true, |m| !brain.is_artist_blocked(&m.artist_key))
        })
        .map(|track| (track.clone(), base_level_activation(brain, track, now_ms)))
        .filter(|(_, activation)| *activation > 0.0)
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().take(limit).map(|(t, _)| t).collect()
}

/// Familiar tracks from artists the user liked but has not played in three weeks.
pub fn rediscover(brain: &MusicBrain, now_ms: u64, limit: usize) -> Vec<String> {
    const STALE_MS: u64 = 21 * 24 * 60 * 60 * 1000;
    let stale_before = now_ms.saturating_sub(STALE_MS);
    let mut candidates: Vec<(&String, f64, String)> = Vec::new();
    for (artist_key, affinity) in &brain.artist_affinity {
        if affinity.plays < 3
            || affinity.score < 0.25
            || affinity.last_played == 0
            || affinity.last_played >= stale_before
            || brain.is_artist_blocked(artist_key)
            || is_in_dislike_cooldown(brain, artist_key, now_ms)
        {
            continue;
        }
        let best = brain
            .track_meta
            .iter()
            .filter(|(_, meta)| meta.artist_key == *artist_key)
            .filter_map(|(track_id, _)| {
                let stamps = brain.track_plays.get(track_id)?;
                Some((
                    track_id,
                    stamps.len(),
                    stamps.iter().max().copied().unwrap_or(0),
                ))
            })
            .max_by_key(|(_, plays, newest)| (*plays, *newest));
        if let Some((track_id, _, _)) = best {
            candidates.push((artist_key, affinity.score, track_id.clone()));
        }
    }
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    candidates
        .into_iter()
        .take(limit)
        .map(|(_, _, id)| id)
        .collect()
}

/// The part of the day `now_ms` falls in, matching the rotation's buckets, for naming the
/// shelf ("Your evening rotation"). Weekday and weekend share a name.
pub fn day_slot(now_ms: u64) -> Option<&'static str> {
    Some(match bucket_for(now_ms)? {
        TimeBucket::WeekdayMorning | TimeBucket::WeekendMorning => "morning",
        TimeBucket::WeekdayAfternoon | TimeBucket::WeekendAfternoon => "afternoon",
        TimeBucket::WeekdayEvening | TimeBucket::WeekendEvening => "evening",
        TimeBucket::WeekdayNight | TimeBucket::WeekendNight => "night",
    })
}

/// Tracks with at least two counted plays in the current local time bucket.
pub fn time_of_day_rotation(brain: &MusicBrain, now_ms: u64, limit: usize) -> Vec<String> {
    let Some(current_bucket) = bucket_for(now_ms) else {
        return Vec::new();
    };
    let mut scored: Vec<(String, usize, f64)> = brain
        .track_plays
        .iter()
        .filter(|(id, _)| {
            brain.track_meta.get(*id).is_none_or(|meta| {
                !brain.is_artist_blocked(&meta.artist_key)
                    && !is_in_dislike_cooldown(brain, &meta.artist_key, now_ms)
            })
        })
        .map(|(id, stamps)| {
            let bucket_plays = stamps
                .iter()
                .filter(|stamp| bucket_for(**stamp) == Some(current_bucket))
                .count();
            (
                id.clone(),
                bucket_plays,
                base_level_activation(brain, id, now_ms),
            )
        })
        .filter(|(_, plays, _)| *plays >= 2)
        .collect();
    scored.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(id, _, _)| id)
        .collect()
}

/// Squash an unbounded non-negative value into `0.0..1.0`.
fn squash(x: f64) -> f64 {
    x / (1.0 + x)
}

/// "Goes together" score: the strongest co-occurrence between this artist and any of the
/// user's top (anchor) artists. Self-pairs are ignored (familiarity already covers those).
fn cooc_score(brain: &MusicBrain, artist: &str, anchors: &[String]) -> f64 {
    if artist.is_empty() || brain.artist_cooc.is_empty() {
        return 0.0;
    }
    let mut best = 0.0;
    for anchor in anchors {
        if anchor == artist {
            continue;
        }
        if let Some(&weight) = brain.artist_cooc.get(&pair_key(artist, anchor)) {
            let s = squash(weight);
            if s > best {
                best = s;
            }
        }
    }
    best
}

/// Below this many counted listens, a time bucket's genre histogram is too thin to
/// trust; its context signal is damped by `total / (total + K)` so a single early play
/// can't masquerade as a time-of-day preference.
const CONTEXT_CONFIDENCE_K: f64 = 8.0;

/// "What you reach for at this time of day": the confidence-damped share of the current
/// time bucket's counted listens that fell in this candidate's genre. Bounded `0.0..1.0`,
/// purely additive — it nudges, never penalizes. Returns 0 with no genre or no history.
fn context_score(brain: &MusicBrain, bucket: &TimeBucket, genre: Option<&str>) -> f64 {
    let Some(genre) = genre else {
        return 0.0;
    };
    let Some(hist) = brain.time_buckets.get(bucket) else {
        return 0.0;
    };
    let total: f64 = hist.values().sum();
    if total <= 0.0 {
        return 0.0;
    }
    let share = hist.get(genre).copied().unwrap_or(0.0) / total;
    let confidence = total / (total + CONTEXT_CONFIDENCE_K);
    share * confidence
}

fn is_in_dislike_cooldown(brain: &MusicBrain, artist: &str, now_ms: u64) -> bool {
    matches!(
        brain.disliked_artists.get(artist),
        Some(ts) if now_ms.saturating_sub(*ts) < DISLIKE_COOLDOWN_MS
    )
}

pub fn score_candidate(
    brain: &MusicBrain,
    input: &RankInput,
    weights: &SurfaceWeights,
    anchors: &[String],
    bucket: &TimeBucket,
    now_ms: u64,
) -> f64 {
    let artist = input.artist_key.as_str();

    let fam = brain
        .artist_affinity
        .get(artist)
        .map(|a| a.score)
        .unwrap_or(0.0);
    let act = squash(base_level_activation(brain, &input.track_id, now_ms));
    let rot = brain
        .recent_rotation
        .get(artist)
        .copied()
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    let prox = input
        .genre
        .as_deref()
        .and_then(|g| brain.genre_affinity.get(g))
        .copied()
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    let cooc = cooc_score(brain, artist, anchors);
    let ctx = context_score(brain, bucket, input.genre.as_deref());
    let novel = if artist.is_empty() || brain.seen_artists.contains(artist) {
        0.0
    } else {
        1.0
    };

    let discovery = weights.discovery * novel * brain.discovery_appetite;
    let base = weights.fam * fam
        + weights.act * act
        + weights.rot * rot
        + weights.prox * prox
        + weights.cooc * cooc
        + weights.ctx * ctx
        + discovery;

    let cooldown = if is_in_dislike_cooldown(brain, artist, now_ms) {
        0.1
    } else {
        1.0
    };

    base * cooldown
}

/// The user's top affinity artists, used as co-occurrence anchors. Computed once per rank.
const COOC_ANCHOR_ARTISTS: usize = 12;

/// Ranks candidates, returning the reordered list of indices into `inputs`.
/// Ties preserve the original (YouTube Music recall) order, so a cold/empty brain is a
/// no-op pass-through. A sequence rule then spreads out long same-artist runs.
pub fn rank(brain: &MusicBrain, inputs: &[RankInput], surface: &str, now_ms: u64) -> Vec<usize> {
    if inputs.len() <= 1 {
        return (0..inputs.len()).collect();
    }
    let weights = surface_weights(surface);
    let bucket = TimeBucket::current();
    let anchors: Vec<String> = brain
        .top_artists(COOC_ANCHOR_ARTISTS)
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    let mut scored: Vec<(usize, f64)> = inputs
        .iter()
        .enumerate()
        .map(|(i, input)| {
            (
                i,
                score_candidate(brain, input, &weights, &anchors, &bucket, now_ms),
            )
        })
        .collect();
    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    // Hard-blocked artists ("don't recommend") are dropped entirely — never just down-ranked.
    let order: Vec<usize> = scored
        .into_iter()
        .map(|(i, _)| i)
        .filter(|&i| !brain.is_artist_blocked(&inputs[i].artist_key))
        .collect();
    let suppressed: Vec<bool> = inputs
        .iter()
        .map(|inp| is_in_dislike_cooldown(brain, &inp.artist_key, now_ms))
        .collect();
    let (primary_order, suppressed_order): (Vec<usize>, Vec<usize>) =
        order.into_iter().partition(|&i| !suppressed[i]);

    // Compose to the surface's familiarity/discovery target (adjacency-gated novelty),
    // then break up long same-artist runs.
    let novel: Vec<bool> = inputs
        .iter()
        .map(|inp| !inp.artist_key.is_empty() && !brain.seen_artists.contains(&inp.artist_key))
        .collect();
    let adjacent: Vec<bool> = inputs
        .iter()
        .map(|inp| is_taste_adjacent(brain, inp, &anchors))
        .collect();
    let target = surface_target_novelty(surface, brain.discovery_appetite);
    let mut composed = compose_to_ratio(primary_order, &novel, &adjacent, target);
    composed.extend(suppressed_order);

    spread_artists(composed, inputs, MAX_CONSECUTIVE_ARTIST)
}

/// A novel artist counts as *discovery* (rather than noise) when it is adjacent to the
/// user's taste — it co-listens with a favorite, or sits in a genre they like.
fn is_taste_adjacent(brain: &MusicBrain, input: &RankInput, anchors: &[String]) -> bool {
    cooc_score(brain, &input.artist_key, anchors) > 0.0
        || input
            .genre
            .as_deref()
            .and_then(|g| brain.genre_affinity.get(g))
            .copied()
            .unwrap_or(0.0)
            > 0.1
}

/// Interleaves familiar and novel items toward `target` novelty. Within the novel bucket,
/// taste-adjacent items are placed first (so discovery is "expansion, not noise"); the
/// smoothed ratio test leads with the majority class for a given target. Item order within
/// each class (i.e. the score order) is preserved.
fn compose_to_ratio(
    order: Vec<usize>,
    novel: &[bool],
    adjacent: &[bool],
    target: f64,
) -> Vec<usize> {
    let n = order.len();
    if n == 0 {
        return order;
    }
    let (mut novel_adj, mut novel_other, mut familiar) = (Vec::new(), Vec::new(), Vec::new());
    for &i in &order {
        if novel[i] {
            if adjacent[i] {
                novel_adj.push(i);
            } else {
                novel_other.push(i);
            }
        } else {
            familiar.push(i);
        }
    }
    let mut novel_q: VecDeque<usize> = novel_adj.into_iter().chain(novel_other).collect();
    let mut fam_q: VecDeque<usize> = familiar.into();

    let mut result = Vec::with_capacity(n);
    let mut novel_count = 0.0f64;
    for _ in 0..n {
        let placed = result.len() as f64;
        let want_novel = if novel_q.is_empty() {
            false
        } else if fam_q.is_empty() {
            true
        } else {
            (novel_count + 0.5) / (placed + 1.0) < target
        };
        let pick = if want_novel {
            novel_count += 1.0;
            novel_q.pop_front()
        } else {
            fam_q.pop_front()
        };
        if let Some(i) = pick {
            result.push(i);
        }
    }
    result
}

/// Greedy reorder: never emit more than `max_consecutive` tracks from one artist in a
/// row when a different-artist candidate is available further down.
fn spread_artists(order: Vec<usize>, inputs: &[RankInput], max_consecutive: usize) -> Vec<usize> {
    let mut remaining: VecDeque<usize> = order.into();
    let mut result: Vec<usize> = Vec::with_capacity(remaining.len());
    let mut last_artist: Option<String> = None;
    let mut run = 0usize;

    while !remaining.is_empty() {
        let pos = if run >= max_consecutive {
            remaining
                .iter()
                .position(|&i| Some(&inputs[i].artist_key) != last_artist.as_ref())
                .unwrap_or(0)
        } else {
            0
        };
        let idx = remaining.remove(pos).expect("pos in bounds");
        let artist = &inputs[idx].artist_key;
        if last_artist.as_deref() == Some(artist.as_str()) {
            run += 1;
        } else {
            run = 1;
            last_artist = Some(artist.clone());
        }
        result.push(idx);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music_brain::learn::{MusicSignal, apply_music_signal, newly_crossed};

    fn input(track: &str, artist: &str) -> RankInput {
        RankInput {
            track_id: track.to_string(),
            artist_key: artist.to_string(),
            genre: None,
        }
    }

    fn listen(brain: &mut MusicBrain, track: &str, artist: &str, now: u64) {
        let sig = MusicSignal {
            track_id: track.to_string(),
            artist_key: artist.to_string(),
            genre: None,
            percent_played: 1.0,
            is_explicit_like: false,
            title: None,
            artist_display: None,
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &newly_crossed(0.0, 1.0), now, None);
    }

    #[test]
    fn heavy_rotation_orders_by_activation() {
        let mut brain = MusicBrain::default();
        let now = 100 * 86_400_000u64;
        // "hot" played 4x recently; "warm" once recently; "cold" long ago.
        for i in 0..4 {
            listen(&mut brain, "hot", "a", now - (i * 3_600_000) - 1_000);
        }
        listen(&mut brain, "warm", "b", now - 2_000);
        listen(&mut brain, "cold", "c", now - 90 * 86_400_000);
        let top = heavy_rotation(&brain, now, 10);
        assert_eq!(top.first().map(String::as_str), Some("hot"));
        assert!(top.contains(&"warm".to_string()));
    }

    #[test]
    fn empty_brain_is_a_stable_passthrough() {
        let brain = MusicBrain::default();
        let inputs = vec![input("t0", "a"), input("t1", "b"), input("t2", "c")];
        assert_eq!(rank(&brain, &inputs, "quick_picks", 10_000), vec![0, 1, 2]);
    }

    #[test]
    fn quick_picks_promotes_a_familiar_artist() {
        let mut brain = MusicBrain::default();
        listen(&mut brain, "fav", "loved", 1_000);
        // Candidate order puts the loved artist last; quick_picks must lift it.
        let inputs = vec![
            input("x", "stranger"),
            input("y", "other"),
            input("fav", "loved"),
        ];
        let order = rank(&brain, &inputs, "quick_picks", 2_000);
        assert_eq!(order.first(), Some(&2));
    }

    #[test]
    fn discover_favors_novelty_over_the_familiar() {
        let mut brain = MusicBrain::default();
        listen(&mut brain, "fav", "loved", 1_000);
        let inputs = vec![input("fav", "loved"), input("new", "unseen")];
        let order = rank(&brain, &inputs, "discover", 2_000);
        assert_eq!(order.first(), Some(&1)); // the unseen artist wins on a discover surface
    }

    #[test]
    fn recent_play_activation_beats_a_stale_one() {
        let mut brain = MusicBrain::default();
        let now = 100 * 86_400_000u64;
        // Same artist, two tracks: one played a lot recently, one long ago.
        for i in 0..4 {
            listen(&mut brain, "hot", "a", now - (i * 3_600_000) - 1_000);
        }
        listen(&mut brain, "cold", "a", now - 60 * 86_400_000);
        let hot = base_level_activation(&brain, "hot", now);
        let cold = base_level_activation(&brain, "cold", now);
        assert!(hot > cold, "hot={hot} cold={cold}");
    }

    #[test]
    fn sequence_rule_breaks_long_same_artist_runs() {
        let brain = MusicBrain::default();
        // All same score (empty brain) → order is input order; spread must interleave.
        let inputs = vec![
            input("t0", "a"),
            input("t1", "a"),
            input("t2", "a"),
            input("t3", "b"),
        ];
        let order = rank(&brain, &inputs, "quick_picks", 1_000);
        // No 3 consecutive "a" once a "b" exists.
        let artists: Vec<&str> = order
            .iter()
            .map(|&i| inputs[i].artist_key.as_str())
            .collect();
        let mut run = 0;
        let mut last = "";
        let mut max_run = 0;
        for a in artists {
            if a == last {
                run += 1;
            } else {
                run = 1;
                last = a;
            }
            max_run = max_run.max(run);
        }
        assert!(max_run <= MAX_CONSECUTIVE_ARTIST);
    }

    #[test]
    fn cooc_boosts_an_artist_that_goes_with_favorites() {
        let mut brain = MusicBrain::default();
        // Make "fav" a top artist, then mark "friend" as co-occurring with it.
        for i in 0..5 {
            listen(&mut brain, &format!("f{i}"), "fav", 1_000 + i);
        }
        brain
            .artist_cooc
            .insert(crate::music_brain::model::pair_key("fav", "friend"), 5.0);
        // Both candidates are novel/unknown; the one that co-occurs with a favorite wins.
        let inputs = vec![input("s1", "stranger"), input("c1", "friend")];
        let order = rank(&brain, &inputs, "discover", 2_000);
        assert_eq!(order.first(), Some(&1));
    }

    #[test]
    fn context_bonus_prefers_the_time_of_day_genre() {
        let mut brain = MusicBrain::default();
        let bucket = TimeBucket::WeekdayMorning;
        {
            // Mornings skew heavily to "lofi" over "metal".
            let hist = brain.time_buckets.entry(bucket).or_default();
            for _ in 0..20 {
                *hist.entry("lofi".to_string()).or_insert(0.0) += 1.0;
            }
            *hist.entry("metal".to_string()).or_insert(0.0) += 1.0;
        }
        let weights = surface_weights("radio");
        let anchors: Vec<String> = Vec::new();
        let lofi = RankInput {
            track_id: "a".into(),
            artist_key: "x".into(),
            genre: Some("lofi".into()),
        };
        let metal = RankInput {
            track_id: "b".into(),
            artist_key: "y".into(),
            genre: Some("metal".into()),
        };
        // Everything else is equal (both artists novel, no affinity/cooc) so ctx decides.
        let lofi_score = score_candidate(&brain, &lofi, &weights, &anchors, &bucket, 10_000);
        let metal_score = score_candidate(&brain, &metal, &weights, &anchors, &bucket, 10_000);
        assert!(
            lofi_score > metal_score,
            "morning lofi should beat morning metal: {lofi_score} vs {metal_score}"
        );

        // A bucket with no history contributes no context signal (no panic, genres tie).
        let empty = TimeBucket::WeekendNight;
        let a = score_candidate(&brain, &lofi, &weights, &anchors, &empty, 10_000);
        let b = score_candidate(&brain, &metal, &weights, &anchors, &empty, 10_000);
        assert_eq!(a, b, "no context history → no bias");
    }

    #[test]
    fn compose_hits_familiarity_targets() {
        // First 6 familiar, last 6 novel; all adjacent.
        let order: Vec<usize> = (0..12).collect();
        let novel: Vec<bool> = (0..12).map(|i| i >= 6).collect();
        let adjacent = vec![true; 12];

        let comfort = compose_to_ratio(order.clone(), &novel, &adjacent, 0.15);
        let novel_up_front = comfort[..6].iter().filter(|&&i| novel[i]).count();
        assert!(novel_up_front <= 2, "comfort surface should lead familiar");

        let discover = compose_to_ratio(order, &novel, &adjacent, 0.80);
        let novel_up_front2 = discover[..6].iter().filter(|&&i| novel[i]).count();
        assert!(novel_up_front2 >= 4, "discover surface should lead novel");
    }

    #[test]
    fn compose_prefers_adjacent_novel_first() {
        // Two novel items: index 0 non-adjacent, index 1 adjacent. Discover should place
        // the adjacent one first.
        let order = vec![0usize, 1usize];
        let novel = vec![true, true];
        let adjacent = vec![false, true];
        let out = compose_to_ratio(order, &novel, &adjacent, 0.9);
        assert_eq!(out.first(), Some(&1));
    }

    #[test]
    fn blocked_artist_is_dropped_from_ranking() {
        let mut brain = MusicBrain::default();
        crate::music_brain::learn::block_music_artist(&mut brain, "banned");
        // Blocked candidate first in recall order; it must be removed entirely, not reordered.
        let inputs = vec![input("t", "banned"), input("u", "ok")];
        let order = rank(&brain, &inputs, "quick_picks", 1_000);
        assert_eq!(order, vec![1]);
    }

    #[test]
    fn disliked_artist_is_suppressed() {
        let mut brain = MusicBrain::default();
        listen(&mut brain, "t", "a", 1_000);
        crate::music_brain::learn::apply_music_dislike(&mut brain, "a", 2_000);
        let inputs = vec![input("t", "a"), input("u", "b")];
        // Even on quick_picks where "a" has affinity, the cooldown sinks it below the unknown "b".
        let order = rank(&brain, &inputs, "quick_picks", 3_000);
        assert_eq!(order.first(), Some(&1));
    }

    fn titled_listen(brain: &mut MusicBrain, track: &str, artist: &str, at: u64) {
        let sig = MusicSignal {
            track_id: track.to_string(),
            artist_key: artist.to_string(),
            genre: None,
            percent_played: 1.0,
            is_explicit_like: false,
            title: Some(track.to_string()),
            artist_display: Some(artist.to_string()),
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &newly_crossed(0.0, 1.0), at, None);
    }

    const DAY: u64 = 86_400_000;

    #[test]
    fn rediscover_surfaces_stale_favourites_only() {
        let mut brain = MusicBrain::default();
        let now = 400 * DAY;
        for offset in 0..3 {
            titled_listen(&mut brain, "old-hit", "old", now - 40 * DAY - offset * DAY);
            titled_listen(&mut brain, "fresh-hit", "fresh", now - DAY - offset * 1_000);
            titled_listen(
                &mut brain,
                "gone-hit",
                "gone",
                now - 40 * DAY - offset * DAY,
            );
        }
        titled_listen(&mut brain, "old-deep", "old", now - 45 * DAY);
        crate::music_brain::learn::block_music_artist(&mut brain, "gone");

        assert_eq!(rediscover(&brain, now, 10), vec!["old-hit".to_string()]);
    }

    #[test]
    fn time_rotation_needs_repeat_plays_in_the_current_bucket() {
        let mut brain = MusicBrain::default();
        let now = 400 * DAY;
        titled_listen(&mut brain, "same-slot", "a", now - 7 * DAY);
        titled_listen(&mut brain, "same-slot", "a", now - 14 * DAY);
        titled_listen(&mut brain, "other-slot", "b", now - 7 * DAY - DAY / 2);
        titled_listen(&mut brain, "other-slot", "b", now - 14 * DAY - DAY / 2);
        titled_listen(&mut brain, "once", "c", now - 7 * DAY);

        assert_eq!(
            time_of_day_rotation(&brain, now, 10),
            vec!["same-slot".to_string()]
        );
        crate::music_brain::learn::block_music_artist(&mut brain, "a");
        assert!(time_of_day_rotation(&brain, now, 10).is_empty());
    }

    #[test]
    fn day_slot_names_every_bucket() {
        use chrono::{Local, TimeZone};
        let at = |hour: u32| {
            let local = Local
                .with_ymd_and_hms(2026, 9, 23, hour, 30, 0)
                .single()
                .unwrap();
            u64::try_from(local.timestamp_millis()).unwrap()
        };
        assert_eq!(day_slot(at(8)), Some("morning"));
        assert_eq!(day_slot(at(13)), Some("afternoon"));
        assert_eq!(day_slot(at(20)), Some("evening"));
        assert_eq!(day_slot(at(2)), Some("night"));
    }
}
