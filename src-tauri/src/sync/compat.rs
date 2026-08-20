//! Tolerant `Deserialize` impls for the canonical wire model.
//!
//! [`crate::sync::canonical`] defines what this build **emits** — the shapes fixed by `FLOW-SYNC/1`
//! (`notes/sync/sync_wire_format_addendum.md` §6.5). What we **accept** has to be wider, because
//! Flow for Android through v2.2.0 ships the `FlowNeuro` brain in a flatter envelope and those builds
//! are already on users' phones. Every impl here still accepts the canonical shape unchanged and
//! additionally understands the Android one. Serialization is untouched, so nothing in this module
//! can change the bytes we put on the wire or the payload hashes computed over them.
//!
//! What Android (`sync/canonical/Canonical.kt`, `sync/mapping/BrainMapper.kt`) does differently:
//!
//! * `GCounter` is wrapped in a `perDevice` object instead of *being* the device→count map. That
//!   single mismatch aborted the entire apply transaction with
//!   `invalid type: map, expected u64` — so no collection synced at all whenever the brain was
//!   selected (issue #46).
//! * Counters, per-video maps, sets, LWW-maps and flags sit at the top level instead of grouped
//!   under `counters` / `perVideo` / `sets` / `lwwMaps` / `flags`. Serde ignores unknown fields, so
//!   these were being dropped *silently* — the brain "synced" while importing nothing.
//! * OR-Sets arrive as plain arrays and LWW registers as bare values with no stamp. Both are
//!   stamped with the snapshot's own HLC on the way in, otherwise they would carry the
//!   lowest-possible clock and lose every subsequent merge.
//! * `ContentVector` dimensions are inline on the vector rather than inside `dims`.

use std::collections::BTreeMap;

use serde::de::{DeserializeOwned, Error as DeError};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use crate::sync::brainmap;
use crate::sync::canonical::{
    BrainCounters, BrainFlags, BrainLwwMaps, BrainPerVideo, BrainSets, BrainVectors,
    ContentVectorWire, FlowNeuroBrainSnapshot, GCounter, Hlc, Lww, OrSet,
};

// ---- shared helpers ---------------------------------------------------------------------------

/// Deserialize `obj[key]`, falling back to `T::default()` when it is absent or null.
fn field<T, E>(obj: &Map<String, Value>, ctx: &str, key: &str) -> Result<T, E>
where
    T: DeserializeOwned + Default,
    E: DeError,
{
    match obj.get(key) {
        None | Some(Value::Null) => Ok(T::default()),
        Some(v) => {
            serde_json::from_value(v.clone()).map_err(|e| E::custom(format!("{ctx}.{key}: {e}")))
        }
    }
}

/// Deserialize the `group` object if the peer nested it, otherwise rebuild it from the top-level
/// keys a flat-envelope peer used. `members` are the field names, which are identical in both
/// layouts — only their nesting differs.
fn group<T, E>(
    obj: &Map<String, Value>,
    ctx: &str,
    group_key: &str,
    members: &[&str],
) -> Result<T, E>
where
    T: DeserializeOwned + Default,
    E: DeError,
{
    if let Some(nested) = obj.get(group_key).filter(|v| !v.is_null()) {
        return serde_json::from_value(nested.clone())
            .map_err(|e| E::custom(format!("{ctx}.{group_key}: {e}")));
    }
    let flat: Map<String, Value> = members
        .iter()
        .filter_map(|key| {
            obj.get(*key)
                .filter(|v| !v.is_null())
                .map(|v| ((*key).to_string(), v.clone()))
        })
        .collect();
    if flat.is_empty() {
        return Ok(T::default());
    }
    serde_json::from_value(Value::Object(flat))
        .map_err(|e| E::custom(format!("{ctx}.{group_key} (flat layout): {e}")))
}

// ---- CRDT primitives --------------------------------------------------------------------------

impl<'de> Deserialize<'de> for GCounter {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        let obj = value
            .as_object()
            .ok_or_else(|| D::Error::custom("gCounter must be a JSON object"))?;
        // Canonical: {"<device>": 12}. Android: {"perDevice": {"<device>": 12}}.
        let entries = match obj.get("perDevice") {
            Some(Value::Object(inner)) if obj.len() == 1 => inner,
            _ => obj,
        };
        let mut counts = BTreeMap::new();
        for (device, count) in entries {
            // A sub-count is grow-only, so a negative one is nonsense; clamp rather than fail the
            // whole apply over one bad entry.
            let n = count
                .as_u64()
                .or_else(|| count.as_i64().map(|i| i.max(0).unsigned_abs()))
                .ok_or_else(|| {
                    D::Error::custom(format!("gCounter[{device}] must be an integer"))
                })?;
            counts.insert(device.clone(), n);
        }
        Ok(GCounter(counts))
    }
}

impl<'de> Deserialize<'de> for OrSet {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        match value {
            // A bare member list (Android, and the §6.5 sketch). Stamps are filled in from the
            // snapshot's HLC by `stamp_missing_hlcs`.
            Value::Array(items) => {
                let mut adds = BTreeMap::new();
                for item in items {
                    let member = item
                        .as_str()
                        .ok_or_else(|| D::Error::custom("orSet member must be a string"))?;
                    adds.insert(member.to_string(), Hlc::default());
                }
                Ok(OrSet {
                    adds,
                    removes: BTreeMap::new(),
                })
            }
            Value::Object(obj) => Ok(OrSet {
                adds: field(&obj, "orSet", "adds")?,
                removes: field(&obj, "orSet", "removes")?,
            }),
            _ => Err(D::Error::custom("orSet must be an object or an array")),
        }
    }
}

impl<'de, T> Deserialize<'de> for Lww<T>
where
    T: DeserializeOwned,
{
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        // The canonical register is exactly `{"value": …, "hlc": "…"}`. Anything else is a bare
        // value from a peer that does not stamp its registers — no canonical `T` has both a
        // `value` and an `hlc` field, so the two cannot be confused.
        if let Value::Object(obj) = &value
            && let (2, Some(inner), Some(stamp)) = (obj.len(), obj.get("value"), obj.get("hlc"))
        {
            return Ok(Lww {
                value: serde_json::from_value(inner.clone())
                    .map_err(|e| D::Error::custom(format!("lww.value: {e}")))?,
                hlc: serde_json::from_value(stamp.clone())
                    .map_err(|e| D::Error::custom(format!("lww.hlc: {e}")))?,
            });
        }
        Ok(Lww {
            value: serde_json::from_value(value)
                .map_err(|e| D::Error::custom(format!("lww bare value: {e}")))?,
            hlc: Hlc::default(),
        })
    }
}

impl<'de> Deserialize<'de> for ContentVectorWire {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        let obj = value
            .as_object()
            .ok_or_else(|| D::Error::custom("contentVector must be a JSON object"))?;
        let topics = field(obj, "contentVector", "topics")?;
        let mut dims: BTreeMap<String, f64> = field(obj, "contentVector", "dims")?;
        // Android carries duration/pacing/complexity/isLive directly on the vector. Fold in any
        // scalar sibling so a future dimension needs no change here; an explicit `dims` wins.
        for (key, v) in obj {
            if key == "topics" || key == "dims" {
                continue;
            }
            if let Some(n) = v.as_f64() {
                dims.entry(key.clone()).or_insert(n);
            }
        }
        Ok(ContentVectorWire { topics, dims })
    }
}

impl<'de> Deserialize<'de> for BrainVectors {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        const CTX: &str = "brainVectors";
        let value = Value::deserialize(d)?;
        let obj = value
            .as_object()
            .ok_or_else(|| D::Error::custom("brainVectors must be a JSON object"))?;

        let raw: BTreeMap<String, ContentVectorWire> = field(obj, CTX, "timeVectors")?;
        let mut entries: Vec<(String, bool, ContentVectorWire)> = raw
            .into_iter()
            .map(|(key, vector)| match brainmap::canonical_bucket_key(&key) {
                Some(canonical) => {
                    let already_canonical = canonical == key;
                    (canonical, already_canonical, vector)
                }
                // Not a bucket name we know — pass it through untouched rather than lose it.
                None => (key, true, vector),
            })
            .collect();
        // Stable sort puts rewritten spellings first, so a key that was already canonical wins any
        // collision between the two forms.
        entries.sort_by_key(|(_, already_canonical, _)| *already_canonical);

        Ok(BrainVectors {
            global_vector: field(obj, CTX, "globalVector")?,
            time_vectors: entries.into_iter().map(|(k, _, v)| (k, v)).collect(),
            shorts_vector: field(obj, CTX, "shortsVector")?,
            topic_affinities: field(obj, CTX, "topicAffinities")?,
            channel_scores: field(obj, CTX, "channelScores")?,
            channel_topic_profiles: field(obj, CTX, "channelTopicProfiles")?,
        })
    }
}

// ---- FlowNeuro brain snapshot -----------------------------------------------------------------

impl<'de> Deserialize<'de> for FlowNeuroBrainSnapshot {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        const CTX: &str = "flowNeuroBrain";
        let value = Value::deserialize(d)?;
        let obj = value
            .as_object()
            .ok_or_else(|| D::Error::custom("flow_neuro_brain record must be a JSON object"))?;

        let mut snapshot = FlowNeuroBrainSnapshot {
            schema: field(obj, CTX, "schema")?,
            device_id: field(obj, CTX, "deviceId")?,
            hlc: field(obj, CTX, "hlc")?,
            vectors: field::<BrainVectors, _>(obj, CTX, "vectors")?,
            counters: group::<BrainCounters, _>(
                obj,
                CTX,
                "counters",
                &["idfTotalDocuments", "totalInteractions"],
            )?,
            idf_word_frequency: field(obj, CTX, "idfWordFrequency")?,
            per_video: group::<BrainPerVideo, _>(
                obj,
                CTX,
                "perVideo",
                &["watchHistoryMap", "watchSignalProgress"],
            )?,
            sets: group::<BrainSets, _>(
                obj,
                CTX,
                "sets",
                &["blockedTopics", "blockedChannels", "preferredTopics"],
            )?,
            lww_maps: group::<BrainLwwMaps, _>(
                obj,
                CTX,
                "lwwMaps",
                &[
                    "suppressedVideoIds",
                    "suppressedChannels",
                    "rejectionPatterns",
                    "topicEvidence",
                    "feedHistory",
                    "channelStrikes",
                ],
            )?,
            flags: group::<BrainFlags, _>(obj, CTX, "flags", &["hasCompletedOnboarding"])?,
        };
        stamp_missing_hlcs(&mut snapshot);
        Ok(snapshot)
    }
}

/// Give every unstamped OR-Set member and LWW register the snapshot's own HLC.
///
/// A peer that sends bare values leaves them at `Hlc::default()`, the lowest possible stamp — which
/// would lose to *any* local write during merge and, worse, lose to an old remove tombstone, so a
/// channel the user just blocked on the phone would silently unblock here.
fn stamp_missing_hlcs(snapshot: &mut FlowNeuroBrainSnapshot) {
    let hlc = snapshot.hlc.clone();
    if hlc == Hlc::default() {
        return;
    }
    for set in [
        &mut snapshot.sets.blocked_topics,
        &mut snapshot.sets.blocked_channels,
        &mut snapshot.sets.preferred_topics,
    ] {
        for stamp in set.adds.values_mut().chain(set.removes.values_mut()) {
            if *stamp == Hlc::default() {
                *stamp = hlc.clone();
            }
        }
    }
    let maps = &mut snapshot.lww_maps;
    stamp_lww_map(&mut maps.suppressed_video_ids, &hlc);
    stamp_lww_map(&mut maps.suppressed_channels, &hlc);
    stamp_lww_map(&mut maps.rejection_patterns, &hlc);
    stamp_lww_map(&mut maps.topic_evidence, &hlc);
    stamp_lww_map(&mut maps.feed_history, &hlc);
    stamp_lww_map(&mut maps.channel_strikes, &hlc);
}

fn stamp_lww_map<T>(map: &mut BTreeMap<String, Lww<T>>, hlc: &Hlc) {
    for register in map.values_mut() {
        if register.hlc == Hlc::default() {
            register.hlc = hlc.clone();
        }
    }
}
