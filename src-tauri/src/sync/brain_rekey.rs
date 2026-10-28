//! Topic keys read again by this brain's key spec (Android `BrainKeyRekey`). A peer on an older
//! spec, or the merged state from before it, holds other spellings of the same keys ("guitars" for
//! "guitar"). Spellings that meet merge as their field merges on the wire: vectors and links by
//! max, document-frequency sub-counts by sum within one device (two spellings were two counts of
//! one word; across devices G-Counters still take the max), registers by the newer stamp. Keys
//! already read stay as they are, so this can run on every snapshot. Pairs and links an older
//! desktop wrote (`leg_day`, `a:b`) read as the pairs and links they were.

use std::collections::{BTreeMap, HashMap};

use crate::flow_neuro::key_migration::{link_ends, respelled, to_key_spec_2, to_key_spec_3};
use crate::flow_neuro::keyspec::{self, KeySpec};
use crate::flow_neuro::language::system_language;
use crate::flow_neuro::scoring::UserBrain;
use crate::flow_neuro::signals::make_affinity_key;
use crate::sync::brain_attrib::NeuroBaseline;
use crate::sync::canonical::{
    BrainVectors, ContentVectorWire, FlowNeuroBrainSnapshot, GCounter, Lww,
};
use crate::sync::merge::MergedFlowNeuroBrain;

/// Reads the local brain, the merged state and the baseline by one key spec before they meet: the
/// stored brain converts to the current key spec if no load has converted it yet, and the merged state and
/// the baseline are read again when they were written in another spec or key language. Returns the
/// reader for the peer's snapshots.
pub fn align_flow(
    base: Option<&mut UserBrain>,
    merged: &mut MergedFlowNeuroBrain,
    baseline: Option<&mut NeuroBaseline>,
) -> KeyReader {
    let spec = if let Some(brain) = base {
        brain.settle_languages(&system_language());
        to_key_spec_2(brain);
        to_key_spec_3(brain);
        brain.key_spec()
    } else {
        let language = system_language();
        KeySpec::new(&language, &language)
    };
    let mut reader = KeyReader::new(spec);
    reader.align_merged(merged);
    if let Some(baseline) = baseline {
        reader.align_baseline(baseline);
    }
    reader
}

/// How one brain reads stored keys, remembering each reading.
pub struct KeyReader {
    spec: KeySpec,
    cache: HashMap<String, Vec<String>>,
}

impl KeyReader {
    #[must_use]
    pub fn new(spec: KeySpec) -> Self {
        Self {
            spec,
            cache: HashMap::new(),
        }
    }

    #[must_use]
    pub fn spec(&self) -> &KeySpec {
        &self.spec
    }

    fn keys_for(&mut self, key: &str) -> Vec<String> {
        if let Some(keys) = self.cache.get(key) {
            return keys.clone();
        }
        let keys = self.spec.rekey(&respelled(key));
        self.cache.insert(key.to_string(), keys.clone());
        keys
    }

    fn merged<V: Clone>(
        &mut self,
        map: &BTreeMap<String, V>,
        merge: impl Fn(&V, &V) -> V,
    ) -> BTreeMap<String, V> {
        let mut out: BTreeMap<String, V> = BTreeMap::new();
        for (key, value) in map {
            for read in self.keys_for(key) {
                let next = match out.get(&read) {
                    Some(existing) => merge(existing, value),
                    None => value.clone(),
                };
                out.insert(read, next);
            }
        }
        out
    }

    fn counters(&mut self, counters: &BTreeMap<String, GCounter>) -> BTreeMap<String, GCounter> {
        self.merged(counters, |a, b| {
            let mut sum = a.clone();
            for (device, count) in &b.0 {
                sum.set(device, sum.get(device).saturating_add(*count));
            }
            sum
        })
    }

    fn registers<T: Clone>(
        &mut self,
        registers: &BTreeMap<String, Lww<T>>,
    ) -> BTreeMap<String, Lww<T>> {
        self.merged(
            registers,
            |a, b| if b.hlc > a.hlc { b.clone() } else { a.clone() },
        )
    }

    fn vector(&mut self, vector: &ContentVectorWire) -> ContentVectorWire {
        ContentVectorWire {
            topics: self.merged(&vector.topics, |a, b| a.max(*b)),
            dims: vector.dims.clone(),
        }
    }

    /// A pair read end by end; it goes when an end splits, vanishes or meets the other.
    fn pair(&mut self, left: &str, right: &str) -> Option<String> {
        let left = only(self.keys_for(left))?;
        let right = only(self.keys_for(right))?;
        (left != right).then(|| make_affinity_key(&left, &right))
    }

    fn edges(&mut self, edges: &BTreeMap<String, f64>) -> BTreeMap<String, f64> {
        let mut out: BTreeMap<String, f64> = BTreeMap::new();
        for (key, &weight) in edges {
            let Some(edge) = link_ends(key).and_then(|(left, right)| self.pair(left, right)) else {
                continue;
            };
            let entry = out.entry(edge).or_insert(weight);
            *entry = entry.max(weight);
        }
        out
    }

    /// Rejection patterns, a rejected pair ("a|b") kept a pair. Android's `BrainKeyRekey` reads a
    /// pair as two words, which would turn one rejected pairing into two rejected topics.
    fn rejections<T: Clone>(
        &mut self,
        registers: &BTreeMap<String, Lww<T>>,
    ) -> BTreeMap<String, Lww<T>> {
        let mut out: BTreeMap<String, Lww<T>> = BTreeMap::new();
        for (key, register) in registers {
            let reads = match key.split_once('|') {
                Some((left, right)) => self.pair(left, right).into_iter().collect(),
                None => self.keys_for(key),
            };
            for read in reads {
                match out.get(&read) {
                    Some(existing) if existing.hlc >= register.hlc => {}
                    _ => {
                        out.insert(read, register.clone());
                    }
                }
            }
        }
        out
    }

    fn vectors(&mut self, vectors: &BrainVectors) -> BrainVectors {
        BrainVectors {
            global_vector: self.vector(&vectors.global_vector),
            time_vectors: vectors
                .time_vectors
                .iter()
                .map(|(bucket, vector)| (bucket.clone(), self.vector(vector)))
                .collect(),
            shorts_vector: vectors
                .shorts_vector
                .as_ref()
                .map(|vector| self.vector(vector)),
            topic_affinities: self.edges(&vectors.topic_affinities),
            channel_scores: vectors.channel_scores.clone(),
            channel_topic_profiles: vectors
                .channel_topic_profiles
                .iter()
                .map(|(channel, profile)| (channel.clone(), self.merged(profile, |a, b| a.max(*b))))
                .collect(),
        }
    }

    /// A peer's snapshot, its keys read the way this brain reads them.
    #[must_use]
    pub fn snapshot(&mut self, snap: &FlowNeuroBrainSnapshot) -> FlowNeuroBrainSnapshot {
        let mut read = snap.clone();
        read.vectors = self.vectors(&snap.vectors);
        read.idf_word_frequency = self.counters(&snap.idf_word_frequency);
        read.lww_maps.rejection_patterns = self.rejections(&snap.lww_maps.rejection_patterns);
        read.lww_maps.topic_evidence = self.registers(&snap.lww_maps.topic_evidence);
        read
    }

    /// The merged state in this brain's key spec and key language, read again only when it was
    /// written in another.
    pub fn align_merged(&mut self, merged: &mut MergedFlowNeuroBrain) {
        if self.is_current(merged.key_spec, &merged.key_language) {
            return;
        }
        merged.idf_word_frequency = self.counters(&merged.idf_word_frequency);
        for device in merged.device_vectors.values_mut() {
            device.vectors = self.vectors(&device.vectors);
        }
        merged.lww_maps.rejection_patterns = self.rejections(&merged.lww_maps.rejection_patterns);
        merged.lww_maps.topic_evidence = self.registers(&merged.lww_maps.topic_evidence);
        merged.key_spec = keyspec::VERSION;
        merged.key_language.clone_from(&self.spec.key_language);
    }

    /// The counts of the last merge in this brain's key spec, summed where spellings meet, so
    /// local growth since then is measured against the same keys.
    pub fn align_baseline(&mut self, baseline: &mut NeuroBaseline) {
        if self.is_current(baseline.key_spec, &baseline.key_language) {
            return;
        }
        baseline.idf_word_frequency =
            self.merged(&baseline.idf_word_frequency, |a, b| a.saturating_add(*b));
        baseline.key_spec = keyspec::VERSION;
        baseline.key_language.clone_from(&self.spec.key_language);
    }

    fn is_current(&self, key_spec: u32, key_language: &str) -> bool {
        key_spec == keyspec::VERSION && key_language == self.spec.key_language
    }
}

fn only(keys: Vec<String>) -> Option<String> {
    let mut keys = keys.into_iter();
    match (keys.next(), keys.next()) {
        (Some(key), None) => Some(key),
        _ => None,
    }
}
