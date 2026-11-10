//! The `notes` collection against Flow for Android: its wire form, its merge rule, its tombstones,
//! and what a peer that lacks the collection sees.

use flow_desktop_lib::commands::backup::{export_backup, import_backup};
use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{Collection, Note, to_canonical_json};
use flow_desktop_lib::sync::changes::{self, Change};
use flow_desktop_lib::sync::codec::sha256_hex;
use flow_desktop_lib::sync::export::export_collections;
use flow_desktop_lib::sync::merge::merge_notes;
use flow_desktop_lib::sync::protocol::StagedCollection;
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};
use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

const OUR: &str = "desktop-device";
/// One note exactly as Android's `SyncSerialization.encodeNotes` writes it.
const ANDROID_LINE: &str = r#"{"channelAvatarUrl":null,"channelHandle":null,"channelId":"UCx","channelName":"A channel","deleted":false,"durationSeconds":754,"id":"video:abc123def45","kind":"Video","subscriberCountText":null,"targetId":"abc123def45","text":"12:34 the good part","thumbnailUrl":null,"title":"A video","updatedAt":1700000000000}"#;

/// A deletion at `at` as Android's `SyncChangeTracker.notes` builds it. Its time has to be recent:
/// tombstones expire after a year.
fn android_tombstone(at: i64) -> String {
    format!(
        r#"{{"channelAvatarUrl":null,"channelHandle":null,"channelId":null,"channelName":null,"deleted":true,"durationSeconds":null,"id":"channel:UCgone","kind":"","subscriberCountText":null,"targetId":"","text":"","thumbnailUrl":null,"title":null,"updatedAt":{at}}}"#
    )
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn stage(lines: &[&str]) -> StagedCollection {
    let ndjson = lines.join("\n").into_bytes();
    StagedCollection {
        collection: Collection::Notes,
        record_count: lines.len() as u64,
        hash: sha256_hex(&ndjson),
        ndjson,
    }
}

async fn apply_lines(pool: &SqlitePool, lines: &[&str]) {
    apply_payload(pool, OUR, "android-device", &[stage(lines)])
        .await
        .unwrap();
}

async fn exported(pool: &SqlitePool) -> String {
    let out = export_collections(pool, OUR, &[Collection::Notes])
        .await
        .unwrap();
    String::from_utf8(out[0].ndjson.clone()).unwrap()
}

async fn texts(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as("SELECT id, text FROM notes ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

fn note(id: &str, text: &str, at: i64) -> Note {
    Note {
        id: id.into(),
        text: text.into(),
        updated_at: at,
        ..Note::default()
    }
}

#[test]
fn a_record_reads_and_writes_in_android_s_exact_bytes() {
    let parsed: Note = serde_json::from_str(ANDROID_LINE).unwrap();
    assert_eq!(parsed.id, "video:abc123def45");
    assert_eq!(parsed.kind, "Video");
    assert_eq!(parsed.duration_seconds, Some(754));
    assert_eq!(
        String::from_utf8(to_canonical_json(&parsed)).unwrap(),
        ANDROID_LINE
    );
    assert_eq!(
        sha256_hex(ANDROID_LINE.as_bytes()),
        sha256_hex(&to_canonical_json(&parsed))
    );
}

#[test]
fn a_record_with_fields_this_build_does_not_know_still_reads() {
    let parsed: Note =
        serde_json::from_str(r#"{"id":"video:a","updatedAt":5,"future":{"x":1}}"#).unwrap();
    assert_eq!(parsed.updated_at, 5);
    assert_eq!(parsed.text, "");
}

/// `NotesMergerTest` in the Android repo, case by case.
#[test]
fn the_merge_follows_android_s_rule() {
    let old = note("video:a", "old", 100);
    let new = note("video:a", "new", 200);
    for (a, b) in [(&old, &new), (&new, &old)] {
        assert_eq!(merge_notes(vec![a.clone()], vec![b.clone()])[0].text, "new");
    }

    let cleared = Note {
        deleted: true,
        ..note("video:a", "", 300)
    };
    assert!(merge_notes(vec![new.clone()], vec![cleared.clone()])[0].deleted);
    let edited_later = note("video:a", "back", 400);
    assert_eq!(
        merge_notes(vec![cleared.clone()], vec![edited_later])[0].text,
        "back"
    );

    // The same instant: deletion wins, then the greater text, on either side.
    let at_same_time = Note {
        deleted: true,
        ..note("video:a", "", 200)
    };
    assert!(merge_notes(vec![new.clone()], vec![at_same_time.clone()])[0].deleted);
    assert!(merge_notes(vec![at_same_time], vec![new.clone()])[0].deleted);
    let (low, high) = (note("video:a", "apple", 100), note("video:a", "pear", 100));
    assert_eq!(
        merge_notes(vec![low.clone()], vec![high.clone()])[0].text,
        "pear"
    );
    assert_eq!(merge_notes(vec![high], vec![low])[0].text, "pear");

    // Kotlin orders text by UTF-16 unit: an emoji's surrogate sorts below U+FF5E.
    let (emoji, wide) = (note("video:a", "😀", 100), note("video:a", "～", 100));
    assert_eq!(merge_notes(vec![emoji], vec![wide])[0].text, "～");

    // Filling in the subject leaves the time alone, so the copy that knows wins.
    let bare = note("video:a", "same", 100);
    let filled = Note {
        title: Some("A video".into()),
        ..bare.clone()
    };
    assert_eq!(
        merge_notes(vec![bare.clone()], vec![filled.clone()])[0],
        filled
    );
    assert_eq!(merge_notes(vec![filled.clone()], vec![bare])[0], filled);
}

#[test]
fn the_merge_converges_and_keeps_notes_only_one_side_has() {
    let mut rng = StdRng::seed_from_u64(0x4e07e5);
    let sample = |rng: &mut StdRng| -> Vec<Note> {
        (0..rng.random_range(0..6))
            .map(|_| Note {
                id: format!("video:{}", rng.random_range(0..4)),
                text: ["a", "b", "c"][rng.random_range(0..3)].to_string(),
                updated_at: rng.random_range(0..4),
                deleted: rng.random_bool(0.25),
                ..Note::default()
            })
            .fold(Vec::new(), |mut set: Vec<Note>, n| {
                if !set.iter().any(|o| o.id == n.id) {
                    set.push(n);
                }
                set
            })
    };
    for _ in 0..300 {
        let (a, b, c) = (sample(&mut rng), sample(&mut rng), sample(&mut rng));
        let ab = merge_notes(a.clone(), b.clone());
        assert_eq!(ab, merge_notes(b.clone(), a.clone()), "commutativity");
        assert_eq!(
            merge_notes(ab.clone(), c.clone()),
            merge_notes(a.clone(), merge_notes(b.clone(), c.clone())),
            "associativity"
        );
        assert_eq!(merge_notes(ab.clone(), ab.clone()), ab, "idempotency");
        for n in a.iter().chain(&b) {
            assert!(ab.iter().any(|m| m.id == n.id), "a note was lost");
        }
    }
}

#[tokio::test]
async fn a_received_note_is_stored_and_exported_in_the_same_bytes() {
    let pool = memory_pool().await;
    apply_lines(&pool, &[ANDROID_LINE]).await;
    assert_eq!(
        texts(&pool).await,
        [(
            "video:abc123def45".to_string(),
            "12:34 the good part".to_string()
        )]
    );
    assert_eq!(exported(&pool).await, ANDROID_LINE);
}

#[tokio::test]
async fn a_peer_s_deletion_removes_the_note_and_is_relayed_verbatim() {
    let pool = memory_pool().await;
    let at = now();
    let tombstone = android_tombstone(at);
    let live = android_tombstone(at - 5000)
        .replace(r#""deleted":true"#, r#""deleted":false"#)
        .replace(r#""text":"""#, r#""text":"kept""#);
    apply_lines(&pool, &[&live]).await;
    assert_eq!(texts(&pool).await.len(), 1);

    apply_lines(&pool, &[&tombstone]).await;
    assert!(texts(&pool).await.is_empty());
    assert_eq!(exported(&pool).await, tombstone);

    // The older copy arriving late can't bring it back.
    apply_lines(&pool, &[&live]).await;
    assert!(texts(&pool).await.is_empty());
}

#[tokio::test]
async fn a_tombstone_for_a_note_never_held_is_still_relayed() {
    let pool = memory_pool().await;
    let tombstone = android_tombstone(now());
    apply_lines(&pool, &[&tombstone]).await;
    assert_eq!(exported(&pool).await, tombstone);
}

#[tokio::test]
async fn a_local_deletion_goes_out_in_android_s_tombstone_shape() {
    let pool = memory_pool().await;
    let at = now();
    let mut conn = pool.acquire().await.unwrap();
    changes::record(
        &mut conn,
        &[Change::delete(
            changes::NOTES,
            "channel:UCgone",
            u64::try_from(at).unwrap(),
            None,
        )],
    )
    .await
    .unwrap();
    drop(conn);
    assert_eq!(exported(&pool).await, android_tombstone(at));
}

#[tokio::test]
async fn a_merge_keeps_the_hand_made_order_and_skips_blank_text() {
    let pool = memory_pool().await;
    apply_lines(&pool, &[ANDROID_LINE]).await;
    sqlx::query("UPDATE notes SET position = 7")
        .execute(&pool)
        .await
        .unwrap();
    let edited = ANDROID_LINE
        .replace("the good part", "the best part")
        .replace("1700000000000", "1700000009000");
    apply_lines(&pool, &[&edited]).await;
    let position: Option<i64> = sqlx::query_scalar("SELECT position FROM notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(position, Some(7));
    assert!(!exported(&pool).await.contains("position"));

    let blank = ANDROID_LINE
        .replace("12:34 the good part", "   ")
        .replace("video:abc123def45", "video:blank")
        .replace("1700000000000", "1700000009999");
    apply_lines(&pool, &[&blank]).await;
    assert_eq!(texts(&pool).await.len(), 1, "blank text is not a note");
}

#[tokio::test]
async fn an_edit_after_a_note_from_a_faster_clock_sorts_after_it() {
    let pool = memory_pool().await;
    let far = chrono::Utc::now().timestamp_millis() + 60 * 60 * 1000;
    let ahead = ANDROID_LINE.replace("1700000000000", &far.to_string());
    apply_lines(&pool, &[&ahead]).await;
    let edit = flow_desktop_lib::sync::clock::edit_ms(&pool).await.unwrap();
    assert!(i64::try_from(edit).unwrap() > far);
}

#[tokio::test]
async fn junk_lines_fail_the_apply_cleanly_and_change_nothing() {
    let pool = memory_pool().await;
    let bad = stage(&[ANDROID_LINE, "{not json"]);
    assert!(
        apply_payload(&pool, OUR, "android-device", &[bad])
            .await
            .is_err()
    );
    assert!(texts(&pool).await.is_empty());
}

#[tokio::test]
async fn app_data_and_master_backups_round_trip_notes() {
    for scope in ["APP_DATA", "MASTER"] {
        let source = memory_pool().await;
        apply_lines(&source, &[ANDROID_LINE, &android_tombstone(now())]).await;
        let backup = export_backup(&source, scope).await.unwrap();
        assert_eq!(backup.collections["notes"].as_array().unwrap().len(), 2);
        let target = memory_pool().await;
        let payload = serde_json::json!({ "collections": backup.collections });
        import_backup(&target, &payload).await.unwrap();
        assert_eq!(texts(&target).await.len(), 1, "{scope}");
        assert_eq!(exported(&target).await, exported(&source).await, "{scope}");
    }
}

#[tokio::test]
async fn the_brain_scope_leaves_notes_out() {
    let pool = memory_pool().await;
    apply_lines(&pool, &[ANDROID_LINE]).await;
    let backup = export_backup(&pool, "BRAIN").await.unwrap();
    assert!(!backup.collections.contains_key("notes"));
}

/// Whatever a peer sends, a bad record fails its payload cleanly: no panic and no half-applied notes.
#[tokio::test]
async fn mangled_records_never_panic_or_half_apply() {
    let pool = memory_pool().await;
    let mut rng = StdRng::seed_from_u64(0x4e07e6);
    for _ in 0..200 {
        let mut bytes = ANDROID_LINE.as_bytes().to_vec();
        for _ in 0..rng.random_range(1..6) {
            let at = rng.random_range(0..bytes.len());
            bytes[at] = rng.random_range(0x20..0x7f);
        }
        let Ok(line) = String::from_utf8(bytes) else {
            continue;
        };
        let good = ANDROID_LINE.replace("video:abc123def45", "video:good");
        let result = apply_payload(&pool, OUR, "android-device", &[stage(&[&good, &line])]).await;
        if result.is_err() {
            assert!(!texts(&pool).await.iter().any(|(id, _)| id == "video:good"));
        }
        sqlx::query("DELETE FROM notes")
            .execute(&pool)
            .await
            .unwrap();
    }
}
