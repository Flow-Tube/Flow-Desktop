use std::collections::HashMap;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

use crate::commands::youtube::parse_rss_feed;
use crate::db;
use crate::errors::AppResult;

pub const NEW_NOTIFICATIONS_EVENT: &str = "notifications://new";
pub const ACTIVATE_NOTIFICATION_EVENT: &str = "notifications://activate";

const MAX_NATIVE_TOASTS: usize = 8;

const KEY_SUBSCRIPTIONS: &str = "subscriptions";
const KEY_CHANNEL_NOTIFICATIONS: &str = "subscription_notifications";
const KEY_MASTER_ENABLED: &str = "notifications_enabled";
const KEY_INTERVAL_MINUTES: &str = "notif_check_interval_minutes";

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

struct PendingNotification {
    video_id: String,
    title: String,
    channel_id: String,
    channel_name: String,
    thumbnail_url: Option<String>,
    published_text: Option<String>,
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(crate::api::http::BROWSER_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
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

async fn check_channel(
    client: &reqwest::Client,
    pool: &sqlx::SqlitePool,
    sub: &StoredSubscription,
) -> AppResult<Option<PendingNotification>> {
    let rss_url = format!(
        "https://www.youtube.com/feeds/videos.xml?channel_id={}",
        sub.id
    );
    let xml = client.get(rss_url).send().await.ok();
    let Some(response) = xml else { return Ok(None) };
    let Some(xml) = response.text().await.ok() else {
        return Ok(None);
    };

    let (feed_name, videos) = parse_rss_feed(&sub.id, &xml);
    let Some((_, latest)) = videos.into_iter().max_by_key(|(sort_key, _)| *sort_key) else {
        return Ok(None);
    };

    let previous = db::notifications::get_watermark(pool, &sub.id).await?;
    if previous.as_deref() == Some(latest.id.as_str()) {
        return Ok(None);
    }

    let should_notify = previous.is_some();
    db::notifications::set_watermark(pool, &sub.id, &latest.id, now_millis()).await?;
    if !should_notify {
        return Ok(None);
    }

    let channel_name = sub
        .name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(feed_name)
        .unwrap_or_else(|| latest.channel_name.clone());

    Ok(Some(PendingNotification {
        video_id: latest.id,
        title: latest.title,
        channel_id: sub.id.clone(),
        channel_name,
        thumbnail_url: latest.thumbnail_url,
        published_text: latest.published_text,
    }))
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

    let client = build_client();
    let mut pending: Vec<PendingNotification> = Vec::new();
    for chunk in targets.chunks(CHANNEL_CHUNK) {
        let fetches = chunk.iter().map(|sub| check_channel(&client, pool, sub));
        for result in futures_util::future::join_all(fetches).await {
            match result {
                Ok(Some(entry)) => pending.push(entry),
                Ok(None) => {}
                Err(error) => tracing::warn!(%error, "Subscription channel check failed"),
            }
        }
    }

    if pending.is_empty() {
        return Ok(0);
    }

    let created_at = now_millis();
    let mut created: Vec<db::notifications::NotificationRecord> = Vec::with_capacity(pending.len());
    for entry in &pending {
        let record = db::notifications::NewNotification {
            video_id: entry.video_id.clone(),
            title: entry.title.clone(),
            channel_id: Some(entry.channel_id.clone()),
            channel_name: entry.channel_name.clone(),
            thumbnail_url: entry.thumbnail_url.clone(),
            published_text: entry.published_text.clone(),
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
                kind: "NEW_VIDEO".to_string(),
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
    post_native_toast(app, &client, &pending).await;

    Ok(created.len())
}

/// Spawns the resident poll loop. Reads the interval from settings each cycle so
/// changes take effect on the next pass without a restart.
pub fn spawn_poll_loop(app: AppHandle, pool: sqlx::SqlitePool) {
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
