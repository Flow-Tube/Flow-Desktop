use std::collections::{HashMap, HashSet};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

use crate::db;
use crate::errors::AppResult;
use crate::models::video::VideoSummary;
use crate::services::subscription_feed::reels::reel_ids;
use crate::services::subscription_feed::rss::{fetch_rss, parse_rss_feed};
use crate::services::youtube_service::YoutubeService;

use crate::services::upcoming_reminders;

pub const NEW_NOTIFICATIONS_EVENT: &str = "notifications://new";
pub const ACTIVATE_NOTIFICATION_EVENT: &str = "notifications://activate";

const MAX_NATIVE_TOASTS: usize = 8;

const KEY_SUBSCRIPTIONS: &str = "subscriptions";
const KEY_CHANNEL_NOTIFICATIONS: &str = "subscription_notifications";
const KEY_MASTER_ENABLED: &str = "notifications_enabled";
const KEY_INTERVAL_MINUTES: &str = "notif_check_interval_minutes";
const KEY_SHORTS_CONTENT: &str = "shorts_content_enabled";
const KEY_SUBSCRIPTION_SHORTS: &str = "subscription_show_shorts";
const KEY_NOTIFY_SHORTS: &str = "notif_shorts_enabled";

const KIND_NEW_VIDEO: &str = "NEW_VIDEO";
const KIND_NEW_SHORT: &str = "NEW_SHORT";
const MAX_NEW_PER_CHANNEL: usize = 5;

const DEFAULT_INTERVAL_MINUTES: u64 = 360;
const MIN_INTERVAL_MINUTES: u64 = 15;
const STARTUP_DELAY_SECS: u64 = 20;
const CHANNEL_CHUNK: usize = 10;

#[derive(serde::Deserialize)]
struct StoredSubscription {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

pub(crate) struct PendingNotification {
    pub(crate) video_id: String,
    pub(crate) title: String,
    pub(crate) channel_id: Option<String>,
    pub(crate) channel_name: String,
    pub(crate) thumbnail_url: Option<String>,
    pub(crate) published_text: Option<String>,
    pub(crate) kind: &'static str,
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn master_enabled(pool: &sqlx::SqlitePool) -> bool {
    !matches!(
        db::settings::get_setting(pool, KEY_MASTER_ENABLED).await,
        Ok(Some(ref value)) if value == "false"
    )
}

async fn interval_minutes(pool: &sqlx::SqlitePool) -> u64 {
    db::settings::get_setting(pool, KEY_INTERVAL_MINUTES)
        .await
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_INTERVAL_MINUTES)
        .max(MIN_INTERVAL_MINUTES)
}

async fn load_subscriptions(pool: &sqlx::SqlitePool) -> Vec<StoredSubscription> {
    let Ok(Some(json)) = db::settings::get_setting(pool, KEY_SUBSCRIPTIONS).await else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<StoredSubscription>>(&json).unwrap_or_default()
}

async fn load_enabled_map(pool: &sqlx::SqlitePool) -> HashMap<String, bool> {
    let Ok(Some(json)) = db::settings::get_setting(pool, KEY_CHANNEL_NOTIFICATIONS).await else {
        return HashMap::new();
    };
    serde_json::from_str::<HashMap<String, bool>>(&json).unwrap_or_default()
}

async fn setting_is_on(pool: &sqlx::SqlitePool, key: &str) -> bool {
    !matches!(
        db::settings::get_setting(pool, key).await,
        Ok(Some(ref value)) if value == "false"
    )
}

/// The uploads newer than the last one announced, newest first: none on a first look at the channel,
/// and only the latest when the last one has left the feed.
fn new_entries_since(entries: &[VideoSummary], last_video_id: Option<&str>) -> Vec<VideoSummary> {
    let Some(last) = last_video_id else {
        return Vec::new();
    };
    match entries.iter().position(|video| video.id == last) {
        Some(index) => entries[..index.min(MAX_NEW_PER_CHANNEL)].to_vec(),
        None => entries.iter().take(1).cloned().collect(),
    }
}

/// A Short is announced only under both the Shorts switch and the alerts one; an upload not known to
/// be a Short always is.
fn should_announce(video: &VideoSummary, reels: &HashSet<String>, announce_shorts: bool) -> bool {
    announce_shorts || !(video.is_short || reels.contains(&video.id))
}

async fn check_channel(
    yt: &YoutubeService,
    client: &reqwest::Client,
    pool: &sqlx::SqlitePool,
    sub: &StoredSubscription,
    announce_shorts: bool,
) -> AppResult<Vec<PendingNotification>> {
    let Ok(xml) = fetch_rss(client, &sub.id).await else {
        return Ok(Vec::new());
    };

    let feed = parse_rss_feed(&sub.id, &xml);
    let feed_name = feed.channel_name;
    let unclassified = feed.unclassified;
    // A premiere is announced when it airs, and members-only uploads cannot be played.
    let mut uploads: Vec<(i64, VideoSummary)> = feed
        .videos
        .into_iter()
        .filter(|(_, video)| !video.is_members_only && !video.is_upcoming)
        .collect();
    uploads.sort_by_key(|(published, _)| std::cmp::Reverse(*published));
    let entries: Vec<VideoSummary> = uploads.into_iter().map(|(_, video)| video).collect();
    let Some(latest_id) = entries.first().map(|video| video.id.clone()) else {
        return Ok(Vec::new());
    };

    let previous = db::notifications::get_watermark(pool, &sub.id).await?;
    if previous.as_deref() == Some(latest_id.as_str()) {
        return Ok(Vec::new());
    }

    db::notifications::set_watermark(pool, &sub.id, &latest_id, now_millis()).await?;
    let fresh = new_entries_since(&entries, previous.as_deref());
    // The tab is a heavy look, only worth it when a Short would be held back and the feed can't say.
    let reels = if !announce_shorts && fresh.iter().any(|video| unclassified.contains(&video.id)) {
        reel_ids(yt, &sub.id).await.unwrap_or_default()
    } else {
        HashSet::new()
    };

    Ok(fresh
        .into_iter()
        .filter(|video| should_announce(video, &reels, announce_shorts))
        .map(|video| {
            let channel_name = sub
                .name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| feed_name.clone())
                .unwrap_or_else(|| video.channel_name.clone());
            PendingNotification {
                kind: if video.is_short {
                    KIND_NEW_SHORT
                } else {
                    KIND_NEW_VIDEO
                },
                video_id: video.id,
                title: video.title,
                channel_id: Some(sub.id.clone()),
                channel_name,
                thumbnail_url: video.thumbnail_url,
                published_text: video.published_text,
            }
        })
        .collect())
}

#[cfg(windows)]
async fn download_thumbnail(
    client: &reqwest::Client,
    video_id: &str,
) -> Option<std::path::PathBuf> {
    let url = format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg");
    let bytes = client.get(url).send().await.ok()?.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    let path = std::env::temp_dir().join(format!("flow-toast-{video_id}.jpg"));
    tokio::fs::write(&path, &bytes).await.ok()?;
    Some(path)
}

#[cfg(windows)]
async fn post_native_toast(
    app: &AppHandle,
    client: &reqwest::Client,
    pending: &[PendingNotification],
) {
    use crate::services::win_notify::{self, ToastCard};

    for entry in pending.iter().take(MAX_NATIVE_TOASTS) {
        let thumbnail = download_thumbnail(client, &entry.video_id).await;
        win_notify::show(
            app,
            &ToastCard {
                video_id: &entry.video_id,
                title: &entry.channel_name,
                body: &entry.title,
                thumbnail: thumbnail.as_deref(),
            },
        );
    }
}

#[cfg(not(windows))]
async fn post_native_toast(
    app: &AppHandle,
    _client: &reqwest::Client,
    pending: &[PendingNotification],
) {
    for entry in pending.iter().take(MAX_NATIVE_TOASTS) {
        if let Err(error) = app
            .notification()
            .builder()
            .title(&entry.channel_name)
            .body(&entry.title)
            .show()
        {
            tracing::warn!(%error, "Failed to post native subscription notification");
        }
    }
}

pub async fn poll_subscriptions(app: &AppHandle, pool: &sqlx::SqlitePool) -> AppResult<usize> {
    if !master_enabled(pool).await {
        return Ok(0);
    }

    let enabled = load_enabled_map(pool).await;
    let targets: Vec<StoredSubscription> = load_subscriptions(pool)
        .await
        .into_iter()
        .filter(|sub| enabled.get(&sub.id).copied().unwrap_or(true))
        .collect();

    if targets.is_empty() {
        return Ok(0);
    }

    let client = crate::api::http::shared_client();
    let yt = app.state::<YoutubeService>();
    let announce_shorts = setting_is_on(pool, KEY_SHORTS_CONTENT).await
        && setting_is_on(pool, KEY_SUBSCRIPTION_SHORTS).await
        && setting_is_on(pool, KEY_NOTIFY_SHORTS).await;
    let mut pending: Vec<PendingNotification> = Vec::new();
    let mut seen = HashSet::new();
    for chunk in targets.chunks(CHANNEL_CHUNK) {
        let fetches = chunk
            .iter()
            .map(|sub| check_channel(&yt, client, pool, sub, announce_shorts));
        for result in futures_util::future::join_all(fetches).await {
            match result {
                // A collaboration two followed channels both list must still notify once.
                Ok(entries) => pending.extend(
                    entries
                        .into_iter()
                        .filter(|entry| seen.insert(entry.video_id.clone())),
                ),
                Err(error) => tracing::warn!(%error, "Subscription channel check failed"),
            }
        }
    }

    deliver(app, pool, &pending).await
}

/// Keeps these in the inbox, tells the page and shows them as system notifications.
pub(crate) async fn deliver(
    app: &AppHandle,
    pool: &sqlx::SqlitePool,
    pending: &[PendingNotification],
) -> AppResult<usize> {
    if pending.is_empty() {
        return Ok(0);
    }

    let client = crate::api::http::shared_client();
    let created_at = now_millis();
    let mut created: Vec<db::notifications::NotificationRecord> = Vec::with_capacity(pending.len());
    for entry in pending {
        let record = db::notifications::NewNotification {
            video_id: entry.video_id.clone(),
            title: entry.title.clone(),
            channel_id: entry.channel_id.clone(),
            channel_name: entry.channel_name.clone(),
            thumbnail_url: entry.thumbnail_url.clone(),
            published_text: entry.published_text.clone(),
            kind: entry.kind,
            created_at,
        };
        match db::notifications::insert_notification(pool, &record).await {
            Ok(id) => created.push(db::notifications::NotificationRecord {
                id,
                video_id: record.video_id,
                title: record.title,
                channel_id: record.channel_id,
                channel_name: record.channel_name,
                thumbnail_url: record.thumbnail_url,
                published_text: record.published_text,
                kind: record.kind.to_string(),
                is_read: false,
                created_at,
            }),
            Err(error) => tracing::warn!(%error, "Failed to store notification"),
        }
    }

    if created.is_empty() {
        return Ok(0);
    }

    if let Err(error) = app.emit(NEW_NOTIFICATIONS_EVENT, &created) {
        tracing::warn!(%error, "Failed to emit new-notifications event");
    }
    post_native_toast(app, client, pending).await;

    Ok(created.len())
}

/// Spawns the resident poll loop. Reads the interval from settings each cycle so
/// changes take effect on the next pass without a restart.
pub fn spawn_poll_loop(app: AppHandle, pool: sqlx::SqlitePool) {
    upcoming_reminders::spawn_loop(app.clone(), pool.clone());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECS)).await;
        loop {
            match poll_subscriptions(&app, &pool).await {
                Ok(count) if count > 0 => {
                    tracing::info!("Subscription poll created {count} notification(s)");
                }
                Ok(_) => {}
                Err(error) => tracing::error!(%error, "Subscription poll pass failed"),
            }
            let minutes = interval_minutes(&pool).await;
            tokio::time::sleep(Duration::from_secs(minutes.saturating_mul(60))).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: &str) -> VideoSummary {
        VideoSummary {
            id: id.to_string(),
            ..VideoSummary::default()
        }
    }

    fn ids(videos: &[VideoSummary]) -> Vec<&str> {
        videos.iter().map(|video| video.id.as_str()).collect()
    }

    #[test]
    fn a_first_look_announces_nothing_and_a_later_one_what_came_since() {
        let entries = [video("c"), video("b"), video("a")];
        assert!(new_entries_since(&entries, None).is_empty());
        assert!(new_entries_since(&entries, Some("c")).is_empty());
        assert_eq!(ids(&new_entries_since(&entries, Some("a"))), ["c", "b"]);
    }

    #[test]
    fn a_last_upload_gone_from_the_feed_announces_only_the_latest() {
        let entries = [video("c"), video("b")];
        assert_eq!(ids(&new_entries_since(&entries, Some("gone"))), ["c"]);
    }

    #[test]
    fn a_burst_is_capped() {
        let entries: Vec<VideoSummary> = (0..9).map(|i| video(&format!("v{i}"))).collect();
        assert_eq!(
            new_entries_since(&entries, Some("v8")).len(),
            MAX_NEW_PER_CHANNEL
        );
    }

    #[test]
    fn shorts_are_held_back_unless_both_switches_allow_them() {
        let mut short = video("short");
        short.is_short = true;
        let plain = video("plain");
        let tab_says = video("reel");
        let reels = HashSet::from(["reel".to_string()]);
        assert!(should_announce(&short, &reels, true));
        assert!(!should_announce(&short, &reels, false));
        assert!(!should_announce(&tab_says, &reels, false));
        assert!(should_announce(&plain, &reels, false));
    }
}
