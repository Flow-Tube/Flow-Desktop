//! The brain across key specs: the desktop advertises key spec 2 and its key language, sends its
//! brain only to a peer that writes keys the same way, and reads a peer's older spellings (or its
//! own merged state from before key spec 2) into the keys they mean, counting nothing twice.

mod common;

use std::collections::BTreeMap;

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use common::bind_loopback;
use flow_desktop_lib::flow_neuro::keyspec::KeySpec;
use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{Collection, FlowNeuroBrainSnapshot, GCounter, Hlc};
use flow_desktop_lib::sync::crypto::{
    Role, SessionCipher, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::frames::{
    ApplyResultEntry, ApplyResultFrame, CapabilitiesFrame, Capability, HelloFrame, Platform,
};
use flow_desktop_lib::sync::protocol::{
    ApplyOutput, OutgoingCollection, StagedCollection, run_receiver, run_sender,
};
use flow_desktop_lib::sync::session::desktop_capabilities;
use flow_desktop_lib::sync::transport;

const OUR: &str = "dlocal";
const PEER: &str = "dpeer";

// ---- capabilities and the send gate ------------------------------------------------------------

#[test]
fn the_brain_capability_names_its_key_spec_and_language() {
    let caps = serde_json::to_value(desktop_capabilities("en")).unwrap();
    let brain = &caps["collections"]["flow_neuro_brain"];
    assert_eq!(brain["keySpec"], 2);
    assert_eq!(brain["keyLanguage"], "en");
    // Collections without topic keys say so the way Android does: spec 0, no language.
    assert_eq!(caps["collections"]["likes"]["keySpec"], 0);
    assert_eq!(caps["collections"]["likes"]["keyLanguage"], "");
}

#[test]
fn a_capability_from_before_key_specs_reads_as_spec_zero() {
    let caps: CapabilitiesFrame = serde_json::from_value(json!({
        "collections": { "flow_neuro_brain": { "schema": 13, "produce": true, "consume": true } }
    }))
    .unwrap();
    let brain = &caps.collections["flow_neuro_brain"];
    assert_eq!(brain.key_spec, 0);
    assert_eq!(brain.key_language, "");
}

fn hello(id: &str) -> HelloFrame {
    HelloFrame {
        device_id: id.into(),
        device_name: id.into(),
        platform: Platform::Desktop,
        app_version: "0.1.0".into(),
        protocol: 1,
    }
}

fn peer_caps(key_spec: i32, key_language: &str) -> CapabilitiesFrame {
    let cap = |key_spec: i32, key_language: &str| Capability {
        schema: 13,
        produce: true,
        consume: true,
        key_spec,
        key_language: key_language.to_string(),
    };
    CapabilitiesFrame {
        collections: BTreeMap::from([
            (Collection::Likes.key().to_string(), cap(0, "")),
            (
                Collection::FlowNeuroBrain.key().to_string(),
                cap(key_spec, key_language),
            ),
        ]),
    }
}

async fn stage_only(
    _peer: HelloFrame,
    staged: Vec<StagedCollection>,
) -> ApplyOutput<Vec<StagedCollection>> {
    let mut frame = ApplyResultFrame::default();
    for c in &staged {
        frame
            .collections
            .insert(c.collection.key().to_string(), ApplyResultEntry::default());
    }
    Ok((frame, staged))
}

/// What a desktop on key spec 2 ("en") offers a peer advertising `their_caps`.
async fn offered_to(their_caps: CapabilitiesFrame) -> Vec<String> {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = bind_loopback().await;

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        run_sender(
            ch,
            SessionCipher::new(&host_master, sid, Role::Host),
            hello("desktop"),
            desktop_capabilities("en"),
            vec![
                OutgoingCollection {
                    collection: Collection::Likes,
                    ndjson: br#"{"id":"a","state":"liked"}"#.to_vec(),
                },
                OutgoingCollection {
                    collection: Collection::FlowNeuroBrain,
                    ndjson: br#"{"deviceId":"desktop"}"#.to_vec(),
                },
            ],
            vec![Collection::Likes, Collection::FlowNeuroBrain],
            false,
            || async {},
        )
        .await
        .unwrap()
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    run_receiver(
        ch,
        SessionCipher::new(&master, sid, Role::Client),
        hello("peer"),
        their_caps,
        |_, manifest| async move {
            let _ = tx.send(manifest.collections.keys().cloned().collect::<Vec<_>>());
            true
        },
        stage_only,
    )
    .await
    .unwrap();
    host.await.unwrap();
    rx.await.unwrap()
}

#[tokio::test]
async fn the_brain_goes_only_to_a_peer_that_writes_topic_keys_the_same_way() {
    assert_eq!(offered_to(peer_caps(0, "")).await, ["likes"]);
    assert_eq!(offered_to(peer_caps(2, "es")).await, ["likes"]);
    assert_eq!(
        offered_to(peer_caps(2, "en")).await,
        ["flow_neuro_brain", "likes"]
    );
}

// ---- reading keys on apply ---------------------------------------------------------------------

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn put(pool: &SqlitePool, key: &str, value: &Value) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(key)
    .bind(serde_json::to_string(value).unwrap())
    .execute(pool)
    .await
    .unwrap();
}

async fn get(pool: &SqlitePool, key: &str) -> Value {
    let raw: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

async fn apply(pool: &SqlitePool, snap: &FlowNeuroBrainSnapshot, hash: &str) {
    let staged = StagedCollection {
        collection: Collection::FlowNeuroBrain,
        ndjson: serde_json::to_vec(snap).unwrap(),
        record_count: 1,
        hash: hash.to_string(),
    };
    apply_payload(pool, OUR, PEER, &[staged]).await.unwrap();
}

fn peer_snapshot(
    topics: &[(&str, f64)],
    words: &[(&str, u64)],
    docs: u64,
) -> FlowNeuroBrainSnapshot {
    let mut snap = FlowNeuroBrainSnapshot {
        schema: 13,
        device_id: PEER.to_string(),
        hlc: Hlc::new(1_000, 0, PEER),
        ..Default::default()
    };
    snap.counters.idf_total_documents = GCounter::single(PEER, docs);
    snap.counters.total_interactions = GCounter::single(PEER, docs);
    for (topic, weight) in topics {
        snap.vectors
            .global_vector
            .topics
            .insert((*topic).to_string(), *weight);
    }
    for (word, count) in words {
        snap.idf_word_frequency
            .insert((*word).to_string(), GCounter::single(PEER, *count));
    }
    snap
}

fn topics(brain: &Value) -> Vec<String> {
    let mut keys: Vec<String> = brain["global_vector"]["topics"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

#[tokio::test]
async fn a_legacy_peer_snapshot_is_read_into_this_brains_keys() {
    let pool = memory_pool().await;
    put(
        &pool,
        "user_neuro_brain",
        &json!({ "key_spec": 2, "language_profile": "en", "key_language": "en",
                 "global_vector": { "topics": { "guitar": 0.4 } },
                 "idf_word_frequency": { "guitar": 4 }, "idf_total_documents": 4 }),
    )
    .await;

    // A peer from before key spec 2 spells the same word two ways.
    apply(
        &pool,
        &peer_snapshot(
            &[("guitars", 0.6), ("guitar", 0.2)],
            &[("guitars", 3), ("guitar", 2)],
            5,
        ),
        "r1",
    )
    .await;

    let brain = get(&pool, "user_neuro_brain").await;
    assert_eq!(
        topics(&brain),
        ["guitar"],
        "no duplicate topic for the old spelling"
    );
    assert_eq!(
        brain["idf_word_frequency"]["guitar"], 9,
        "the peer's two spellings sum, then add to ours: 4 + 3 + 2"
    );
    assert_eq!(brain["display_forms"].get("guitar"), None);
}

#[tokio::test]
async fn a_key_spec_2_snapshot_merges_into_the_keys_already_here() {
    let pool = memory_pool().await;
    let spec = KeySpec::default();
    // A desktop brain from before key spec 2, converted by this apply.
    put(
        &pool,
        "user_neuro_brain",
        &json!({ "language_profile": "en", "key_language": "en",
                 "global_vector": { "topics": { "guitars": 0.5, "restoring": 0.3 } },
                 "idf_word_frequency": { "guitars": 2 }, "idf_total_documents": 2 }),
    )
    .await;

    // Android writes key spec 2 keys: stems, and pairs only once they are phrases.
    let restor = spec.key_of("restoring");
    apply(
        &pool,
        &peer_snapshot(
            &[("guitar", 0.7), (restor.as_str(), 0.4)],
            &[("guitar", 6)],
            6,
        ),
        "r1",
    )
    .await;

    let brain = get(&pool, "user_neuro_brain").await;
    let mut expected = vec!["guitar".to_string(), restor.clone()];
    expected.sort();
    assert_eq!(topics(&brain), expected);
    assert_eq!(brain["idf_word_frequency"]["guitar"], 8);
    assert_eq!(brain["key_spec"], 2);
    // The old local spelling labels the stem it became.
    assert_eq!(brain["display_forms"][&restor]["form"], "Restoring");

    let merged = get(&pool, "sync_neuro_merged").await;
    assert_eq!(merged["key_spec"], 2);
    assert_eq!(merged["key_language"], "en");
}

#[tokio::test]
async fn merged_state_from_before_key_spec_2_is_read_without_counting_twice() {
    let pool = memory_pool().await;
    // State after an earlier sync on the old build: this device counted "guitars" 4 times and
    // "guitar" 5 times, the peer "guitars" 6 times; the local brain holds the merged totals.
    put(
        &pool,
        "sync_neuro_merged",
        &json!({
            "counters": {
                "idfTotalDocuments": { "dlocal": 9, "dpeer": 6 },
                "totalInteractions": { "dlocal": 9, "dpeer": 6 }
            },
            "idf_word_frequency": {
                "guitars": { "dlocal": 4, "dpeer": 6 },
                "guitar": { "dlocal": 5 }
            }
        }),
    )
    .await;
    put(
        &pool,
        "sync_neuro_baseline",
        &json!({ "idfTotalDocuments": 15, "totalInteractions": 15,
                 "idfWordFrequency": { "guitars": 10, "guitar": 5 } }),
    )
    .await;
    put(
        &pool,
        "user_neuro_brain",
        &json!({ "language_profile": "en", "key_language": "en",
                 "idf_total_documents": 15, "total_interactions": 15,
                 "idf_word_frequency": { "guitars": 10, "guitar": 5 } }),
    )
    .await;

    // The peer, now on key spec 2, sends its unchanged count under the new spelling.
    apply(&pool, &peer_snapshot(&[], &[("guitar", 6)], 6), "r1").await;

    let brain = get(&pool, "user_neuro_brain").await;
    assert_eq!(
        brain["idf_word_frequency"]["guitar"], 15,
        "4 + 5 here, 6 there"
    );
    assert_eq!(brain["idf_word_frequency"].get("guitars"), None);
    assert_eq!(brain["idf_total_documents"], 15);

    let merged = get(&pool, "sync_neuro_merged").await;
    assert_eq!(merged["idf_word_frequency"]["guitar"][OUR], 9);
    assert_eq!(merged["idf_word_frequency"]["guitar"][PEER], 6);

    // A second sync with nothing new changes nothing.
    apply(&pool, &peer_snapshot(&[], &[("guitar", 6)], 6), "r2").await;
    let again = get(&pool, "user_neuro_brain").await;
    assert_eq!(again["idf_word_frequency"]["guitar"], 15);
}
