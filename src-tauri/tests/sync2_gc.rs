//! FLOW-SYNC/2 garbage collection against the in-memory store: a device deletes its own old log
//! objects only after the other device acknowledged them and a snapshot covers them.

mod sync2_common;

use flow_desktop_lib::sync2::engine::Session;
use flow_desktop_lib::sync2::paths::log_path;
use sqlx::SqlitePool;
use sync2_common::{MemoryStore, device_pool, exported, group};

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

fn has(store: &MemoryStore, path: &str) -> bool {
    store.0.lock().unwrap().objects.contains_key(path)
}

async fn read_all(pool: &SqlitePool, session: &mut Session<'_, &MemoryStore>) {
    let pulled = session.pull(pool).await.unwrap();
    session.finish(pool, pulled).await.unwrap();
}

#[tokio::test]
async fn old_objects_go_once_acknowledged_and_covered_by_a_snapshot() {
    let g = group().await;
    let (pool_a, pool_b) = (device_pool(&g).await, device_pool(&g).await);
    let mut a = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let mut b = Session::open(&pool_b, &g.store, &g.b).await.unwrap();
    let first = log_path(&hex::encode(g.a.did), 1);

    watched(&pool_a, "aaaaaaaaaaa").await;
    a.push(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    a.collect_garbage(&pool_a).await.unwrap();
    assert!(has(&g.store, &first), "nobody acknowledged it yet");

    read_all(&pool_b, &mut b).await;
    read_all(&pool_a, &mut a).await;
    a.collect_garbage(&pool_a).await.unwrap();
    assert!(has(&g.store, &first), "no snapshot covers it yet");

    a.write_snapshot(&pool_a, exported(&pool_a, "app-a").await)
        .await
        .unwrap();
    let manifest = log_path(
        &hex::encode(g.a.did),
        u64::try_from(a.record().own_seq).unwrap(),
    );
    read_all(&pool_b, &mut b).await;
    read_all(&pool_a, &mut a).await;
    a.collect_garbage(&pool_a).await.unwrap();
    assert!(!has(&g.store, &first));
    assert!(has(&g.store, &manifest), "the newest snapshot stays");
    assert!(
        has(&g.store, &log_path(&hex::encode(g.b.did), 1)),
        "another device's log is not this device's to delete"
    );
}
