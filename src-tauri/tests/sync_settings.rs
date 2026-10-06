//! Settings travel under Flow for Android's canonical keys with typed values, local changes keep
//! their real timestamp, and the video codec preference never syncs.

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{Collection, Hlc, SettingEntry};
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::protocol::StagedCollection;

const OUR: &str = "dlocal";
const PEER: &str = "dpeer";

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

/// Writes the way the app's `set_setting` does: `updated_at` is SQLite's offset-less
/// `CURRENT_TIMESTAMP`.
async fn set_like_the_app(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn stored(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap()
}

fn entry(key: &str, value: Value, ms: u64) -> SettingEntry {
    SettingEntry {
        key: key.to_string(),
        value,
        hlc: Hlc::new(ms, 0, PEER),
    }
}

fn staged(entries: &[SettingEntry], hash: &str) -> StagedCollection {
    let ndjson = entries
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    StagedCollection {
        collection: Collection::Settings,
        ndjson: ndjson.into_bytes(),
        record_count: entries.len() as u64,
        hash: hash.to_string(),
    }
}

#[tokio::test]
async fn android_settings_land_on_the_desktop_keys() {
    let pool = memory_pool().await;
    let incoming = [
        entry("autoplay", json!(false), 1_000),
        entry("playback_speed", json!(1.5), 1_000),
        entry("return_youtube_dislikes", json!(true), 1_000),
        entry("subscriptions_show_shorts", json!(false), 1_000),
        entry("default_video_codec", json!("av1"), 1_000),
        entry("equalizer", json!("{\"bands\":[]}"), 1_000),
        entry("desktop.subtitle_font_size", json!("18"), 1_000),
    ];
    apply_payload(&pool, OUR, PEER, &[staged(&incoming, "s1")])
        .await
        .unwrap();

    assert_eq!(
        stored(&pool, "autoplay_enabled").await.as_deref(),
        Some("false")
    );
    assert_eq!(
        stored(&pool, "playback_speed").await.as_deref(),
        Some("1.5")
    );
    assert_eq!(stored(&pool, "rytd_enabled").await.as_deref(), Some("true"));
    assert_eq!(
        stored(&pool, "subscription_show_shorts").await.as_deref(),
        Some("false")
    );
    assert_eq!(
        stored(&pool, "subtitle_font_size").await.as_deref(),
        Some("18")
    );
    assert_eq!(
        stored(&pool, "default_video_codec").await,
        None,
        "codec never syncs"
    );
    assert_eq!(
        stored(&pool, "equalizer").await,
        None,
        "Android-only keys are ignored"
    );
}

#[tokio::test]
async fn a_local_change_beats_an_older_peer_value() {
    let pool = memory_pool().await;
    set_like_the_app(&pool, "autoplay_enabled", "true").await;

    // The peer's value is from 2025; the local row was just written. Before the fix the local
    // `CURRENT_TIMESTAMP` failed to parse, stamped 0, and the peer always won.
    let older = entry("autoplay", json!(false), 1_735_689_600_000);
    apply_payload(&pool, OUR, PEER, &[staged(&[older], "s1")])
        .await
        .unwrap();
    assert_eq!(
        stored(&pool, "autoplay_enabled").await.as_deref(),
        Some("true")
    );
}

#[tokio::test]
async fn export_renames_and_types_settings_and_leaves_the_codec_out() {
    let pool = memory_pool().await;
    set_like_the_app(&pool, "autoplay_enabled", "true").await;
    set_like_the_app(&pool, "playback_speed", "1.25").await;
    set_like_the_app(&pool, "subtitle_font_size", "18").await;
    set_like_the_app(&pool, "default_video_codec", "av1").await;
    set_like_the_app(&pool, "download_location", "/secret").await;

    let out = export_collections(&pool, OUR, &[Collection::Settings])
        .await
        .unwrap();
    let entries: Vec<SettingEntry> = String::from_utf8(out[0].ndjson.clone())
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let find = |k: &str| entries.iter().find(|e| e.key == k);

    assert_eq!(find("autoplay").unwrap().value, json!(true));
    assert_eq!(find("playback_speed").unwrap().value, json!(1.25));
    assert_eq!(
        find("desktop.subtitle_font_size").unwrap().value,
        json!("18")
    );
    assert!(find("default_video_codec").is_none());
    assert!(find("download_location").is_none());
    assert!(
        entries.iter().all(|e| e.hlc.physical_ms > 0),
        "local rows carry their real change time"
    );
}

#[tokio::test]
async fn raw_keys_from_older_desktop_builds_are_still_accepted() {
    let pool = memory_pool().await;
    let incoming = [
        entry("autoplay_enabled", json!("false"), 1_000),
        entry("custom_speeds_enabled", json!("true"), 1_000),
    ];
    apply_payload(&pool, OUR, PEER, &[staged(&incoming, "s1")])
        .await
        .unwrap();
    assert_eq!(
        stored(&pool, "autoplay_enabled").await.as_deref(),
        Some("false")
    );
    assert_eq!(
        stored(&pool, "custom_speeds_enabled").await.as_deref(),
        Some("true")
    );
}
