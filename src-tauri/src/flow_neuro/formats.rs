//! How much the viewer takes to each kind of video ("tutorial", "review"), from Flow for Android's
//! `NeuroFormats`: learned from what they watch, and a small nudge in ranking, never a reason on
//! its own.

use std::collections::{HashMap, HashSet};

/// How far a viewer's liking for a format can move a candidate.
pub const MAX_SCORE_TERM: f64 = 0.04;
const LEARNING_RATE: f64 = 0.1;
const FADE: f64 = 0.01;
const FORGET_BELOW: f64 = 0.01;

/// The word a search uses for `format`.
#[must_use]
pub fn search_word(format: &str) -> &str {
    match format {
        "explainer" => "explained",
        other => other,
    }
}

/// The affinity after a positive signal on a video of `formats`; the others fade a little.
pub fn learn(affinity: &mut HashMap<String, f64>, formats: &HashSet<String>) {
    if formats.is_empty() {
        return;
    }
    for (format, value) in affinity.iter_mut() {
        if !formats.contains(format) {
            *value *= 1.0 - FADE;
        }
    }
    for format in formats {
        let value = affinity.entry(format.clone()).or_insert(0.0);
        *value = *value * (1.0 - LEARNING_RATE) + LEARNING_RATE;
    }
    affinity.retain(|_, value| *value >= FORGET_BELOW);
}

/// The bounded scoring term for a candidate of `formats`.
#[must_use]
pub fn score_term(affinity: &HashMap<String, f64>, formats: &HashSet<String>) -> f64 {
    formats
        .iter()
        .map(|format| affinity.get(format).copied().unwrap_or(0.0))
        .fold(0.0, f64::max)
        * MAX_SCORE_TERM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_watched_format_grows_and_the_others_fade() {
        let mut affinity: HashMap<String, f64> = [("review".to_string(), 0.5)].into();
        let tutorial: HashSet<String> = ["tutorial".to_string()].into();
        learn(&mut affinity, &tutorial);
        assert!((affinity["tutorial"] - 0.1).abs() < 1e-12);
        assert!((affinity["review"] - 0.495).abs() < 1e-12);
        assert!((score_term(&affinity, &tutorial) - 0.1 * MAX_SCORE_TERM).abs() < 1e-12);
    }
}
