//! apply-pipeline tests. Exercise the full atomic apply against an in-memory SQLite DB:
//! merge-on-apply, the `sync_log` idempotency guard, tombstone deletes, and transactional rollback
//! (a bad payload must leave the database completely untouched).

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{
    Collection, FlowNeuroBrainSnapshot, GCounter, Hlc, Like, LikeKind, LikeState,
    MusicBrainSnapshot, Playlist, PlaylistItem, PlaylistOrigin, SettingEntry, SubscribedChannel,
    SubscriptionGroup, WatchHistoryRecord,
};
use flow_desktop_lib::sync::mapping;
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

/// Seed two local rows: v1 (50% watched) and v2 (70% watched).
async fn seed(pool: &SqlitePool) {
    for (id, title, watched, total, hlc) in [
        ("v1", "t1", 100_i64, 200_i64, "100:0:dlocal"),
        ("v2", "t2", 140_i64, 200_i64, "150:0:dlocal"),
    ] {
        sqlx::query(
            "INSERT INTO watch_history
                (video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
                 total_duration_seconds, is_music, is_short, updated_hlc)
             VALUES (?, ?, NULL, NULL, ?, ?, ?, 0, 0, ?)",
        )
        .bind(id)
        .bind(title)
        .bind("2025-01-01T00:00:00+00:00")
        .bind(watched)
        .bind(total)
        .bind(hlc)
        .execute(pool)
        .await
        .unwrap();
    }
}

fn wh(
    id: &str,
    title: &str,
    progress: f32,
    dur: u64,
    hlc: &str,
    deleted: bool,
) -> WatchHistoryRecord {
    WatchHistoryRecord {
        video_id: id.to_string(),
        title: title.to_string(),
        channel_name: None,
        channel_id: None,
        watched_at_ms: 1_700_000_000_000,
        progress,
        duration_seconds: Some(dur),
        is_music: false,
        is_short: false,
        hlc: hlc.parse().unwrap(),
        deleted,
    }
}

fn ndjson(recs: &[WatchHistoryRecord]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, r) in recs.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        out.extend_from_slice(&serde_json::to_vec(r).unwrap());
    }
    out
}

fn staged(recs: &[WatchHistoryRecord], hash: &str) -> StagedCollection {
    StagedCollection {
        collection: Collection::WatchHistory,
        ndjson: ndjson(recs),
        record_count: recs.len() as u64,
        hash: hash.to_string(),
    }
}

async fn watch_duration(pool: &SqlitePool, video_id: &str) -> Option<i64> {
    sqlx::query_scalar::<_, i64>(
        "SELECT watch_duration_seconds FROM watch_history WHERE video_id = ?",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn row_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM watch_history")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn apply_merges_progress_updates_metadata_and_inserts_new_rows() {
    let pool = memory_pool().await;
    seed(&pool).await;

    // Incoming: v1 advanced to 90% with newer metadata, plus a brand-new v3.
    let payload = staged(
        &[
            wh("v1", "t1-new", 0.9, 200, "200:0:dpeer", false),
            wh("v3", "t3", 0.3, 100, "120:0:dpeer", false),
        ],
        "hash-1",
    );

    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    let st = &report.stats[0];
    assert_eq!(st.added, 1, "v3 is new");
    assert_eq!(st.updated, 1, "v1 changed");
    assert_eq!(st.skipped, 1, "v2 unchanged");
    assert_eq!(st.tombstoned, 0);
    assert!(
        report.backup.contains("watch_history"),
        "a pre-merge backup was captured"
    );

    assert_eq!(row_count(&pool).await, 3);
    // progress merged to max(0.5, 0.9) = 0.9 -> 0.9 * 200 = 180s
    assert_eq!(watch_duration(&pool, "v1").await, Some(180));
    let title: String = sqlx::query_scalar("SELECT title FROM watch_history WHERE video_id = 'v1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "t1-new", "metadata follows the higher-HLC record");
}

#[tokio::test]
async fn re_applying_the_same_payload_is_a_no_op() {
    let pool = memory_pool().await;
    seed(&pool).await;

    let recs = [wh("v1", "t1-new", 0.9, 200, "200:0:dpeer", false)];
    let first = apply_payload(&pool, OUR, PEER, &[staged(&recs, "hash-1")])
        .await
        .unwrap();
    assert_eq!(first.stats[0].updated, 1);

    // Same payload hash again -> the sync_log guard short-circuits the whole collection.
    let second = apply_payload(&pool, OUR, PEER, &[staged(&recs, "hash-1")])
        .await
        .unwrap();
    assert_eq!(second.stats[0].updated, 0);
    assert_eq!(second.stats[0].skipped, 1, "guarded as already applied");

    assert_eq!(
        watch_duration(&pool, "v1").await,
        Some(180),
        "no double-apply"
    );
    assert_eq!(row_count(&pool).await, 2);
}

#[tokio::test]
async fn tombstone_deletes_the_local_row() {
    let pool = memory_pool().await;
    seed(&pool).await;

    let payload = staged(&[wh("v2", "t2", 0.7, 200, "300:0:dpeer", true)], "hash-del");
    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    assert_eq!(report.stats[0].tombstoned, 1);

    assert_eq!(row_count(&pool).await, 1);
    assert!(
        watch_duration(&pool, "v2").await.is_none(),
        "v2 was deleted"
    );
    assert!(watch_duration(&pool, "v1").await.is_some(), "v1 untouched");
}

#[tokio::test]
async fn a_malformed_payload_rolls_back_the_whole_transaction() {
    let pool = memory_pool().await;
    seed(&pool).await;

    let bad = StagedCollection {
        collection: Collection::WatchHistory,
        ndjson: b"{\"videoId\":\"v9\"}\nthis is not json".to_vec(),
        record_count: 2,
        hash: "hash-bad".to_string(),
    };

    let result = apply_payload(&pool, OUR, PEER, &[bad]).await;
    assert!(result.is_err(), "malformed NDJSON must fail the apply");

    // Nothing partially applied: still exactly the two seeded rows, v1 unchanged.
    assert_eq!(row_count(&pool).await, 2);
    assert_eq!(watch_duration(&pool, "v1").await, Some(100));
    // ...and the failed attempt left no sync_log entry.
    let logged: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sync_log WHERE payload_hash = 'hash-bad' LIMIT 1")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(logged.is_none());
}

// --------------------------------------------------------------------------------------------
// Likes & playlists (frontend JSON blobs in `settings`)
// --------------------------------------------------------------------------------------------

async fn seed_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2025-01-01T00:00:00Z')",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn read_setting(pool: &SqlitePool, key: &str) -> String {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn vlike(id: &str, liked_at: &str) -> Like {
    let ms = mapping::iso_to_ms(liked_at);
    Like {
        kind: LikeKind::Video,
        id: id.to_string(),
        state: LikeState::Liked,
        updated_at_ms: ms,
        hlc: Hlc::new(ms, 0, PEER),
        meta: Some(serde_json::json!({
            "kind": "video", "id": id, "likedAt": liked_at,
            "video": { "id": id, "title": format!("title-{id}"), "channelName": "chan" }
        })),
    }
}

fn likes_ndjson(likes: &[Like]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, l) in likes.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        out.extend_from_slice(&serde_json::to_vec(l).unwrap());
    }
    out
}

#[tokio::test]
async fn apply_likes_unions_into_the_blob_losslessly() {
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "liked_items",
        r#"[{"kind":"video","id":"v1","likedAt":"2025-01-01T00:00:00+00:00","video":{"id":"v1","title":"t1","channelName":"c"}}]"#,
    )
    .await;

    let incoming = [
        vlike("v2", "2025-02-01T00:00:00+00:00"),
        vlike("v3", "2025-03-01T00:00:00+00:00"),
    ];
    let payload = StagedCollection {
        collection: Collection::Likes,
        ndjson: likes_ndjson(&incoming),
        record_count: 2,
        hash: "likes-1".to_string(),
    };

    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    assert_eq!(report.stats[0].added, 2);
    assert_eq!(
        report.stats[0].skipped, 1,
        "existing v1 retained, unchanged"
    );

    let blob = read_setting(&pool, "liked_items").await;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&blob).unwrap();
    assert_eq!(arr.len(), 3);
    let ids: Vec<&str> = arr.iter().filter_map(|x| x["id"].as_str()).collect();
    assert!(ids.contains(&"v1") && ids.contains(&"v2") && ids.contains(&"v3"));
    // v1's original nested object survived (lossless meta passthrough).
    let v1 = arr.iter().find(|x| x["id"] == "v1").unwrap();
    assert_eq!(v1["video"]["title"], "t1");
}

#[tokio::test]
async fn apply_playlists_unions_tracks_by_video_id() {
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "user_playlists",
        r#"[{"id":"playlist-1","name":"Gym","source":"Owned","createdAt":"2025-01-01T00:00:00+00:00","tracks":[{"id":"a","title":"A","channelName":"CA","viewCountText":"1M views"}]}]"#,
    )
    .await;

    let created = mapping::iso_to_ms("2025-01-01T00:00:00+00:00");
    let item = |id: &str| PlaylistItem {
        video_id: id.to_string(),
        position: 0,
        added_at_ms: created,
        deleted: false,
        title: Some(format!("T{id}")),
        channel_name: Some("C".to_string()),
        channel_id: None,
        thumbnail_url: None,
        duration_seconds: None,
        is_music: false,
        hlc: Hlc::new(created, 0, PEER),
        raw: None,
    };
    let incoming = Playlist {
        sync_id: "playlist-1".to_string(),
        origin: PlaylistOrigin::Local,
        youtube_id: None,
        title: "Gym".to_string(),
        description: None,
        thumbnail_url: None,
        is_music: false,
        is_user_created: true,
        is_protected: false,
        created_at_ms: created,
        updated_hlc: Hlc::new(created, 0, PEER),
        deleted: false,
        items: vec![item("b")], // peer contributes a new track; local 'a' stays untouched
        raw: None,
    };
    let payload = StagedCollection {
        collection: Collection::Playlists,
        ndjson: serde_json::to_vec(&incoming).unwrap(),
        record_count: 1,
        hash: "pl-1".to_string(),
    };

    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    assert_eq!(report.stats[0].updated, 1);

    let blob = read_setting(&pool, "user_playlists").await;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&blob).unwrap();
    assert_eq!(arr.len(), 1);
    let tracks = arr[0]["tracks"].as_array().unwrap();
    assert_eq!(tracks.len(), 2, "track 'b' was unioned in");
    let track_ids: Vec<&str> = tracks.iter().filter_map(|t| t["id"].as_str()).collect();
    assert!(track_ids.contains(&"a") && track_ids.contains(&"b"));
    // The local track 'a' kept its cached display metadata (lossless raw passthrough).
    let a = tracks.iter().find(|t| t["id"] == "a").unwrap();
    assert_eq!(a["viewCountText"], "1M views");
}

// --------------------------------------------------------------------------------------------
// Settings & brains
// --------------------------------------------------------------------------------------------

fn ndjson_of<T: serde::Serialize>(items: &[T]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, x) in items.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        out.extend_from_slice(&serde_json::to_vec(x).unwrap());
    }
    out
}

#[tokio::test]
async fn apply_settings_merges_whitelisted_and_ignores_excluded() {
    let pool = memory_pool().await;
    seed_setting(&pool, "autoplay_enabled", "true").await;
    seed_setting(&pool, "playback_speed", "1.0").await;

    let newer = Hlc::new(mapping::iso_to_ms("2030-01-01T00:00:00+00:00"), 0, PEER);
    let sv = |k: &str, v: &str| SettingEntry {
        key: k.to_string(),
        value: serde_json::Value::String(v.to_string()),
        hlc: newer.clone(),
    };
    let incoming = vec![
        sv("autoplay_enabled", "false"),       // updates an existing key
        sv("default_quality_wifi", "720p"),    // adds a new whitelisted key
        sv("download_location", "/somewhere"), // EXCLUDED — must be ignored
    ];
    let payload = StagedCollection {
        collection: Collection::Settings,
        ndjson: ndjson_of(&incoming),
        record_count: 3,
        hash: "set-1".to_string(),
    };

    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    assert!(report.stats[0].updated >= 1 && report.stats[0].added >= 1);

    assert_eq!(read_setting(&pool, "autoplay_enabled").await, "false");
    assert_eq!(read_setting(&pool, "default_quality_wifi").await, "720p");
    assert_eq!(
        read_setting(&pool, "playback_speed").await,
        "1.0",
        "untouched key kept"
    );
    let excluded: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'download_location'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(excluded.is_none(), "download path must never be synced");
}

#[tokio::test]
async fn apply_subscriptions_unions_groups_and_channels() {
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "subscription_groups",
        r#"[{"name":"Tech","channelIds":["UCa"],"sortOrder":0},{"name":"Music","channelIds":["UCm"],"sortOrder":1}]"#,
    )
    .await;

    let peer_hlc = "9999999999999:0:dpeer";
    let incoming = vec![
        SubscriptionGroup {
            channel_ids: vec!["UCb".to_string()],
            deleted: false,
            hlc: peer_hlc.parse().unwrap(),
            name: "Tech".to_string(),
            sort_order: 0,
        },
        SubscriptionGroup {
            channel_ids: vec!["UCn".to_string()],
            deleted: false,
            hlc: peer_hlc.parse().unwrap(),
            name: "News".to_string(),
            sort_order: 2,
        },
    ];
    let payload = StagedCollection {
        collection: Collection::Subscriptions,
        ndjson: ndjson_of(&incoming),
        record_count: 2,
        hash: "subs-1".to_string(),
    };

    let report = apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();
    assert_eq!(report.stats[0].collection_key, "subscriptions");

    let raw = read_setting(&pool, "subscription_groups").await;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(arr.len(), 3, "Tech + Music (kept) + News (added)");

    let tech = arr.iter().find(|g| g["name"] == "Tech").unwrap();
    let ch: Vec<&str> = tech["channelIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert!(
        ch.contains(&"UCa") && ch.contains(&"UCb"),
        "the group's channel ids were unioned across devices"
    );
    assert!(
        arr.iter().any(|g| g["name"] == "News"),
        "new group imported"
    );
    assert!(
        arr.iter().any(|g| g["name"] == "Music"),
        "untouched local group preserved"
    );
}

#[tokio::test]
async fn apply_flow_neuro_brain_merges_into_effective_userbrain() {
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "user_neuro_brain",
        r#"{"idf_total_documents":100,"total_interactions":50,"blocked_topics":["politics"]}"#,
    )
    .await;

    let mut snap = FlowNeuroBrainSnapshot {
        schema: 14,
        device_id: PEER.to_string(),
        hlc: Hlc::new(1000, 0, PEER),
        ..Default::default()
    };
    snap.counters.idf_total_documents = GCounter::single(PEER, 200);
    snap.sets
        .blocked_topics
        .add("gaming", Hlc::new(1000, 0, PEER));
    snap.vectors
        .global_vector
        .topics
        .insert("coding".to_string(), 0.5);

    let payload = StagedCollection {
        collection: Collection::FlowNeuroBrain,
        ndjson: ndjson_of(&[snap]),
        record_count: 1,
        hash: "fn-1".to_string(),
    };
    apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();

    let brain: serde_json::Value =
        serde_json::from_str(&read_setting(&pool, "user_neuro_brain").await).unwrap();
    // G-Counter: local 100 + peer 200 (no double-count)
    assert_eq!(brain["idf_total_documents"], 300);
    let blocked: Vec<String> = serde_json::from_value(brain["blocked_topics"].clone()).unwrap();
    assert!(blocked.contains(&"politics".to_string()) && blocked.contains(&"gaming".to_string()));
    assert!(
        brain["global_vector"]["topics"].get("coding").is_some(),
        "peer's learned topic blended into the effective vector"
    );

    // The per-device merged CRDT state is persisted for idempotent future syncs.
    let merged: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'sync_neuro_merged'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(merged.is_some());
}

#[tokio::test]
async fn apply_music_brain_merges_into_effective() {
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "user_music_brain",
        r#"{"total_plays":100,"blocked_artists":["UCspam"]}"#,
    )
    .await;

    let mut snap = MusicBrainSnapshot {
        schema: 3,
        device_id: PEER.to_string(),
        hlc: Hlc::new(1000, 0, PEER),
        ..Default::default()
    };
    snap.total_plays = GCounter::single(PEER, 50);
    snap.blocked_artists.add("UCbad", Hlc::new(1000, 0, PEER));

    let payload = StagedCollection {
        collection: Collection::MusicBrain,
        ndjson: ndjson_of(&[snap]),
        record_count: 1,
        hash: "mb-1".to_string(),
    };
    apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();

    let brain: serde_json::Value =
        serde_json::from_str(&read_setting(&pool, "user_music_brain").await).unwrap();
    assert_eq!(brain["total_plays"], 150); // 100 + 50
    let blocked: Vec<String> = serde_json::from_value(brain["blocked_artists"].clone()).unwrap();
    assert!(blocked.contains(&"UCspam".to_string()) && blocked.contains(&"UCbad".to_string()));
}

#[tokio::test]
async fn an_android_shaped_brain_record_applies_instead_of_rolling_back_everything() {
    // Regression for issue #46. Flow for Android sends the brain with its counters, sets, LWW-maps
    // and flags at the top level and its G-Counters wrapped in `perDevice`. The strict decoder
    // failed with `invalid type: map, expected u64`, and because apply is one transaction that
    // rollback took *every* collection with it — the phone reported success while the desktop
    // imported nothing. The record below is shaped exactly as `BrainMapper.toCanonical` emits it.
    let pool = memory_pool().await;
    seed_setting(
        &pool,
        "user_neuro_brain",
        r#"{"idf_total_documents":100,"total_interactions":50,"blocked_topics":["politics"]}"#,
    )
    .await;

    let android_record = format!(
        r#"{{"schema":13,"deviceId":"{PEER}","hlc":"1000:0:{PEER}",
            "vectors":{{"globalVector":{{"topics":{{"coding":0.5}},"duration":0.5,"pacing":0.4,"complexity":0.6,"isLive":0.0}},
                        "timeVectors":{{"WEEKDAY_EVENING":{{"topics":{{"music":0.9}},"duration":0.5,"pacing":0.5,"complexity":0.5,"isLive":0.0}}}}}},
            "idfTotalDocuments":{{"perDevice":{{"{PEER}":200}}}},
            "totalInteractions":{{"perDevice":{{"{PEER}":25}}}},
            "idfWordFrequency":{{"music":{{"perDevice":{{"{PEER}":3}}}}}},
            "watchHistoryMap":{{"vid1":0.75}},
            "suppressedVideoIds":{{"vidbad":1784462799000}},
            "blockedTopics":["gaming"],
            "hasCompletedOnboarding":true}}"#
    );

    let payload = StagedCollection {
        collection: Collection::FlowNeuroBrain,
        ndjson: android_record.replace(['\n', ' '], "").into_bytes(),
        record_count: 1,
        hash: "android-brain-1".to_string(),
    };
    apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();

    let brain: serde_json::Value =
        serde_json::from_str(&read_setting(&pool, "user_neuro_brain").await).unwrap();
    // The `perDevice` wrapper is unwrapped and the counter merges without double-counting.
    assert_eq!(brain["idf_total_documents"], 300); // local 100 + phone 200
    assert_eq!(brain["total_interactions"], 75); // local 50 + phone 25
    // Top-level sets/maps/flags reach their grouped homes instead of being silently dropped.
    let blocked: Vec<String> = serde_json::from_value(brain["blocked_topics"].clone()).unwrap();
    assert!(blocked.contains(&"politics".to_string()) && blocked.contains(&"gaming".to_string()));
    assert_eq!(brain["watch_history_map"]["vid1"], 0.75);
    assert!(brain["suppressed_video_ids"].get("vidbad").is_some());
    assert_eq!(brain["has_completed_onboarding"], true);
    assert!(brain["global_vector"]["topics"].get("coding").is_some());
    // Android's SCREAMING_SNAKE bucket key maps onto our own spelling.
    assert!(
        brain["time_vectors"]["WeekdayEvening"]["topics"]
            .get("music")
            .is_some(),
        "the phone's time-of-day vector must survive the bucket-name difference"
    );
}

// --------------------------------------------------------------------------------------------
// subscribed_channels (FLOW-SYNC/1 §10.0) — the channels themselves, with unsubscribe tombstones.
// --------------------------------------------------------------------------------------------

/// A realistic epoch-ms base: tombstones are pruned against wall-clock `now`, so toy stamps would
/// read as decades old and be dropped before they could be asserted on.
const T0: u64 = 1_781_000_000_000;

fn channel(id: &str, name: &str, offset: u64, deleted: bool) -> SubscribedChannel {
    let at = T0 + offset;
    SubscribedChannel {
        channel_id: id.to_string(),
        name: name.to_string(),
        avatar_url: if name.is_empty() {
            String::new()
        } else {
            format!("https://cdn/{id}.jpg")
        },
        subscribed_at_ms: if deleted { 0 } else { at },
        is_music: false,
        hlc: Hlc::new(at, 0, PEER),
        deleted,
    }
}

fn channels_payload(records: &[SubscribedChannel]) -> StagedCollection {
    StagedCollection {
        collection: Collection::SubscribedChannels,
        ndjson: ndjson_of(records),
        record_count: records.len() as u64,
        hash: format!("chan-{}", records.len()),
    }
}

async fn seed_channels(pool: &SqlitePool, blob: &str) {
    seed_setting(pool, "subscriptions", blob).await;
}

async fn live_ids(pool: &SqlitePool) -> Vec<String> {
    let raw = read_setting(pool, "subscriptions").await;
    serde_json::from_str::<Vec<serde_json::Value>>(&raw)
        .unwrap()
        .into_iter()
        .filter_map(|v| v["id"].as_str().map(str::to_string))
        .collect()
}

#[tokio::test]
async fn a_newer_unsubscribe_from_the_peer_removes_the_local_subscription() {
    let pool = memory_pool().await;
    seed_channels(
        &pool,
        r#"[{"id":"UCx","name":"Cool","avatarUrl":"a.jpg","subscribedAt":1781000001000}]"#,
    )
    .await;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[channels_payload(&[channel("UCx", "", 2000, true)])],
    )
    .await
    .unwrap();

    assert!(live_ids(&pool).await.is_empty(), "the unsubscribe must win");
    // and it is remembered, so a third device hears about it too
    let tombs: serde_json::Value =
        serde_json::from_str(&read_setting(&pool, "subscription_tombstones").await).unwrap();
    assert_eq!(tombs["UCx"], T0 + 2000);
}

#[tokio::test]
async fn an_older_unsubscribe_does_not_remove_a_newer_subscription() {
    let pool = memory_pool().await;
    seed_channels(
        &pool,
        r#"[{"id":"UCx","name":"Cool","avatarUrl":"a.jpg","subscribedAt":1781000005000}]"#,
    )
    .await;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[channels_payload(&[channel("UCx", "", 1000, true)])],
    )
    .await
    .unwrap();

    assert_eq!(live_ids(&pool).await, vec!["UCx".to_string()]);
}

#[tokio::test]
async fn a_peer_record_without_metadata_does_not_blank_the_channel() {
    // A tombstone carries no display metadata, and a bare re-subscribe from a third device may not
    // either — merging must take the non-empty side or the channel turns into a nameless row.
    let pool = memory_pool().await;
    seed_channels(
        &pool,
        r#"[{"id":"UCx","name":"Cool","avatarUrl":"a.jpg","subscribedAt":1781000001000}]"#,
    )
    .await;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[channels_payload(&[channel("UCx", "", 9000, false)])],
    )
    .await
    .unwrap();

    let raw = read_setting(&pool, "subscriptions").await;
    let entries: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(entries[0]["name"], "Cool");
    assert_eq!(entries[0]["avatarUrl"], "a.jpg");
}

#[tokio::test]
async fn a_tombstone_for_a_channel_we_never_had_is_still_retained() {
    // Otherwise the unsubscribe dies here and never reaches a third device that does follow it.
    let pool = memory_pool().await;
    seed_channels(&pool, "[]").await;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[channels_payload(&[channel("UCghost", "", 2000, true)])],
    )
    .await
    .unwrap();

    let tombs: serde_json::Value =
        serde_json::from_str(&read_setting(&pool, "subscription_tombstones").await).unwrap();
    assert_eq!(tombs["UCghost"], T0 + 2000);
    assert!(live_ids(&pool).await.is_empty());
}

#[tokio::test]
async fn applying_channels_preserves_device_local_fields() {
    // `subscriberCountText` is not on the wire. Rebuilding the entry from the canonical record
    // instead of patching it would silently wipe it on every sync.
    let pool = memory_pool().await;
    seed_channels(
        &pool,
        r#"[{"id":"UCx","name":"Old","avatarUrl":"a.jpg","subscribedAt":1781000001000,"subscriberCountText":"1.2M subscribers"}]"#,
    )
    .await;

    apply_payload(
        &pool,
        OUR,
        PEER,
        &[channels_payload(&[channel("UCx", "New", 4000, false)])],
    )
    .await
    .unwrap();

    let raw = read_setting(&pool, "subscriptions").await;
    let entries: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(entries[0]["name"], "New", "the newer name still wins");
    assert_eq!(entries[0]["subscriberCountText"], "1.2M subscribers");
}

#[tokio::test]
async fn re_applying_a_channel_payload_is_a_no_op() {
    let pool = memory_pool().await;
    seed_channels(&pool, "[]").await;
    let payload = channels_payload(&[channel("UCx", "Cool", 3000, false)]);

    apply_payload(&pool, OUR, PEER, std::slice::from_ref(&payload))
        .await
        .unwrap();
    let after_first = read_setting(&pool, "subscriptions").await;
    apply_payload(&pool, OUR, PEER, &[payload]).await.unwrap();

    assert_eq!(read_setting(&pool, "subscriptions").await, after_first);
    assert_eq!(live_ids(&pool).await, vec!["UCx".to_string()]);
}
