//! Deletions and edits made on this device reach peers and win against older peer copies, peer
//! tombstones are relayed, and playlists keep their identity across renames.

use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{
    Collection, Hlc, Like, LikeKind, LikeState, Playlist, SubscriptionGroup, WatchHistoryRecord,
};
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::local_edits;
use flow_desktop_lib::sync::protocol::StagedCollection;

const DESK: &str = "ddesk";
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

/// The frontend's write path: `set_setting` records the edit, then stores the blob.
async fn frontend_write(pool: &SqlitePool, key: &str, value: &str) {
    local_edits::record_blob_write(pool, key, value)
        .await
        .unwrap();
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

async fn blob(pool: &SqlitePool, key: &str) -> Vec<Value> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap();
    serde_json::from_str(raw.as_deref().unwrap_or("[]")).unwrap()
}

async fn add_watch(pool: &SqlitePool, video_id: &str, watched: &str) {
    sqlx::query(
        "INSERT INTO watch_history (video_id, title, watch_date, watch_duration_seconds) VALUES (?, ?, ?, 10)",
    )
    .bind(video_id)
    .bind(format!("title-{video_id}"))
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

/// What the desktop's delete-history command does.
async fn delete_watch(pool: &SqlitePool, video_id: &str) {
    local_edits::record_watch_deletion(pool, Some(video_id))
        .await
        .unwrap();
    sqlx::query("DELETE FROM watch_history WHERE video_id = ?")
        .bind(video_id)
        .execute(pool)
        .await
        .unwrap();
}

fn records<T: serde::de::DeserializeOwned>(ndjson: &[u8]) -> Vec<T> {
    ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice(l).unwrap())
        .collect()
}

async fn export_one(pool: &SqlitePool, collection: Collection) -> Vec<u8> {
    export_collections(pool, DESK, &[collection])
        .await
        .unwrap()
        .remove(0)
        .ndjson
}

fn stage_bytes(collection: Collection, ndjson: Vec<u8>, hash: &str) -> StagedCollection {
    let record_count = ndjson.split(|&b| b == b'\n').count() as u64;
    StagedCollection {
        collection,
        ndjson,
        record_count,
        hash: hash.to_string(),
    }
}

fn stage<T: serde::Serialize>(collection: Collection, items: &[T], hash: &str) -> StagedCollection {
    let lines: Vec<String> = items
        .iter()
        .map(|i| serde_json::to_string(i).unwrap())
        .collect();
    stage_bytes(collection, lines.join("\n").into_bytes(), hash)
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

const LIKED: &str = r#"[{"kind":"video","id":"vid1","likedAt":"2025-01-02T00:00:00+00:00","video":{"id":"vid1","title":"First","channelName":"Chan","thumbnailUrl":"https://img/1.jpg"}}]"#;

// --------------------------------------------------------------------------------------------
// Likes
// --------------------------------------------------------------------------------------------

#[tokio::test]
async fn an_unlike_travels_and_an_older_peer_like_cannot_undo_it() {
    let desk = memory_pool().await;
    frontend_write(&desk, "liked_items", LIKED).await;
    frontend_write(&desk, "liked_items", "[]").await;

    let likes: Vec<Like> = records(&export_one(&desk, Collection::Likes).await);
    assert_eq!(likes.len(), 1);
    assert_eq!(likes[0].id, "vid1");
    assert_eq!(
        likes[0].state,
        LikeState::None,
        "the unlike is shipped, not omitted"
    );

    // A peer that still has the like from before the unlike sends it back.
    let stale = Like {
        kind: LikeKind::Video,
        id: "vid1".to_string(),
        state: LikeState::Liked,
        updated_at_ms: 1_735_776_000_000,
        hlc: Hlc::new(1_735_776_000_000, 0, PEER),
        meta: None,
    };
    apply_payload(
        &desk,
        DESK,
        PEER,
        &[stage(Collection::Likes, &[stale], "l1")],
    )
    .await
    .unwrap();
    assert!(
        blob(&desk, "liked_items").await.is_empty(),
        "the unlike wins"
    );

    // The peer receiving the desktop's export drops its like.
    let peer = memory_pool().await;
    frontend_write(&peer, "liked_items", LIKED).await;
    let out = export_one(&desk, Collection::Likes).await;
    apply_payload(
        &peer,
        PEER,
        DESK,
        &[stage_bytes(Collection::Likes, out, "l2")],
    )
    .await
    .unwrap();
    assert!(blob(&peer, "liked_items").await.is_empty());
}

#[tokio::test]
async fn desktop_likes_carry_flat_meta_for_android() {
    let desk = memory_pool().await;
    frontend_write(&desk, "liked_items", LIKED).await;
    let likes: Vec<Like> = records(&export_one(&desk, Collection::Likes).await);
    let meta = likes[0].meta.as_ref().unwrap();
    assert_eq!(meta["title"], "First");
    assert_eq!(meta["artist"], "Chan");
    assert_eq!(meta["thumbnailUrl"], "https://img/1.jpg");
    assert_eq!(
        meta["video"]["id"], "vid1",
        "nested object kept for desktop peers"
    );
}

// --------------------------------------------------------------------------------------------
// Watch history
// --------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_history_delete_travels_and_beats_the_older_peer_row() {
    let desk = memory_pool().await;
    add_watch(&desk, "v1", "2025-01-01T00:00:00+00:00").await;
    add_watch(&desk, "v2", "2025-01-01T00:00:00+00:00").await;
    delete_watch(&desk, "v1").await;

    let out: Vec<WatchHistoryRecord> = records(&export_one(&desk, Collection::WatchHistory).await);
    let v1 = out.iter().find(|r| r.video_id == "v1").unwrap();
    assert!(v1.deleted);

    // The peer still has v1 from before the delete: it must not come back.
    let old = WatchHistoryRecord {
        video_id: "v1".to_string(),
        title: "title-v1".to_string(),
        watched_at_ms: 1_735_689_600_000,
        hlc: Hlc::new(1_735_689_600_000, 0, PEER),
        ..Default::default()
    };
    apply_payload(
        &desk,
        DESK,
        PEER,
        &[stage(
            Collection::WatchHistory,
            std::slice::from_ref(&old),
            "w1",
        )],
    )
    .await
    .unwrap();
    assert_eq!(watched_ids(&desk).await, vec!["v2"]);

    // Watching it again on the peer after the delete brings it back.
    let rewatch = WatchHistoryRecord {
        watched_at_ms: now_ms() + 60_000,
        hlc: Hlc::new(now_ms() + 60_000, 0, PEER),
        ..old
    };
    apply_payload(
        &desk,
        DESK,
        PEER,
        &[stage(Collection::WatchHistory, &[rewatch], "w2")],
    )
    .await
    .unwrap();
    assert_eq!(watched_ids(&desk).await, vec!["v1", "v2"]);
    let out: Vec<WatchHistoryRecord> = records(&export_one(&desk, Collection::WatchHistory).await);
    assert!(
        out.iter().all(|r| !r.deleted),
        "the re-watch retired the tombstone"
    );
}

#[tokio::test]
async fn clearing_history_tombstones_every_row() {
    let desk = memory_pool().await;
    add_watch(&desk, "v1", "2025-01-01T00:00:00+00:00").await;
    add_watch(&desk, "v2", "2025-01-01T00:00:00+00:00").await;
    local_edits::record_watch_deletion(&desk, None)
        .await
        .unwrap();
    sqlx::query("DELETE FROM watch_history")
        .execute(&desk)
        .await
        .unwrap();

    let out: Vec<WatchHistoryRecord> = records(&export_one(&desk, Collection::WatchHistory).await);
    assert_eq!(out.len(), 2);
    assert!(out.iter().all(|r| r.deleted));
}

#[tokio::test]
async fn a_peer_tombstone_is_relayed_verbatim() {
    let desk = memory_pool().await;
    let tombstone = WatchHistoryRecord {
        video_id: "never-here".to_string(),
        hlc: Hlc::new(now_ms(), 3, PEER),
        deleted: true,
        ..Default::default()
    };
    apply_payload(
        &desk,
        DESK,
        PEER,
        &[stage(
            Collection::WatchHistory,
            std::slice::from_ref(&tombstone),
            "w1",
        )],
    )
    .await
    .unwrap();
    let out: Vec<WatchHistoryRecord> = records(&export_one(&desk, Collection::WatchHistory).await);
    assert_eq!(out, vec![tombstone], "relayed with the peer's own stamp");
}

// --------------------------------------------------------------------------------------------
// Playlists
// --------------------------------------------------------------------------------------------

const GYM: &str = r#"[{"id":"pl1","name":"Gym","source":"Owned","createdAt":"2025-01-01T00:00:00+00:00","tracks":[{"id":"a","title":"A","channelName":"CA"},{"id":"b","title":"B","channelName":"CB"}]}]"#;

async fn names(pool: &SqlitePool) -> Vec<String> {
    blob(pool, "user_playlists")
        .await
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect()
}

async fn track_ids(pool: &SqlitePool) -> Vec<String> {
    blob(pool, "user_playlists").await[0]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect()
}

/// Two desktops that already share playlist `pl1`.
async fn paired() -> (SqlitePool, SqlitePool) {
    let a = memory_pool().await;
    let b = memory_pool().await;
    frontend_write(&a, "user_playlists", GYM).await;
    let out = export_one(&a, Collection::Playlists).await;
    apply_payload(
        &b,
        PEER,
        DESK,
        &[stage_bytes(Collection::Playlists, out, "p0")],
    )
    .await
    .unwrap();
    (a, b)
}

async fn send(from: &SqlitePool, to: &SqlitePool, hash: &str) {
    let out = export_one(from, Collection::Playlists).await;
    apply_payload(
        to,
        PEER,
        DESK,
        &[stage_bytes(Collection::Playlists, out, hash)],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_rename_wins_and_stays_one_playlist() {
    let (a, b) = paired().await;
    frontend_write(&a, "user_playlists", &GYM.replace("\"Gym\"", "\"Leg day\"")).await;
    send(&a, &b, "p1").await;
    assert_eq!(names(&b).await, vec!["Leg day"]);
}

#[tokio::test]
async fn a_removed_track_and_a_deleted_playlist_travel() {
    let (a, b) = paired().await;
    let without_b = r#"[{"id":"pl1","name":"Gym","source":"Owned","createdAt":"2025-01-01T00:00:00+00:00","tracks":[{"id":"a","title":"A","channelName":"CA"}]}]"#;
    frontend_write(&a, "user_playlists", without_b).await;
    send(&a, &b, "p1").await;
    assert_eq!(track_ids(&b).await, vec!["a"]);

    frontend_write(&a, "user_playlists", "[]").await;
    send(&a, &b, "p2").await;
    assert!(names(&b).await.is_empty());

    // And B, now holding the tombstone, does not send the playlist back.
    send(&b, &a, "p3").await;
    assert!(names(&a).await.is_empty());
}

#[tokio::test]
async fn same_titled_playlists_share_one_id_so_a_later_rename_still_matches() {
    let a = memory_pool().await;
    let b = memory_pool().await;
    frontend_write(&a, "user_playlists", GYM).await;
    frontend_write(
        &b,
        "user_playlists",
        r#"[{"id":"pl-b","name":"gym ","source":"Owned","createdAt":"2025-02-01T00:00:00+00:00","tracks":[{"id":"c","title":"C","channelName":"CC"}]}]"#,
    )
    .await;

    send(&a, &b, "p1").await;
    let on_b = blob(&b, "user_playlists").await;
    assert_eq!(on_b.len(), 1, "matched by title on first contact");
    assert_eq!(on_b[0]["id"], "pl1", "the receiver adopts the sender's id");

    frontend_write(&a, "user_playlists", &GYM.replace("\"Gym\"", "\"Legs\"")).await;
    send(&a, &b, "p2").await;
    assert_eq!(
        names(&b).await,
        vec!["Legs"],
        "no duplicate after the rename"
    );
}

// --------------------------------------------------------------------------------------------
// Subscription groups
// --------------------------------------------------------------------------------------------

#[tokio::test]
async fn a_deleted_group_travels() {
    let a = memory_pool().await;
    let b = memory_pool().await;
    frontend_write(
        &a,
        "subscription_groups",
        r#"[{"name":"Tech","channelIds":["UCa"],"sortOrder":0}]"#,
    )
    .await;
    let out = export_one(&a, Collection::Subscriptions).await;
    apply_payload(
        &b,
        PEER,
        DESK,
        &[stage_bytes(Collection::Subscriptions, out, "g1")],
    )
    .await
    .unwrap();
    assert_eq!(blob(&b, "subscription_groups").await.len(), 1);

    frontend_write(&a, "subscription_groups", "[]").await;
    let out = export_one(&a, Collection::Subscriptions).await;
    let groups: Vec<SubscriptionGroup> = records(&out);
    assert!(groups[0].deleted);
    apply_payload(
        &b,
        PEER,
        DESK,
        &[stage_bytes(Collection::Subscriptions, out, "g2")],
    )
    .await
    .unwrap();
    assert!(blob(&b, "subscription_groups").await.is_empty());
}

// --------------------------------------------------------------------------------------------
// Android-shaped records (synthetic, field-for-field with Flow for Android's canonical model)
// --------------------------------------------------------------------------------------------

#[tokio::test]
async fn android_shaped_records_apply() {
    let desk = memory_pool().await;
    let t = now_ms();

    let history = json!({
        "videoId": "aw1", "title": "From phone", "channelName": "", "channelId": "",
        "thumbnailUrl": "https://img/aw1.jpg", "watchedAtMs": t, "progress": 0.5,
        "durationSeconds": 120, "isMusic": false, "isShort": false,
        "hlc": format!("{t}:0:a1b2c3d4"), "deleted": false
    });
    let like = json!({
        "kind": "video", "id": "al1", "state": "liked", "updatedAtMs": t,
        "hlc": format!("{t}:0:a1b2c3d4"),
        "meta": { "title": "Liked on phone", "artist": "Chan", "thumbnailUrl": "https://img/al1.jpg" },
        "title": "Liked on phone", "channelName": "Chan", "thumbnailUrl": "https://img/al1.jpg"
    });
    let disliked = json!({
        "kind": "video", "id": "ad1", "state": "disliked", "updatedAtMs": t,
        "hlc": format!("{t}:0:a1b2c3d4"), "meta": {}, "title": "", "channelName": "", "thumbnailUrl": ""
    });
    let playlist = json!({
        "syncId": "sync_3f2a", "origin": "local", "youtubeId": null, "title": "Phone mix",
        "description": "", "isMusic": false, "isUserCreated": true, "isProtected": false,
        "createdAtMs": t, "updatedHlc": format!("{t}:0:a1b2c3d4"), "deleted": false,
        "items": [{
            "videoId": "ap1", "position": 0, "addedAtMs": t, "deleted": false, "title": "P1",
            "channelName": "CP", "channelId": "UCp", "thumbnailUrl": "", "durationSeconds": 90,
            "isMusic": false, "hlc": format!("{t}:0:a1b2c3d4")
        }]
    });
    let group = json!({
        "name": "Phone group", "channelIds": ["UCx"], "sortOrder": 2,
        "hlc": format!("{t}:0:a1b2c3d4"), "deleted": false
    });
    let line = |v: &Value| serde_json::to_vec(v).unwrap();
    let staged = vec![
        stage_bytes(Collection::WatchHistory, line(&history), "a1"),
        stage_bytes(
            Collection::Likes,
            [line(&like), line(&disliked)].join(&b'\n'),
            "a2",
        ),
        stage_bytes(Collection::Playlists, line(&playlist), "a3"),
        stage_bytes(Collection::Subscriptions, line(&group), "a4"),
    ];
    apply_payload(&desk, DESK, PEER, &staged).await.unwrap();

    assert_eq!(watched_ids(&desk).await, vec!["aw1"]);
    let likes = blob(&desk, "liked_items").await;
    assert_eq!(likes.len(), 1, "a dislike is not a desktop like");
    assert_eq!(likes[0]["video"]["title"], "Liked on phone");
    assert_eq!(names(&desk).await, vec!["Phone mix"]);
    assert_eq!(
        blob(&desk, "subscription_groups").await[0]["name"],
        "Phone group"
    );

    // The phone's dislike is relayed unchanged, so another phone keeps it.
    let out: Vec<Like> = records(&export_one(&desk, Collection::Likes).await);
    let relayed = out.iter().find(|l| l.id == "ad1").unwrap();
    assert_eq!(relayed.state, LikeState::Disliked);
    assert_eq!(relayed.hlc.device_id, "a1b2c3d4");

    // The playlist keeps the phone's sync id, so the phone matches it on the way back.
    let back: Vec<Playlist> = records(&export_one(&desk, Collection::Playlists).await);
    assert_eq!(back[0].sync_id, "sync_3f2a");
}
