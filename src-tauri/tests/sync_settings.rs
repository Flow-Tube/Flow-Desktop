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
        entry("equalizer", json!("{\"enabled\":false}"), 1_000),
        entry("queue_autoplay", json!(false), 1_000),
        entry("desktop.subtitle_font_scale", json!("150"), 1_000),
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
        stored(&pool, "subtitle_font_scale").await.as_deref(),
        Some("150")
    );
    assert_eq!(
        stored(&pool, "default_video_codec").await,
        None,
        "codec never syncs"
    );
    assert_eq!(
        stored(&pool, "eq_state_json").await.as_deref(),
        Some("{\"enabled\":false}"),
        "the equalizer JSON arrives as Android wrote it"
    );
    assert_eq!(
        stored(&pool, "queue_autoplay").await,
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
    set_like_the_app(&pool, "subtitle_font_scale", "150").await;
    set_like_the_app(&pool, "default_video_codec", "av1").await;
    set_like_the_app(&pool, "download_location", "/secret").await;
    set_like_the_app(&pool, "eq_state_json", "{\"version\":1,\"enabled\":true}").await;

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
        find("desktop.subtitle_font_scale").unwrap().value,
        json!("150")
    );
    assert!(find("default_video_codec").is_none());
    assert!(find("download_location").is_none());
    // Android's SettingsMapper reads the equalizer as one string primitive under this key.
    assert_eq!(
        find("equalizer").unwrap().value,
        json!("{\"version\":1,\"enabled\":true}")
    );
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

#[tokio::test]
async fn skip_silence_from_android_is_ignored_until_the_desktop_has_it() {
    let pool = memory_pool().await;
    let incoming = [entry("skip_silence", json!(true), 1_000)];
    apply_payload(&pool, OUR, PEER, &[staged(&incoming, "s1")])
        .await
        .unwrap();
    assert_eq!(stored(&pool, "skip_silence_enabled").await, None);

    set_like_the_app(&pool, "skip_silence_enabled", "true").await;
    let out = export_collections(&pool, OUR, &[Collection::Settings])
        .await
        .unwrap();
    let ndjson = String::from_utf8(out[0].ndjson.clone()).unwrap();
    assert!(!ndjson.contains("skip_silence"));
}

#[tokio::test]
async fn the_music_player_background_syncs_between_desktops() {
    let source = memory_pool().await;
    set_like_the_app(&source, "music_player_background", "blur").await;
    let out = export_collections(&source, OUR, &[Collection::Settings])
        .await
        .unwrap();
    let entries: Vec<SettingEntry> = String::from_utf8(out[0].ndjson.clone())
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let background = entries
        .iter()
        .find(|e| e.key == "desktop.music_player_background")
        .expect("exported under the desktop prefix");
    assert_eq!(background.value, json!("blur"));

    let target = memory_pool().await;
    apply_payload(&target, OUR, PEER, &[staged(&entries, "s1")])
        .await
        .unwrap();
    assert_eq!(
        stored(&target, "music_player_background").await.as_deref(),
        Some("blur")
    );
}

#[tokio::test]
async fn sponsorblock_actions_go_out_as_androids_per_category_settings() {
    let pool = memory_pool().await;
    set_like_the_app(
        &pool,
        "sponsorblock_categories",
        r#"{"sponsor":"skip","intro":"mute","outro":"notify","filler":"ignore","made_up":"skip"}"#,
    )
    .await;

    let out = export_collections(&pool, OUR, &[Collection::Settings])
        .await
        .unwrap();
    let sent: Vec<SettingEntry> = String::from_utf8(out[0].ndjson.clone())
        .unwrap()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let value = |key: &str| sent.iter().find(|e| e.key == key).map(|e| e.value.clone());
    assert_eq!(value("sponsorblock_action_sponsor"), Some(json!("SKIP")));
    assert_eq!(value("sponsorblock_action_intro"), Some(json!("MUTE")));
    assert_eq!(
        value("sponsorblock_action_outro"),
        Some(json!("SHOW_TOAST"))
    );
    assert_eq!(value("sponsorblock_action_filler"), Some(json!("IGNORE")));
    assert_eq!(value("sponsorblock_action_preview"), None, "never set here");
    assert!(sent.iter().all(|e| !e.key.contains("made_up")));
    assert_eq!(value("desktop.sponsorblock_categories"), None);
}

#[tokio::test]
async fn an_android_sponsorblock_action_changes_one_category_here() {
    let pool = memory_pool().await;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2020-01-01T00:00:00Z')",
    )
    .bind("sponsorblock_categories")
    .bind(r#"{"sponsor":"skip","intro":"skip","selfpromo":"notify"}"#)
    .execute(&pool)
    .await
    .unwrap();
    let now = 1_900_000_000_000;
    let incoming = [
        entry("sponsorblock_action_sponsor", json!("MUTE"), now),
        entry("sponsorblock_action_filler", json!("IGNORE"), now),
        entry("sponsorblock_action_intro", json!("WHATEVER"), now),
    ];
    apply_payload(&pool, OUR, PEER, &[staged(&incoming, "h1")])
        .await
        .unwrap();

    let actions: Value =
        serde_json::from_str(&stored(&pool, "sponsorblock_categories").await.unwrap()).unwrap();
    assert_eq!(actions["sponsor"], "mute");
    assert_eq!(actions["filler"], "ignore");
    assert_eq!(
        actions["intro"], "skip",
        "an unknown action changes nothing"
    );
    assert_eq!(actions["selfpromo"], "notify", "other categories stay");
}
