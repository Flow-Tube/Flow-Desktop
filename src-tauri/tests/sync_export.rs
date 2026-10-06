//! export tests: the **send** side ([`export`]) and the brain merged-state → snapshot
//! decomposers. Exporting from one DB and applying to a fresh DB must reproduce the data losslessly
//! and obey the settings whitelist; decomposing a merged brain and re-merging the pieces must
//! reconstruct the same merged state (so a relay device propagates everything it knows, idempotently).

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::brainmap;
use flow_desktop_lib::sync::canonical::{
    BrainVectors, ContentVectorWire, FlowNeuroBrainSnapshot, GCounter, Hlc, MusicBrainSnapshot,
};
use flow_desktop_lib::sync::codec::sha256_hex;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::merge::{merge_flow_neuro, merge_music};
use flow_desktop_lib::sync::protocol::{OutgoingCollection, StagedCollection};

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn stage(out: &OutgoingCollection) -> StagedCollection {
    let count = out
        .ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .count() as u64;
    StagedCollection {
        collection: out.collection,
        ndjson: out.ndjson.clone(),
        record_count: count,
        hash: sha256_hex(&out.ndjson),
    }
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2025-02-02T00:00:00+00:00')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn get_setting(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn insert_watch(pool: &SqlitePool, id: &str, watched: i64, total: i64) {
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, ?, NULL, NULL, '2025-01-01T00:00:00+00:00', ?, ?, 0, 0, ?)",
    )
    .bind(id)
    .bind(format!("title-{id}"))
    .bind(watched)
    .bind(total)
    .bind(format!("100:0:dA"))
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn export_then_apply_round_trips_watch_likes_playlists_settings() {
    use flow_desktop_lib::sync::canonical::Collection::*;

    let a = memory_pool().await;
    insert_watch(&a, "v1", 100, 200).await;
    insert_watch(&a, "v2", 140, 200).await;
    set_setting(
        &a,
        "liked_items",
        r#"[{"kind":"video","id":"vid1","likedAt":"2025-01-02T00:00:00+00:00","title":"L1"}]"#,
    )
    .await;
    set_setting(
        &a,
        "user_playlists",
        r#"[{"id":"pl1","name":"Mix","tracks":[{"id":"t1","title":"Track 1","channelName":"C"}],"createdAt":"2025-01-01T00:00:00+00:00"}]"#,
    )
    .await;
    // One syncable + one excluded setting.
    set_setting(&a, "autoplay_enabled", "true").await;
    set_setting(&a, "download_location", "C:/secret/downloads").await;

    let selection = vec![WatchHistory, Likes, Playlists, Settings];
    let outgoing = export_collections(&a, "dA", &selection).await.unwrap();
    assert_eq!(outgoing.len(), 4);

    // The excluded download path must never appear in the exported settings payload.
    let settings_out = outgoing.iter().find(|o| o.collection == Settings).unwrap();
    let settings_str = String::from_utf8(settings_out.ndjson.clone()).unwrap();
    assert!(
        settings_str.contains(r#""key":"autoplay","#) && settings_str.contains(r#""value":true"#),
        "shared settings go out under Android's canonical key with a typed value: {settings_str}"
    );
    assert!(
        !settings_str.contains("download_location"),
        "export must not leak the excluded download path"
    );

    // Apply to a fresh device B.
    let b = memory_pool().await;
    let staged: Vec<StagedCollection> = outgoing.iter().map(stage).collect();
    apply_payload(&b, "dB", "dA", &staged).await.unwrap();

    // watch_history reproduced.
    let titles: Vec<String> =
        sqlx::query_scalar::<_, String>("SELECT title FROM watch_history ORDER BY video_id")
            .fetch_all(&b)
            .await
            .unwrap();
    assert_eq!(titles, vec!["title-v1", "title-v2"]);

    // likes reproduced.
    let likes = get_setting(&b, "liked_items").await.unwrap();
    assert!(likes.contains("vid1"));

    // playlists reproduced.
    let pls = get_setting(&b, "user_playlists").await.unwrap();
    assert!(pls.contains("Mix") && pls.contains("t1"));

    // syncable setting applied; excluded one absent on B.
    assert_eq!(
        get_setting(&b, "autoplay_enabled").await.as_deref(),
        Some("true")
    );
    assert_eq!(get_setting(&b, "download_location").await, None);
}

fn flow_snapshot(
    device: &str,
    docs: u64,
    topic: &str,
    weight_topic: f64,
) -> FlowNeuroBrainSnapshot {
    let mut global = ContentVectorWire::default();
    global.topics.insert(topic.to_string(), weight_topic);
    FlowNeuroBrainSnapshot {
        schema: 1,
        device_id: device.to_string(),
        hlc: Hlc::new(docs, 0, device),
        vectors: BrainVectors {
            global_vector: global,
            ..BrainVectors::default()
        },
        counters: flow_desktop_lib::sync::canonical::BrainCounters {
            idf_total_documents: GCounter::single(device, docs),
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn flow_neuro_decompose_then_remerge_reconstructs_merged_state() {
    // Two devices' contributions merged.
    let merged = merge_flow_neuro(&[
        flow_snapshot("dA", 100, "rust", 1.0),
        flow_snapshot("dB", 300, "cooking", 1.0),
    ]);

    // Decompose back into snapshots and re-merge them.
    let snaps = brainmap::merged_flow_to_snapshots(&merged);
    assert_eq!(snaps.len(), 2, "one snapshot per contributing device");
    let remerged = merge_flow_neuro(&snaps);

    // Counter totals survive (no double-count) and both devices' vectors are preserved.
    assert_eq!(remerged.counters.idf_total_documents.total(), 400);
    assert_eq!(remerged.device_vectors.len(), 2);
    assert_eq!(
        merged.effective_vectors(),
        remerged.effective_vectors(),
        "decompose∘merge is the identity on the effective brain"
    );

    // Re-merging the snapshots again is idempotent.
    let again = merge_flow_neuro(&[snaps.clone(), snaps].concat());
    assert_eq!(again.counters.idf_total_documents.total(), 400);
}

#[test]
fn music_decompose_then_remerge_preserves_counts() {
    let mut snap = MusicBrainSnapshot {
        schema: 1,
        device_id: "dA".into(),
        hlc: Hlc::new(10, 0, "dA"),
        total_plays: GCounter::single("dA", 100),
        ..Default::default()
    };
    snap.genre_affinity.insert("jazz".into(), 0.8);
    let merged = merge_music(std::slice::from_ref(&snap));

    let snap2 = brainmap::merged_music_to_snapshot(&merged, "dA", Hlc::new(20, 0, "dA"));
    let remerged = merge_music(std::slice::from_ref(&snap2));

    assert_eq!(
        remerged.total_plays.total(),
        100,
        "no double-count on relay"
    );
    assert_eq!(remerged.genre_affinity.get("jazz"), Some(&0.8));
}
