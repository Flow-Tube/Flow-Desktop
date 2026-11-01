//! A profile other than Default applies batches into its own database, while the group's record
//! of what was sent stays in Default's. Runs in its own test binary because the device pool is
//! process-wide.

mod sync2_common;

use flow_desktop_lib::profiles::{ActiveProfile, open_database};
use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync2::batches::{apply_batches, batch_content, parse_batch};
use sqlx::SqlitePool;
use sync2_common::{empty_pool, exported, watch, watched};

async fn sent_rows(path: &std::path::Path) -> i64 {
    let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
        .await
        .unwrap();
    let rows = sqlx::query_scalar("SELECT COUNT(*) FROM sync2_sent_links")
        .fetch_one(&pool)
        .await
        .unwrap();
    pool.close().await;
    rows
}

#[tokio::test]
async fn applied_records_count_as_sent_in_defaults_database() {
    let dir = std::env::temp_dir().join(format!("flow-sync2-state-{}", uuid::Uuid::new_v4()));
    let study = ActiveProfile {
        id: "study".into(),
        is_default: false,
        after_switch: false,
        default_name: String::new(),
    };
    let pool = open_database(&dir, &study).await.unwrap();

    let sender = empty_pool().await;
    watch(&sender, "aaaaaaaaaaa").await;
    let history = exported(&sender, "app-a")
        .await
        .into_iter()
        .find(|c| c.collection == Collection::WatchHistory)
        .unwrap();
    let records: Vec<&[u8]> = history.ndjson.split(|&b| b == b'\n').collect();
    let content = batch_content(Collection::WatchHistory, "head", "link", &records);
    let batch = parse_batch(&content).unwrap();
    apply_batches(&pool, "app-b", "sender", &[batch], 0)
        .await
        .unwrap();
    assert_eq!(watched(&pool).await, ["aaaaaaaaaaa"]);
    pool.close().await;

    assert_eq!(sent_rows(&dir.join("flow-desktop.sqlite")).await, 1);
    assert_eq!(
        sent_rows(&dir.join("profiles/study/flow-desktop.sqlite")).await,
        0
    );
    std::fs::remove_dir_all(dir).unwrap();
}
