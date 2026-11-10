//! A rough first fill of the ledger from watch history, run once when the ledger starts. History
//! keeps one row per video with how far it got, so these figures are estimates, and every month
//! they touch is flagged so the UI can say so. `is_music` keeps video and music apart.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use chrono::DateTime;

use crate::db::watch_history::WatchHistoryRecord;
use crate::recap::model::{
    LedgerMoment, ListenEvent, MONTHS_MAX, MusicMonth, VideoMonth, ViewEvent, ViewFormat,
};
use crate::recap::ops;

/// The shares of a video and of a song that the live ledger counts as a view or a play.
pub const VIDEO_VIEW_FRACTION: f64 = 0.20;
pub const MUSIC_PLAY_FRACTION: f64 = 0.50;
const SHORT_VIEW_SECONDS: i64 = 2;

#[derive(Debug, Default)]
pub struct Backfill {
    pub video: BTreeMap<String, VideoMonth>,
    pub music: BTreeMap<String, MusicMonth>,
    pub seed_channels: BTreeSet<String>,
    pub seed_artists: BTreeSet<String>,
}

fn share(record: &WatchHistoryRecord) -> f64 {
    match record.total_duration_seconds {
        Some(total) if total > 0 => record.watch_duration_seconds as f64 / total as f64,
        _ => 0.0,
    }
}

/// The artist a history row names: music rows join artists with ", ", and a song opened in the
/// video player has its "- Topic" channel.
fn artist_of(channel_name: &str) -> &str {
    let first = channel_name.split(", ").next().unwrap_or(channel_name);
    first.trim_end_matches(" - Topic").trim()
}

fn moment_of(record: &WatchHistoryRecord) -> Option<LedgerMoment> {
    let at = DateTime::parse_from_rfc3339(&record.watch_date).ok()?;
    LedgerMoment::local(at.timestamp_millis())
}

fn fold_video(out: &mut Backfill, record: &WatchHistoryRecord, moment: &LedgerMoment) {
    let channel_id = record.channel_id.as_deref().unwrap_or_default();
    let short = record.is_short_video();
    let event = ViewEvent {
        video_id: record.video_id.clone(),
        title: record.title.clone(),
        channel_id: channel_id.to_string(),
        channel_name: record.channel_name.clone().unwrap_or_default(),
        format: Some(if short {
            ViewFormat::Short
        } else {
            ViewFormat::Long
        }),
        watched_ms: record.watch_duration_seconds.max(0) * 1000,
        counted: if short {
            record.watch_duration_seconds >= SHORT_VIEW_SECONDS
        } else {
            share(record) >= VIDEO_VIEW_FRACTION
        },
        ..Default::default()
    };
    let month = out.video.entry(moment.month_key.clone()).or_default();
    let mut known: HashSet<String> = HashSet::from([channel_id.to_string()]);
    ops::record_view(month, &mut known, moment, &event, &[]);
}

fn fold_music(out: &mut Backfill, record: &WatchHistoryRecord, moment: &LedgerMoment) {
    let name = artist_of(record.channel_name.as_deref().unwrap_or_default());
    let key = name.to_lowercase();
    if key.is_empty() {
        return;
    }
    let event = ListenEvent {
        track_id: record.video_id.clone(),
        title: record.title.clone(),
        artist_name: name.to_string(),
        listened_ms: record.watch_duration_seconds.max(0) * 1000,
        counted: share(record) >= MUSIC_PLAY_FRACTION,
        ..Default::default()
    };
    let month = out.music.entry(moment.month_key.clone()).or_default();
    let mut known: HashSet<String> = HashSet::from([key.clone()]);
    ops::record_listen(month, &mut known, moment, &key, &event);
    out.seed_artists.insert(key);
}

/// Folds `history` month by month. Nothing it holds counts as a discovery: these channels and
/// artists were all met before the ledger started.
#[must_use]
pub fn fold(history: &[WatchHistoryRecord]) -> Backfill {
    let mut out = Backfill::default();
    for record in history {
        let Some(moment) = moment_of(record) else {
            continue;
        };
        if record.is_music {
            fold_music(&mut out, record, &moment);
        } else {
            if let Some(channel) = record.channel_id.as_deref().filter(|id| !id.is_empty()) {
                out.seed_channels.insert(channel.to_string());
            }
            fold_video(&mut out, record, &moment);
        }
    }
    keep_newest(&mut out.video);
    keep_newest(&mut out.music);
    out
}

fn keep_newest<M>(months: &mut BTreeMap<String, M>) {
    while months.len() > MONTHS_MAX {
        months.pop_first();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, music: bool, watched: i64, total: i64) -> WatchHistoryRecord {
        WatchHistoryRecord {
            id: None,
            video_id: id.into(),
            title: format!("{id} title"),
            channel_name: Some("Some Artist, Other".into()),
            channel_id: Some("UCc".into()),
            watch_date: "2026-03-15T12:00:00+00:00".into(),
            watch_duration_seconds: watched,
            total_duration_seconds: Some(total),
            is_music: music,
            is_short: false,
        }
    }

    #[test]
    fn video_and_music_rows_never_share_a_ledger() {
        let out = fold(&[row("v", false, 100, 200), row("s", true, 150, 200)]);
        let video = out.video.values().next().unwrap();
        let music = out.music.values().next().unwrap();
        assert_eq!(video.views, 1);
        assert!(video.video_views.contains_key("v"));
        assert!(!video.video_views.contains_key("s"));
        assert_eq!(music.plays, 1);
        assert!(music.track_plays.contains_key("s"));
        assert!(!music.track_plays.contains_key("v"));
        assert_eq!(music.artist_names["some artist"], "Some Artist");
    }

    #[test]
    fn nothing_folded_is_a_discovery_and_short_shares_only_add_time() {
        let out = fold(&[row("v", false, 10, 200), row("s", true, 50, 200)]);
        let video = out.video.values().next().unwrap();
        let music = out.music.values().next().unwrap();
        assert_eq!(video.views, 0);
        assert_eq!(video.watched_ms, 10_000);
        assert!(video.discovered_channels.is_empty());
        assert_eq!(music.plays, 0);
        assert_eq!(music.listened_ms, 50_000);
        assert!(music.discovered_artists.is_empty());
        assert!(out.seed_channels.contains("UCc"));
        assert!(out.seed_artists.contains("some artist"));
    }

    #[test]
    fn a_row_with_an_unreadable_date_is_left_out() {
        let mut bad = row("v", false, 100, 200);
        bad.watch_date = "last week".into();
        let out = fold(&[bad]);
        assert!(out.video.is_empty());
    }

    #[test]
    fn a_topic_channel_reads_as_its_artist() {
        assert_eq!(artist_of("Daft Punk - Topic"), "Daft Punk");
    }
}
