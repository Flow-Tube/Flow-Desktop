//! Saving what an import read, end to end into a real database. The parsers have their own tests
//! beside them; these check the library it leaves and what the engines are handed.

use serde_json::Value;
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::backup::import::save::save_found;
use flow_desktop_lib::backup::import::{Channel, Found, TakenLike, TakenPlaylist, Track, Watch};

const NOW: u64 = 1_800_000_000_000;
const YEAR_MS: u64 = 365 * 24 * 60 * 60 * 1000;

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn setting(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2025-01-01T00:00:00+00:00')",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

fn track(id: &str) -> Track {
    Track {
        video_id: id.into(),
        title: format!("Title {id}"),
        ..Track::default()
    }
}

fn watch(id: &str, at: u64, is_music: bool) -> Watch {
    Watch {
        video_id: id.into(),
        title: format!("Video {id}"),
        channel_name: "Chan".into(),
        watched_at: at,
        is_music,
        ..Watch::default()
    }
}

fn like(id: &str, at: u64, is_music: bool) -> TakenLike {
    TakenLike {
        video_id: id.into(),
        title: format!("Liked {id}"),
        channel_name: "Chan".into(),
        channel_id: String::new(),
        liked_at: at,
        is_music,
    }
}

#[tokio::test]
async fn an_import_fills_the_library() {
    let pool = memory_pool().await;
    let found = Found {
        channels: vec![Channel {
            id: "UCaaaaaaaaaaaaaaaaaaaaaa".into(),
            name: "Chan".into(),
            avatar: String::new(),
        }],
        watches: vec![
            watch("video000000", 10, false),
            watch("video000000", 20, false),
        ],
        playlists: vec![
            TakenPlaylist {
                key: "yt_takeout_PLx".into(),
                name: "Mix".into(),
                created_at: 5,
                tracks: vec![track("aaaaaaaaaaa")],
                ..TakenPlaylist::default()
            },
            TakenPlaylist {
                key: "metrolist_x".into(),
                name: "Songs".into(),
                is_music: true,
                created_at: 5,
                tracks: vec![track("bbbbbbbbbbb")],
                ..TakenPlaylist::default()
            },
        ],
        likes: vec![like("ccccccccccc", NOW - 5, false)],
        library_song_count: 0,
    };
    let saved = save_found(&pool, &found, NOW).await.unwrap();

    assert_eq!(saved.report.subscriptions, 1);
    assert_eq!(saved.report.history, 1, "one row per video");
    assert_eq!(saved.report.playlists, 2);
    assert_eq!(saved.report.music_playlists, 1);
    assert_eq!(saved.report.likes, 1);

    let dates: Vec<String> = sqlx::query_scalar("SELECT watch_date FROM watch_history")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(dates.len(), 1);
    assert!(
        setting(&pool, "subscriptions")
            .await
            .unwrap()
            .contains("UCaaaaaaaaaaaaaaaaaaaaaa")
    );
    assert!(
        setting(&pool, "user_playlists")
            .await
            .unwrap()
            .contains("Title aaaaaaaaaaa")
    );
    let albums = setting(&pool, "saved_albums").await.unwrap();
    assert!(
        albums.contains("bbbbbbbbbbb"),
        "a music playlist goes to the music library"
    );
    assert!(
        setting(&pool, "liked_items")
            .await
            .unwrap()
            .contains("Liked ccccccccccc")
    );
}

#[tokio::test]
async fn importing_twice_adds_nothing_new() {
    let pool = memory_pool().await;
    let found = Found {
        playlists: vec![TakenPlaylist {
            key: "newpipe_pl_1".into(),
            name: "List".into(),
            created_at: 5,
            tracks: vec![track("aaaaaaaaaaa"), track("bbbbbbbbbbb")],
            ..TakenPlaylist::default()
        }],
        likes: vec![like("ccccccccccc", NOW, false)],
        ..Found::default()
    };
    save_found(&pool, &found, NOW).await.unwrap();
    let second = save_found(&pool, &found, NOW + 1).await.unwrap();
    assert_eq!(second.report.likes, 0);

    let playlists: Value =
        serde_json::from_str(&setting(&pool, "user_playlists").await.unwrap()).unwrap();
    let list = playlists.as_array().unwrap();
    assert_eq!(list.len(), 1, "the same playlist, filled again");
    assert_eq!(list[0]["tracks"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn watch_later_keeps_what_the_viewer_saved_and_adds_after_it() {
    let pool = memory_pool().await;
    set_setting(
        &pool,
        "user_playlists",
        r#"[{"id":"watch-later","name":"Watch Later","tracks":[{"id":"mine0000000","title":"Mine"}]}]"#,
    )
    .await;
    let found = Found {
        playlists: vec![TakenPlaylist {
            key: "yt_import_x".into(),
            name: "Ignored name".into(),
            is_watch_later: true,
            created_at: 5,
            tracks: vec![track("aaaaaaaaaaa"), track("mine0000000")],
            ..TakenPlaylist::default()
        }],
        ..Found::default()
    };
    save_found(&pool, &found, NOW).await.unwrap();

    let playlists: Value =
        serde_json::from_str(&setting(&pool, "user_playlists").await.unwrap()).unwrap();
    let list = playlists.as_array().unwrap();
    assert_eq!(list.len(), 1, "no second Watch Later");
    let ids: Vec<&str> = list[0]["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|track| track["id"].as_str())
        .collect();
    assert_eq!(ids, ["mine0000000", "aaaaaaaaaaa"]);
}

#[tokio::test]
async fn a_newer_watch_here_is_not_overridden() {
    let pool = memory_pool().await;
    let newer = Found {
        watches: vec![Watch {
            title: "Newer".into(),
            ..watch("video000000", 2_000_000, false)
        }],
        ..Found::default()
    };
    save_found(&pool, &newer, NOW).await.unwrap();
    let older = Found {
        watches: vec![Watch {
            title: "Older".into(),
            ..watch("video000000", 1_000, false)
        }],
        ..Found::default()
    };
    save_found(&pool, &older, NOW).await.unwrap();
    let title: String = sqlx::query_scalar("SELECT title FROM watch_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(title, "Newer");
}

#[tokio::test]
async fn a_held_like_stays_and_only_new_recent_video_likes_teach() {
    let pool = memory_pool().await;
    set_setting(
        &pool,
        "liked_items",
        r#"[{"id":"held0000000","kind":"video","likedAt":"2020-01-01T00:00:00+00:00","video":{"id":"held0000000","title":"Mine"}}]"#,
    )
    .await;
    let found = Found {
        likes: vec![
            like("held0000000", NOW, false),
            like("recent00000", NOW - 1, false),
            like("oldlike0000", NOW - 2 * YEAR_MS, false),
            like("song0000000", NOW - 1, true),
        ],
        ..Found::default()
    };
    let saved = save_found(&pool, &found, NOW).await.unwrap();
    assert_eq!(saved.report.likes, 3);
    let learned: Vec<&str> = saved
        .learn_from
        .iter()
        .map(|v| v.video_id.as_str())
        .collect();
    assert_eq!(learned, ["recent00000"]);
    let likes = setting(&pool, "liked_items").await.unwrap();
    assert!(
        likes.contains("Mine"),
        "a like already here keeps its details"
    );
    assert!(
        likes.contains("oldlike0000"),
        "an old like is kept, it just teaches nothing"
    );
}

#[tokio::test]
async fn the_engine_is_handed_music_marked_so_it_can_leave_it_out() {
    let pool = memory_pool().await;
    let found = Found {
        watches: vec![
            watch("video000000", 20, false),
            watch("song0000000", 10, true),
        ],
        channels: vec![Channel {
            id: "UCaaaaaaaaaaaaaaaaaaaaaa".into(),
            name: "Chan".into(),
            avatar: String::new(),
        }],
        playlists: vec![TakenPlaylist {
            key: "k".into(),
            name: "P".into(),
            created_at: 1,
            tracks: vec![track("aaaaaaaaaaa")],
            ..TakenPlaylist::default()
        }],
        ..Found::default()
    };
    let saved = save_found(&pool, &found, NOW).await.unwrap();
    assert_eq!(saved.channel_names, ["Chan"]);
    assert_eq!(saved.learn_from.len(), 2, "a playlist teaches nothing");
    assert!(
        saved
            .learn_from
            .iter()
            .any(|v| v.video_id == "song0000000" && v.is_music)
    );
    assert!(
        saved
            .learn_from
            .iter()
            .any(|v| v.video_id == "video000000" && !v.is_music)
    );
}
