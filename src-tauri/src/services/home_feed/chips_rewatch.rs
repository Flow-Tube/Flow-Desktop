//! The Mixes and Watched chips, from Flow for Android's `HomeChipPolicies`: what is worth seeing
//! again from what the viewer already watched and liked. Songs and Shorts never count: the history
//! is shared with music, and a mix is a video queue.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;

use super::card::Card;
use super::seeds::SeedInput;
use crate::db::library;
use crate::db::watch_history::WatchHistoryRecord;
use crate::models::video::VideoSummary;

pub const WATCHED_MIN: usize = 4;
pub const MIXES_MIN: usize = 4;
const MIXES_MAX: usize = 6;
pub const MIX_LENGTH: usize = 25;
pub const MIX_MIN_VIDEOS: usize = 5;
const WATCHED_SKIP_RECENT_MS: u64 = 86_400_000;
const WATCHED_REST_MS: f64 = 30.0 * 86_400_000.0;
const RECENT_SEED_MS: u64 = 14 * 86_400_000;
const LIKED_SEED_STRENGTH: f64 = 2.0;

/// A mix: the seed video, then what plays well after it. Played as a queue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeMix {
    pub seed: VideoSummary,
    pub videos: Vec<VideoSummary>,
}

#[derive(Debug, Clone)]
pub struct MixCandidate {
    pub video: VideoSummary,
    pub strength: f64,
    pub at: u64,
    pub long_term: bool,
}

#[derive(Debug, Clone)]
pub struct MixSeed {
    pub video: VideoSummary,
}

/// The video a history row describes. It has no upload date, so the card claims none.
#[must_use]
pub fn history_card(record: &WatchHistoryRecord) -> Card {
    Card {
        video: VideoSummary {
            id: record.video_id.clone(),
            title: record.title.clone(),
            channel_name: record.channel_name.clone().unwrap_or_default(),
            channel_id: record.channel_id.clone(),
            thumbnail_url: Some(format!(
                "https://i.ytimg.com/vi/{}/hqdefault.jpg",
                record.video_id
            )),
            duration_seconds: record
                .total_duration_seconds
                .and_then(|seconds| u64::try_from(seconds).ok()),
            ..VideoSummary::default()
        },
        published_at_ms: 0,
    }
}

fn is_long_form(record: &WatchHistoryRecord) -> bool {
    !record.is_music && !record.is_short_video() && record.total_duration_seconds.unwrap_or(0) > 0
}

#[allow(clippy::cast_precision_loss)]
fn completion(record: &WatchHistoryRecord) -> f64 {
    let total = record.total_duration_seconds.unwrap_or(0);
    if total <= 0 {
        return 0.0;
    }
    (record.watch_duration_seconds as f64 / total as f64).clamp(0.0, 1.0)
}

/// Candidates for the mixes: real watches of long-form videos, and likes, which count double and
/// as lasting favourites.
#[must_use]
pub fn mix_candidates(
    history: &[WatchHistoryRecord],
    likes: &[(VideoSummary, u64)],
    now_ms: u64,
) -> Vec<MixCandidate> {
    let liked_ids: HashSet<&str> = likes.iter().map(|(video, _)| video.id.as_str()).collect();
    let watches = history
        .iter()
        .filter(|record| is_long_form(record))
        .filter(|record| !liked_ids.contains(record.video_id.as_str()))
        .filter(|record| {
            SeedInput::is_real_watch(
                record
                    .total_duration_seconds
                    .and_then(|seconds| u64::try_from(seconds).ok())
                    .unwrap_or(0),
                completion(record) * 100.0,
            )
        })
        .map(|record| {
            let at = library::iso_ms(&record.watch_date);
            MixCandidate {
                video: history_card(record).video,
                strength: 1.0,
                at,
                long_term: now_ms.saturating_sub(at) > RECENT_SEED_MS,
            }
        });
    likes
        .iter()
        .filter(|(video, _)| !video.is_short)
        .map(|(video, at)| MixCandidate {
            video: video.clone(),
            strength: LIKED_SEED_STRENGTH,
            at: *at,
            long_term: true,
        })
        .chain(watches)
        .collect()
}

/// Recent strong watches and long-term favourites in turn, one per interest, never a video the
/// viewer rejected.
#[must_use]
pub fn mix_seeds(
    candidates: Vec<MixCandidate>,
    clusters: &HashMap<String, String>,
    hidden: &dyn Fn(&VideoSummary) -> bool,
) -> Vec<MixSeed> {
    let (mut lasting, mut recent): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .filter(|candidate| !hidden(&candidate.video))
        .partition(|candidate| candidate.long_term);
    recent.sort_by_key(|candidate| std::cmp::Reverse(candidate.at));
    lasting.sort_by(|a, b| b.strength.total_cmp(&a.strength));
    let mut recent: VecDeque<_> = recent.into();
    let mut lasting: VecDeque<_> = lasting.into();
    let mut used_clusters = HashSet::new();
    let mut used_ids = HashSet::new();
    let mut out = Vec::new();
    let mut take = |queue: &mut VecDeque<MixCandidate>, out: &mut Vec<MixSeed>| -> bool {
        while let Some(next) = queue.pop_front() {
            let cluster = clusters
                .get(&next.video.id)
                .cloned()
                .or_else(|| next.video.channel_id.clone())
                .unwrap_or_else(|| next.video.id.clone());
            if used_ids.contains(&next.video.id) || used_clusters.contains(&cluster) {
                continue;
            }
            used_ids.insert(next.video.id.clone());
            used_clusters.insert(cluster);
            out.push(MixSeed { video: next.video });
            return true;
        }
        false
    };
    while out.len() < MIXES_MAX && (!recent.is_empty() || !lasting.is_empty()) {
        let took_recent = take(&mut recent, &mut out);
        let took_lasting = out.len() < MIXES_MAX && take(&mut lasting, &mut out);
        if !took_recent && !took_lasting {
            break;
        }
    }
    out
}

/// The seed followed by what plays after it, without repeats.
#[must_use]
pub fn mix_of(
    seed: VideoSummary,
    next: impl IntoIterator<Item = VideoSummary>,
    length: usize,
) -> HomeMix {
    let mut added = HashSet::from([seed.id.clone()]);
    let mut videos = vec![seed.clone()];
    for video in next {
        if videos.len() >= length {
            break;
        }
        if added.insert(video.id.clone()) {
            videos.push(video);
        }
    }
    HomeMix { seed, videos }
}

/// Watched videos worth watching again: finished, not seen for a while and close to current taste.
/// Nothing from the last day, no Shorts, songs or dislikes. Android also counts rewatches, which
/// this computer's history does not keep.
#[must_use]
pub fn watch_again<'a>(
    history: &'a [WatchHistoryRecord],
    taste: &HashMap<String, f64>,
    disliked: &HashSet<String>,
    now_ms: u64,
) -> Vec<&'a WatchHistoryRecord> {
    #[allow(clippy::cast_precision_loss)]
    let score = |record: &WatchHistoryRecord| {
        let rest = now_ms.saturating_sub(library::iso_ms(&record.watch_date)) as f64;
        0.25 * completion(record)
            + 0.15 * (rest / WATCHED_REST_MS).clamp(0.0, 1.0)
            + 0.25 * taste.get(&record.video_id).copied().unwrap_or(0.0)
    };
    let mut seen = HashSet::new();
    let mut scored: Vec<(f64, &WatchHistoryRecord)> = history
        .iter()
        .filter(|record| is_long_form(record))
        .filter(|record| !disliked.contains(&record.video_id))
        .filter(|record| {
            now_ms.saturating_sub(library::iso_ms(&record.watch_date)) >= WATCHED_SKIP_RECENT_MS
        })
        .filter(|record| seen.insert(record.video_id.as_str()))
        .map(|record| (score(record), record))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().map(|(_, record)| record).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: u64 = 86_400_000;
    const NOW: u64 = 100 * DAY_MS;

    fn record(id: &str, days_ago: u64, watched: i64) -> WatchHistoryRecord {
        WatchHistoryRecord {
            id: None,
            video_id: id.to_string(),
            title: id.to_string(),
            channel_name: Some("Channel".to_string()),
            channel_id: Some(format!("ch-{id}")),
            watch_date: chrono::DateTime::from_timestamp_millis(
                i64::try_from(NOW - days_ago * DAY_MS).unwrap(),
            )
            .unwrap()
            .to_rfc3339(),
            watch_duration_seconds: watched,
            total_duration_seconds: Some(600),
            is_music: false,
            is_short: false,
        }
    }

    fn video(id: &str) -> VideoSummary {
        VideoSummary {
            id: id.to_string(),
            channel_id: Some(format!("ch-{id}")),
            ..VideoSummary::default()
        }
    }

    #[test]
    fn watch_again_leaves_out_songs_shorts_dislikes_and_the_last_day() {
        let mut song = record("song", 5, 600);
        song.is_music = true;
        let mut short = record("short", 5, 30);
        short.is_short = true;
        let history = [
            song,
            short,
            record("today", 0, 600),
            record("disliked", 5, 600),
            record("kept", 5, 600),
        ];
        let disliked = HashSet::from(["disliked".to_string()]);
        let kept = watch_again(&history, &HashMap::new(), &disliked, NOW);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].video_id, "kept");
    }

    #[test]
    fn watch_again_prefers_finished_rested_and_on_taste_videos() {
        let history = [record("half", 40, 300), record("full", 40, 600)];
        let none = HashSet::new();
        let by_completion = watch_again(&history, &HashMap::new(), &none, NOW);
        assert_eq!(by_completion[0].video_id, "full");
        let taste = HashMap::from([("half".to_string(), 1.0)]);
        let by_taste = watch_again(&history, &taste, &none, NOW);
        assert_eq!(by_taste[0].video_id, "half");
    }

    #[test]
    fn mix_candidates_skip_songs_and_half_watched_videos() {
        let mut song = record("song", 5, 600);
        song.is_music = true;
        let history = [song, record("half", 5, 60), record("real", 5, 590)];
        let candidates = mix_candidates(&history, &[(video("liked"), NOW)], NOW);
        let ids: Vec<&str> = candidates.iter().map(|c| c.video.id.as_str()).collect();
        assert_eq!(ids, ["liked", "real"]);
        assert!(candidates[0].long_term);
        assert!(!candidates[1].long_term);
    }

    #[test]
    fn mix_seeds_take_turns_and_keep_one_per_interest() {
        let candidate = |id: &str, long_term: bool, at: u64| MixCandidate {
            video: video(id),
            strength: 1.0,
            at,
            long_term,
        };
        let clusters = HashMap::from([
            ("r1".to_string(), "chess".to_string()),
            ("r2".to_string(), "chess".to_string()),
            ("r3".to_string(), "bread".to_string()),
            ("l1".to_string(), "rust".to_string()),
        ]);
        let seeds = mix_seeds(
            vec![
                candidate("r1", false, 3),
                candidate("r2", false, 2),
                candidate("r3", false, 1),
                candidate("l1", true, 1),
                candidate("hidden", false, 9),
            ],
            &clusters,
            &|video| video.id == "hidden",
        );
        let ids: Vec<&str> = seeds.iter().map(|seed| seed.video.id.as_str()).collect();
        assert_eq!(ids, ["r1", "l1", "r3"]);
    }

    #[test]
    fn a_mix_starts_with_its_seed_and_never_repeats() {
        let mix = mix_of(
            video("seed"),
            [
                video("seed"),
                video("a"),
                video("a"),
                video("b"),
                video("c"),
            ],
            3,
        );
        let ids: Vec<&str> = mix.videos.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, ["seed", "a", "b"]);
    }
}
