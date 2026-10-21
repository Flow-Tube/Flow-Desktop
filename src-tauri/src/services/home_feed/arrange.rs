//! Orders within a lane and across a page, from Flow for Android's `HomeFeedRanking`: poor fits
//! demoted (never dropped), pages laid out in short runs by source, channels spaced apart, and an
//! even share per search.

use std::collections::{HashMap, HashSet, VecDeque};

use super::card::Card;
use super::mixer::FeedSource;
use crate::flow_neuro::scoring::{FlowPersona, UserBrain};

/// Format words often tied to low-effort filler; they only demote, and only without a matching
/// interest.
const FORMAT_MARKERS: [&str; 12] = [
    "compilation",
    "satisfying",
    "hour of",
    "hours of",
    "best of",
    "ending explained",
    "full movie",
    "full episode",
    "marathon",
    "movie recap",
    "series recap",
    "all parts",
];
const DURATION_COMFORT_DEFAULT_SEC: u64 = 3600;
const DURATION_COMFORT_SKIMMER_SEC: u64 = 1500;
const FIT_PENALTY_WEIGHT: f64 = 0.6;
const OTHER_RUN: usize = 2;
const MAX_SUBS_RUN: usize = 2;

/// The viewer's comfort with long videos and the subjects that excuse a filler format.
pub struct TasteProfile {
    comfort_seconds: u64,
    affinity_topics: HashSet<String>,
}

impl TasteProfile {
    #[must_use]
    pub fn of(brain: &UserBrain, persona: &FlowPersona) -> Self {
        let comfort_seconds = match persona {
            FlowPersona::DeepDiver
            | FlowPersona::Scholar
            | FlowPersona::Binger
            | FlowPersona::Audiophile => 0,
            FlowPersona::Skimmer => DURATION_COMFORT_SKIMMER_SEC,
            _ => DURATION_COMFORT_DEFAULT_SEC,
        };
        let affinity_topics = brain
            .topic_affinities
            .iter()
            .filter(|(_, weight)| **weight > 0.0)
            .map(|(key, _)| key)
            .chain(&brain.preferred_topics)
            .map(|topic| topic.to_lowercase())
            .filter(|topic| !topic.trim().is_empty())
            .collect();
        Self {
            comfort_seconds,
            affinity_topics,
        }
    }

    /// 0 for a good fit, towards 1 for a poor one.
    #[allow(clippy::cast_precision_loss)]
    fn fit_penalty(&self, card: &Card) -> f64 {
        let mut penalty = 0.0;
        let duration = card.video.duration_seconds.unwrap_or(0);
        if self.comfort_seconds > 0 && duration > self.comfort_seconds {
            let over = (duration - self.comfort_seconds) as f64 / self.comfort_seconds as f64;
            penalty += (0.5 * over).min(0.6);
        }
        let title = card.video.title.to_lowercase();
        if FORMAT_MARKERS.iter().any(|marker| title.contains(marker))
            && !self
                .affinity_topics
                .iter()
                .any(|topic| title.contains(topic.as_str()))
        {
            penalty += 0.4;
        }
        penalty.min(1.0)
    }

    /// A stable re-rank pushing poor fits below good ones while keeping the engine's order.
    #[must_use]
    #[allow(clippy::cast_precision_loss)]
    pub fn demote(&self, ranked: Vec<Card>) -> Vec<Card> {
        if ranked.len() < 2 {
            return ranked;
        }
        let n = ranked.len() as f64;
        let mut scored: Vec<(f64, Card)> = ranked
            .into_iter()
            .enumerate()
            .map(|(i, card)| {
                let score = (1.0 - i as f64 / n) - FIT_PENALTY_WEIGHT * self.fit_penalty(&card);
                (score, card)
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        scored.into_iter().map(|(_, card)| card).collect()
    }
}

const OTHER_LANE_TURNS: [Option<FeedSource>; 6] = [
    Some(FeedSource::Related),
    Some(FeedSource::Discovery),
    Some(FeedSource::ChannelMemory),
    Some(FeedSource::Neighbours),
    Some(FeedSource::Subs),
    None,
];

/// A page in short runs so it reads as a mix: two from the other lanes, taking turns, then one or
/// two from followed channels. The first `keep_top` stay put. Followed-channel cards the rhythm
/// has no room for close the page, or with `defer_extra` wait for later pages once it holds
/// `min_size`.
#[must_use]
pub fn rhythm_by_source(
    cards: Vec<Card>,
    is_subscribed: &dyn Fn(&Card) -> bool,
    source_of: &dyn Fn(&Card) -> Option<FeedSource>,
    keep_top: usize,
    defer_extra: bool,
    min_size: usize,
) -> Vec<Card> {
    let keep = keep_top.min(cards.len());
    let (subscribed, others): (Vec<&Card>, Vec<&Card>) =
        cards[keep..].iter().partition(|card| is_subscribed(card));
    if subscribed.is_empty() || others.is_empty() {
        return cards;
    }
    let mut subs: VecDeque<&Card> = subscribed.into();
    let mut lanes: Vec<VecDeque<&Card>> = OTHER_LANE_TURNS
        .iter()
        .map(|lane| {
            others
                .iter()
                .copied()
                .filter(|card| source_of(card) == *lane)
                .collect()
        })
        .collect();
    let mut out: Vec<Card> = cards[..keep].to_vec();
    let mut turn = 0;
    let mut subs_next = keep == 0;
    while lanes.iter().any(|lane| !lane.is_empty()) {
        if subs_next && !subs.is_empty() {
            let others_left: usize = lanes.iter().map(VecDeque::len).sum();
            let run = if subs.len() * OTHER_RUN > others_left {
                MAX_SUBS_RUN
            } else {
                1
            };
            for _ in 0..run {
                if let Some(card) = subs.pop_front() {
                    out.push(card.clone());
                }
            }
        } else {
            while lanes[turn % lanes.len()].is_empty() {
                turn += 1;
            }
            let lane = &mut lanes[turn % OTHER_LANE_TURNS.len()];
            turn += 1;
            for _ in 0..OTHER_RUN {
                if let Some(card) = lane.pop_front() {
                    out.push(card.clone());
                }
            }
        }
        subs_next = !subs_next;
    }
    while let Some(card) = subs.pop_front() {
        if defer_extra && out.len() >= min_size {
            break;
        }
        out.push(card.clone());
    }
    out
}

/// Keeps same-channel cards at least `gap` apart where it can, otherwise in order; `seed_recent`
/// primes the window with the previous page's tail.
#[must_use]
pub fn space_by_channel(cards: Vec<Card>, gap: usize, seed_recent: &[String]) -> Vec<Card> {
    if cards.len() < 2 {
        return cards;
    }
    let mut remaining: VecDeque<Card> = cards.into();
    let mut out = Vec::with_capacity(remaining.len());
    let mut recent: VecDeque<String> = seed_recent
        .iter()
        .skip(seed_recent.len().saturating_sub(gap))
        .cloned()
        .collect();
    while !remaining.is_empty() {
        let index = remaining
            .iter()
            .position(|card| {
                card.channel_id().is_empty() || !recent.iter().any(|c| c == card.channel_id())
            })
            .unwrap_or(0);
        let pick = remaining.remove(index).expect("index is in range");
        if !pick.channel_id().is_empty() {
            recent.push_back(pick.channel_id().to_string());
            while recent.len() > gap {
                recent.pop_front();
            }
        }
        out.push(pick);
    }
    out
}

/// An even share of the first `limit` places per search before any search takes more.
#[must_use]
pub fn spread_across_searches(
    cards: Vec<Card>,
    query_of: &HashMap<String, String>,
    limit: usize,
) -> Vec<Card> {
    let searches: HashSet<&String> = cards.iter().filter_map(|c| query_of.get(c.id())).collect();
    if searches.len() < 2 {
        return cards.into_iter().take(limit).collect();
    }
    let share = limit.div_ceil(searches.len());
    let mut placed: HashMap<String, usize> = HashMap::new();
    let (even, overflow): (Vec<Card>, Vec<Card>) = cards.into_iter().partition(|card| {
        let Some(query) = query_of.get(card.id()) else {
            return true;
        };
        let count = placed.entry(query.clone()).or_insert(0);
        let within = *count < share;
        if within {
            *count += 1;
        }
        within
    });
    even.into_iter().chain(overflow).take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;

    #[test]
    fn a_page_reads_as_runs_of_two_other_and_one_followed() {
        let cards = vec![
            card("s1", "a", ""),
            card("s2", "b", ""),
            card("d1", "c", ""),
            card("d2", "d", ""),
            card("r1", "e", ""),
            card("r2", "f", ""),
        ];
        let followed = |c: &Card| c.id().starts_with('s');
        let source = |c: &Card| {
            Some(match &c.id()[..1] {
                "s" => FeedSource::Subs,
                "d" => FeedSource::Discovery,
                _ => FeedSource::Related,
            })
        };
        let out = rhythm_by_source(cards, &followed, &source, 0, false, 0);
        let ids: Vec<&str> = out.iter().map(Card::id).collect();
        assert_eq!(ids, ["s1", "r1", "r2", "s2", "d1", "d2"]);
    }

    #[test]
    fn channels_stay_apart_where_they_can() {
        let cards = vec![
            card("1", "a", ""),
            card("2", "a", ""),
            card("3", "b", ""),
            card("4", "c", ""),
        ];
        let ids: Vec<String> = space_by_channel(cards, 2, &[])
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        assert_eq!(ids, ["1", "3", "4", "2"]);
    }

    #[test]
    fn each_search_gets_its_share_first() {
        let cards: Vec<Card> = ["a1", "a2", "a3", "b1"]
            .iter()
            .map(|id| card(id, id, ""))
            .collect();
        let queries: HashMap<String, String> = [("a1", "a"), ("a2", "a"), ("a3", "a"), ("b1", "b")]
            .iter()
            .map(|(id, q)| ((*id).to_string(), (*q).to_string()))
            .collect();
        let ids: Vec<String> = spread_across_searches(cards, &queries, 4)
            .iter()
            .map(|c| c.id().to_string())
            .collect();
        assert_eq!(ids, ["a1", "a2", "b1", "a3"]);
    }
}
