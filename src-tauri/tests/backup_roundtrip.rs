//! Backup export/import round-trip tests. The backup commands reuse the sync collection
//! serialization and the atomic CRDT apply pipeline, so these verify the glue: scope →
//! collection selection, the JSON-file representation, restore into an empty database (the
//! data-loss scenario backups exist for), tolerance of junk payloads, and that a deliberate
//! re-restore is never swallowed by the sync_log idempotency guard.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::commands::backup::{SUBSCRIPTION_CHANNELS_KEY, export_backup, import_backup};

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind("2025-01-01T00:00:00+00:00")
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

async fn history_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM watch_history")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn seed(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES ('v1', 'title one', 'chan', 'UCchan', '2025-01-01T00:00:00+00:00',
                 100, 200, 0, 0, '100:0:dlocal')",
    )
    .execute(pool)
    .await
    .unwrap();
    set_setting(
        pool,
        "liked_items",
        r#"[{"id":"v1","kind":"video","likedAt":"2025-01-01T00:00:00+00:00","video":{"id":"v1","title":"title one"}}]"#,
    )
    .await;
    set_setting(
        pool,
        "subscriptions",
        r#"[{"id":"UCabc","name":"Some Channel","avatarUrl":""}]"#,
    )
    .await;
    set_setting(pool, "autoplay_enabled", "false").await;
}

#[tokio::test]
async fn master_export_import_round_trips_into_an_empty_database() {
    let source = memory_pool().await;
    seed(&source).await;

    let exported = export_backup(&source, "MASTER").await.unwrap();
    assert!(exported.collections.contains_key("watch_history"));
    assert!(exported.collections.contains_key(SUBSCRIPTION_CHANNELS_KEY));

    let target = memory_pool().await;
    let payload = serde_json::json!({ "collections": exported.collections });
    let summary = import_backup(&target, &payload).await.unwrap();

    assert_eq!(history_count(&target).await, 1);
    assert!(
        get_setting(&target, "liked_items")
            .await
            .unwrap()
            .contains("v1")
    );
    assert!(
        get_setting(&target, "subscriptions")
            .await
            .unwrap()
            .contains("UCabc")
    );
    assert_eq!(
        get_setting(&target, "autoplay_enabled").await.as_deref(),
        Some("false")
    );

    let watch_stat = summary
        .collections
        .iter()
        .find(|s| s.collection == "watch_history")
        .unwrap();
    assert_eq!(watch_stat.added, 1);
}

#[tokio::test]
async fn brain_scope_exports_only_the_two_brains() {
    let pool = memory_pool().await;
    seed(&pool).await;
    let exported = export_backup(&pool, "BRAIN").await.unwrap();
    let keys: Vec<&String> = exported.collections.keys().collect();
    assert_eq!(keys, vec!["flow_neuro_brain", "music_brain"]);
}

#[tokio::test]
async fn app_data_scope_excludes_watch_history() {
    let pool = memory_pool().await;
    seed(&pool).await;
    let exported = export_backup(&pool, "APP_DATA").await.unwrap();
    assert!(!exported.collections.contains_key("watch_history"));
    assert!(exported.collections.contains_key("settings"));
    assert!(exported.collections.contains_key("likes"));
    assert!(exported.collections.contains_key(SUBSCRIPTION_CHANNELS_KEY));
}

#[tokio::test]
async fn unknown_scope_is_rejected() {
    let pool = memory_pool().await;
    assert!(export_backup(&pool, "bogus").await.is_err());
}

#[tokio::test]
async fn import_is_tolerant_of_unknown_keys_and_malformed_records() {
    let pool = memory_pool().await;
    let payload = serde_json::json!({
        "collections": {
            "not_a_real_collection": [{ "whatever": 1 }],
            "watch_history": [
                { "definitely": "not a watch record" },
            ],
            SUBSCRIPTION_CHANNELS_KEY: [
                { "id": "UCnew", "name": "New Channel" },
                { "noId": true },
            ],
        }
    });
    let summary = import_backup(&pool, &payload).await.unwrap();

    let dropped = summary
        .collections
        .iter()
        .find(|s| s.collection == "watch_history")
        .unwrap();
    assert_eq!(dropped.skipped, 1);
    assert_eq!(dropped.added, 0);
    assert_eq!(history_count(&pool).await, 0);

    let channels = summary
        .collections
        .iter()
        .find(|s| s.collection == SUBSCRIPTION_CHANNELS_KEY)
        .unwrap();
    assert_eq!(channels.added, 1);
    assert_eq!(channels.skipped, 1);
}

#[tokio::test]
async fn reimporting_the_same_backup_still_applies_after_a_data_wipe() {
    let source = memory_pool().await;
    seed(&source).await;
    let exported = export_backup(&source, "MASTER").await.unwrap();
    let payload = serde_json::json!({ "collections": exported.collections });

    let target = memory_pool().await;
    import_backup(&target, &payload).await.unwrap();
    sqlx::query("DELETE FROM watch_history")
        .execute(&target)
        .await
        .unwrap();

    // The second import must not be swallowed by the sync_log idempotency guard.
    import_backup(&target, &payload).await.unwrap();
    assert_eq!(history_count(&target).await, 1);
}

#[tokio::test]
async fn channel_list_import_unions_by_id_and_keeps_local_entries() {
    let pool = memory_pool().await;
    set_setting(
        &pool,
        "subscriptions",
        r#"[{"id":"UCabc","name":"Local Name","avatarUrl":"local.png"}]"#,
    )
    .await;

    let payload = serde_json::json!({
        "collections": {
            SUBSCRIPTION_CHANNELS_KEY: [
                { "id": "UCabc", "name": "Backup Name" },
                { "id": "UCnew", "name": "New Channel" },
            ],
        }
    });
    import_backup(&pool, &payload).await.unwrap();

    let subs = get_setting(&pool, "subscriptions").await.unwrap();
    assert!(subs.contains("Local Name")); // local entry wins on conflict
    assert!(!subs.contains("Backup Name"));
    assert!(subs.contains("UCnew"));
}
