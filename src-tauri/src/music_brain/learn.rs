//! Pure learning logic for the `MusicBrain` (no I/O; the store handles persistence
//! and the ephemeral per-listen dedup state).
//!
//! Key difference from the video engine: a song is logged from the player every few
//! seconds, but we count **one listen per play** (not one per tick) using watch
//! milestones — and crucially, relistening is a POSITIVE signal here, not a
//! suppression event.

use crate::flow_neuro::scoring::TimeBucket;

use super::model::*;

/// Progress milestones within a single listen. Crossing one (for the first time in
/// this listen) drives an incremental update; the count milestone marks a "real listen".
pub const MILESTONES: [f32; 3] = [0.15, 0.50, 0.90];
/// Crossing this marks a counted play (ACT-R timestamp, play count, rotation, co-occ).
pub const COUNT_MILESTONE: f32 = 0.50;

/// Co-listens within this gap count toward session co-occurrence.
pub const SESSION_GAP_MS: u64 = 30 * 60 * 1000;

const ALPHA_LONG: f64 = 0.15; // long-term affinity EMA
const ALPHA_MED: f64 = 0.35; // medium-term rotation EMA
const ROTATION_DECAY_PER_DAY: f64 = 0.85;
const DAY_MS: u64 = 86_400_000;

// Discovery appetite is self-balancing: it drifts toward neutral each counted listen and
// is nudged up when the user engages with a NEW artist. (Skips never reach the brain, so
// there is no down-signal to detect — instead it simply regresses when novel engagement
// stops.)
const DISCOVERY_NEUTRAL: f64 = 0.30;
const APPETITE_REGRESS: f64 = 0.02;
const APPETITE_NOVEL_BONUS: f64 = 0.03;
const APPETITE_DISLIKE_NUDGE: f64 = 0.03;

/// One playback signal from the music player. `artist_key` is pre-resolved by the
/// caller (artist id when present, else a normalized name). The display fields
/// (`title`, `artist_display`, `thumbnail`) are optional and only used to render the
/// local "On Repeat" shelf.
#[derive(Debug, Clone)]
pub struct MusicSignal {
    pub track_id: String,
    pub artist_key: String,
    pub genre: Option<String>,
    pub is_explicit_like: bool,
    pub title: Option<String>,
    pub artist_display: Option<String>,
    pub thumbnail: Option<String>,
}

/// Milestones in `MILESTONES` newly crossed when progress moves `prev -> next`.
pub fn newly_crossed(prev: f32, next: f32) -> Vec<f32> {
    MILESTONES
        .iter()
        .copied()
        .filter(|m| prev < *m && next >= *m)
        .collect()
}

/// Reinforcement target for a crossed milestone (deeper listen ⇒ stronger signal).
fn milestone_weight(m: f32) -> f64 {
    if m >= 0.90 {
        1.0
    } else if m >= 0.50 {
        0.7
    } else {
        0.35
    }
}

fn ema(current: f64, target: f64, alpha: f64) -> f64 {
    (current + (target - current) * alpha).clamp(0.0, 1.0)
}

/// Applies one signal to the brain. `crossed` are the milestones newly reached this
/// tick (may be empty when only an explicit like fired). `co_artist` is the previous
/// session artist for co-occurrence (already gap/identity filtered by the store).
/// Returns `true` when a play was counted (so the store can update its session state).
pub fn apply_music_signal(
    brain: &mut MusicBrain,
    sig: &MusicSignal,
    crossed: &[f32],
    now_ms: u64,
    co_artist: Option<&str>,
) -> bool {
    decay_rotation_if_due(brain, now_ms);

    let artist = sig.artist_key.as_str();
    if artist.is_empty() {
        return false;
    }

    // Novelty must be read BEFORE the milestone loop marks the artist "seen".
    let was_novel = !brain.seen_artists.contains(artist);

    // Incremental affinity per crossed milestone; first sample marks the artist "seen".
    for &m in crossed {
        if m >= MILESTONES[0] {
            insert_seen(brain, artist);
        }
        let entry = brain.artist_affinity.entry(artist.to_string()).or_default();
        entry.score = ema(entry.score, milestone_weight(m), ALPHA_LONG);
        entry.last_played = now_ms;
    }

    let is_counted = crossed.iter().any(|m| *m >= COUNT_MILESTONE) || sig.is_explicit_like;

    if is_counted {
        // --- ACT-R base-level history: one timestamp per listen ---
        push_play(brain, &sig.track_id, now_ms);
        store_track_meta(brain, sig);

        let entry = brain.artist_affinity.entry(artist.to_string()).or_default();
        entry.plays += 1;
        entry.last_played = now_ms;
        if sig.is_explicit_like {
            entry.liked = true;
            entry.score = entry.score.max(0.8);
        }

        // Medium-term rotation overlay (fast decay).
        let r = brain
            .recent_rotation
            .entry(artist.to_string())
            .or_insert(0.0);
        *r = ema(*r, 1.0, ALPHA_MED);

        insert_seen(brain, artist);
        brain.total_plays += 1;
        update_discovery_appetite(brain, was_novel);

        // Genre + context histogram.
        if let Some(genre) = sig.genre.as_deref() {
            let g = brain.genre_affinity.entry(genre.to_string()).or_insert(0.0);
            *g = ema(*g, 1.0, ALPHA_LONG);
            let bucket = brain.time_buckets.entry(TimeBucket::current()).or_default();
            *bucket.entry(genre.to_string()).or_insert(0.0) += 1.0;
        }

        // Local item-item co-occurrence (single-user session CF).
        if let Some(other) = co_artist {
            if other != artist {
                *brain
                    .artist_cooc
                    .entry(pair_key(artist, other))
                    .or_insert(0.0) += 1.0;
            }
        }

        // A counted listen lifts any dislike cooldown on this artist.
        brain.disliked_artists.remove(artist);
    }

    prune(brain);
    is_counted
}

fn insert_seen(brain: &mut MusicBrain, artist: &str) {
    if !brain.seen_artists.contains(artist) {
        brain.seen_artists.insert(artist.to_string());
    }
}

fn push_play(brain: &mut MusicBrain, track_id: &str, now_ms: u64) {
    let ring = brain.track_plays.entry(track_id.to_string()).or_default();
    ring.push(now_ms);
    if ring.len() > TRACK_PLAYS_RING {
        let overflow = ring.len() - TRACK_PLAYS_RING;
        ring.drain(0..overflow);
    }
}

/// Stores minimal display metadata for the "On Repeat" shelf. Requires a non-empty
/// title; the artist falls back to the affinity key, the thumbnail to empty.
fn store_track_meta(brain: &mut MusicBrain, sig: &MusicSignal) {
    let Some(title) = sig.title.as_deref().filter(|t| !t.is_empty()) else {
        return;
    };
    let artist = sig
        .artist_display
        .clone()
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| sig.artist_key.clone());
    brain.track_meta.insert(
        sig.track_id.clone(),
        TrackMeta {
            title: title.to_string(),
            artist,
            artist_key: sig.artist_key.clone(),
            thumbnail: sig.thumbnail.clone().unwrap_or_default(),
        },
    );
}

fn decay_rotation_if_due(brain: &mut MusicBrain, now_ms: u64) {
    if brain.last_rotation_decay == 0 {
        brain.last_rotation_decay = now_ms;
        return;
    }
    let elapsed_days = now_ms.saturating_sub(brain.last_rotation_decay) / DAY_MS;
    if elapsed_days == 0 {
        return;
    }
    let factor = ROTATION_DECAY_PER_DAY.powi(elapsed_days as i32);
    for v in brain.recent_rotation.values_mut() {
        *v *= factor;
    }
    brain.recent_rotation.retain(|_, v| *v > 0.02);
    brain.last_rotation_decay = now_ms;
}

/// Records an explicit dislike ("not interested"): a reversible cooldown plus a downward
/// nudge on the artist's affinity. **Escalating** — a repeat dislike while the artist is
/// still in cooldown promotes them to a permanent hard block (mirrors the video engine's
/// suppress-then-block behavior).
pub fn apply_music_dislike(brain: &mut MusicBrain, artist_key: &str, now_ms: u64) {
    if artist_key.is_empty() {
        return;
    }
    if brain.blocked_artists.contains(artist_key) {
        return; // already the strongest signal
    }
    if brain.disliked_artists.contains_key(artist_key) {
        block_music_artist(brain, artist_key);
        return;
    }
    brain
        .disliked_artists
        .insert(artist_key.to_string(), now_ms);
    if let Some(entry) = brain.artist_affinity.get_mut(artist_key) {
        entry.score = (entry.score * 0.5).clamp(0.0, 1.0);
        entry.liked = false;
    }
    brain.recent_rotation.remove(artist_key);
    // Pushing back nudges the user toward slightly more conservative recommendations.
    brain.discovery_appetite =
        (brain.discovery_appetite - APPETITE_DISLIKE_NUDGE).clamp(0.05, 0.95);
    prune(brain);
}

/// Hard-blocks an artist ("don't recommend this artist"): a permanent denylist entry plus
/// removal of any positive signal so the brain stops surfacing them everywhere. Reversible
/// via [`unblock_music_artist`].
pub fn block_music_artist(brain: &mut MusicBrain, artist_key: &str) {
    if artist_key.is_empty() {
        return;
    }
    brain.blocked_artists.insert(artist_key.to_string());
    // Blocking supersedes the soft cooldown and clears positive momentum.
    brain.disliked_artists.remove(artist_key);
    brain.recent_rotation.remove(artist_key);
    if let Some(entry) = brain.artist_affinity.get_mut(artist_key) {
        entry.liked = false;
        entry.score = 0.0;
    }
    prune(brain);
}

/// Lifts a hard block, letting the artist be recommended again. Past affinity/history is
/// preserved (blocking never deleted it), so the artist warms back up naturally.
pub fn unblock_music_artist(brain: &mut MusicBrain, artist_key: &str) {
    brain.blocked_artists.remove(artist_key);
}

/// Self-balancing discovery appetite. Each counted listen drifts it toward neutral; a
/// counted listen of a NEW artist nudges it up. Sustained novel engagement keeps it high;
/// when the user settles into familiar listening it regresses on its own.
pub fn update_discovery_appetite(brain: &mut MusicBrain, was_novel: bool) {
    brain.discovery_appetite += (DISCOVERY_NEUTRAL - brain.discovery_appetite) * APPETITE_REGRESS;
    if was_novel {
        brain.discovery_appetite += APPETITE_NOVEL_BONUS;
    }
    brain.discovery_appetite = brain.discovery_appetite.clamp(0.05, 0.95);
}

/// Enforces all growth caps, keeping the highest-value entries.
pub fn prune(brain: &mut MusicBrain) {
    if brain.artist_affinity.len() > ARTIST_AFFINITY_MAX {
        keep_top_by(&mut brain.artist_affinity, ARTIST_AFFINITY_KEEP, |a| {
            a.score
        });
    }
    if brain.track_plays.len() > TRACK_PLAYS_MAX {
        // Keep tracks with the most recent last-play.
        keep_top_by(&mut brain.track_plays, TRACK_PLAYS_KEEP, |ts| {
            ts.last().copied().unwrap_or(0) as f64
        });
    }
    // Display metadata mirrors the play-history set exactly.
    if brain.track_meta.len() > brain.track_plays.len() {
        let live: std::collections::HashSet<String> = brain.track_plays.keys().cloned().collect();
        brain.track_meta.retain(|k, _| live.contains(k));
    }
    if brain.recent_rotation.len() > RECENT_ROTATION_MAX {
        keep_top_by(&mut brain.recent_rotation, RECENT_ROTATION_KEEP, |v| *v);
    }
    if brain.artist_cooc.len() > ARTIST_COOC_MAX {
        keep_top_by(&mut brain.artist_cooc, ARTIST_COOC_KEEP, |v| *v);
    }
    if brain.genre_affinity.len() > GENRE_AFFINITY_MAX {
        keep_top_by(&mut brain.genre_affinity, GENRE_AFFINITY_MAX, |v| *v);
    }
    if brain.seen_artists.len() > SEEN_ARTISTS_MAX {
        // Cheap bound: drop arbitrary excess (membership, not ranking, matters here).
        let excess = brain.seen_artists.len() - SEEN_ARTISTS_KEEP;
        let drop: Vec<String> = brain.seen_artists.iter().take(excess).cloned().collect();
        for k in drop {
            brain.seen_artists.remove(&k);
        }
    }
    if brain.disliked_artists.len() > DISLIKED_MAX {
        keep_top_by(&mut brain.disliked_artists, DISLIKED_MAX, |ts| *ts as f64);
    }
    if brain.blocked_artists.len() > BLOCKED_ARTISTS_MAX {
        // Membership matters, not ranking — drop arbitrary excess cheaply.
        let excess = brain.blocked_artists.len() - BLOCKED_ARTISTS_MAX;
        let drop: Vec<String> = brain.blocked_artists.iter().take(excess).cloned().collect();
        for k in drop {
            brain.blocked_artists.remove(&k);
        }
    }
}

/// Retains the `keep` highest-scoring entries of a map by a scoring projection.
fn keep_top_by<V, F>(map: &mut std::collections::HashMap<String, V>, keep: usize, score: F)
where
    F: Fn(&V) -> f64,
{
    if map.len() <= keep {
        return;
    }
    let mut entries: Vec<(String, f64)> = map.iter().map(|(k, v)| (k.clone(), score(v))).collect();
    entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let survivors: std::collections::HashSet<String> =
        entries.into_iter().take(keep).map(|(k, _)| k).collect();
    map.retain(|k, _| survivors.contains(k));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(track: &str, artist: &str) -> MusicSignal {
        MusicSignal {
            track_id: track.to_string(),
            artist_key: artist.to_string(),
            genre: None,
            is_explicit_like: false,
            title: None,
            artist_display: None,
            thumbnail: None,
        }
    }

    #[test]
    fn counted_listen_stores_track_meta_for_the_shelf() {
        let mut b = MusicBrain::default();
        let mut s = sig("t1", "artistA");
        s.title = Some("My Song".into());
        s.artist_display = Some("Artist A".into());
        s.thumbnail = Some("http://thumb".into());
        apply_music_signal(&mut b, &s, &newly_crossed(0.0, 1.0), 1_000, None);
        let meta = b.track_meta.get("t1").expect("meta stored");
        assert_eq!(meta.title, "My Song");
        assert_eq!(meta.artist, "Artist A");
        // A sample-only tick (no count) must not create meta.
        let mut b2 = MusicBrain::default();
        let mut s2 = sig("t2", "artistB");
        s2.title = Some("Skip".into());
        apply_music_signal(&mut b2, &s2, &newly_crossed(0.0, 0.2), 1_000, None);
        assert!(b2.track_meta.get("t2").is_none());
    }

    #[test]
    fn full_listen_counts_one_play_and_pushes_one_timestamp() {
        let mut b = MusicBrain::default();
        let crossed = newly_crossed(0.0, 1.0);
        let counted = apply_music_signal(&mut b, &sig("t1", "artistA"), &crossed, 1_000, None);
        assert!(counted);
        assert_eq!(b.total_plays, 1);
        assert_eq!(b.artist_affinity["artistA"].plays, 1);
        assert_eq!(b.track_plays["t1"].len(), 1);
        assert!(b.seen_artists.contains("artistA"));
    }

    #[test]
    fn tick_below_count_milestone_does_not_count_a_play() {
        let mut b = MusicBrain::default();
        // 0 -> 0.2 crosses only the 0.15 sample milestone, not the 0.5 count milestone.
        let crossed = newly_crossed(0.0, 0.2);
        let counted = apply_music_signal(&mut b, &sig("t1", "artistA"), &crossed, 1_000, None);
        assert!(!counted);
        assert_eq!(b.total_plays, 0);
        assert!(b.track_plays.get("t1").is_none());
        assert!(b.seen_artists.contains("artistA")); // seen, but not a counted listen
    }

    #[test]
    fn second_listen_of_same_track_adds_a_second_timestamp() {
        let mut b = MusicBrain::default();
        let c = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t1", "artistA"), &c, 1_000, None);
        // A fresh listen (store resets prev to 0) crosses milestones again.
        let c2 = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t1", "artistA"), &c2, 5_000, None);
        assert_eq!(b.track_plays["t1"].len(), 2);
        assert_eq!(b.artist_affinity["artistA"].plays, 2);
    }

    #[test]
    fn co_occurrence_records_session_pairs() {
        let mut b = MusicBrain::default();
        let c = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t2", "artistB"), &c, 2_000, Some("artistA"));
        assert_eq!(
            b.artist_cooc.get(&pair_key("artistA", "artistB")).copied(),
            Some(1.0)
        );
    }

    #[test]
    fn explicit_like_counts_and_marks_liked() {
        let mut b = MusicBrain::default();
        let mut s = sig("t1", "artistA");
        s.is_explicit_like = true;
        let crossed = newly_crossed(0.0, 0.05); // barely played, no milestone crossed, but liked
        let counted = apply_music_signal(&mut b, &s, &crossed, 1_000, None);
        assert!(counted);
        assert!(b.artist_affinity["artistA"].liked);
        assert!(b.artist_affinity["artistA"].score >= 0.8);
    }

    #[test]
    fn ring_buffer_is_bounded() {
        let mut b = MusicBrain::default();
        for i in 0..20 {
            let c = newly_crossed(0.0, 1.0);
            apply_music_signal(&mut b, &sig("t1", "a"), &c, 1_000 + i, None);
        }
        assert_eq!(b.track_plays["t1"].len(), TRACK_PLAYS_RING);
    }

    #[test]
    fn dislike_is_a_cooldown_not_a_ban() {
        let mut b = MusicBrain::default();
        let c = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t1", "artistA"), &c, 1_000, None);
        let before = b.artist_affinity["artistA"].score;
        apply_music_dislike(&mut b, "artistA", 2_000);
        assert!(b.disliked_artists.contains_key("artistA"));
        assert!(b.artist_affinity["artistA"].score < before);
        // A later real listen clears the cooldown (reversible).
        let c2 = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t1", "artistA"), &c2, 3_000, None);
        assert!(!b.disliked_artists.contains_key("artistA"));
    }

    #[test]
    fn dislike_escalates_to_a_hard_block_on_repeat() {
        let mut b = MusicBrain::default();
        apply_music_dislike(&mut b, "artistA", 1_000);
        assert!(b.disliked_artists.contains_key("artistA"));
        assert!(!b.is_artist_blocked("artistA"));
        // A second "not interested" while still in cooldown promotes to a permanent block.
        apply_music_dislike(&mut b, "artistA", 2_000);
        assert!(b.is_artist_blocked("artistA"));
        assert!(!b.disliked_artists.contains_key("artistA"));
    }

    #[test]
    fn block_is_reversible_and_preserves_history() {
        let mut b = MusicBrain::default();
        let c = newly_crossed(0.0, 1.0);
        apply_music_signal(&mut b, &sig("t1", "artistA"), &c, 1_000, None);
        block_music_artist(&mut b, "artistA");
        assert!(b.is_artist_blocked("artistA"));
        // History (the play timestamp) survives a block so unblock can warm back up.
        assert!(b.track_plays.contains_key("t1"));
        unblock_music_artist(&mut b, "artistA");
        assert!(!b.is_artist_blocked("artistA"));
    }

    #[test]
    fn discovery_appetite_rises_with_novel_engagement_then_regresses() {
        let mut b = MusicBrain::default(); // starts at the 0.30 neutral
        for _ in 0..30 {
            update_discovery_appetite(&mut b, true);
        }
        let high = b.discovery_appetite;
        assert!(
            high > 0.30,
            "sustained novel engagement should raise appetite"
        );
        for _ in 0..80 {
            update_discovery_appetite(&mut b, false);
        }
        assert!(
            b.discovery_appetite < high,
            "settling into familiar listening should regress appetite"
        );
    }
}
