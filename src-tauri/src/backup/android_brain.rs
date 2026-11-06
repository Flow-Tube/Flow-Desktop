//! The two engine brains in the JSON Flow for Android imports: `NeuroStorage.SerializableBrain`
//! (`engine_brain.json`) and `MusicBrainStorage.SerializableMusicBrain` (`music_brain.json`).

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::flow_neuro::display_forms::DisplayForm;
use crate::flow_neuro::keyspec::VERSION as KEY_SPEC_VERSION;
use crate::flow_neuro::scoring::{
    ContentVector, FeedEntry, RejectionSignal, SCHEMA_VERSION, TimeBucket, TopicEvidence, UserBrain,
};
use crate::music_brain::model::{Affinity, MUSIC_SCHEMA_VERSION, MusicBrain, TrackMeta};
use crate::sync::brainmap::canonical_bucket_key;

/// Android's brain schema that writes the desktop's current key spec (`NeuroMaintenance`).
const ANDROID_KEY_SPEC_3_SCHEMA: i64 = 21;
const ANDROID_KEY_SPEC_2_SCHEMA: i64 = 20;

fn android_bucket(bucket: TimeBucket) -> &'static str {
    match bucket {
        TimeBucket::WeekdayMorning => "WEEKDAY_MORNING",
        TimeBucket::WeekdayAfternoon => "WEEKDAY_AFTERNOON",
        TimeBucket::WeekdayEvening => "WEEKDAY_EVENING",
        TimeBucket::WeekdayNight => "WEEKDAY_NIGHT",
        TimeBucket::WeekendMorning => "WEEKEND_MORNING",
        TimeBucket::WeekendAfternoon => "WEEKEND_AFTERNOON",
        TimeBucket::WeekendEvening => "WEEKEND_EVENING",
        TimeBucket::WeekendNight => "WEEKEND_NIGHT",
    }
}

fn vector_out(vector: &ContentVector) -> Value {
    json!({
        "topics": vector.topics,
        "duration": vector.duration,
        "pacing": vector.pacing,
        "complexity": vector.complexity,
        "isLive": vector.is_live,
    })
}

fn keyed<T>(map: &HashMap<TimeBucket, T>, value: impl Fn(&T) -> Value) -> Map<String, Value> {
    map.iter()
        .map(|(bucket, item)| (android_bucket(*bucket).to_string(), value(item)))
        .collect()
}

/// `brain` must already hold the current key spec, as [`crate::sync::brain_rekey::align_flow`]
/// leaves it. The persona is left out: Android works it out again from the vectors.
#[must_use]
pub fn user_brain_to_android(brain: &UserBrain) -> Value {
    let topic_evidence: Map<String, Value> = brain
        .topic_evidence
        .iter()
        .map(|(key, evidence)| {
            (
                key.clone(),
                json!({
                    "positiveSignals": evidence.positive_signals,
                    "watchSignals": evidence.watch_signals,
                    "explicitSignals": evidence.explicit_signals,
                    "positiveScore": evidence.positive_score,
                    "videoIds": evidence.video_ids,
                    "channelIds": evidence.channel_ids,
                    "firstSeenAt": evidence.first_seen_at,
                    "lastSeenAt": evidence.last_seen_at,
                }),
            )
        })
        .collect();
    let rejection_patterns: Map<String, Value> = brain
        .rejection_patterns
        .iter()
        .map(|(key, signal)| {
            (
                key.clone(),
                json!({ "count": signal.count, "lastRejectedAt": signal.last_rejected_at }),
            )
        })
        .collect();
    let feed_history: Map<String, Value> = brain
        .feed_history
        .iter()
        .map(|(key, entry)| {
            (
                key.clone(),
                json!({ "lastShown": entry.last_shown, "showCount": entry.show_count }),
            )
        })
        .collect();
    let display_forms: Map<String, Value> = brain
        .display_forms
        .iter()
        .map(|(key, form)| {
            (
                key.clone(),
                json!({ "form": form.form, "votes": form.votes }),
            )
        })
        .collect();
    let schema = if KEY_SPEC_VERSION >= 3 {
        ANDROID_KEY_SPEC_3_SCHEMA
    } else {
        ANDROID_KEY_SPEC_2_SCHEMA
    };

    json!({
        "schemaVersion": schema,
        "timeVectors": keyed(&brain.time_vectors, vector_out),
        "global": vector_out(&brain.global_vector),
        "channelScores": brain.channel_scores,
        "topicAffinities": brain.topic_affinities,
        "interactions": brain.total_interactions,
        "consecutiveSkips": brain.consecutive_skips,
        "blockedTopics": brain.blocked_topics,
        "blockedChannels": brain.blocked_channels,
        "preferredTopics": brain.preferred_topics,
        "hasCompletedOnboarding": brain.has_completed_onboarding,
        "idfWordFrequency": brain.idf_word_frequency,
        "idfTotalDocuments": brain.idf_total_documents,
        "watchHistoryMap": brain.watch_history_map,
        "seenShortsHistory": brain.seen_shorts_history,
        "channelTopicProfiles": brain.channel_topic_profiles,
        "shortsVector": vector_out(&brain.shorts_vector),
        "recentVector": vector_out(&brain.recent_vector),
        "suppressedVideoIds": brain.suppressed_video_ids,
        "suppressedChannels": brain.suppressed_channels,
        "rejectionPatterns": rejection_patterns,
        "feedHistory": feed_history,
        "recentQueryTokens": brain.recent_query_tokens,
        "topicEvidence": topic_evidence,
        "recentRelatedSeeds": brain.recent_related_seeds,
        "staleQueries": brain.stale_queries,
        "clusterRotation": brain.cluster_rotation,
        "timeBucketCounts": keyed(&brain.time_bucket_counts, |count| json!(count)),
        "displayForms": display_forms,
        "formatAffinity": brain.format_affinity,
        "categoryAffinity": brain.category_affinity,
        "languageProfile": brain.language_profile,
        "languageVotes": brain.language_votes,
        "keyLanguage": brain.key_language,
    })
}

fn obj(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn f64_or(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(fallback)
}

fn u64_of(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_u64)
        .or_else(|| value.and_then(Value::as_f64).map(|n| n.max(0.0) as u64))
        .unwrap_or(0)
}

fn i32_of(value: Option<&Value>) -> i32 {
    value
        .and_then(Value::as_i64)
        .map_or(0, |n| n.clamp(0, i64::from(i32::MAX)) as i32)
}

fn num_map(value: Option<&Value>) -> HashMap<String, f64> {
    obj(value)
        .into_iter()
        .filter_map(|(key, value)| value.as_f64().map(|n| (key, n)))
        .collect()
}

fn f32_map(value: Option<&Value>) -> HashMap<String, f32> {
    obj(value)
        .into_iter()
        .filter_map(|(key, value)| value.as_f64().map(|n| (key, n as f32)))
        .collect()
}

fn u64_map(value: Option<&Value>) -> HashMap<String, u64> {
    obj(value)
        .into_iter()
        .map(|(key, value)| {
            let n = u64_of(Some(&value));
            (key, n)
        })
        .collect()
}

fn i32_map(value: Option<&Value>) -> HashMap<String, i32> {
    obj(value)
        .into_iter()
        .map(|(key, value)| {
            let n = i32_of(Some(&value));
            (key, n)
        })
        .collect()
}

fn str_set(value: Option<&Value>) -> HashSet<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn vector_in(value: Option<&Value>) -> ContentVector {
    let Some(vector) = value.and_then(Value::as_object) else {
        return ContentVector::default();
    };
    let defaults = ContentVector::default();
    ContentVector {
        topics: num_map(vector.get("topics")),
        duration: f64_or(vector.get("duration"), defaults.duration),
        pacing: f64_or(vector.get("pacing"), defaults.pacing),
        complexity: f64_or(vector.get("complexity"), defaults.complexity),
        is_live: f64_or(vector.get("isLive"), defaults.is_live),
        ..defaults
    }
}

fn bucket_of(key: &str) -> Option<TimeBucket> {
    serde_json::from_value(Value::String(canonical_bucket_key(key)?)).ok()
}

/// Android's engine export as a desktop brain. Its schema number says which key spec its keys are
/// in; the load path converts anything older.
#[must_use]
#[allow(clippy::too_many_lines)] // One line per field of the brain.
pub fn user_brain_from_android(value: &Value) -> UserBrain {
    let field = |name: &str| value.get(name);
    let schema = field("schemaVersion").and_then(Value::as_i64).unwrap_or(0);
    let key_spec = if schema >= ANDROID_KEY_SPEC_3_SCHEMA {
        3
    } else if schema >= ANDROID_KEY_SPEC_2_SCHEMA {
        2
    } else {
        0
    };

    let time_vectors = obj(field("timeVectors"))
        .iter()
        .filter_map(|(key, vector)| Some((bucket_of(key)?, vector_in(Some(vector)))))
        .collect();
    let time_bucket_counts = obj(field("timeBucketCounts"))
        .iter()
        .filter_map(|(key, count)| Some((bucket_of(key)?, i32_of(Some(count)))))
        .collect();
    let topic_evidence = obj(field("topicEvidence"))
        .iter()
        .map(|(key, evidence)| {
            (
                key.clone(),
                TopicEvidence {
                    positive_signals: i32_of(evidence.get("positiveSignals")),
                    negative_signals: i32_of(evidence.get("negativeSignals")),
                    watch_signals: i32_of(evidence.get("watchSignals")),
                    explicit_signals: i32_of(evidence.get("explicitSignals")),
                    positive_score: f64_or(evidence.get("positiveScore"), 0.0),
                    video_ids: str_set(evidence.get("videoIds")),
                    channel_ids: str_set(evidence.get("channelIds")),
                    first_seen_at: u64_of(evidence.get("firstSeenAt")),
                    last_seen_at: u64_of(evidence.get("lastSeenAt")),
                },
            )
        })
        .collect();
    let rejection_patterns = obj(field("rejectionPatterns"))
        .iter()
        .map(|(key, signal)| {
            (
                key.clone(),
                RejectionSignal {
                    count: i32_of(signal.get("count")),
                    last_rejected_at: u64_of(signal.get("lastRejectedAt")),
                },
            )
        })
        .collect();
    let feed_history = obj(field("feedHistory"))
        .iter()
        .map(|(key, entry)| {
            (
                key.clone(),
                FeedEntry {
                    last_shown: u64_of(entry.get("lastShown")),
                    show_count: i32_of(entry.get("showCount")),
                },
            )
        })
        .collect();
    let display_forms = obj(field("displayForms"))
        .iter()
        .filter_map(|(key, entry)| {
            Some((
                key.clone(),
                DisplayForm {
                    form: entry.get("form")?.as_str()?.to_string(),
                    votes: entry
                        .get("votes")
                        .and_then(Value::as_u64)
                        .map_or(1, |votes| u32::try_from(votes).unwrap_or(u32::MAX)),
                },
            ))
        })
        .collect();
    let channel_topic_profiles = obj(field("channelTopicProfiles"))
        .iter()
        .map(|(channel, topics)| (channel.clone(), num_map(Some(topics))))
        .collect();
    let recent_query_tokens = field("recentQueryTokens")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(|row| str_set(Some(row))).collect())
        .unwrap_or_default();
    let language_votes = obj(field("languageVotes"))
        .iter()
        .filter_map(|(key, votes)| Some((key.clone(), u32::try_from(votes.as_u64()?).ok()?)))
        .collect();

    UserBrain {
        schema_version: SCHEMA_VERSION,
        key_spec,
        time_vectors,
        time_bucket_counts,
        global_vector: vector_in(field("global")),
        recent_vector: vector_in(field("recentVector")),
        shorts_vector: vector_in(field("shortsVector")),
        format_affinity: num_map(field("formatAffinity")),
        category_affinity: num_map(field("categoryAffinity")),
        channel_scores: num_map(field("channelScores")),
        topic_affinities: num_map(field("topicAffinities")),
        total_interactions: i32_of(field("interactions")),
        consecutive_skips: i32_of(field("consecutiveSkips")),
        blocked_topics: str_set(field("blockedTopics")),
        blocked_channels: str_set(field("blockedChannels")),
        preferred_topics: str_set(field("preferredTopics")),
        has_completed_onboarding: field("hasCompletedOnboarding")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        idf_word_frequency: i32_map(field("idfWordFrequency")),
        idf_total_documents: i32_of(field("idfTotalDocuments")),
        watch_history_map: f32_map(field("watchHistoryMap")),
        seen_shorts_history: u64_map(field("seenShortsHistory")),
        channel_topic_profiles,
        suppressed_video_ids: u64_map(field("suppressedVideoIds")),
        suppressed_channels: u64_map(field("suppressedChannels")),
        rejection_patterns,
        feed_history,
        recent_query_tokens,
        topic_evidence,
        recent_related_seeds: u64_map(field("recentRelatedSeeds")),
        stale_queries: u64_map(field("staleQueries")),
        cluster_rotation: u64_map(field("clusterRotation")),
        display_forms,
        language_profile: text(field("languageProfile")),
        key_language: text(field("keyLanguage")),
        language_votes,
        ..UserBrain::default()
    }
}

/// Android reads a brain marked `backfilled` as past its warm start, which would otherwise count
/// music history into a restored brain a second time.
#[must_use]
pub fn music_brain_to_android(brain: &MusicBrain) -> Value {
    let artist_affinity: Map<String, Value> = brain
        .artist_affinity
        .iter()
        .map(|(key, affinity)| {
            (
                key.clone(),
                json!({
                    "plays": affinity.plays,
                    "score": affinity.score,
                    "lastPlayed": affinity.last_played,
                    "liked": affinity.liked,
                    "display": "",
                }),
            )
        })
        .collect();
    let track_meta: Map<String, Value> = brain
        .track_meta
        .iter()
        .map(|(key, meta)| {
            (
                key.clone(),
                json!({
                    "title": meta.title,
                    "artist": meta.artist,
                    "artistKey": meta.artist_key,
                    "thumbnail": meta.thumbnail,
                }),
            )
        })
        .collect();
    let time_buckets: Map<String, Value> = brain
        .time_buckets
        .iter()
        .filter_map(|(bucket, genres)| {
            let wire = serde_json::to_value(bucket).ok()?;
            Some((wire.as_str()?.to_string(), json!(genres)))
        })
        .collect();
    let has_state = brain.total_plays > 0
        || !brain.artist_affinity.is_empty()
        || !brain.track_plays.is_empty()
        || !brain.seen_artists.is_empty()
        || !brain.blocked_artists.is_empty();
    json!({
        "schemaVersion": MUSIC_SCHEMA_VERSION,
        "artistAffinity": artist_affinity,
        "genreAffinity": brain.genre_affinity,
        "trackPlays": brain.track_plays,
        "trackMeta": track_meta,
        "recentRotation": brain.recent_rotation,
        "artistCooc": brain.artist_cooc,
        "artistRelated": {},
        "timeBuckets": time_buckets,
        "seenArtists": brain.seen_artists,
        "dislikedArtists": brain.disliked_artists,
        "blockedArtists": brain.blocked_artists,
        "discoveryAppetite": brain.discovery_appetite,
        "totalPlays": brain.total_plays,
        "lastRotationDecay": brain.last_rotation_decay,
        "backfilled": has_state,
    })
}

/// Whether a JSON object reads as Android's music engine export.
#[must_use]
pub fn is_android_music_brain(value: &Value) -> bool {
    value.get("artistAffinity").is_some() && value.get("discoveryAppetite").is_some()
}

#[must_use]
pub fn music_brain_from_android(value: &Value) -> MusicBrain {
    let field = |name: &str| value.get(name);
    let defaults = MusicBrain::default();
    let artist_affinity = obj(field("artistAffinity"))
        .iter()
        .map(|(key, affinity)| {
            (
                key.clone(),
                Affinity {
                    plays: u32::try_from(u64_of(affinity.get("plays"))).unwrap_or(u32::MAX),
                    score: f64_or(affinity.get("score"), 0.0),
                    last_played: u64_of(affinity.get("lastPlayed")),
                    liked: affinity
                        .get("liked")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    ..Affinity::default()
                },
            )
        })
        .collect();
    let track_plays = obj(field("trackPlays"))
        .iter()
        .map(|(key, plays)| {
            let times = plays
                .as_array()
                .map(|times| times.iter().filter_map(Value::as_u64).collect())
                .unwrap_or_default();
            (key.clone(), times)
        })
        .collect();
    let track_meta = obj(field("trackMeta"))
        .iter()
        .map(|(key, meta)| {
            let part = |name: &str| text(meta.get(name)).unwrap_or_default();
            (
                key.clone(),
                TrackMeta {
                    title: part("title"),
                    artist: part("artist"),
                    artist_key: part("artistKey"),
                    thumbnail: part("thumbnail"),
                },
            )
        })
        .collect();
    let time_buckets = obj(field("timeBuckets"))
        .iter()
        .filter_map(|(key, genres)| Some((bucket_of(key)?, num_map(Some(genres)))))
        .collect();
    MusicBrain {
        artist_affinity,
        genre_affinity: num_map(field("genreAffinity")),
        track_plays,
        track_meta,
        recent_rotation: num_map(field("recentRotation")),
        artist_cooc: num_map(field("artistCooc")),
        time_buckets,
        seen_artists: str_set(field("seenArtists")),
        disliked_artists: u64_map(field("dislikedArtists")),
        blocked_artists: str_set(field("blockedArtists")),
        discovery_appetite: f64_or(field("discoveryAppetite"), defaults.discovery_appetite),
        total_plays: u32::try_from(u64_of(field("totalPlays"))).unwrap_or(u32::MAX),
        last_rotation_decay: u64_of(field("lastRotationDecay")),
        ..defaults
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)] // These values are copied, never computed.
mod tests {
    use super::*;

    #[test]
    fn a_brain_keeps_its_learning_through_androids_shape() {
        let mut brain = UserBrain::default();
        brain.global_vector.topics.insert("guitar".into(), 0.7);
        brain
            .time_vectors
            .entry(TimeBucket::WeekendNight)
            .or_default()
            .topics
            .insert("chess".into(), 0.4);
        brain.blocked_channels.insert("UCblocked".into());
        brain.total_interactions = 42;
        brain.key_language = Some("en".into());

        let android = user_brain_to_android(&brain);
        assert_eq!(android["schemaVersion"], ANDROID_KEY_SPEC_3_SCHEMA);
        assert!(android["timeVectors"].get("WEEKEND_NIGHT").is_some());
        assert!(android.get("longTerm").is_none());

        let back = user_brain_from_android(&android);
        assert_eq!(back.key_spec, 3);
        assert_eq!(back.schema_version, SCHEMA_VERSION);
        assert_eq!(back.total_interactions, 42);
        assert_eq!(back.global_vector.topics["guitar"], 0.7);
        assert_eq!(
            back.time_vectors[&TimeBucket::WeekendNight].topics["chess"],
            0.4
        );
        assert!(back.blocked_channels.contains("UCblocked"));
    }

    #[test]
    fn an_old_android_brain_reads_as_needing_key_conversion() {
        let brain = user_brain_from_android(&json!({ "schemaVersion": 19, "global": {} }));
        assert_eq!(brain.key_spec, 0);
        let brain = user_brain_from_android(&json!({ "schemaVersion": 20, "global": {} }));
        assert_eq!(brain.key_spec, 2);
    }

    #[test]
    fn a_music_brain_keeps_its_plays_through_androids_shape() {
        let mut brain = MusicBrain {
            total_plays: 3,
            ..MusicBrain::default()
        };
        brain.artist_affinity.insert(
            "UCartist".into(),
            Affinity {
                plays: 3,
                score: 0.5,
                last_played: 1000,
                liked: true,
                ..Affinity::default()
            },
        );
        brain.track_plays.insert("song".into(), vec![1, 2, 3]);
        brain
            .time_buckets
            .entry(TimeBucket::WeekdayNight)
            .or_default()
            .insert("rock".into(), 1.0);

        let android = music_brain_to_android(&brain);
        assert_eq!(android["backfilled"], true);
        assert!(android["timeBuckets"].get("WeekdayNight").is_some());
        assert!(is_android_music_brain(&android));

        let back = music_brain_from_android(&android);
        assert_eq!(back.total_plays, 3);
        assert_eq!(back.artist_affinity["UCartist"].plays, 3);
        assert_eq!(back.track_plays["song"], vec![1, 2, 3]);
        assert_eq!(back.time_buckets[&TimeBucket::WeekdayNight]["rock"], 1.0);
    }

    #[test]
    fn junk_values_never_panic() {
        let brain = user_brain_from_android(&json!({
            "global": "nope", "timeVectors": { "NOT_A_BUCKET": {} }, "interactions": -5,
            "topicEvidence": [], "displayForms": { "a": { "votes": 2 } },
        }));
        assert_eq!(brain.total_interactions, 0);
        assert!(brain.time_vectors.is_empty());
        assert!(brain.display_forms.is_empty());
        let music =
            music_brain_from_android(&json!({ "trackPlays": { "a": "no" }, "totalPlays": "x" }));
        assert_eq!(music.total_plays, 0);
    }
}
