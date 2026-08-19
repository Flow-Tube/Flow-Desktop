//! Converters between the engine's native brain structs and the canonical sync snapshots.
//!
//! FlowNeuro (`flow_neuro::scoring::UserBrain`) and Music (`music_brain::model::MusicBrain`) are
//! the engines' in-memory/persisted state. For sync we:
//!  * project the local brain into a per-device canonical **snapshot** (counters become
//!    single-device G-Counters, sets become OR-Sets stamped with the given HLC, etc.), and
//!  * derive an **effective** brain back from the merged CRDT state (`MergedFlowNeuroBrain` /
//!    `MergedMusicBrain`), preserving the local device's non-synced/derived fields from a `base`.
//!
//! Device-local/derived fields that are intentionally NOT synced (and are taken from `base` when
//! reconstructing): `consecutive_skips`, `last_persona`, `persona_stability`,
//! `recent_query_tokens`, `last_rotation_decay`, and per-`ContentVector` `topic_confidence` /
//! `anchor_topics`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::flow_neuro::scoring::{
    ChannelStrike, ContentVector, FeedEntry, RejectionSignal, TimeBucket, TopicEvidence, UserBrain,
};
use crate::music_brain::model::{Affinity, MusicBrain, TrackMeta};
use crate::sync::canonical::{
    AffinityWire, BrainCounters, BrainFlags, BrainLwwMaps, BrainPerVideo, BrainSets, BrainVectors,
    ChannelStrikeWire, ContentVectorWire, FeedEntryWire, FlowNeuroBrainSnapshot, GCounter, Hlc,
    Lww, MusicBrainSnapshot, OrSet, RejectionSignalWire, TopicEvidenceWire, TrackMetaWire,
};
use crate::sync::merge::DeviceVectors;
use crate::sync::merge::{MergedFlowNeuroBrain, MergedMusicBrain};

// ---- small generic helpers -------------------------------------------------------------------

fn to_btree_f64(m: &HashMap<String, f64>) -> BTreeMap<String, f64> {
    m.iter().map(|(k, v)| (k.clone(), *v)).collect()
}
fn to_hash_f64(m: &BTreeMap<String, f64>) -> HashMap<String, f64> {
    m.iter().map(|(k, v)| (k.clone(), *v)).collect()
}
fn to_btree_f32(m: &HashMap<String, f32>) -> BTreeMap<String, f32> {
    m.iter().map(|(k, v)| (k.clone(), *v)).collect()
}
fn to_hash_f32(m: &BTreeMap<String, f32>) -> HashMap<String, f32> {
    m.iter().map(|(k, v)| (k.clone(), *v)).collect()
}

fn bucket_to_string(b: &TimeBucket) -> String {
    serde_json::to_value(b)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}
fn string_to_bucket(s: &str) -> Option<TimeBucket> {
    if let Ok(bucket) = serde_json::from_value(serde_json::Value::String(s.to_string())) {
        return Some(bucket);
    }
    let normalized: String = s
        .chars()
        .filter(|c| *c != '_')
        .flat_map(char::to_lowercase)
        .collect();
    match normalized.as_str() {
        "weekdaymorning" => Some(TimeBucket::WeekdayMorning),
        "weekdayafternoon" => Some(TimeBucket::WeekdayAfternoon),
        "weekdayevening" => Some(TimeBucket::WeekdayEvening),
        "weekdaynight" => Some(TimeBucket::WeekdayNight),
        "weekendmorning" => Some(TimeBucket::WeekendMorning),
        "weekendafternoon" => Some(TimeBucket::WeekendAfternoon),
        "weekendevening" => Some(TimeBucket::WeekendEvening),
        "weekendnight" => Some(TimeBucket::WeekendNight),
        _ => None,
    }
}

#[must_use]
pub fn canonical_bucket_key(key: &str) -> Option<String> {
    string_to_bucket(key).map(|bucket| bucket_to_string(&bucket))
}

// ---- ContentVector ⇄ ContentVectorWire -------------------------------------------------------

fn cv_to_wire(cv: &ContentVector) -> ContentVectorWire {
    let mut dims = BTreeMap::new();
    dims.insert("duration".to_string(), cv.duration);
    dims.insert("pacing".to_string(), cv.pacing);
    dims.insert("complexity".to_string(), cv.complexity);
    dims.insert("isLive".to_string(), cv.is_live);
    ContentVectorWire {
        topics: to_btree_f64(&cv.topics),
        dims,
    }
}

fn wire_to_cv(w: &ContentVectorWire, base: &ContentVector) -> ContentVector {
    let dim = |k: &str, d: f64| w.dims.get(k).copied().unwrap_or(d);
    ContentVector {
        topics: to_hash_f64(&w.topics),
        // derived signals are recomputed locally; keep whatever the base had.
        topic_confidence: base.topic_confidence.clone(),
        anchor_topics: base.anchor_topics.clone(),
        duration: dim("duration", base.duration),
        pacing: dim("pacing", base.pacing),
        complexity: dim("complexity", base.complexity),
        is_live: dim("isLive", base.is_live),
    }
}

// ===========================================================================================
// FlowNeuro
// ===========================================================================================

/// Project the local `UserBrain` into this device's canonical snapshot, stamped with `hlc`.
pub fn userbrain_to_snapshot(ub: &UserBrain, device_id: &str, hlc: Hlc) -> FlowNeuroBrainSnapshot {
    let or_set = |items: &HashSet<String>| {
        let mut s = OrSet::default();
        for k in items {
            s.add(k.clone(), hlc.clone());
        }
        s
    };

    let idf_word_frequency = ub
        .idf_word_frequency
        .iter()
        .map(|(w, &f)| (w.clone(), GCounter::single(device_id, f.max(0) as u64)))
        .collect();

    let time_vectors = ub
        .time_vectors
        .iter()
        .map(|(b, cv)| (bucket_to_string(b), cv_to_wire(cv)))
        .collect();
    let channel_topic_profiles = ub
        .channel_topic_profiles
        .iter()
        .map(|(c, m)| (c.clone(), to_btree_f64(m)))
        .collect();

    let lww = |hlc: &Hlc| hlc.clone();
    let suppressed_video_ids = ub
        .suppressed_video_ids
        .iter()
        .map(|(k, &v)| (k.clone(), Lww::new(v, lww(&hlc))))
        .collect();
    let suppressed_channels = ub
        .suppressed_channels
        .iter()
        .map(|(k, &v)| (k.clone(), Lww::new(v, lww(&hlc))))
        .collect();
    let rejection_patterns = ub
        .rejection_patterns
        .iter()
        .map(|(k, r)| {
            (
                k.clone(),
                Lww::new(
                    RejectionSignalWire {
                        count: r.count,
                        last_rejected_at: r.last_rejected_at,
                    },
                    lww(&hlc),
                ),
            )
        })
        .collect();
    let channel_strikes = ub
        .channel_strikes
        .iter()
        .map(|(k, s)| {
            (
                k.clone(),
                Lww::new(
                    ChannelStrikeWire {
                        count: s.count,
                        first_at: s.first_at,
                        last_at: s.last_at,
                    },
                    lww(&hlc),
                ),
            )
        })
        .collect();
    let feed_history = ub
        .feed_history
        .iter()
        .map(|(k, f)| {
            (
                k.clone(),
                Lww::new(
                    FeedEntryWire {
                        last_shown: f.last_shown,
                        show_count: f.show_count,
                    },
                    lww(&hlc),
                ),
            )
        })
        .collect();
    let topic_evidence = ub
        .topic_evidence
        .iter()
        .map(|(k, e)| {
            (
                k.clone(),
                Lww::new(
                    TopicEvidenceWire {
                        positive_signals: e.positive_signals,
                        negative_signals: e.negative_signals,
                        watch_signals: e.watch_signals,
                        explicit_signals: e.explicit_signals,
                        positive_score: e.positive_score,
                        video_ids: e.video_ids.iter().cloned().collect::<BTreeSet<_>>(),
                        channel_ids: e.channel_ids.iter().cloned().collect::<BTreeSet<_>>(),
                        first_seen_at: e.first_seen_at,
                        last_seen_at: e.last_seen_at,
                    },
                    lww(&hlc),
                ),
            )
        })
        .collect();

    FlowNeuroBrainSnapshot {
        schema: ub.schema_version,
        device_id: device_id.to_string(),
        hlc: hlc.clone(),
        vectors: BrainVectors {
            global_vector: cv_to_wire(&ub.global_vector),
            time_vectors,
            shorts_vector: None,
            topic_affinities: to_btree_f64(&ub.topic_affinities),
            channel_scores: to_btree_f64(&ub.channel_scores),
            channel_topic_profiles,
        },
        counters: BrainCounters {
            idf_total_documents: GCounter::single(device_id, ub.idf_total_documents.max(0) as u64),
            total_interactions: GCounter::single(device_id, ub.total_interactions.max(0) as u64),
        },
        idf_word_frequency,
        per_video: BrainPerVideo {
            watch_history_map: to_btree_f32(&ub.watch_history_map),
            watch_signal_progress: to_btree_f32(&ub.watch_signal_progress),
        },
        sets: BrainSets {
            blocked_topics: or_set(&ub.blocked_topics),
            blocked_channels: or_set(&ub.blocked_channels),
            preferred_topics: or_set(&ub.preferred_topics),
        },
        lww_maps: BrainLwwMaps {
            suppressed_video_ids,
            suppressed_channels,
            rejection_patterns,
            topic_evidence,
            feed_history,
            channel_strikes,
        },
        flags: BrainFlags {
            has_completed_onboarding: ub.has_completed_onboarding,
        },
    }
}

/// Derive the effective `UserBrain` for the engine from the merged CRDT state, preserving the
/// local device's non-synced fields from `base`.
pub fn merged_flow_to_userbrain(m: &MergedFlowNeuroBrain, base: &UserBrain) -> UserBrain {
    let ev = m.effective_vectors();

    let time_vectors = ev
        .time_vectors
        .iter()
        .filter_map(|(s, w)| {
            string_to_bucket(s).map(|bucket| {
                let base_cv = base.time_vectors.get(&bucket).cloned().unwrap_or_default();
                (bucket, wire_to_cv(w, &base_cv))
            })
        })
        .collect();
    let channel_topic_profiles = ev
        .channel_topic_profiles
        .iter()
        .map(|(c, mm)| (c.clone(), to_hash_f64(mm)))
        .collect();

    let set_to_hash = |s: &OrSet| s.members().into_iter().collect::<HashSet<_>>();

    UserBrain {
        time_vectors,
        global_vector: wire_to_cv(&ev.global_vector, &base.global_vector),
        channel_scores: to_hash_f64(&ev.channel_scores),
        topic_affinities: to_hash_f64(&ev.topic_affinities),
        total_interactions: m.counters.total_interactions.total() as i32,
        consecutive_skips: base.consecutive_skips,
        blocked_topics: set_to_hash(&m.sets.blocked_topics),
        blocked_channels: set_to_hash(&m.sets.blocked_channels),
        preferred_topics: set_to_hash(&m.sets.preferred_topics),
        has_completed_onboarding: m.flags.has_completed_onboarding || base.has_completed_onboarding,
        last_persona: base.last_persona.clone(),
        persona_stability: base.persona_stability,
        idf_word_frequency: m
            .idf_word_frequency
            .iter()
            .map(|(w, gc)| (w.clone(), gc.total() as i32))
            .collect(),
        idf_total_documents: m.counters.idf_total_documents.total() as i32,
        watch_signal_progress: to_hash_f32(&m.per_video.watch_signal_progress),
        watch_history_map: to_hash_f32(&m.per_video.watch_history_map),
        channel_topic_profiles,
        suppressed_video_ids: m
            .lww_maps
            .suppressed_video_ids
            .iter()
            .map(|(k, v)| (k.clone(), v.value))
            .collect(),
        suppressed_channels: m
            .lww_maps
            .suppressed_channels
            .iter()
            .map(|(k, v)| (k.clone(), v.value))
            .collect(),
        channel_strikes: m
            .lww_maps
            .channel_strikes
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    ChannelStrike {
                        count: v.value.count,
                        first_at: v.value.first_at,
                        last_at: v.value.last_at,
                    },
                )
            })
            .collect(),
        rejection_patterns: m
            .lww_maps
            .rejection_patterns
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    RejectionSignal {
                        count: v.value.count,
                        last_rejected_at: v.value.last_rejected_at,
                    },
                )
            })
            .collect(),
        feed_history: m
            .lww_maps
            .feed_history
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    FeedEntry {
                        last_shown: v.value.last_shown,
                        show_count: v.value.show_count,
                    },
                )
            })
            .collect(),
        recent_query_tokens: base.recent_query_tokens.clone(),
        topic_evidence: m
            .lww_maps
            .topic_evidence
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    TopicEvidence {
                        positive_signals: v.value.positive_signals,
                        negative_signals: v.value.negative_signals,
                        watch_signals: v.value.watch_signals,
                        explicit_signals: v.value.explicit_signals,
                        positive_score: v.value.positive_score,
                        video_ids: v.value.video_ids.iter().cloned().collect::<HashSet<_>>(),
                        channel_ids: v.value.channel_ids.iter().cloned().collect::<HashSet<_>>(),
                        first_seen_at: v.value.first_seen_at,
                        last_seen_at: v.value.last_seen_at,
                    },
                )
            })
            .collect(),
        schema_version: m.schema.max(base.schema_version),
    }
}

/// Decompose the merged FlowNeuro CRDT state back into the per-device snapshots that produced it,
/// so a sender can ship the *whole* converged brain (its own contribution **plus** anything it
/// previously learned from other devices) and a 3rd device converges transitively.
///
/// One snapshot is emitted per device that has a vector contribution. The shared, device-agnostic
/// CRDT fields (counters, idf words, per-video maps, sets, LWW-maps, flags) are carried in full on
/// the **first** snapshot only — folding them once is enough because every merge is idempotent —
/// while each remaining snapshot carries just that device's learned vectors plus its own
/// experience weight (so the receiver's effective-vector blend keeps the right per-device weight).
pub fn merged_flow_to_snapshots(m: &MergedFlowNeuroBrain) -> Vec<FlowNeuroBrainSnapshot> {
    let mut out = Vec::with_capacity(m.device_vectors.len());
    for (i, (device_id, dv)) in m.device_vectors.iter().enumerate() {
        let snap = if i == 0 {
            FlowNeuroBrainSnapshot {
                schema: m.schema,
                device_id: device_id.clone(),
                hlc: dv.hlc.clone(),
                vectors: dv.vectors.clone(),
                counters: m.counters.clone(),
                idf_word_frequency: m.idf_word_frequency.clone(),
                per_video: m.per_video.clone(),
                sets: m.sets.clone(),
                lww_maps: m.lww_maps.clone(),
                flags: m.flags.clone(),
            }
        } else {
            FlowNeuroBrainSnapshot {
                schema: m.schema,
                device_id: device_id.clone(),
                hlc: dv.hlc.clone(),
                vectors: dv.vectors.clone(),
                // Carry just this device's experience weight so the blend keeps its weighting.
                counters: BrainCounters {
                    idf_total_documents: GCounter::single(device_id, weight_of(dv)),
                    total_interactions: GCounter::default(),
                },
                ..Default::default()
            }
        };
        out.push(snap);
    }
    out
}

fn weight_of(dv: &DeviceVectors) -> u64 {
    dv.weight.max(1)
}

// ===========================================================================================
// Music
// ===========================================================================================

pub fn musicbrain_to_snapshot(mb: &MusicBrain, device_id: &str, hlc: Hlc) -> MusicBrainSnapshot {
    let mut seen_artists = OrSet::default();
    for a in &mb.seen_artists {
        seen_artists.add(a.clone(), hlc.clone());
    }
    let mut blocked_artists = OrSet::default();
    for a in &mb.blocked_artists {
        blocked_artists.add(a.clone(), hlc.clone());
    }

    let artist_affinity = mb
        .artist_affinity
        .iter()
        .map(|(a, aff)| {
            (
                a.clone(),
                AffinityWire {
                    plays: GCounter::single(device_id, u64::from(aff.plays)),
                    score: aff.score,
                    last_played: aff.last_played,
                    liked: aff.liked,
                    hlc: hlc.clone(),
                },
            )
        })
        .collect();
    let time_buckets = mb
        .time_buckets
        .iter()
        .map(|(b, m)| (bucket_to_string(b), to_btree_f64(m)))
        .collect();
    let track_meta = mb
        .track_meta
        .iter()
        .map(|(t, meta)| {
            (
                t.clone(),
                TrackMetaWire {
                    title: meta.title.clone(),
                    artist: meta.artist.clone(),
                    artist_key: meta.artist_key.clone(),
                    thumbnail: meta.thumbnail.clone(),
                },
            )
        })
        .collect();
    let disliked_artists = mb
        .disliked_artists
        .iter()
        .map(|(a, &ts)| (a.clone(), Lww::new(ts, hlc.clone())))
        .collect();

    MusicBrainSnapshot {
        schema: mb.schema_version,
        device_id: device_id.to_string(),
        hlc: hlc.clone(),
        artist_affinity,
        genre_affinity: to_btree_f64(&mb.genre_affinity),
        artist_cooc: to_btree_f64(&mb.artist_cooc),
        recent_rotation: to_btree_f64(&mb.recent_rotation),
        time_buckets,
        track_plays: mb
            .track_plays
            .iter()
            .map(|(t, v)| (t.clone(), v.clone()))
            .collect(),
        track_meta,
        total_plays: GCounter::single(device_id, u64::from(mb.total_plays)),
        seen_artists,
        blocked_artists,
        disliked_artists,
        discovery_appetite: Some(Lww::new(mb.discovery_appetite, hlc)),
    }
}

/// Project the merged Music CRDT state into a single snapshot for sending. Unlike the FlowNeuro
/// brain, the music brain keeps no per-device vector blend — every field is already a CRDT
/// (G-Counters carry per-device sub-counts, scalar maps are max-registers, sets are OR-Sets), so
/// one snapshot carrying the full merged state converges idempotently on the receiver. `device_id`
/// is only a provenance label here (music merge does not weight by it).
pub fn merged_music_to_snapshot(
    m: &MergedMusicBrain,
    device_id: &str,
    hlc: Hlc,
) -> MusicBrainSnapshot {
    MusicBrainSnapshot {
        schema: m.schema,
        device_id: device_id.to_string(),
        hlc,
        artist_affinity: m.artist_affinity.clone(),
        genre_affinity: m.genre_affinity.clone(),
        artist_cooc: m.artist_cooc.clone(),
        recent_rotation: m.recent_rotation.clone(),
        time_buckets: m.time_buckets.clone(),
        track_plays: m.track_plays.clone(),
        track_meta: m.track_meta.clone(),
        total_plays: m.total_plays.clone(),
        seen_artists: m.seen_artists.clone(),
        blocked_artists: m.blocked_artists.clone(),
        disliked_artists: m.disliked_artists.clone(),
        discovery_appetite: m.discovery_appetite.clone(),
    }
}

pub fn merged_music_to_musicbrain(m: &MergedMusicBrain, base: &MusicBrain) -> MusicBrain {
    let time_buckets = m
        .time_buckets
        .iter()
        .filter_map(|(s, mm)| string_to_bucket(s).map(|b| (b, to_hash_f64(mm))))
        .collect();
    let artist_affinity = m
        .artist_affinity
        .iter()
        .map(|(a, aw)| {
            (
                a.clone(),
                Affinity {
                    plays: aw.plays.total().min(u64::from(u32::MAX)) as u32,
                    score: aw.score,
                    last_played: aw.last_played,
                    liked: aw.liked,
                },
            )
        })
        .collect();
    let track_meta = m
        .track_meta
        .iter()
        .map(|(t, w)| {
            (
                t.clone(),
                TrackMeta {
                    title: w.title.clone(),
                    artist: w.artist.clone(),
                    artist_key: w.artist_key.clone(),
                    thumbnail: w.thumbnail.clone(),
                },
            )
        })
        .collect();

    MusicBrain {
        artist_affinity,
        genre_affinity: to_hash_f64(&m.genre_affinity),
        track_plays: m
            .track_plays
            .iter()
            .map(|(t, v)| (t.clone(), v.clone()))
            .collect(),
        track_meta,
        recent_rotation: to_hash_f64(&m.recent_rotation),
        artist_cooc: to_hash_f64(&m.artist_cooc),
        time_buckets,
        seen_artists: m.seen_artists.members().into_iter().collect::<HashSet<_>>(),
        disliked_artists: m
            .disliked_artists
            .iter()
            .map(|(a, v)| (a.clone(), v.value))
            .collect(),
        blocked_artists: m
            .blocked_artists
            .members()
            .into_iter()
            .collect::<HashSet<_>>(),
        discovery_appetite: m
            .discovery_appetite
            .as_ref()
            .map(|l| l.value)
            .unwrap_or(base.discovery_appetite),
        total_plays: m.total_plays.total().min(u64::from(u32::MAX)) as u32,
        last_rotation_decay: base.last_rotation_decay,
        schema_version: m.schema.max(base.schema_version),
    }
}
