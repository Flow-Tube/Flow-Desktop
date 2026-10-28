//! Stage 7's phrase test (Android `NeuroPhrases`), the gensim Phrases way: a pair is a phrase once
//! it has appeared often enough and its normalized pointwise mutual information says its words
//! belong together ("lofi hip"), rather than meeting by chance ("review after"). The counts are
//! the per-video document frequencies the engine already keeps for IDF.

pub use crate::flow_neuro::scoring::IdfSnapshot;

pub const MIN_COUNT: i32 = 3;
pub const MIN_NPMI: f64 = 0.5;
pub const MIN_DOCUMENTS: i32 = 10;

/// NPMI of `bigram`, from -1 (never together) to 1 (only together); `None` when unknown.
#[must_use]
pub fn npmi(bigram: &str, idf: &IdfSnapshot) -> Option<f64> {
    let (first, second) = bigram.split_once(' ')?;
    if idf.total_documents <= 0 {
        return None;
    }
    let count = |word: &str| idf.word_frequencies.get(word).copied();
    let joint = count(bigram)?;
    let n = f64::from(idf.total_documents);
    // A word claimed by a known phrase is not counted alone, so it occurred at least as often as the pair.
    let first = f64::from(count(first).unwrap_or(0).max(joint));
    let second = f64::from(count(second).unwrap_or(0).max(joint));
    let p_joint = (f64::from(joint) / n).min(1.0);
    if p_joint >= 1.0 {
        return Some(1.0);
    }
    Some((p_joint / ((first / n) * (second / n))).ln() / -p_joint.ln())
}

/// Whether `bigram` is a phrase by the viewer's own counts.
#[must_use]
pub fn is_phrase(bigram: &str, idf: &IdfSnapshot) -> bool {
    if idf.total_documents < MIN_DOCUMENTS {
        return false;
    }
    if idf.word_frequencies.get(bigram).copied().unwrap_or(0) < MIN_COUNT {
        return false;
    }
    npmi(bigram, idf).is_some_and(|value| value >= MIN_NPMI)
}

/// A merged run's documents must reach this share of its rarest character's.
pub const MIN_MERGED_SHARE: f64 = 0.5;

/// Whether a merged Han run is a key by the viewer's own counts: seen in [`MIN_COUNT`] videos, and
/// in at least [`MIN_MERGED_SHARE`] of the videos its rarest character appears in, so characters
/// that mostly stand apart never make one.
#[must_use]
pub fn is_merged_run(run: &str, idf: &IdfSnapshot) -> bool {
    if idf.total_documents < MIN_DOCUMENTS {
        return false;
    }
    let Some(&joint) = idf.word_frequencies.get(run) else {
        return false;
    };
    if joint < MIN_COUNT {
        return false;
    }
    let Some(rarest) = run
        .chars()
        .filter_map(|c| idf.word_frequencies.get(&c.to_string()).copied())
        .min()
    else {
        return false;
    };
    f64::from(joint) >= MIN_MERGED_SHARE * f64::from(rarest.max(joint))
}
