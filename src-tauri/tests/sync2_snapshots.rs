//! FLOW-SYNC/2 snapshots: when a device writes one, and that it holds the whole state of its link.

mod sync2_common;

use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync2::batches::parse_batch;
use flow_desktop_lib::sync2::blob::open_blob;
use flow_desktop_lib::sync2::engine::Session;
use flow_desktop_lib::sync2::envelope::{ObjectType, open_object, parse_object};
use flow_desktop_lib::sync2::epoch::purpose_key;
use flow_desktop_lib::sync2::paths::{blob_path, log_path};
use flow_desktop_lib::sync2::payload::decode_payload;
use flow_desktop_lib::sync2::snapshot::{Manifest, note_merged, snapshot_due, snapshot_soon};
use sqlx::SqlitePool;
use sync2_common::{Group, LINK, device_pool, exported, group};

async fn watched(pool: &SqlitePool, video: &str) {
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, 'title', NULL, NULL, '2025-01-01T00:00:00+00:00', 10, 600, 0, 0, '100:0:dA')",
    )
    .bind(video)
    .execute(pool)
    .await
    .unwrap();
}

/// Opens object `seq` of device A's log with the group's first epoch key.
fn open_log_object(g: &Group, seq: u64, object_type: ObjectType) -> Vec<u8> {
    let bytes = g.store.0.lock().unwrap().objects[&log_path(&hex::encode(g.a.did), seq)]
        .1
        .clone();
    let object = parse_object(&bytes, &g.group).unwrap();
    assert_eq!(object.header.object_type, object_type);
    let key = purpose_key(&g.epoch_key, &g.group, 0, object_type.purpose());
    decode_payload(&open_object(&object, &key).unwrap()).unwrap()
}

#[tokio::test]
async fn a_snapshot_holds_every_record_and_the_logs_it_covers() {
    let g = group().await;
    let pool = device_pool(&g).await;
    watched(&pool, "aaaaaaaaaaa").await;
    watched(&pool, "bbbbbbbbbbb").await;
    let mut session = Session::open(&pool, &g.store, &g.a).await.unwrap();
    session
        .push(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
    let (pushed, last_hash) = (session.record().own_seq, session.record().own_prev.clone());
    session
        .write_snapshot(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
    assert_eq!(session.record().own_seq, pushed + 1);

    let manifest: Manifest = serde_json::from_slice(&open_log_object(
        &g,
        u64::try_from(pushed + 1).unwrap(),
        ObjectType::Snapshot,
    ))
    .unwrap();
    assert_eq!(manifest.link.as_deref(), Some(LINK));
    let tip = &manifest.vv[&hex::encode(g.a.did)];
    assert_eq!(tip.seq, u64::try_from(pushed).unwrap());
    assert_eq!(tip.hash, last_hash);
    let snapshot_key = purpose_key(&g.epoch_key, &g.group, 0, ObjectType::Snapshot.purpose());
    let part = manifest
        .parts
        .iter()
        .find(|p| p.collection == "watch_history")
        .unwrap();
    let blob = g.store.0.lock().unwrap().objects[&blob_path(&hex::encode(g.a.did), &part.blob)]
        .1
        .clone();
    let hash = hex::decode(&part.blob).unwrap();
    let content =
        decode_payload(&open_blob(&snapshot_key, &g.group, 0, &g.a.did, &blob, &hash).unwrap())
            .unwrap();
    let batch = parse_batch(&content).unwrap();
    assert_eq!(batch.link.as_deref(), Some(LINK));
    let text = String::from_utf8(content).unwrap();
    assert!(text.contains("aaaaaaaaaaa") && text.contains("bbbbbbbbbbb"));
}

#[tokio::test]
async fn a_snapshot_is_due_after_a_megabyte_a_week_or_a_removal() {
    let g = group().await;
    let pool = device_pool(&g).await;
    assert!(!snapshot_due(&pool, LINK).await.unwrap());
    note_merged(&pool, LINK, 1000).await.unwrap();
    assert!(!snapshot_due(&pool, LINK).await.unwrap());
    note_merged(&pool, LINK, 1024 * 1024).await.unwrap();
    assert!(snapshot_due(&pool, LINK).await.unwrap());

    let mut session = Session::open(&pool, &g.store, &g.a).await.unwrap();
    session
        .write_snapshot(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
    assert!(!snapshot_due(&pool, LINK).await.unwrap());
    sqlx::query("UPDATE sync2_snapshots SET written_ms = written_ms - 7 * 24 * 60 * 60 * 1000")
        .execute(&pool)
        .await
        .unwrap();
    assert!(snapshot_due(&pool, LINK).await.unwrap());
    session
        .write_snapshot(&pool, exported(&pool, "app-a").await)
        .await
        .unwrap();
    snapshot_soon(&pool).await.unwrap();
    assert!(snapshot_due(&pool, LINK).await.unwrap());
}

#[tokio::test]
async fn other_devices_read_past_a_snapshot_manifest() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    watched(&pool_a, "aaaaaaaaaaa").await;
    let mut session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    session
        .write_snapshot(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    session
        .push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();

    let pool_b = device_pool(&g).await;
    let mut reader = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let pulled = reader.pull(&pool_b).await.unwrap();
    assert!(
        pulled.batches[&hex::encode(g.a.did)]
            .iter()
            .any(|b| b.collection == Some(Collection::WatchHistory))
    );
}
