//! Recording what the user changes between syncs, at the moment it happens.
//!
//! Likes, playlists, albums and subscription groups are frontend JSON blobs, so the only place a
//! removal or an edit is visible is the write that replaces the blob: diffing the old and new blob
//! there gives each change its real time. Watch history deletions are recorded by the commands
//! that delete rows. See [`crate::sync::changes`] for where it is kept.

use std::collections::BTreeMap;

use sqlx::SqlitePool;

use crate::sync::canonical::{Hlc, Playlist, SubscriptionGroup};
use crate::sync::changes::{self, Change};
use crate::sync::error::SyncError;
use crate::sync::mapping;

/// Record the edits a frontend write to settings `key` is about to make. A no-op for keys that
/// aren't synced blobs.
pub async fn record_blob_write(pool: &SqlitePool, key: &str, new: &str) -> Result<(), SyncError> {
    if !is_tracked_blob(key) {
        return Ok(());
    }
    let old: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    let edits = diff_blob(key, old.as_deref().unwrap_or("[]"), new, now_ms());
    if edits.is_empty() {
        return Ok(());
    }
    let mut conn = pool.acquire().await?;
    changes::record(&mut conn, &edits).await
}

/// Record watch history deletions: one video, or every row when `video_id` is `None`.
pub async fn record_watch_deletion(
    pool: &SqlitePool,
    video_id: Option<&str>,
) -> Result<(), SyncError> {
    let ids: Vec<String> = match video_id {
        Some(id) => vec![id.to_string()],
        None => {
            sqlx::query_scalar("SELECT video_id FROM watch_history")
                .fetch_all(pool)
                .await?
        }
    };
    let now = now_ms();
    let edits: Vec<Change> = ids
        .into_iter()
        .map(|id| Change::delete(changes::WATCH_HISTORY, id, now, None))
        .collect();
    let mut conn = pool.acquire().await?;
    changes::record(&mut conn, &edits).await
}

fn is_tracked_blob(key: &str) -> bool {
    [
        mapping::LIKES_SETTING_KEY,
        mapping::PLAYLISTS_SETTING_KEY,
        mapping::ALBUMS_SETTING_KEY,
        mapping::SUBSCRIPTION_GROUPS_SETTING_KEY,
    ]
    .contains(&key)
}

/// The edits between two versions of a synced blob.
#[must_use]
pub fn diff_blob(key: &str, old: &str, new: &str, now_ms: u64) -> Vec<Change> {
    match key {
        mapping::LIKES_SETTING_KEY => diff_likes(old, new, now_ms),
        mapping::PLAYLISTS_SETTING_KEY => diff_playlists(
            &mapping::parse_playlists_blob(old, ""),
            &mapping::parse_playlists_blob(new, ""),
            now_ms,
        ),
        mapping::ALBUMS_SETTING_KEY => diff_playlists(
            &mapping::parse_albums_blob(old, ""),
            &mapping::parse_albums_blob(new, ""),
            now_ms,
        ),
        mapping::SUBSCRIPTION_GROUPS_SETTING_KEY => diff_groups(old, new, now_ms),
        _ => Vec::new(),
    }
}

fn diff_likes(old: &str, new: &str, now: u64) -> Vec<Change> {
    let keys = |raw: &str| -> Vec<String> {
        mapping::parse_likes_blob(raw, "")
            .iter()
            .map(mapping::like_key)
            .collect()
    };
    let (before, after) = (keys(old), keys(new));
    let mut out: Vec<Change> = before
        .iter()
        .filter(|k| !after.contains(k))
        .map(|k| Change::delete(changes::LIKES, k.clone(), now, None))
        .collect();
    out.extend(
        after
            .iter()
            .filter(|k| !before.contains(k))
            .map(|k| Change::edit(changes::LIKES, k.clone(), now)),
    );
    out
}

fn diff_playlists(old: &[Playlist], new: &[Playlist], now: u64) -> Vec<Change> {
    let by_id = |ps: &[Playlist]| -> BTreeMap<String, Playlist> {
        ps.iter().map(|p| (p.sync_id.clone(), p.clone())).collect()
    };
    let (before, after) = (by_id(old), by_id(new));
    let mut out = Vec::new();

    for (id, p) in &before {
        if !after.contains_key(id) {
            out.push(Change::delete(
                changes::PLAYLISTS,
                id.clone(),
                now,
                Some(playlist_tombstone_template(p)),
            ));
        }
    }
    for (id, p) in &after {
        let Some(prev) = before.get(id) else {
            out.push(Change::edit(changes::PLAYLISTS, id.clone(), now));
            continue;
        };
        if (&prev.title, &prev.description, &prev.thumbnail_url)
            != (&p.title, &p.description, &p.thumbnail_url)
        {
            out.push(Change::edit(changes::PLAYLISTS, id.clone(), now));
        }
        let positions = |pl: &Playlist| -> BTreeMap<String, i64> {
            pl.items
                .iter()
                .map(|i| (i.video_id.clone(), i.position))
                .collect()
        };
        let (was, is) = (positions(prev), positions(p));
        for vid in was.keys().filter(|v| !is.contains_key(*v)) {
            out.push(Change::delete(
                changes::PLAYLIST_ITEMS,
                changes::item_key(id, vid),
                now,
                None,
            ));
        }
        for (vid, pos) in &is {
            if was.get(vid) != Some(pos) {
                out.push(Change::edit(
                    changes::PLAYLIST_ITEMS,
                    changes::item_key(id, vid),
                    now,
                ));
            }
        }
    }
    out
}

/// The identity fields a peer needs to find the playlist a tombstone deletes.
fn playlist_tombstone_template(p: &Playlist) -> String {
    let template = Playlist {
        deleted: true,
        items: Vec::new(),
        raw: None,
        thumbnail_url: None,
        description: None,
        updated_hlc: Hlc::default(),
        ..p.clone()
    };
    serde_json::to_string(&template).unwrap_or_default()
}

fn diff_groups(old: &str, new: &str, now: u64) -> Vec<Change> {
    let by_name = |raw: &str| -> BTreeMap<String, SubscriptionGroup> {
        mapping::parse_subscription_groups_blob(raw, &Hlc::default())
            .into_iter()
            .map(|g| (g.name.clone(), g))
            .collect()
    };
    let (before, after) = (by_name(old), by_name(new));
    let mut out: Vec<Change> = before
        .keys()
        .filter(|n| !after.contains_key(*n))
        .map(|n| Change::delete(changes::GROUPS, n.clone(), now, None))
        .collect();
    out.extend(
        after
            .iter()
            .filter(|(n, g)| before.get(*n) != Some(g))
            .map(|(n, _)| Change::edit(changes::GROUPS, n.clone(), now)),
    );
    out
}

fn now_ms() -> u64 {
    u64::try_from(chrono::Utc::now().timestamp_millis()).unwrap_or(0)
}
