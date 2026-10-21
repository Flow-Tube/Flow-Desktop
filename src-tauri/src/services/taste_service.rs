//! What Your taste shows, from Flow for Android's `TasteTopics` and `TasteViewModel`: the viewer's
//! picks with how often they watched each, the interests learned in the groups the engine reads
//! them in, and the hidden channels by name.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::db::watch_history::channel_names;
use crate::flow_neuro::display_forms::label;
use crate::flow_neuro::features::pick_keys;
use crate::flow_neuro::rank::clusters_of;
use crate::flow_neuro::scoring::{UserBrain, strip_domain_tag};
use crate::flow_neuro::specificity::specificity;
use crate::services::home_feed::inputs::subscriptions;
use crate::services::recommendation_service::RecommendationService;

const GROUP_COUNT: usize = 8;
const GROUP_LABEL_WORDS: usize = 3;
/// A word every subject uses is no interest to show, however often titles had it.
const TASTE_MIN_SPECIFICITY: f64 = 0.3;
/// A group is named by words of one subject; a commoner word still counts among its members.
const GROUP_NAME_MIN_SPECIFICITY: f64 = 0.5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteTopic {
    pub key: String,
    /// As titles write it; this is what a boost stores, so the pick reads as the viewer knows it.
    pub label: String,
    /// How often the viewer watched, liked or searched it.
    pub evidence: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteGroup {
    pub id: String,
    pub label: String,
    /// Relative to the strongest group.
    pub share: f64,
    pub evidence: i32,
    pub members: Vec<TasteTopic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedChannel {
    pub id: String,
    /// Empty when no name is known on this device.
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasteOverview {
    pub picks: Vec<TasteTopic>,
    pub groups: Vec<TasteGroup>,
    pub hidden_channels: Vec<NamedChannel>,
}

fn evidence_of(brain: &UserBrain, key: &str) -> i32 {
    brain
        .topic_evidence
        .get(key)
        .map_or(0, |e| e.watch_signals + e.explicit_signals)
}

/// The picks as the viewer chose them, the ones they watch most first.
fn picks(brain: &UserBrain) -> Vec<TasteTopic> {
    let spec = brain.key_spec();
    let mut picks: Vec<TasteTopic> = brain
        .preferred_topics
        .iter()
        .map(|pick| {
            let keys = spec.keys_of(pick);
            TasteTopic {
                key: pick.clone(),
                label: match keys.as_slice() {
                    [only] => label(&brain.display_forms, only),
                    _ => pick.clone(),
                },
                evidence: keys
                    .iter()
                    .map(|k| evidence_of(brain, k))
                    .max()
                    .unwrap_or(0),
            }
        })
        .collect();
    picks.sort_by(|a, b| {
        b.evidence
            .cmp(&a.evidence)
            .then_with(|| a.label.cmp(&b.label))
    });
    picks
}

/// The learned interests in their groups, strongest first, each named by its three strongest
/// words of one subject: "Pixel · Android · Camera" says more than "Pixel". Picks stay out.
fn groups(
    brain: &UserBrain,
    clusters: &[crate::flow_neuro::clusters::TopicCluster],
    specific: &dyn Fn(&str) -> f64,
) -> Vec<TasteGroup> {
    let picked = pick_keys(brain);
    let blocked: HashSet<&String> = brain.blocked_topics.iter().collect();
    let weights = &brain.global_vector.topics;
    let mut kept: Vec<(&crate::flow_neuro::clusters::TopicCluster, Vec<&String>)> = clusters
        .iter()
        .filter_map(|cluster| {
            let mut members: Vec<&String> = cluster
                .topics
                .iter()
                .filter(|key| weights.get(*key).copied().unwrap_or(0.0) > 0.0)
                .filter(|key| !blocked.contains(key) && !picked.contains(&strip_domain_tag(key)))
                .filter(|key| specific(key) >= TASTE_MIN_SPECIFICITY)
                .collect();
            if members.is_empty() {
                return None;
            }
            members.sort_by(|a, b| weights[*b].total_cmp(&weights[*a]).then_with(|| a.cmp(b)));
            Some((cluster, members))
        })
        .collect();
    kept.sort_by(|a, b| b.0.mass.total_cmp(&a.0.mass));
    kept.truncate(GROUP_COUNT);
    let strongest = kept
        .first()
        .map_or(1.0, |(c, _)| c.mass)
        .max(f64::MIN_POSITIVE);
    kept.into_iter()
        .map(|(cluster, members)| {
            let topics: Vec<TasteTopic> = members
                .into_iter()
                .map(|key| TasteTopic {
                    key: key.clone(),
                    label: label(&brain.display_forms, key),
                    evidence: evidence_of(brain, key),
                })
                .collect();
            let nameable: Vec<&TasteTopic> = topics
                .iter()
                .filter(|t| specific(&t.key) >= GROUP_NAME_MIN_SPECIFICITY)
                .collect();
            let naming = if nameable.is_empty() {
                topics.iter().collect()
            } else {
                nameable
            };
            TasteGroup {
                id: cluster.representative.clone(),
                label: naming
                    .iter()
                    .take(GROUP_LABEL_WORDS)
                    .map(|t| t.label.as_str())
                    .collect::<Vec<_>>()
                    .join(" · "),
                share: cluster.mass / strongest,
                evidence: topics.iter().map(|t| t.evidence).max().unwrap_or(0),
                members: topics,
            }
        })
        .collect()
}

/// Named channels by name, then the ones without a name by id.
fn hidden_channel_order(mut channels: Vec<NamedChannel>) -> Vec<NamedChannel> {
    channels.sort_by(|a, b| {
        a.name
            .is_empty()
            .cmp(&b.name.is_empty())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    channels
}

impl RecommendationService {
    pub async fn taste_overview(&self) -> TasteOverview {
        let mut names: HashMap<String, String> = channel_names(&self.pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect();
        names.extend(self.stores.co_watch.names());
        if let Ok(subscriptions) = subscriptions(&self.pool).await {
            names.extend(
                subscriptions
                    .names
                    .into_iter()
                    .filter(|(_, name)| !name.is_empty()),
            );
        }
        self.with_rank_context(&HashSet::new(), 0.0, false, |ctx| {
            let brain = ctx.brain;
            let table = specificity(&brain.key_spec());
            let specific = |key: &str| table.of(key);
            TasteOverview {
                picks: picks(brain),
                groups: groups(brain, &clusters_of(ctx), &specific),
                hidden_channels: hidden_channel_order(
                    brain
                        .blocked_channels
                        .iter()
                        .map(|id| NamedChannel {
                            id: id.clone(),
                            name: names.get(id).cloned().unwrap_or_default(),
                        })
                        .collect(),
                ),
            }
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::clusters::TopicCluster;

    #[test]
    fn a_group_is_named_by_its_three_strongest_specific_words() {
        let mut brain = UserBrain::default();
        for (key, weight) in [
            ("pixel", 0.9),
            ("best", 0.8),
            ("android", 0.7),
            ("camera", 0.6),
            ("leak", 0.5),
        ] {
            brain.global_vector.topics.insert(key.into(), weight);
        }
        let cluster = TopicCluster {
            representative: "pixel".into(),
            topics: ["pixel", "best", "android", "camera", "leak"]
                .map(String::from)
                .to_vec(),
            mass: 3.5,
        };
        let specific = |key: &str| if key == "best" { 0.35 } else { 1.0 };
        let groups = groups(&brain, &[cluster], &specific);
        assert_eq!(groups[0].label, "Pixel · Android · Camera");
        assert_eq!(groups[0].members.len(), 5);
    }

    #[test]
    fn hidden_channels_with_names_come_first() {
        let order = hidden_channel_order(vec![
            NamedChannel {
                id: "UC2".into(),
                name: String::new(),
            },
            NamedChannel {
                id: "UC1".into(),
                name: "zeta".into(),
            },
            NamedChannel {
                id: "UC3".into(),
                name: "Alpha".into(),
            },
        ]);
        let ids: Vec<&str> = order.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["UC3", "UC1", "UC2"]);
    }
}
