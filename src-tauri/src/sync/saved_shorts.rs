//! Flow for Android keeps saved Shorts in a playlist with the reserved id `saved_shorts`; the
//! desktop keeps them in the `saved_shorts_library` setting, newest first. On the wire they are
//! that playlist, so its tracks merge one by one like any other playlist's.

use serde_json::{Map, Value};
use sqlx::SqlitePool;

use crate::db::settings;
use crate::errors::AppResult;
use crate::sync::canonical::{Hlc, Playlist, PlaylistItem, PlaylistOrigin};
use crate::sync::mapping::{self, PLAYLISTS_SETTING_KEY};
use crate::sync::merge::merge_playlists;

pub const SAVED_SHORTS_SETTING_KEY: &str = "saved_shorts_library";
pub const SAVED_SHORTS_SYNC_ID: &str = "saved_shorts";
/// Set once a device has sent `saved_shorts`. Android reserves only Watch Later, so sending this
/// list first would make a stray second playlist on a phone that has never saved a Short.
pub const PEER_KEEPS_LIST_SETTING_KEY: &str = "saved_shorts_peer_keeps_list";
const ADDED_AT_FIELD: &str = "addedAtInPlaylist";

fn text(entry: &Map<String, Value>, key: &str) -> Option<String> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// The library as the playlist Android knows. Android's own defaults fill the header, and the
/// header's time is the oldest save, so any edit on Android wins over it.
#[must_use]
pub fn parse_library(raw: &str, device_id: &str) -> Playlist {
    let entries: Vec<Map<String, Value>> = serde_json::from_str(raw).unwrap_or_default();
    let added_at = |entry: &Map<String, Value>| {
        entry
            .get(ADDED_AT_FIELD)
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let created = entries
        .iter()
        .map(added_at)
        .filter(|at| *at > 0)
        .min()
        .unwrap_or(0);
    let hlc = Hlc::new(created, 0, device_id);
    let items = entries
        .iter()
        .filter_map(|entry| Some((text(entry, "id")?, entry)))
        .enumerate()
        .map(|(position, (video_id, entry))| PlaylistItem {
            video_id,
            position: i64::try_from(position).unwrap_or(i64::MAX),
            added_at_ms: added_at(entry),
            deleted: false,
            title: text(entry, "title"),
            channel_name: text(entry, "channelName"),
            channel_id: text(entry, "channelId"),
            thumbnail_url: text(entry, "thumbnailUrl"),
            duration_seconds: entry.get("durationSeconds").and_then(Value::as_u64),
            is_music: false,
            hlc: hlc.clone(),
            raw: None,
        })
        .collect();
    Playlist {
        sync_id: SAVED_SHORTS_SYNC_ID.to_owned(),
        origin: PlaylistOrigin::Local,
        youtube_id: None,
        title: "Saved Shorts".to_owned(),
        description: Some("Your saved shorts".to_owned()),
        thumbnail_url: None,
        is_music: false,
        is_user_created: true,
        is_protected: false,
        created_at_ms: created,
        updated_hlc: hlc,
        deleted: false,
        items,
        raw: None,
    }
}

/// The merged playlist as the library, in its order. What Android doesn't carry (view counts, the
/// avatar) stays from the entry already in `current`.
#[must_use]
pub fn library_blob(playlist: &Playlist, current: Option<&str>) -> String {
    let existing: Vec<Map<String, Value>> = current
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    let mut items: Vec<&PlaylistItem> = playlist.items.iter().filter(|i| !i.deleted).collect();
    items.sort_by(|a, b| {
        a.position
            .cmp(&b.position)
            .then(a.video_id.cmp(&b.video_id))
    });
    let entries: Vec<Map<String, Value>> = items
        .into_iter()
        .map(|item| {
            let mut entry = existing
                .iter()
                .find(|e| text(e, "id").as_deref() == Some(item.video_id.as_str()))
                .cloned()
                .unwrap_or_default();
            entry.insert("type".to_owned(), Value::from("short"));
            entry.insert("id".to_owned(), Value::from(item.video_id.as_str()));
            let mut set = |key: &str, value: Option<&String>| {
                if let Some(value) = value.filter(|v| !v.is_empty()) {
                    entry.insert(key.to_owned(), Value::from(value.as_str()));
                }
            };
            set("title", item.title.as_ref());
            set("channelName", item.channel_name.as_ref());
            set("channelId", item.channel_id.as_ref());
            set("thumbnailUrl", item.thumbnail_url.as_ref());
            if item.added_at_ms > 0 {
                entry.insert(ADDED_AT_FIELD.to_owned(), Value::from(item.added_at_ms));
            }
            if let Some(duration) = item.duration_seconds.filter(|d| *d > 0) {
                entry.insert("durationSeconds".to_owned(), Value::from(duration));
            }
            entry
        })
        .collect();
    serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_owned())
}

/// Builds before this one kept Android's `saved_shorts` as an ordinary playlist. It moves into the
/// library once, with nothing recorded as deleted, because it is the same playlist on the wire.
pub async fn adopt_synced_playlist(pool: &SqlitePool) -> AppResult<()> {
    let Some(raw) = settings::get_setting(pool, PLAYLISTS_SETTING_KEY).await? else {
        return Ok(());
    };
    let (found, others): (Vec<Playlist>, Vec<Playlist>) = mapping::parse_playlists_blob(&raw, "")
        .into_iter()
        .partition(|p| p.sync_id == SAVED_SHORTS_SYNC_ID);
    if found.is_empty() {
        return Ok(());
    }
    settings::set_setting(pool, PEER_KEEPS_LIST_SETTING_KEY, "true").await?;
    let current = settings::get_setting(pool, SAVED_SHORTS_SETTING_KEY).await?;
    let library = current.as_deref().map(|raw| parse_library(raw, ""));
    let merged = merge_playlists(found, library.into_iter().collect());
    if let Some(playlist) = merged.first() {
        settings::set_setting(
            pool,
            SAVED_SHORTS_SETTING_KEY,
            &library_blob(playlist, current.as_deref()),
        )
        .await?;
    }
    settings::set_setting(
        pool,
        PLAYLISTS_SETTING_KEY,
        &mapping::playlists_to_blob(&others),
    )
    .await
}
