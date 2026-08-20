//! merge-law tests.
//!
//! For every collection merge we assert the three CRDT laws — **commutativity**,
//! **associativity**, and **idempotency** — over randomized datasets drawn from small key pools
//! (so keys collide and HLC ties are exercised). Together these laws guarantee that any number of
//! bidirectional syncs in any order converge to a single state with no loss or double-counting.

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

use flow_desktop_lib::sync::canonical::{
    AffinityWire, FlowNeuroBrainSnapshot, GCounter, Hlc, Like, LikeKind, LikeState, Lww,
    MusicBrainSnapshot, Playlist, PlaylistItem, PlaylistOrigin, SettingEntry, SubscribedChannel,
    SubscriptionGroup, WatchHistoryRecord,
};
use flow_desktop_lib::sync::merge;

/// Assert commutativity, associativity, and idempotency for a Vec-returning merge.
fn assert_laws<T, F>(sets: &[Vec<T>], merge_fn: F)
where
    T: Clone + PartialEq + std::fmt::Debug,
    F: Fn(Vec<T>, Vec<T>) -> Vec<T>,
{
    for a in sets {
        for b in sets {
            assert_eq!(
                merge_fn(a.clone(), b.clone()),
                merge_fn(b.clone(), a.clone()),
                "commutativity"
            );
            for c in sets {
                let left = merge_fn(merge_fn(a.clone(), b.clone()), c.clone());
                let right = merge_fn(a.clone(), merge_fn(b.clone(), c.clone()));
                assert_eq!(left, right, "associativity");
            }
        }
        let normalized = merge_fn(a.clone(), Vec::new());
        assert_eq!(merge_fn(a.clone(), a.clone()), normalized, "idempotency");
    }
}

fn hlc(r: &mut StdRng) -> Hlc {
    let devices = ["d1", "d2"];
    Hlc::new(
        r.gen_range(0u64..5) * 100,
        r.gen_range(0u32..3),
        devices[r.gen_range(0..devices.len())],
    )
}

// --------------------------------------------------------------------------------------------

#[test]
fn watch_history_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(101);
    let mut sets: Vec<Vec<WatchHistoryRecord>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for id in ["v1", "v2", "v3", "v4"] {
            if r.gen_bool(0.7) {
                v.push(WatchHistoryRecord {
                    video_id: id.to_string(),
                    title: format!("t{}", r.gen_range(0..3)),
                    channel_name: None,
                    channel_id: None,
                    watched_at_ms: r.gen_range(0..1000),
                    progress: r.gen_range(0..=10) as f32 / 10.0,
                    duration_seconds: Some(200),
                    is_music: r.gen_bool(0.5),
                    is_short: r.gen_bool(0.3),
                    hlc: hlc(&mut r),
                    deleted: r.gen_bool(0.2),
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_watch_history);
}

#[test]
fn likes_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(102);
    let pool = [
        (LikeKind::Video, "a"),
        (LikeKind::Video, "b"),
        (LikeKind::Music, "a"),
    ];
    let states = [LikeState::Liked, LikeState::Disliked, LikeState::None];
    let mut sets: Vec<Vec<Like>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for (kind, id) in pool {
            if r.gen_bool(0.7) {
                v.push(Like {
                    kind,
                    id: id.to_string(),
                    state: states[r.gen_range(0..states.len())],
                    updated_at_ms: r.gen_range(0..1000),
                    hlc: hlc(&mut r),
                    meta: None,
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_likes);
}

#[test]
fn playlists_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(103);
    let mut sets: Vec<Vec<Playlist>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for pid in ["p1", "p2"] {
            if r.gen_bool(0.8) {
                let mut items = Vec::new();
                for vid in ["v1", "v2", "v3"] {
                    if r.gen_bool(0.6) {
                        items.push(PlaylistItem {
                            video_id: vid.to_string(),
                            position: r.gen_range(0..100),
                            added_at_ms: r.gen_range(0..1000),
                            deleted: r.gen_bool(0.2),
                            title: None,
                            channel_name: None,
                            channel_id: None,
                            thumbnail_url: None,
                            duration_seconds: None,
                            is_music: false,
                            hlc: hlc(&mut r),
                            raw: None,
                        });
                    }
                }
                v.push(Playlist {
                    sync_id: pid.to_string(),
                    origin: PlaylistOrigin::Local,
                    youtube_id: None,
                    title: format!("n{}", r.gen_range(0..3)),
                    description: None,
                    thumbnail_url: None,
                    is_music: false,
                    is_user_created: true,
                    is_protected: false,
                    created_at_ms: r.gen_range(0..1000),
                    updated_hlc: hlc(&mut r),
                    deleted: r.gen_bool(0.2),
                    items,
                    raw: None,
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_playlists);
}

#[test]
fn settings_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(104);
    let mut sets: Vec<Vec<SettingEntry>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for k in ["autoplay", "default_quality_wifi", "playback_speed"] {
            if r.gen_bool(0.7) {
                v.push(SettingEntry {
                    key: k.to_string(),
                    value: serde_json::json!(r.gen_range(0..5)),
                    hlc: hlc(&mut r),
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_settings);
}

#[test]
fn subscriptions_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(105);
    let mut sets: Vec<Vec<SubscriptionGroup>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for name in ["Tech", "News"] {
            if r.gen_bool(0.8) {
                let mut channel_ids: Vec<String> = Vec::new();
                for c in ["c1", "c2", "c3"] {
                    if r.gen_bool(0.6) {
                        channel_ids.push(c.to_string());
                    }
                }
                v.push(SubscriptionGroup {
                    channel_ids,
                    deleted: r.gen_bool(0.2),
                    hlc: hlc(&mut r),
                    name: name.to_string(),
                    sort_order: r.gen_range(0..5),
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_subscriptions);
}

#[test]
fn subscribed_channels_merge_obeys_crdt_laws() {
    let mut r = StdRng::seed_from_u64(106);
    let mut sets: Vec<Vec<SubscribedChannel>> = Vec::new();
    for _ in 0..6 {
        let mut v = Vec::new();
        for id in ["UCa", "UCb", "UCc"] {
            if r.gen_bool(0.75) {
                let stamp = hlc(&mut r);
                v.push(SubscribedChannel {
                    channel_id: id.to_string(),
                    name: format!("name-{}", r.gen_range(0..3)),
                    avatar_url: String::new(),
                    subscribed_at_ms: stamp.physical_ms,
                    is_music: r.gen_bool(0.3),
                    hlc: stamp,
                    deleted: r.gen_bool(0.3),
                });
            }
        }
        sets.push(v);
    }
    assert_laws(&sets, merge::merge_subscribed_channels);
}

// --------------------------------------------------------------------------------------------
// Brains: order-independence + idempotency of the folded merge, and deterministic effective state.
// --------------------------------------------------------------------------------------------

fn fnb(device: &str, seed: u64) -> FlowNeuroBrainSnapshot {
    let mut s = FlowNeuroBrainSnapshot {
        schema: 14,
        device_id: device.to_string(),
        hlc: Hlc::new(seed * 100, 0, device),
        ..Default::default()
    };
    s.counters.idf_total_documents = GCounter::single(device, seed * 10);
    s.counters.total_interactions = GCounter::single(device, seed * 5);
    s.idf_word_frequency
        .insert("rust".to_string(), GCounter::single(device, seed));
    s.per_video
        .watch_history_map
        .insert("v1".to_string(), seed as f32 / 10.0);
    s.sets
        .blocked_topics
        .add(format!("topic{seed}"), Hlc::new(seed * 100, 0, device));
    s.lww_maps.suppressed_video_ids.insert(
        "vx".to_string(),
        Lww::new(seed, Hlc::new(seed * 100, 0, device)),
    );
    s.flags.has_completed_onboarding = seed % 2 == 0;
    s.vectors
        .global_vector
        .topics
        .insert("coding".to_string(), seed as f64 * 0.1);
    s.vectors
        .topic_affinities
        .insert("coding".to_string(), seed as f64 * 0.2);
    s
}

#[test]
fn flow_neuro_brain_merge_is_order_independent_and_idempotent() {
    let s0 = fnb("d1", 1);
    let s1 = fnb("d2", 2);
    let s2 = fnb("d1", 3); // a second, newer snapshot from d1

    let a = merge::merge_flow_neuro(&[s0.clone(), s1.clone(), s2.clone()]);
    let b = merge::merge_flow_neuro(&[s2.clone(), s1.clone(), s0.clone()]);
    let c = merge::merge_flow_neuro(&[s1.clone(), s0.clone(), s2.clone()]);
    assert_eq!(a, b, "fold order must not matter");
    assert_eq!(a, c, "fold order must not matter");

    // Re-feeding snapshots already merged changes nothing (idempotent).
    let dup =
        merge::merge_flow_neuro(&[s0.clone(), s1.clone(), s2.clone(), s0.clone(), s1.clone()]);
    assert_eq!(a, dup, "duplicate snapshots are no-ops");

    // The newer d1 snapshot (s2) wins the per-device vector slot; counters sum across devices.
    assert_eq!(a.device_vectors.len(), 2, "one vector slot per device");
    assert_eq!(a.counters.idf_total_documents.get("d1"), 30); // max(10, 30)
    assert_eq!(a.counters.idf_total_documents.get("d2"), 20);
    assert_eq!(a.counters.idf_total_documents.total(), 50);

    // Effective vectors are a deterministic function of the merged device snapshots.
    assert_eq!(a.effective_vectors(), b.effective_vectors());
    assert!(
        a.effective_vectors()
            .topic_affinities
            .contains_key("coding")
    );
}

fn mbs(device: &str, seed: u64) -> MusicBrainSnapshot {
    let mut s = MusicBrainSnapshot {
        schema: 3,
        device_id: device.to_string(),
        hlc: Hlc::new(seed * 100, 0, device),
        ..Default::default()
    };
    s.total_plays = GCounter::single(device, seed * 10);
    s.artist_affinity.insert(
        "UCx".to_string(),
        AffinityWire {
            plays: GCounter::single(device, seed),
            score: seed as f64 * 0.1,
            last_played: seed,
            liked: seed % 2 == 0,
            hlc: Hlc::new(seed * 100, 0, device),
        },
    );
    s.genre_affinity
        .insert("kpop".to_string(), seed as f64 * 0.1);
    s.track_plays
        .insert("t1".to_string(), vec![seed * 100, seed * 100 + 1]);
    s.seen_artists.add("UCx", Hlc::new(seed * 100, 0, device));
    s.discovery_appetite = Some(Lww::new(
        seed as f64 * 0.05,
        Hlc::new(seed * 100, 0, device),
    ));
    s
}

#[test]
fn music_brain_merge_is_order_independent_and_idempotent() {
    let m0 = mbs("d1", 1);
    let m1 = mbs("d2", 2);
    let m2 = mbs("d1", 3);

    let a = merge::merge_music(&[m0.clone(), m1.clone(), m2.clone()]);
    let b = merge::merge_music(&[m2.clone(), m1.clone(), m0.clone()]);
    assert_eq!(a, b, "fold order must not matter");

    let dup = merge::merge_music(&[m0.clone(), m1.clone(), m2.clone(), m1.clone()]);
    assert_eq!(a, dup, "duplicate snapshots are no-ops");

    assert_eq!(a.total_plays.total(), 50); // d1 max(10,30)=30 + d2:20
    // UCx plays G-Counter: max(d1:1,3)=3 + d2:2 = 5
    assert_eq!(a.artist_affinity["UCx"].plays.total(), 5);
}
