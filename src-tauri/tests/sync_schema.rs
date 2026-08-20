//! schema-lock test for Flow Local Sync.
//!
//! Each golden fixture under `tests/fixtures/sync/` is deserialized into the canonical typed
//! model and re-serialized; we assert the serialization is **stable** (round-trip deterministic)
//! and spot-check decoded values. These fixtures are the shared cross-platform vectors: the
//! Android implementation must produce byte-identical canonical output from the same inputs.
//!
//! If a future change to the canonical types breaks the wire schema, this test fails — which is
//! exactly the lock we want before building the transport, mapping, and merge layers on top.

use std::path::PathBuf;

use serde::Serialize;
use serde::de::DeserializeOwned;

use flow_desktop_lib::sync::canonical::{
    FlowNeuroBrainSnapshot, Like, LikeKind, LikeState, MusicBrainSnapshot, Playlist,
    PlaylistOrigin, SettingEntry, SubscribedChannel, SubscriptionGroup, WatchHistoryRecord,
    to_canonical_json,
};
use flow_desktop_lib::sync::frames::CapabilitiesFrame;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("sync")
        .join(name)
}

/// Deserialize a fixture, then prove the typed schema round-trips deterministically.
fn load_stable<T: Serialize + DeserializeOwned>(name: &str) -> T {
    let raw = std::fs::read_to_string(fixture_path(name))
        .unwrap_or_else(|e| panic!("read fixture {name}: {e}"));

    let typed: T =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("decode fixture {name}: {e}"));

    // Serialize the typed value, re-decode it, and serialize again. A stable schema yields two
    // identical JSON values (object key order is irrelevant under serde_json::Value equality).
    let v1 = serde_json::to_value(&typed).unwrap();
    let typed2: T = serde_json::from_value(v1.clone()).unwrap();
    let v2 = serde_json::to_value(&typed2).unwrap();
    assert_eq!(
        v1, v2,
        "canonical schema is not round-trip stable for {name}"
    );

    typed
}

#[test]
fn watch_history_fixture_locks() {
    let records: Vec<WatchHistoryRecord> = load_stable("watch_history.json");
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].video_id, "dQw4w9WgXcQ");
    assert!((records[0].progress - 0.8).abs() < f32::EPSILON);
    assert!(!records[0].is_music);
    // the music↔video distinction must survive the wire (the music-leak rule)
    assert!(records[1].is_music);
    assert_eq!(records[0].hlc.physical_ms, 1_781_512_000_000);
}

#[test]
fn playlists_fixture_locks() {
    let playlists: Vec<Playlist> = load_stable("playlists.json");
    assert_eq!(playlists.len(), 2);
    assert_eq!(playlists[0].sync_id, "550e8400-e29b-41d4-a716-446655440000");
    assert_eq!(playlists[0].origin, PlaylistOrigin::Local);
    assert_eq!(playlists[0].items.len(), 1);
    assert_eq!(playlists[0].items[0].video_id, "dQw4w9WgXcQ");
    // reserved protected playlist (Watch Later) keeps its stable identity
    assert!(playlists[1].is_protected);
    assert_eq!(playlists[1].sync_id, "reserved:watch-later");
}

#[test]
fn likes_fixture_locks() {
    let likes: Vec<Like> = load_stable("likes.json");
    assert_eq!(likes.len(), 2);
    assert_eq!(likes[0].kind, LikeKind::Video);
    assert_eq!(likes[0].state, LikeState::Liked);
    // an unlike is shipped as the `none` tombstone, not omitted
    assert_eq!(likes[1].kind, LikeKind::Music);
    assert_eq!(likes[1].state, LikeState::None);
}

#[test]
fn settings_fixture_locks() {
    let settings: Vec<SettingEntry> = load_stable("settings.json");
    assert_eq!(settings.len(), 4);
    assert_eq!(settings[0].key, "autoplay");
    assert_eq!(settings[0].value, serde_json::json!(true));
    assert_eq!(settings[3].key, "sponsorblock_categories");
    assert!(settings[3].value.is_object());
}

#[test]
fn flow_neuro_brain_fixture_locks() {
    let brain: FlowNeuroBrainSnapshot = load_stable("flow_neuro_brain.json");
    assert_eq!(brain.schema, 14);
    assert_eq!(brain.device_id, "device-aaa");
    // G-Counter total comes from summing per-device sub-counts
    assert_eq!(brain.counters.idf_total_documents.total(), 420);
    assert_eq!(brain.counters.total_interactions.get("device-aaa"), 1500);
    assert_eq!(brain.idf_word_frequency["minecraft"].total(), 42);
    // blocklist is an OR-Set
    assert!(brain.sets.blocked_topics.contains("politics"));
    assert!(!brain.sets.blocked_topics.contains("coding"));
    assert!(brain.flags.has_completed_onboarding);
    assert_eq!(
        brain.lww_maps.topic_evidence["coding"]
            .value
            .positive_signals,
        10
    );
}

#[test]
fn music_brain_fixture_locks() {
    let brain: MusicBrainSnapshot = load_stable("music_brain.json");
    assert_eq!(brain.schema, 3);
    assert_eq!(brain.total_plays.total(), 340);
    let psy = &brain.artist_affinity["UCpsy"];
    assert_eq!(psy.plays.total(), 12);
    assert!(psy.liked);
    assert!(brain.seen_artists.contains("UCpsy"));
    assert_eq!(brain.track_plays["9bZkp7q19f0"].len(), 2);
    assert!((brain.discovery_appetite.as_ref().unwrap().value - 0.45).abs() < f64::EPSILON);
}

#[test]
fn subscriptions_fixture_locks() {
    let groups: Vec<SubscriptionGroup> = load_stable("subscriptions.json");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "Tech");
    assert_eq!(
        groups[0].channel_ids,
        vec!["UCabc".to_string(), "UCdef".to_string()]
    );
    assert_eq!(groups[0].sort_order, 0);
    assert!(!groups[0].deleted);
}

#[test]
fn subscribed_channels_fixture_locks() {
    let channels: Vec<SubscribedChannel> = load_stable("subscribed_channels.json");
    assert_eq!(channels.len(), 2);
    assert_eq!(channels[0].channel_id, "UCabc");
    assert_eq!(channels[0].subscribed_at_ms, 1_781_000_000_000);
    assert!(!channels[0].deleted);
    // An unsubscribe is shipped as a tombstone carrying no display metadata.
    assert!(channels[1].deleted);
    assert!(channels[1].name.is_empty());
}

#[test]
fn subscribed_channel_canonical_bytes_match_android() {
    let channel = SubscribedChannel {
        channel_id: "UCabc".to_string(),
        name: "Some Channel".to_string(),
        avatar_url: "https://cdn.example/UCabc.jpg".to_string(),
        subscribed_at_ms: 1_781_000_000_000,
        is_music: false,
        hlc: "1781000000000:0:deviceaa".parse().unwrap(),
        deleted: false,
    };
    let json = String::from_utf8(to_canonical_json(&channel)).unwrap();
    assert_eq!(
        json,
        r#"{"avatarUrl":"https://cdn.example/UCabc.jpg","channelId":"UCabc","deleted":false,"hlc":"1781000000000:0:deviceaa","isMusic":false,"name":"Some Channel","subscribedAtMs":1781000000000}"#
    );
}

#[test]
fn subscription_group_canonical_bytes_match_android() {
    let group = SubscriptionGroup {
        channel_ids: vec!["UC1".to_string(), "UC2".to_string()],
        deleted: false,
        hlc: "1781000000000:0:deviceaa".parse().unwrap(),
        name: "Tech".to_string(),
        sort_order: 0,
    };
    let json = String::from_utf8(to_canonical_json(&group)).unwrap();
    assert_eq!(
        json,
        r#"{"channelIds":["UC1","UC2"],"deleted":false,"hlc":"1781000000000:0:deviceaa","name":"Tech","sortOrder":0}"#
    );
}

#[test]
fn capabilities_fixture_locks() {
    let caps: CapabilitiesFrame = load_stable("capabilities.json");
    assert_eq!(caps.collections["watch_history"].schema, 1);
    assert!(caps.collections["watch_history"].produce);
    // music_brain is producible by desktop but not consumable by a peer without a MusicBrain
    assert!(caps.collections["music_brain"].produce);
    assert!(!caps.collections["music_brain"].consume);
    // subscription groups now sync in both directions
    assert!(caps.collections["subscriptions"].produce);
    assert!(caps.collections["subscriptions"].consume);
}
