//! FLOW-SYNC/2 change batches: only changed records go out, the ledger moves only after an
//! upload, and batches from another device apply through the FLOW-SYNC/1 merges.

use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync2::batches::{apply_batches, mark_sent, outgoing_batches, parse_batch};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

const HEAD: &str = "00000000000000000000000000000000000000000000000000000000000000aa";
const LINK: &str = "default-link";

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn insert_watch(pool: &SqlitePool, id: &str, watched: i64) {
    let updated = sqlx::query(
        "UPDATE watch_history SET watch_duration_seconds = ?, updated_hlc = '200:0:dA' WHERE video_id = ?",
    )
    .bind(watched)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    if updated.rows_affected() > 0 {
        return;
    }
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES (?, ?, NULL, NULL, '2025-01-01T00:00:00+00:00', ?, 600, 0, 0, '100:0:dA')",
    )
    .bind(id)
    .bind(format!("title-{id}"))
    .bind(watched)
    .execute(pool)
    .await
    .unwrap();
}

async fn watched_ids(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT video_id FROM watch_history ORDER BY video_id")
        .fetch_all(pool)
        .await
        .unwrap()
}

fn records(content: &[u8]) -> usize {
    content
        .split(|&b| b == b'\n')
        .skip(1)
        .filter(|l| !l.is_empty())
        .count()
}

#[tokio::test]
async fn only_records_changed_since_the_last_upload_go_out() {
    let pool = memory_pool().await;
    insert_watch(&pool, "aaaaaaaaaaa", 10).await;
    insert_watch(&pool, "bbbbbbbbbbb", 20).await;

    let first = outgoing_batches(
        &pool,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    assert_eq!(first.batches.len(), 1);
    assert_eq!(records(&first.batches[0].content), 2);

    let unsent = outgoing_batches(
        &pool,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    assert_eq!(
        records(&unsent.batches[0].content),
        2,
        "nothing is marked sent before the upload succeeds"
    );

    mark_sent(&pool, &first).await.unwrap();
    let idle = outgoing_batches(
        &pool,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    assert!(idle.batches.is_empty());

    insert_watch(&pool, "aaaaaaaaaaa", 300).await;
    let changed = outgoing_batches(
        &pool,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    assert_eq!(records(&changed.batches[0].content), 1);
}

#[tokio::test]
async fn large_collections_are_split_into_batches_of_a_thousand() {
    let pool = memory_pool().await;
    for i in 0..2500 {
        insert_watch(&pool, &format!("{i:011}"), 1).await;
    }
    let out = outgoing_batches(
        &pool,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    let sizes: Vec<usize> = out.batches.iter().map(|b| records(&b.content)).collect();
    assert_eq!(sizes, [1000, 1000, 500]);
}

#[tokio::test]
async fn batches_from_another_device_apply_through_the_merges() {
    let sender = memory_pool().await;
    insert_watch(&sender, "aaaaaaaaaaa", 10).await;
    let out = outgoing_batches(
        &sender,
        "device-a",
        &[Collection::WatchHistory],
        HEAD,
        LINK,
        0,
    )
    .await
    .unwrap();
    let incoming: Vec<_> = out
        .batches
        .iter()
        .map(|b| parse_batch(&b.content).unwrap())
        .collect();
    assert_eq!(incoming[0].collection, Some(Collection::WatchHistory));
    assert_eq!(incoming[0].link.as_deref(), Some(LINK));
    assert_eq!(incoming[0].head, HEAD);

    let receiver = memory_pool().await;
    let report = apply_batches(&receiver, "device-b", "sender-did", &incoming, 0)
        .await
        .unwrap();
    assert_eq!(report.stats[0].added, 1);
    assert_eq!(watched_ids(&receiver).await, ["aaaaaaaaaaa"]);
    apply_batches(&receiver, "device-b", "sender-did", &incoming, 0)
        .await
        .unwrap();
    assert_eq!(
        watched_ids(&receiver).await,
        ["aaaaaaaaaaa"],
        "applying twice changes nothing"
    );
}

#[tokio::test]
async fn unknown_collections_are_consumed_without_effect() {
    let receiver = memory_pool().await;
    let content = format!(
        "{{\"collection\":\"notes\",\"head\":\"{HEAD}\",\"link\":\"{LINK}\"}}\n{{\"id\":\"n1\"}}"
    );
    let batch = parse_batch(content.as_bytes()).unwrap();
    assert_eq!(batch.collection, None);
    let report = apply_batches(&receiver, "device-b", "sender-did", &[batch], 0)
        .await
        .unwrap();
    assert!(report.stats.is_empty());
}

#[test]
fn a_header_with_unknown_fields_is_rejected() {
    let content =
        format!("{{\"collection\":\"likes\",\"head\":\"{HEAD}\",\"link\":null,\"extra\":1}}\n");
    assert!(parse_batch(content.as_bytes()).is_err());
}

#[tokio::test]
async fn a_brain_whose_only_change_is_its_export_time_is_not_sent_again() {
    let pool = memory_pool().await;
    let brain = [Collection::MusicBrain];
    let first = outgoing_batches(&pool, "device-a", &brain, HEAD, LINK, 0)
        .await
        .unwrap();
    assert_eq!(first.batches.len(), 1);
    mark_sent(&pool, &first).await.unwrap();
    let hours = |h: i64| h * 60 * 60 * 1000;
    let later = outgoing_batches(&pool, "device-a", &brain, HEAD, LINK, hours(7))
        .await
        .unwrap();
    assert!(later.batches.is_empty());
}
