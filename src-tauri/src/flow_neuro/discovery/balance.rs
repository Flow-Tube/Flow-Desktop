//! From all candidate queries to at most twelve: near-duplicates dropped, every served cluster
//! kept, one of each strategy, enough distinct topics, then the most confident.

use std::collections::{HashMap, HashSet};

use super::words::{FILLER, whitespace_words};
use super::{Chance, DiscoveryQuery, Strategy};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::is_topic_sized;

const MAX_QUERIES: usize = 12;
const DUPLICATE_OVERLAP: f64 = 0.3;
const STRATEGY_PRIORITY: [Strategy; 7] = [
    Strategy::DeepDive,
    Strategy::CrossTopic,
    Strategy::Trending,
    Strategy::Contextual,
    Strategy::ChannelDiscovery,
    Strategy::AdjacentExploration,
    Strategy::FormatDriven,
];

fn keys(query: &str, spec: &KeySpec) -> Vec<String> {
    whitespace_words(&query.to_lowercase())
        .filter(|word| is_topic_sized(word))
        .map(|word| spec.key_of(word))
        .collect()
}

/// What a query is about, without words any query could hold ("best", "new").
fn topic_root(query: &str, spec: &KeySpec) -> Option<String> {
    let mut words: Vec<String> = keys(query, spec)
        .into_iter()
        .filter(|key| !FILLER.contains(key.as_str()))
        .collect();
    if words.is_empty() {
        return None;
    }
    words.sort();
    Some(words.join("|"))
}

/// 0 for confident searches, 1 for middling, 2 for the rest.
fn confidence_tier(confidence: f64) -> u8 {
    if confidence >= 0.7 {
        0
    } else if confidence >= 0.4 {
        1
    } else {
        2
    }
}

/// Drops a query sharing too many words with a kept one, unless it is its cluster's only query.
/// Cluster anchors go first: a cross combination must not absorb a young cluster's own query.
fn dedupe(mut queries: Vec<DiscoveryQuery>, spec: &KeySpec) -> Vec<DiscoveryQuery> {
    let is_anchor =
        |q: &DiscoveryQuery| q.strategy == Strategy::DeepDive && q.cluster_key.is_some();
    queries.sort_by(|a, b| {
        is_anchor(b)
            .cmp(&is_anchor(a))
            .then_with(|| b.confidence.total_cmp(&a.confidence))
    });
    let mut kept: Vec<DiscoveryQuery> = Vec::new();
    let mut seen: Vec<HashSet<String>> = Vec::new();
    for query in queries {
        let tokens: HashSet<String> = keys(&query.query, spec).into_iter().collect();
        #[allow(clippy::cast_precision_loss)]
        let duplicate = seen.iter().any(|existing| {
            !existing.is_empty()
                && !tokens.is_empty()
                && tokens.intersection(existing).count() as f64
                    / tokens.union(existing).count() as f64
                    > DUPLICATE_OVERLAP
        });
        let only_of_cluster =
            query.cluster_key.is_some() && !kept.iter().any(|q| q.cluster_key == query.cluster_key);
        if !duplicate || only_of_cluster {
            kept.push(query);
            seen.push(tokens);
        }
    }
    kept
}

pub(super) fn balance(
    queries: Vec<DiscoveryQuery>,
    topic_count: usize,
    spec: &KeySpec,
    chance: &mut Chance,
) -> Vec<DiscoveryQuery> {
    let deduped = dedupe(queries, spec);
    let min_topics = match topic_count {
        n if n >= 6 => 4,
        n if n >= 3 => 3,
        n => n.max(1),
    };
    let mut chosen: Vec<usize> = Vec::new();
    let mut covered: HashSet<String> = HashSet::new();
    let take = |index: usize, chosen: &mut Vec<usize>, covered: &mut HashSet<String>| {
        chosen.push(index);
        if let Some(root) = topic_root(&deduped[index].query, spec) {
            covered.insert(root);
        }
    };

    // Every served cluster's best query comes first.
    let mut clusters: Vec<&String> = Vec::new();
    for query in &deduped {
        if let Some(key) = &query.cluster_key
            && !clusters.contains(&key)
        {
            clusters.push(key);
        }
    }
    for key in clusters {
        let best = deduped
            .iter()
            .enumerate()
            .filter(|(_, q)| q.cluster_key.as_ref() == Some(key))
            .fold(None, |best: Option<(usize, f64)>, (index, q)| match best {
                Some((_, top)) if top >= q.confidence => best,
                _ => Some((index, q.confidence)),
            });
        if let Some((index, _)) = best
            && !chosen.contains(&index)
        {
            take(index, &mut chosen, &mut covered);
        }
    }
    // One of each strategy.
    for strategy in STRATEGY_PRIORITY {
        if chosen.iter().any(|&i| deduped[i].strategy == strategy) {
            continue;
        }
        if let Some(index) =
            (0..deduped.len()).find(|&i| deduped[i].strategy == strategy && !chosen.contains(&i))
        {
            take(index, &mut chosen, &mut covered);
        }
    }
    // Enough distinct topics.
    if covered.len() < min_topics {
        for (index, query) in deduped.iter().enumerate() {
            if chosen.contains(&index) {
                continue;
            }
            if let Some(root) = topic_root(&query.query, spec)
                && !covered.contains(&root)
            {
                take(index, &mut chosen, &mut covered);
                if covered.len() >= min_topics {
                    break;
                }
            }
        }
    }
    // The most confident of the rest, two per topic and three per strategy.
    let mut per_topic: HashMap<String, usize> = HashMap::new();
    for &index in &chosen {
        if let Some(root) = topic_root(&deduped[index].query, spec) {
            *per_topic.entry(root).or_insert(0) += 1;
        }
    }
    let mut rest: Vec<usize> = (0..deduped.len()).filter(|i| !chosen.contains(i)).collect();
    rest.sort_by(|&a, &b| deduped[b].confidence.total_cmp(&deduped[a].confidence));
    for index in rest {
        if chosen.len() >= MAX_QUERIES {
            break;
        }
        let root = topic_root(&deduped[index].query, spec);
        if root
            .as_ref()
            .is_some_and(|root| per_topic.get(root).copied().unwrap_or(0) >= 2)
        {
            continue;
        }
        let strategy = deduped[index].strategy;
        if chosen
            .iter()
            .filter(|&&i| deduped[i].strategy == strategy)
            .count()
            >= 3
        {
            continue;
        }
        chosen.push(index);
        if let Some(root) = root {
            *per_topic.entry(root).or_insert(0) += 1;
        }
    }

    shuffle_within_tiers(deduped, &chosen, chance)
}

/// The chosen queries, confident ones first, shuffled within each tier for variety.
fn shuffle_within_tiers(
    deduped: Vec<DiscoveryQuery>,
    chosen: &[usize],
    chance: &mut Chance,
) -> Vec<DiscoveryQuery> {
    let mut tiers: [Vec<DiscoveryQuery>; 3] = Default::default();
    let mut slots: Vec<Option<DiscoveryQuery>> = deduped.into_iter().map(Some).collect();
    for &index in chosen {
        if let Some(query) = slots[index].take() {
            tiers[usize::from(confidence_tier(query.confidence))].push(query);
        }
    }
    let mut out = Vec::new();
    for mut tier in tiers {
        chance.shuffle(&mut tier);
        out.extend(tier);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(text: &str, strategy: Strategy, confidence: f64, cluster: Option<&str>) -> DiscoveryQuery {
        DiscoveryQuery {
            query: text.into(),
            strategy,
            confidence,
            cluster_key: cluster.map(String::from),
        }
    }

    #[test]
    fn every_cluster_keeps_a_query_however_much_it_overlaps() {
        let spec = KeySpec::default();
        let queries = vec![
            q("android mma", Strategy::CrossTopic, 0.9, Some("android")),
            q("mma", Strategy::DeepDive, 0.5, Some("mma")),
            q("anime", Strategy::DeepDive, 0.6, Some("anime")),
        ];
        let out = balance(queries, 3, &spec, &mut Chance(1));
        let texts: HashSet<&str> = out.iter().map(|q| q.query.as_str()).collect();
        assert!(texts.contains("mma") && texts.contains("anime") && texts.contains("android mma"));
    }
}
