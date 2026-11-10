//! Cross-app restore, as far as a test on this side can prove it. Android's parsers can't run here,
//! so `android` below mirrors its classes field by field (`BackupData`, its entities, the two
//! `Serializable…Brain` classes): a field Kotlin declares non-null without a default is required
//! here too, and numbers keep Kotlin's integer types, so a file that decodes here is one Gson and
//! kotlinx read without leaving a null in Room or failing outright. The other direction restores a
//! fixture written the way Android's Gson writes it, end to end into a real database.

#![allow(clippy::float_cmp)] // These values are copied, never computed.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::PathBuf;

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;
use zip::write::{SimpleFileOptions, ZipWriter};

use flow_desktop_lib::backup::archive::{Archive, Slice, write_archive, write_json};
use flow_desktop_lib::backup::build::build_slice;
use flow_desktop_lib::backup::reader::{BackupFile, ReadError, read_backup_file};
use flow_desktop_lib::commands::backup::{export_backup, import_backup};

#[allow(dead_code)] // Mirrors whole classes; not every field is asserted on.
mod android {
    use super::{BTreeMap, BTreeSet};
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BackupData {
        pub version: i32,
        pub timestamp: i64,
        pub view_history: Option<Vec<VideoHistoryEntry>>,
        pub search_history: Option<Vec<serde_json::Value>>,
        pub music_search_history: Option<Vec<serde_json::Value>>,
        pub subscriptions: Option<Vec<ChannelSubscription>>,
        pub playlists: Option<Vec<PlaylistEntity>>,
        pub playlist_videos: Option<Vec<PlaylistVideoCrossRef>>,
        pub videos: Option<Vec<VideoEntity>>,
        pub subscription_groups: Option<Vec<SubscriptionGroupEntity>>,
        pub notes: Option<Vec<NoteEntity>>,
        pub liked_videos: Option<Vec<LikedVideoInfo>>,
        pub content_preferences: Option<ContentPreferencesBackup>,
        pub settings: Option<SettingsBackup>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct NoteEntity {
        pub id: String,
        pub target_id: String,
        pub kind: String,
        pub text: String,
        pub updated_at: i64,
        pub title: Option<String>,
        pub channel_name: Option<String>,
        pub channel_id: Option<String>,
        pub thumbnail_url: Option<String>,
        pub duration_seconds: Option<i32>,
        pub channel_avatar_url: Option<String>,
        pub channel_handle: Option<String>,
        pub subscriber_count_text: Option<String>,
        #[serde(default)]
        pub position: Option<i32>,
    }

    /// kotlinx refuses an enum name it doesn't know, in a map key too.
    #[derive(Deserialize, PartialEq, Eq, PartialOrd, Ord)]
    #[serde(rename_all = "UPPERCASE")]
    pub enum ViewFormat {
        Long,
        Short,
        Live,
    }

    #[derive(Deserialize, PartialEq, Eq, PartialOrd, Ord)]
    #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
    pub enum LedgerAction {
        Like,
        Save,
        Download,
        NotInterested,
        BlockChannel,
        Search,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecapBackup {
        pub version: i32,
        pub video: Option<VideoStatsSnapshot>,
        pub music: Option<SerializableStats>,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct VideoStatsSnapshot {
        pub months: BTreeMap<String, VideoMonthRecord>,
        pub seed_channels: Vec<String>,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct VideoMonthRecord {
        pub views: i32,
        pub sessions: i32,
        pub watched_ms: i64,
        pub format_views: BTreeMap<ViewFormat, i32>,
        pub format_ms: BTreeMap<ViewFormat, i64>,
        pub channel_views: BTreeMap<String, i32>,
        pub channel_names: BTreeMap<String, String>,
        pub discovered_channels: Vec<String>,
        pub dislikes: Vec<DislikedVideo>,
        pub actions: BTreeMap<LedgerAction, i32>,
        pub day_views: BTreeMap<i32, i32>,
        pub day_ms: BTreeMap<i32, i64>,
        pub hour_views: BTreeMap<i32, i32>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DislikedVideo {
        pub video_id: String,
        pub title: String,
        pub channel_name: String,
        pub at: i64,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableStats {
        pub schema_version: i32,
        pub months: BTreeMap<String, SerializableMonth>,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableMonth {
        pub plays: i32,
        pub sessions: i32,
        pub listened_ms: i64,
        pub artist_plays: BTreeMap<String, i32>,
        pub artist_names: BTreeMap<String, String>,
        pub discovered_artists: Vec<String>,
        pub day_plays: BTreeMap<i32, i32>,
        pub hour_plays: BTreeMap<i32, i32>,
        pub day_ms: BTreeMap<i32, i64>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VideoHistoryEntry {
        pub video_id: String,
        pub position: i64,
        pub duration: i64,
        pub timestamp: i64,
        pub title: String,
        pub thumbnail_url: String,
        pub channel_name: String,
        pub channel_id: String,
        pub is_music: bool,
        pub is_short: bool,
        pub is_local: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ChannelSubscription {
        pub channel_id: String,
        pub channel_name: String,
        pub channel_thumbnail: String,
        pub subscribed_at: i64,
        pub last_video_id: Option<String>,
        pub last_check_time: i64,
        pub is_notification_enabled: bool,
        pub is_music: bool,
        pub last_feed_fetch_at: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PlaylistEntity {
        pub id: String,
        pub name: String,
        pub description: String,
        pub thumbnail_url: String,
        pub is_private: bool,
        pub created_at: i64,
        pub video_count: i32,
        pub is_music: bool,
        pub is_user_created: bool,
        pub sync_id: Option<String>,
        pub position: i32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PlaylistVideoCrossRef {
        pub playlist_id: String,
        pub video_id: String,
        pub position: i64,
        pub added_at: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VideoEntity {
        pub id: String,
        pub title: String,
        pub channel_name: String,
        pub channel_id: String,
        pub thumbnail_url: String,
        pub duration: i32,
        pub view_count: i64,
        pub upload_date: String,
        pub description: String,
        pub channel_thumbnail_url: String,
        pub timestamp: i64,
        pub saved_at: i64,
        pub is_music: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SubscriptionGroupEntity {
        pub name: String,
        pub channel_ids: String,
        pub sort_order: i32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LikedVideoInfo {
        pub video_id: String,
        pub title: String,
        pub thumbnail: String,
        pub channel_name: String,
        pub liked_at: i64,
        pub is_music: bool,
        pub channel_id: Option<String>,
        pub duration_seconds: i32,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ContentPreferencesBackup {
        pub preferred_topics: BTreeSet<String>,
        pub blocked_topics: BTreeSet<String>,
        pub blocked_channels: BTreeSet<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SettingsBackup {
        pub strings: BTreeMap<String, String>,
        pub booleans: BTreeMap<String, bool>,
        pub ints: BTreeMap<String, i32>,
        pub floats: BTreeMap<String, f32>,
        pub longs: BTreeMap<String, i64>,
        pub string_sets: BTreeMap<String, BTreeSet<String>>,
    }

    /// `kotlinx.serialization` with `ignoreUnknownKeys`: every field has a default, and a value of
    /// the wrong type fails the whole import.
    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableBrain {
        pub schema_version: i32,
        pub time_vectors: BTreeMap<String, SerializableVector>,
        pub global: SerializableVector,
        pub channel_scores: BTreeMap<String, f64>,
        pub topic_affinities: BTreeMap<String, f64>,
        pub interactions: i32,
        pub consecutive_skips: i32,
        pub blocked_topics: BTreeSet<String>,
        pub blocked_channels: BTreeSet<String>,
        pub preferred_topics: BTreeSet<String>,
        pub has_completed_onboarding: bool,
        pub idf_word_frequency: BTreeMap<String, i32>,
        pub idf_total_documents: i32,
        pub watch_history_map: BTreeMap<String, f32>,
        pub seen_shorts_history: BTreeMap<String, i64>,
        pub channel_topic_profiles: BTreeMap<String, BTreeMap<String, f64>>,
        pub shorts_vector: SerializableVector,
        pub recent_vector: SerializableVector,
        pub suppressed_video_ids: BTreeMap<String, i64>,
        pub suppressed_channels: BTreeMap<String, i64>,
        pub recent_query_tokens: Vec<Vec<String>>,
        pub recent_related_seeds: BTreeMap<String, i64>,
        pub stale_queries: BTreeMap<String, i64>,
        pub cluster_rotation: BTreeMap<String, i64>,
        pub time_bucket_counts: BTreeMap<String, i32>,
        pub format_affinity: BTreeMap<String, f64>,
        pub category_affinity: BTreeMap<String, f64>,
        pub language_profile: Option<String>,
        pub language_votes: BTreeMap<String, i32>,
        pub key_language: Option<String>,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableVector {
        pub topics: BTreeMap<String, f64>,
        pub duration: f64,
        pub pacing: f64,
        pub complexity: f64,
        pub is_live: f64,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableMusicBrain {
        pub schema_version: i32,
        pub artist_affinity: BTreeMap<String, SerializableAffinity>,
        pub genre_affinity: BTreeMap<String, f64>,
        pub track_plays: BTreeMap<String, Vec<i64>>,
        pub track_meta: BTreeMap<String, SerializableTrackMeta>,
        pub recent_rotation: BTreeMap<String, f64>,
        pub artist_cooc: BTreeMap<String, f64>,
        pub artist_related: BTreeMap<String, Vec<String>>,
        pub time_buckets: BTreeMap<String, BTreeMap<String, f64>>,
        pub seen_artists: Vec<String>,
        pub disliked_artists: BTreeMap<String, i64>,
        pub blocked_artists: Vec<String>,
        pub discovery_appetite: f64,
        pub total_plays: i32,
        pub last_rotation_decay: i64,
        pub backfilled: bool,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableAffinity {
        pub plays: i32,
        pub score: f64,
        pub last_played: i64,
        pub liked: bool,
        pub display: String,
    }

    #[derive(Deserialize, Default)]
    #[serde(default, rename_all = "camelCase")]
    pub struct SerializableTrackMeta {
        pub title: String,
        pub artist: String,
        pub artist_key: String,
        pub thumbnail: String,
    }
}

const TIME_BUCKETS: [&str; 8] = [
    "WEEKDAY_MORNING",
    "WEEKDAY_AFTERNOON",
    "WEEKDAY_EVENING",
    "WEEKDAY_NIGHT",
    "WEEKEND_MORNING",
    "WEEKEND_AFTERNOON",
    "WEEKEND_EVENING",
    "WEEKEND_NIGHT",
];

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
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2025-01-01T00:00:00+00:00')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
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

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("flow-cross-app-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn seed_desktop(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO watch_history
            (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
             total_duration_seconds, is_music, is_short, updated_hlc)
         VALUES ('vvvvvvvvvvv', 'A video', 'Chan', 'UCchan', '2025-01-01T00:00:00+00:00',
                 100, 200, 0, 0, '100:0:dlocal')",
    )
    .execute(pool)
    .await
    .unwrap();
    set_setting(
        pool,
        "liked_items",
        r#"[{"id":"liked","kind":"video","likedAt":"2025-01-01T00:00:00+00:00","video":{"id":"liked","title":"Liked one","channelName":"Chan"}}]"#,
    )
    .await;
    set_setting(
        pool,
        "subscriptions",
        r#"[{"id":"UCaaaaaaaaaaaaaaaaaaaaaa","name":"Some Channel","avatarUrl":"a.png","subscribedAt":5}]"#,
    )
    .await;
    set_setting(
        pool,
        "user_playlists",
        r#"[{"id":"watch-later","name":"Watch Later","tracks":[{"id":"later","title":"Later"}]},{"id":"pl1","name":"Mix","tracks":[{"id":"t1","title":"One"},{"id":"t2","title":"Two"}]}]"#,
    )
    .await;
    set_setting(pool, "autoplay_enabled", "false").await;
    set_setting(pool, "playback_speed", "1.5").await;
    let mut brain = json!({ "total_interactions": 12, "key_spec": 3, "key_language": "en" });
    brain["global_vector"] = json!({
        "topics": { "guitar": 0.8 }, "topic_confidence": {}, "anchor_topics": [],
        "duration": 0.5, "pacing": 0.5, "complexity": 0.5, "is_live": 0.0,
    });
    brain["blocked_channels"] = json!(["UCblocked"]);
    set_setting(pool, "user_neuro_brain", &brain.to_string()).await;
    set_setting(
        pool,
        "user_music_brain",
        &json!({
            "total_plays": 4,
            "artist_affinity": { "UCartist": { "plays": 4, "score": 0.5, "last_played": 9, "liked": true } },
            "track_plays": { "song": [1, 2] },
        })
        .to_string(),
    )
    .await;
}

fn entries(path: &std::path::Path) -> BTreeMap<String, Vec<u8>> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();
    names
        .into_iter()
        .map(|name| {
            let mut bytes = Vec::new();
            archive
                .by_name(&name)
                .unwrap()
                .read_to_end(&mut bytes)
                .unwrap();
            (name, bytes)
        })
        .collect()
}

async fn desktop_master(dir: &TempDir, keys: &[String]) -> PathBuf {
    let pool = memory_pool().await;
    seed_desktop(&pool).await;
    let path = dir.file("master.zip");
    let archive = Archive {
        root: build_slice(&pool, "MASTER", keys, true, 1_000)
            .await
            .unwrap(),
        manifest: None,
        profiles: Vec::new(),
        avatars: Vec::new(),
    };
    write_archive(&path, &archive).unwrap();
    path
}

#[tokio::test]
async fn a_desktop_master_is_the_zip_android_reads() {
    let dir = TempDir::new();
    let keys = vec!["autoplay_enabled".to_string(), "playback_speed".to_string()];
    let path = desktop_master(&dir, &keys).await;
    let files = entries(&path);
    assert!(files.contains_key("app_data.json"));
    assert!(files.contains_key("engine_brain.json"));
    assert!(files.contains_key("music_brain.json"));

    let data: android::BackupData = serde_json::from_slice(&files["app_data.json"]).unwrap();
    assert_eq!(data.version, 2);
    assert!(data.timestamp > 0);
    assert!(
        data.search_history.is_none(),
        "null leaves the phone's alone"
    );
    assert!(data.music_search_history.is_none());
    assert!(
        data.notes.unwrap().is_empty(),
        "an empty list leaves the phone's alone too"
    );

    let history = data.view_history.unwrap();
    assert_eq!(history[0].video_id, "vvvvvvvvvvv");
    assert_eq!(history[0].duration, 200_000);
    assert_eq!(history[0].position, 100_000);
    assert!(!history[0].thumbnail_url.is_empty());
    assert!(!history[0].is_local);

    let subs = data.subscriptions.unwrap();
    assert_eq!(subs[0].channel_id, "UCaaaaaaaaaaaaaaaaaaaaaa");
    assert_eq!(subs[0].channel_thumbnail, "a.png");

    let playlists = data.playlists.unwrap();
    let cross_refs = data.playlist_videos.unwrap();
    let videos = data.videos.unwrap();
    let later = playlists.iter().find(|p| p.id == "watch_later").unwrap();
    assert!(later.sync_id.is_none());
    assert!(later.is_private);
    let mix = playlists.iter().find(|p| p.name == "Mix").unwrap();
    assert_eq!(mix.video_count, 2);
    for cross_ref in &cross_refs {
        assert!(
            videos.iter().any(|video| video.id == cross_ref.video_id),
            "the cross-ref's foreign key needs its video row"
        );
        assert!(playlists.iter().any(|p| p.id == cross_ref.playlist_id));
    }

    let likes = data.liked_videos.unwrap();
    assert_eq!(likes[0].video_id, "liked");
    assert_eq!(likes[0].title, "Liked one");
    assert!(!likes[0].is_music);

    let preferences = data.content_preferences.unwrap();
    assert!(preferences.blocked_channels.contains("UCblocked"));

    let settings = data.settings.unwrap();
    assert!(!settings.booleans["autoplay_enabled"]);
    assert!((settings.floats["playback_speed"] - 1.5).abs() < f32::EPSILON);

    let engine: android::SerializableBrain =
        serde_json::from_slice(&files["engine_brain.json"]).unwrap();
    assert_eq!(
        engine.schema_version, 21,
        "key spec 3: no migration on the phone"
    );
    assert_eq!(engine.interactions, 12);
    assert_eq!(engine.global.topics["guitar"], 0.8);
    assert!(engine.blocked_channels.contains("UCblocked"));
    for bucket in engine.time_vectors.keys() {
        assert!(TIME_BUCKETS.contains(&bucket.as_str()), "{bucket}");
    }
    let raw_engine: Value = serde_json::from_slice(&files["engine_brain.json"]).unwrap();
    for legacy in ["morning", "afternoon", "evening", "night", "longTerm"] {
        assert!(
            raw_engine.get(legacy).is_none(),
            "would read as a legacy file"
        );
    }

    let music: android::SerializableMusicBrain =
        serde_json::from_slice(&files["music_brain.json"]).unwrap();
    assert_eq!(music.total_plays, 4);
    assert_eq!(music.artist_affinity["UCartist"].plays, 4);
    assert!(
        music.backfilled,
        "a restored brain must not warm-start again"
    );
}

#[tokio::test]
async fn the_old_desktop_json_shows_why_the_layout_changed() {
    // Gson finds none of BackupData's fields in it: Android would report success and restore
    // nothing, and its master import refuses a file that isn't a zip.
    let old = json!({
        "schemaVersion": 2, "scope": "MASTER", "settings": { "autoplay_enabled": false },
        "collections": { "watch_history": [{ "videoId": "x" }] },
    });
    assert!(old.get("viewHistory").is_none());
    assert!(old.get("likedVideos").is_none());
    assert!(old.get("playlists").is_none());
}

#[tokio::test]
async fn a_desktop_master_restores_on_the_desktop_without_loss() {
    let dir = TempDir::new();
    let keys = vec!["autoplay_enabled".to_string()];
    let path = desktop_master(&dir, &keys).await;
    let BackupFile::Backup(backup) = read_backup_file(&path, 2_000).unwrap() else {
        panic!("a master backup reads as a backup");
    };
    assert_eq!(backup["settings"]["autoplay_enabled"], "false");

    let fresh = memory_pool().await;
    import_backup(&fresh, &json!({ "collections": backup["collections"] }))
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM watch_history")
        .fetch_one(&fresh)
        .await
        .unwrap();
    assert_eq!(count, 1);
    assert!(
        get_setting(&fresh, "liked_items")
            .await
            .unwrap()
            .contains("liked")
    );
    assert!(
        get_setting(&fresh, "subscriptions")
            .await
            .unwrap()
            .contains("UCaaaaaaaaaaaaaaaaaaaaaa")
    );
    let brain = get_setting(&fresh, "user_neuro_brain").await.unwrap();
    assert!(brain.contains("guitar"));
}

#[tokio::test]
async fn an_old_desktop_json_still_reaches_the_old_restore_path() {
    let dir = TempDir::new();
    let path = dir.file("flow_backup_master_2026-01-01.json");
    let old = json!({
        "schemaVersion": 2, "scope": "MASTER", "settings": { "autoplay_enabled": false },
        "collections": { "watch_history": [] },
    });
    std::fs::write(&path, old.to_string()).unwrap();
    let BackupFile::Text(text) = read_backup_file(&path, 0).unwrap() else {
        panic!("the frontend parses an old desktop file itself");
    };
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["schemaVersion"], 2);
}

fn android_app_data() -> Value {
    // As Gson writes `BackupData` on the phone, including the fields the desktop has no use for.
    json!({
        "version": 2,
        "timestamp": 1_700_000_000_000_i64,
        "viewHistory": [{
            "videoId": "aaaaaaaaaaa", "position": 30000, "duration": 60000,
            "timestamp": 1_700_000_000_000_i64, "title": "Phone video",
            "thumbnailUrl": "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
            "channelName": "Phone channel", "channelId": "UCphone",
            "isMusic": false, "isShort": false, "isLocal": false,
        }, {
            "videoId": "local-file", "position": 0, "duration": 0, "timestamp": 1,
            "title": "A file", "thumbnailUrl": "", "isLocal": true,
        }],
        "searchHistory": [{ "id": "1", "query": "x", "timestamp": 1, "type": "TEXT", "filters": null }],
        "musicSearchHistory": [],
        "subscriptions": [{
            "channelId": "UCbbbbbbbbbbbbbbbbbbbbbb", "channelName": "Subbed",
            "channelThumbnail": "s.png", "subscribedAt": 7, "lastCheckTime": 0,
            "isNotificationEnabled": true, "isMusic": false, "lastFeedFetchAt": 0,
        }],
        "playlists": [
            { "id": "watch_later", "name": "Watch Later", "description": "", "thumbnailUrl": "",
              "isPrivate": true, "createdAt": 5, "videoCount": 1, "isMusic": false,
              "isUserCreated": true, "position": 0 },
            { "id": "pl-phone", "name": "Phone mix", "description": "d", "thumbnailUrl": "",
              "isPrivate": false, "createdAt": 6, "videoCount": 2, "isMusic": true,
              "isUserCreated": true, "syncId": "sync-phone", "position": 0 },
        ],
        "playlistVideos": [
            { "playlistId": "watch_later", "videoId": "wl1", "position": 0, "addedAt": 8 },
            { "playlistId": "pl-phone", "videoId": "second", "position": -5, "addedAt": 9 },
            { "playlistId": "pl-phone", "videoId": "first", "position": -9, "addedAt": 9 },
        ],
        "videos": [
            { "id": "wl1", "title": "Later", "channelName": "C", "channelId": "", "thumbnailUrl": "",
              "duration": 10, "viewCount": 0, "uploadDate": "", "description": "",
              "channelThumbnailUrl": "", "timestamp": 1, "savedAt": 1, "isMusic": false },
            { "id": "first", "title": "First song", "channelName": "Band", "channelId": "",
              "thumbnailUrl": "", "duration": 100, "viewCount": 0, "uploadDate": "",
              "description": "", "channelThumbnailUrl": "", "timestamp": 1, "savedAt": 1, "isMusic": true },
        ],
        "subscriptionGroups": [{ "name": "News", "channelIds": "UCbbbbbbbbbbbbbbbbbbbbbb,UCx", "sortOrder": 2 }],
        "notes": [],
        "likedVideos": [{
            "videoId": "liked-song", "title": "Liked song", "thumbnail": "t.png", "channelName": "Band",
            "likedAt": 1_700_000_000_000_i64, "isMusic": true, "durationSeconds": 200,
        }],
        "contentPreferences": { "preferredTopics": [], "blockedTopics": [], "blockedChannels": [] },
        "settings": {
            "strings": { "trending_region": "FR", "sb_action_sponsor": "SHOW_TOAST", "theme_mode": "DARK" },
            "booleans": { "autoplay_enabled": false, "rytd_enabled": true },
            "ints": { "unknown_int": 3 },
            "floats": { "playback_speed": 1.25 },
            "longs": {},
            "stringSets": { "something": ["a"] },
        },
    })
}

fn android_engine() -> Value {
    json!({
        "schemaVersion": 21,
        "timeVectors": { "WEEKDAY_NIGHT": { "topics": { "chess": 0.3 }, "duration": 0.5, "pacing": 0.5, "complexity": 0.5, "isLive": 0.0 } },
        "global": { "topics": { "chess": 0.6 }, "duration": 0.5, "pacing": 0.5, "complexity": 0.5, "isLive": 0.0 },
        "interactions": 30,
        "blockedChannels": ["UCnope"],
        "hasCompletedOnboarding": true,
        "lastPersona": "EXPLORER",
        "idfWordFrequency": { "chess": 4 },
        "idfTotalDocuments": 9,
    })
}

fn android_music() -> Value {
    json!({
        "schemaVersion": 1,
        "artistAffinity": { "UCband": { "plays": 6, "score": 0.7, "lastPlayed": 11, "liked": false, "display": "Band" } },
        "trackPlays": { "first": [10, 11] },
        "trackMeta": { "first": { "title": "First song", "artist": "Band", "artistKey": "UCband", "thumbnail": "" } },
        "seenArtists": ["UCband"],
        "discoveryAppetite": 0.4,
        "totalPlays": 6,
        "backfilled": true,
    })
}

fn zip_of(path: &std::path::Path, files: &[(&str, Vec<u8>)]) {
    let mut zip = ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in files {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}

fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec_pretty(value).unwrap()
}

#[tokio::test]
async fn an_android_master_restores_on_the_desktop() {
    let dir = TempDir::new();
    let path = dir.file("flow_master_backup_1.zip");
    zip_of(
        &path,
        &[
            ("app_data.json", bytes(&android_app_data())),
            ("engine_brain.json", bytes(&android_engine())),
            ("music_brain.json", bytes(&android_music())),
            ("recap_stats.json", b"{}".to_vec()),
        ],
    );
    let BackupFile::Backup(backup) = read_backup_file(&path, 2_000_000_000_000).unwrap() else {
        panic!("an Android master reads as a backup");
    };
    assert_eq!(backup["schemaVersion"], 2);
    assert_eq!(backup["scope"], "MASTER");
    assert_eq!(backup["settings"]["autoplay_enabled"], "false");
    assert_eq!(backup["settings"]["rytd_enabled"], "true");
    assert_eq!(backup["settings"]["trending_region"], "FR");
    assert!(backup["settings"].get("theme_mode").is_none());
    assert!(
        backup["settings"]["sponsorblock_categories"]
            .as_str()
            .unwrap()
            .contains("notify")
    );

    let pool = memory_pool().await;
    import_backup(&pool, &json!({ "collections": backup["collections"] }))
        .await
        .unwrap();

    let ids: Vec<String> = sqlx::query_scalar("SELECT video_id FROM watch_history")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(ids, ["aaaaaaaaaaa"], "local files stay on the phone");

    let likes = get_setting(&pool, "liked_items").await.unwrap();
    assert!(likes.contains("liked-song"));
    assert!(likes.contains("Liked song"));

    let subs = get_setting(&pool, "subscriptions").await.unwrap();
    assert!(subs.contains("UCbbbbbbbbbbbbbbbbbbbbbb"));

    let playlists: Value =
        serde_json::from_str(&get_setting(&pool, "user_playlists").await.unwrap()).unwrap();
    let names: Vec<&str> = playlists
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p["name"].as_str())
        .collect();
    assert!(names.contains(&"Watch Later"));
    // A music playlist belongs with the music library, in order: sort keys become ranks.
    let albums: Value =
        serde_json::from_str(&get_setting(&pool, "saved_albums").await.unwrap()).unwrap();
    let phone_mix = albums
        .as_array()
        .unwrap()
        .iter()
        .find(|album| album.to_string().contains("Phone mix"))
        .unwrap();
    let tracks = phone_mix.to_string();
    assert!(tracks.find("\"first\"").unwrap() < tracks.find("\"second\"").unwrap());
    assert!(!names.contains(&"Phone mix"));

    let groups = get_setting(&pool, "subscription_groups")
        .await
        .unwrap_or_default();
    assert!(groups.contains("News"));

    let brain = get_setting(&pool, "user_neuro_brain").await.unwrap();
    assert!(brain.contains("chess"));
    assert!(brain.contains("UCnope"));
    let music = get_setting(&pool, "user_music_brain").await.unwrap();
    assert!(music.contains("UCband"));
    // The two brains stay apart.
    assert!(!music.contains("chess"));
    assert!(!brain.contains("UCband"));
}

#[tokio::test]
async fn an_android_master_with_profiles_keeps_each_profile() {
    let dir = TempDir::new();
    let path = dir.file("master.zip");
    let manifest = json!({
        "format": "flow-master", "version": 1, "defaultId": "default-1",
        "profiles": [
            { "id": "default-1", "name": "", "colorKey": "", "createdAt": 1 },
            { "id": "study", "name": "Study", "colorKey": "blue", "createdAt": 2 },
            { "id": "../evil", "name": "Evil", "createdAt": 3 },
        ],
        "included": ["default-1", "study", "../evil"],
    });
    zip_of(
        &path,
        &[
            ("app_data.json", bytes(&android_app_data())),
            (
                "profiles/study/app_data.json",
                bytes(&json!({ "version": 2, "likedVideos": [{
                    "videoId": "study-like", "title": "S", "thumbnail": "", "channelName": "",
                    "likedAt": 1, "isMusic": false, "durationSeconds": 0,
                }], "subscriptions": [] })),
            ),
            ("profile_avatars/study.webp", vec![1, 2, 3]),
            ("profile_avatars/nothing/../x.webp", vec![9]),
            ("manifest.json", bytes(&manifest)),
        ],
    );
    let BackupFile::Backup(backup) = read_backup_file(&path, 1).unwrap() else {
        panic!("reads as a backup");
    };
    assert_eq!(backup["manifest"]["format"], "flow-master");
    assert!(
        backup["collections"]["watch_history"].is_array(),
        "Default stays at the top"
    );
    let study = &backup["profiles"]["study"];
    assert_eq!(study["collections"]["likes"][0]["id"], "study-like");
    assert!(backup["profiles"].get("../evil").is_none());
    assert_eq!(backup["profile_avatars"]["study"], "AQID");
    assert!(backup["profile_avatars"].as_object().unwrap().len() == 1);
}

#[tokio::test]
async fn android_single_files_restore_on_the_desktop() {
    let dir = TempDir::new();
    let app = dir.file("flow_backup_1.json");
    std::fs::write(&app, bytes(&android_app_data())).unwrap();
    let BackupFile::Backup(backup) = read_backup_file(&app, 1).unwrap() else {
        panic!("Android's app data reads as a backup");
    };
    assert_eq!(backup["scope"], "APP_DATA");
    assert!(backup["collections"]["likes"].is_array());

    let music = dir.file("flow_music_brain_1.json");
    std::fs::write(&music, bytes(&android_music())).unwrap();
    let BackupFile::Backup(backup) = read_backup_file(&music, 1).unwrap() else {
        panic!("Android's music brain reads as a backup");
    };
    assert!(backup["collections"]["music_brain"].is_array());
}

#[tokio::test]
async fn a_backup_never_holds_a_private_setting() {
    const SECRET: &str = "hunter2-do-not-leak";
    let pool = memory_pool().await;
    seed_desktop(&pool).await;
    for key in flow_desktop_lib::backup::NEVER_BACKED_UP {
        set_setting(&pool, key, SECRET).await;
    }
    // Asked for outright, as a wrong key list from the frontend would.
    let mut keys: Vec<String> = flow_desktop_lib::backup::NEVER_BACKED_UP
        .iter()
        .map(ToString::to_string)
        .collect();
    keys.push("autoplay_enabled".into());

    let dir = TempDir::new();
    for scope in ["MASTER", "APP_DATA", "BRAIN"] {
        let slice: Slice = build_slice(&pool, scope, &keys, true, 1).await.unwrap();
        let path = dir.file(&format!("{scope}.json"));
        write_json(&path, &slice.app_data).unwrap();
        let written = std::fs::read_to_string(&path).unwrap();
        assert!(
            !written.contains(SECRET),
            "{scope} leaked a private setting"
        );
        if let Some(engine) = slice.engine {
            assert!(!engine.to_string().contains(SECRET));
        }
        if let Some(music) = slice.music {
            assert!(!music.to_string().contains(SECRET));
        }
    }
}

#[tokio::test]
async fn an_app_data_file_carries_no_brains_and_a_brain_file_no_library() {
    let pool = memory_pool().await;
    seed_desktop(&pool).await;
    seed_note(&pool, "video:abc12345678", "A note", 5).await;
    seed_ledger(&pool).await;

    let app = build_slice(&pool, "APP_DATA", &[], true, 1).await.unwrap();
    assert!(app.engine.is_none());
    assert!(app.music.is_none());
    assert!(app.recap.is_none(), "the ledger is only for a master");
    assert!(app.app_data["viewHistory"].is_null());
    assert!(app.app_data["settings"].is_object());
    assert_eq!(app.app_data["notes"][0]["id"], "video:abc12345678");

    let brain = build_slice(&pool, "BRAIN", &[], true, 1).await.unwrap();
    assert!(brain.engine.is_some());
    assert!(brain.music.is_some());
    assert!(brain.recap.is_none(), "the ledger is only for a master");
    for key in [
        "viewHistory",
        "playlists",
        "likedVideos",
        "subscriptions",
        "settings",
        "notes",
    ] {
        assert!(
            brain.app_data[key].is_null(),
            "{key} must not touch the phone's"
        );
    }
}

const NOTE_TEXT: &str = "12:34 the good part\n\n\tand this";

/// As Gson writes `NoteEntity`: a null field is left out.
fn android_note() -> Value {
    json!({
        "id": "video:abc12345678", "targetId": "abc12345678", "kind": "Video", "text": NOTE_TEXT,
        "updatedAt": 1_700_000_000_000_i64, "title": "A video", "channelName": "A channel",
        "durationSeconds": 754, "position": 2,
    })
}

/// As `RecapBackup.encode()` writes it: kotlinx leaves out what still holds its default.
fn android_ledger() -> Value {
    json!({
        "video": {
            "months": { "2026-09": {
                "views": 3, "sessions": 4, "watchedMs": 9000,
                "formatViews": { "LONG": 3 }, "formatMs": { "LONG": 9000 },
                "channelViews": { "UCa": 3 }, "channelNames": { "UCa": "A" },
                "discoveredChannels": ["UCa"],
                "dislikes": [{ "videoId": "v", "title": "t", "channelName": "A", "at": 5 }],
                "actions": { "NOT_INTERESTED": 1 },
                "dayViews": { "12": 3 }, "dayMs": { "12": 9000 }, "hourViews": { "20": 3 },
            } },
            "seedChannels": ["UCold"],
        },
        "music": {
            "months": { "2026-08": {
                "plays": 2, "listenedMs": 400, "artistPlays": { "UCb": 2 },
                "artistNames": { "UCb": "B" }, "genrePlays": { "rock": 2 },
                "discoveredArtists": ["UCb"], "dayPlays": { "3": 2 },
            } },
        },
    })
}

async fn seed_note(pool: &SqlitePool, id: &str, text: &str, at: i64) {
    let (kind, target) = id.split_once(':').unwrap();
    sqlx::query("INSERT INTO notes (id, target_id, kind, text, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id)
        .bind(target)
        .bind(if kind == "video" { "Video" } else { "Channel" })
        .bind(text)
        .bind(at)
        .execute(pool)
        .await
        .unwrap();
}

/// A deletion as it arrives from a peer. Its time has to be recent: tombstones expire after a year.
async fn delete_note(pool: &SqlitePool, id: &str) {
    let tombstone = json!({
        "id": id, "deleted": true, "updatedAt": chrono::Utc::now().timestamp_millis(),
    });
    import_backup(pool, &json!({ "collections": { "notes": [tombstone] } }))
        .await
        .unwrap();
}

async fn seed_ledger(pool: &SqlitePool) {
    import_backup(
        pool,
        &json!({ "collections": { "recap_stats": [android_ledger()] } }),
    )
    .await
    .unwrap();
}

async fn note_of(pool: &SqlitePool, id: &str) -> Option<(String, i64)> {
    sqlx::query_as("SELECT text, updated_at FROM notes WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

/// This database's ledger, read the way a backup reads it.
async fn ledger_of(pool: &SqlitePool) -> Value {
    export_backup(pool, "MASTER").await.unwrap().collections["recap_stats"][0].clone()
}

#[tokio::test]
async fn a_desktop_master_gives_android_its_notes_and_its_ledger() {
    let dir = TempDir::new();
    let pool = memory_pool().await;
    seed_note(&pool, "video:abc12345678", NOTE_TEXT, 1_700_000_000_000).await;
    seed_note(&pool, "channel:UCgone", "Gone", 5).await;
    delete_note(&pool, "channel:UCgone").await;
    seed_ledger(&pool).await;

    let path = dir.file("master.zip");
    let archive = Archive {
        root: build_slice(&pool, "MASTER", &[], true, 1_000)
            .await
            .unwrap(),
        manifest: None,
        profiles: Vec::new(),
        avatars: Vec::new(),
    };
    write_archive(&path, &archive).unwrap();
    let files = entries(&path);

    let data: android::BackupData = serde_json::from_slice(&files["app_data.json"]).unwrap();
    let notes = data.notes.unwrap();
    assert_eq!(notes.len(), 1, "Room has no tombstones to hold");
    assert_eq!(notes[0].id, "video:abc12345678");
    assert_eq!(notes[0].target_id, "abc12345678");
    assert_eq!(notes[0].kind, "Video");
    assert_eq!(notes[0].text, NOTE_TEXT);
    assert_eq!(notes[0].updated_at, 1_700_000_000_000);

    let ledger: android::RecapBackup = serde_json::from_slice(&files["recap_stats.json"]).unwrap();
    assert_eq!(ledger.version, 1);
    let video = ledger.video.unwrap();
    assert_eq!(video.months["2026-09"].views, 3);
    assert!(video.seed_channels.contains(&"UCold".to_string()));
    assert_eq!(ledger.music.unwrap().months["2026-08"].plays, 2);

    let raw: Value = serde_json::from_slice(&files["app_data.json"]).unwrap();
    assert!(
        raw["desktop"]["collections"].get("recap_stats").is_none(),
        "one copy of the ledger in a file"
    );
    assert!(raw["desktop"]["collections"]["notes"].is_array());
}

#[tokio::test]
async fn an_android_master_restores_its_notes_and_replaces_the_ledger() {
    let dir = TempDir::new();
    let path = dir.file("flow_master_backup_1.zip");
    let mut data = android_app_data();
    data["notes"] = json!([android_note()]);
    zip_of(
        &path,
        &[
            ("app_data.json", bytes(&data)),
            ("recap_stats.json", bytes(&android_ledger())),
        ],
    );
    let BackupFile::Backup(backup) = read_backup_file(&path, 1).unwrap() else {
        panic!("an Android master reads as a backup");
    };

    let pool = memory_pool().await;
    sqlx::query(
        "INSERT INTO recap_months (source, month, record, estimated)
         VALUES ('video', '2020-01', '{\"views\":99}', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();
    import_backup(&pool, &json!({ "collections": backup["collections"] }))
        .await
        .unwrap();

    assert_eq!(
        note_of(&pool, "video:abc12345678").await,
        Some((NOTE_TEXT.to_string(), 1_700_000_000_000))
    );
    let (title, duration): (String, i32) =
        sqlx::query_as("SELECT title, duration_seconds FROM notes WHERE id = 'video:abc12345678'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((title.as_str(), duration), ("A video", 754));

    let ledger = ledger_of(&pool).await;
    assert_eq!(ledger["video"]["months"]["2026-09"]["views"], 3);
    assert_eq!(
        ledger["video"]["months"]["2026-09"]["actions"]["NOT_INTERESTED"],
        1
    );
    assert_eq!(ledger["music"]["months"]["2026-08"]["plays"], 2);
    assert!(
        ledger["video"]["months"].get("2020-01").is_none(),
        "a restore replaces the ledger"
    );
    // The two ledgers stay apart.
    assert!(ledger["video"]["months"].get("2026-08").is_none());
    assert!(ledger["music"]["months"].get("2026-09").is_none());
}

#[tokio::test]
async fn a_restored_note_goes_through_the_merge() {
    let restore = |pool: SqlitePool, note: Value| async move {
        let mut data = android_app_data();
        data["notes"] = json!([note]);
        let slice = flow_desktop_lib::backup::app_data::from_app_data(&data, 1);
        import_backup(
            &pool,
            &json!({ "collections": { "notes": slice.collections["notes"] } }),
        )
        .await
        .unwrap();
        pool
    };
    let id = "video:abc12345678";

    // Older than the deletion: stays deleted, and the deletion still travels.
    let pool = memory_pool().await;
    seed_note(&pool, id, "Mine", 5).await;
    delete_note(&pool, id).await;
    let pool = restore(pool, android_note()).await;
    assert_eq!(note_of(&pool, id).await, None);
    let notes = export_backup(&pool, "APP_DATA").await.unwrap().collections["notes"].clone();
    assert_eq!(notes[0]["deleted"], true);

    // Newer than the deletion: it was edited after, so it comes back.
    let later = chrono::Utc::now().timestamp_millis() + 86_400_000;
    let mut newer = android_note();
    newer["updatedAt"] = json!(later);
    let pool = restore(pool, newer).await;
    assert_eq!(
        note_of(&pool, id).await,
        Some((NOTE_TEXT.to_string(), later))
    );

    // Older than this device's own edit: the edit stays.
    let pool = memory_pool().await;
    seed_note(&pool, id, "Mine", 1_800_000_000_000).await;
    let pool = restore(pool, android_note()).await;
    assert_eq!(
        note_of(&pool, id).await,
        Some(("Mine".to_string(), 1_800_000_000_000))
    );
}

#[tokio::test]
async fn each_profile_in_a_master_keeps_its_own_ledger() {
    let dir = TempDir::new();
    let manifest = json!({
        "format": "flow-master", "version": 1, "defaultId": "default-1",
        "profiles": [
            { "id": "default-1", "name": "", "colorKey": "", "createdAt": 1 },
            { "id": "study", "name": "Study", "colorKey": "blue", "createdAt": 2 },
            { "id": "ledger-only", "name": "L", "colorKey": "red", "createdAt": 3 },
        ],
        "included": ["default-1", "study", "ledger-only"],
    });
    let mut study_ledger = android_ledger();
    study_ledger["video"]["months"]["2026-09"]["views"] = json!(77);

    // Android's zip: every slice carries the entries of a whole profile, under its folder.
    let path = dir.file("android.zip");
    zip_of(
        &path,
        &[
            ("app_data.json", bytes(&android_app_data())),
            ("recap_stats.json", bytes(&android_ledger())),
            (
                "profiles/study/app_data.json",
                bytes(&json!({ "version": 2 })),
            ),
            ("profiles/study/recap_stats.json", bytes(&study_ledger)),
            (
                "profiles/ledger-only/recap_stats.json",
                bytes(&study_ledger),
            ),
            ("manifest.json", bytes(&manifest)),
        ],
    );
    let BackupFile::Backup(backup) = read_backup_file(&path, 1).unwrap() else {
        panic!("reads as a backup");
    };
    let views = |collections: &Value| {
        collections["recap_stats"][0]["video"]["months"]["2026-09"]["views"].clone()
    };
    assert_eq!(views(&backup["collections"]), 3);
    assert_eq!(views(&backup["profiles"]["study"]["collections"]), 77);
    assert_eq!(views(&backup["profiles"]["ledger-only"]["collections"]), 77);

    let closed_profile = memory_pool().await;
    import_backup(
        &closed_profile,
        &json!({ "collections": backup["profiles"]["study"]["collections"] }),
    )
    .await
    .unwrap();
    assert_eq!(
        ledger_of(&closed_profile).await["video"]["months"]["2026-09"]["views"],
        77
    );

    // The desktop's zip lays a profile's ledger out the same way.
    let default = memory_pool().await;
    seed_ledger(&default).await;
    let archive = Archive {
        root: build_slice(&default, "MASTER", &[], true, 1).await.unwrap(),
        manifest: Some(manifest),
        profiles: vec![(
            "study".to_string(),
            build_slice(&closed_profile, "MASTER", &[], false, 1)
                .await
                .unwrap(),
        )],
        avatars: Vec::new(),
    };
    let path = dir.file("desktop.zip");
    write_archive(&path, &archive).unwrap();
    let files = entries(&path);
    assert!(files.contains_key("recap_stats.json"));
    assert!(files.contains_key("profiles/study/recap_stats.json"));
    let BackupFile::Backup(backup) = read_backup_file(&path, 1).unwrap() else {
        panic!("reads as a backup");
    };
    assert_eq!(views(&backup["collections"]), 3);
    assert_eq!(views(&backup["profiles"]["study"]["collections"]), 77);
}

#[tokio::test]
async fn an_old_desktop_json_restores_its_notes_and_its_ledger() {
    let dir = TempDir::new();
    let path = dir.file("flow_backup_master_2026-01-01.json");
    let old = json!({
        "schemaVersion": 2, "scope": "MASTER", "settings": {},
        "collections": {
            "notes": [{
                "id": "video:abc12345678", "targetId": "abc12345678", "kind": "Video",
                "text": NOTE_TEXT, "updatedAt": 1_700_000_000_000_i64, "deleted": false,
            }],
            "recap_stats": [android_ledger()],
        },
    });
    std::fs::write(&path, old.to_string()).unwrap();
    let BackupFile::Text(text) = read_backup_file(&path, 0).unwrap() else {
        panic!("the frontend parses an old desktop file itself");
    };
    let parsed: Value = serde_json::from_str(&text).unwrap();

    let pool = memory_pool().await;
    import_backup(&pool, &json!({ "collections": parsed["collections"] }))
        .await
        .unwrap();
    assert_eq!(
        note_of(&pool, "video:abc12345678").await,
        Some((NOTE_TEXT.to_string(), 1_700_000_000_000))
    );
    assert_eq!(
        ledger_of(&pool).await["video"]["months"]["2026-09"]["views"],
        3
    );
}

#[test]
fn a_ledger_past_its_bound_is_refused() {
    let dir = TempDir::new();
    let path = dir.file("huge.zip");
    let huge = vec![b' '; 64 * 1024 * 1024 + 1];
    zip_of(
        &path,
        &[
            ("app_data.json", bytes(&android_app_data())),
            ("recap_stats.json", huge),
        ],
    );
    assert!(matches!(
        read_backup_file(&path, 0),
        Err(ReadError::TooLarge)
    ));
}

#[test]
fn hostile_files_fail_cleanly() {
    let dir = TempDir::new();
    let garbage = dir.file("broken.zip");
    std::fs::write(&garbage, b"PK\x03\x04 not really a zip").unwrap();
    assert!(read_backup_file(&garbage, 0).is_err());

    let deep = dir.file("deep.json");
    std::fs::write(&deep, "[".repeat(100_000)).unwrap();
    assert!(matches!(
        read_backup_file(&deep, 0).unwrap(),
        BackupFile::Text(_)
    ));

    let empty = dir.file("empty.zip");
    zip_of(&empty, &[("readme.txt", b"hello".to_vec())]);
    assert!(read_backup_file(&empty, 0).is_err());
}
