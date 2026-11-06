//! Backup export/import round-trip tests. The backup commands reuse the sync collection
//! serialization and the atomic CRDT apply pipeline, so these verify the glue: scope →
//! collection selection, the JSON-file representation, restore into an empty database (the
//! data-loss scenario backups exist for), tolerance of junk payloads, and that a deliberate
//! re-restore is never swallowed by the sync_log idempotency guard.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::backup::archive::{Archive, write_archive};
use flow_desktop_lib::backup::build::build_slice;
use flow_desktop_lib::backup::reader::{BackupFile, read_backup_file};
use flow_desktop_lib::commands::backup::{
    RECAP_STATS_ENTRY, SUBSCRIPTION_CHANNELS_KEY, export_backup, import_backup,
};
use flow_desktop_lib::sync::canonical::Collection;

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

/// A profiles-era master keeps Default's data at the top level, so today's importer restores
/// Default and ignores the other profiles' sections.
#[tokio::test]
async fn a_master_with_profiles_restores_default_only_in_the_old_importer() {
    let default_db = memory_pool().await;
    seed(&default_db).await;
    let other_db = memory_pool().await;
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES ('other', 'only in Study', 'chan', 'UCchan', '2025-01-02T00:00:00+00:00',
                 10, 20, 0, 0, '200:0:dlocal')",
    )
    .execute(&other_db)
    .await
    .unwrap();

    let default_part = export_backup(&default_db, "MASTER").await.unwrap();
    let other_part = export_backup(&other_db, "MASTER").await.unwrap();
    let master = serde_json::json!({
        "schemaVersion": 2,
        "scope": "MASTER",
        "settings": {},
        "collections": default_part.collections,
        "manifest": { "format": "flow-master", "version": 1, "defaultId": "d", "profiles": [], "included": ["d", "study"] },
        "profiles": { "study": { "settings": {}, "collections": other_part.collections } },
        "profile_avatars": {},
    });

    let fresh = memory_pool().await;
    import_backup(&fresh, &master).await.unwrap();
    let ids: Vec<String> = sqlx::query_scalar("SELECT video_id FROM watch_history")
        .fetch_all(&fresh)
        .await
        .unwrap();
    assert_eq!(ids, ["v1"]);
}

async fn ledger_months(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM recap_months")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn seed_ledger(pool: &SqlitePool, views: i64) {
    sqlx::query(
        "INSERT OR REPLACE INTO recap_months (source, month, record, estimated)
         VALUES ('video', '2026-09', ?, 0)",
    )
    .bind(format!("{{\"views\":{views}}}"))
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn the_recap_ledger_travels_in_master_backups_only_and_never_by_sync() {
    let pool = memory_pool().await;
    seed_ledger(&pool, 3).await;

    let master = export_backup(&pool, "MASTER").await.unwrap();
    assert!(master.collections.contains_key(RECAP_STATS_ENTRY));
    for scope in ["APP_DATA", "BRAIN"] {
        let export = export_backup(&pool, scope).await.unwrap();
        assert!(!export.collections.contains_key(RECAP_STATS_ENTRY));
    }
    assert!(Collection::ALL.iter().all(|c| c.key() != RECAP_STATS_ENTRY));
}

#[tokio::test]
async fn restoring_the_recap_ledger_replaces_what_is_there() {
    let source = memory_pool().await;
    seed_ledger(&source, 3).await;
    let export = export_backup(&source, "MASTER").await.unwrap();
    let payload = serde_json::json!({ "collections": export.collections });

    let target = memory_pool().await;
    seed_ledger(&target, 99).await;
    sqlx::query(
        "INSERT INTO recap_months (source, month, record, estimated)
         VALUES ('music', '2020-01', '{}', 0)",
    )
    .execute(&target)
    .await
    .unwrap();
    import_backup(&target, &payload).await.unwrap();
    assert_eq!(ledger_months(&target).await, 1);
    let record: String = sqlx::query_scalar("SELECT record FROM recap_months")
        .fetch_one(&target)
        .await
        .unwrap();
    assert!(record.contains("\"views\":3"));
}

#[tokio::test]
async fn an_unreadable_recap_entry_leaves_the_ledger_alone() {
    let pool = memory_pool().await;
    seed_ledger(&pool, 3).await;
    let payload = serde_json::json!({ "collections": { RECAP_STATS_ENTRY: ["junk"] } });
    import_backup(&pool, &payload).await.unwrap();
    assert_eq!(ledger_months(&pool).await, 1);
}

async fn restore_through_a_zip(source: &SqlitePool, target: &SqlitePool) -> Vec<String> {
    let dir = std::env::temp_dir().join(format!("flow-roundtrip-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("master.zip");
    let archive = Archive {
        root: build_slice(source, "MASTER", &[], true, 1_000)
            .await
            .unwrap(),
        manifest: None,
        profiles: Vec::new(),
        avatars: Vec::new(),
    };
    write_archive(&path, &archive).unwrap();
    let zip = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
    let names = zip.file_names().map(str::to_string).collect();
    let BackupFile::Backup(backup) = read_backup_file(&path, 2_000).unwrap() else {
        panic!("a master reads as a backup");
    };
    std::fs::remove_dir_all(&dir).unwrap();
    import_backup(
        target,
        &serde_json::json!({ "collections": backup["collections"] }),
    )
    .await
    .unwrap();
    names
}

#[tokio::test]
async fn a_note_and_a_ledger_survive_a_desktop_zip_round_trip() {
    let source = memory_pool().await;
    for (id, target, text) in [
        (
            "video:abc12345678",
            "abc12345678",
            "12:34 the good part\nand this",
        ),
        ("video:gone1234567", "gone1234567", "Deleted later"),
    ] {
        sqlx::query(
            "INSERT INTO notes (id, target_id, kind, text, updated_at, title)
             VALUES (?, ?, 'Video', ?, 1700000000000, 'A video')",
        )
        .bind(id)
        .bind(target)
        .bind(text)
        .execute(&source)
        .await
        .unwrap();
    }
    // A deletion as it arrives from a peer. Its time has to be recent: tombstones expire after a year.
    let tombstone = serde_json::json!({
        "id": "video:gone1234567", "deleted": true,
        "updatedAt": chrono::Utc::now().timestamp_millis(),
    });
    import_backup(
        &source,
        &serde_json::json!({ "collections": { "notes": [tombstone] } }),
    )
    .await
    .unwrap();
    seed_ledger(&source, 3).await;

    let target = memory_pool().await;
    seed_ledger(&target, 99).await;
    let names = restore_through_a_zip(&source, &target).await;
    assert!(names.iter().any(|name| name == "recap_stats.json"));

    let notes: Vec<(String, String, i64, String)> =
        sqlx::query_as("SELECT id, text, updated_at, title FROM notes")
            .fetch_all(&target)
            .await
            .unwrap();
    assert_eq!(
        notes,
        [(
            "video:abc12345678".to_string(),
            "12:34 the good part\nand this".to_string(),
            1_700_000_000_000,
            "A video".to_string(),
        )]
    );
    let restored = export_backup(&target, "APP_DATA").await.unwrap();
    let deletion = restored.collections["notes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|note| note["id"] == "video:gone1234567")
        .expect("the deletion comes along, so a peer's copy can't bring the note back");
    assert_eq!(deletion["deleted"], true);

    let record: String = sqlx::query_scalar("SELECT record FROM recap_months")
        .fetch_one(&target)
        .await
        .unwrap();
    assert!(record.contains("\"views\":3"), "replaced, not added to");
}

#[tokio::test]
async fn a_ledger_that_never_started_is_no_entry_and_leaves_the_target_alone() {
    let source = memory_pool().await;
    let target = memory_pool().await;
    seed_ledger(&target, 99).await;
    let names = restore_through_a_zip(&source, &target).await;
    assert!(!names.iter().any(|name| name == "recap_stats.json"));
    let record: String = sqlx::query_scalar("SELECT record FROM recap_months")
        .fetch_one(&target)
        .await
        .unwrap();
    assert!(record.contains("\"views\":99"));
}
