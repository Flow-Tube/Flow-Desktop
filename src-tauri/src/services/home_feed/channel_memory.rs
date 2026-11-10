//! Channels the viewer keeps watching without subscribing, and their latest uploads, from Flow
//! for Android's `ChannelMemory`. Engagement comes from watch history and likes; the uploads and
//! the viewer's verdicts are kept in `home_channel_memory`.

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use super::card::Card;
use super::seeds::SeedInput;
use crate::db::settings::{get_setting, set_setting};
use crate::errors::AppResult;

const MIN_REAL_WATCHES: usize = 2;
const HALF_LIFE_DAYS: f64 = 30.0;
const MAX_CHANNELS: usize = 20;
const SCORE_FLOOR: f64 = 0.5;
pub const REFRESH_AFTER_MS: u64 = 6 * 3_600_000;
pub const MAX_REFRESH_PER_LOAD: usize = 10;
const UPLOAD_WINDOW_MS: u64 = 14 * 86_400_000;
const UPLOADS_PER_CHANNEL: usize = 10;
const NOT_INTERESTED_WINDOW_MS: u64 = 14 * 86_400_000;

/// One watch of a channel's video, from watch history.
pub struct Watch {
    pub channel_id: String,
    pub channel_name: String,
    pub watched_at_ms: u64,
    pub watched_seconds: u64,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone)]
pub struct Remembered {
    pub channel_id: String,
    pub name: String,
    pub score: f64,
}

/// The channel memory as stored, with when the viewer last cleared all of it.
#[derive(Debug, Clone, Default)]
pub struct State {
    pub entries: HashMap<String, Entry>,
    /// Watches before this no longer count for any channel.
    pub cleared_at: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Entry {
    pub last_fetched_at: u64,
    pub uploads: Vec<Card>,
    pub rejected_at: u64,
    pub forgotten_at: u64,
}

struct Engagement {
    name: String,
    real_watches: usize,
    watched_seconds: u64,
    likes: usize,
    last_real_watch_at: u64,
}

/// Downloads and recovered files can carry a placeholder channel that would merge unrelated videos.
fn is_youtube_channel(channel_id: &str) -> bool {
    channel_id.starts_with("UC")
}

/// The channels worth remembering: two real watches (or one and a like), not followed, blocked or
/// rejected since the last watch, scored with a 30-day half-life.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn remembered(
    watches: &[Watch],
    likes: &[(String, u64)],
    state: &State,
    subscribed: &HashSet<String>,
    blocked: &HashSet<String>,
    not_interested_at: &HashMap<String, u64>,
    now_ms: u64,
) -> Vec<Remembered> {
    let entries = &state.entries;
    let since = |channel: &str| {
        entries
            .get(channel)
            .map_or(0, |e| e.forgotten_at)
            .max(state.cleared_at)
    };
    let mut engagements: HashMap<&str, Engagement> = HashMap::new();
    for watch in watches {
        let percent = if watch.duration_seconds > 0 {
            watch.watched_seconds as f64 * 100.0 / watch.duration_seconds as f64
        } else {
            0.0
        };
        if !is_youtube_channel(&watch.channel_id)
            || watch.watched_at_ms <= since(&watch.channel_id)
            || !SeedInput::is_real_watch(watch.duration_seconds, percent)
        {
            continue;
        }
        let engagement = engagements.entry(&watch.channel_id).or_insert(Engagement {
            name: String::new(),
            real_watches: 0,
            watched_seconds: 0,
            likes: 0,
            last_real_watch_at: 0,
        });
        engagement.real_watches += 1;
        engagement.watched_seconds += watch.watched_seconds;
        if watch.watched_at_ms >= engagement.last_real_watch_at {
            engagement.last_real_watch_at = watch.watched_at_ms;
            engagement.name.clone_from(&watch.channel_name);
        }
    }
    for (channel, liked_at) in likes {
        if let Some(engagement) = engagements.get_mut(channel.as_str())
            && *liked_at > since(channel)
        {
            engagement.likes += 1;
        }
    }
    let mut out: Vec<Remembered> = engagements
        .into_iter()
        .filter(|(_, e)| {
            e.real_watches >= MIN_REAL_WATCHES || (e.real_watches >= 1 && e.likes >= 1)
        })
        .filter(|(channel, _)| !subscribed.contains(*channel) && !blocked.contains(*channel))
        .filter(|(channel, e)| {
            // A rejection holds until the viewer comes back to the channel.
            let rejected = entries.get(*channel).map_or(0, |entry| entry.rejected_at);
            let not_interested = not_interested_at
                .get(*channel)
                .copied()
                .filter(|at| now_ms.saturating_sub(*at) < NOT_INTERESTED_WINDOW_MS)
                .unwrap_or(0);
            rejected.max(not_interested) <= e.last_real_watch_at
        })
        .map(|(channel, e)| {
            let raw = e.real_watches as f64
                + e.likes as f64
                + (1.0 + e.watched_seconds as f64 / 1800.0).ln();
            let age_days = now_ms.saturating_sub(e.last_real_watch_at) as f64 / 86_400_000.0;
            Remembered {
                channel_id: channel.to_string(),
                name: e.name,
                score: raw * 0.5_f64.powf(age_days / HALF_LIFE_DAYS),
            }
        })
        .filter(|r| r.score >= SCORE_FLOOR)
        .collect();
    out.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.channel_id.cmp(&b.channel_id))
    });
    out.truncate(MAX_CHANNELS);
    out
}

/// The best channels whose uploads are older than the refresh window, at most a load's worth.
#[must_use]
pub fn refresh_queue<'a>(
    remembered: &'a [Remembered],
    entries: &HashMap<String, Entry>,
    now_ms: u64,
) -> Vec<&'a Remembered> {
    remembered
        .iter()
        .filter(|r| {
            now_ms.saturating_sub(entries.get(&r.channel_id).map_or(0, |e| e.last_fetched_at))
                >= REFRESH_AFTER_MS
        })
        .take(MAX_REFRESH_PER_LOAD)
        .collect()
}

/// The stored uploads of `remembered` channels from the last two weeks.
#[must_use]
pub fn uploads(
    remembered: &[Remembered],
    entries: &HashMap<String, Entry>,
    now_ms: u64,
) -> Vec<Card> {
    remembered
        .iter()
        .filter_map(|r| entries.get(&r.channel_id))
        .flat_map(|entry| entry.uploads.iter())
        .filter(|card| {
            card.age_ms(now_ms)
                .is_some_and(|age| age <= UPLOAD_WINDOW_MS)
        })
        .cloned()
        .collect()
}

/// The uploads worth keeping from a channel's Videos tab: newest ten of the last two weeks.
#[must_use]
pub fn keep_uploads(videos: Vec<Card>, now_ms: u64) -> Vec<Card> {
    let mut kept: Vec<Card> = videos
        .into_iter()
        .filter(|card| !card.is_short() && !card.video.is_live)
        .filter(|card| {
            card.age_ms(now_ms)
                .is_some_and(|age| age <= UPLOAD_WINDOW_MS)
        })
        .collect();
    kept.sort_by_key(|card| std::cmp::Reverse(card.published_at_ms));
    kept.truncate(UPLOADS_PER_CHANNEL);
    kept
}

/// Device-local settings key; not in the settings sync allowlist.
const CLEARED_AT_KEY: &str = "home_channel_memory_cleared_at";

pub async fn load(pool: &SqlitePool) -> AppResult<State> {
    let cleared_at = get_setting(pool, CLEARED_AT_KEY)
        .await?
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    Ok(State {
        entries: load_entries(pool).await?,
        cleared_at,
    })
}

async fn load_entries(pool: &SqlitePool) -> AppResult<HashMap<String, Entry>> {
    let rows: Vec<(String, i64, String, i64, i64)> = sqlx::query_as(
        "SELECT channel_id, last_fetched_at, uploads, rejected_at, forgotten_at FROM home_channel_memory",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(channel, fetched, uploads, rejected, forgotten)| {
            let entry = Entry {
                last_fetched_at: u64::try_from(fetched).unwrap_or(0),
                uploads: serde_json::from_str(&uploads).unwrap_or_default(),
                rejected_at: u64::try_from(rejected).unwrap_or(0),
                forgotten_at: u64::try_from(forgotten).unwrap_or(0),
            };
            (channel, entry)
        })
        .collect())
}

/// "Not interested" or a thumbs-down on one of the channel's videos: it is not remembered again
/// until the viewer comes back to it, and its stored uploads go.
pub async fn record_rejection(
    pool: &SqlitePool,
    channel_id: &str,
    name: &str,
    now_ms: u64,
) -> AppResult<()> {
    if channel_id.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO home_channel_memory (channel_id, name, rejected_at, uploads) VALUES (?, ?, ?, '[]')
         ON CONFLICT(channel_id) DO UPDATE SET rejected_at = excluded.rejected_at, uploads = '[]'",
    )
    .bind(channel_id)
    .bind(name)
    .bind(i64::try_from(now_ms).unwrap_or(i64::MAX))
    .execute(pool)
    .await?;
    Ok(())
}

/// The viewer forgot the channel: only watches after now count toward remembering it again.
pub async fn forget(pool: &SqlitePool, channel_id: &str, now_ms: u64) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO home_channel_memory (channel_id, name, forgotten_at, uploads) VALUES (?, '', ?, '[]')
         ON CONFLICT(channel_id) DO UPDATE SET forgotten_at = excluded.forgotten_at, uploads = '[]'",
    )
    .bind(channel_id)
    .bind(i64::try_from(now_ms).unwrap_or(i64::MAX))
    .execute(pool)
    .await?;
    Ok(())
}

/// Forgets every channel at once; rejections stay, so a rejected channel does not come back.
pub async fn clear(pool: &SqlitePool, now_ms: u64) -> AppResult<()> {
    sqlx::query("DELETE FROM home_channel_memory WHERE rejected_at = 0")
        .execute(pool)
        .await?;
    sqlx::query("UPDATE home_channel_memory SET uploads = '[]'")
        .execute(pool)
        .await?;
    set_setting(pool, CLEARED_AT_KEY, &now_ms.to_string()).await
}

pub async fn save_uploads(
    pool: &SqlitePool,
    channel_id: &str,
    name: &str,
    uploads: &[Card],
    now_ms: u64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO home_channel_memory (channel_id, name, last_fetched_at, uploads) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET name = excluded.name,
             last_fetched_at = excluded.last_fetched_at, uploads = excluded.uploads",
    )
    .bind(channel_id)
    .bind(name)
    .bind(i64::try_from(now_ms).unwrap_or(i64::MAX))
    .bind(serde_json::to_string(uploads).unwrap_or_else(|_| "[]".into()))
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watch(channel: &str, at: u64, seconds: u64) -> Watch {
        Watch {
            channel_id: channel.into(),
            channel_name: format!("Name {channel}"),
            watched_at_ms: at,
            watched_seconds: seconds,
            duration_seconds: 600,
        }
    }

    #[test]
    fn two_real_watches_remember_a_channel_unless_followed() {
        let now = 10 * 86_400_000;
        let watches = vec![
            watch("UCa", now - 1000, 550),
            watch("UCa", now - 2000, 500),
            watch("UCb", now - 1000, 550),
            watch("UCc", now - 1000, 500),
            watch("UCc", now - 2000, 30),
            watch("UCs", now - 1000, 550),
            watch("UCs", now - 2000, 550),
        ];
        let subscribed = HashSet::from(["UCs".to_string()]);
        let channels = remembered(
            &watches,
            &[],
            &State::default(),
            &subscribed,
            &HashSet::new(),
            &HashMap::new(),
            now,
        );
        let ids: Vec<&str> = channels.iter().map(|c| c.channel_id.as_str()).collect();
        assert_eq!(ids, ["UCa"]);
    }

    #[test]
    fn not_interested_after_the_last_watch_forgets_the_channel() {
        let now = 10 * 86_400_000;
        let watches = vec![watch("UCa", now - 5000, 550), watch("UCa", now - 6000, 550)];
        let ni = HashMap::from([("UCa".to_string(), now - 1000)]);
        assert!(
            remembered(
                &watches,
                &[],
                &State::default(),
                &HashSet::new(),
                &HashSet::new(),
                &ni,
                now
            )
            .is_empty()
        );
    }

    #[test]
    fn a_rejection_or_a_clear_holds_until_the_viewer_watches_again() {
        let now = 10 * 86_400_000;
        let watches = vec![watch("UCa", now - 5000, 550), watch("UCa", now - 6000, 550)];
        let none = |state: &State| {
            remembered(
                &watches,
                &[],
                state,
                &HashSet::new(),
                &HashSet::new(),
                &HashMap::new(),
                now,
            )
            .is_empty()
        };
        let rejected = State {
            entries: HashMap::from([(
                "UCa".to_string(),
                Entry {
                    rejected_at: now - 1000,
                    ..Entry::default()
                },
            )]),
            cleared_at: 0,
        };
        assert!(none(&rejected));
        let cleared = State {
            entries: HashMap::new(),
            cleared_at: now - 1000,
        };
        assert!(none(&cleared));
        let earlier_clear = State {
            entries: HashMap::new(),
            cleared_at: now - 10_000,
        };
        assert!(!none(&earlier_clear));
    }
}
