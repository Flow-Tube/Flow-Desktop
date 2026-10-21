//! Why a card is on Home, shown on its "Why you see this" line, from Flow for Android's
//! `HomeCardOrigin`.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::card::Card;
use super::mixer::FeedSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OriginKind {
    Subscription,
    Related,
    Search,
    ChannelMemory,
    Neighbour,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub kind: OriginKind,
    /// The seed video's title, the search, or the viewer's channels a neighbour sits next to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Origin {
    #[must_use]
    pub fn new(kind: OriginKind, detail: Option<String>) -> Self {
        Self { kind, detail }
    }
}

/// What a page's cards came from: the lane that placed each, and what found it.
#[derive(Default)]
pub struct Provenance<'a> {
    pub source_of: HashMap<String, FeedSource>,
    pub seed_titles: HashMap<String, String>,
    pub queries: HashMap<String, String>,
    pub followed: Option<&'a HashSet<String>>,
    pub neighbour_pointers: HashMap<String, String>,
}

impl Provenance<'_> {
    /// The origin of each card: its lane's, or for a card no lane claims, the seed or search that
    /// found it, or a followed channel.
    #[must_use]
    pub fn origins(&self, cards: &[Card]) -> HashMap<String, Origin> {
        cards
            .iter()
            .filter_map(|card| {
                let id = card.id();
                let origin = match self.source_of.get(id) {
                    Some(FeedSource::Related) => {
                        Origin::new(OriginKind::Related, self.seed_titles.get(id).cloned())
                    }
                    Some(FeedSource::Discovery) => {
                        Origin::new(OriginKind::Search, self.queries.get(id).cloned())
                    }
                    Some(FeedSource::ChannelMemory) => Origin::new(OriginKind::ChannelMemory, None),
                    Some(FeedSource::Subs) => Origin::new(OriginKind::Subscription, None),
                    Some(FeedSource::Neighbours) => Origin::new(
                        OriginKind::Neighbour,
                        self.neighbour_pointers.get(card.channel_id()).cloned(),
                    ),
                    None if self.seed_titles.contains_key(id) => {
                        Origin::new(OriginKind::Related, self.seed_titles.get(id).cloned())
                    }
                    None if self.queries.contains_key(id) => {
                        Origin::new(OriginKind::Search, self.queries.get(id).cloned())
                    }
                    None if self.followed.is_some_and(|f| f.contains(card.channel_id())) => {
                        Origin::new(OriginKind::Subscription, None)
                    }
                    None => return None,
                };
                Some((id.to_string(), origin))
            })
            .collect()
    }
}

/// The search each video came from; a video several searches returned keeps the first.
#[must_use]
pub fn queries_by_id(searches: &[(String, Vec<Card>)]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (query, cards) in searches {
        for card in cards {
            out.entry(card.id().to_string())
                .or_insert_with(|| query.clone());
        }
    }
    out
}
