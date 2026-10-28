//! Offline evaluation harness for the music ranker.
//!
//! The video engine's eval (`flow_neuro::eval`) optimizes for novelty and *diversity* —
//! the right targets there are the wrong targets here. Music is repeat-dominated and
//! coherence-loving, so this harness measures a deliberately different set of metrics:
//!
//! - **Repeat-aware hit-rate** — does the ranking surface the tracks the user actually
//!   relistens to? (In video a re-watch is near-worthless; in music it is the goal.)
//! - **Intra-list coherence** — do adjacent picks "go together" (shared artist, co-listen,
//!   shared genre)? This is the *inverse* of the video engine's diversity objective.
//! - **Artist diversity** — distinct-artist fraction. Reported, not maximized: short
//!   artist runs are good; the harness only checks that runs stay bounded.
//! - **Discovery rate** — fraction of novel (unseen) artists, which should track the
//!   surface's familiarity/discovery target (comfort low, discover high).
//!
//! These are `#[cfg(test)]`-gated quality guards plus reusable `pub` functions to compare constant choices instead of guessing. There is also a
//! source-level guard test that the music subsystem never reaches into the video learner —
//! the regression backstop for the leak that motivated the whole engine.

use std::collections::HashSet;

use super::model::{MusicBrain, pair_key};
use super::rank::{RankInput, rank};

/// All music-native metrics for one ranked list.
#[derive(Debug, Clone)]
pub struct MusicEvalMetrics {
    /// Repeat-aware hit-rate@k of the held-out relisten set (1.0 = every relisten surfaced).
    pub hit_rate: f64,
    /// Mean pairwise "goes together" over the top-k (higher = a more coherent session).
    pub coherence: f64,
    /// Distinct-artist fraction over the top-k (descriptive; bounded is good, not maximal).
    pub artist_diversity: f64,
    /// Longest consecutive same-artist run across the whole ranking (the spread rule caps this).
    pub max_artist_run: usize,
    /// Fraction of the top-k whose artist is novel (unseen).
    pub discovery_rate: f64,
}

/// Squash an unbounded non-negative co-listen weight into `0.0..1.0`.
fn squash(x: f64) -> f64 {
    x / (1.0 + x)
}

/// How strongly two candidates "go together" in `0.0..=1.0`: same artist is maximal,
/// otherwise the stronger of their co-listen weight and a shared-genre match.
fn pair_coherence(brain: &MusicBrain, a: &RankInput, b: &RankInput) -> f64 {
    if !a.artist_key.is_empty() && a.artist_key == b.artist_key {
        return 1.0;
    }
    let mut s = 0.0;
    if !a.artist_key.is_empty() && !b.artist_key.is_empty() {
        if let Some(&w) = brain
            .artist_cooc
            .get(&pair_key(&a.artist_key, &b.artist_key))
        {
            s = squash(w);
        }
    }
    if let (Some(ga), Some(gb)) = (a.genre.as_deref(), b.genre.as_deref()) {
        if ga == gb {
            s = s.max(0.5);
        }
    }
    s
}

/// Repeat-aware hit-rate@k: of the tracks the user is known to relisten to (`heldout`),
/// the fraction that appear in the ranking's top `k`. Normalized by `min(k, |heldout|)`
/// so a perfect ranking reaches 1.0 even when there are more relistens than slots.
pub fn repeat_aware_hit_rate(ranked_ids: &[String], heldout: &HashSet<String>, k: usize) -> f64 {
    if heldout.is_empty() || k == 0 {
        return 0.0;
    }
    let hits = ranked_ids
        .iter()
        .take(k)
        .filter(|id| heldout.contains(*id))
        .count();
    let denom = heldout.len().min(k);
    hits as f64 / denom as f64
}

/// Mean pairwise coherence across a list — the music analog of intra-list diversity, but
/// the objective is *high* (a coherent session), not low.
pub fn intra_list_coherence(brain: &MusicBrain, inputs: &[RankInput]) -> f64 {
    let n = inputs.len();
    if n < 2 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut pairs = 0;
    for i in 0..n {
        for j in (i + 1)..n {
            sum += pair_coherence(brain, &inputs[i], &inputs[j]);
            pairs += 1;
        }
    }
    sum / pairs as f64
}

/// Distinct-artist fraction (1.0 = every track a different artist). Empty artists are ignored.
pub fn artist_diversity(inputs: &[RankInput]) -> f64 {
    if inputs.is_empty() {
        return 0.0;
    }
    let distinct: HashSet<&str> = inputs
        .iter()
        .map(|i| i.artist_key.as_str())
        .filter(|a| !a.is_empty())
        .collect();
    distinct.len() as f64 / inputs.len() as f64
}

/// Longest run of consecutive identical artists in the ranked order. Empty artists break runs.
pub fn max_artist_run(inputs: &[RankInput]) -> usize {
    let mut max = 0usize;
    let mut run = 0usize;
    let mut last: Option<&str> = None;
    for inp in inputs {
        let a = inp.artist_key.as_str();
        if a.is_empty() {
            run = 0;
            last = None;
            continue;
        }
        if Some(a) == last {
            run += 1;
        } else {
            run = 1;
            last = Some(a);
        }
        max = max.max(run);
    }
    max
}

/// Fraction of the list whose artist the brain has never seen (novelty exposure).
pub fn discovery_rate(brain: &MusicBrain, inputs: &[RankInput]) -> f64 {
    if inputs.is_empty() {
        return 0.0;
    }
    let novel = inputs
        .iter()
        .filter(|i| !i.artist_key.is_empty() && !brain.seen_artists.contains(&i.artist_key))
        .count();
    novel as f64 / inputs.len() as f64
}

/// Runs the live ranker on a candidate set for a given surface and reports every metric.
/// `heldout` is the ground-truth set of relistened track ids (not seen by the ranker).
pub fn evaluate(
    brain: &MusicBrain,
    inputs: &[RankInput],
    surface: &str,
    now_ms: u64,
    heldout: &HashSet<String>,
    k: usize,
) -> MusicEvalMetrics {
    let order = rank(brain, inputs, surface, now_ms);
    let ranked: Vec<RankInput> = order.iter().map(|&i| inputs[i].clone()).collect();
    let ranked_ids: Vec<String> = ranked.iter().map(|r| r.track_id.clone()).collect();
    let top_k: Vec<RankInput> = ranked.iter().take(k).cloned().collect();

    MusicEvalMetrics {
        hit_rate: repeat_aware_hit_rate(&ranked_ids, heldout, k),
        coherence: intra_list_coherence(brain, &top_k),
        artist_diversity: artist_diversity(&top_k),
        max_artist_run: max_artist_run(&ranked),
        discovery_rate: discovery_rate(brain, &top_k),
    }
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
            is_explicit_like: false,
            title: None,
            artist_display: None,
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &newly_crossed(0.0, 1.0), now, None);
    }

    #[test]
    fn hit_rate_counts_relistens_in_top_k() {
        let ranked = vec![
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
            "d".to_string(),
        ];
        let heldout: HashSet<String> = ["a".to_string(), "c".to_string()].into_iter().collect();
        // Both relistens are inside the top-3 → perfect hit-rate.
        assert!((repeat_aware_hit_rate(&ranked, &heldout, 3) - 1.0).abs() < 1e-9);
        // At k=1 the denominator caps to min(1,2)=1 and "a" is the single hit → 1.0.
        assert!((repeat_aware_hit_rate(&ranked, &heldout, 1) - 1.0).abs() < 1e-9);
        // "b" precedes "c"; with k=2 only "a" (slot 0) is a hit out of min(2,2)=2 → 0.5.
        let later: HashSet<String> = ["a".to_string(), "d".to_string()].into_iter().collect();
        assert!((repeat_aware_hit_rate(&ranked, &later, 2) - 0.5).abs() < 1e-9);
        let miss: HashSet<String> = ["z".to_string()].into_iter().collect();
        assert_eq!(repeat_aware_hit_rate(&ranked, &miss, 4), 0.0);
    }

    #[test]
    fn coherence_is_higher_for_same_artist_than_for_strangers() {
        let brain = MusicBrain::default();
        let same = vec![input("t1", "a"), input("t2", "a")];
        let strangers = vec![input("t1", "a"), input("t2", "b")];
        assert!(intra_list_coherence(&brain, &same) > intra_list_coherence(&brain, &strangers));
    }

    #[test]
    fn coherence_rewards_co_listened_artists() {
        let mut brain = MusicBrain::default();
        brain.artist_cooc.insert(pair_key("a", "b"), 6.0);
        let pair = vec![input("t1", "a"), input("t2", "b")];
        let unrelated = vec![input("t1", "a"), input("t2", "c")];
        assert!(intra_list_coherence(&brain, &pair) > intra_list_coherence(&brain, &unrelated));
    }

    #[test]
    fn evaluate_surfaces_relistened_tracks_and_bounds_artist_runs() {
        let mut brain = MusicBrain::default();
        let now = 100 * 86_400_000u64;
        // "hot" is hammered recently (a relisten); strangers are unknown.
        for i in 0..5 {
            listen(&mut brain, "hot", "loved", now - (i * 3_600_000) - 1_000);
        }
        let inputs = vec![
            input("s0", "stranger0"),
            input("s1", "stranger1"),
            input("hot", "loved"),
            input("s2", "stranger2"),
        ];
        let heldout: HashSet<String> = ["hot".to_string()].into_iter().collect();
        let m = evaluate(&brain, &inputs, "quick_picks", now, &heldout, 4);
        // The relistened track must be surfaced, and no artist run may exceed the cap.
        assert!(m.hit_rate > 0.0, "relisten not surfaced: {m:?}");
        assert!(m.max_artist_run <= 2, "artist run too long: {m:?}");
        // Every reported ratio stays in range.
        assert!((0.0..=1.0).contains(&m.coherence), "{m:?}");
        assert!((0.0..=1.0).contains(&m.artist_diversity), "{m:?}");
        assert!((0.0..=1.0).contains(&m.discovery_rate), "{m:?}");
    }

    #[test]
    fn discover_surface_exposes_more_novelty_than_quick_picks() {
        let mut brain = MusicBrain::default();
        let now = 50 * 86_400_000u64;
        // Make "loved" a strong, familiar artist with several played tracks.
        for i in 0..4 {
            listen(
                &mut brain,
                &format!("L{i}"),
                "loved",
                now - (i * 1000) - 1_000,
            );
        }
        // Candidate pool: 4 familiar (loved) + 4 distinct novel artists.
        let inputs = vec![
            input("L0", "loved"),
            input("L1", "loved"),
            input("L2", "loved"),
            input("L3", "loved"),
            input("n0", "newA"),
            input("n1", "newB"),
            input("n2", "newC"),
            input("n3", "newD"),
        ];
        let heldout: HashSet<String> = HashSet::new();
        let quick = evaluate(&brain, &inputs, "quick_picks", now, &heldout, 4);
        let discover = evaluate(&brain, &inputs, "discover", now, &heldout, 4);
        assert!(
            discover.discovery_rate > quick.discovery_rate,
            "discover={:?} quick={:?}",
            discover.discovery_rate,
            quick.discovery_rate
        );
    }

    /// Regression backstop for the original leak: the music subsystem must never call the
    /// video engine's learning entry points. (It may share the read-only `TimeBucket` enum
    /// from `flow_neuro::scoring` — that is not a learning call and is not forbidden.) This
    /// harness file is itself excluded, since it names the forbidden symbols on purpose.
    #[test]
    fn music_subsystem_never_calls_the_video_learner() {
        use std::fs;
        use std::path::{Path, PathBuf};

        let manifest = env!("CARGO_MANIFEST_DIR");
        let module_dir = Path::new(manifest).join("src").join("music_brain");

        let mut files: Vec<PathBuf> = Vec::new();
        for entry in fs::read_dir(&module_dir).expect("read music_brain dir") {
            let path = entry.expect("dir entry").path();
            let is_rs = path.extension().and_then(|e| e.to_str()) == Some("rs");
            let is_self = path.file_name().and_then(|n| n.to_str()) == Some("eval.rs");
            if is_rs && !is_self {
                files.push(path);
            }
        }
        files.push(
            Path::new(manifest)
                .join("src")
                .join("commands")
                .join("music_brain.rs"),
        );

        const FORBIDDEN: [&str; 3] = [
            "log_video_interaction",
            "apply_interaction",
            "flow_neuro::signals",
        ];
        for file in files {
            let src = fs::read_to_string(&file).unwrap_or_default();
            for line in src.lines() {
                if line.trim_start().starts_with("//") {
                    continue;
                }
                for needle in FORBIDDEN {
                    assert!(
                        !line.contains(needle),
                        "{file:?} reaches into the video learner via `{needle}` — \
                         music must never train flow_neuro"
                    );
                }
            }
        }
    }
}
