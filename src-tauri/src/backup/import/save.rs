//! Saves what an import read, through the same collection restore as a backup. The engines learn
//! only through the two bootstraps: a playlist teaches nothing, and likes teach only when new and
//! from the past year, so a decade of them can't revive long-abandoned topics.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Map, Value, json};
use sqlx::SqlitePool;

use super::{Found, ImportError, TakenLike, TakenPlaylist, Watch};
use crate::commands::backup::{SUBSCRIPTION_CHANNELS_KEY, get_setting_value, import_backup};
use crate::flow_neuro::bootstrap::ImportedVideo;
use crate::sync::canonical::{
    Hlc, Like, LikeKind, LikeState, Playlist, PlaylistItem, PlaylistOrigin, WatchHistoryRecord,
};
use crate::sync::mapping::{self, WATCH_LATER_SYNC_ID, video_thumbnail};

const IMPORT_DEVICE: &str = "import";
const LEARN_FROM_WATCHES: usize = 800;
const LEARN_FROM_LIKES: usize = 500;
const LIKES_LEARNING_WINDOW_MS: u64 = 365 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub subscriptions: usize,
    pub history: usize,
    pub playlists: usize,
    pub playlist_videos: usize,
    pub music_playlists: usize,
    pub music_library: usize,
    pub likes: usize,
}

/// What the import hands the engines, and what it reports.
pub struct Saved {
    pub report: ImportReport,
    pub learn_from: Vec<ImportedVideo>,
    pub channel_names: Vec<String>,
}

fn watch_record(watch: &Watch) -> WatchHistoryRecord {
    let progress = if watch.duration_seconds > 0 {
        (watch.position_seconds as f64 / watch.duration_seconds as f64).clamp(0.0, 1.0) as f32
    } else {
        0.0
    };
    WatchHistoryRecord {
        video_id: watch.video_id.clone(),
        title: watch.title.clone(),
        channel_name: (!watch.channel_name.is_empty()).then(|| watch.channel_name.clone()),
        channel_id: (!watch.channel_id.is_empty()).then(|| watch.channel_id.clone()),
        watched_at_ms: watch.watched_at,
        progress,
        duration_seconds: (watch.duration_seconds > 0).then_some(watch.duration_seconds),
        is_music: watch.is_music,
        is_short: false,
        thumbnail_url: Some(video_thumbnail(&watch.video_id)),
        // The watch's own time, so an import never overrides a newer watch here.
        hlc: Hlc::new(watch.watched_at, 0, IMPORT_DEVICE),
        deleted: false,
    }
}

fn deduped_watches(watches: &[Watch]) -> Vec<&Watch> {
    let mut newest: HashMap<&str, &Watch> = HashMap::new();
    for watch in watches {
        let entry = newest.entry(watch.video_id.as_str()).or_insert(watch);
        if watch.watched_at > entry.watched_at {
            *entry = watch;
        }
    }
    let mut unique: Vec<&Watch> = newest.into_values().collect();
    unique.sort_by_key(|watch| std::cmp::Reverse(watch.watched_at));
    unique
}

fn like_record(like: &TakenLike) -> Like {
    Like {
        kind: if like.is_music {
            LikeKind::Music
        } else {
            LikeKind::Video
        },
        id: like.video_id.clone(),
        state: LikeState::Liked,
        updated_at_ms: like.liked_at,
        hlc: Hlc::new(like.liked_at, 0, IMPORT_DEVICE),
        meta: Some(json!({
            "title": like.title,
            "artist": like.channel_name,
            "thumbnailUrl": video_thumbnail(&like.video_id),
            "channelId": like.channel_id,
        })),
    }
}

/// The ids already in the viewer's library, and where to add after them: importing appends, and
/// never renumbers what the viewer's own saves are using.
fn existing_tracks(pool_playlists: &[Playlist]) -> HashMap<String, (HashSet<String>, i64)> {
    pool_playlists
        .iter()
        .map(|playlist| {
            let live = playlist.items.iter().filter(|item| !item.deleted);
            let held = live.clone().map(|item| item.video_id.clone()).collect();
            let next = live.map(|item| item.position + 1).max().unwrap_or(0);
            (playlist.sync_id.clone(), (held, next))
        })
        .collect()
}

fn playlist_record(
    playlist: &TakenPlaylist,
    existing: &HashMap<String, (HashSet<String>, i64)>,
    now: u64,
) -> Playlist {
    let sync_id = if playlist.is_watch_later {
        WATCH_LATER_SYNC_ID.to_string()
    } else {
        playlist.key.clone()
    };
    let (held, mut next) = existing
        .get(&sync_id)
        .map_or_else(|| (HashSet::new(), 0), |(held, next)| (held.clone(), *next));
    let hlc = Hlc::new(now, 0, IMPORT_DEVICE);
    let items = playlist
        .tracks
        .iter()
        .filter(|track| !held.contains(&track.video_id))
        .map(|track| {
            let position = next;
            next += 1;
            let some = |text: &str| (!text.is_empty()).then(|| text.to_string());
            PlaylistItem {
                video_id: track.video_id.clone(),
                position,
                added_at_ms: now,
                title: some(&track.title),
                channel_name: some(&track.artists),
                channel_id: some(&track.channel_id),
                thumbnail_url: Some(
                    some(&track.thumbnail).unwrap_or_else(|| video_thumbnail(&track.video_id)),
                ),
                duration_seconds: (track.duration_seconds > 0).then_some(track.duration_seconds),
                is_music: playlist.is_music,
                hlc: hlc.clone(),
                ..PlaylistItem::default()
            }
        })
        .collect();
    Playlist {
        sync_id,
        origin: PlaylistOrigin::Local,
        title: playlist.name.clone(),
        is_music: playlist.is_music,
        is_user_created: true,
        is_protected: playlist.is_watch_later,
        created_at_ms: playlist.created_at,
        updated_hlc: hlc,
        items,
        ..Playlist::default()
    }
}

async fn local_playlists(pool: &SqlitePool, device_id: &str) -> Result<Vec<Playlist>, ImportError> {
    let failed = |error: crate::sync::error::SyncError| ImportError::Failed(error.to_string());
    let mut playlists = get_setting_value(pool, mapping::PLAYLISTS_SETTING_KEY)
        .await
        .map_err(failed)?
        .map_or_else(Vec::new, |raw| {
            mapping::parse_playlists_blob(&raw, device_id)
        });
    if let Some(raw) = get_setting_value(pool, mapping::ALBUMS_SETTING_KEY)
        .await
        .map_err(failed)?
    {
        playlists.extend(mapping::parse_albums_blob(&raw, device_id));
    }
    Ok(playlists)
}

async fn liked_ids(pool: &SqlitePool) -> Result<HashSet<String>, ImportError> {
    let raw = get_setting_value(pool, mapping::LIKES_SETTING_KEY)
        .await
        .map_err(|error| ImportError::Failed(error.to_string()))?;
    Ok(raw
        .map(|raw| mapping::parse_likes_blob(&raw, IMPORT_DEVICE))
        .unwrap_or_default()
        .into_iter()
        .map(|like| like.id)
        .collect())
}

fn imported_video(
    video_id: &str,
    title: &str,
    channel_name: &str,
    channel_id: &str,
    at: u64,
    is_music: bool,
) -> ImportedVideo {
    ImportedVideo {
        video_id: video_id.to_string(),
        title: title.to_string(),
        channel_name: channel_name.to_string(),
        channel_id: (!channel_id.is_empty()).then(|| channel_id.to_string()),
        duration_seconds: None,
        watched_at: i64::try_from(at).unwrap_or(0),
        is_music,
    }
}

/// Writes everything found. Nothing has reached the engines yet when this returns.
pub async fn save_found(pool: &SqlitePool, found: &Found, now: u64) -> Result<Saved, ImportError> {
    let mut collections = Map::new();
    let mut report = ImportReport::default();

    let watches = deduped_watches(&found.watches);
    report.history = watches.len();
    if !watches.is_empty() {
        let records: Vec<WatchHistoryRecord> =
            watches.iter().map(|watch| watch_record(watch)).collect();
        collections.insert("watch_history".into(), json!(records));
    }

    if !found.channels.is_empty() {
        report.subscriptions = found.channels.len();
        let channels: Vec<Value> = found
            .channels
            .iter()
            .map(|channel| {
                json!({
                    "id": channel.id,
                    "name": channel.name,
                    "avatarUrl": channel.avatar,
                    "subscribedAt": now,
                })
            })
            .collect();
        collections.insert(SUBSCRIPTION_CHANNELS_KEY.into(), Value::Array(channels));
    }

    if !found.playlists.is_empty() {
        let existing = existing_tracks(&local_playlists(pool, IMPORT_DEVICE).await?);
        let records: Vec<Playlist> = found
            .playlists
            .iter()
            .map(|playlist| playlist_record(playlist, &existing, now))
            .collect();
        report.playlists = found.playlists.len();
        report.playlist_videos = found.playlists.iter().map(|p| p.tracks.len()).sum();
        report.music_playlists = found.playlists.iter().filter(|p| p.is_music).count();
        report.music_library = found.library_song_count;
        collections.insert("playlists".into(), json!(records));
    }

    // A video the viewer already holds a like for keeps it as it is.
    let held = liked_ids(pool).await?;
    let new_likes: Vec<&TakenLike> = found
        .likes
        .iter()
        .filter(|like| !held.contains(&like.video_id))
        .collect();
    report.likes = new_likes.len();
    if !new_likes.is_empty() {
        let records: Vec<Like> = new_likes.iter().map(|like| like_record(like)).collect();
        collections.insert("likes".into(), json!(records));
    }

    import_backup(pool, &json!({ "collections": collections }))
        .await
        .map_err(|error| ImportError::Failed(error.to_string()))?;

    let mut learn_from: Vec<ImportedVideo> = watches
        .iter()
        .filter(|watch| !watch.title.is_empty())
        .take(LEARN_FROM_WATCHES)
        .map(|watch| {
            imported_video(
                &watch.video_id,
                &watch.title,
                &watch.channel_name,
                &watch.channel_id,
                watch.watched_at,
                watch.is_music,
            )
        })
        .collect();
    let since = now.saturating_sub(LIKES_LEARNING_WINDOW_MS);
    learn_from.extend(
        new_likes
            .iter()
            .filter(|like| !like.is_music && like.liked_at >= since)
            .take(LEARN_FROM_LIKES)
            .map(|like| {
                imported_video(
                    &like.video_id,
                    &like.title,
                    &like.channel_name,
                    &like.channel_id,
                    like.liked_at,
                    false,
                )
            }),
    );
    Ok(Saved {
        report,
        learn_from,
        channel_names: found
            .channels
            .iter()
            .map(|channel| channel.name.clone())
            .filter(|name| !name.is_empty())
            .collect(),
    })
}
