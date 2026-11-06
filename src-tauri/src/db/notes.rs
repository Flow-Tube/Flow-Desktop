//! The `notes` table: a note on a video or a channel, in Flow for Android's shape.

use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

use crate::sync::canonical::Note;

const SELECT: &str = "SELECT id, target_id, kind, text, updated_at, title, channel_name, channel_id, \
     thumbnail_url, duration_seconds, channel_avatar_url, channel_handle, subscriber_count_text, \
     position FROM notes";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
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
    pub position: Option<i64>,
}

impl NoteRow {
    /// The record sync sends: everything but `position`, which stays on this device.
    #[must_use]
    pub fn to_canonical(&self) -> Note {
        Note {
            id: self.id.clone(),
            target_id: self.target_id.clone(),
            kind: self.kind.clone(),
            text: self.text.clone(),
            updated_at: self.updated_at,
            deleted: false,
            title: self.title.clone(),
            channel_name: self.channel_name.clone(),
            channel_id: self.channel_id.clone(),
            thumbnail_url: self.thumbnail_url.clone(),
            duration_seconds: self.duration_seconds,
            channel_avatar_url: self.channel_avatar_url.clone(),
            channel_handle: self.channel_handle.clone(),
            subscriber_count_text: self.subscriber_count_text.clone(),
        }
    }
}

/// Every note, newest edit first.
pub async fn all(pool: &SqlitePool) -> Result<Vec<NoteRow>, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    all_on(&mut conn).await
}

pub async fn all_on(conn: &mut SqliteConnection) -> Result<Vec<NoteRow>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} ORDER BY updated_at DESC, id"
    )))
    .fetch_all(conn)
    .await
}

/// Writes a note. The hand-made order is this device's own, so `position` stays.
pub async fn upsert(conn: &mut SqliteConnection, note: &Note) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notes (id, target_id, kind, text, updated_at, title, channel_name, channel_id,
            thumbnail_url, duration_seconds, channel_avatar_url, channel_handle, subscriber_count_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            target_id = excluded.target_id,
            kind = excluded.kind,
            text = excluded.text,
            updated_at = excluded.updated_at,
            title = excluded.title,
            channel_name = excluded.channel_name,
            channel_id = excluded.channel_id,
            thumbnail_url = excluded.thumbnail_url,
            duration_seconds = excluded.duration_seconds,
            channel_avatar_url = excluded.channel_avatar_url,
            channel_handle = excluded.channel_handle,
            subscriber_count_text = excluded.subscriber_count_text",
    )
    .bind(&note.id)
    .bind(&note.target_id)
    .bind(&note.kind)
    .bind(&note.text)
    .bind(note.updated_at)
    .bind(&note.title)
    .bind(&note.channel_name)
    .bind(&note.channel_id)
    .bind(&note.thumbnail_url)
    .bind(note.duration_seconds)
    .bind(&note.channel_avatar_url)
    .bind(&note.channel_handle)
    .bind(&note.subscriber_count_text)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn get(conn: &mut SqliteConnection, id: &str) -> Result<Option<NoteRow>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT} WHERE id = ?")))
        .bind(id)
        .fetch_optional(conn)
        .await
}

pub async fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM notes WHERE id = ?")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(())
}
