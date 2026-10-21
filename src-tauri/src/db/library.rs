//! The viewer's library as the frontend stores it in settings: liked and saved videos.

use serde::Deserialize;
use sqlx::SqlitePool;

use crate::db::settings::get_setting;
use crate::errors::AppResult;
use crate::models::video::VideoSummary;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLike {
    kind: String,
    #[serde(default)]
    liked_at: String,
    video: Option<VideoSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPlaylist {
    #[serde(default)]
    tracks: Vec<VideoSummary>,
    #[serde(default)]
    created_at: Option<String>,
}

/// An ISO date as milliseconds since the epoch; 0 when unreadable.
#[must_use]
pub fn iso_ms(text: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .and_then(|date| u64::try_from(date.timestamp_millis()).ok())
        .unwrap_or(0)
}

/// Liked videos with when they were liked, newest first as stored.
pub async fn liked_videos(pool: &SqlitePool) -> AppResult<Vec<(VideoSummary, u64)>> {
    let stored: Vec<StoredLike> = get_setting(pool, "liked_items")
        .await?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    Ok(stored
        .into_iter()
        .filter(|like| like.kind == "video")
        .filter_map(|like| Some((like.video?, iso_ms(&like.liked_at))))
        .collect())
}

/// Videos in the viewer's playlists, Watch later included, with when the playlist was made.
pub async fn saved_videos(pool: &SqlitePool) -> AppResult<Vec<(VideoSummary, u64)>> {
    let stored: Vec<StoredPlaylist> = get_setting(pool, "user_playlists")
        .await?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    Ok(stored
        .into_iter()
        .flat_map(|playlist| {
            let at = playlist.created_at.as_deref().map_or(0, iso_ms);
            playlist.tracks.into_iter().map(move |track| (track, at))
        })
        .collect())
}
