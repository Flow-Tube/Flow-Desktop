//! The hybrid clock: a local edit made after applying a record stamped by a clock that runs ahead
//! is still stamped later, and the high-water mark survives a restart.

use serde_json::json;
use sqlx::SqlitePool;

use flow_desktop_lib::profiles::{ActiveProfile, open_database};
use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync::clock;
use flow_desktop_lib::sync::local_edits;
use flow_desktop_lib::sync::protocol::StagedCollection;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

fn default_profile() -> ActiveProfile {
    ActiveProfile {
        id: "default".into(),
        is_default: true,
        after_switch: false,
        default_name: String::new(),
    }
}

/// Applies a like stamped a day ahead of this device's clock, and returns that stamp's time.
async fn apply_like_from_the_future(pool: &SqlitePool) -> u64 {
    let ahead = u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap() + DAY_MS;
    let like = json!({
        "kind": "video", "id": "vid1", "state": "liked", "updatedAtMs": ahead,
        "hlc": format!("{ahead}:0:a1b2c3d4"), "meta": {},
        "title": "Liked ahead", "channelName": "", "thumbnailUrl": ""
    });
    let ndjson = serde_json::to_vec(&like).unwrap();
    let staged = StagedCollection {
        collection: Collection::Likes,
        hash: "ahead".into(),
        record_count: 1,
        ndjson,
    };
    apply_payload(pool, "ddesk", "dpeer", &[staged])
        .await
        .unwrap();
    ahead
}

#[tokio::test]
async fn an_edit_after_a_record_from_a_clock_ahead_is_stamped_later() {
    let dir = std::env::temp_dir().join(format!("flow-clock-{}", uuid::Uuid::new_v4()));
    let pool = open_database(&dir, &default_profile()).await.unwrap();
    let ahead = apply_like_from_the_future(&pool).await;

    local_edits::record_blob_write(&pool, "liked_items", "[]")
        .await
        .unwrap();
    let stamped: i64 = sqlx::query_scalar(
        "SELECT changed_at_ms FROM sync_changes WHERE collection = 'likes' AND deleted = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(u64::try_from(stamped).unwrap() > ahead);
    pool.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn the_clock_keeps_what_it_saw_across_a_restart() {
    let dir = std::env::temp_dir().join(format!("flow-clock-{}", uuid::Uuid::new_v4()));
    let pool = open_database(&dir, &default_profile()).await.unwrap();
    let ahead = apply_like_from_the_future(&pool).await;
    pool.close().await;

    let reopened = open_database(&dir, &default_profile()).await.unwrap();
    assert_eq!(clock::edit_ms(&reopened).await.unwrap(), ahead + 1);
    reopened.close().await;
    std::fs::remove_dir_all(dir).unwrap();
}
