//! Brain counters and sets across repeated syncs: only local growth is credited to this device,
//! unblocks propagate, and a pre-fix inflated counter is corrected once and stays corrected.

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::brain_attrib::legacy_own_count;
use flow_desktop_lib::sync::canonical::{
    AffinityWire, Collection, FlowNeuroBrainSnapshot, GCounter, Hlc, MusicBrainSnapshot, OrSet,
};
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::protocol::StagedCollection;

const OUR: &str = "dlocal";
const PEER: &str = "dpeer";

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn put(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn get(pool: &SqlitePool, key: &str) -> String {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn local_brain(pool: &SqlitePool) -> Value {
    serde_json::from_str(&get(pool, "user_neuro_brain").await).unwrap()
}

async fn set_local_brain(pool: &SqlitePool, ub: &Value) {
    put(
        pool,
        "user_neuro_brain",
        &serde_json::to_string(ub).unwrap(),
    )
    .await;
}

async fn local_music(pool: &SqlitePool) -> Value {
    serde_json::from_str(&get(pool, "user_music_brain").await).unwrap()
}

async fn set_local_music(pool: &SqlitePool, mb: &Value) {
    put(
        pool,
        "user_music_brain",
        &serde_json::to_string(mb).unwrap(),
    )
    .await;
}

fn stage<T: serde::Serialize>(collection: Collection, record: &T, hash: &str) -> StagedCollection {
    StagedCollection {
        collection,
        ndjson: serde_json::to_vec(record).unwrap(),
        record_count: 1,
        hash: hash.to_string(),
    }
}

/// A correct peer (like current Flow for Android): its own counter entry holds only its own count.
fn peer_flow(docs: u64, extra: &[(&str, u64)], hlc_ms: u64) -> FlowNeuroBrainSnapshot {
    let mut counter = GCounter::single(PEER, docs);
    for (device, count) in extra {
        counter.set(device, *count);
    }
    let mut snap = FlowNeuroBrainSnapshot {
        schema: 1,
        device_id: PEER.to_string(),
        hlc: Hlc::new(hlc_ms, 0, PEER),
        ..Default::default()
    };
    snap.counters.idf_total_documents = counter.clone();
    snap.counters.total_interactions = counter;
    snap
}

fn blocked_channels(brain: &Value) -> Vec<String> {
    serde_json::from_value(brain["blocked_channels"].clone()).unwrap_or_default()
}

fn brain_with_docs(docs: i64) -> Value {
    json!({ "idf_total_documents": docs, "total_interactions": docs })
}

#[tokio::test]
async fn repeated_syncs_never_inflate_the_flow_counters() {
    let pool = memory_pool().await;
    set_local_brain(&pool, &brain_with_docs(5)).await;

    // Round 1: 5 local + 10 from the peer.
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(10, &[], 1),
            "r1",
        )],
    )
    .await
    .unwrap();
    assert_eq!(local_brain(&pool).await["idf_total_documents"], 15);

    // Rounds 2 and 3: the peer hasn't changed and nothing happened locally. The old code credited
    // the merged 15 to this device and reached 25, then 35.
    for hash in ["r2", "r3"] {
        apply_payload(
            &pool,
            OUR,
            PEER,
            &[stage(
                Collection::FlowNeuroBrain,
                &peer_flow(10, &[], 1),
                hash,
            )],
        )
        .await
        .unwrap();
        assert_eq!(
            local_brain(&pool).await["idf_total_documents"],
            15,
            "round {hash}"
        );
    }

    // Local learning between syncs is credited exactly once.
    let mut ub = local_brain(&pool).await;
    ub["idf_total_documents"] = json!(17);
    ub["total_interactions"] = json!(17);
    set_local_brain(&pool, &ub).await;
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(12, &[], 2),
            "r4",
        )],
    )
    .await
    .unwrap();
    let ub = local_brain(&pool).await;
    assert_eq!(ub["idf_total_documents"], 7 + 12);
    assert_eq!(ub["total_interactions"], 7 + 12);
}

#[tokio::test]
async fn export_ships_only_this_devices_own_count() {
    let pool = memory_pool().await;
    set_local_brain(&pool, &brain_with_docs(5)).await;
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(10, &[], 1),
            "r1",
        )],
    )
    .await
    .unwrap();

    let out = export_collections(&pool, OUR, &[Collection::FlowNeuroBrain])
        .await
        .unwrap();
    let first: FlowNeuroBrainSnapshot =
        serde_json::from_slice(out[0].ndjson.split(|&b| b == b'\n').next().unwrap()).unwrap();
    let counter = &first.counters.idf_total_documents;
    assert_eq!(
        counter.get(OUR),
        5,
        "own entry is this device's own learning, not the merged 15"
    );
    assert_eq!(counter.get(PEER), 10);
}

#[tokio::test]
async fn a_peer_copy_of_our_own_entry_is_ignored() {
    let pool = memory_pool().await;
    set_local_brain(&pool, &brain_with_docs(5)).await;
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(10, &[], 1),
            "r1",
        )],
    )
    .await
    .unwrap();

    // A peer that still remembers an inflated value for this device must not raise it again.
    let stale = peer_flow(10, &[(OUR, 40)], 2);
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(Collection::FlowNeuroBrain, &stale, "r2")],
    )
    .await
    .unwrap();
    assert_eq!(local_brain(&pool).await["idf_total_documents"], 15);
}

#[tokio::test]
async fn an_inflated_pre_fix_counter_is_corrected_once() {
    let pool = memory_pool().await;
    // State left by two applies on the old code: true own count 5, peer 10, own entry inflated to
    // 25 and the local brain showing the inflated total of 25 + 10 = 35.
    let mut merged = serde_json::json!({
        "counters": { "idfTotalDocuments": {}, "totalInteractions": {} }
    });
    merged["counters"]["idfTotalDocuments"] = serde_json::json!({ OUR: 25, PEER: 10 });
    merged["counters"]["totalInteractions"] = serde_json::json!({ OUR: 25, PEER: 10 });
    put(&pool, "sync_neuro_merged", &merged.to_string()).await;
    set_local_brain(&pool, &brain_with_docs(35)).await;
    for hash in ["old-1", "old-2", "old-3"] {
        sqlx::query("INSERT INTO sync_log (peer_device_id, collection, payload_hash) VALUES (?, 'flow_neuro_brain', ?)")
            .bind(PEER)
            .bind(hash)
            .execute(&pool)
            .await
            .unwrap();
    }

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(10, &[(OUR, 25)], 3),
            "new",
        )],
    )
    .await
    .unwrap();
    assert_eq!(local_brain(&pool).await["idf_total_documents"], 5 + 10);

    // And it stays corrected on the next sync, even though the peer still holds 25 for us.
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(
            Collection::FlowNeuroBrain,
            &peer_flow(10, &[(OUR, 25)], 4),
            "next",
        )],
    )
    .await
    .unwrap();
    assert_eq!(local_brain(&pool).await["idf_total_documents"], 15);
}

#[test]
fn legacy_correction_never_goes_below_zero() {
    assert_eq!(legacy_own_count(35, 10, 3), 5);
    assert_eq!(legacy_own_count(15, 10, 1), 5);
    assert_eq!(legacy_own_count(20, 10, 5), 0);
    assert_eq!(legacy_own_count(7, 0, 4), 7);
}

#[tokio::test]
async fn an_unblock_survives_a_sync_with_a_peer_that_still_has_the_block() {
    let pool = memory_pool().await;
    let mut ub = brain_with_docs(1);
    ub["blocked_channels"] = json!(["UCspam"]);
    set_local_brain(&pool, &ub).await;

    // The peer learned the block from us earlier and keeps relaying its (old) add stamp.
    let mut with_block = peer_flow(1, &[], 1);
    let mut set = OrSet::default();
    set.add("UCspam", Hlc::new(1_000, 0, OUR));
    with_block.sets.blocked_channels = set;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(Collection::FlowNeuroBrain, &with_block, "r1")],
    )
    .await
    .unwrap();
    assert!(blocked_channels(&local_brain(&pool).await).contains(&"UCspam".to_string()));

    // Unblock locally, then sync with the peer that still sends the old add.
    let mut ub = local_brain(&pool).await;
    ub["blocked_channels"] = json!([]);
    set_local_brain(&pool, &ub).await;
    apply_payload(
        &pool,
        OUR,
        PEER,
        &[stage(Collection::FlowNeuroBrain, &with_block, "r2")],
    )
    .await
    .unwrap();
    assert!(
        !blocked_channels(&local_brain(&pool).await).contains(&"UCspam".to_string()),
        "the unblock must win over the older block"
    );

    // The export carries the remove so the peer learns about the unblock too.
    let out = export_collections(&pool, OUR, &[Collection::FlowNeuroBrain])
        .await
        .unwrap();
    let text = String::from_utf8(out[0].ndjson.clone()).unwrap();
    assert!(
        text.contains("removes") && text.contains("UCspam"),
        "{text}"
    );
}

#[tokio::test]
async fn unchanged_values_keep_their_stamp_so_peer_edits_win() {
    let pool = memory_pool().await;
    let mb = json!({
        "total_plays": 3,
        "artist_affinity": { "artist": { "plays": 3, "score": 0.5, "last_played": 1, "liked": false } }
    });
    set_local_music(&pool, &mb).await;

    let peer_snapshot = |score: f64, hlc_ms: u64, hash: &str| {
        let mut snap = MusicBrainSnapshot {
            schema: 1,
            device_id: PEER.to_string(),
            hlc: Hlc::new(hlc_ms, 0, PEER),
            total_plays: GCounter::single(PEER, 4),
            ..Default::default()
        };
        snap.artist_affinity.insert(
            "artist".to_string(),
            AffinityWire {
                plays: GCounter::single(PEER, 4),
                score,
                last_played: 1,
                liked: false,
                hlc: Hlc::new(hlc_ms, 0, PEER),
            },
        );
        stage(Collection::MusicBrain, &snap, hash)
    };

    apply_payload(&pool, OUR, PEER, &[peer_snapshot(0.5, 1, "m1")])
        .await
        .unwrap();
    let mb = local_music(&pool).await;
    assert_eq!(mb["total_plays"], 7);
    assert_eq!(mb["artist_affinity"]["artist"]["plays"], 7);

    // The phone changes the score later. Nothing changed here, so the desktop must not restamp its
    // copy with "now" and overrule the phone.
    let later = chrono::Utc::now().timestamp_millis() as u64 + 60_000;
    apply_payload(&pool, OUR, PEER, &[peer_snapshot(0.9, later, "m2")])
        .await
        .unwrap();
    let mb = local_music(&pool).await;
    assert_eq!(mb["artist_affinity"]["artist"]["score"], 0.9);
    assert_eq!(mb["total_plays"], 7, "repeat sync doesn't double the plays");
    assert_eq!(mb["artist_affinity"]["artist"]["plays"], 7);
}
