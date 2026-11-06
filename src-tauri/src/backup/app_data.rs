//! `app_data.json`: Flow for Android's `BackupData`, written from and read back into the desktop's
//! sync-collection records.
//!
//! Gson fills a field that is absent with its default and one that is `null` with null, and
//! `importBackupData` treats them differently: an empty `searchHistory` wipes the phone's, a null
//! one leaves it. So anything the desktop doesn't carry is written as an explicit null. Entities
//! Room stores (`VideoEntity`, `PlaylistEntity`) get every field, because Gson leaves a missing
//! non-null field null and Room then refuses the row.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Map, Value, json};

use crate::commands::backup::SUBSCRIPTION_CHANNELS_KEY;
use crate::sync::canonical::{
    Hlc, Like, LikeKind, LikeState, Playlist, PlaylistItem, PlaylistOrigin, SettingEntry,
    SubscribedChannel, SubscriptionGroup, WatchHistoryRecord,
};
use crate::sync::mapping::{WATCH_LATER_SYNC_ID, video_thumbnail};
use crate::sync::settings_map;

/// Android's backup version the file follows.
const BACKUP_VERSION: u32 = 2;
/// Holds the desktop's own export, which Android's parser skips.
pub const DESKTOP_KEY: &str = "desktop";
const WATCH_LATER_ID: &str = "watch_later";
/// Stamps what an Android backup restores; the device part of an HLC is only a tiebreaker.
const BACKUP_DEVICE: &str = "android-backup";

const MAX_HISTORY: usize = 500_000;
const MAX_LIST: usize = 100_000;
const MAX_TEXT: usize = 2_000;
const MAX_ID: usize = 128;

#[derive(Clone, Copy)]
enum Ty {
    Bool,
    Text,
    Float,
}

/// Wire key, Android's own preference key and its type, from Android's `SettingsMapper.WHITELIST`.
/// DataStore reads a key by type, so a value in the wrong typed map crashes the setting's reader.
const ANDROID_SETTINGS: &[(&str, &str, Ty)] = &[
    ("autoplay", "autoplay_enabled", Ty::Bool),
    ("default_quality_wifi", "default_quality_wifi", Ty::Text),
    ("playback_speed", "playback_speed", Ty::Float),
    ("sponsorblock_enabled", "sponsor_block_enabled", Ty::Bool),
    ("sponsorblock_submit_enabled", "sb_submit_enabled", Ty::Bool),
    ("sponsorblock_action_sponsor", "sb_action_sponsor", Ty::Text),
    ("sponsorblock_action_intro", "sb_action_intro", Ty::Text),
    ("sponsorblock_action_outro", "sb_action_outro", Ty::Text),
    (
        "sponsorblock_action_selfpromo",
        "sb_action_selfpromo",
        Ty::Text,
    ),
    (
        "sponsorblock_action_interaction",
        "sb_action_interaction",
        Ty::Text,
    ),
    (
        "sponsorblock_action_music_offtopic",
        "sb_action_music_offtopic",
        Ty::Text,
    ),
    ("sponsorblock_action_filler", "sb_action_filler", Ty::Text),
    ("sponsorblock_action_preview", "sb_action_preview", Ty::Text),
    (
        "sponsorblock_action_exclusive_access",
        "sb_action_exclusive_access",
        Ty::Text,
    ),
    ("dearrow_enabled", "dearrow_enabled", Ty::Bool),
    ("dearrow_badge_enabled", "dearrow_badge_enabled", Ty::Bool),
    ("subtitles_enabled", "subtitles_enabled", Ty::Bool),
    ("trending_region", "trending_region", Ty::Text),
    ("hide_watched_videos", "hide_watched_videos", Ty::Bool),
    ("comments_enabled", "comments_enabled", Ty::Bool),
    ("return_youtube_dislikes", "rytd_enabled", Ty::Bool),
    ("video_loop", "video_loop_enabled", Ty::Bool),
    ("stable_volume", "stable_volume_enabled", Ty::Bool),
    (
        "subscriptions_show_videos",
        "subscription_show_videos",
        Ty::Bool,
    ),
    (
        "subscriptions_show_shorts",
        "subscription_show_shorts",
        Ty::Bool,
    ),
    (
        "subscriptions_show_live",
        "subscription_show_live",
        Ty::Bool,
    ),
    ("shorts_quality_wifi", "shorts_quality_wifi", Ty::Text),
    ("music_audio_quality", "music_audio_quality", Ty::Text),
    (
        "preferred_audio_language",
        "preferred_audio_language",
        Ty::Text,
    ),
    (
        "preferred_subtitle_language",
        "preferred_subtitle_language",
        Ty::Text,
    ),
    ("equalizer", "eq_state_json", Ty::Text),
];

/// What goes into one `app_data.json`.
pub struct AppDataParts<'a> {
    pub collections: &'a Map<String, Value>,
    /// Raw stored settings by desktop key; `None` writes no settings at all.
    pub settings: Option<&'a HashMap<String, String>>,
    pub content_preferences: Option<Value>,
    pub desktop: Value,
    pub now_ms: u64,
}

fn records<T: serde::de::DeserializeOwned>(
    collections: &Map<String, Value>,
    key: &str,
) -> Option<Vec<T>> {
    let items = collections.get(key)?.as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| serde_json::from_value(item.clone()).ok())
            .collect(),
    )
}

fn or_null<T: serde::Serialize>(value: Option<T>) -> Value {
    value
        .and_then(|value| serde_json::to_value(value).ok())
        .unwrap_or(Value::Null)
}

fn history_entry(record: &WatchHistoryRecord) -> Value {
    let duration_ms = record.duration_seconds.unwrap_or(0).saturating_mul(1000);
    let position_ms = (f64::from(record.progress.clamp(0.0, 1.0)) * duration_ms as f64) as u64;
    json!({
        "videoId": record.video_id,
        "position": position_ms,
        "duration": duration_ms,
        "timestamp": record.watched_at_ms,
        "title": record.title,
        "thumbnailUrl": record
            .thumbnail_url
            .clone()
            .unwrap_or_else(|| video_thumbnail(&record.video_id)),
        "channelName": record.channel_name.clone().unwrap_or_default(),
        "channelId": record.channel_id.clone().unwrap_or_default(),
        "isMusic": record.is_music,
        "isShort": record.is_short,
        "isLocal": false,
    })
}

fn local_playlist_id(playlist: &Playlist) -> String {
    if playlist.sync_id == WATCH_LATER_SYNC_ID {
        return WATCH_LATER_ID.to_string();
    }
    match (&playlist.origin, &playlist.youtube_id) {
        (PlaylistOrigin::Youtube, Some(id)) if !id.is_empty() => id.clone(),
        _ => playlist.sync_id.clone(),
    }
}

fn video_entity(item: &PlaylistItem, now_ms: u64) -> Value {
    json!({
        "id": item.video_id,
        "title": item.title.clone().unwrap_or_default(),
        "channelName": item.channel_name.clone().unwrap_or_default(),
        "channelId": item.channel_id.clone().unwrap_or_default(),
        "thumbnailUrl": item
            .thumbnail_url
            .clone()
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| video_thumbnail(&item.video_id)),
        "duration": item.duration_seconds.unwrap_or(0),
        "viewCount": 0,
        "uploadDate": "",
        "description": "",
        "channelThumbnailUrl": "",
        "timestamp": now_ms,
        "savedAt": now_ms,
        "isMusic": item.is_music,
    })
}

struct AndroidPlaylists {
    playlists: Vec<Value>,
    cross_refs: Vec<Value>,
    videos: Vec<Value>,
}

fn android_playlists(playlists: &[Playlist], now_ms: u64) -> AndroidPlaylists {
    let mut out = AndroidPlaylists {
        playlists: Vec::new(),
        cross_refs: Vec::new(),
        videos: Vec::new(),
    };
    let mut seen_videos = HashSet::new();
    for playlist in playlists.iter().filter(|playlist| !playlist.deleted) {
        let id = local_playlist_id(playlist);
        let mut items: Vec<&PlaylistItem> =
            playlist.items.iter().filter(|item| !item.deleted).collect();
        items.sort_by_key(|item| item.position);
        out.playlists.push(json!({
            "id": id,
            "name": playlist.title,
            "description": playlist.description.clone().unwrap_or_default(),
            "thumbnailUrl": items
                .first()
                .and_then(|item| item.thumbnail_url.clone())
                .or_else(|| playlist.thumbnail_url.clone())
                .unwrap_or_default(),
            "isPrivate": playlist.is_protected,
            "createdAt": if playlist.created_at_ms > 0 { playlist.created_at_ms } else { now_ms },
            "videoCount": items.len(),
            "isMusic": playlist.is_music,
            "isUserCreated": playlist.is_user_created,
            "syncId": if id == WATCH_LATER_ID { Value::Null } else { json!(playlist.sync_id) },
            "position": 0,
        }));
        for (rank, item) in items.iter().enumerate() {
            out.cross_refs.push(json!({
                "playlistId": id,
                "videoId": item.video_id,
                "position": rank,
                "addedAt": item.added_at_ms,
            }));
            if seen_videos.insert(item.video_id.clone()) {
                out.videos.push(video_entity(item, now_ms));
            }
        }
    }
    out
}

fn liked_info(like: &Like) -> Option<Value> {
    if like.state != LikeState::Liked {
        return None;
    }
    let meta = like.meta.as_ref();
    let text = |key: &str| {
        meta.and_then(|meta| meta.get(key))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let nested = meta.and_then(|meta| meta.get("video"));
    Some(json!({
        "videoId": like.id,
        "title": text("title"),
        "thumbnail": text("thumbnailUrl"),
        "channelName": text("artist"),
        "likedAt": like.updated_at_ms,
        "isMusic": matches!(like.kind, LikeKind::Music),
        "channelId": nested
            .and_then(|video| video.get("channelId"))
            .and_then(Value::as_str),
        "durationSeconds": nested
            .and_then(|video| video.get("durationSeconds"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }))
}

fn subscription_entries(collections: &Map<String, Value>) -> Option<Vec<Value>> {
    let channels: Vec<SubscribedChannel> = records(collections, "subscribed_channels")?;
    Some(
        channels
            .iter()
            .filter(|channel| !channel.deleted)
            .map(|channel| {
                json!({
                    "channelId": channel.channel_id,
                    "channelName": channel.name,
                    "channelThumbnail": channel.avatar_url,
                    "subscribedAt": channel.subscribed_at_ms,
                    "lastVideoId": Value::Null,
                    "lastCheckTime": 0,
                    "isNotificationEnabled": false,
                    "isMusic": channel.is_music,
                    "lastFeedFetchAt": 0,
                })
            })
            .collect(),
    )
}

fn android_settings(raw: &HashMap<String, String>) -> Value {
    let mut strings = Map::new();
    let mut booleans = Map::new();
    let mut floats = Map::new();
    for (key, stored) in raw {
        for entry in settings_map::local_entry(key, stored, "", BACKUP_DEVICE) {
            let Some((_, android, ty)) = ANDROID_SETTINGS
                .iter()
                .find(|(wire, _, _)| *wire == entry.key)
            else {
                continue;
            };
            let android = (*android).to_string();
            match (ty, &entry.value) {
                (Ty::Bool, Value::Bool(_)) => {
                    booleans.insert(android, entry.value);
                }
                (Ty::Float, Value::Number(_)) => {
                    floats.insert(android, entry.value);
                }
                (Ty::Text, Value::String(_)) => {
                    strings.insert(android, entry.value);
                }
                _ => {}
            }
        }
    }
    json!({
        "strings": strings,
        "booleans": booleans,
        "ints": {},
        "floats": floats,
        "longs": {},
        "stringSets": {},
    })
}

/// The whole `BackupData`, with the desktop's own export under [`DESKTOP_KEY`].
#[must_use]
pub fn to_app_data(parts: AppDataParts<'_>) -> Value {
    let AppDataParts {
        collections,
        settings,
        content_preferences,
        desktop,
        now_ms,
    } = parts;
    let history: Option<Vec<WatchHistoryRecord>> = records(collections, "watch_history");
    let playlists: Option<Vec<Playlist>> = records(collections, "playlists");
    let playlists = playlists.map(|playlists| android_playlists(&playlists, now_ms));
    let likes: Option<Vec<Like>> = records(collections, "likes");
    let groups: Option<Vec<SubscriptionGroup>> = records(collections, "subscriptions");

    let (playlist_rows, cross_refs, videos) = match playlists {
        Some(all) => (
            Value::Array(all.playlists),
            Value::Array(all.cross_refs),
            Value::Array(all.videos),
        ),
        None => (Value::Null, Value::Null, Value::Null),
    };
    json!({
        "version": BACKUP_VERSION,
        "timestamp": now_ms,
        "viewHistory": or_null(history.map(|rows| {
            rows.iter()
                .filter(|row| !row.deleted)
                .map(history_entry)
                .collect::<Vec<_>>()
        })),
        "searchHistory": Value::Null,
        "musicSearchHistory": Value::Null,
        "subscriptions": or_null(subscription_entries(collections)),
        "playlists": playlist_rows,
        "playlistVideos": cross_refs,
        "videos": videos,
        "subscriptionGroups": or_null(groups.map(|groups| {
            groups
                .iter()
                .filter(|group| !group.deleted)
                .map(|group| {
                    json!({
                        "name": group.name,
                        "channelIds": group.channel_ids.join(","),
                        "sortOrder": group.sort_order,
                    })
                })
                .collect::<Vec<_>>()
        })),
        "notes": Value::Null,
        "likedVideos": or_null(likes.map(|likes| {
            likes.iter().filter_map(liked_info).collect::<Vec<_>>()
        })),
        "contentPreferences": content_preferences.unwrap_or(Value::Null),
        "settings": settings.map_or(Value::Null, android_settings),
        DESKTOP_KEY: desktop,
    })
}

/// Whether a parsed JSON object is an Android `BackupData` (a desktop file has `schemaVersion`).
#[must_use]
pub fn is_android_app_data(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    !object.contains_key("schemaVersion")
        && object.get("version").is_some_and(Value::is_number)
        && (object.contains_key("viewHistory")
            || object.contains_key("subscriptions")
            || object.contains_key("playlists"))
}

fn text_of(value: Option<&Value>, max: usize) -> String {
    let text = value.and_then(Value::as_str).unwrap_or_default();
    text.chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn id_of(value: Option<&Value>) -> Option<String> {
    let id = value?.as_str()?.trim();
    let usable =
        !id.is_empty() && id.chars().count() <= MAX_ID && !id.chars().any(char::is_control);
    usable.then(|| id.to_string())
}

fn u64_of(value: Option<&Value>) -> u64 {
    value
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|n| n.max(0.0) as u64))
        })
        .unwrap_or(0)
}

fn list<'a>(value: &'a Value, key: &str, cap: usize) -> impl Iterator<Item = &'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(cap)
}

fn to_values<T: serde::Serialize>(items: Vec<T>) -> Value {
    Value::Array(
        items
            .into_iter()
            .filter_map(|item| serde_json::to_value(item).ok())
            .collect(),
    )
}

fn history_from_android(value: &Value) -> Vec<WatchHistoryRecord> {
    list(value, "viewHistory", MAX_HISTORY)
        .filter(|entry| {
            !entry
                .get("isLocal")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let video_id = id_of(entry.get("videoId"))?;
            let timestamp = u64_of(entry.get("timestamp"));
            let duration_ms = u64_of(entry.get("duration"));
            let position_ms = u64_of(entry.get("position"));
            let progress = if duration_ms > 0 {
                (position_ms as f64 / duration_ms as f64).clamp(0.0, 1.0) as f32
            } else {
                0.0
            };
            let channel = |key: &str| {
                let text = text_of(entry.get(key), MAX_TEXT);
                (!text.is_empty()).then_some(text)
            };
            Some(WatchHistoryRecord {
                title: text_of(entry.get("title"), MAX_TEXT),
                channel_name: channel("channelName"),
                channel_id: channel("channelId"),
                watched_at_ms: timestamp,
                progress,
                duration_seconds: Some(duration_ms / 1000),
                is_music: entry
                    .get("isMusic")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                is_short: entry
                    .get("isShort")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                thumbnail_url: Some(video_thumbnail(&video_id)),
                hlc: Hlc::new(timestamp, 0, BACKUP_DEVICE),
                deleted: false,
                video_id,
            })
        })
        .collect()
}

fn playlists_from_android(value: &Value) -> Vec<Playlist> {
    let videos: HashMap<&str, &Value> = list(value, "videos", MAX_HISTORY)
        .filter_map(|video| Some((video.get("id")?.as_str()?, video)))
        .collect();
    let mut members: BTreeMap<String, Vec<(i64, &Value)>> = BTreeMap::new();
    for cross_ref in list(value, "playlistVideos", MAX_HISTORY) {
        if let Some(id) = id_of(cross_ref.get("playlistId")) {
            let position = cross_ref
                .get("position")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            members.entry(id).or_default().push((position, cross_ref));
        }
    }
    list(value, "playlists", MAX_LIST)
        .filter_map(|playlist| {
            let id = id_of(playlist.get("id"))?;
            let is_music = playlist
                .get("isMusic")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let is_user_created = playlist
                .get("isUserCreated")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let created_at_ms = u64_of(playlist.get("createdAt"));
            let mut refs = members.remove(&id).unwrap_or_default();
            refs.sort_by_key(|(position, _)| *position);
            let mut latest = created_at_ms;
            let items: Vec<PlaylistItem> = refs
                .iter()
                .enumerate()
                .filter_map(|(rank, (_, cross_ref))| {
                    let video_id = id_of(cross_ref.get("videoId"))?;
                    let added_at_ms = u64_of(cross_ref.get("addedAt"));
                    latest = latest.max(added_at_ms);
                    let video = videos.get(video_id.as_str()).copied();
                    let part = |key: &str| {
                        let text = text_of(video.and_then(|video| video.get(key)), MAX_TEXT);
                        (!text.is_empty()).then_some(text)
                    };
                    Some(PlaylistItem {
                        position: i64::try_from(rank).unwrap_or(i64::MAX),
                        added_at_ms,
                        title: part("title"),
                        channel_name: part("channelName"),
                        channel_id: part("channelId"),
                        thumbnail_url: part("thumbnailUrl"),
                        duration_seconds: video.map(|video| u64_of(video.get("duration"))),
                        is_music: video
                            .and_then(|video| video.get("isMusic"))
                            .and_then(Value::as_bool)
                            .unwrap_or(is_music),
                        hlc: Hlc::new(added_at_ms.max(created_at_ms), 0, BACKUP_DEVICE),
                        video_id,
                        ..PlaylistItem::default()
                    })
                })
                .collect();
            let is_watch_later = id == WATCH_LATER_ID;
            let sync_id = if is_watch_later {
                WATCH_LATER_SYNC_ID.to_string()
            } else {
                id_of(playlist.get("syncId")).unwrap_or_else(|| id.clone())
            };
            let description = text_of(playlist.get("description"), MAX_TEXT);
            Some(Playlist {
                sync_id,
                origin: if is_user_created {
                    PlaylistOrigin::Local
                } else {
                    PlaylistOrigin::Youtube
                },
                youtube_id: (!is_user_created).then(|| id.clone()),
                title: text_of(playlist.get("name"), MAX_TEXT),
                description: (!description.is_empty()).then_some(description),
                thumbnail_url: None,
                is_music,
                is_user_created,
                is_protected: is_watch_later,
                created_at_ms,
                updated_hlc: Hlc::new(latest, 0, BACKUP_DEVICE),
                deleted: false,
                items,
                raw: None,
            })
        })
        .collect()
}

fn likes_from_android(value: &Value) -> Vec<Like> {
    list(value, "likedVideos", MAX_LIST)
        .filter_map(|like| {
            let id = id_of(like.get("videoId"))?;
            let liked_at = u64_of(like.get("likedAt"));
            let is_music = like
                .get("isMusic")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Some(Like {
                kind: if is_music {
                    LikeKind::Music
                } else {
                    LikeKind::Video
                },
                state: LikeState::Liked,
                updated_at_ms: liked_at,
                hlc: Hlc::new(liked_at, 0, BACKUP_DEVICE),
                meta: Some(json!({
                    "title": text_of(like.get("title"), MAX_TEXT),
                    "artist": text_of(like.get("channelName"), MAX_TEXT),
                    "thumbnailUrl": text_of(like.get("thumbnail"), MAX_TEXT),
                    "channelId": text_of(like.get("channelId"), MAX_ID),
                    "durationSeconds": u64_of(like.get("durationSeconds")),
                })),
                id,
            })
        })
        .collect()
}

fn channels_from_android(value: &Value) -> Vec<Value> {
    let mut seen = HashSet::new();
    list(value, "subscriptions", MAX_LIST)
        .filter_map(|channel| {
            let id = id_of(channel.get("channelId"))?;
            seen.insert(id.clone()).then(|| {
                json!({
                    "id": id,
                    "name": text_of(channel.get("channelName"), MAX_TEXT),
                    "avatarUrl": text_of(channel.get("channelThumbnail"), MAX_TEXT),
                    "subscribedAt": u64_of(channel.get("subscribedAt")),
                    "isMusic": channel.get("isMusic").and_then(Value::as_bool).unwrap_or(false),
                })
            })
        })
        .collect()
}

fn groups_from_android(value: &Value, now_ms: u64) -> Vec<SubscriptionGroup> {
    list(value, "subscriptionGroups", MAX_LIST)
        .filter_map(|group| {
            let name = text_of(group.get("name"), MAX_TEXT);
            if name.is_empty() {
                return None;
            }
            let mut channel_ids: Vec<String> = group
                .get("channelIds")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .collect();
            channel_ids.sort();
            channel_ids.dedup();
            Some(SubscriptionGroup {
                name,
                channel_ids,
                sort_order: group
                    .get("sortOrder")
                    .and_then(Value::as_i64)
                    .and_then(|order| i32::try_from(order).ok())
                    .unwrap_or(0),
                hlc: Hlc::new(now_ms, 0, BACKUP_DEVICE),
                ..SubscriptionGroup::default()
            })
        })
        .collect()
}

/// Android's settings, as stored desktop values by desktop key, for the schema check on restore.
fn settings_from_android(value: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(settings) = value.get("settings") else {
        return out;
    };
    let mut sb_actions = Vec::new();
    for (wire, android, ty) in ANDROID_SETTINGS {
        let group = match ty {
            Ty::Bool => "booleans",
            Ty::Text => "strings",
            Ty::Float => "floats",
        };
        let Some(stored) = settings.get(group).and_then(|group| group.get(*android)) else {
            continue;
        };
        if settings_map::is_sb_action(wire) {
            sb_actions.push(SettingEntry {
                key: (*wire).to_string(),
                value: stored.clone(),
                hlc: Hlc::default(),
            });
        } else if let Some((key, text)) = settings_map::from_wire(wire, stored) {
            out.insert(key.to_string(), Value::String(text));
        }
    }
    if let Some((key, text)) = settings_map::sb_actions_from_wire(None, sb_actions.iter()) {
        out.insert(key.to_string(), Value::String(text));
    }
    out
}

/// One profile's data as the desktop's backup shape: flat settings and collection records.
pub struct DesktopSlice {
    pub settings: Map<String, Value>,
    pub collections: Map<String, Value>,
}

/// Android's `BackupData` as the desktop's backup shape.
#[must_use]
pub fn from_app_data(value: &Value, now_ms: u64) -> DesktopSlice {
    let mut collections = Map::new();
    let mut put = |key: &str, items: Value| {
        if items.as_array().is_some_and(|items| !items.is_empty()) {
            collections.insert(key.to_string(), items);
        }
    };
    put("watch_history", to_values(history_from_android(value)));
    put("playlists", to_values(playlists_from_android(value)));
    put("likes", to_values(likes_from_android(value)));
    put(
        "subscriptions",
        to_values(groups_from_android(value, now_ms)),
    );
    put(
        SUBSCRIPTION_CHANNELS_KEY,
        Value::Array(channels_from_android(value)),
    );
    DesktopSlice {
        settings: settings_from_android(value),
        collections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collections() -> Map<String, Value> {
        let playlist = Playlist {
            sync_id: "sync-1".into(),
            title: "Mix".into(),
            is_user_created: true,
            created_at_ms: 5,
            items: vec![
                PlaylistItem {
                    video_id: "second".into(),
                    position: 1,
                    ..PlaylistItem::default()
                },
                PlaylistItem {
                    video_id: "first".into(),
                    position: 0,
                    title: Some("First".into()),
                    ..PlaylistItem::default()
                },
            ],
            ..Playlist::default()
        };
        let watch_later = Playlist {
            sync_id: WATCH_LATER_SYNC_ID.into(),
            title: "Watch Later".into(),
            is_protected: true,
            is_user_created: true,
            ..Playlist::default()
        };
        json!({
            "watch_history": [WatchHistoryRecord {
                video_id: "abcdefghijk".into(),
                title: "A video".into(),
                watched_at_ms: 1000,
                progress: 0.5,
                duration_seconds: Some(100),
                ..WatchHistoryRecord::default()
            }],
            "playlists": [playlist, watch_later],
            "likes": [Like {
                kind: LikeKind::Music,
                id: "liked".into(),
                state: LikeState::Liked,
                updated_at_ms: 9,
                hlc: Hlc::default(),
                meta: Some(json!({ "title": "Song", "artist": "Band", "thumbnailUrl": "t" })),
            }],
            "subscribed_channels": [SubscribedChannel {
                channel_id: "UCabc".into(),
                name: "Channel".into(),
                ..SubscribedChannel::default()
            }],
            "subscriptions": [SubscriptionGroup {
                name: "Group".into(),
                channel_ids: vec!["UCabc".into(), "UCdef".into()],
                ..SubscriptionGroup::default()
            }],
        })
        .as_object()
        .unwrap()
        .clone()
    }

    fn written() -> Value {
        let settings: HashMap<String, String> = [
            ("autoplay_enabled", "false"),
            ("playback_speed", "1.5"),
            ("trending_region", "DE"),
            ("sponsorblock_categories", r#"{"sponsor":"mute"}"#),
            ("download_location", "/secret/path"),
        ]
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect();
        to_app_data(AppDataParts {
            collections: &collections(),
            settings: Some(&settings),
            content_preferences: None,
            desktop: json!({ "schemaVersion": 2 }),
            now_ms: 77,
        })
    }

    #[test]
    fn writes_every_field_androids_entities_require() {
        let data = written();
        assert_eq!(data["version"], 2);
        assert!(data["searchHistory"].is_null());
        assert!(data["notes"].is_null());
        assert_eq!(data["viewHistory"][0]["position"], 50_000);
        assert_eq!(data["viewHistory"][0]["duration"], 100_000);
        let video = &data["videos"][0];
        for key in [
            "id",
            "title",
            "channelName",
            "channelId",
            "thumbnailUrl",
            "uploadDate",
            "description",
            "channelThumbnailUrl",
        ] {
            assert!(video[key].is_string(), "{key} must be a string");
        }
        let later = data["playlists"]
            .as_array()
            .unwrap()
            .iter()
            .find(|playlist| playlist["id"] == WATCH_LATER_ID)
            .unwrap();
        assert!(later["syncId"].is_null());
        assert_eq!(later["isPrivate"], true);
        assert_eq!(data["playlistVideos"][0]["videoId"], "first");
        assert_eq!(data["subscriptionGroups"][0]["channelIds"], "UCabc,UCdef");
        assert_eq!(data["likedVideos"][0]["isMusic"], true);
        assert_eq!(data["likedVideos"][0]["channelName"], "Band");
    }

    #[test]
    fn settings_land_in_androids_typed_maps_under_its_keys() {
        let settings = &written()["settings"];
        assert_eq!(settings["booleans"]["autoplay_enabled"], false);
        assert_eq!(settings["floats"]["playback_speed"], 1.5);
        assert_eq!(settings["strings"]["trending_region"], "DE");
        assert_eq!(settings["strings"]["sb_action_sponsor"], "MUTE");
        assert!(!settings.to_string().contains("/secret/path"));
    }

    #[test]
    fn what_was_written_reads_back_as_the_same_library() {
        let data = written();
        assert!(is_android_app_data(&data));
        let slice = from_app_data(&data, 100);

        assert_eq!(slice.settings["autoplay_enabled"], "false");
        assert_eq!(slice.settings["trending_region"], "DE");
        assert!(
            slice.settings["sponsorblock_categories"]
                .as_str()
                .unwrap()
                .contains("mute")
        );

        let history: Vec<WatchHistoryRecord> =
            serde_json::from_value(slice.collections["watch_history"].clone()).unwrap();
        assert_eq!(history[0].video_id, "abcdefghijk");
        assert_eq!(history[0].duration_seconds, Some(100));
        assert!((history[0].progress - 0.5).abs() < f32::EPSILON);

        let playlists: Vec<Playlist> =
            serde_json::from_value(slice.collections["playlists"].clone()).unwrap();
        let mix = playlists.iter().find(|p| p.sync_id == "sync-1").unwrap();
        assert_eq!(mix.items[0].video_id, "first");
        assert_eq!(mix.items[1].position, 1);
        assert!(playlists.iter().any(|p| p.sync_id == WATCH_LATER_SYNC_ID));

        let likes: Vec<Like> = serde_json::from_value(slice.collections["likes"].clone()).unwrap();
        assert_eq!(likes[0].kind, LikeKind::Music);
        assert_eq!(
            slice.collections[SUBSCRIPTION_CHANNELS_KEY][0]["id"],
            "UCabc"
        );
    }

    #[test]
    fn hostile_rows_are_dropped_not_kept() {
        let long_id = "x".repeat(MAX_ID + 1);
        let data = json!({
            "version": 2,
            "viewHistory": [
                { "videoId": long_id, "title": "t" },
                { "videoId": "ok", "title": "a\u{0}b", "isLocal": true },
                "not an object",
            ],
            "subscriptions": [{ "channelId": "UCa" }, { "channelId": "UCa" }],
        });
        let slice = from_app_data(&data, 0);
        assert!(!slice.collections.contains_key("watch_history"));
        assert_eq!(
            slice.collections[SUBSCRIPTION_CHANNELS_KEY]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_desktop_file_is_not_mistaken_for_an_android_one() {
        assert!(!is_android_app_data(
            &json!({ "schemaVersion": 2, "version": 2, "subscriptions": [] })
        ));
    }
}
