//! Resetting a linked device's data leaves its group first and records no deletions, so the reset
//! never reaches the other devices.

mod sync2_common;

use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::local_edits;
use flow_desktop_lib::sync2::actions::reset_local_data;
use flow_desktop_lib::sync2::state::load_group;
use sync2_common::{device_pool, group};

#[tokio::test]
async fn a_reset_leaves_the_group_and_announces_no_deletions() {
    let g = group().await;
    let pool = device_pool(&g).await;
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, watch_date, watch_duration_seconds)
         VALUES ('aaaaaaaaaaa', 'title', '2025-01-01T00:00:00+00:00', 10)",
    )
    .execute(&pool)
    .await
    .unwrap();
    local_edits::record_blob_write(
        &pool,
        "user_playlists",
        r#"[{"id":"p1","title":"Mix","videos":[]}]"#,
    )
    .await
    .unwrap();

    reset_local_data(&pool, true).await.unwrap();

    assert!(load_group(&pool).await.unwrap().is_none());
    let recorded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_changes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(recorded, 0);
    let history = export_collections(&pool, "desk", &[Collection::WatchHistory])
        .await
        .unwrap();
    assert!(
        history[0].ndjson.is_empty(),
        "no history and no tombstones to send"
    );
}
