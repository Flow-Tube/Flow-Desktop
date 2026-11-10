//! Writing notes from this device. As on Android, emptied text is the user removing the note, and
//! a save without a subject keeps the one already stored. Every deletion is recorded in the same
//! transaction, so a peer's copy can't bring the note back.

use serde::Deserialize;
use sqlx::SqlitePool;

use crate::db::notes::{self, NoteRow};
use crate::sync::canonical::Note;
use crate::sync::changes::{self, Change};
use crate::sync::clock;
use crate::sync::error::SyncError;

/// What a note is about, stored with it so the Notes page lists notes without a network call.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NoteSubject {
    pub title: Option<String>,
    pub channel_name: Option<String>,
    pub channel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_seconds: Option<i32>,
    pub channel_avatar_url: Option<String>,
    pub channel_handle: Option<String>,
    pub subscriber_count_text: Option<String>,
}

/// `Video` or `Channel`, the two spellings Android stores.
#[must_use]
pub fn note_id(kind: &str, target_id: &str) -> String {
    format!("{}:{target_id}", kind.to_lowercase())
}

/// Saves a note and returns it, or `None` when blank text deleted it.
pub async fn save_note(
    pool: &SqlitePool,
    kind: &str,
    target_id: &str,
    text: &str,
    subject: Option<NoteSubject>,
) -> Result<Option<NoteRow>, SyncError> {
    let id = note_id(kind, target_id);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        // With no row here, a tombstone would delete a note a peer holds that hasn't arrived yet.
        if notes::get(&mut *pool.acquire().await?, &id)
            .await?
            .is_some()
        {
            delete_notes(pool, std::slice::from_ref(&id)).await?;
        }
        return Ok(None);
    }
    let at = clock::edit_ms(pool).await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let stored = notes::get(&mut tx, &id).await?;
    let subject = subject.unwrap_or_else(|| stored.as_ref().map(subject_of).unwrap_or_default());
    let note = Note {
        id: id.clone(),
        target_id: target_id.to_owned(),
        kind: kind.to_owned(),
        text: trimmed.to_owned(),
        updated_at: i64::try_from(at).unwrap_or(i64::MAX),
        deleted: false,
        title: subject.title,
        channel_name: subject.channel_name,
        channel_id: subject.channel_id,
        thumbnail_url: subject.thumbnail_url,
        duration_seconds: subject.duration_seconds,
        channel_avatar_url: subject.channel_avatar_url,
        channel_handle: subject.channel_handle,
        subscriber_count_text: subject.subscriber_count_text,
    };
    notes::upsert(&mut tx, &note).await?;
    let saved = notes::get(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(saved)
}

fn with_subject(row: &NoteRow, subject: NoteSubject) -> Note {
    Note {
        title: subject.title,
        channel_name: subject.channel_name,
        channel_id: subject.channel_id,
        thumbnail_url: subject.thumbnail_url,
        duration_seconds: subject.duration_seconds,
        channel_avatar_url: subject.channel_avatar_url,
        channel_handle: subject.channel_handle,
        subscriber_count_text: subject.subscriber_count_text,
        ..row.to_canonical()
    }
}

fn subject_of(row: &NoteRow) -> NoteSubject {
    NoteSubject {
        title: row.title.clone(),
        channel_name: row.channel_name.clone(),
        channel_id: row.channel_id.clone(),
        thumbnail_url: row.thumbnail_url.clone(),
        duration_seconds: row.duration_seconds,
        channel_avatar_url: row.channel_avatar_url.clone(),
        channel_handle: row.channel_handle.clone(),
        subscriber_count_text: row.subscriber_count_text.clone(),
    }
}

/// Fills in what a note is about. Its text and edit time stay: the merge lets the copy that knows
/// win at equal times, so this reaches other devices without undoing an edit made there.
pub async fn fill_subject(
    pool: &SqlitePool,
    id: &str,
    subject: NoteSubject,
) -> Result<(), SyncError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    if let Some(row) = notes::get(&mut tx, id).await? {
        let note = with_subject(&row, subject);
        notes::upsert(&mut tx, &note).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn save_order(pool: &SqlitePool, ids: &[String]) -> Result<(), SyncError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    notes::set_positions(&mut tx, ids).await?;
    tx.commit().await?;
    Ok(())
}

/// Puts deleted notes back for Undo, their place included. Android keeps the old edit time, but
/// the deletion may already have left this device, and a peer's tombstone would beat that time and
/// delete the note again here, so a restored note counts as edited now.
pub async fn restore_notes(
    pool: &SqlitePool,
    rows: Vec<NoteRow>,
) -> Result<Vec<NoteRow>, SyncError> {
    let at = i64::try_from(clock::edit_ms(pool).await?).unwrap_or(i64::MAX);
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut restored = Vec::with_capacity(rows.len());
    for row in rows {
        let note = Note {
            updated_at: at,
            ..row.to_canonical()
        };
        notes::upsert(&mut tx, &note).await?;
        notes::set_position(&mut tx, &row.id, row.position).await?;
        restored.extend(notes::get(&mut tx, &row.id).await?);
    }
    tx.commit().await?;
    Ok(restored)
}

pub async fn delete_notes(pool: &SqlitePool, ids: &[String]) -> Result<(), SyncError> {
    let at = clock::edit_ms(pool).await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    for id in ids {
        notes::delete(&mut tx, id).await?;
    }
    let deletions: Vec<Change> = ids
        .iter()
        .map(|id| Change::delete(changes::NOTES, id.clone(), at, None))
        .collect();
    changes::record(&mut tx, &deletions).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::sync::canonical::Collection;
    use crate::sync::export::export_collections;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn exported(pool: &SqlitePool) -> String {
        let out = export_collections(pool, "device", &[Collection::Notes])
            .await
            .unwrap();
        String::from_utf8(out[0].ndjson.clone()).unwrap()
    }

    fn titled(title: &str) -> NoteSubject {
        NoteSubject {
            title: Some(title.into()),
            ..NoteSubject::default()
        }
    }

    #[tokio::test]
    async fn a_note_is_keyed_as_android_keys_it_and_trimmed() {
        let pool = pool().await;
        let saved = save_note(&pool, "Video", "abc", "  hello \n", Some(titled("A video")))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.id, "video:abc");
        assert_eq!(saved.kind, "Video");
        assert_eq!(saved.text, "hello");
        let channel = save_note(&pool, "Channel", "UCx", "why", None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(channel.id, "channel:UCx");
    }

    #[tokio::test]
    async fn a_save_without_a_subject_keeps_the_stored_one_and_the_place() {
        let pool = pool().await;
        save_note(&pool, "Video", "abc", "one", Some(titled("A video")))
            .await
            .unwrap();
        sqlx::query("UPDATE notes SET position = 3")
            .execute(&pool)
            .await
            .unwrap();
        let saved = save_note(&pool, "Video", "abc", "two", None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.text, "two");
        assert_eq!(saved.title.as_deref(), Some("A video"));
        assert_eq!(saved.position, Some(3));
    }

    #[tokio::test]
    async fn blank_text_deletes_and_leaves_a_tombstone_for_sync() {
        let pool = pool().await;
        save_note(&pool, "Video", "abc", "one", None).await.unwrap();
        assert!(
            save_note(&pool, "Video", "abc", "   ", None)
                .await
                .unwrap()
                .is_none()
        );
        assert!(notes::all(&pool).await.unwrap().is_empty());
        let line = exported(&pool).await;
        assert!(line.contains(r#""deleted":true"#) && line.contains(r#""id":"video:abc""#));
    }

    #[tokio::test]
    async fn blank_text_with_no_note_here_records_nothing() {
        let pool = pool().await;
        assert!(
            save_note(&pool, "Video", "abc", "  ", None)
                .await
                .unwrap()
                .is_none()
        );
        assert!(exported(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn writing_a_note_again_replaces_its_tombstone() {
        let pool = pool().await;
        save_note(&pool, "Video", "abc", "one", None).await.unwrap();
        delete_notes(&pool, &["video:abc".to_owned()])
            .await
            .unwrap();
        save_note(&pool, "Video", "abc", "back", None)
            .await
            .unwrap();
        let line = exported(&pool).await;
        assert!(line.contains(r#""text":"back""#) && !line.contains(r#""deleted":true"#));
    }

    #[tokio::test]
    async fn filling_a_subject_leaves_the_text_and_time() {
        let pool = pool().await;
        let saved = save_note(&pool, "Video", "abc", "one", None)
            .await
            .unwrap()
            .unwrap();
        fill_subject(&pool, "video:abc", titled("Found"))
            .await
            .unwrap();
        let row = notes::all(&pool).await.unwrap().remove(0);
        assert_eq!(row.title.as_deref(), Some("Found"));
        assert_eq!(
            (row.text.as_str(), row.updated_at),
            ("one", saved.updated_at)
        );
    }

    #[tokio::test]
    async fn filling_a_subject_never_brings_a_deleted_note_back() {
        let pool = pool().await;
        fill_subject(&pool, "video:gone", titled("Found"))
            .await
            .unwrap();
        assert!(notes::all(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_hand_made_order_stays_local() {
        let pool = pool().await;
        save_note(&pool, "Video", "a", "one", None).await.unwrap();
        save_note(&pool, "Video", "b", "two", None).await.unwrap();
        let before = exported(&pool).await;
        save_order(&pool, &["video:b".to_owned(), "video:a".to_owned()])
            .await
            .unwrap();
        let rows = notes::all(&pool).await.unwrap();
        let place = |id: &str| rows.iter().find(|r| r.id == id).unwrap().position;
        assert_eq!((place("video:b"), place("video:a")), (Some(0), Some(1)));
        assert_eq!(exported(&pool).await, before);
    }

    #[tokio::test]
    async fn undo_outlives_a_tombstone_already_sent_and_keeps_the_place() {
        let pool = pool().await;
        let mut row = save_note(&pool, "Video", "abc", "one", Some(titled("T")))
            .await
            .unwrap()
            .unwrap();
        row.position = Some(4);
        delete_notes(&pool, std::slice::from_ref(&row.id))
            .await
            .unwrap();
        let deleted_line = exported(&pool).await;
        let deleted: Note = serde_json::from_str(&deleted_line).unwrap();

        let restored = restore_notes(&pool, vec![row]).await.unwrap().remove(0);
        assert!(restored.updated_at > deleted.updated_at);
        assert_eq!(restored.position, Some(4));
        assert_eq!(restored.title.as_deref(), Some("T"));

        let peers_tombstone =
            crate::sync::merge::merge_notes(vec![restored.to_canonical()], vec![deleted]);
        assert!(!peers_tombstone[0].deleted);
    }

    #[tokio::test]
    async fn an_edit_is_stamped_after_every_time_seen() {
        let pool = pool().await;
        let first = save_note(&pool, "Video", "abc", "one", None)
            .await
            .unwrap()
            .unwrap();
        let far = first.updated_at + 3_600_000;
        let mut conn = pool.acquire().await.unwrap();
        clock::observe(&mut conn, u64::try_from(far).unwrap())
            .await
            .unwrap();
        drop(conn);
        let second = save_note(&pool, "Video", "abc", "two", None)
            .await
            .unwrap()
            .unwrap();
        assert!(second.updated_at > far);
    }
}
