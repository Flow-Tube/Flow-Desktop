//! Library-routing tests for the `playlists` collection: albums must land in the **album library**
//! (`saved_albums`) and not pollute `user_playlists`, same-named owned playlists must coalesce
//! instead of duplicating, and a playlist's cover art must survive the wire as a first-class field.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::Collection;
use flow_desktop_lib::sync::codec::sha256_hex;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::protocol::{OutgoingCollection, StagedCollection};

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

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2025-02-02T00:00:00+00:00')
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

fn stage(out: &OutgoingCollection) -> StagedCollection {
    let count = out
        .ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .count() as u64;
    StagedCollection {
        collection: out.collection,
        ndjson: out.ndjson.clone(),
        record_count: count,
        hash: sha256_hex(&out.ndjson),
    }
}

const ALBUM_BLOB: &str = r#"[
  {"id":"MPREb_w7oqKXSwULM","title":"ASTROWORLD","source":"Saved","artists":[{"name":"Travis Scott","id":"UCx"}],
   "year":2018,"thumbnail":"https://img/astro.jpg","explicit":true,"browseId":"MPREb_w7oqKXSwULM","playlistId":"",
   "tracks":[{"id":"t1","videoId":"t1","title":"SICKO MODE","artists":[{"name":"Travis Scott","id":"UCx"}],"thumbnail":"https://img/t1.jpg","duration":312}]}
]"#;

const PLAYLIST_BLOB: &str = r#"[
  {"id":"pl-1","name":"Gym","source":"Owned","createdAt":"2025-01-01T00:00:00+00:00",
   "thumbnailUrl":"https://img/gym.jpg",
   "tracks":[{"id":"a","title":"A","channelName":"CA"}]}
]"#;

#[tokio::test]
async fn albums_round_trip_into_the_album_library_not_playlists() {
    let a = memory_pool().await;
    set_setting(&a, "saved_albums", ALBUM_BLOB).await;
    set_setting(&a, "user_playlists", PLAYLIST_BLOB).await;

    // Export the single `playlists` collection (it carries BOTH playlists and albums).
    let outgoing = export_collections(&a, OUR, &[Collection::Playlists])
        .await
        .unwrap();
    let wire = String::from_utf8(outgoing[0].ndjson.clone()).unwrap();
    assert!(
        wire.contains("ASTROWORLD"),
        "album rides the playlists wire"
    );
    assert!(wire.contains("\"isMusic\":true"), "album tagged isMusic");
    assert!(
        wire.contains("https://img/gym.jpg"),
        "playlist cover travels as a first-class field"
    );

    // Apply to a fresh device.
    let b = memory_pool().await;
    apply_payload(&b, PEER, OUR, &[stage(&outgoing[0])])
        .await
        .unwrap();

    let albums = get_setting(&b, "saved_albums").await.unwrap();
    let playlists = get_setting(&b, "user_playlists").await.unwrap();

    // The album landed in the album library, with its album-specific metadata preserved...
    assert!(albums.contains("ASTROWORLD"));
    assert!(albums.contains("MPREb_w7oqKXSwULM"));
    assert!(albums.contains("\"year\":2018"));
    assert!(albums.contains("SICKO MODE"), "album tracks preserved");
    // ...and it did NOT leak into the playlists library.
    assert!(
        !playlists.contains("ASTROWORLD"),
        "album must not appear in user_playlists"
    );

    // The regular playlist landed in user_playlists with its cover, and is not an album.
    assert!(playlists.contains("Gym"));
    assert!(playlists.contains("https://img/gym.jpg"));
    assert!(!albums.contains("Gym"));
}

#[tokio::test]
async fn incoming_album_does_not_wipe_an_existing_album_library() {
    // B already has one saved album; receiving a *different* album must add, not replace.
    let a = memory_pool().await;
    set_setting(&a, "saved_albums", ALBUM_BLOB).await;
    let outgoing = export_collections(&a, OUR, &[Collection::Playlists])
        .await
        .unwrap();

    let b = memory_pool().await;
    set_setting(
        &b,
        "saved_albums",
        r#"[{"id":"MPREb_other","title":"Other Album","source":"Saved","browseId":"MPREb_other","tracks":[]}]"#,
    )
    .await;

    apply_payload(&b, PEER, OUR, &[stage(&outgoing[0])])
        .await
        .unwrap();

    let albums = get_setting(&b, "saved_albums").await.unwrap();
    assert!(albums.contains("Other Album"), "pre-existing album kept");
    assert!(albums.contains("ASTROWORLD"), "incoming album merged in");
}

#[test]
fn album_track_thumbnail_falls_back_to_item_when_raw_song_has_none() {
    use flow_desktop_lib::sync::canonical::{Hlc, Playlist, PlaylistItem, PlaylistOrigin};
    use flow_desktop_lib::sync::mapping::albums_to_blob;

    let hlc = Hlc::new(1000, 0, "dev");
    let item = PlaylistItem {
        video_id: "t1".into(),
        position: 0,
        added_at_ms: 0,
        deleted: false,
        title: Some("Track".into()),
        channel_name: Some("Artist".into()),
        channel_id: None,
        thumbnail_url: Some("https://img/cover.jpg".into()),
        duration_seconds: Some(200),
        is_music: true,
        hlc: hlc.clone(),
        raw: Some(serde_json::json!({
            "id": "t1", "videoId": "t1", "title": "Track",
            "artists": [{ "name": "Artist", "id": null }], "thumbnail": ""
        })),
    };
    let album = Playlist {
        sync_id: "album:MPREb_x".into(),
        origin: PlaylistOrigin::Youtube,
        youtube_id: Some("MPREb_x".into()),
        title: "Album".into(),
        description: None,
        thumbnail_url: Some("https://img/cover.jpg".into()),
        is_music: true,
        is_user_created: false,
        is_protected: false,
        created_at_ms: 0,
        updated_hlc: hlc,
        deleted: false,
        items: vec![item],
        raw: Some(serde_json::json!({ "album": true, "browseId": "MPREb_x" })),
    };

    let blob = albums_to_blob(&[album]);
    let arr: Vec<serde_json::Value> = serde_json::from_str(&blob).unwrap();
    let tracks = arr[0]["tracks"].as_array().unwrap();
    assert_eq!(
        tracks[0]["thumbnail"], "https://img/cover.jpg",
        "an album track with no thumbnail inherits the album cover"
    );
}

#[tokio::test]
async fn same_titled_owned_playlists_coalesce_and_union_tracks() {
    // Device B has its own "Gym" (id pl-1, track a); device A sends a "Gym" created independently
    // (different id, track b). They must merge into ONE "Gym" with both tracks — not duplicate.
    let a = memory_pool().await;
    set_setting(
        &a,
        "user_playlists",
        r#"[{"id":"android-zzz","name":"Gym","source":"Owned","createdAt":"2025-01-02T00:00:00+00:00","tracks":[{"id":"b","title":"B","channelName":"CB"}]}]"#,
    )
    .await;
    let outgoing = export_collections(&a, OUR, &[Collection::Playlists])
        .await
        .unwrap();

    let b = memory_pool().await;
    set_setting(&b, "user_playlists", PLAYLIST_BLOB).await; // its own "Gym" with track a
    apply_payload(&b, PEER, OUR, &[stage(&outgoing[0])])
        .await
        .unwrap();

    let blob = get_setting(&b, "user_playlists").await.unwrap();
    let arr: Vec<serde_json::Value> = serde_json::from_str(&blob).unwrap();
    let gyms: Vec<&serde_json::Value> = arr.iter().filter(|p| p["name"] == "Gym").collect();
    assert_eq!(gyms.len(), 1, "the two 'Gym' playlists coalesced into one");
    let tracks = gyms[0]["tracks"].as_array().unwrap();
    let ids: Vec<&str> = tracks.iter().filter_map(|t| t["id"].as_str()).collect();
    assert!(
        ids.contains(&"a") && ids.contains(&"b"),
        "both devices' tracks survived the coalesce, got {ids:?}"
    );
}

#[tokio::test]
async fn a_music_playlist_from_android_goes_back_under_its_own_id() {
    // Android's own music playlist: no album ids, just its sync id.
    let line = serde_json::json!({
        "syncId": "4f2a9c1e0b7d4e6f8a3b5c7d9e1f2a3b",
        "origin": "local",
        "title": "Late night",
        "isMusic": true,
        "isUserCreated": true,
        "createdAtMs": 1781000000000_u64,
        "updatedHlc": "1781000000000:0:dpeer",
        "items": [{ "videoId": "s1", "position": 0, "title": "Song", "isMusic": true,
                    "hlc": "1781000000000:0:dpeer" }]
    });
    let ndjson = format!("{line}\n").into_bytes();
    let staged = StagedCollection {
        collection: Collection::Playlists,
        hash: sha256_hex(&ndjson),
        ndjson,
        record_count: 1,
    };
    let desktop = memory_pool().await;
    apply_payload(&desktop, OUR, PEER, &[staged]).await.unwrap();

    // Renamed on the desktop: the title no longer matches, the id still does.
    let albums = get_setting(&desktop, "saved_albums").await.unwrap();
    assert!(
        albums.contains("Late night"),
        "it lands in the album library"
    );
    set_setting(
        &desktop,
        "saved_albums",
        &albums.replace("Late night", "Late night drive"),
    )
    .await;

    let outgoing = export_collections(&desktop, OUR, &[Collection::Playlists])
        .await
        .unwrap();
    let sent: Vec<serde_json::Value> = outgoing[0]
        .ndjson
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_slice(l).unwrap())
        .collect();
    let back = sent
        .iter()
        .find(|p| p["title"] == "Late night drive")
        .expect("the playlist goes back");
    assert_eq!(back["syncId"], "4f2a9c1e0b7d4e6f8a3b5c7d9e1f2a3b");
}
