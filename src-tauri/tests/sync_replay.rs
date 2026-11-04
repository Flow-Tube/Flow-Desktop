//! A payload applied before applies again over FLOW-SYNC/2, whose stream positions already stop
//! a batch from applying twice, while FLOW-SYNC/1 sessions keep skipping a brain they applied.

use serde_json::Value;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::{apply_payload, apply_stream_payload};
use flow_desktop_lib::sync::canonical::{Collection, to_canonical_json};
use flow_desktop_lib::sync::protocol::StagedCollection;

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn music_brain() -> StagedCollection {
    let raw = std::fs::read_to_string("tests/fixtures/sync/music_brain.json").unwrap();
    let ndjson = to_canonical_json(&serde_json::from_str::<Value>(&raw).unwrap());
    StagedCollection {
        collection: Collection::MusicBrain,
        hash: "same-payload".into(),
        record_count: 1,
        ndjson,
    }
}

/// What a reset leaves: no merged brain.
async fn reset_brain(pool: &SqlitePool) {
    sqlx::query("DELETE FROM settings WHERE key IN ('sync_music_merged', 'user_music_brain')")
        .execute(pool)
        .await
        .unwrap();
}

async fn has_brain(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'sync_music_merged'")
        .fetch_optional(pool)
        .await
        .unwrap()
        .is_some()
}

#[tokio::test]
async fn a_brain_seen_before_applies_again_from_a_linked_device() {
    let pool = memory_pool().await;
    apply_stream_payload(&pool, "desk", "phone", &[music_brain()])
        .await
        .unwrap();
    reset_brain(&pool).await;
    apply_stream_payload(&pool, "desk", "phone", &[music_brain()])
        .await
        .unwrap();
    assert!(has_brain(&pool).await);
}

#[tokio::test]
async fn a_flow_sync_1_session_still_skips_a_brain_it_applied() {
    let pool = memory_pool().await;
    apply_payload(&pool, "desk", "phone", &[music_brain()])
        .await
        .unwrap();
    reset_brain(&pool).await;
    apply_payload(&pool, "desk", "phone", &[music_brain()])
        .await
        .unwrap();
    assert!(!has_brain(&pool).await);
}
