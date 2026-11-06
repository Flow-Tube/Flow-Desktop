//! The ledger's tables. Months are read and written whole as JSON under one lock, so two windows
//! flushing together can't lose each other's counts. Writes are batched by the frontend.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;
use tokio::sync::Mutex;

use crate::db::watch_history::WatchHistoryRecord;
use crate::errors::{AppError, AppResult};
use crate::music_brain::model::artist_key;
use crate::recap::backfill;
use crate::recap::model::{
    DislikedVideo, LedgerMoment, MONTHS_MAX, MusicMonth, MusicSnapshot, RecapBackup, RecapEntry,
    VideoMonth, VideoSnapshot,
};
use crate::recap::ops;

const VIDEO: &str = "video";
const MUSIC: &str = "music";
pub const BACKUP_VERSION: u32 = 1;

static LEDGER: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn encode<T: Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|e| AppError::Internal(e.to_string()))
}

fn decode<T: DeserializeOwned + Default>(raw: &str) -> T {
    serde_json::from_str(raw).unwrap_or_default()
}

async fn started_at(pool: &SqlitePool) -> AppResult<Option<i64>> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT started_at FROM recap_state WHERE id = 1")
            .fetch_optional(pool)
            .await?,
    )
}

/// Empties the ledger; it starts again from what history holds next time it's read.
pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    let _guard = LEDGER.lock().await;
    let mut tx = pool.begin().await?;
    for statement in [
        "DELETE FROM recap_months",
        "DELETE FROM recap_known",
        "DELETE FROM recap_state",
    ] {
        sqlx::query(statement).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// When the ledger started; what it holds from before then is an estimate. Starts it if needed.
pub async fn ensure_started(
    pool: &SqlitePool,
    seen_artists: &[String],
    now_ms: i64,
) -> AppResult<i64> {
    let _guard = LEDGER.lock().await;
    start_locked(pool, seen_artists, now_ms).await
}

async fn start_locked(pool: &SqlitePool, seen_artists: &[String], now_ms: i64) -> AppResult<i64> {
    if let Some(at) = started_at(pool).await? {
        return Ok(at);
    }
    let history: Vec<WatchHistoryRecord> = sqlx::query_as(
        "SELECT id, video_id, title, channel_name, channel_id, watch_date, watch_duration_seconds,
                total_duration_seconds, is_music, is_short
         FROM watch_history",
    )
    .fetch_all(pool)
    .await?;
    let fill = backfill::fold(&history);

    let mut tx = pool.begin().await?;
    sqlx::query("INSERT OR REPLACE INTO recap_state (id, started_at) VALUES (1, ?)")
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;
    for (month, record) in &fill.video {
        write_month(&mut tx, VIDEO, month, &encode(record)?, true).await?;
    }
    for (month, record) in &fill.music {
        write_month(&mut tx, MUSIC, month, &encode(record)?, true).await?;
    }
    for channel in &fill.seed_channels {
        write_known(&mut tx, VIDEO, channel).await?;
    }
    for artist in fill.seed_artists.iter().chain(seen_artists) {
        write_known(&mut tx, MUSIC, artist).await?;
    }
    tx.commit().await?;
    Ok(now_ms)
}

/// `upsert` keeps a month's estimate flag when later live data lands in it.
async fn write_month(
    tx: &mut sqlx::SqliteConnection,
    source: &str,
    month: &str,
    record: &str,
    estimated: bool,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO recap_months (source, month, record, estimated) VALUES (?, ?, ?, ?)
         ON CONFLICT(source, month) DO UPDATE SET
             record = excluded.record,
             estimated = recap_months.estimated OR excluded.estimated",
    )
    .bind(source)
    .bind(month)
    .bind(record)
    .bind(estimated)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

async fn write_known(tx: &mut sqlx::SqliteConnection, source: &str, key: &str) -> AppResult<()> {
    sqlx::query("INSERT OR IGNORE INTO recap_known (source, key) VALUES (?, ?)")
        .bind(source)
        .bind(key)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn read_month<T: DeserializeOwned + Default>(
    pool: &SqlitePool,
    source: &str,
    month: &str,
) -> AppResult<T> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT record FROM recap_months WHERE source = ? AND month = ?")
            .bind(source)
            .bind(month)
            .fetch_optional(pool)
            .await?;
    Ok(raw.as_deref().map(decode).unwrap_or_default())
}

async fn read_known(pool: &SqlitePool, source: &str) -> AppResult<HashSet<String>> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT key FROM recap_known WHERE source = ?")
        .bind(source)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}

/// What a batch changed, in memory until it is written whole.
#[derive(Default)]
struct Pending {
    video: BTreeMap<String, VideoMonth>,
    music: BTreeMap<String, MusicMonth>,
}

impl Pending {
    async fn video_month(&mut self, pool: &SqlitePool, key: &str) -> AppResult<&mut VideoMonth> {
        if !self.video.contains_key(key) {
            self.video
                .insert(key.to_string(), read_month(pool, VIDEO, key).await?);
        }
        Ok(self.video.entry(key.to_string()).or_default())
    }

    async fn music_month(&mut self, pool: &SqlitePool, key: &str) -> AppResult<&mut MusicMonth> {
        if !self.music.contains_key(key) {
            self.music
                .insert(key.to_string(), read_month(pool, MUSIC, key).await?);
        }
        Ok(self.music.entry(key.to_string()).or_default())
    }

    async fn clear_queries(&mut self, pool: &SqlitePool) -> AppResult<()> {
        let months: Vec<String> =
            sqlx::query_scalar("SELECT month FROM recap_months WHERE source = ?")
                .bind(VIDEO)
                .fetch_all(pool)
                .await?;
        for key in months {
            self.video_month(pool, &key).await?;
        }
        for month in self.video.values_mut() {
            month.queries.clear();
        }
        Ok(())
    }
}

/// Applies one queued batch atomically. `topics` holds, per video id, what a counted view adds to
/// the month's topics.
pub async fn apply_batch(
    pool: &SqlitePool,
    entries: &[RecapEntry],
    topics: &HashMap<String, Vec<String>>,
    seen_artists: &[String],
    now_ms: i64,
) -> AppResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let _guard = LEDGER.lock().await;
    start_locked(pool, seen_artists, now_ms).await?;

    let known_channels = read_known(pool, VIDEO).await?;
    let known_artists = read_known(pool, MUSIC).await?;
    let mut channels = known_channels.clone();
    let mut artists = known_artists.clone();
    let mut pending = Pending::default();

    for entry in entries {
        if matches!(entry, RecapEntry::QueriesCleared) {
            pending.clear_queries(pool).await?;
            continue;
        }
        let Some(moment) = entry.at_ms().and_then(LedgerMoment::local) else {
            continue;
        };
        let key = moment.month_key.as_str();
        match entry {
            RecapEntry::View { event, .. } => {
                let month = pending.video_month(pool, key).await?;
                let read = topics.get(&event.video_id).map_or(&[][..], Vec::as_slice);
                ops::record_view(month, &mut channels, &moment, event, read);
            }
            RecapEntry::Listen { event, .. } => {
                let artist = artist_key(event.artist_id.as_deref(), &event.artist_name);
                let month = pending.music_month(pool, key).await?;
                ops::record_listen(month, &mut artists, &moment, &artist, event);
            }
            RecapEntry::Dislike {
                at_ms,
                video_id,
                title,
                channel_name,
            } => {
                let video = DislikedVideo {
                    video_id: video_id.clone(),
                    title: title.clone(),
                    channel_name: channel_name.clone(),
                    at: *at_ms,
                };
                ops::record_dislike(pending.video_month(pool, key).await?, video);
            }
            RecapEntry::DislikeRemoved { video_id, .. } => {
                ops::clear_dislike(pending.video_month(pool, key).await?, video_id);
            }
            RecapEntry::Action { action, .. } => {
                ops::record_action(pending.video_month(pool, key).await?, *action);
            }
            RecapEntry::Search { query, .. } => {
                ops::record_search(pending.video_month(pool, key).await?, query.as_deref());
            }
            RecapEntry::SponsorSkip {
                category,
                skipped_ms,
                ..
            } => {
                let month = pending.video_month(pool, key).await?;
                ops::record_sponsor_skip(month, category, *skipped_ms);
            }
            RecapEntry::ArtistSaidNo {
                at_ms,
                artist_id,
                artist_name,
                blocked,
            } => {
                let artist = artist_key(artist_id.as_deref(), artist_name);
                let month = pending.music_month(pool, key).await?;
                ops::record_said_no(month, *at_ms, &artist, artist_name, *blocked);
            }
            RecapEntry::QueriesCleared => {}
        }
    }

    write_batch(
        pool,
        &pending,
        channels.difference(&known_channels),
        artists.difference(&known_artists),
    )
    .await
}

/// Saves what a batch changed. Its reads ran before this, outside the transaction: it starts with
/// a write, so it waits its turn on the database instead of failing to upgrade from a read.
async fn write_batch(
    pool: &SqlitePool,
    pending: &Pending,
    new_channels: impl Iterator<Item = &String>,
    new_artists: impl Iterator<Item = &String>,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for (key, month) in &pending.video {
        write_month(&mut tx, VIDEO, key, &encode(month)?, false).await?;
    }
    for (key, month) in &pending.music {
        write_month(&mut tx, MUSIC, key, &encode(month)?, false).await?;
    }
    for channel in new_channels {
        write_known(&mut tx, VIDEO, channel).await?;
    }
    for artist in new_artists {
        write_known(&mut tx, MUSIC, artist).await?;
    }
    for source in [VIDEO, MUSIC] {
        sqlx::query(
            "DELETE FROM recap_months WHERE source = ? AND month NOT IN (
                 SELECT month FROM recap_months WHERE source = ? ORDER BY month DESC LIMIT ?)",
        )
        .bind(source)
        .bind(source)
        .bind(i64::try_from(MONTHS_MAX).unwrap_or(i64::MAX))
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Every month of one source, with whether it includes an estimate, oldest first.
pub async fn read_months<T: DeserializeOwned + Default>(
    pool: &SqlitePool,
    video: bool,
) -> AppResult<Vec<(String, T, bool)>> {
    let source = if video { VIDEO } else { MUSIC };
    let rows: Vec<(String, String, bool)> = sqlx::query_as(
        "SELECT month, record, estimated FROM recap_months WHERE source = ? ORDER BY month",
    )
    .bind(source)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(month, record, estimated)| (month, decode(&record), estimated))
        .collect())
}

/// The months the ledger holds, newest first, each with how many views and plays it counted.
pub async fn month_activity(pool: &SqlitePool) -> AppResult<Vec<(String, i64)>> {
    let mut activity: BTreeMap<String, i64> = BTreeMap::new();
    for (month, record, _) in read_months::<VideoMonth>(pool, true).await? {
        *activity.entry(month).or_insert(0) += record.views;
    }
    for (month, record, _) in read_months::<MusicMonth>(pool, false).await? {
        *activity.entry(month).or_insert(0) += record.plays;
    }
    Ok(activity.into_iter().rev().collect())
}

/// Distinct videos per channel from watch history, most first; music rows stay out.
pub async fn history_channels(
    pool: &SqlitePool,
    limit: i64,
) -> AppResult<Vec<(String, String, i64)>> {
    Ok(sqlx::query_as(
        "SELECT channel_id, COALESCE(MAX(channel_name), ''), COUNT(DISTINCT video_id) AS videos
         FROM watch_history
         WHERE is_music = 0 AND channel_id IS NOT NULL AND channel_id != ''
         GROUP BY channel_id
         ORDER BY videos DESC, channel_id
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// The whole ledger for a master backup.
pub async fn export(pool: &SqlitePool) -> AppResult<RecapBackup> {
    let _guard = LEDGER.lock().await;
    let mut backup = RecapBackup {
        version: BACKUP_VERSION,
        started_at: started_at(pool).await?.unwrap_or_default(),
        ..Default::default()
    };
    for (month, record, estimated) in read_months::<VideoMonth>(pool, true).await? {
        if estimated {
            backup.estimated.push(format!("{VIDEO}/{month}"));
        }
        backup.video.months.insert(month, record);
    }
    for (month, record, estimated) in read_months::<MusicMonth>(pool, false).await? {
        if estimated {
            backup.estimated.push(format!("{MUSIC}/{month}"));
        }
        backup.music.months.insert(month, record);
    }
    backup.video.seed_channels = sorted(read_known(pool, VIDEO).await?);
    backup.music.seed_artists = sorted(read_known(pool, MUSIC).await?);
    Ok(backup)
}

fn sorted(keys: HashSet<String>) -> Vec<String> {
    let mut keys: Vec<String> = keys.into_iter().collect();
    keys.sort();
    keys
}

/// Puts a backup's ledger in place of this one's: restoring a device's own backup must not double
/// every count. Returns how many months it holds.
pub async fn restore(pool: &SqlitePool, backup: &RecapBackup, now_ms: i64) -> AppResult<u64> {
    // This one's history can still fill its own.
    if backup.never_started() {
        return Ok(0);
    }
    let _guard = LEDGER.lock().await;
    let VideoSnapshot {
        months: video,
        seed_channels,
    } = &backup.video;
    let MusicSnapshot {
        months: music,
        seed_artists,
    } = &backup.music;
    let estimated: HashSet<&str> = backup.estimated.iter().map(String::as_str).collect();
    let started = if backup.started_at > 0 {
        backup.started_at
    } else {
        now_ms
    };

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM recap_months")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM recap_known")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT OR REPLACE INTO recap_state (id, started_at) VALUES (1, ?)")
        .bind(started)
        .execute(&mut *tx)
        .await?;
    for (month, record) in video {
        let flagged = estimated.contains(format!("{VIDEO}/{month}").as_str());
        write_month(&mut tx, VIDEO, month, &encode(record)?, flagged).await?;
        for channel in record.channel_views.keys() {
            write_known(&mut tx, VIDEO, channel).await?;
        }
    }
    for (month, record) in music {
        let flagged = estimated.contains(format!("{MUSIC}/{month}").as_str());
        write_month(&mut tx, MUSIC, month, &encode(record)?, flagged).await?;
        for artist in record.artist_plays.keys() {
            write_known(&mut tx, MUSIC, artist).await?;
        }
    }
    for channel in seed_channels {
        write_known(&mut tx, VIDEO, channel).await?;
    }
    for artist in seed_artists {
        write_known(&mut tx, MUSIC, artist).await?;
    }
    tx.commit().await?;
    Ok((video.len() + music.len()) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recap::model::{ListenEvent, ViewEvent, ViewFormat};

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn now() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn view(id: &str, channel: &str, counted: bool) -> RecapEntry {
        RecapEntry::View {
            at_ms: now(),
            event: ViewEvent {
                video_id: id.into(),
                channel_id: channel.into(),
                channel_name: "Name".into(),
                format: Some(ViewFormat::Long),
                watched_ms: 5_000,
                counted,
                ..Default::default()
            },
        }
    }

    fn listen(id: &str, artist: &str) -> RecapEntry {
        RecapEntry::Listen {
            at_ms: now(),
            event: ListenEvent {
                track_id: id.into(),
                artist_name: artist.into(),
                listened_ms: 7_000,
                counted: true,
                ..Default::default()
            },
        }
    }

    async fn add_history(pool: &SqlitePool, id: &str, music: bool) {
        sqlx::query(
            "INSERT INTO watch_history (video_id, title, channel_name, channel_id, watch_date,
                 watch_duration_seconds, total_duration_seconds, is_music)
             VALUES (?, 't', 'Old Channel', 'UCold', '2026-01-10T10:00:00+00:00', 100, 200, ?)",
        )
        .bind(id)
        .bind(music)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_batch_lands_in_its_own_source_and_month() {
        let pool = pool().await;
        let topics = HashMap::from([("v".to_string(), vec!["Rust".to_string()])]);
        apply_batch(
            &pool,
            &[view("v", "c", true), listen("s", "Artist")],
            &topics,
            &[],
            now(),
        )
        .await
        .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        let music = read_months::<MusicMonth>(&pool, false).await.unwrap();
        assert_eq!(video.len(), 1);
        assert_eq!(video[0].1.views, 1);
        assert_eq!(video[0].1.topic_views["Rust"], 1);
        assert!(!video[0].2);
        assert_eq!(music[0].1.plays, 1);
        assert_eq!(music[0].1.listened_ms, 7_000);
        assert!(music[0].1.track_plays.contains_key("s"));
    }

    #[tokio::test]
    async fn a_channel_is_a_discovery_once_across_batches() {
        let pool = pool().await;
        let none = HashMap::new();
        apply_batch(&pool, &[view("a", "c", true)], &none, &[], now())
            .await
            .unwrap();
        apply_batch(&pool, &[view("b", "c", true)], &none, &[], now())
            .await
            .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert_eq!(video[0].1.discovered_channels.len(), 1);
        assert_eq!(video[0].1.views, 2);
        let known = read_known(&pool, VIDEO).await.unwrap();
        assert!(known.contains("c"));
    }

    #[tokio::test]
    async fn starting_folds_history_once_flagged_as_an_estimate() {
        let pool = pool().await;
        add_history(&pool, "old", false).await;
        add_history(&pool, "song", true).await;
        ensure_started(&pool, &["seen".to_string()], 1_000)
            .await
            .unwrap();
        add_history(&pool, "later", false).await;
        assert_eq!(ensure_started(&pool, &[], 2_000).await.unwrap(), 1_000);

        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        let music = read_months::<MusicMonth>(&pool, false).await.unwrap();
        assert_eq!(video.len(), 1);
        assert!(video[0].2);
        assert_eq!(video[0].1.views, 1);
        assert_eq!(music[0].1.plays, 1);
        assert!(!video[0].1.video_views.contains_key("song"));
        assert!(read_known(&pool, MUSIC).await.unwrap().contains("seen"));
        assert!(read_known(&pool, VIDEO).await.unwrap().contains("UCold"));
    }

    #[tokio::test]
    async fn an_old_channel_met_again_is_not_a_discovery() {
        let pool = pool().await;
        add_history(&pool, "old", false).await;
        apply_batch(
            &pool,
            &[view("new", "UCold", true)],
            &HashMap::new(),
            &[],
            now(),
        )
        .await
        .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert!(
            video
                .iter()
                .all(|(_, m, _)| m.discovered_channels.is_empty())
        );
    }

    #[tokio::test]
    async fn live_data_keeps_a_months_estimate_flag() {
        let pool = pool().await;
        let at = now();
        let date = chrono::DateTime::from_timestamp_millis(at)
            .unwrap()
            .to_rfc3339();
        sqlx::query(
            "INSERT INTO watch_history (video_id, title, channel_id, watch_date,
                 watch_duration_seconds, total_duration_seconds)
             VALUES ('old', 't', 'UCold', ?, 100, 200)",
        )
        .bind(date)
        .execute(&pool)
        .await
        .unwrap();
        apply_batch(&pool, &[view("new", "c", true)], &HashMap::new(), &[], at)
            .await
            .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert!(video.last().unwrap().2);
        assert_eq!(video.last().unwrap().1.views, 2);
    }

    #[tokio::test]
    async fn clearing_queries_forgets_every_month() {
        let pool = pool().await;
        let at = now();
        let search = RecapEntry::Search {
            at_ms: at,
            query: Some("lofi".into()),
        };
        apply_batch(&pool, &[search], &HashMap::new(), &[], at)
            .await
            .unwrap();
        apply_batch(
            &pool,
            &[RecapEntry::QueriesCleared],
            &HashMap::new(),
            &[],
            at,
        )
        .await
        .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert!(video[0].1.queries.is_empty());
        assert_eq!(video[0].1.actions.len(), 1);
    }

    #[tokio::test]
    async fn activity_counts_views_and_plays_newest_month_first() {
        let pool = pool().await;
        let mut backup = RecapBackup::default();
        backup.video.months.insert(
            "2026-01".into(),
            VideoMonth {
                views: 2,
                ..Default::default()
            },
        );
        backup.video.months.insert(
            "2026-02".into(),
            VideoMonth {
                views: 1,
                ..Default::default()
            },
        );
        backup.music.months.insert(
            "2026-02".into(),
            MusicMonth {
                plays: 3,
                ..Default::default()
            },
        );
        restore(&pool, &backup, 1).await.unwrap();
        assert_eq!(
            month_activity(&pool).await.unwrap(),
            vec![("2026-02".to_string(), 4), ("2026-01".to_string(), 2)]
        );
    }

    #[tokio::test]
    async fn history_channels_leave_music_out() {
        let pool = pool().await;
        add_history(&pool, "a", false).await;
        add_history(&pool, "b", false).await;
        add_history(&pool, "song", true).await;
        assert_eq!(
            history_channels(&pool, 10).await.unwrap(),
            vec![("UCold".to_string(), "Old Channel".to_string(), 2)]
        );
    }

    #[tokio::test]
    async fn restore_replaces_rather_than_adds() {
        let pool = pool().await;
        add_history(&pool, "old", false).await;
        apply_batch(&pool, &[view("v", "c", true)], &HashMap::new(), &[], now())
            .await
            .unwrap();
        let backup = export(&pool).await.unwrap();
        assert_eq!(backup.version, BACKUP_VERSION);
        assert!(!backup.estimated.is_empty());
        restore(&pool, &backup, now()).await.unwrap();
        let again = export(&pool).await.unwrap();
        assert_eq!(again, backup);
    }

    #[tokio::test]
    async fn a_backup_with_no_ledger_leaves_this_ones_estimate_to_come() {
        let pool = pool().await;
        add_history(&pool, "old", false).await;
        assert_eq!(restore(&pool, &RecapBackup::default(), 1).await.unwrap(), 0);
        ensure_started(&pool, &[], 2_000).await.unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert_eq!(video.len(), 1);
    }

    #[tokio::test]
    async fn months_beyond_the_cap_are_dropped_oldest_first() {
        let pool = pool().await;
        let mut backup = RecapBackup::default();
        for i in 0..40 {
            let key = format!("20{i:02}-01");
            backup.video.months.insert(key, VideoMonth::default());
        }
        restore(&pool, &backup, now()).await.unwrap();
        apply_batch(&pool, &[view("v", "c", true)], &HashMap::new(), &[], now())
            .await
            .unwrap();
        let video = read_months::<VideoMonth>(&pool, true).await.unwrap();
        assert_eq!(video.len(), MONTHS_MAX);
        assert_eq!(video[0].0, "2005-01");
    }
}
