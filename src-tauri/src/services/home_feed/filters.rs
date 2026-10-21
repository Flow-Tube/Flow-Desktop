//! Which candidates Home may show, and placing late arrivals below what the viewer sees, from Flow
//! for Android's `HomeFeedFilters`.

use std::collections::HashSet;

use super::card::{Card, number_in};

pub const FRESH_SUB_WINDOW_MS: u64 = 72 * 3_600_000;
const HOME_MAX_SUGGESTION_AGE_MS: u64 = 365 * 86_400_000;
const STORED_SUBS_WINDOW_MS: u64 = 14 * 86_400_000;
const STORED_SUBS_MAX: usize = 60;
/// No channel twice within this many cards, across pages and late arrivals.
pub const RECENT_CHANNEL_WINDOW: usize = 20;

/// Cards that are videos of known length, not watched, recent enough and not hidden.
pub fn keep_showable<'a>(
    cards: impl IntoIterator<Item = Card> + 'a,
    watched: &'a HashSet<String>,
    hidden: &'a dyn Fn(&Card) -> bool,
    now_ms: u64,
    recent_only: bool,
) -> impl Iterator<Item = Card> + 'a {
    cards.into_iter().filter(move |card| {
        card.is_valid()
            && !watched.contains(card.id())
            && (!recent_only || is_recent_suggestion(card, now_ms))
            && !hidden(card)
    })
}

/// The subscription store's uploads Home can show: videos of known length from the last two weeks,
/// newest first.
#[must_use]
pub fn stored_subscription_videos(store: &[Card], now_ms: u64) -> Vec<Card> {
    let mut videos: Vec<Card> = store
        .iter()
        .filter(|card| card.is_valid())
        .filter(|card| {
            card.age_ms(now_ms)
                .is_some_and(|age| age <= STORED_SUBS_WINDOW_MS)
        })
        .cloned()
        .collect();
    videos.sort_by_key(|card| std::cmp::Reverse(card.published_at_ms));
    videos.truncate(STORED_SUBS_MAX);
    videos
}

/// Fresh-sub slots for a viewer following `sub_count` channels.
#[must_use]
pub fn dynamic_fresh_sub_slots(sub_count: usize) -> usize {
    match sub_count {
        n if n >= 120 => 5,
        n if n >= 40 => 4,
        n if n >= 5 => 3,
        _ => 2,
    }
}

/// Published in the last three days, by its time or by its text.
#[must_use]
pub fn is_fresh_subscribed(card: &Card, now_ms: u64) -> bool {
    if card
        .age_ms(now_ms)
        .is_some_and(|age| age <= FRESH_SUB_WINDOW_MS)
    {
        return true;
    }
    let text = card.upload_text();
    if text.contains("second") || text.contains("minute") || text.contains("hour") {
        return true;
    }
    text.contains("day") && number_in(&text).unwrap_or(1) <= 3
}

/// Not older than a year; a card that names no age only counts when it is live.
#[must_use]
pub fn is_recent_suggestion(card: &Card, now_ms: u64) -> bool {
    let text = card.upload_text();
    if text.trim().is_empty() || text == "unknown" {
        return card.video.is_live;
    }
    if card
        .age_ms(now_ms)
        .is_some_and(|age| age <= HOME_MAX_SUGGESTION_AGE_MS)
    {
        return true;
    }
    let value = number_in(&text).unwrap_or(1);
    if text.contains("second") || text.contains("minute") || text.contains("hour") {
        true
    } else if text.contains("day") {
        value <= 365
    } else if text.contains("week") {
        value <= 52
    } else if text.contains("month") {
        value <= 12
    } else if text.contains("year") {
        value <= 1
    } else {
        false
    }
}

/// `feed` with `late` cards placed below `last_visible`, one after every `spacing` cards already
/// there, never within `channel_window` cards of their own channel nor, when `is_grouped` holds,
/// next to another grouped card. A card with no such place is left out.
#[must_use]
pub fn insert_below_viewport(
    feed: &[Card],
    late: &[Card],
    last_visible: usize,
    spacing: usize,
    channel_window: usize,
    is_grouped: &dyn Fn(&Card) -> bool,
) -> Vec<Card> {
    let on_screen: HashSet<&str> = feed.iter().map(Card::id).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    let mut pending: Vec<&Card> = late
        .iter()
        .filter(|card| !on_screen.contains(card.id()) && seen.insert(card.id()))
        .collect();
    if pending.is_empty() {
        return feed.to_vec();
    }
    let split = (last_visible + 1).min(feed.len());
    let below = &feed[split..];
    let mut merged: Vec<Card> = feed[..split].to_vec();
    let nearby = |merged: &[Card], card: &Card, next: usize| {
        let channel = card.channel_id();
        let channel_near = !channel.is_empty()
            && (merged
                .iter()
                .rev()
                .take(channel_window)
                .any(|c| c.channel_id() == channel)
                || below[next..(next + channel_window).min(below.len())]
                    .iter()
                    .any(|c| c.channel_id() == channel));
        let grouped_near = is_grouped(card)
            && (merged.last().is_some_and(is_grouped) || below.get(next).is_some_and(is_grouped));
        channel_near || grouped_near
    };
    let place_one = |merged: &mut Vec<Card>, pending: &mut Vec<&Card>, next: usize| {
        if let Some(index) = pending.iter().position(|card| !nearby(merged, card, next)) {
            merged.push(pending.remove(index).clone());
        }
    };
    for (index, card) in below.iter().enumerate() {
        merged.push(card.clone());
        if (index + 1) % spacing == 0 {
            place_one(&mut merged, &mut pending, index + 1);
        }
    }
    while pending
        .iter()
        .any(|card| !nearby(&merged, card, below.len()))
    {
        place_one(&mut merged, &mut pending, below.len());
    }
    merged
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::models::video::VideoSummary;

    pub fn card(id: &str, channel: &str, published_text: &str) -> Card {
        Card {
            video: VideoSummary {
                id: id.into(),
                title: format!("Video {id}"),
                channel_name: format!("Channel {channel}"),
                channel_id: Some(channel.into()),
                thumbnail_url: None,
                duration_seconds: Some(600),
                published_text: Some(published_text.into()),
                view_count_text: None,
                channel_avatar_url: None,
                is_live: false,
            },
            published_at_ms: 0,
        }
    }

    #[test]
    fn late_cards_go_below_the_viewport_away_from_their_channel() {
        let feed: Vec<Card> = (0..8)
            .map(|i| card(&format!("f{i}"), &format!("c{i}"), "1 day ago"))
            .collect();
        let late = vec![
            card("l1", "c3", "1 day ago"),
            card("l2", "new", "1 day ago"),
        ];
        let merged = insert_below_viewport(&feed, &late, 1, 2, 3, &|_| false);
        let ids: Vec<&str> = merged.iter().map(Card::id).collect();
        assert_eq!(&ids[..2], ["f0", "f1"]);
        assert!(ids.contains(&"l2"));
        let l1 = ids.iter().position(|id| *id == "l1");
        if let Some(at) = l1 {
            let f3 = ids.iter().position(|id| *id == "f3").unwrap();
            assert!(at.abs_diff(f3) > 3, "{ids:?}");
        }
    }

    #[test]
    fn a_year_old_upload_is_not_suggested() {
        assert!(is_recent_suggestion(&card("a", "c", "11 months ago"), 0));
        assert!(!is_recent_suggestion(&card("a", "c", "2 years ago"), 0));
        assert!(!is_recent_suggestion(&card("a", "c", ""), 0));
    }
}
