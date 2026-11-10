//! FLOW-SYNC/2 and notes: a notes batch from Flow for Android must reach the snapshot this device
//! writes, because Android's garbage collection deletes a log once any acknowledged snapshot covers
//! it, and a new device starts from the newest snapshot that covers the logs.

mod sync2_common;

use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync2::batches::{
    apply_batches, batch_content, mark_sent, outgoing_batches, parse_batch,
};
use flow_desktop_lib::sync2::engine::{Session, now_ms};
use flow_desktop_lib::sync2::missed_notes::{notes_caught_up, notes_missed};
use flow_desktop_lib::sync2::paths::log_path;
use flow_desktop_lib::sync2::snapshot::{note_merged, snapshot_due};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use sync2_common::{LINK, device_pool, exported, group};

const HEAD: &str = "00000000000000000000000000000000000000000000000000000000000000aa";
const ANDROID_NOTE: &str = r#"{"channelAvatarUrl":null,"channelHandle":null,"channelId":"UCx","channelName":"A channel","deleted":false,"durationSeconds":754,"id":"video:abc123def45","kind":"Video","subscriberCountText":null,"targetId":"abc123def45","text":"12:34 the good part","thumbnailUrl":null,"title":"A video","updatedAt":1700000000000}"#;
const ANDROID_CHANNEL_NOTE: &str = r#"{"channelAvatarUrl":null,"channelHandle":null,"channelId":null,"channelName":null,"deleted":false,"durationSeconds":null,"id":"channel:UCx","kind":"Channel","subscriberCountText":null,"targetId":"UCx","text":"why I follow them","thumbnailUrl":null,"title":"A channel","updatedAt":1700000001000}"#;

async fn notes(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT id FROM notes ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// What Android's `batchContent` writes for these records.
fn android_batch(lines: &[&str]) -> Vec<u8> {
    batch_content("notes", HEAD, Some(LINK), lines)
}

/// The data-loss path: Android's batch arrives here, this device snapshots, Android's log goes,
/// and a new device starts from this device's snapshot alone.
#[tokio::test]
async fn android_notes_reach_a_new_device_through_this_device_s_snapshot() {
    let g = group().await;
    let desktop = device_pool(&g).await;

    let batch = parse_batch(&android_batch(&[ANDROID_NOTE, ANDROID_CHANNEL_NOTE])).unwrap();
    assert_eq!(batch.collection, Some(Collection::Notes));
    apply_batches(&desktop, "app-a", "android-did", &[batch], now_ms())
        .await
        .unwrap();
    assert_eq!(notes(&desktop).await, ["channel:UCx", "video:abc123def45"]);

    let mut session = Session::open(&desktop, &g.store, &g.a).await.unwrap();
    session
        .push(&desktop, exported(&desktop, "app-a").await)
        .await
        .unwrap();
    let pushed = u64::try_from(session.record().own_seq).unwrap();
    session
        .write_snapshot(&desktop, exported(&desktop, "app-a").await)
        .await
        .unwrap();
    // Garbage collection: this device's first log objects are gone, so only the snapshot has them.
    for seq in 1..=pushed {
        g.store.take(&log_path(&hex::encode(g.a.did), seq));
    }

    let new_device = device_pool(&g).await;
    let mut reader = Session::open(&new_device, &g.store, &g.b).await.unwrap();
    let pulled = reader.pull(&new_device).await.unwrap();
    for (sender, batches) in &pulled.batches {
        apply_batches(&new_device, "app-b", sender, batches, now_ms())
            .await
            .unwrap();
    }
    assert_eq!(
        notes(&new_device).await,
        ["channel:UCx", "video:abc123def45"]
    );
    let line = exported(&new_device, "app-b").await;
    let wire = line
        .iter()
        .find(|c| c.collection == Collection::Notes)
        .unwrap();
    assert_eq!(
        String::from_utf8(wire.ndjson.clone()).unwrap(),
        format!("{ANDROID_CHANNEL_NOTE}\n{ANDROID_NOTE}"),
        "every field survives the trip, byte for byte"
    );
}

#[tokio::test]
async fn a_note_received_is_not_sent_back_and_an_edit_is() {
    let g = group().await;
    let pool = device_pool(&g).await;
    let batch = parse_batch(&android_batch(&[ANDROID_NOTE])).unwrap();
    apply_batches(&pool, "app-a", "android-did", &[batch], 1)
        .await
        .unwrap();
    let export = |pool: SqlitePool| async move {
        flow_desktop_lib::sync::export::export_collections(&pool, "app-a", &[Collection::Notes])
            .await
            .unwrap()
    };
    let out = outgoing_batches(&pool, export(pool.clone()).await, HEAD, LINK, 2)
        .await
        .unwrap();
    assert!(out.batches.is_empty(), "the group already knows this note");

    sqlx::query("UPDATE notes SET text = 'edited', updated_at = updated_at + 1")
        .execute(&pool)
        .await
        .unwrap();
    let out = outgoing_batches(&pool, export(pool.clone()).await, HEAD, LINK, 3)
        .await
        .unwrap();
    assert_eq!(out.batches.len(), 1);
    mark_sent(&pool, &out).await.unwrap();
    let again = outgoing_batches(&pool, export(pool.clone()).await, HEAD, LINK, 4)
        .await
        .unwrap();
    assert!(again.batches.is_empty());
}

/// A build without notes moved past Android's batches and dropped them, and Android won't send an
/// unchanged note again. After the update they come back from what the store still keeps.
#[tokio::test]
async fn notes_a_build_without_them_read_past_come_back_from_the_store() {
    let g = group().await;
    let android = device_pool(&g).await;
    sqlx::query(
        "INSERT INTO notes (id, target_id, kind, text, updated_at) VALUES ('video:one', 'one', 'Video', 'first', 1000)",
    )
    .execute(&android)
    .await
    .unwrap();
    let mut writer = Session::open(&android, &g.store, &g.a).await.unwrap();
    writer
        .push(&android, exported(&android, "app-a").await)
        .await
        .unwrap();
    // Android's snapshot holds the first note; a later batch holds the second.
    writer
        .write_snapshot(&android, exported(&android, "app-a").await)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO notes (id, target_id, kind, text, updated_at) VALUES ('video:two', 'two', 'Video', 'second', 2000)",
    )
    .execute(&android)
    .await
    .unwrap();
    writer
        .push(&android, exported(&android, "app-a").await)
        .await
        .unwrap();

    let desktop = device_pool(&g).await;
    let mut reader = Session::open(&desktop, &g.store, &g.b).await.unwrap();
    let pulled = reader.pull(&desktop).await.unwrap();
    // The old build moved on without applying anything.
    reader.finish(&desktop, pulled).await.unwrap();
    assert!(notes(&desktop).await.is_empty());
    assert!(reader.pull(&desktop).await.unwrap().batches.is_empty());

    sqlx::query("INSERT INTO settings (key, value) VALUES ('sync2_notes_missed', '1')")
        .execute(&desktop)
        .await
        .unwrap();
    assert!(notes_missed(&desktop).await.unwrap());
    let read = reader.missed_notes(&desktop, LINK).await.unwrap();
    assert!(
        read.iter()
            .all(|k| k.batch.collection == Some(Collection::Notes))
    );
    for kept in &read {
        apply_batches(
            &desktop,
            "app-b",
            &kept.sender,
            std::slice::from_ref(&kept.batch),
            now_ms(),
        )
        .await
        .unwrap();
    }
    assert_eq!(notes(&desktop).await, ["video:one", "video:two"]);
    notes_caught_up(&desktop).await.unwrap();
    assert!(!notes_missed(&desktop).await.unwrap());
}

/// Objects garbage collection already took are skipped, not waited for.
#[tokio::test]
async fn reading_missed_notes_skips_what_the_store_no_longer_has() {
    let g = group().await;
    let android = device_pool(&g).await;
    sqlx::query(
        "INSERT INTO notes (id, target_id, kind, text, updated_at) VALUES ('video:one', 'one', 'Video', 'first', 1000)",
    )
    .execute(&android)
    .await
    .unwrap();
    let mut writer = Session::open(&android, &g.store, &g.a).await.unwrap();
    writer
        .push(&android, exported(&android, "app-a").await)
        .await
        .unwrap();
    let seq = u64::try_from(writer.record().own_seq).unwrap();
    let desktop = device_pool(&g).await;
    let mut reader = Session::open(&desktop, &g.store, &g.b).await.unwrap();
    let pulled = reader.pull(&desktop).await.unwrap();
    reader.finish(&desktop, pulled).await.unwrap();
    g.store.take(&log_path(&hex::encode(g.a.did), seq));

    let read = reader.missed_notes(&desktop, LINK).await.unwrap();
    assert!(read.is_empty());
}

/// A database that already has a group when the migration runs.
#[tokio::test]
async fn updating_marks_notes_as_missed_and_asks_for_a_snapshot() {
    let g = group().await;
    let pool = device_pool(&g).await;
    note_merged(&pool, LINK, 1).await.unwrap();
    assert!(!notes_missed(&pool).await.unwrap());
    assert!(!snapshot_due(&pool, LINK).await.unwrap());

    sqlx::raw_sql(include_str!("../migrations/0041_notes.sql"))
        .execute(&pool)
        .await
        .unwrap();
    assert!(notes_missed(&pool).await.unwrap());
    assert!(snapshot_due(&pool, LINK).await.unwrap());
}

#[tokio::test]
async fn a_database_without_a_group_has_nothing_to_read_again() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    assert!(!notes_missed(&pool).await.unwrap());
}
