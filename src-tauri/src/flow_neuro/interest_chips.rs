//! Home's interest chips, from Flow for Android's `InterestChips`: the viewer's heaviest interest
//! groups, kept steady for a day unless one of them grows or shrinks by more than 30 %.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::flow_neuro::clusters::TopicCluster;
use crate::flow_neuro::display_forms::{DisplayForms, label};
use crate::flow_neuro::scoring::strip_domain_tag;

pub const MAX_CHIPS: usize = 4;
/// Below this a word every subject uses names no chip.
const LABEL_MIN_SPECIFICITY: f64 = 0.5;
const MIN_MASS_SHARE: f64 = 0.08;
const RECOMPUTE_AFTER_MS: u64 = 86_400_000;
const MASS_CHANGE: f64 = 0.30;
const QUERIES_PER_INTEREST: usize = 3;

/// The chips last chosen: each group's representative and its mass then, in chip order.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InterestChipSet {
    pub masses: Vec<(String, f64)>,
    pub computed_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterestChip {
    pub key: String,
    pub label: String,
    pub topics: Vec<String>,
}

/// Each cluster with whether it may become a chip: enough of the viewer's mass and some evidence
/// behind it. Heaviest first.
#[must_use]
pub fn eligible_clusters(
    clusters: &[TopicCluster],
    has_evidence: impl Fn(&TopicCluster) -> bool,
) -> Vec<(&TopicCluster, bool)> {
    let total: f64 = clusters.iter().map(|c| c.mass).sum();
    if total <= 0.0 {
        return Vec::new();
    }
    let mut groups: Vec<(&TopicCluster, bool)> = clusters
        .iter()
        .map(|c| (c, c.mass / total >= MIN_MASS_SHARE && has_evidence(c)))
        .collect();
    groups.sort_by(|a, b| b.0.mass.total_cmp(&a.0.mass));
    groups
}

/// The set to show: `previous` while it is under a day old and none of its groups moved more than
/// 30 % or disappeared; otherwise the heaviest eligible groups.
#[must_use]
pub fn stable(
    previous: &InterestChipSet,
    groups: &[(&TopicCluster, bool)],
    now_ms: u64,
) -> InterestChipSet {
    let mass_of: HashMap<&str, f64> = groups
        .iter()
        .map(|(c, _)| (c.representative.as_str(), c.mass))
        .collect();
    let fresh =
        now_ms >= previous.computed_at && now_ms - previous.computed_at < RECOMPUTE_AFTER_MS;
    let steady = !previous.masses.is_empty()
        && previous.masses.iter().all(|(key, mass)| {
            mass_of
                .get(key.as_str())
                .is_some_and(|current| *mass > 0.0 && (current - mass).abs() / mass <= MASS_CHANGE)
        });
    if fresh && steady {
        return previous.clone();
    }
    InterestChipSet {
        masses: groups
            .iter()
            .filter(|(_, eligible)| *eligible)
            .take(MAX_CHIPS)
            .map(|(c, _)| (c.representative.clone(), c.mass))
            .collect(),
        computed_at: now_ms,
    }
}

/// The chips of `set`, each named after the topic of its group the viewer watched most, never
/// after a word every subject uses.
#[must_use]
pub fn chips(
    set: &InterestChipSet,
    clusters: &[TopicCluster],
    forms: &DisplayForms,
    specificity: impl Fn(&str) -> f64,
    evidence_of: impl Fn(&str) -> i32,
) -> Vec<InterestChip> {
    let by_key: HashMap<&str, &TopicCluster> = clusters
        .iter()
        .map(|c| (c.representative.as_str(), c))
        .collect();
    set.masses
        .iter()
        .filter_map(|(key, _)| {
            let cluster = by_key.get(key.as_str())?;
            let nameable: Vec<&String> = cluster
                .topics
                .iter()
                .filter(|t| specificity(t) >= LABEL_MIN_SPECIFICITY)
                .collect();
            let candidates = if nameable.is_empty() {
                cluster.topics.iter().collect()
            } else {
                nameable
            };
            let named = candidates
                .iter()
                .copied()
                .max_by_key(|t| evidence_of(t))
                .filter(|t| evidence_of(t) > 0)
                .or_else(|| {
                    candidates
                        .iter()
                        .copied()
                        .find(|t| **t == cluster.representative)
                })
                .or_else(|| candidates.first().copied())?;
            Some(InterestChip {
                key: cluster.representative.clone(),
                label: label(forms, named),
                topics: cluster.topics.clone(),
            })
        })
        .collect()
}

/// Searches for a chip: multi-word interests as they are, single words qualified by the chip's
/// main topic ("chess" with "openings" searches "chess openings").
#[must_use]
pub fn interest_queries(chip: &InterestChip) -> Vec<String> {
    let rep = strip_domain_tag(&chip.key);
    let members: Vec<String> = chip
        .topics
        .iter()
        .map(|t| strip_domain_tag(t))
        .filter(|t| *t != rep)
        .collect();
    let qualified = |member: &str| {
        if member.split(' ').any(|w| w == rep) {
            member.to_string()
        } else {
            format!("{rep} {member}")
        }
    };
    let mut seen = HashSet::new();
    let mut queries = Vec::new();
    let mut push = |q: String| {
        if seen.insert(q.clone()) {
            queries.push(q);
        }
    };
    if rep.contains(' ') {
        push(rep.clone());
    }
    for member in members.iter().filter(|m| m.contains(' ')) {
        push(qualified(member));
    }
    for member in members.iter().filter(|m| !m.contains(' ')) {
        push(qualified(member));
    }
    if queries.is_empty() {
        queries.push(rep);
    }
    queries.truncate(QUERIES_PER_INTEREST);
    queries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cluster(rep: &str, topics: &[&str], mass: f64) -> TopicCluster {
        TopicCluster {
            representative: rep.into(),
            topics: topics.iter().map(|t| (*t).to_string()).collect(),
            mass,
        }
    }

    #[test]
    fn small_or_unsupported_groups_are_not_chips() {
        let clusters = [
            cluster("chess", &["chess", "opening"], 5.0),
            cluster("bread", &["bread"], 0.3),
            cluster("guitar", &["guitar"], 4.0),
        ];
        let groups = eligible_clusters(&clusters, |c| c.topics.len() >= 2);
        let set = stable(&InterestChipSet::default(), &groups, 1_000);
        assert_eq!(set.masses, [("chess".to_string(), 5.0)]);
    }

    #[test]
    fn chips_stay_for_a_day_unless_a_group_moves_a_third() {
        let previous = InterestChipSet {
            masses: vec![("chess".into(), 5.0)],
            computed_at: 1_000,
        };
        let grown = [
            cluster("chess", &["chess", "opening"], 5.5),
            cluster("go", &["go", "joseki"], 9.0),
        ];
        let groups = eligible_clusters(&grown, |_| true);
        assert_eq!(stable(&previous, &groups, 2_000), previous);
        let doubled = [
            cluster("chess", &["chess", "opening"], 10.0),
            cluster("go", &["go", "joseki"], 9.0),
        ];
        let groups = eligible_clusters(&doubled, |_| true);
        assert_eq!(stable(&previous, &groups, 2_000).masses.len(), 2);
        let groups = eligible_clusters(&grown, |_| true);
        assert_eq!(
            stable(&previous, &groups, 1_000 + RECOMPUTE_AFTER_MS)
                .masses
                .len(),
            2
        );
    }

    #[test]
    fn a_chip_is_named_after_its_most_watched_specific_topic() {
        let clusters = [cluster("best", &["best", "chess", "opening"], 5.0)];
        let set = InterestChipSet {
            masses: vec![("best".into(), 5.0)],
            computed_at: 0,
        };
        let evidence = |t: &str| match t {
            "best" => 9,
            "opening" => 3,
            _ => 1,
        };
        let specific = |t: &str| if t == "best" { 0.2 } else { 1.0 };
        let named = chips(
            &set,
            &clusters,
            &DisplayForms::default(),
            specific,
            evidence,
        );
        assert_eq!(named[0].label, "Opening");
    }

    #[test]
    fn single_word_members_are_searched_with_the_main_topic() {
        let chip = InterestChip {
            key: "chess".into(),
            label: "Chess".into(),
            topics: vec!["chess".into(), "opening".into(), "magnus carlsen".into()],
        };
        assert_eq!(
            interest_queries(&chip),
            ["chess magnus carlsen", "chess opening"]
        );
    }
}
