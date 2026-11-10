//! Pure mutations of a month, called while the store holds its lock. No I/O.

use std::collections::{BTreeMap, HashSet};

use crate::recap::model::{
    ARTISTS_PER_MONTH, CHANNELS_PER_MONTH, DISCOVERED_PER_MONTH, DISLIKES_PER_MONTH, DislikedVideo,
    LedgerAction, LedgerMoment, ListenEvent, MusicMonth, QUERIES_PER_MONTH, SAID_NO_PER_MONTH,
    SKIPS_PER_MONTH, TOPICS_PER_MONTH, TOPICS_PER_VIEW, TRACKS_PER_MONTH, VIDEOS_PER_MONTH,
    VideoMonth, ViewEvent, ViewFormat,
};

fn add<K: Ord>(map: &mut BTreeMap<K, i64>, key: K, amount: i64) {
    *map.entry(key).or_insert(0) += amount;
}

/// Drops the weakest entries of `counts` beyond `cap`.
fn cap_weakest(counts: &mut BTreeMap<String, i64>, cap: usize) -> Vec<String> {
    if counts.len() <= cap {
        return Vec::new();
    }
    let mut ranked: Vec<(String, i64)> = counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
    ranked.sort_by_key(|(_, value)| *value);
    let dropped: Vec<String> = ranked
        .into_iter()
        .take(counts.len() - cap)
        .map(|(key, _)| key)
        .collect();
    for key in &dropped {
        counts.remove(key);
    }
    dropped
}

/// `known` is every channel seen so far; a counted view of a new one is a discovery.
pub fn record_view(
    month: &mut VideoMonth,
    known: &mut HashSet<String>,
    moment: &LedgerMoment,
    event: &ViewEvent,
    topics: &[String],
) {
    if event.video_id.is_empty() || (event.watched_ms <= 0 && !event.counted && !event.skipped) {
        return;
    }
    let format = event.format.unwrap_or(ViewFormat::Long);
    let watched = event.watched_ms.max(0);
    let channel = Some(event.channel_id.as_str()).filter(|id| !id.is_empty());

    if !event.continued {
        month.sessions += 1;
    }
    month.watched_ms += watched;
    add(&mut month.format_ms, format, watched);
    if watched > 0 {
        add(&mut month.day_ms, moment.day, watched);
    }
    if let Some(channel) = channel {
        add(&mut month.channel_ms, channel.to_string(), watched);
    }

    if event.skipped {
        add(&mut month.video_skips, event.video_id.clone(), 1);
        if let Some(channel) = channel {
            add(&mut month.channel_skips, channel.to_string(), 1);
        }
        name_view(month, event);
    }

    if event.counted {
        month.views += 1;
        add(&mut month.format_views, format, 1);
        add(&mut month.video_views, event.video_id.clone(), 1);
        name_view(month, event);
        for topic in topics.iter().take(TOPICS_PER_VIEW) {
            add(&mut month.topic_views, topic.clone(), 1);
        }
        add(&mut month.day_views, moment.day, 1);
        add(&mut month.hour_views, moment.hour, 1);
        if let Some(channel) = channel {
            add(&mut month.channel_views, channel.to_string(), 1);
            if known.insert(channel.to_string()) {
                month.discovered_channels.insert(channel.to_string());
            }
        }
    }
    prune_video(month);
}

fn name_view(month: &mut VideoMonth, event: &ViewEvent) {
    if !event.title.is_empty() {
        month
            .video_titles
            .insert(event.video_id.clone(), event.title.clone());
    }
    if event.channel_id.is_empty() {
        return;
    }
    month
        .video_channels
        .insert(event.video_id.clone(), event.channel_id.clone());
    if !event.channel_name.is_empty() {
        month
            .channel_names
            .insert(event.channel_id.clone(), event.channel_name.clone());
    }
    if !event.channel_avatar_url.is_empty() {
        month
            .channel_avatars
            .insert(event.channel_id.clone(), event.channel_avatar_url.clone());
    }
}

pub fn record_dislike(month: &mut VideoMonth, video: DislikedVideo) {
    if video.video_id.is_empty() {
        return;
    }
    month.dislikes.retain(|d| d.video_id != video.video_id);
    month.dislikes.push(video);
    prune_video(month);
}

/// Removes a dislike the viewer took back in the same month.
pub fn clear_dislike(month: &mut VideoMonth, video_id: &str) {
    month.dislikes.retain(|d| d.video_id != video_id);
}

pub fn record_action(month: &mut VideoMonth, action: LedgerAction) {
    add(&mut month.actions, action, 1);
}

/// A submitted search. `query` is kept only while search history is.
pub fn record_search(month: &mut VideoMonth, query: Option<&str>) {
    add(&mut month.actions, LedgerAction::Search, 1);
    if let Some(query) = query
        .map(|q| q.trim().to_lowercase())
        .filter(|q| !q.is_empty())
    {
        add(&mut month.queries, query, 1);
    }
    prune_video(month);
}

pub fn record_sponsor_skip(month: &mut VideoMonth, category: &str, skipped_ms: i64) {
    if category.is_empty() || skipped_ms <= 0 {
        return;
    }
    add(
        &mut month.sponsor_skipped_ms,
        category.to_string(),
        skipped_ms,
    );
}

pub fn prune_video(month: &mut VideoMonth) {
    cap_weakest(&mut month.topic_views, TOPICS_PER_MONTH);
    cap_weakest(&mut month.queries, QUERIES_PER_MONTH);
    cap_weakest(&mut month.video_skips, SKIPS_PER_MONTH);
    cap_weakest(&mut month.channel_skips, SKIPS_PER_MONTH);
    cap_weakest(&mut month.channel_ms, CHANNELS_PER_MONTH);
    cap_weakest(&mut month.channel_views, CHANNELS_PER_MONTH);
    cap_weakest(&mut month.video_views, VIDEOS_PER_MONTH);
    if month.discovered_channels.len() > DISCOVERED_PER_MONTH {
        let mut ranked: Vec<String> = month.discovered_channels.iter().cloned().collect();
        ranked
            .sort_by_key(|id| std::cmp::Reverse(month.channel_views.get(id).copied().unwrap_or(0)));
        ranked.truncate(DISCOVERED_PER_MONTH);
        month.discovered_channels = ranked.into_iter().collect();
    }
    if month.dislikes.len() > DISLIKES_PER_MONTH {
        month.dislikes.sort_by_key(|d| d.at);
        let excess = month.dislikes.len() - DISLIKES_PER_MONTH;
        month.dislikes.drain(..excess);
    }
    let videos_in_use: HashSet<&String> = month
        .video_views
        .keys()
        .chain(month.video_skips.keys())
        .collect();
    month
        .video_titles
        .retain(|id, _| videos_in_use.contains(id));
    month
        .video_channels
        .retain(|id, _| videos_in_use.contains(id));
    let channels_in_use: HashSet<&String> = month
        .channel_views
        .keys()
        .chain(month.channel_skips.keys())
        .chain(month.channel_ms.keys())
        .chain(month.video_channels.values())
        .chain(month.discovered_channels.iter())
        .collect();
    month
        .channel_names
        .retain(|id, _| channels_in_use.contains(id));
    month
        .channel_avatars
        .retain(|id, _| channels_in_use.contains(id));
}

/// One stretch of listening. `artist_key` is the brain's key for the artist; a counted play of an
/// artist not in `known` is a discovery.
pub fn record_listen(
    month: &mut MusicMonth,
    known: &mut HashSet<String>,
    moment: &LedgerMoment,
    artist_key: &str,
    event: &ListenEvent,
) {
    if artist_key.is_empty() || event.track_id.is_empty() {
        return;
    }
    if event.listened_ms <= 0 && !event.counted && !event.skipped {
        return;
    }
    if !event.continued {
        month.sessions += 1;
    }
    let listened = event.listened_ms.max(0);
    month.listened_ms += listened;
    if listened > 0 {
        add(&mut month.day_ms, moment.day, listened);
    }

    if event.skipped && !event.counted {
        add(&mut month.track_skips, event.track_id.clone(), 1);
        add(&mut month.artist_skips, artist_key.to_string(), 1);
        name_listen(month, artist_key, event);
    }

    if event.counted {
        month.plays += 1;
        add(&mut month.artist_plays, artist_key.to_string(), 1);
        add(&mut month.track_plays, event.track_id.clone(), 1);
        name_listen(month, artist_key, event);
        if !event.artwork_url.is_empty() {
            month
                .track_art
                .insert(event.track_id.clone(), event.artwork_url.clone());
            month
                .artist_art
                .insert(artist_key.to_string(), event.artwork_url.clone());
        }
        if known.insert(artist_key.to_string()) {
            month.discovered_artists.insert(artist_key.to_string());
        }
        add(&mut month.day_plays, moment.day, 1);
        add(&mut month.hour_plays, moment.hour, 1);
    }
    prune_music(month);
}

fn name_listen(month: &mut MusicMonth, artist_key: &str, event: &ListenEvent) {
    if !event.artist_name.is_empty() {
        month
            .artist_names
            .insert(artist_key.to_string(), event.artist_name.clone());
    }
    if !event.title.is_empty() {
        month
            .track_titles
            .insert(event.track_id.clone(), event.title.clone());
    }
}

/// "Not interested" (`blocked` false) or a block on an artist.
pub fn record_said_no(
    month: &mut MusicMonth,
    at_ms: i64,
    artist_key: &str,
    artist_name: &str,
    blocked: bool,
) {
    if artist_key.is_empty() {
        return;
    }
    let target = if blocked {
        &mut month.blocked_artists
    } else {
        &mut month.disliked_artists
    };
    target.insert(artist_key.to_string(), at_ms);
    let name = artist_name.trim();
    if !name.is_empty() {
        month
            .artist_names
            .insert(artist_key.to_string(), name.to_string());
    }
    prune_music(month);
}

pub fn prune_music(month: &mut MusicMonth) {
    cap_weakest(&mut month.track_skips, SKIPS_PER_MONTH);
    cap_weakest(&mut month.artist_skips, SKIPS_PER_MONTH);
    cap_weakest(&mut month.disliked_artists, SAID_NO_PER_MONTH);
    cap_weakest(&mut month.blocked_artists, SAID_NO_PER_MONTH);
    // A name stays while anything else in the month still refers to it.
    for key in cap_weakest(&mut month.artist_plays, ARTISTS_PER_MONTH) {
        let in_use = month.artist_skips.contains_key(&key)
            || month.disliked_artists.contains_key(&key)
            || month.blocked_artists.contains_key(&key);
        if !in_use {
            month.artist_names.remove(&key);
        }
    }
    for key in cap_weakest(&mut month.track_plays, TRACKS_PER_MONTH) {
        if !month.track_skips.contains_key(&key) {
            month.track_titles.remove(&key);
        }
    }
    let plays = &month.track_plays;
    month.track_art.retain(|id, _| plays.contains_key(id));
    let artists = &month.artist_plays;
    month.artist_art.retain(|key, _| artists.contains_key(key));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moment(day: u32, hour: u32) -> LedgerMoment {
        LedgerMoment {
            month_key: "2026-09".into(),
            day,
            hour,
        }
    }

    fn view(video: &str, channel: &str, watched_ms: i64, counted: bool) -> ViewEvent {
        ViewEvent {
            video_id: video.into(),
            title: format!("{video} title"),
            channel_id: channel.into(),
            channel_name: format!("{channel} name"),
            format: Some(ViewFormat::Long),
            watched_ms,
            counted,
            ..Default::default()
        }
    }

    #[test]
    fn a_counted_view_fills_every_count_once() {
        let mut month = VideoMonth::default();
        let mut known = HashSet::new();
        let topics = vec!["rust".to_string()];
        record_view(
            &mut month,
            &mut known,
            &moment(3, 21),
            &view("v", "c", 60_000, true),
            &topics,
        );
        assert_eq!(month.views, 1);
        assert_eq!(month.sessions, 1);
        assert_eq!(month.watched_ms, 60_000);
        assert_eq!(month.channel_views["c"], 1);
        assert_eq!(month.channel_names["c"], "c name");
        assert_eq!(month.video_titles["v"], "v title");
        assert_eq!(month.topic_views["rust"], 1);
        assert_eq!(month.day_ms[&3], 60_000);
        assert_eq!(month.hour_views[&21], 1);
        assert!(month.discovered_channels.contains("c"));
    }

    #[test]
    fn continued_time_adds_no_session_and_a_seen_channel_is_no_discovery() {
        let mut month = VideoMonth::default();
        let mut known: HashSet<String> = ["c".to_string()].into();
        record_view(
            &mut month,
            &mut known,
            &moment(1, 1),
            &view("v", "c", 1_000, true),
            &[],
        );
        let more = ViewEvent {
            continued: true,
            ..view("v", "c", 2_000, false)
        };
        record_view(&mut month, &mut known, &moment(1, 1), &more, &[]);
        assert_eq!(month.sessions, 1);
        assert_eq!(month.views, 1);
        assert_eq!(month.watched_ms, 3_000);
        assert!(month.discovered_channels.is_empty());
    }

    #[test]
    fn a_skip_names_the_video_without_counting_a_view() {
        let mut month = VideoMonth::default();
        let skipped = ViewEvent {
            skipped: true,
            ..view("v", "c", 12_000, false)
        };
        record_view(
            &mut month,
            &mut HashSet::new(),
            &moment(1, 1),
            &skipped,
            &[],
        );
        assert_eq!(month.views, 0);
        assert_eq!(month.video_skips["v"], 1);
        assert_eq!(month.channel_skips["c"], 1);
        assert_eq!(month.video_titles["v"], "v title");
    }

    #[test]
    fn a_session_with_nothing_in_it_writes_nothing() {
        let mut month = VideoMonth::default();
        record_view(
            &mut month,
            &mut HashSet::new(),
            &moment(1, 1),
            &view("v", "c", 0, false),
            &[],
        );
        assert_eq!(month, VideoMonth::default());
    }

    #[test]
    fn caps_drop_the_weakest_and_their_names() {
        let mut month = VideoMonth::default();
        for i in 0..=VIDEOS_PER_MONTH {
            let id = format!("v{i}");
            let views = if i == 0 { 1 } else { 2 };
            month.video_views.insert(id.clone(), views);
            month.video_titles.insert(id, "t".into());
        }
        prune_video(&mut month);
        assert_eq!(month.video_views.len(), VIDEOS_PER_MONTH);
        assert!(!month.video_views.contains_key("v0"));
        assert!(!month.video_titles.contains_key("v0"));
    }

    #[test]
    fn a_dislike_taken_back_is_forgotten_and_a_repeat_replaces_it() {
        let mut month = VideoMonth::default();
        let dislike = |at| DislikedVideo {
            video_id: "v".into(),
            title: "t".into(),
            channel_name: "c".into(),
            at,
        };
        record_dislike(&mut month, dislike(1));
        record_dislike(&mut month, dislike(2));
        assert_eq!(month.dislikes.len(), 1);
        assert_eq!(month.dislikes[0].at, 2);
        clear_dislike(&mut month, "v");
        assert!(month.dislikes.is_empty());
    }

    #[test]
    fn a_search_counts_and_keeps_text_only_when_given() {
        let mut month = VideoMonth::default();
        record_search(&mut month, None);
        record_search(&mut month, Some("  LoFi "));
        assert_eq!(month.actions[&LedgerAction::Search], 2);
        assert_eq!(month.queries["lofi"], 1);
        assert_eq!(month.queries.len(), 1);
    }

    fn listen(listened_ms: i64, counted: bool, skipped: bool) -> ListenEvent {
        ListenEvent {
            track_id: "t".into(),
            title: "song".into(),
            artist_name: "Artist".into(),
            artwork_url: "art".into(),
            listened_ms,
            counted,
            skipped,
            ..Default::default()
        }
    }

    #[test]
    fn a_counted_listen_fills_the_music_month_only() {
        let mut month = MusicMonth::default();
        let mut known = HashSet::new();
        record_listen(
            &mut month,
            &mut known,
            &moment(5, 7),
            "artist",
            &listen(90_000, true, false),
        );
        assert_eq!(month.plays, 1);
        assert_eq!(month.artist_plays["artist"], 1);
        assert_eq!(month.artist_names["artist"], "Artist");
        assert_eq!(month.track_art["t"], "art");
        assert!(month.discovered_artists.contains("artist"));
        assert_eq!(month.hour_plays[&7], 1);
    }

    #[test]
    fn a_partial_listen_adds_time_only_and_a_skip_names_it() {
        let mut month = MusicMonth::default();
        let mut known = HashSet::new();
        record_listen(
            &mut month,
            &mut known,
            &moment(5, 7),
            "artist",
            &listen(4_000, false, false),
        );
        assert_eq!(month.plays, 0);
        assert_eq!(month.listened_ms, 4_000);
        assert!(month.track_skips.is_empty());
        let skip = ListenEvent {
            continued: true,
            ..listen(0, false, true)
        };
        record_listen(&mut month, &mut known, &moment(5, 7), "artist", &skip);
        assert_eq!(month.sessions, 1);
        assert_eq!(month.track_skips["t"], 1);
        assert_eq!(month.track_titles["t"], "song");
    }

    #[test]
    fn saying_no_to_an_artist_lands_in_the_right_list() {
        let mut month = MusicMonth::default();
        record_said_no(&mut month, 9, "a", " Name ", false);
        record_said_no(&mut month, 10, "b", "", true);
        assert_eq!(month.disliked_artists["a"], 9);
        assert_eq!(month.blocked_artists["b"], 10);
        assert_eq!(month.artist_names["a"], "Name");
    }
}
