//! How taste vectors learn, ported from Flow for Android's `NeuroVectorMath` and checked against
//! its `learn_golden.json`. Pure functions: vectors in, vectors out.
//!
//! A topic's weight is `1 - e^(-E/saturation)` for its evidence `E`: what each event gave it (its
//! weight in the video times the event's strength against a full watch), halved every `half_life`
//! full watches. A topic in many videos therefore outweighs a stronger one in few, which pulling
//! toward each video's weight never allowed (Android #907).

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::scoring::{
    COMPRESSION_CEILING, COMPRESSION_FACTOR, COMPRESSION_THRESHOLD, ContentVector,
    DEVELOPING_DECAY_RATE, DEVELOPING_TOPIC_THRESHOLD, EMERGING_DECAY_RATE, ESTABLISHED_DECAY_RATE,
    ESTABLISHED_TOPIC_THRESHOLD, NEGATIVE_FLOOR_FACTOR, NEGATIVE_PROPORTIONAL_EXPONENT,
    NEGATIVE_SCALAR_FLOOR, NEGATIVE_SCALAR_PROPORTIONAL, strip_domain_tag,
};

/// How a taste vector remembers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Horizon {
    pub saturation: f64,
    pub half_life: f64,
    pub max_topics: usize,
}

/// The learning rate of a full long-form watch. An event's strength is its rate against this one,
/// so a Short teaches and erases in proportion to what it is worth.
pub const DECAY_REFERENCE_RATE: f64 = 0.15;
/// Slower decay prunes less, so the long-term vector needs a hard size bound of its own.
pub const MAX_GLOBAL_TOPICS: usize = 300;

/// Months of watching: the brain's global vector, which sync reads as before.
pub const LONG_TERM: Horizon = Horizon {
    saturation: 30.0,
    half_life: 600.0,
    max_topics: MAX_GLOBAL_TOPICS,
};
/// The last evening or so; device-local, and a quarter of the taste ranking scores with.
pub const RECENT: Horizon = Horizon {
    saturation: 3.0,
    half_life: 25.0,
    max_topics: 60,
};
/// Time-of-day vectors learn like the long-term one, each from fewer watches.
pub const TIME_OF_DAY: Horizon = Horizon {
    saturation: 30.0,
    half_life: 600.0,
    max_topics: 100,
};

pub const RECENT_SHARE: f64 = 0.25;
/// Below this a topic carries less evidence than a quarter of one full watch.
pub const EVIDENCE_PRUNE_THRESHOLD: f64 = 0.005;
/// A word whose phrase holds this many times its weight is that phrase, not an interest of its own.
pub const PHRASE_ABSORB_RATIO: f64 = 10.0;
/// How much of its weight a word keeps when a stronger phrase of the same video contains it.
pub const PHRASE_WORD_SHARE: f64 = 0.5;
const MAX_WEIGHT: f64 = 0.999_999;

/// Adds a positive event of `strength` (1 = a full watch) to `current` on `horizon`. `scalar_rate`
/// moves duration, pacing and complexity; `protected` keys are never absorbed or capped away.
#[must_use]
pub fn learn(
    current: &ContentVector,
    video: &ContentVector,
    strength: f64,
    horizon: Horizon,
    scalar_rate: f64,
    protected: &HashSet<String>,
) -> ContentVector {
    let keep = 0.5_f64.powf(strength / horizon.half_life);
    let mut topics: HashMap<String, f64> =
        HashMap::with_capacity(current.topics.len() + video.topics.len());
    for (key, &weight) in &current.topics {
        let decayed = 1.0 - (1.0 - weight.min(MAX_WEIGHT)).powf(keep);
        if decayed >= EVIDENCE_PRUNE_THRESHOLD || video.topics.contains_key(key) {
            topics.insert(key.clone(), decayed);
        }
    }
    for (key, &share) in &video.topics {
        let remaining = 1.0 - topics.get(key).copied().unwrap_or(0.0).min(MAX_WEIGHT);
        topics.insert(
            key.clone(),
            1.0 - remaining * (-strength * share / horizon.saturation).exp(),
        );
    }
    absorb_phrase_words(&mut topics, protected);

    let scalar = |current: f64, target: f64| {
        (current + (target - current) * scalar_rate * (1.0 - current).powi(2)).clamp(0.0, 1.0)
    };
    let learned = ContentVector {
        topics,
        duration: scalar(current.duration, video.duration),
        pacing: scalar(current.pacing, video.pacing),
        complexity: scalar(current.complexity, video.complexity),
        is_live: scalar(current.is_live, video.is_live),
        ..current.clone()
    };
    cap_topics(&learned, horizon.max_topics, protected)
}

/// Drops words a phrase of theirs outweighs [`PHRASE_ABSORB_RATIO`] times: learned before the
/// phrase was known, they would otherwise match any title that uses the word.
fn absorb_phrase_words(topics: &mut HashMap<String, f64>, protected: &HashSet<String>) {
    let mut strongest_phrase_by_word: HashMap<String, f64> = HashMap::new();
    for (key, &weight) in topics.iter() {
        let base = strip_domain_tag(key);
        if base.contains(' ') {
            for word in base.split(' ') {
                let entry = strongest_phrase_by_word
                    .entry(word.to_string())
                    .or_insert(weight);
                *entry = entry.max(weight);
            }
        }
    }
    if strongest_phrase_by_word.is_empty() {
        return;
    }
    topics.retain(|key, weight| {
        key.contains(' ')
            || protected.contains(key)
            || strongest_phrase_by_word.get(key).copied().unwrap_or(0.0)
                <= *weight * PHRASE_ABSORB_RATIO
    });
}

/// The taste ranking scores with: `long_term` and `recent` each scaled to unit length, recent at
/// `recent_share`. Duration, pacing and complexity come from `long_term`.
#[must_use]
pub fn blend(
    long_term: &ContentVector,
    recent: &ContentVector,
    recent_share: f64,
) -> ContentVector {
    let recent_length = recent.topics.values().map(|w| w * w).sum::<f64>().sqrt();
    if recent_length <= 0.0 {
        return long_term.clone();
    }
    let long_length = long_term.topics.values().map(|w| w * w).sum::<f64>().sqrt();
    let mut topics: HashMap<String, f64> =
        HashMap::with_capacity(long_term.topics.len() + recent.topics.len());
    if long_length > 0.0 {
        for (key, weight) in &long_term.topics {
            topics.insert(key.clone(), weight / long_length * (1.0 - recent_share));
        }
    }
    for (key, weight) in &recent.topics {
        *topics.entry(key.clone()).or_insert(0.0) += weight / recent_length * recent_share;
    }
    ContentVector {
        topics,
        ..long_term.clone()
    }
}

/// The older, rate-based update. Rejections still use it, and positive events on vectors that do
/// not keep evidence (the Shorts vector, channel bootstraps). Unlike Android it never keeps a
/// rejected key at zero: a rejection lowers what is there, drops what reaches zero and adds nothing.
#[must_use]
pub fn adjust_vector(
    current: &ContentVector,
    target: &ContentVector,
    base_rate: f64,
    prune_below: f64,
) -> ContentVector {
    let mut topics = current.topics.clone();
    let negative = base_rate < 0.0;

    for (key, &target_value) in &target.topics {
        let current_value = topics.get(key).copied();
        if negative && current_value.is_none() {
            continue;
        }
        let current_value = current_value.unwrap_or(0.0);
        let delta = if negative {
            let proportional =
                current_value * current_value.powf(NEGATIVE_PROPORTIONAL_EXPONENT) * base_rate;
            proportional.min(base_rate * NEGATIVE_FLOOR_FACTOR)
        } else {
            let saturation_penalty = (1.0 - current_value).powi(2);
            // Brand-new topics learn at half rate, so it takes sustained engagement to build one.
            let cold_topic_damping = 0.5 + 0.5 * (current_value / 0.20).min(1.0);
            (target_value - current_value) * base_rate * saturation_penalty * cold_topic_damping
        };
        let updated = (current_value + delta).clamp(0.0, 1.0);
        if negative && updated <= 0.0 {
            topics.remove(key);
        } else {
            topics.insert(key.clone(), updated);
        }
    }

    topics.retain(|key, value| {
        let in_target = target.topics.contains_key(key);
        if base_rate > 0.0 && !in_target {
            *value *= if *value >= ESTABLISHED_TOPIC_THRESHOLD {
                ESTABLISHED_DECAY_RATE
            } else if *value >= DEVELOPING_TOPIC_THRESHOLD {
                DEVELOPING_DECAY_RATE
            } else {
                EMERGING_DECAY_RATE
            };
        }
        in_target || *value >= prune_below
    });

    if negative && !topics.is_empty() {
        let total: f64 = topics.values().sum();
        let max = topics.values().copied().fold(0.0, f64::max);
        if total > 0.0 && max / total > COMPRESSION_THRESHOLD {
            for value in topics.values_mut() {
                if *value > COMPRESSION_CEILING {
                    *value =
                        COMPRESSION_CEILING + (*value - COMPRESSION_CEILING) * COMPRESSION_FACTOR;
                }
            }
        }
    }

    let scalar = |current: f64, target: f64| {
        if negative {
            let proportional = current * base_rate * NEGATIVE_SCALAR_PROPORTIONAL;
            current + proportional.min(base_rate * NEGATIVE_SCALAR_FLOOR)
        } else {
            current + (target - current) * base_rate * (1.0 - current).powi(2)
        }
        .clamp(0.0, 1.0)
    };
    ContentVector {
        topics,
        duration: scalar(current.duration, target.duration),
        pacing: scalar(current.pacing, target.pacing),
        complexity: scalar(current.complexity, target.complexity),
        is_live: scalar(current.is_live, target.is_live),
        ..current.clone()
    }
}

/// Plants the strongest topics of a strong signal (a real watch, a like, a save, a search) at a
/// survivable weight, so a new interest can establish on a mature profile at all. Sustained
/// engagement grows it; abandonment lets decay remove it.
#[must_use]
pub fn plant_topics(
    current: &ContentVector,
    source: &ContentVector,
    floor: f64,
    top_k: usize,
    plantable: impl Fn(&str) -> bool,
) -> ContentVector {
    if source.topics.is_empty() {
        return current.clone();
    }
    plant_keys(current, &select_plant_keys(source, top_k, plantable), floor)
}

/// Phrase keys first, and never the words of a planted phrase: planting "hip hop" beside "hip"
/// and "hop" would give generic words the weight of the interest itself.
#[must_use]
pub fn select_plant_keys(
    source: &ContentVector,
    top_k: usize,
    plantable: impl Fn(&str) -> bool,
) -> Vec<String> {
    let mut ranked: Vec<(&String, f64)> = source.topics.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let ranked: Vec<&String> = ranked
        .into_iter()
        .map(|(key, _)| key)
        .filter(|key| is_topic_sized(&strip_domain_tag(key)) && plantable(key))
        .collect();
    let phrases: Vec<&String> = ranked
        .iter()
        .copied()
        .filter(|key| strip_domain_tag(key).contains(' '))
        .take(top_k)
        .collect();
    let phrase_words: HashSet<String> = phrases
        .iter()
        .flat_map(|key| {
            strip_domain_tag(key)
                .split(' ')
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect();
    let words = ranked
        .iter()
        .copied()
        .filter(|key| !key.contains(' ') && !phrase_words.contains(&strip_domain_tag(key)));
    phrases
        .iter()
        .copied()
        .chain(words)
        .take(top_k)
        .cloned()
        .collect()
}

#[must_use]
pub fn plant_keys(current: &ContentVector, keys: &[String], floor: f64) -> ContentVector {
    if keys.is_empty() {
        return current.clone();
    }
    let mut planted = current.clone();
    for key in keys {
        let weight = planted.topics.entry(key.clone()).or_insert(0.0);
        if *weight < floor {
            *weight = floor;
        }
    }
    planted
}

/// The vector a positive signal learns from. A word gives way to a phrase of the same video that
/// outweighs it, so "guitar playalong" becomes the interest rather than "guitar" alone.
#[must_use]
pub fn phrase_first(vector: &ContentVector, word_share: f64) -> ContentVector {
    let mut strongest_phrase_by_word: HashMap<String, f64> = HashMap::new();
    for (key, &weight) in &vector.topics {
        let base = strip_domain_tag(key);
        if base.contains(' ') {
            for word in base.split(' ') {
                let entry = strongest_phrase_by_word
                    .entry(word.to_string())
                    .or_insert(weight);
                *entry = entry.max(weight);
            }
        }
    }
    if strongest_phrase_by_word.is_empty() {
        return vector.clone();
    }
    let topics = vector
        .topics
        .iter()
        .map(|(key, &weight)| {
            let base = strip_domain_tag(key);
            let phrase = strongest_phrase_by_word.get(&base).copied();
            let shared = !base.contains(' ') && phrase.is_some_and(|phrase| phrase >= weight);
            (
                key.clone(),
                if shared { weight * word_share } else { weight },
            )
        })
        .collect();
    ContentVector {
        topics,
        ..vector.clone()
    }
}

/// Keeps the `max` strongest topics; `protected` keys always stay.
#[must_use]
pub fn cap_topics(
    vector: &ContentVector,
    max: usize,
    protected: &HashSet<String>,
) -> ContentVector {
    if vector.topics.len() <= max {
        return vector.clone();
    }
    let mut ranked: Vec<(&String, f64)> = vector.topics.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let topics = ranked
        .into_iter()
        .enumerate()
        .filter(|(index, (key, _))| *index < max || protected.contains(&strip_domain_tag(key)))
        .map(|(_, (key, weight))| (key.clone(), weight))
        .collect();
    ContentVector {
        topics,
        ..vector.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vec_of(topics: &[(&str, f64)]) -> ContentVector {
        ContentVector {
            topics: topics.iter().map(|(k, v)| ((*k).to_string(), *v)).collect(),
            ..ContentVector::default()
        }
    }

    fn evidence(weight: f64) -> f64 {
        -LONG_TERM.saturation * (1.0 - weight).ln()
    }

    fn learn_once(vector: &ContentVector, topics: &[(&str, f64)], strength: f64) -> ContentVector {
        learn(
            vector,
            &vec_of(topics),
            strength,
            LONG_TERM,
            0.0,
            &HashSet::new(),
        )
    }

    #[test]
    fn a_topic_in_many_videos_outweighs_a_stronger_one_in_few() {
        let mut vector = ContentVector::default();
        for _ in 0..10 {
            vector = learn_once(&vector, &[("chess", 0.2)], 1.0);
        }
        for _ in 0..2 {
            vector = learn_once(&vector, &[("poker", 0.6)], 1.0);
        }
        assert!(vector.topics["chess"] > vector.topics["poker"]);
    }

    #[test]
    fn evidence_halves_over_the_half_life_of_full_watches() {
        let start = learn_once(&ContentVector::default(), &[("chess", 1.0)], 5.0);
        let mut vector = start.clone();
        for _ in 0..600 {
            vector = learn_once(&vector, &[("cooking", 0.01)], 1.0);
        }
        let halved = evidence(start.topics["chess"]) / 2.0;
        assert!((evidence(vector.topics["chess"]) - halved).abs() < 1e-6);
    }

    #[test]
    fn a_short_teaches_and_erases_in_proportion_to_its_strength() {
        let start = learn_once(&ContentVector::default(), &[("chess", 1.0)], 5.0);
        let mut vector = start.clone();
        for _ in 0..100 {
            vector = learn_once(&vector, &[("prank", 1.0)], 0.01);
        }
        assert!(evidence(vector.topics["chess"]) > evidence(start.topics["chess"]) * 0.998);
        assert!((evidence(vector.topics["prank"]) - 1.0).abs() < 0.01);
    }

    #[test]
    fn a_word_its_phrase_outweighs_ten_times_is_the_phrase_unless_picked() {
        let vector = vec_of(&[
            ("camera test", 0.6),
            ("camera", 0.04),
            ("test", 0.04),
            ("pixel", 0.3),
        ]);
        let protected: HashSet<String> = ["test".to_string()].into();
        let learned = learn(
            &vector,
            &vec_of(&[("pixel", 0.5)]),
            1.0,
            LONG_TERM,
            0.0,
            &protected,
        );
        let mut keys: Vec<&String> = learned.topics.keys().collect();
        keys.sort();
        assert_eq!(keys, ["camera test", "pixel", "test"]);
    }

    #[test]
    fn each_horizon_keeps_its_own_number_of_topics() {
        let mut vector = ContentVector::default();
        for i in 0..80 {
            let key = format!("topic{i}");
            vector = learn(
                &vector,
                &vec_of(&[(&key, 1.0)]),
                1.0,
                RECENT,
                0.0,
                &HashSet::new(),
            );
        }
        assert_eq!(vector.topics.len(), RECENT.max_topics);
        assert!(vector.topics.contains_key("topic79"));
    }

    #[test]
    fn a_rejection_adds_no_new_keys() {
        let current = vec_of(&[("guitar", 0.5)]);
        let rejected = adjust_vector(
            &current,
            &vec_of(&[("guitar", 0.8), ("phonk", 0.9)]),
            -0.4,
            EVIDENCE_PRUNE_THRESHOLD,
        );
        assert!(!rejected.topics.contains_key("phonk"));
        assert!(rejected.topics["guitar"] < 0.5);
    }
}
