//! Brings a brain to key spec 2 once (Android `NeuroKeyMigration.toKeySpec2`, plus the schema 18
//! pass a desktop brain never had), then to key spec 3 (`toKeySpec3`, Traditional Chinese keys
//! folded to Simplified), and reads keys again after every sync merge
//! (`NeuroKeyMigration.afterSync`). Keys written differently are read again and merged: "guitars"
//! joins "guitar", "lo-fi" joins "lofi". Records that meet keep the stronger one, so a merge never
//! counts anything twice; document frequency sums, since two spellings were two counts of one word.

use std::collections::{HashMap, HashSet};

use crate::flow_neuro::display_forms::{
    DisplayForm, DisplayForms, capitalized, fill_gaps, record, spellings_in, with_pick_spellings,
};
use crate::flow_neuro::keyed_lists::keyed_lists;
use crate::flow_neuro::keyspec::phrases::{self, MIN_COUNT};
use crate::flow_neuro::keyspec::{self, KeySpec, normalize_lemma};
use crate::flow_neuro::scoring::{
    ContentVector, IdfSnapshot, RejectionSignal, TopicEvidence, UserBrain, strip_domain_tag,
};
use crate::flow_neuro::signals::make_affinity_key;

/// A pair the viewer engaged with beyond one chance title weighs at least this much.
const KEPT_PAIR_WEIGHT: f64 = 0.30;
/// What Android's onboarding gave every pair of picks; a link past it has co-watching behind it.
const ONBOARDING_EDGE: f64 = 0.3;
const TOPIC_EVIDENCE_MAX_SCORE: f64 = 50.0;

/// Converts a brain written before key spec 2, once, reading it the way key spec 2 did. Returns
/// whether it converted.
pub fn to_key_spec_2(brain: &mut UserBrain) -> bool {
    if brain.key_spec >= 2 {
        return false;
    }
    let spec = brain.key_spec().at_version(2);
    let mut rekey = Rekey::new(&spec, HashMap::new());
    let mut forms = merged_forms(&brain.display_forms, &mut rekey);
    for (stemmed, before) in spelled_before(&weighted_keys(brain), &spec) {
        forms.entry(stemmed).or_insert(DisplayForm {
            form: capitalized(&before),
            votes: 1,
        });
    }
    brain.idf_word_frequency = rekey.merged(&brain.idf_word_frequency, |a, b| a + b);
    brain.recent_query_tokens = brain
        .recent_query_tokens
        .iter()
        .map(|tokens| {
            tokens
                .iter()
                .flat_map(|token| rekey.keys_for(token))
                .collect()
        })
        .collect();

    rekey_brain(brain, &spec, TopicEvidence::merged_with, Pass::Migration);
    brain.display_forms = forms;
    brain.key_spec = 2;
    true
}

/// Converts a key spec 2 brain to key spec 3, once: Traditional Chinese keys fold into their
/// Simplified ones and keep the Traditional spelling to display. A Japanese viewer's kanji stay.
/// Returns whether it converted.
pub fn to_key_spec_3(brain: &mut UserBrain) -> bool {
    if brain.key_spec >= keyspec::VERSION {
        return false;
    }
    let spec = brain.key_spec();
    let mut rekey = Rekey::new(&spec, HashMap::new());
    let mut forms = merged_forms(&brain.display_forms, &mut rekey);
    let bases: HashSet<String> = weighted_keys(brain)
        .into_keys()
        .map(|key| strip_domain_tag(&key))
        .collect();
    for base in bases {
        let Some(folded) = single(rekey.keys_for(&base)) else {
            continue;
        };
        if folded != base && !forms.contains_key(&folded) {
            forms.insert(
                folded,
                DisplayForm {
                    form: base,
                    votes: 1,
                },
            );
        }
    }
    brain.idf_word_frequency = rekey.merged(&brain.idf_word_frequency, |a, b| a + b);
    brain.blocked_topics = brain
        .blocked_topics
        .iter()
        .map(|topic| single(rekey.keys_for(topic)).unwrap_or_else(|| topic.clone()))
        .collect();

    rekey_brain(brain, &spec, TopicEvidence::merged_with, Pass::Refold);
    brain.display_forms = forms;
    brain.key_spec = keyspec::VERSION;
    true
}

/// Reads a merged brain's keys again, since a peer on an older key spec sends old spellings.
/// `spelled` holds the spellings the peer's keys had before they were read ([`spelled_before`]);
/// they and the picks fill keys no title has spelled yet.
pub fn after_sync(brain: &mut UserBrain, spelled: &HashMap<String, String>) {
    let spec = brain.key_spec();
    rekey_brain(
        brain,
        &spec,
        |a, b| {
            if a.positive_score >= b.positive_score {
                a
            } else {
                b
            }
        },
        Pass::AfterSync,
    );
    let global = &brain.global_vector.topics;
    let keep = |key: &str| global.contains_key(key);
    let forms = fill_gaps(&brain.display_forms, spelled, keep);
    let unspelled: Vec<String> = brain
        .preferred_topics
        .iter()
        .filter(|label| {
            spec.keys_of(label)
                .iter()
                .any(|key| !forms.contains_key(key))
        })
        .cloned()
        .collect();
    brain.display_forms = with_pick_spellings(&forms, &unspelled, &spec);
}

/// Spells a converted brain's keys from `titles`, oldest first, the way learning from them would
/// have: the stems an older build kept ("vintag") never reached a label.
pub fn spell_from_titles(brain: &mut UserBrain, titles: &[String]) {
    let keys: Vec<String> = weighted_keys(brain).into_keys().collect();
    spell(brain, titles, &keys);
}

/// Spells the keys no title has spelled yet from `titles`, such as the keys a peer's brain
/// brought along with the titles of its watch history. A spelled key keeps its votes.
/// Returns whether any key gained a spelling.
pub fn fill_gaps_from_titles(brain: &mut UserBrain, titles: &[String]) -> bool {
    let gaps: Vec<String> = weighted_keys(brain)
        .into_keys()
        .filter(|key| !brain.display_forms.contains_key(&strip_domain_tag(key)))
        .collect();
    let before = brain.display_forms.len();
    if !gaps.is_empty() {
        spell(brain, titles, &gaps);
    }
    brain.display_forms.len() > before
}

fn spell(brain: &mut UserBrain, titles: &[String], keys: &[String]) {
    let spec = brain.key_spec();
    let global = &brain.global_vector.topics;
    let mut forms = std::mem::take(&mut brain.display_forms);
    for title in titles.iter().rev() {
        forms = record(&forms, &spellings_in(title, keys, &spec), |key| {
            global.contains_key(key)
        });
    }
    brain.display_forms = forms;
}

/// The readable spelling a key had before `spec` stemmed it ("guitars" for "guitar"), for keys
/// that read as one other key. Of two spellings the heavier wins; a key already spelled that way
/// in `keys` needs none.
#[must_use]
pub fn spelled_before<'a>(
    keys: impl IntoIterator<Item = (&'a String, &'a f64)>,
    spec: &KeySpec,
) -> HashMap<String, String> {
    let bases: Vec<(String, f64)> = keys
        .into_iter()
        .map(|(key, &weight)| (respelled(&strip_domain_tag(key)), weight))
        .collect();
    let mut before: HashMap<String, (String, f64)> = HashMap::new();
    for (base, weight) in &bases {
        let read = spec.rekey(base);
        let [stemmed] = read.as_slice() else {
            continue;
        };
        if stemmed != base
            && before
                .get(stemmed)
                .is_none_or(|(_, heaviest)| weight > heaviest)
        {
            before.insert(stemmed.clone(), (base.clone(), *weight));
        }
    }
    let unchanged: HashSet<&String> = bases.iter().map(|(base, _)| base).collect();
    before
        .into_iter()
        .filter(|(stemmed, _)| !unchanged.contains(stemmed))
        .map(|(stemmed, (spelling, _))| (stemmed, spelling))
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pass {
    /// Once: chance pairs leave the brain, onboarding links stay.
    Migration,
    /// Once, to key spec 3: keys fold, every pair and link stays.
    Refold,
    /// After every merge: no pair is judged again, Android's onboarding links go.
    AfterSync,
}

fn rekey_brain(
    brain: &mut UserBrain,
    spec: &KeySpec,
    merge_evidence: impl Fn(TopicEvidence, TopicEvidence) -> TopicEvidence,
    pass: Pass,
) {
    // A pick was once keyed by its whole label ("machine learning"); titles key it by its chunks.
    let pick_forms: HashMap<String, Vec<String>> = brain
        .preferred_topics
        .iter()
        .map(|label| (normalize_lemma(label), spec.keys_of(label)))
        .filter(|(old, keys)| keys.as_slice() != [old.clone()])
        .collect();
    let mut rekey = Rekey::new(spec, pick_forms);
    rekey.vector(&mut brain.global_vector);
    for vector in brain.time_vectors.values_mut() {
        rekey.vector(vector);
    }
    brain.topic_affinities = rekey.edges(&brain.topic_affinities);
    for profile in brain.channel_topic_profiles.values_mut() {
        *profile = rekey.merged(profile, f64::max);
    }
    brain.topic_evidence = rekey.merged(&brain.topic_evidence, &merge_evidence);
    brain.rejection_patterns = rekey.rejections(&brain.rejection_patterns);

    let picks: HashSet<String> = brain
        .preferred_topics
        .iter()
        .flat_map(|label| spec.keys_of(label))
        .collect();
    let chance = if pass == Pass::Migration {
        chance_pairs(brain, spec, &picks)
    } else {
        HashSet::new()
    };
    let drop_vector = |vector: &mut ContentVector| {
        vector.topics.retain(|key, _| !chance.contains(key));
        vector
            .topic_confidence
            .retain(|key, _| !chance.contains(key));
        vector.anchor_topics.retain(|key| !chance.contains(key));
    };
    drop_vector(&mut brain.global_vector);
    brain.time_vectors.values_mut().for_each(drop_vector);
    for profile in brain.channel_topic_profiles.values_mut() {
        profile.retain(|key, _| !chance.contains(key));
    }
    brain.topic_evidence.retain(|key, _| !chance.contains(key));
    brain.topic_affinities.retain(|key, weight| {
        let ends: Vec<&str> = key.split('|').collect();
        let by_chance = ends.iter().any(|end| chance.contains(*end));
        let from_onboarding = pass == Pass::AfterSync
            && ends.iter().all(|end| picks.contains(*end))
            && (*weight - ONBOARDING_EDGE).abs() < 1e-9;
        !(by_chance || from_onboarding)
    });
}

/// Pairs that are no phrase by the viewer's own per-video counts and carry no other proof.
fn chance_pairs(brain: &UserBrain, spec: &KeySpec, picks: &HashSet<String>) -> HashSet<String> {
    // Earlier versions counted every event of a video, about two per video.
    let per_video = IdfSnapshot {
        word_frequencies: brain
            .idf_word_frequency
            .iter()
            .map(|(word, count)| (word.clone(), (count + 1) / 2))
            .collect(),
        total_documents: (brain.idf_total_documents + 1) / 2,
    };
    let lists = keyed_lists(spec);
    let mut weights: HashMap<&String, f64> = HashMap::new();
    for vector in std::iter::once(&brain.global_vector).chain(brain.time_vectors.values()) {
        for (key, &weight) in &vector.topics {
            let entry = weights.entry(key).or_insert(weight);
            *entry = entry.max(weight);
        }
    }
    let linked: Vec<String> = brain
        .topic_affinities
        .keys()
        .flat_map(|key| key.split('|').map(str::to_string))
        .collect();
    let keys = weights
        .keys()
        .map(|key| (*key).clone())
        .chain(brain.topic_evidence.keys().cloned())
        .chain(
            brain
                .channel_topic_profiles
                .values()
                .flat_map(|p| p.keys().cloned()),
        )
        .chain(linked);
    keys.filter(|key| {
        let base = strip_domain_tag(key);
        let evidence = brain
            .topic_evidence
            .get(&base)
            .or_else(|| brain.topic_evidence.get(key));
        let learned = base.matches(' ').count() == 1 && phrases::is_phrase(&base, &per_video);
        base.contains(' ')
            && !picks.contains(&base)
            && !lists.is_known_phrase(&base)
            && !learned
            && evidence.is_none_or(|e| e.explicit_signals == 0)
            && evidence.is_none_or(|e| e.video_ids.len() < usize::try_from(MIN_COUNT).unwrap_or(3))
            && weights.get(key).copied().unwrap_or(0.0) < KEPT_PAIR_WEIGHT
    })
    .collect()
}

/// Every key a label or a search can reach, with its weight in the global vector (0 elsewhere).
fn weighted_keys(brain: &UserBrain) -> HashMap<String, f64> {
    let mut keys = brain.global_vector.topics.clone();
    let linked = brain
        .topic_affinities
        .keys()
        .filter_map(|key| link_ends(key))
        .flat_map(|(left, right)| [left.to_string(), right.to_string()]);
    for key in linked.chain(brain.topic_evidence.keys().cloned()) {
        keys.entry(key).or_insert(0.0);
    }
    keys
}

fn merged_forms(forms: &DisplayForms, rekey: &mut Rekey) -> DisplayForms {
    rekey.merged(forms, |a, b| if a.votes >= b.votes { a } else { b })
}

/// A stored key as the key spec should read it: desktops before key spec 2 joined a word pair
/// with an underscore (`leg_day`), which the key spec would read as two words.
#[must_use]
pub fn respelled(key: &str) -> String {
    key.replace('_', " ")
}

/// A stored link's two ends: "a|b" as Android writes links, or "a:b" as desktops wrote them
/// before key spec 2.
#[must_use]
pub fn link_ends(key: &str) -> Option<(&str, &str)> {
    if let Some((left, right)) = key.split_once('|') {
        return (!right.contains('|')).then_some((left, right));
    }
    let (left, right) = key.split_once(':')?;
    (!right.contains(':') && !left.is_empty() && !right.is_empty()).then_some((left, right))
}

/// Reads keys again by a key spec (Android `NeuroKeyMigration.Rekey`), caching each key's reading.
struct Rekey<'a> {
    spec: &'a KeySpec,
    pick_forms: HashMap<String, Vec<String>>,
    cache: HashMap<String, Vec<String>>,
}

impl<'a> Rekey<'a> {
    fn new(spec: &'a KeySpec, pick_forms: HashMap<String, Vec<String>>) -> Self {
        Self {
            spec,
            pick_forms,
            cache: HashMap::new(),
        }
    }

    fn keys_for(&mut self, key: &str) -> Vec<String> {
        if let Some(keys) = self.cache.get(key) {
            return keys.clone();
        }
        let keys = self
            .pick_forms
            .get(key)
            .cloned()
            .unwrap_or_else(|| self.spec.rekey(&respelled(key)));
        self.cache.insert(key.to_string(), keys.clone());
        keys
    }

    fn merged<V: Clone>(
        &mut self,
        map: &HashMap<String, V>,
        merge: impl Fn(V, V) -> V,
    ) -> HashMap<String, V> {
        let mut out: HashMap<String, V> = HashMap::with_capacity(map.len());
        for (key, value) in map {
            for read in self.keys_for(key) {
                let next = match out.remove(&read) {
                    Some(existing) => merge(existing, value.clone()),
                    None => value.clone(),
                };
                out.insert(read, next);
            }
        }
        out
    }

    fn vector(&mut self, vector: &mut ContentVector) {
        vector.topics = self.merged(&vector.topics, f64::max);
        vector.topic_confidence = self.merged(&vector.topic_confidence, f64::max);
        vector.anchor_topics = vector
            .anchor_topics
            .iter()
            .flat_map(|key| self.keys_for(key))
            .collect();
    }

    /// A pair read end by end; it goes when an end splits, vanishes or meets the other.
    fn pair(&mut self, left: &str, right: &str) -> Option<String> {
        let left = single(self.keys_for(left))?;
        let right = single(self.keys_for(right))?;
        (left != right).then(|| make_affinity_key(&left, &right))
    }

    fn edges(&mut self, edges: &HashMap<String, f64>) -> HashMap<String, f64> {
        let mut out = HashMap::with_capacity(edges.len());
        for (key, &weight) in edges {
            let Some(edge) = link_ends(key).and_then(|(left, right)| self.pair(left, right)) else {
                continue;
            };
            let entry = out.entry(edge).or_insert(weight);
            *entry = f64::max(*entry, weight);
        }
        out
    }

    /// Rejection patterns, a rejected pair ("a|b") kept a pair. Android reads a pair as two words
    /// here, which would turn one rejected pairing into two rejected topics.
    fn rejections(
        &mut self,
        patterns: &HashMap<String, RejectionSignal>,
    ) -> HashMap<String, RejectionSignal> {
        let mut out: HashMap<String, RejectionSignal> = HashMap::with_capacity(patterns.len());
        for (key, signal) in patterns {
            let reads = match key.split_once('|') {
                Some((left, right)) => self.pair(left, right).into_iter().collect(),
                None => self.keys_for(key),
            };
            for read in reads {
                let entry = out.entry(read).or_insert_with(|| signal.clone());
                entry.count = entry.count.max(signal.count);
                entry.last_rejected_at = entry.last_rejected_at.max(signal.last_rejected_at);
            }
        }
        out
    }
}

fn single(keys: Vec<String>) -> Option<String> {
    let mut keys = keys.into_iter();
    match (keys.next(), keys.next()) {
        (Some(key), None) => Some(key),
        _ => None,
    }
}

impl TopicEvidence {
    /// Two records of one key as one (Android `TopicEvidence.mergedWith`).
    #[must_use]
    pub fn merged_with(self, other: Self) -> Self {
        let capped = |a: HashSet<String>, b: HashSet<String>| -> HashSet<String> {
            let mut all: Vec<String> = a
                .into_iter()
                .chain(b)
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();
            all.sort();
            let skip = all
                .len()
                .saturating_sub(crate::flow_neuro::scoring::TOPIC_EVIDENCE_MAX_IDS);
            all.into_iter().skip(skip).collect()
        };
        let first_seen = [self.first_seen_at, other.first_seen_at]
            .into_iter()
            .filter(|at| *at > 0)
            .min()
            .unwrap_or(0);
        Self {
            positive_signals: self.positive_signals + other.positive_signals,
            negative_signals: self.negative_signals + other.negative_signals,
            watch_signals: self.watch_signals + other.watch_signals,
            explicit_signals: self.explicit_signals + other.explicit_signals,
            positive_score: (self.positive_score + other.positive_score)
                .min(TOPIC_EVIDENCE_MAX_SCORE),
            video_ids: capped(self.video_ids, other.video_ids),
            channel_ids: capped(self.channel_ids, other.channel_ids),
            first_seen_at: first_seen,
            last_seen_at: self.last_seen_at.max(other.last_seen_at),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_brain() -> UserBrain {
        let mut brain: UserBrain = serde_json::from_value(serde_json::json!({
            "global_vector": {
                "topics": {
                    "guitars": 0.5,
                    "guitar": 0.4,
                    "restoring": 0.35,
                    "leg_day": 0.12,
                    "vintag_guitar": 0.45
                },
                "anchor_topics": ["guitars"],
                "duration": 0.5, "pacing": 0.5, "complexity": 0.5, "is_live": 0.0
            },
            "topic_affinities": { "game:guitars": 0.2, "game|guitar": 0.3 },
            "idf_word_frequency": { "guitars": 3, "guitar": 5, "leg_day": 2 },
            "idf_total_documents": 40,
            "topic_evidence": {
                "guitars": { "positive_signals": 1, "positive_score": 1.0 },
                "guitar": { "positive_signals": 2, "positive_score": 2.0 }
            },
            "channel_topic_profiles": { "c1": { "guitars": 0.2, "guitar": 0.6 } },
            "rejection_patterns": {
                "guitars|riffs": { "count": 2, "last_rejected_at": 5 },
                "guitars": { "count": 1, "last_rejected_at": 9 }
            },
            "preferred_topics": ["Machine Learning"]
        }))
        .unwrap();
        brain.settle_languages("en");
        brain
    }

    #[test]
    fn a_legacy_brain_reads_every_key_once() {
        let mut brain = legacy_brain();
        assert_eq!(brain.key_spec, 0);
        assert!(to_key_spec_2(&mut brain));
        let spec = brain.key_spec();
        let restor = spec.key_of("restoring");

        let topics = &brain.global_vector.topics;
        assert_eq!(topics.get("guitar"), Some(&0.5), "spellings merge by max");
        assert!(!topics.contains_key("guitars"));
        assert!(topics.contains_key(&restor));
        assert!(
            !topics.contains_key("leg day"),
            "a chance pair leaves the vector"
        );
        assert!(
            topics.contains_key(&format!("{} guitar", spec.key_of("vintag"))),
            "a heavy pair stays"
        );
        assert!(brain.global_vector.anchor_topics.contains("guitar"));

        assert_eq!(
            brain.idf_word_frequency.get("guitar"),
            Some(&8),
            "counts sum"
        );
        assert_eq!(
            brain.idf_word_frequency.get("leg day"),
            Some(&2),
            "a pair keeps its count, so it can still prove to be a phrase"
        );
        assert_eq!(brain.topic_affinities.get("game|guitar"), Some(&0.3));
        assert_eq!(brain.topic_affinities.len(), 1);
        assert_eq!(brain.topic_evidence["guitar"].positive_signals, 3);
        assert_eq!(brain.channel_topic_profiles["c1"].get("guitar"), Some(&0.6));
        let riff = spec.key_of("riffs");
        let pair = make_affinity_key("guitar", &riff);
        assert_eq!(
            brain.rejection_patterns[&pair].count, 2,
            "a rejected pair stays a pair"
        );
        assert_eq!(brain.rejection_patterns["guitar"].count, 1);
        assert_eq!(brain.rejection_patterns.len(), 2);
        assert_eq!(brain.display_forms[&restor].form, "Restoring");
        assert!(!brain.display_forms.contains_key("guitar"));
        assert_eq!(brain.key_spec, 2);
        assert!(to_key_spec_3(&mut brain));
        assert_eq!(brain.key_spec, keyspec::VERSION);
        assert_eq!(brain.global_vector.topics.get("guitar"), Some(&0.5));
    }

    fn spec_2_brain(language: &str, topics: &serde_json::Value) -> UserBrain {
        let mut brain: UserBrain = serde_json::from_value(serde_json::json!({
            "key_spec": 2,
            "global_vector": {
                "topics": topics,
                "duration": 0.5, "pacing": 0.5, "complexity": 0.5, "is_live": 0.0
            },
            "idf_word_frequency": { "機器學習": 3, "机器学习": 4 },
            "blocked_topics": ["新聞"]
        }))
        .unwrap();
        brain.settle_languages(language);
        brain
    }

    // Android NeuroHanRunsTest: a stored brain's Traditional keys.
    #[test]
    fn traditional_keys_fold_into_simplified_ones_and_keep_their_spelling() {
        let mut brain = spec_2_brain(
            "en",
            &serde_json::json!({ "機器學習": 0.4, "机器学习": 0.2, "python": 0.3 }),
        );
        assert!(to_key_spec_3(&mut brain));

        let topics = &brain.global_vector.topics;
        assert_eq!(topics.get("机器学习"), Some(&0.4));
        assert!(topics.contains_key("python"));
        assert!(!topics.contains_key("機器學習"));
        assert_eq!(brain.idf_word_frequency.get("机器学习"), Some(&7));
        assert_eq!(
            crate::flow_neuro::display_forms::label(&brain.display_forms, "机器学习"),
            "機器學習"
        );
        assert_eq!(brain.blocked_topics, HashSet::from(["新闻".to_string()]));
        assert!(!to_key_spec_3(&mut brain), "once");
    }

    #[test]
    fn a_japanese_viewer_keeps_their_kanji_keys() {
        let mut brain = spec_2_brain("ja", &serde_json::json!({ "宮崎駿": 0.4 }));
        to_key_spec_3(&mut brain);
        assert!(brain.global_vector.topics.contains_key("宮崎駿"));
    }

    #[test]
    fn converting_twice_changes_nothing() {
        let mut brain = legacy_brain();
        to_key_spec_2(&mut brain);
        let once = serde_json::to_value(&brain).unwrap();
        assert!(!to_key_spec_2(&mut brain));
        after_sync(&mut brain, &HashMap::new());
        after_sync(&mut brain, &HashMap::new());
        let mut again = serde_json::to_value(&brain).unwrap();
        // Picks gain their spelling on the first merge, as they do on Android's first load.
        again["display_forms"] = once["display_forms"].clone();
        assert_eq!(once, again);
    }

    #[test]
    fn titles_spell_a_converted_brain() {
        let mut brain = legacy_brain();
        to_key_spec_2(&mut brain);
        spell_from_titles(&mut brain, &["Restoring Vintage Guitars".to_string()]);
        let spec = brain.key_spec();
        assert_eq!(brain.display_forms["guitar"].form, "Guitars");
        assert_eq!(
            brain.display_forms[&spec.key_of("restoring")].form,
            "Restoring"
        );
    }

    #[test]
    fn a_peer_spelling_fills_a_gap_after_a_merge() {
        let spec = KeySpec::default();
        let keys = HashMap::from([("restoring".to_string(), 0.4), ("guitar".to_string(), 0.2)]);
        let spelled = spelled_before(&keys, &spec);
        assert_eq!(
            spelled.get(&spec.key_of("restoring")).map(String::as_str),
            Some("restoring")
        );
        assert!(!spelled.contains_key("guitar"));

        let mut brain = UserBrain::default();
        brain
            .global_vector
            .topics
            .insert(spec.key_of("restoring"), 0.4);
        after_sync(&mut brain, &spelled);
        assert_eq!(
            brain.display_forms[&spec.key_of("restoring")].form,
            "Restoring"
        );
    }
}
