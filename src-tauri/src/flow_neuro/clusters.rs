//! The viewer's interests grouped into communities and served in rotation, from Flow for Android's
//! `NeuroClusters`: label propagation over the brain's own evidence (topic links, channel profiles,
//! channels watched together, and catalog categories linking topics the viewer already has), then a
//! scheduler where staleness lets every group reach discovery and a square root keeps the largest
//! from taking every slot. Pure and deterministic.

use std::collections::HashMap;

use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::scoring::strip_domain_tag;
use crate::flow_neuro::topic_catalog::TOPIC_CATEGORIES;

const MASS_EXPONENT: f64 = 0.5;
/// Staleness doubles priority every this many hours since a cluster was last served.
const STALENESS_HALF_LIFE_HOURS: f64 = 12.0;
const STALENESS_MAX: f64 = 4.0;
/// A cluster whose topics were all first seen this recently is new and waits its turn.
const NEW_CLUSTER_MS: u64 = 3 * 24 * 3_600_000;
const MIN_EDGE_WEIGHT: f64 = 0.02;
const CHANNEL_PROFILE_TOP_TOPICS: usize = 6;
const CHANNEL_EDGE_SCALE: f64 = 0.5;
const CATALOG_EDGE_WEIGHT: f64 = 0.3;
const COWATCH_TOP_TOPICS: usize = 2;
const COWATCH_EDGE_SCALE: f64 = 0.3;
const PROPAGATION_ITERATIONS: usize = 5;
const SELF_WEIGHT_SCALE: f64 = 0.5;

#[derive(Debug, Clone, PartialEq)]
pub struct TopicCluster {
    pub representative: String,
    pub topics: Vec<String>,
    pub mass: f64,
}

/// What clusters are built from.
pub struct ClusterInputs<'a> {
    /// The viewer's interests, key to weight.
    pub topic_scores: &'a HashMap<String, f64>,
    pub affinities: &'a HashMap<String, f64>,
    pub channel_topic_profiles: &'a HashMap<String, HashMap<String, f64>>,
    /// Confirmed pairs of channels watched together ("a|b" to strength).
    pub channel_edges: &'a HashMap<String, f64>,
    pub spec: &'a KeySpec,
}

struct Graph {
    scores: HashMap<String, f64>,
    adjacency: HashMap<String, HashMap<String, f64>>,
}

impl Graph {
    fn add_edge(&mut self, a: &str, b: &str, weight: f64) {
        if a == b
            || weight < MIN_EDGE_WEIGHT
            || !self.scores.contains_key(a)
            || !self.scores.contains_key(b)
        {
            return;
        }
        *self
            .adjacency
            .entry(a.to_string())
            .or_default()
            .entry(b.to_string())
            .or_insert(0.0) += weight;
        *self
            .adjacency
            .entry(b.to_string())
            .or_default()
            .entry(a.to_string())
            .or_insert(0.0) += weight;
    }
}

fn top_topics(profile: &HashMap<String, f64>, take: usize) -> Vec<(String, f64)> {
    let mut ranked: Vec<(&String, f64)> = profile.iter().map(|(k, &v)| (k, v)).collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked
        .into_iter()
        .take(take)
        .map(|(key, weight)| (strip_domain_tag(key), weight))
        .collect()
}

fn graph(inputs: &ClusterInputs) -> Graph {
    let mut scores: HashMap<String, f64> = HashMap::new();
    for (topic, &score) in inputs.topic_scores {
        let base = strip_domain_tag(topic);
        if is_topic_sized(&base) {
            let entry = scores.entry(base).or_insert(score);
            *entry = entry.max(score);
        }
    }
    let mut graph = Graph {
        scores,
        adjacency: HashMap::new(),
    };
    for (key, &weight) in inputs.affinities {
        if let Some((a, b)) = key.split_once('|') {
            graph.add_edge(a, b, weight);
        }
    }
    // Topics taught by the same channel belong together.
    for profile in inputs.channel_topic_profiles.values() {
        let top = top_topics(profile, CHANNEL_PROFILE_TOP_TOPICS);
        for (i, (a, wa)) in top.iter().enumerate() {
            for (b, wb) in &top[i + 1..] {
                graph.add_edge(a, b, wa.min(*wb) * CHANNEL_EDGE_SCALE);
            }
        }
    }
    // Channels watched together: their main topics belong together.
    let main_topics = |channel: &str| -> Vec<String> {
        inputs
            .channel_topic_profiles
            .get(channel)
            .map(|profile| {
                top_topics(profile, COWATCH_TOP_TOPICS)
                    .into_iter()
                    .map(|(topic, _)| topic)
                    .collect()
            })
            .unwrap_or_default()
    };
    for (key, &strength) in inputs.channel_edges {
        let Some((first, second)) = key.split_once('|') else {
            continue;
        };
        let second = main_topics(second);
        for a in main_topics(first) {
            for b in &second {
                graph.add_edge(&a, b, strength * COWATCH_EDGE_SCALE);
            }
        }
    }
    // Catalog categories link only topics the viewer already has.
    for category in &TOPIC_CATEGORIES {
        let present: Vec<String> = category
            .topics
            .iter()
            .map(|topic| inputs.spec.key_of(&topic.to_lowercase()))
            .filter(|key| graph.scores.contains_key(key))
            .collect();
        for (i, a) in present.iter().enumerate() {
            for b in &present[i + 1..] {
                graph.add_edge(a, b, CATALOG_EDGE_WEIGHT);
            }
        }
    }
    graph
}

fn by_score_then_name(
    scores: &HashMap<String, f64>,
) -> impl Fn(&String, &String) -> std::cmp::Ordering + '_ {
    move |a, b| scores[b].total_cmp(&scores[a]).then_with(|| a.cmp(b))
}

/// The viewer's interest clusters, the heaviest first. Keys are read without their domain tag so
/// every source of evidence names a topic alike.
#[must_use]
pub fn build_clusters(inputs: &ClusterInputs) -> Vec<TopicCluster> {
    let graph = graph(inputs);
    if graph.scores.is_empty() {
        return Vec::new();
    }
    let mut nodes: Vec<String> = graph.scores.keys().cloned().collect();
    nodes.sort_by(by_score_then_name(&graph.scores));
    let mut labels: HashMap<String, String> = nodes
        .iter()
        .map(|node| (node.clone(), node.clone()))
        .collect();
    for _ in 0..PROPAGATION_ITERATIONS {
        let mut changed = false;
        for node in &nodes {
            let mut weight_by_label: HashMap<String, f64> = HashMap::new();
            weight_by_label.insert(labels[node].clone(), graph.scores[node] * SELF_WEIGHT_SCALE);
            if let Some(neighbours) = graph.adjacency.get(node) {
                for (neighbour, weight) in neighbours {
                    *weight_by_label
                        .entry(labels[neighbour].clone())
                        .or_insert(0.0) += weight;
                }
            }
            let best = weight_by_label
                .into_iter()
                .min_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)))
                .map_or_else(|| node.clone(), |(label, _)| label);
            if best != labels[node] {
                labels.insert(node.clone(), best);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut members: HashMap<String, Vec<String>> = HashMap::new();
    for (node, label) in labels {
        members.entry(label).or_default().push(node);
    }
    let mut clusters: Vec<TopicCluster> = members
        .into_values()
        .map(|mut topics| {
            topics.sort_by(by_score_then_name(&graph.scores));
            TopicCluster {
                representative: topics[0].clone(),
                mass: topics.iter().map(|topic| graph.scores[topic]).sum(),
                topics,
            }
        })
        .collect();
    clusters.sort_by(|a, b| {
        b.mass
            .total_cmp(&a.mass)
            .then_with(|| a.representative.cmp(&b.representative))
    });
    clusters
}

/// Clusters in serving order: `mass^0.5 × staleness`. A cluster never served gets the most
/// staleness, so every interest reaches discovery within a few refreshes; a cluster whose topics are
/// all under three days old waits while the viewer has a lasting interest, so a burst of watching
/// does not jump ahead of it.
#[must_use]
pub fn schedule(
    clusters: Vec<TopicCluster>,
    rotation: &HashMap<String, u64>,
    now_ms: u64,
    first_seen_at: &dyn Fn(&str) -> Option<u64>,
) -> Vec<TopicCluster> {
    let ages: Vec<Vec<Option<u64>>> = clusters
        .iter()
        .map(|cluster| {
            cluster
                .topics
                .iter()
                .map(|topic| {
                    first_seen_at(topic)
                        .filter(|at| *at > 0)
                        .map(|at| now_ms.saturating_sub(at))
                })
                .collect()
        })
        .collect();
    let has_lasting_interest = ages.iter().any(|topic_ages| {
        topic_ages
            .iter()
            .any(|age| age.is_some_and(|age| age >= NEW_CLUSTER_MS))
    });
    let mut weighted: Vec<(TopicCluster, f64)> = clusters
        .into_iter()
        .zip(ages)
        .map(|(cluster, topic_ages)| {
            let is_new = has_lasting_interest
                && !topic_ages.is_empty()
                && topic_ages
                    .iter()
                    .all(|age| age.is_some_and(|age| age < NEW_CLUSTER_MS));
            let staleness = if is_new {
                1.0
            } else {
                match rotation.get(&cluster.representative).copied() {
                    Some(served) if served > 0 => {
                        #[allow(clippy::cast_precision_loss)]
                        let hours = now_ms.saturating_sub(served) as f64 / 3_600_000.0;
                        (1.0 + hours / STALENESS_HALF_LIFE_HOURS).min(STALENESS_MAX)
                    }
                    _ => STALENESS_MAX,
                }
            };
            let weight = cluster.mass.powf(MASS_EXPONENT) * staleness;
            (cluster, weight)
        })
        .collect();
    weighted.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.representative.cmp(&b.0.representative))
    });
    weighted.into_iter().map(|(cluster, _)| cluster).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scores(pairs: &[(&str, f64)]) -> HashMap<String, f64> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), *v)).collect()
    }

    #[test]
    fn linked_topics_form_one_cluster_and_unlinked_ones_their_own() {
        let topic_scores = scores(&[("guitar", 0.6), ("amp", 0.3), ("chess", 0.4)]);
        let affinities = scores(&[("amp|guitar", 0.5)]);
        let none = HashMap::new();
        let clusters = build_clusters(&ClusterInputs {
            topic_scores: &topic_scores,
            affinities: &affinities,
            channel_topic_profiles: &none,
            channel_edges: &HashMap::new(),
            spec: &KeySpec::default(),
        });
        assert_eq!(clusters.len(), 2);
        assert_eq!(clusters[0].representative, "guitar");
        assert_eq!(clusters[0].topics, ["guitar", "amp"]);
        assert!((clusters[0].mass - 0.9).abs() < 1e-12);
        assert_eq!(clusters[1].topics, ["chess"]);
    }

    #[test]
    fn a_cluster_served_lately_waits_behind_one_never_served() {
        let big = TopicCluster {
            representative: "guitar".into(),
            topics: vec!["guitar".into()],
            mass: 1.5,
        };
        let small = TopicCluster {
            representative: "chess".into(),
            topics: vec!["chess".into()],
            mass: 0.15,
        };
        let now = 100 * 3_600_000;
        let rotation: HashMap<String, u64> = [("guitar".to_string(), now)].into();
        let order = schedule(vec![big, small], &rotation, now, &|_| None);
        assert_eq!(order[0].representative, "chess");
    }
}
