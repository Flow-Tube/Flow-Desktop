//! Folds the two ledgers into what one period shows: a port of Android's `RecapAggregates`.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::recap::model::{DislikedVideo, LedgerAction, MusicMonth, VideoMonth, ViewFormat};

pub const TOP_COUNT: usize = 10;
const MIN_EVENTS_FOR_TRAITS: i64 = 20;
const NIGHT_SHARE: f64 = 0.30;
const MORNING_SHARE: f64 = 0.25;
const WEEKEND_SHARE: f64 = 0.45;
const LOYAL_SHARE: f64 = 0.30;
const LOYAL_MIN_VIEWS: i64 = 10;
const EXPLORER_MIN: usize = 10;
const MARATHON_MS: i64 = 3 * 60 * 60 * 1000;
const TIME_SAVER_MS: i64 = 10 * 60 * 1000;
const NIGHT_HOURS: [usize; 6] = [22, 23, 0, 1, 2, 3];
const MORNING_HOURS: [usize; 4] = [5, 6, 7, 8];

/// The span a recap covers: "2026-09", "2026" or "all".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecapPeriod {
    Month(i32, u32),
    Year(i32),
    AllTime,
}

impl RecapPeriod {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        if value == "all" {
            return Some(Self::AllTime);
        }
        if let Some((year, month)) = value.split_once('-') {
            let month: u32 = month.parse().ok()?;
            return (1..=12)
                .contains(&month)
                .then_some(Self::Month(year.parse().ok()?, month));
        }
        value.parse().ok().map(Self::Year)
    }

    fn previous(&self) -> Option<Self> {
        match self {
            Self::Month(year, 1) => Some(Self::Month(year - 1, 12)),
            Self::Month(year, month) => Some(Self::Month(*year, month - 1)),
            Self::Year(year) => Some(Self::Year(year - 1)),
            Self::AllTime => None,
        }
    }

    fn contains(&self, year: i32, month: u32) -> bool {
        match self {
            Self::Month(y, m) => *y == year && *m == month,
            Self::Year(y) => *y == year,
            Self::AllTime => true,
        }
    }
}

/// Which ledger a recap page shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RecapSource {
    All,
    Video,
    Music,
}

/// What a ranked row stands for, which decides where opening it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RankedKind {
    Channel,
    Video,
    Artist,
    Track,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub duration_ms: i64,
    /// A secondary line: the channel of a video.
    pub detail: String,
    pub image_url: String,
    pub kind: RankedKind,
}

impl RankedItem {
    fn plain(id: &str, count: i64) -> Self {
        Self {
            id: id.to_string(),
            name: id.to_string(),
            count,
            duration_ms: 0,
            detail: String::new(),
            image_url: String::new(),
            kind: RankedKind::Other,
        }
    }
}

/// Watching or listening folded over a period, down to the day.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPattern {
    pub total_ms: i64,
    /// Local date "2026-09-14" to time spent.
    pub day_ms: BTreeMap<String, i64>,
    /// Counted views or plays per hour of day, 0 to 23.
    pub hour_counts: Vec<i64>,
    /// Counted views or plays per weekday, Monday first.
    pub weekday_counts: Vec<i64>,
    pub active_days: usize,
    pub longest_streak: usize,
    pub busiest_day: Option<(String, i64)>,
}

impl ActivityPattern {
    fn new(
        total_ms: i64,
        days: BTreeMap<NaiveDate, i64>,
        hours: Vec<i64>,
        weekdays: Vec<i64>,
    ) -> Self {
        let active: Vec<NaiveDate> = days
            .iter()
            .filter(|(_, ms)| **ms > 0)
            .map(|(d, _)| *d)
            .collect();
        let mut longest_streak = 0;
        let mut run = 0;
        let mut previous: Option<NaiveDate> = None;
        for day in &active {
            run = match previous {
                Some(before) if before.succ_opt() == Some(*day) => run + 1,
                _ => 1,
            };
            longest_streak = longest_streak.max(run);
            previous = Some(*day);
        }
        let busiest_day = days
            .iter()
            .filter(|(_, ms)| **ms > 0)
            .max_by_key(|(_, ms)| **ms)
            .map(|(day, ms)| (day.to_string(), *ms));
        Self {
            total_ms,
            active_days: active.len(),
            longest_streak,
            busiest_day,
            day_ms: days
                .into_iter()
                .map(|(day, ms)| (day.to_string(), ms))
                .collect(),
            hour_counts: hours,
            weekday_counts: weekdays,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecap {
    pub views: i64,
    pub sessions: i64,
    pub activity: ActivityPattern,
    pub format_ms: BTreeMap<ViewFormat, i64>,
    pub top_channels: Vec<RankedItem>,
    pub top_videos: Vec<RankedItem>,
    pub top_topics: Vec<RankedItem>,
    /// Topics in this period's top list that were absent from the previous period.
    pub new_topics: Vec<String>,
    pub discovered_channels: Vec<RankedItem>,
    pub skipped_videos: Vec<RankedItem>,
    pub dislikes: Vec<DislikedVideo>,
    pub actions: BTreeMap<LedgerAction, i64>,
    pub top_queries: Vec<RankedItem>,
    pub sponsor_skipped_ms: BTreeMap<String, i64>,
    pub sponsor_saved_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicRecap {
    pub plays: i64,
    pub sessions: i64,
    pub activity: ActivityPattern,
    pub top_artists: Vec<RankedItem>,
    pub top_tracks: Vec<RankedItem>,
    pub discovered_artists: Vec<RankedItem>,
    pub skipped_tracks: Vec<RankedItem>,
    pub disliked_artists: Vec<RankedItem>,
    pub blocked_artists: Vec<RankedItem>,
}

/// Traits a recap can honestly claim from its own numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecapInsight {
    NightOwl,
    EarlyBird,
    WeekendWatcher,
    Loyal,
    Explorer,
    Marathon,
    TimeSaver,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapSummary {
    pub video: VideoRecap,
    pub music: MusicRecap,
    /// The sources together, for the headline numbers, the clock and the calendar.
    pub combined: ActivityPattern,
    /// The previous period's combined time, or none when there is nothing to compare with.
    pub previous_total_ms: Option<i64>,
    pub insights: Vec<RecapInsight>,
    /// Whether any month in the period includes the rough fold of watch history.
    pub estimated: bool,
}

/// One ledger month with its row's flag.
pub type LedgerRow<M> = (String, M, bool);

fn parse_month(key: &str) -> Option<(i32, u32)> {
    let (year, month) = key.split_once('-')?;
    Some((year.parse().ok()?, month.parse().ok()?))
}

fn in_period<'a, M>(
    rows: &'a [LedgerRow<M>],
    period: &RecapPeriod,
) -> Vec<(i32, u32, &'a M, bool)> {
    rows.iter()
        .filter_map(|(key, month, estimated)| {
            let (year, number) = parse_month(key)?;
            period
                .contains(year, number)
                .then_some((year, number, month, *estimated))
        })
        .collect()
}

fn ranked(
    counts: &HashMap<String, i64>,
    limit: usize,
    item: impl Fn(&str, i64) -> RankedItem,
) -> Vec<RankedItem> {
    let mut entries: Vec<(&String, &i64)> = counts.iter().collect();
    entries.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
    entries
        .into_iter()
        .take(limit)
        .map(|(key, count)| item(key, *count))
        .collect()
}

fn sum_into<K: Clone + std::hash::Hash + Eq>(
    sums: &mut HashMap<K, i64>,
    values: &BTreeMap<K, i64>,
) {
    for (key, value) in values {
        *sums.entry(key.clone()).or_insert(0) += *value;
    }
}

fn folded(
    months: impl Iterator<
        Item = (
            i32,
            u32,
            BTreeMap<u32, i64>,
            BTreeMap<u32, i64>,
            BTreeMap<u32, i64>,
        ),
    >,
    total_ms: i64,
) -> ActivityPattern {
    let mut days: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    let mut hours = vec![0; 24];
    let mut weekdays = vec![0; 7];
    for (year, month, day_ms, day_counts, hour_counts) in months {
        for (day, ms) in day_ms {
            if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                *days.entry(date).or_insert(0) += ms;
            }
        }
        for (day, count) in day_counts {
            if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                weekdays[date.weekday().num_days_from_monday() as usize] += count;
            }
        }
        for (hour, count) in hour_counts {
            if let Some(slot) = hours.get_mut(hour as usize) {
                *slot += count;
            }
        }
    }
    ActivityPattern::new(total_ms, days, hours, weekdays)
}

fn video_activity(months: &[(i32, u32, &VideoMonth, bool)]) -> ActivityPattern {
    folded(
        months.iter().map(|(y, n, m, _)| {
            (
                *y,
                *n,
                m.day_ms.clone(),
                m.day_views.clone(),
                m.hour_views.clone(),
            )
        }),
        months.iter().map(|(_, _, m, _)| m.watched_ms).sum(),
    )
}

fn new_topics(
    top_topics: &[RankedItem],
    previous: &[(i32, u32, &VideoMonth, bool)],
) -> Vec<String> {
    if previous.is_empty() {
        return Vec::new();
    }
    let previous_topics: HashSet<&String> = previous
        .iter()
        .flat_map(|(_, _, month, _)| month.topic_views.keys())
        .collect();
    top_topics
        .iter()
        .filter(|topic| !previous_topics.contains(&topic.id))
        .map(|topic| topic.id.clone())
        .collect()
}

fn video_recap(
    months: &[(i32, u32, &VideoMonth, bool)],
    previous: &[(i32, u32, &VideoMonth, bool)],
) -> VideoRecap {
    let mut names = HashMap::new();
    let mut avatars = HashMap::new();
    let mut titles = HashMap::new();
    let mut video_channels = HashMap::new();
    let mut channel_views = HashMap::new();
    let mut channel_ms = HashMap::new();
    let mut video_views = HashMap::new();
    let mut topics = HashMap::new();
    let mut skipped_videos = HashMap::new();
    let mut format_ms = HashMap::new();
    let mut actions = HashMap::new();
    let mut queries = HashMap::new();
    let mut sponsor = HashMap::new();
    let mut discovered = HashSet::new();
    let mut dislikes = Vec::new();
    for (_, _, month, _) in months {
        names.extend(month.channel_names.iter());
        avatars.extend(month.channel_avatars.iter());
        titles.extend(month.video_titles.iter());
        video_channels.extend(month.video_channels.iter());
        sum_into(&mut channel_views, &month.channel_views);
        sum_into(&mut channel_ms, &month.channel_ms);
        sum_into(&mut video_views, &month.video_views);
        sum_into(&mut topics, &month.topic_views);
        sum_into(&mut skipped_videos, &month.video_skips);
        sum_into(&mut format_ms, &month.format_ms);
        sum_into(&mut actions, &month.actions);
        sum_into(&mut queries, &month.queries);
        sum_into(&mut sponsor, &month.sponsor_skipped_ms);
        discovered.extend(month.discovered_channels.iter().cloned());
        dislikes.extend(month.dislikes.iter().cloned());
    }
    dislikes.sort_by_key(|d: &DislikedVideo| std::cmp::Reverse(d.at));

    let channel_name = |id: &str| {
        names
            .get(&id.to_string())
            .map_or_else(|| id.to_string(), |name| (*name).clone())
    };
    let channel_item = |id: &str, count: i64| RankedItem {
        id: id.to_string(),
        name: channel_name(id),
        count,
        duration_ms: channel_ms.get(id).copied().unwrap_or(0),
        detail: String::new(),
        image_url: avatars
            .get(&id.to_string())
            .map(|url| (*url).clone())
            .unwrap_or_default(),
        kind: RankedKind::Channel,
    };
    let video_item = |id: &str, count: i64| RankedItem {
        id: id.to_string(),
        name: titles
            .get(&id.to_string())
            .map(|title| (*title).clone())
            .unwrap_or_default(),
        count,
        duration_ms: 0,
        detail: video_channels
            .get(&id.to_string())
            .map(|channel| channel_name(channel))
            .unwrap_or_default(),
        image_url: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
        kind: RankedKind::Video,
    };

    let top_topics = ranked(&topics, TOP_COUNT, RankedItem::plain);
    let new_topics = new_topics(&top_topics, previous);
    let discovered_counts: HashMap<String, i64> = discovered
        .into_iter()
        .map(|id| {
            let views = channel_views.get(&id).copied().unwrap_or(0);
            (id, views)
        })
        .collect();

    VideoRecap {
        views: months.iter().map(|(_, _, m, _)| m.views).sum(),
        sessions: months.iter().map(|(_, _, m, _)| m.sessions).sum(),
        activity: video_activity(months),
        format_ms: format_ms.into_iter().collect(),
        top_channels: ranked(&channel_views, TOP_COUNT, channel_item),
        top_videos: ranked(&video_views, TOP_COUNT, video_item),
        top_topics,
        new_topics,
        discovered_channels: ranked(&discovered_counts, TOP_COUNT * 3, channel_item),
        skipped_videos: ranked(&skipped_videos, TOP_COUNT, video_item),
        dislikes,
        actions: actions.into_iter().collect(),
        top_queries: ranked(&queries, TOP_COUNT, RankedItem::plain),
        sponsor_saved_ms: sponsor.values().sum(),
        sponsor_skipped_ms: sponsor.into_iter().collect(),
    }
}

/// Some music results arrive with their view count where the artist belongs ("34M views").
fn looks_like_view_count(name: &str) -> bool {
    let name = name.trim().to_lowercase();
    let Some(number) = name
        .strip_suffix(" views")
        .or_else(|| name.strip_suffix(" view"))
    else {
        return false;
    };
    let number = number.trim_end_matches(['k', 'm', 'b']).trim_end();
    !number.is_empty()
        && number
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == ',')
}

/// Estimated months file artists by name, live ones by id. A name's plays land on its id's key.
fn canonical_artists(names: &HashMap<String, String>) -> HashMap<String, String> {
    let mut by_name: HashMap<String, &String> = HashMap::new();
    for (key, name) in names {
        if *key != name.trim().to_lowercase() {
            by_name.insert(name.trim().to_lowercase(), key);
        }
    }
    names
        .keys()
        .filter_map(|key| by_name.get(key).map(|id| (key.clone(), (*id).clone())))
        .collect()
}

fn music_recap(months: &[(i32, u32, &MusicMonth, bool)]) -> MusicRecap {
    let mut names: HashMap<String, String> = HashMap::new();
    let mut titles: HashMap<&String, &String> = HashMap::new();
    let mut track_art: HashMap<&String, &String> = HashMap::new();
    let mut artist_art: HashMap<String, String> = HashMap::new();
    let mut track_plays = HashMap::new();
    let mut track_skips = HashMap::new();
    for (_, _, month, _) in months {
        for (key, name) in &month.artist_names {
            names.insert(key.clone(), name.clone());
        }
        for (key, art) in &month.artist_art {
            artist_art.insert(key.clone(), art.clone());
        }
        titles.extend(month.track_titles.iter());
        track_art.extend(month.track_art.iter());
        sum_into(&mut track_plays, &month.track_plays);
        sum_into(&mut track_skips, &month.track_skips);
    }
    let aliases = canonical_artists(&names);
    let resolve = |key: &str| aliases.get(key).cloned().unwrap_or_else(|| key.to_string());
    let artist_name = |key: &str| names.get(key).cloned().unwrap_or_else(|| key.to_string());

    let mut artist_plays: HashMap<String, i64> = HashMap::new();
    let mut discovered: HashSet<String> = HashSet::new();
    let mut disliked: HashMap<String, i64> = HashMap::new();
    let mut blocked: HashMap<String, i64> = HashMap::new();
    for (_, _, month, _) in months {
        for (key, plays) in &month.artist_plays {
            *artist_plays.entry(resolve(key)).or_insert(0) += *plays;
        }
        discovered.extend(month.discovered_artists.iter().map(|key| resolve(key)));
        for (key, at) in &month.disliked_artists {
            disliked.insert(resolve(key), *at);
        }
        for (key, at) in &month.blocked_artists {
            blocked.insert(resolve(key), *at);
        }
    }
    artist_plays.retain(|key, _| !looks_like_view_count(&artist_name(key)));

    let artist_item = |key: &str, count: i64| RankedItem {
        id: key.to_string(),
        name: artist_name(key),
        count,
        duration_ms: 0,
        detail: String::new(),
        image_url: artist_art.get(key).cloned().unwrap_or_default(),
        kind: RankedKind::Artist,
    };
    let track_item = |id: &str, count: i64| RankedItem {
        id: id.to_string(),
        name: titles
            .get(&id.to_string())
            .map_or_else(|| id.to_string(), |title| (*title).clone()),
        count,
        duration_ms: 0,
        detail: String::new(),
        image_url: track_art.get(&id.to_string()).map_or_else(
            || format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
            |art| (*art).clone(),
        ),
        kind: RankedKind::Track,
    };
    let dated = |said_no: &HashMap<String, i64>| -> Vec<RankedItem> {
        let mut keys: Vec<(&String, &i64)> = said_no.iter().collect();
        keys.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        keys.into_iter()
            .map(|(key, _)| artist_item(key, 1))
            .collect()
    };
    let discovered_counts: HashMap<String, i64> = discovered
        .into_iter()
        .filter(|key| !looks_like_view_count(&artist_name(key)))
        .map(|key| {
            let plays = artist_plays.get(&key).copied().unwrap_or(0);
            (key, plays)
        })
        .collect();

    MusicRecap {
        plays: months.iter().map(|(_, _, m, _)| m.plays).sum(),
        sessions: months.iter().map(|(_, _, m, _)| m.sessions).sum(),
        activity: folded(
            months.iter().map(|(y, n, m, _)| {
                (
                    *y,
                    *n,
                    m.day_ms.clone(),
                    m.day_plays.clone(),
                    m.hour_plays.clone(),
                )
            }),
            months.iter().map(|(_, _, m, _)| m.listened_ms).sum(),
        ),
        top_artists: ranked(&artist_plays, TOP_COUNT, artist_item),
        top_tracks: ranked(&track_plays, TOP_COUNT, track_item),
        discovered_artists: ranked(&discovered_counts, TOP_COUNT * 3, artist_item),
        skipped_tracks: ranked(&track_skips, TOP_COUNT, track_item),
        disliked_artists: dated(&disliked),
        blocked_artists: dated(&blocked),
    }
}

fn combine(video: &ActivityPattern, music: &ActivityPattern) -> ActivityPattern {
    let mut days: BTreeMap<NaiveDate, i64> = BTreeMap::new();
    for (day, ms) in video.day_ms.iter().chain(&music.day_ms) {
        if let Ok(date) = day.parse::<NaiveDate>() {
            *days.entry(date).or_insert(0) += ms;
        }
    }
    let add = |a: &[i64], b: &[i64]| a.iter().zip(b).map(|(x, y)| x + y).collect();
    ActivityPattern::new(
        video.total_ms + music.total_ms,
        days,
        add(&video.hour_counts, &music.hour_counts),
        add(&video.weekday_counts, &music.weekday_counts),
    )
}

fn insights(
    video: &VideoRecap,
    music: &MusicRecap,
    combined: &ActivityPattern,
) -> Vec<RecapInsight> {
    let mut traits = Vec::new();
    let events: i64 = combined.hour_counts.iter().sum();
    if events >= MIN_EVENTS_FOR_TRAITS {
        let share = |hours: &[usize]| {
            (hours
                .iter()
                .map(|hour| combined.hour_counts[*hour])
                .sum::<i64>()) as f64
                / events as f64
        };
        let weekday_total: i64 = combined.weekday_counts.iter().sum();
        let weekend = (combined.weekday_counts[5] + combined.weekday_counts[6]) as f64
            / (weekday_total.max(1)) as f64;
        if share(&NIGHT_HOURS) >= NIGHT_SHARE {
            traits.push(RecapInsight::NightOwl);
        }
        if share(&MORNING_HOURS) >= MORNING_SHARE {
            traits.push(RecapInsight::EarlyBird);
        }
        if weekend >= WEEKEND_SHARE {
            traits.push(RecapInsight::WeekendWatcher);
        }
    }
    let top_channel = video.top_channels.first().map_or(0, |c| c.count);
    if video.views >= LOYAL_MIN_VIEWS && top_channel as f64 / video.views as f64 >= LOYAL_SHARE {
        traits.push(RecapInsight::Loyal);
    }
    if video.discovered_channels.len() + music.discovered_artists.len() >= EXPLORER_MIN {
        traits.push(RecapInsight::Explorer);
    }
    if combined
        .busiest_day
        .as_ref()
        .is_some_and(|(_, ms)| *ms >= MARATHON_MS)
    {
        traits.push(RecapInsight::Marathon);
    }
    if video.sponsor_saved_ms >= TIME_SAVER_MS {
        traits.push(RecapInsight::TimeSaver);
    }
    traits
}

/// The recap of `period`. `source` empties the other ledger, so nothing of it reaches the result.
#[must_use]
pub fn summarize(
    period: &RecapPeriod,
    source: RecapSource,
    video: &[LedgerRow<VideoMonth>],
    music: &[LedgerRow<MusicMonth>],
) -> RecapSummary {
    let video: &[LedgerRow<VideoMonth>] = if source == RecapSource::Music {
        &[]
    } else {
        video
    };
    let music: &[LedgerRow<MusicMonth>] = if source == RecapSource::Video {
        &[]
    } else {
        music
    };
    let video_months = in_period(video, period);
    let music_months = in_period(music, period);
    let previous = period.previous();
    let previous_video = previous
        .as_ref()
        .map(|p| in_period(video, p))
        .unwrap_or_default();
    let previous_music = previous
        .as_ref()
        .map(|p| in_period(music, p))
        .unwrap_or_default();

    let video_recap = video_recap(&video_months, &previous_video);
    let music_recap = music_recap(&music_months);
    let combined = combine(&video_recap.activity, &music_recap.activity);
    let previous_total_ms = (!previous_video.is_empty() || !previous_music.is_empty()).then(|| {
        previous_video
            .iter()
            .map(|(_, _, m, _)| m.watched_ms)
            .sum::<i64>()
            + previous_music
                .iter()
                .map(|(_, _, m, _)| m.listened_ms)
                .sum::<i64>()
    });
    let estimated = video_months.iter().any(|(_, _, _, flag)| *flag)
        || music_months.iter().any(|(_, _, _, flag)| *flag);
    RecapSummary {
        insights: insights(&video_recap, &music_recap, &combined),
        video: video_recap,
        music: music_recap,
        combined,
        previous_total_ms,
        estimated,
    }
}

/// Watching and listening time for each of the `count` days ending `today`, oldest first.
#[must_use]
pub fn daily_time(
    video: &[LedgerRow<VideoMonth>],
    music: &[LedgerRow<MusicMonth>],
    today: NaiveDate,
    count: u32,
) -> Vec<(String, i64)> {
    let mut days: HashMap<NaiveDate, i64> = HashMap::new();
    let mut add = |key: &str, day_ms: &BTreeMap<u32, i64>| {
        let Some((year, month)) = parse_month(key) else {
            return;
        };
        for (day, ms) in day_ms {
            if let Some(date) = NaiveDate::from_ymd_opt(year, month, *day) {
                *days.entry(date).or_insert(0) += ms;
            }
        }
    };
    for (key, month, _) in video {
        add(key, &month.day_ms);
    }
    for (key, month, _) in music {
        add(key, &month.day_ms);
    }
    (0..count)
        .rev()
        .filter_map(|back| today.checked_sub_days(chrono::Days::new(u64::from(back))))
        .map(|date| (date.to_string(), days.get(&date).copied().unwrap_or(0)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video_month(views: i64, watched_ms: i64) -> VideoMonth {
        VideoMonth {
            views,
            watched_ms,
            ..Default::default()
        }
    }

    fn row<M>(key: &str, month: M) -> LedgerRow<M> {
        (key.to_string(), month, false)
    }

    #[test]
    fn periods_parse_and_step_back() {
        assert_eq!(
            RecapPeriod::parse("2026-09"),
            Some(RecapPeriod::Month(2026, 9))
        );
        assert_eq!(RecapPeriod::parse("2026"), Some(RecapPeriod::Year(2026)));
        assert_eq!(RecapPeriod::parse("all"), Some(RecapPeriod::AllTime));
        assert_eq!(RecapPeriod::parse("2026-13"), None);
        assert_eq!(RecapPeriod::parse("soon"), None);
        assert_eq!(
            RecapPeriod::Month(2026, 1).previous(),
            Some(RecapPeriod::Month(2025, 12))
        );
        assert_eq!(RecapPeriod::AllTime.previous(), None);
    }

    #[test]
    fn a_period_holds_only_its_months_and_compares_with_the_one_before() {
        let video = [
            row("2026-08", video_month(1, 1_000)),
            row("2026-09", video_month(2, 5_000)),
            row("2025-09", video_month(4, 9_000)),
        ];
        let month = summarize(&RecapPeriod::Month(2026, 9), RecapSource::All, &video, &[]);
        assert_eq!(month.video.views, 2);
        assert_eq!(month.previous_total_ms, Some(1_000));
        let year = summarize(&RecapPeriod::Year(2026), RecapSource::All, &video, &[]);
        assert_eq!(year.video.views, 3);
        assert_eq!(year.previous_total_ms, Some(9_000));
        let all = summarize(&RecapPeriod::AllTime, RecapSource::All, &video, &[]);
        assert_eq!(all.video.views, 7);
        assert_eq!(all.previous_total_ms, None);
    }

    #[test]
    fn a_source_leaves_the_other_ledger_out_entirely() {
        let video = [row("2026-09", video_month(2, 5_000))];
        let music = [row(
            "2026-09",
            MusicMonth {
                plays: 3,
                listened_ms: 7_000,
                ..Default::default()
            },
        )];
        let period = RecapPeriod::Month(2026, 9);
        let everything = summarize(&period, RecapSource::All, &video, &music);
        assert_eq!(everything.combined.total_ms, 12_000);
        let videos = summarize(&period, RecapSource::Video, &video, &music);
        assert_eq!(videos.music.plays, 0);
        assert_eq!(videos.combined.total_ms, 5_000);
        let songs = summarize(&period, RecapSource::Music, &video, &music);
        assert_eq!(songs.video.views, 0);
        assert_eq!(songs.combined.total_ms, 7_000);
    }

    #[test]
    fn days_fold_into_streaks_busiest_day_and_weekdays() {
        let mut month = video_month(0, 0);
        month.day_ms = BTreeMap::from([(1, 100), (2, 300), (3, 100), (10, 100)]);
        // 2026-09-05 is a Saturday.
        month.day_views = BTreeMap::from([(5, 2)]);
        month.hour_views = BTreeMap::from([(23, 2), (99, 1)]);
        let out = summarize(
            &RecapPeriod::Month(2026, 9),
            RecapSource::All,
            &[row("2026-09", month)],
            &[],
        );
        let activity = out.combined;
        assert_eq!(activity.active_days, 4);
        assert_eq!(activity.longest_streak, 3);
        assert_eq!(activity.busiest_day, Some(("2026-09-02".to_string(), 300)));
        assert_eq!(activity.weekday_counts[5], 2);
        assert_eq!(activity.hour_counts[23], 2);
    }

    #[test]
    fn insights_need_enough_activity_and_their_own_numbers() {
        let mut month = video_month(40, 0);
        month.hour_views = BTreeMap::from([(23, 40)]);
        month.day_views = BTreeMap::from([(1, 40)]);
        month.day_ms = BTreeMap::from([(1, MARATHON_MS)]);
        month.channel_views = BTreeMap::from([("c".to_string(), 30)]);
        month.sponsor_skipped_ms = BTreeMap::from([("sponsor".to_string(), TIME_SAVER_MS)]);
        let found = summarize(
            &RecapPeriod::AllTime,
            RecapSource::All,
            &[row("2026-09", month)],
            &[],
        )
        .insights;
        for expected in [
            RecapInsight::NightOwl,
            RecapInsight::Loyal,
            RecapInsight::Marathon,
            RecapInsight::TimeSaver,
        ] {
            assert!(found.contains(&expected), "{expected:?}");
        }
        assert!(!found.contains(&RecapInsight::EarlyBird));

        let quiet = summarize(
            &RecapPeriod::AllTime,
            RecapSource::All,
            &[row("2026-09", video_month(2, 10))],
            &[],
        );
        assert!(quiet.insights.is_empty());
    }

    #[test]
    fn a_new_topic_is_one_missing_from_the_period_before() {
        let mut last = video_month(1, 1);
        last.topic_views = BTreeMap::from([("Rust".to_string(), 3)]);
        let mut this = video_month(1, 1);
        this.topic_views = BTreeMap::from([("Rust".to_string(), 1), ("Go".to_string(), 2)]);
        let rows = [row("2026-08", last), row("2026-09", this)];
        let out = summarize(&RecapPeriod::Month(2026, 9), RecapSource::All, &rows, &[]);
        assert_eq!(out.video.top_topics[0].name, "Go");
        assert_eq!(out.video.new_topics, vec!["Go".to_string()]);
    }

    #[test]
    fn an_estimated_artist_merges_with_its_live_id_and_view_counts_are_no_artists() {
        let estimated = MusicMonth {
            artist_plays: BTreeMap::from([
                ("daft punk".to_string(), 4),
                ("34m views".to_string(), 9),
            ]),
            artist_names: BTreeMap::from([
                ("daft punk".to_string(), "Daft Punk".to_string()),
                ("34m views".to_string(), "34M views".to_string()),
            ]),
            ..Default::default()
        };
        let live = MusicMonth {
            artist_plays: BTreeMap::from([("UCdp".to_string(), 2)]),
            artist_names: BTreeMap::from([("UCdp".to_string(), "Daft Punk".to_string())]),
            ..Default::default()
        };
        let rows = [
            ("2026-08".to_string(), estimated, true),
            row("2026-09", live),
        ];
        let out = summarize(&RecapPeriod::AllTime, RecapSource::All, &[], &rows);
        assert_eq!(out.music.top_artists.len(), 1);
        assert_eq!(out.music.top_artists[0].id, "UCdp");
        assert_eq!(out.music.top_artists[0].count, 6);
        assert!(out.estimated);
    }

    #[test]
    fn a_week_adds_both_ledgers_and_crosses_a_month_end() {
        let mut august = video_month(0, 0);
        august.day_ms = BTreeMap::from([(31, 100), (1, 999)]);
        let mut september = video_month(0, 0);
        september.day_ms = BTreeMap::from([(2, 50)]);
        let music = MusicMonth {
            day_ms: BTreeMap::from([(2, 25)]),
            ..Default::default()
        };
        let days = daily_time(
            &[row("2026-08", august), row("2026-09", september)],
            &[row("2026-09", music)],
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap(),
            7,
        );
        assert_eq!(days.len(), 7);
        assert_eq!(days[0], ("2026-08-28".to_string(), 0));
        assert_eq!(days[3], ("2026-08-31".to_string(), 100));
        assert_eq!(days[5], ("2026-09-02".to_string(), 75));
        assert_eq!(days[6], ("2026-09-03".to_string(), 0));
    }

    #[test]
    fn rows_name_their_videos_channels_and_tracks() {
        let mut month = video_month(1, 1);
        month.video_views = BTreeMap::from([("abc".to_string(), 2)]);
        month.video_titles = BTreeMap::from([("abc".to_string(), "A title".to_string())]);
        month.video_channels = BTreeMap::from([("abc".to_string(), "c".to_string())]);
        month.channel_names = BTreeMap::from([("c".to_string(), "Channel".to_string())]);
        let out = summarize(
            &RecapPeriod::AllTime,
            RecapSource::All,
            &[row("2026-09", month)],
            &[],
        );
        let item = &out.video.top_videos[0];
        assert_eq!(item.name, "A title");
        assert_eq!(item.detail, "Channel");
        assert!(item.image_url.contains("abc"));
        assert_eq!(item.kind, RankedKind::Video);
    }
}
