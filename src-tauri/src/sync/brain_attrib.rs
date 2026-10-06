//! Folding this device's brain into the merged CRDT state without double counting.
//!
//! The engines keep plain counters and sets, and after every sync they hold the merged totals. So
//! the local scalar is "everyone's count plus what happened here since"; writing it straight into
//! this device's G-Counter entry adds every peer's count again on each sync. Instead, only growth
//! since the last merge (the [`NeuroBaseline`]/[`MusicBaseline`]) is credited to this device.
//! Likewise a plain set can't say "unblocked", so membership is diffed against the merged state to
//! mint OR-Set removes, and LWW values are stamped only when they actually changed.
//!
//! This device is the only writer of its own counter entries, so a peer's copy of them is ignored.
//! That is what lets the one-time [`legacy_own_count`] correction stick against a peer that still
//! holds the old inflated value.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::flow_neuro::scoring::UserBrain;
use crate::music_brain::model::MusicBrain;
use crate::sync::brainmap;
use crate::sync::canonical::{
    FlowNeuroBrainSnapshot, GCounter, Hlc, Lww, MusicBrainSnapshot, OrSet,
};
use crate::sync::merge::{MergedFlowNeuroBrain, MergedMusicBrain};

/// Settings key holding the FlowNeuro counters as they stood right after the last merge.
pub const NEURO_BASELINE_KEY: &str = "sync_neuro_baseline";
/// Settings key holding the music counters as they stood right after the last merge.
pub const MUSIC_BASELINE_KEY: &str = "sync_music_baseline";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NeuroBaseline {
    pub idf_total_documents: u64,
    pub total_interactions: u64,
    pub idf_word_frequency: BTreeMap<String, u64>,
}

impl NeuroBaseline {
    pub fn of(ub: &UserBrain) -> Self {
        Self {
            idf_total_documents: non_negative(ub.idf_total_documents),
            total_interactions: non_negative(ub.total_interactions),
            idf_word_frequency: ub
                .idf_word_frequency
                .iter()
                .map(|(w, &f)| (w.clone(), non_negative(f)))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MusicBaseline {
    pub total_plays: u64,
    pub artist_plays: BTreeMap<String, u64>,
}

impl MusicBaseline {
    pub fn of(mb: &MusicBrain) -> Self {
        Self {
            total_plays: u64::from(mb.total_plays),
            artist_plays: mb
                .artist_affinity
                .iter()
                .map(|(a, aff)| (a.clone(), u64::from(aff.plays)))
                .collect(),
        }
    }
}

/// How this device's counter entries are derived on this fold.
#[derive(Debug, Clone, Copy)]
pub enum Attribution<'a, B> {
    /// Credit growth since `baseline` on top of the merged own entry.
    Since(&'a B),
    /// No baseline yet: a build without this fix has synced `prior_applies` times, so the own
    /// entries are inflated and get recomputed once (see [`legacy_own_count`]).
    Legacy { prior_applies: u64 },
}

/// The attribution for a fold: since the stored baseline, else the one-time legacy correction.
pub fn attribution<B>(baseline: Option<&B>, prior_applies: u64) -> Attribution<'_, B> {
    match baseline {
        Some(b) => Attribution::Since(b),
        None => Attribution::Legacy { prior_applies },
    }
}

/// Estimate this device's own count from a pre-fix state. Every earlier apply wrote the merged
/// total back as the local value, adding the peers' counts to it again, so one copy of the peers'
/// counts is removed per apply. Exact when the peers' counts didn't change between syncs; errs low
/// (never below zero) when they grew.
pub fn legacy_own_count(local: u64, others: u64, prior_applies: u64) -> u64 {
    local.saturating_sub(others.saturating_mul(prior_applies))
}

fn own_count(
    counter: &GCounter,
    device_id: &str,
    local: u64,
    baseline: Option<u64>,
    prior_applies: Option<u64>,
) -> u64 {
    let own = counter.get(device_id);
    let others = counter.total().saturating_sub(own);
    match (baseline, prior_applies) {
        (Some(base), _) => own.saturating_add(local.saturating_sub(base)),
        (None, Some(applies)) if others > 0 => legacy_own_count(local, others, applies),
        _ => local,
    }
}

// ===========================================================================================
// FlowNeuro
// ===========================================================================================

/// Fold this device's current brain into `merged`, crediting only local growth to its counters.
pub fn fold_local_flow(
    merged: &mut MergedFlowNeuroBrain,
    ub: &UserBrain,
    device_id: &str,
    hlc: Hlc,
    attribution: Attribution<'_, NeuroBaseline>,
) {
    let mut snap = brainmap::userbrain_to_snapshot(ub, device_id, hlc.clone());
    let (baseline, applies) = split(attribution);

    let docs = own_count(
        &merged.counters.idf_total_documents,
        device_id,
        non_negative(ub.idf_total_documents),
        baseline.map(|b| b.idf_total_documents),
        applies,
    );
    let interactions = own_count(
        &merged.counters.total_interactions,
        device_id,
        non_negative(ub.total_interactions),
        baseline.map(|b| b.total_interactions),
        applies,
    );
    merged.counters.idf_total_documents.set(device_id, docs);
    merged
        .counters
        .total_interactions
        .set(device_id, interactions);
    snap.counters.idf_total_documents = GCounter::single(device_id, docs);
    snap.counters.total_interactions = GCounter::single(device_id, interactions);

    for (word, &freq) in &ub.idf_word_frequency {
        let counter = merged.idf_word_frequency.entry(word.clone()).or_default();
        let own = own_count(
            counter,
            device_id,
            non_negative(freq),
            baseline.map(|b| b.idf_word_frequency.get(word).copied().unwrap_or(0)),
            applies,
        );
        counter.set(device_id, own);
        snap.idf_word_frequency
            .insert(word.clone(), GCounter::single(device_id, own));
    }

    snap.sets.blocked_topics = diff_set(&ub.blocked_topics, &merged.sets.blocked_topics, &hlc);
    snap.sets.blocked_channels =
        diff_set(&ub.blocked_channels, &merged.sets.blocked_channels, &hlc);
    snap.sets.preferred_topics =
        diff_set(&ub.preferred_topics, &merged.sets.preferred_topics, &hlc);

    let m = &merged.lww_maps;
    retain_changed(
        &mut snap.lww_maps.suppressed_video_ids,
        &m.suppressed_video_ids,
    );
    retain_changed(
        &mut snap.lww_maps.suppressed_channels,
        &m.suppressed_channels,
    );
    retain_changed(&mut snap.lww_maps.rejection_patterns, &m.rejection_patterns);
    retain_changed(&mut snap.lww_maps.topic_evidence, &m.topic_evidence);
    retain_changed(&mut snap.lww_maps.feed_history, &m.feed_history);
    retain_changed(&mut snap.lww_maps.channel_strikes, &m.channel_strikes);

    merged.merge_snapshot(&snap);
}

/// Merge peer snapshots, keeping this device's own counter entries as they are.
pub fn merge_incoming_flow(
    merged: &mut MergedFlowNeuroBrain,
    incoming: &[FlowNeuroBrainSnapshot],
    device_id: &str,
) {
    let docs = merged.counters.idf_total_documents.get(device_id);
    let interactions = merged.counters.total_interactions.get(device_id);
    let words: BTreeMap<String, u64> = merged
        .idf_word_frequency
        .iter()
        .map(|(w, c)| (w.clone(), c.get(device_id)))
        .collect();

    for snap in incoming {
        merged.merge_snapshot(snap);
    }

    merged.counters.idf_total_documents.set(device_id, docs);
    merged
        .counters
        .total_interactions
        .set(device_id, interactions);
    for (word, counter) in &mut merged.idf_word_frequency {
        restore_own(counter, device_id, words.get(word).copied());
    }
}

// ===========================================================================================
// Music
// ===========================================================================================

/// Fold this device's current music brain into `merged`, crediting only local growth to its
/// counters and stamping only the LWW values that changed.
pub fn fold_local_music(
    merged: &mut MergedMusicBrain,
    mb: &MusicBrain,
    device_id: &str,
    hlc: Hlc,
    attribution: Attribution<'_, MusicBaseline>,
) {
    let mut snap = brainmap::musicbrain_to_snapshot(mb, device_id, hlc.clone());
    let (baseline, applies) = split(attribution);

    let total = own_count(
        &merged.total_plays,
        device_id,
        u64::from(mb.total_plays),
        baseline.map(|b| b.total_plays),
        applies,
    );
    merged.total_plays.set(device_id, total);
    snap.total_plays = GCounter::single(device_id, total);

    for (artist, aff) in &mut snap.artist_affinity {
        let local = mb
            .artist_affinity
            .get(artist)
            .map_or(0, |a| u64::from(a.plays));
        let synced = merged.artist_affinity.get_mut(artist);
        let own = match &synced {
            Some(s) => own_count(
                &s.plays,
                device_id,
                local,
                baseline.map(|b| b.artist_plays.get(artist).copied().unwrap_or(0)),
                applies,
            ),
            None => local,
        };
        aff.plays = GCounter::single(device_id, own);
        if let Some(s) = synced {
            s.plays.set(device_id, own);
            if s.score == aff.score {
                aff.hlc = s.hlc.clone();
            }
        }
    }

    snap.seen_artists = diff_set(&mb.seen_artists, &merged.seen_artists, &hlc);
    snap.blocked_artists = diff_set(&mb.blocked_artists, &merged.blocked_artists, &hlc);
    retain_changed(&mut snap.disliked_artists, &merged.disliked_artists);
    if merged
        .discovery_appetite
        .as_ref()
        .is_some_and(|a| a.value == mb.discovery_appetite)
    {
        snap.discovery_appetite = None;
    }

    merged.merge_snapshot(&snap);
}

/// Merge peer snapshots, keeping this device's own counter entries as they are.
pub fn merge_incoming_music(
    merged: &mut MergedMusicBrain,
    incoming: &[MusicBrainSnapshot],
    device_id: &str,
) {
    let total = merged.total_plays.get(device_id);
    let artists: BTreeMap<String, u64> = merged
        .artist_affinity
        .iter()
        .map(|(a, aff)| (a.clone(), aff.plays.get(device_id)))
        .collect();

    for snap in incoming {
        merged.merge_snapshot(snap);
    }

    merged.total_plays.set(device_id, total);
    for (artist, aff) in &mut merged.artist_affinity {
        restore_own(&mut aff.plays, device_id, artists.get(artist).copied());
    }
}

// ===========================================================================================
// Helpers
// ===========================================================================================

fn split<B>(attribution: Attribution<'_, B>) -> (Option<&B>, Option<u64>) {
    match attribution {
        Attribution::Since(b) => (Some(b), None),
        Attribution::Legacy { prior_applies } => (None, Some(prior_applies)),
    }
}

fn restore_own(counter: &mut GCounter, device_id: &str, own: Option<u64>) {
    match own {
        Some(v) => counter.set(device_id, v),
        None => {
            counter.0.remove(device_id);
        }
    }
}

/// OR-Set edits since the last merge: members that appeared get an add, members that vanished get
/// a remove. Members unchanged since the merge are left out, so their existing stamps stand.
fn diff_set(current: &HashSet<String>, synced: &OrSet, hlc: &Hlc) -> OrSet {
    let known: BTreeSet<String> = synced.members().into_iter().collect();
    let mut out = OrSet::default();
    for member in current.iter().filter(|m| !known.contains(*m)) {
        out.add(member.clone(), hlc.clone());
    }
    for member in known.iter().filter(|m| !current.contains(*m)) {
        out.remove(member.clone(), hlc.clone());
    }
    out
}

/// Keep only the entries whose value differs from the merged state, so an unchanged value keeps
/// its original stamp instead of beating every peer's edit with a fresh one.
fn retain_changed<T: PartialEq>(
    fresh: &mut BTreeMap<String, Lww<T>>,
    synced: &BTreeMap<String, Lww<T>>,
) {
    fresh.retain(|k, v| synced.get(k).is_none_or(|s| s.value != v.value));
}

fn non_negative(v: i32) -> u64 {
    u64::try_from(v).unwrap_or(0)
}
