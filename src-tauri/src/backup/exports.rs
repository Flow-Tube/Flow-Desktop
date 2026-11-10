//! The two exports meant for other apps: watch history in Google Takeout's JSON shape, and
//! subscriptions in NewPipe's import format.

use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::sync::canonical::{Collection, SubscribedChannel, WatchHistoryRecord};
use crate::sync::error::SyncError;
use crate::sync::export::export_collections;
use crate::sync::ledger;

const YOUTUBE_SERVICE_ID: u32 = 0;

fn iso_instant(ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(i64::try_from(ms).unwrap_or(0))
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn is_channel_id(id: &str) -> bool {
    id.len() == 24
        && id.starts_with("UC")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn is_handle(id: &str) -> bool {
    id.strip_prefix('@').is_some_and(|handle| {
        !handle.is_empty()
            && handle.chars().count() <= 100
            && handle
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '.' || c == '-')
    })
}

/// A channel id as a link NewPipe can open: it decodes strictly, so anything else is left out.
fn channel_url(id: &str) -> Option<String> {
    let id = id.trim();
    if is_channel_id(id) {
        Some(format!("https://www.youtube.com/channel/{id}"))
    } else if is_handle(id) {
        Some(format!("https://www.youtube.com/{id}"))
    } else {
        None
    }
}

async fn records<T: serde::de::DeserializeOwned>(
    pool: &SqlitePool,
    collection: Collection,
) -> Result<Vec<T>, SyncError> {
    let device_id = ledger::get_or_create_device_id(pool).await?;
    let outgoing = export_collections(pool, &device_id, &[collection]).await?;
    Ok(outgoing
        .iter()
        .flat_map(|part| part.ndjson.split(|&byte| byte == b'\n'))
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_slice(line).ok())
        .collect())
}

fn history_to_takeout(records: &[WatchHistoryRecord]) -> Value {
    let mut live: Vec<&WatchHistoryRecord> = records
        .iter()
        .filter(|record| !record.deleted && !record.video_id.trim().is_empty())
        .collect();
    live.sort_by_key(|record| std::cmp::Reverse(record.watched_at_ms));
    let items: Vec<Value> = live
        .into_iter()
        .map(|record| {
            let channel_url = record
                .channel_id
                .as_deref()
                .filter(|id| is_channel_id(id.trim()))
                .map_or_else(
                    || "https://www.youtube.com/".to_string(),
                    |id| format!("https://www.youtube.com/channel/{}", id.trim()),
                );
            let name = record
                .channel_name
                .as_deref()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or("YouTube");
            json!({
                "header": "YouTube",
                "title": format!("Watched {}", record.title),
                "titleUrl": format!("https://www.youtube.com/watch?v={}", record.video_id.trim()),
                "subtitles": [{ "name": name, "url": channel_url }],
                "time": iso_instant(record.watched_at_ms),
                "products": ["YouTube"],
                "activityControls": ["YouTube watch history"],
            })
        })
        .collect();
    Value::Array(items)
}

pub async fn watch_history(pool: &SqlitePool) -> Result<Value, SyncError> {
    let rows: Vec<WatchHistoryRecord> = records(pool, Collection::WatchHistory).await?;
    Ok(history_to_takeout(&rows))
}

/// The file and how many channels NewPipe couldn't open, so the viewer can be told.
fn channels_to_newpipe(channels: &[SubscribedChannel]) -> (Value, usize) {
    let live: Vec<&SubscribedChannel> = channels.iter().filter(|c| !c.deleted).collect();
    let items: Vec<Value> = live
        .iter()
        .filter_map(|channel| {
            let url = channel_url(&channel.channel_id)?;
            let name = if channel.name.trim().is_empty() {
                channel.channel_id.trim()
            } else {
                channel.name.as_str()
            };
            Some(json!({ "service_id": YOUTUBE_SERVICE_ID, "url": url, "name": name }))
        })
        .collect();
    let skipped = live.len() - items.len();
    (
        json!({
            "app_version": env!("CARGO_PKG_VERSION"),
            "app_version_int": 1,
            "subscriptions": items,
        }),
        skipped,
    )
}

pub async fn newpipe_subscriptions(pool: &SqlitePool) -> Result<(Value, usize), SyncError> {
    let channels: Vec<SubscribedChannel> = records(pool, Collection::SubscribedChannels).await?;
    Ok(channels_to_newpipe(&channels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_uses_takeouts_shape_newest_first() {
        let rows = [
            WatchHistoryRecord {
                video_id: "older".into(),
                title: "Old".into(),
                watched_at_ms: 1_000,
                ..WatchHistoryRecord::default()
            },
            WatchHistoryRecord {
                video_id: "newer".into(),
                title: "New".into(),
                channel_id: Some("UCaaaaaaaaaaaaaaaaaaaaaa".into()),
                channel_name: Some("Chan".into()),
                watched_at_ms: 2_000,
                ..WatchHistoryRecord::default()
            },
            WatchHistoryRecord {
                video_id: "gone".into(),
                deleted: true,
                ..WatchHistoryRecord::default()
            },
        ];
        let file = history_to_takeout(&rows);
        assert_eq!(file.as_array().unwrap().len(), 2);
        assert_eq!(file[0]["title"], "Watched New");
        assert_eq!(file[0]["titleUrl"], "https://www.youtube.com/watch?v=newer");
        assert_eq!(
            file[0]["subtitles"][0]["url"],
            "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(file[0]["time"], "1970-01-01T00:00:02.000Z");
        assert_eq!(file[1]["subtitles"][0]["url"], "https://www.youtube.com/");
        assert_eq!(file[1]["subtitles"][0]["name"], "YouTube");
    }

    #[test]
    fn newpipe_gets_only_channels_it_can_open() {
        let channel = |id: &str, name: &str| SubscribedChannel {
            channel_id: id.into(),
            name: name.into(),
            ..SubscribedChannel::default()
        };
        let channels = [
            channel("UCaaaaaaaaaaaaaaaaaaaaaa", "Id"),
            channel("@handle", ""),
            channel("not a channel", "Skipped"),
            SubscribedChannel {
                deleted: true,
                ..channel("UCbbbbbbbbbbbbbbbbbbbbbb", "Gone")
            },
        ];
        let (file, skipped) = channels_to_newpipe(&channels);
        assert_eq!(skipped, 1);
        let subs = file["subscriptions"].as_array().unwrap();
        assert_eq!(subs.len(), 2);
        assert_eq!(subs[0]["service_id"], 0);
        assert_eq!(subs[1]["url"], "https://www.youtube.com/@handle");
        assert_eq!(subs[1]["name"], "@handle");
        assert_eq!(
            subs[0].as_object().unwrap().len(),
            3,
            "NewPipe decodes strictly"
        );
    }
}
