//! Shares a ranked list between the viewer's lasting interest groups, from Flow for Android's
//! `NeuroInterestShare` (#907). Ranking by one taste fills every page with the strongest group, so
//! each group gets places in proportion to the square root of its weight and keeps its own ranked
//! order; items of no group keep the share they had.

use std::collections::{HashMap, VecDeque};

use crate::flow_neuro::clusters::TopicCluster;
use crate::flow_neuro::scoring::strip_domain_tag;

/// A group under this share of the viewer's taste is not one of their interests yet.
const MIN_GROUP_SHARE: f64 = 0.08;

/// Each group's weight: the square root of its mass, for groups above [`MIN_GROUP_SHARE`].
#[must_use]
pub fn weights(clusters: &[TopicCluster]) -> HashMap<String, f64> {
    let total: f64 = clusters.iter().map(|cluster| cluster.mass).sum();
    if total <= 0.0 {
        return HashMap::new();
    }
    clusters
        .iter()
        .filter(|cluster| cluster.mass / total >= MIN_GROUP_SHARE)
        .map(|cluster| (cluster.representative.clone(), cluster.mass.sqrt()))
        .collect()
}

/// The group `topics` hold the most of, by summed weight; none when nothing matches.
#[must_use]
pub fn group_of(
    topics: &HashMap<String, f64>,
    group_by_topic: &HashMap<String, String>,
) -> Option<String> {
    let mut by_group: HashMap<&String, f64> = HashMap::new();
    for (key, weight) in topics {
        if let Some(group) = group_by_topic.get(&strip_domain_tag(key)) {
            *by_group.entry(group).or_insert(0.0) += weight;
        }
    }
    by_group
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(group, _)| group.clone())
}

/// `ranked` reordered by weighted fair queueing over `weights`: the next place goes to the group
/// furthest below its share, and within a group the ranked order stands. Items of no group form one
/// more group sized to how many of them there are.
#[must_use]
pub fn interleave<T>(
    ranked: Vec<T>,
    weights: &HashMap<String, f64>,
    group_of: impl Fn(&T) -> Option<String>,
) -> Vec<T> {
    if ranked.len() < 2 || weights.len() < 2 {
        return ranked;
    }
    let total = ranked.len();
    let groups: Vec<Option<String>> = ranked
        .iter()
        .map(|item| group_of(item).filter(|group| weights.contains_key(group)))
        .collect();
    let mut distinct: Vec<&String> = groups.iter().flatten().collect();
    distinct.sort();
    distinct.dedup();
    if distinct.len() < 2 {
        return ranked;
    }
    // Queues in order of first appearance, which breaks ties as Android's does.
    let mut queues: Vec<(Option<String>, VecDeque<T>)> = Vec::new();
    for (item, group) in ranked.into_iter().zip(groups) {
        match queues.iter_mut().find(|(known, _)| *known == group) {
            Some((_, queue)) => queue.push_back(item),
            None => queues.push((group, VecDeque::from([item]))),
        }
    }
    let ungrouped = queues
        .iter()
        .find(|(group, _)| group.is_none())
        .map_or(0, |(_, queue)| queue.len());
    let grouped = total - ungrouped;
    let known: f64 = queues
        .iter()
        .filter_map(|(group, _)| group.as_ref().map(|group| weights[group]))
        .sum();
    #[allow(clippy::cast_precision_loss)]
    let weight_of = |group: &Option<String>| match group {
        Some(group) => weights[group],
        None => known * ungrouped as f64 / grouped as f64,
    };
    let mut served = vec![0usize; queues.len()];
    let mut out = Vec::with_capacity(total);
    while out.len() < total {
        #[allow(clippy::cast_precision_loss)]
        let next = queues
            .iter()
            .enumerate()
            .filter(|(_, (_, queue))| !queue.is_empty())
            .map(|(index, (group, _))| (index, (served[index] + 1) as f64 / weight_of(group)))
            .fold(
                None,
                |best: Option<(usize, f64)>, (index, need)| match best {
                    Some((_, least)) if least <= need => best,
                    _ => Some((index, need)),
                },
            )
            .map(|(index, _)| index)
            .unwrap_or_default();
        if let Some(item) = queues[next].1.pop_front() {
            out.push(item);
        }
        served[next] += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_interest_keeps_its_share_of_places() {
        let weights: HashMap<String, f64> =
            [("tech".to_string(), 3.0), ("anime".to_string(), 1.0)].into();
        let ranked: Vec<&str> = vec!["t1", "t2", "t3", "t4", "t5", "t6", "a1", "a2"];
        let order = interleave(ranked, &weights, |item| {
            Some(
                if item.starts_with('t') {
                    "tech"
                } else {
                    "anime"
                }
                .to_string(),
            )
        });
        assert_eq!(order, ["t1", "t2", "t3", "a1", "t4", "t5", "t6", "a2"]);
    }
}
