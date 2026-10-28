//! One-time warm start: seed the `MusicBrain` from the user's existing music watch
//! history (`watch_history WHERE is_music = 1`) so day-one recommendations are not cold.
//!
//! Limitation: history rows carry no artist id and
//! no intra-session ordering, so artists are keyed by name and co-occurrence cannot be
//! reconstructed — it warms up over subsequent live sessions instead.

use sqlx::SqlitePool;

use crate::db::settings;
use crate::db::watch_history::get_music_history;
use crate::errors::AppResult;

use super::learn::{MusicSignal, apply_music_signal, newly_crossed};
use super::model::MusicBrain;

const BACKFILL_FLAG: &str = "music_brain_backfilled";
const BACKFILL_MAX_ROWS: i64 = 3000;

/// Runs once (guarded by a settings flag). Idempotent across restarts.
pub async fn backfill_if_needed(pool: &SqlitePool, brain: &mut MusicBrain) -> AppResult<()> {
    if settings::get_setting(pool, BACKFILL_FLAG).await?.as_deref() == Some("1") {
        return Ok(());
    }

    let rows = get_music_history(pool, BACKFILL_MAX_ROWS, 0).await?;
    // History is newest-first; replay oldest-first so ring buffers keep the newest plays.
    for row in rows.iter().rev() {
        let Some(artist_key) = primary_artist_key(row.channel_name.as_deref()) else {
            continue;
        };
        let total = row.total_duration_seconds.unwrap_or(0).max(0);
        let pct = if total > 0 {
            (row.watch_duration_seconds as f32 / total as f32).clamp(0.0, 1.0)
        } else {
            // Unknown duration: assume a real listen (history implies the user played it).
            0.6
        };
        let ts = parse_ts(&row.watch_date);
        let crossed = newly_crossed(0.0, pct);
        if crossed.is_empty() {
            continue;
        }
        // Original-cased primary artist for display (history has no thumbnail).
        let artist_display = row
            .channel_name
            .as_deref()
            .and_then(|c| c.split(',').next())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let sig = MusicSignal {
            track_id: row.video_id.clone(),
            artist_key: artist_key.clone(),
            genre: None,
            is_explicit_like: false,
            title: Some(row.title.clone()),
            artist_display,
            thumbnail: None,
        };
        apply_music_signal(brain, &sig, &crossed, ts, None);
    }

    settings::set_setting(pool, BACKFILL_FLAG, "1").await?;
    Ok(())
}

/// `channel_name` is a ", "-joined artist list; the first name is the primary artist.
fn primary_artist_key(channel_name: Option<&str>) -> Option<String> {
    let name = channel_name?.split(',').next()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_lowercase())
    }
}

fn parse_ts(watch_date: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(watch_date)
        .map(|dt| dt.timestamp_millis() as u64)
        .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_artist_key_takes_first_and_normalizes() {
        assert_eq!(
            primary_artist_key(Some("The Weeknd, Daft Punk")),
            Some("the weeknd".to_string())
        );
        assert_eq!(primary_artist_key(Some("  ")), None);
        assert_eq!(primary_artist_key(None), None);
    }
}
