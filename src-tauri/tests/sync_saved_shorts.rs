//! Android's `saved_shorts` playlist and the desktop's Saved Shorts library are one list on the
//! wire, so they merge track by track in both directions.

use flow_desktop_lib::sync::apply::{BACKUP_RESTORE_PEER_PREFIX, apply_payload};
use flow_desktop_lib::sync::canonical::{Collection, Playlist};
use flow_desktop_lib::sync::changes::{self, Change};
use flow_desktop_lib::sync::codec::sha256_hex;
use flow_desktop_lib::sync::export::{export_collections, export_for_backup};
use flow_desktop_lib::sync::local_edits::{diff_blob, is_synced_setting, record_blob_write};
use flow_desktop_lib::sync::protocol::StagedCollection;
use flow_desktop_lib::sync::saved_shorts::{
    PEER_KEEPS_LIST_SETTING_KEY, SAVED_SHORTS_SETTING_KEY, adopt_synced_playlist, library_blob,
    parse_library,
};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

const OUR: &str = "desktopdevice";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn now() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap()
}

/// The playlist as Android's `PlaylistMapper.toCanonical` writes it.
fn android_playlist(items: &[(&str, i64, bool)], at: u64) -> String {
    let items: Vec<Value> = items
        .iter()
        .map(|(id, position, deleted)| {
            json!({
                "videoId": id, "position": position, "addedAtMs": 1_700_000_000_000_u64,
                "deleted": deleted, "title": format!("Short {id}"), "channelName": "A channel",
                "channelId": "UCx", "thumbnailUrl": "https://x/t.jpg", "durationSeconds": 30,
                "isMusic": false, "hlc": format!("{at}:0:aaaaaaaa"),
            })
        })
        .collect();
    json!({
        "syncId": "saved_shorts", "origin": "local", "youtubeId": null, "title": "Saved Shorts",
        "description": "Your saved shorts", "isMusic": false, "isUserCreated": true,
        "isProtected": false, "createdAtMs": 1_600_000_000_000_u64,
        "updatedHlc": format!("{at}:0:aaaaaaaa"), "deleted": false, "items": items,
    })
    .to_string()
}

async fn receive(pool: &SqlitePool, line: &str) {
    let ndjson = line.as_bytes().to_vec();
    let staged = StagedCollection {
        collection: Collection::Playlists,
        record_count: 1,
        hash: sha256_hex(&ndjson),
        ndjson,
    };
    apply_payload(pool, OUR, "android", &[staged])
        .await
        .unwrap();
}

async fn setting(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn write_like_the_app(pool: &SqlitePool, key: &str, value: &str) {
    record_blob_write(pool, key, value).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .unwrap();
}

async fn library_ids(pool: &SqlitePool) -> Vec<String> {
    let raw = setting(pool, SAVED_SHORTS_SETTING_KEY)
        .await
        .unwrap_or_else(|| "[]".into());
    let entries: Vec<Value> = serde_json::from_str(&raw).unwrap();
    entries
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_owned())
        .collect()
}

async fn exported(pool: &SqlitePool) -> Vec<Playlist> {
    let out = export_collections(pool, OUR, &[Collection::Playlists])
        .await
        .unwrap();
    out[0]
        .ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice(l).unwrap())
        .collect()
}

#[tokio::test]
async fn android_s_list_arrives_in_the_library_not_as_a_playlist() {
    let pool = pool().await;
    receive(
        &pool,
        &android_playlist(&[("newer", 0, false), ("older", 1, false)], now()),
    )
    .await;
    assert_eq!(library_ids(&pool).await, ["newer", "older"]);
    let playlists = setting(&pool, "user_playlists").await.unwrap_or_default();
    assert!(!playlists.contains("newer"), "{playlists}");

    let raw = setting(&pool, SAVED_SHORTS_SETTING_KEY).await.unwrap();
    let entries: Vec<Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(entries[0]["type"], "short");
    assert_eq!(entries[0]["title"], "Short newer");
    assert_eq!(entries[0]["channelName"], "A channel");
    assert_eq!(entries[0]["addedAtInPlaylist"], 1_700_000_000_000_u64);
}

#[tokio::test]
async fn the_library_goes_out_under_android_s_reserved_id() {
    let pool = pool().await;
    receive(&pool, &android_playlist(&[("theirs", 0, false)], 1)).await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"My short","addedAtInPlaylist":1700000000000}]"#,
    )
    .await;
    let list = exported(&pool).await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].sync_id, "saved_shorts");
    assert!(list[0].is_user_created && !list[0].is_protected && !list[0].is_music);
    assert_eq!(list[0].items[0].video_id, "mine");
    assert_eq!(list[0].items[0].added_at_ms, 1_700_000_000_000);
}

#[tokio::test]
async fn saves_made_here_first_wait_until_a_phone_has_sent_the_list() {
    let pool = pool().await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"},{"type":"short","id":"gone","title":"G"}]"#,
    )
    .await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"}]"#,
    )
    .await;
    assert!(
        exported(&pool).await.is_empty(),
        "neither the list nor a removal from it goes out before a phone has it"
    );

    receive(&pool, &android_playlist(&[("theirs", 0, false)], now())).await;
    let stored = setting(&pool, PEER_KEEPS_LIST_SETTING_KEY).await;
    assert!(
        stored.is_some(),
        "the gate survives a restart in the database"
    );
    let list = exported(&pool).await;
    let ids: Vec<&str> = list[0].items.iter().map(|i| i.video_id.as_str()).collect();
    assert!(ids.contains(&"mine") && ids.contains(&"theirs"), "{ids:?}");
}

#[tokio::test]
async fn a_backup_keeps_the_list_but_restoring_one_does_not_open_the_gate() {
    let pool = pool().await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"}]"#,
    )
    .await;
    let backup = export_for_backup(&pool, OUR, &[Collection::Playlists])
        .await
        .unwrap();
    let staged = StagedCollection {
        collection: Collection::Playlists,
        record_count: 1,
        hash: sha256_hex(&backup[0].ndjson),
        ndjson: backup[0].ndjson.clone(),
    };
    assert!(String::from_utf8_lossy(&staged.ndjson).contains("mine"));

    let restored = self::pool().await;
    let peer = format!("{BACKUP_RESTORE_PEER_PREFIX}1");
    apply_payload(&restored, OUR, &peer, &[staged])
        .await
        .unwrap();
    assert_eq!(library_ids(&restored).await, ["mine"]);
    assert!(exported(&restored).await.is_empty());
}

#[tokio::test]
async fn a_list_titled_like_the_library_is_never_matched_to_it_by_title() {
    let pool = pool().await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"}]"#,
    )
    .await;
    let peer_list = json!({
        "syncId": "playlist-from-phone", "origin": "local", "youtubeId": null,
        "title": "Saved Shorts", "isMusic": false, "isUserCreated": true, "isProtected": false,
        "createdAtMs": 1, "updatedHlc": format!("{}:0:aaaaaaaa", now()), "deleted": false,
        "items": [],
    })
    .to_string();
    receive(&pool, &peer_list).await;
    assert_eq!(library_ids(&pool).await, ["mine"]);
    let playlists = setting(&pool, "user_playlists").await.unwrap();
    assert!(playlists.contains("playlist-from-phone"), "{playlists}");
    assert!(!playlists.contains("\"mine\""), "{playlists}");
}

#[tokio::test]
async fn the_phone_s_list_never_takes_a_playlist_titled_like_it() {
    let pool = pool().await;
    sqlx::query("INSERT INTO settings (key, value) VALUES ('user_playlists', ?)")
        .bind(
            json!([{"id": "mine", "name": "Saved Shorts", "source": "Owned", "tracks": []}])
                .to_string(),
        )
        .execute(&pool)
        .await
        .unwrap();
    receive(&pool, &android_playlist(&[("theirs", 0, false)], now())).await;
    assert_eq!(library_ids(&pool).await, ["theirs"]);
    assert!(
        setting(&pool, "user_playlists")
            .await
            .unwrap()
            .contains("\"mine\"")
    );
}

#[tokio::test]
async fn saves_on_both_sides_are_both_kept() {
    let pool = pool().await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"}]"#,
    )
    .await;
    receive(&pool, &android_playlist(&[("theirs", 0, false)], now())).await;
    let mut ids = library_ids(&pool).await;
    ids.sort();
    assert_eq!(ids, ["mine", "theirs"]);
}

#[tokio::test]
async fn removing_here_sends_a_tombstone_and_a_stale_copy_does_not_undo_it() {
    let pool = pool().await;
    let early = now() - 60_000;
    receive(
        &pool,
        &android_playlist(&[("a", 0, false), ("b", 1, false)], early),
    )
    .await;
    let raw = setting(&pool, SAVED_SHORTS_SETTING_KEY).await.unwrap();
    let kept: Vec<Value> = serde_json::from_str::<Vec<Value>>(&raw)
        .unwrap()
        .into_iter()
        .filter(|e| e["id"] == "b")
        .collect();
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        &Value::from(kept).to_string(),
    )
    .await;

    let list = exported(&pool).await;
    let gone = list[0].items.iter().find(|i| i.video_id == "a").unwrap();
    assert!(gone.deleted, "the removal must reach the phone");

    receive(
        &pool,
        &android_playlist(&[("a", 0, false), ("b", 1, false)], early),
    )
    .await;
    assert_eq!(library_ids(&pool).await, ["b"]);
}

#[tokio::test]
async fn emptying_the_library_still_tells_the_phone() {
    let pool = pool().await;
    receive(&pool, &android_playlist(&[("a", 0, false)], now() - 60_000)).await;
    write_like_the_app(&pool, SAVED_SHORTS_SETTING_KEY, "[]").await;
    let list = exported(&pool).await;
    assert_eq!(list[0].sync_id, "saved_shorts");
    assert!(list[0].items.iter().all(|i| i.deleted) && !list[0].items.is_empty());
}

#[tokio::test]
async fn a_removal_on_the_phone_leaves_the_library() {
    let pool = pool().await;
    receive(
        &pool,
        &android_playlist(&[("a", 0, false), ("b", 1, false)], now() - 60_000),
    )
    .await;
    receive(
        &pool,
        &android_playlist(&[("a", 0, true), ("b", 1, false)], now()),
    )
    .await;
    assert_eq!(library_ids(&pool).await, ["b"]);
}

#[tokio::test]
async fn a_merge_keeps_what_android_does_not_carry() {
    let pool = pool().await;
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"a","title":"Old","viewCountText":"1K views","channelAvatarUrl":"https://x/a.jpg"}]"#,
    )
    .await;
    receive(&pool, &android_playlist(&[("a", 0, false)], now() + 60_000)).await;
    let raw = setting(&pool, SAVED_SHORTS_SETTING_KEY).await.unwrap();
    let entries: Vec<Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(entries[0]["title"], "Short a");
    assert_eq!(entries[0]["viewCountText"], "1K views");
    assert_eq!(entries[0]["channelAvatarUrl"], "https://x/a.jpg");
}

#[test]
fn the_library_setting_counts_as_synced_and_its_edits_are_recorded() {
    assert!(is_synced_setting(SAVED_SHORTS_SETTING_KEY));
    let edits = diff_blob(
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"id":"a"},{"id":"b"}]"#,
        r#"[{"id":"b"}]"#,
        5,
    );
    let change = |key: &str| edits.iter().find(|c| c.key == key);
    assert!(change("saved_shorts|a").is_some_and(|c: &Change| c.deleted));
    assert_eq!(
        changes::PLAYLIST_ITEMS,
        change("saved_shorts|a").unwrap().collection
    );
}

#[test]
fn reading_and_writing_the_library_round_trips() {
    let raw = r#"[{"type":"short","id":"a","title":"A","channelName":"C","channelId":"UC","thumbnailUrl":"t","addedAtInPlaylist":5,"durationSeconds":9},{"type":"short","id":"b","title":"B"}]"#;
    let playlist = parse_library(raw, OUR);
    assert_eq!(playlist.created_at_ms, 5);
    assert_eq!(playlist.items[1].position, 1);
    let back: Value = serde_json::from_str(&library_blob(&playlist, Some(raw))).unwrap();
    assert_eq!(back, serde_json::from_str::<Value>(raw).unwrap());
}

#[test]
fn an_unreadable_library_reads_as_empty() {
    assert!(parse_library("not json", OUR).items.is_empty());
    assert!(
        parse_library(r#"[{"title":"no id"}]"#, OUR)
            .items
            .is_empty()
    );
}

#[tokio::test]
async fn a_playlist_an_earlier_sync_brought_in_moves_to_the_library_once() {
    let pool = pool().await;
    sqlx::query("INSERT INTO settings (key, value) VALUES ('user_playlists', ?)")
        .bind(
            json!([
                {"id": "saved_shorts", "name": "Saved Shorts", "source": "Owned", "tracks": [
                    {"id": "old", "title": "Old short", "channelName": "C"}
                ]},
                {"id": "playlist-1", "name": "Mine", "source": "Owned", "tracks": []},
            ])
            .to_string(),
        )
        .execute(&pool)
        .await
        .unwrap();
    write_like_the_app(
        &pool,
        SAVED_SHORTS_SETTING_KEY,
        r#"[{"type":"short","id":"mine","title":"M"}]"#,
    )
    .await;

    adopt_synced_playlist(&pool).await.unwrap();
    let mut ids = library_ids(&pool).await;
    ids.sort();
    assert_eq!(ids, ["mine", "old"]);
    let playlists = setting(&pool, "user_playlists").await.unwrap();
    assert!(!playlists.contains("saved_shorts") && playlists.contains("playlist-1"));
    assert!(
        !exported(&pool).await.iter().any(|p| p.deleted),
        "nothing is announced as deleted"
    );

    let before = setting(&pool, SAVED_SHORTS_SETTING_KEY).await;
    adopt_synced_playlist(&pool).await.unwrap();
    assert_eq!(setting(&pool, SAVED_SHORTS_SETTING_KEY).await, before);
}
