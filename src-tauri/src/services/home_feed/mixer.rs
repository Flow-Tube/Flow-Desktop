//! Filling a page from the lanes by quota, from Flow for Android's `HomeFeedMixer`.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use super::card::Card;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FeedSource {
    Subs,
    Related,
    Discovery,
    /// Uploads of channels the viewer keeps watching without subscribing.
    ChannelMemory,
    /// Uploads of channels several of the viewer's channels sit next to.
    Neighbours,
}

impl FeedSource {
    pub const ALL: [Self; 5] = [
        Self::Subs,
        Self::Related,
        Self::Discovery,
        Self::ChannelMemory,
        Self::Neighbours,
    ];
}

/// How many of `remaining` slots each lane may take.
#[must_use]
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
pub fn quotas(
    remaining: usize,
    sub_count: usize,
    total_interactions: i32,
    has_neighbours: bool,
) -> HashMap<FeedSource, usize> {
    if remaining == 0 {
        return FeedSource::ALL.iter().map(|s| (*s, 0)).collect();
    }
    let slots = remaining as f64;
    let share = |fraction: f64| (slots * fraction) as usize;
    let mature = total_interactions > 50;
    let subs = match (sub_count, mature) {
        (0, _) => 0,
        (_, true) => share(0.40),
        _ => share(0.35),
    };
    let related = match (sub_count, mature) {
        (0, _) => share(0.35),
        (_, true) => share(0.25),
        _ => share(0.30),
    };
    let discovery = if sub_count == 0 {
        share(0.45)
    } else {
        share(0.25)
    };
    // About an eighth of the page: the share the retired trending lane used to get.
    let remainder = remaining.saturating_sub(subs + related + discovery);
    let neighbours = if has_neighbours && mature {
        (remainder / 2).min(share(0.10))
    } else {
        0
    };
    HashMap::from([
        (FeedSource::Subs, subs),
        (FeedSource::Related, related),
        (FeedSource::Discovery, discovery),
        (FeedSource::ChannelMemory, remainder - neighbours),
        (FeedSource::Neighbours, neighbours),
    ])
}

/// The page being filled: its cards, how many each channel has, and every id already used.
#[derive(Default)]
pub struct Page {
    pub cards: Vec<Card>,
    pub channel_counts: HashMap<String, usize>,
    pub used_ids: HashSet<String>,
}

impl Page {
    /// Adds `card` unless its id was used or its channel already has `max_per_channel`.
    pub fn add(&mut self, card: &Card, max_per_channel: usize) -> bool {
        let channel = card.channel_id();
        let count = self.channel_counts.get(channel).copied().unwrap_or(0);
        if !channel.is_empty() && count >= max_per_channel {
            return false;
        }
        if !self.used_ids.insert(card.id().to_string()) {
            return false;
        }
        self.cards.push(card.clone());
        if !channel.is_empty() {
            self.channel_counts.insert(channel.to_string(), count + 1);
        }
        true
    }

    /// Adds `candidates` in order, one per channel, until the page holds `target` cards.
    pub fn fill<'a>(
        &mut self,
        candidates: impl IntoIterator<Item = &'a Card>,
        target: usize,
    ) -> usize {
        let mut added = 0;
        for card in candidates {
            if self.cards.len() >= target {
                break;
            }
            if self.add(card, 1) {
                added += 1;
            }
        }
        added
    }
}

/// What the blend placed and from which lane.
pub struct Blend {
    pub items: Vec<(Card, FeedSource)>,
    pub counts: HashMap<FeedSource, usize>,
}

const QUOTA_ORDER: [FeedSource; 5] = FeedSource::ALL;
const SCARCITY_ORDER: [FeedSource; 3] =
    [FeedSource::Related, FeedSource::Discovery, FeedSource::Subs];

/// Round-robin over the lanes up to each quota, then the main lanes fill what the others could
/// not. Channel memory and neighbours never pass their quotas, and a channel they serve appears
/// once. One card per channel first; a second only fills what is left, at the end.
pub fn blend(
    lanes: &HashMap<FeedSource, Vec<Card>>,
    quotas: &HashMap<FeedSource, usize>,
    target: usize,
    page: &mut Page,
    single_channels: &HashSet<String>,
) -> Blend {
    let mut out = Blend {
        items: Vec::new(),
        counts: HashMap::new(),
    };
    if target == 0 {
        return out;
    }
    let mut queues: HashMap<FeedSource, VecDeque<Card>> = FeedSource::ALL
        .iter()
        .map(|source| {
            (
                *source,
                lanes.get(source).cloned().unwrap_or_default().into(),
            )
        })
        .collect();
    let mut skipped: HashMap<FeedSource, VecDeque<Card>> = HashMap::new();
    for per_channel in [1, 2] {
        if per_channel == 2
            && (out.items.len() >= target || skipped.values().all(VecDeque::is_empty))
        {
            break;
        }
        if per_channel == 2 {
            queues = std::mem::take(&mut skipped);
        }
        let mut take = |card: Option<Card>,
                        source: FeedSource,
                        out: &mut Blend,
                        skipped: &mut HashMap<FeedSource, VecDeque<Card>>| {
            let Some(card) = card else {
                return false;
            };
            let cap = if single_channels.contains(card.channel_id()) {
                1
            } else {
                per_channel
            };
            if page.add(&card, cap) {
                out.items.push((card, source));
                *out.counts.entry(source).or_insert(0) += 1;
                true
            } else {
                if per_channel == 1 && !page.used_ids.contains(card.id()) {
                    skipped.entry(source).or_default().push_back(card);
                }
                false
            }
        };
        while out.items.len() < target && queues.values().any(|q| !q.is_empty()) {
            let mut added = false;
            for source in QUOTA_ORDER {
                if out.items.len() >= target {
                    break;
                }
                let under = out.counts.get(&source).copied().unwrap_or(0)
                    < quotas.get(&source).copied().unwrap_or(0);
                if under {
                    let next = queues.get_mut(&source).and_then(VecDeque::pop_front);
                    added |= take(next, source, &mut out, &mut skipped);
                }
            }
            if !added {
                // A rejected head must not end the refill while the lane still holds usable cards.
                let forced = SCARCITY_ORDER.iter().any(|source| {
                    while let Some(card) = queues.get_mut(source).and_then(VecDeque::pop_front) {
                        if take(Some(card), *source, &mut out, &mut skipped) {
                            return true;
                        }
                    }
                    false
                });
                if !forced {
                    break;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::home_feed::filters::tests::card;

    #[test]
    fn quotas_follow_the_viewer() {
        let cold = quotas(40, 0, 10, false);
        assert_eq!(cold[&FeedSource::Subs], 0);
        assert_eq!(cold[&FeedSource::Discovery], 18);
        let mature = quotas(38, 30, 200, true);
        assert_eq!(mature[&FeedSource::Subs], 15);
        assert_eq!(mature[&FeedSource::Related], 9);
        assert_eq!(mature[&FeedSource::Discovery], 9);
        assert_eq!(mature.values().sum::<usize>(), 38);
    }

    #[test]
    fn the_blend_takes_one_card_per_channel_before_a_second() {
        let lanes = HashMap::from([
            (
                FeedSource::Subs,
                vec![
                    card("s1", "a", ""),
                    card("s2", "a", ""),
                    card("s3", "b", ""),
                ],
            ),
            (FeedSource::Discovery, vec![card("d1", "c", "")]),
        ]);
        let quotas = HashMap::from([(FeedSource::Subs, 3), (FeedSource::Discovery, 1)]);
        let mut page = Page::default();
        let blend = blend(&lanes, &quotas, 4, &mut page, &HashSet::new());
        let ids: Vec<&str> = blend.items.iter().map(|(c, _)| c.id()).collect();
        assert_eq!(ids, ["s1", "d1", "s3", "s2"]);
    }
}
