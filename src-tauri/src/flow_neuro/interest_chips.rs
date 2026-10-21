//! Home's interest chips, from Flow for Android's `InterestChips`: the viewer's heaviest interest
//! groups, kept steady for a day unless one of them grows or shrinks by more than 30 %. Clusters
//! in one theme category (Gaming, Sports, ...) become a single theme chip.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::flow_neuro::categories::is_theme;
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
pub const THEME_PREFIX: &str = "theme:";
/// Distinct interests one cluster needs to read as a theme rather than by its strongest topic.
const THEME_MIN_INTERESTS: usize = 3;

/// The chips last chosen: each group's key and its mass then, in chip order.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InterestChipSet {
    pub masses: Vec<(String, f64)>,
    pub computed_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterestChip {
    /// A cluster's representative, or `theme:<category>`.
    pub key: String,
    pub label: String,
    pub topics: Vec<String>,
    /// The theme category; the page names a theme chip after it.
    pub category: Option<String>,
    /// A theme's interests, each searched in turn.
    pub parts: Vec<InterestChip>,
}

/// A chip candidate: one cluster, or a theme of clusters in the same category. Only eligible ones
/// are chosen anew.
#[derive(Debug, Clone)]
pub struct Group<'a> {
    pub key: String,
    pub members: Vec<&'a TopicCluster>,
    pub category: Option<String>,
    pub eligible: bool,
}

impl Group<'_> {
    fn mass(&self) -> f64 {
        self.members.iter().map(|c| c.mass).sum()
    }
}

/// A cluster's topics split into interests that share no word: "minecraft redstone" joins
/// "minecraft", "fortnite" stands apart.
#[must_use]
pub fn distinct_interests(cluster: &TopicCluster) -> Vec<Vec<String>> {
    let words = |topic: &str| -> Vec<String> {
        strip_domain_tag(topic)
            .split(' ')
            .map(str::to_string)
            .collect()
    };
    let mut interests: Vec<Vec<String>> = Vec::new();
    for topic in &cluster.topics {
        let own = words(topic);
        match interests.iter_mut().find(|interest| {
            interest
                .iter()
                .any(|other| words(other).iter().any(|w| own.contains(w)))
        }) {
            Some(interest) => interest.push(topic.clone()),
            None => interests.push(vec![topic.clone()]),
        }
    }
    interests
}

/// Every cluster as a chip candidate, heaviest first. Eligible are those with enough of the
/// viewer's mass and some evidence behind them. Eligible clusters in one theme category become a
/// single theme when there are two of them, or one holding three distinct interests: "Gaming"
/// reads truer than "Minecraft" for a cluster of three games, and leaves room for the others.
#[must_use]
pub fn groups(
    clusters: &[TopicCluster],
    has_evidence: impl Fn(&TopicCluster) -> bool,
    category_of: impl Fn(&TopicCluster) -> Option<String>,
) -> Vec<Group<'_>> {
    let total: f64 = clusters.iter().map(|c| c.mass).sum();
    if total <= 0.0 {
        return Vec::new();
    }
    let eligible: Vec<&TopicCluster> = clusters
        .iter()
        .filter(|c| c.mass / total >= MIN_MASS_SHARE && has_evidence(c))
        .collect();
    let mut by_category: Vec<(String, Vec<&TopicCluster>)> = Vec::new();
    for cluster in &eligible {
        let Some(category) = category_of(cluster).filter(|c| is_theme(c)) else {
            continue;
        };
        match by_category.iter_mut().find(|(c, _)| *c == category) {
            Some((_, members)) => members.push(cluster),
            None => by_category.push((category, vec![cluster])),
        }
    }
    let theme_groups: Vec<Group> = by_category
        .into_iter()
        .filter(|(_, members)| {
            members.len() >= 2
                || members
                    .iter()
                    .map(|c| distinct_interests(c).len())
                    .sum::<usize>()
                    >= THEME_MIN_INTERESTS
        })
        .map(|(category, members)| Group {
            key: format!("{THEME_PREFIX}{category}"),
            members,
            category: Some(category),
            eligible: true,
        })
        .collect();
    let themed: HashSet<&str> = theme_groups
        .iter()
        .flat_map(|g| g.members.iter().map(|c| c.representative.as_str()))
        .collect();
    let eligible_keys: HashSet<&str> = eligible.iter().map(|c| c.representative.as_str()).collect();
    let singles = clusters
        .iter()
        .filter(|c| !themed.contains(c.representative.as_str()))
        .map(|c| Group {
            key: c.representative.clone(),
            members: vec![c],
            category: None,
            eligible: eligible_keys.contains(c.representative.as_str()),
        });
    let mut all: Vec<Group> = theme_groups.into_iter().chain(singles).collect();
    all.sort_by(|a, b| b.mass().total_cmp(&a.mass()));
    all
}

/// The set to show: `previous` while it is under a day old and none of its groups moved more than
/// 30 % or disappeared; otherwise the heaviest eligible groups.
#[must_use]
pub fn stable(previous: &InterestChipSet, groups: &[Group], now_ms: u64) -> InterestChipSet {
    let mass_of: HashMap<&str, f64> = groups.iter().map(|g| (g.key.as_str(), g.mass())).collect();
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
            .filter(|g| g.eligible)
            .take(MAX_CHIPS)
            .map(|g| (g.key.clone(), g.mass()))
            .collect(),
        computed_at: now_ms,
    }
}

/// The chips of `set`. A chip reads as the topic of its cluster the viewer watched most, never a
/// word every subject uses; a theme chip is named by the page after its category and keeps each
/// of its interests as a part.
#[must_use]
pub fn chips(
    set: &InterestChipSet,
    groups: &[Group],
    forms: &DisplayForms,
    specificity: impl Fn(&str) -> f64,
    evidence_of: impl Fn(&str) -> i32,
) -> Vec<InterestChip> {
    let by_key: HashMap<&str, &Group> = groups.iter().map(|g| (g.key.as_str(), g)).collect();
    let nameable = |topics: &[String]| -> Vec<String> {
        let specific: Vec<String> = topics
            .iter()
            .filter(|t| specificity(t) >= LABEL_MIN_SPECIFICITY)
            .cloned()
            .collect();
        if specific.is_empty() {
            topics.to_vec()
        } else {
            specific
        }
    };
    let chip_of = |cluster: &TopicCluster| -> Option<InterestChip> {
        let candidates = nameable(&cluster.topics);
        let named = candidates
            .iter()
            .max_by_key(|t| evidence_of(t))
            .filter(|t| evidence_of(t) > 0)
            .or_else(|| candidates.iter().find(|t| **t == cluster.representative))
            .or_else(|| candidates.first())?;
        Some(InterestChip {
            key: cluster.representative.clone(),
            label: label(forms, named),
            topics: cluster.topics.clone(),
            category: None,
            parts: Vec::new(),
        })
    };
    set.masses
        .iter()
        .filter_map(|(key, _)| {
            let group = by_key.get(key.as_str())?;
            if group.category.is_none() {
                return chip_of(group.members.first()?);
            }
            let parts: Vec<InterestChip> = group
                .members
                .iter()
                .flat_map(|c| distinct_interests(c))
                .filter_map(|topics| {
                    let name = nameable(&topics).into_iter().next()?;
                    Some(InterestChip {
                        key: topics.first()?.clone(),
                        label: label(forms, &name),
                        topics,
                        category: None,
                        parts: Vec::new(),
                    })
                })
                .collect();
            Some(InterestChip {
                key: group.key.clone(),
                label: parts.first()?.label.clone(),
                topics: group
                    .members
                    .iter()
                    .flat_map(|c| c.topics.iter().cloned())
                    .collect(),
                category: group.category.clone(),
                parts,
            })
        })
        .collect()
}

/// Searches for a chip: multi-word interests as they are, single words qualified by the chip's
/// main topic ("chess" with "openings" searches "chess openings"). A theme takes each part's
/// searches in turn.
#[must_use]
pub fn interest_queries(chip: &InterestChip) -> Vec<String> {
    if !chip.parts.is_empty() {
        let per_part: Vec<Vec<String>> = chip.parts.iter().map(interest_queries).collect();
        let mut seen = HashSet::new();
        return (0..QUERIES_PER_INTEREST)
            .flat_map(|round| per_part.iter().filter_map(move |q| q.get(round).cloned()))
            .filter(|q| seen.insert(q.clone()))
            .take(QUERIES_PER_INTEREST)
            .collect();
    }
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

    fn no_category(_: &TopicCluster) -> Option<String> {
        None
    }

    #[test]
    fn small_or_unsupported_groups_are_not_chips() {
        let clusters = [
            cluster("chess", &["chess", "opening"], 5.0),
            cluster("bread", &["bread"], 0.3),
            cluster("guitar", &["guitar"], 4.0),
        ];
        let groups = groups(&clusters, |c| c.topics.len() >= 2, no_category);
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
        let g = groups(&grown, |_| true, no_category);
        assert_eq!(stable(&previous, &g, 2_000), previous);
        let doubled = [
            cluster("chess", &["chess", "opening"], 10.0),
            cluster("go", &["go", "joseki"], 9.0),
        ];
        let g = groups(&doubled, |_| true, no_category);
        assert_eq!(stable(&previous, &g, 2_000).masses.len(), 2);
        let g = groups(&grown, |_| true, no_category);
        assert_eq!(
            stable(&previous, &g, 1_000 + RECOMPUTE_AFTER_MS)
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
        let g = groups(&clusters, |_| true, no_category);
        let named = chips(&set, &g, &DisplayForms::default(), specific, evidence);
        assert_eq!(named[0].label, "Opening");
    }

    #[test]
    fn two_clusters_in_one_theme_become_one_chip_with_parts() {
        let clusters = [
            cluster("minecraft", &["minecraft", "minecraft redstone"], 4.0),
            cluster("fortnite", &["fortnite", "season"], 3.0),
            cluster("chess", &["chess", "opening"], 3.0),
        ];
        let gaming = |c: &TopicCluster| (c.representative != "chess").then(|| "gaming".to_string());
        let g = groups(&clusters, |_| true, gaming);
        assert_eq!(g[0].key, "theme:gaming");
        assert_eq!(g[0].members.len(), 2);
        let set = stable(&InterestChipSet::default(), &g, 1_000);
        let chips = chips(&set, &g, &DisplayForms::default(), |_| 1.0, |_| 0);
        assert_eq!(chips[0].category.as_deref(), Some("gaming"));
        assert_eq!(chips[0].parts.len(), 3, "minecraft, fortnite and season");
        let queries = interest_queries(&chips[0]);
        assert_eq!(queries.len(), 3);
        assert!(queries.iter().any(|q| q.contains("minecraft")));
        assert!(queries.iter().any(|q| q.contains("fortnite")));
    }

    #[test]
    fn a_default_category_never_makes_a_theme() {
        let clusters = [
            cluster("vlog", &["vlog", "day"], 4.0),
            cluster("travel", &["travel", "japan"], 3.0),
        ];
        let people = |_: &TopicCluster| Some("people".to_string());
        let g = groups(&clusters, |_| true, people);
        assert!(g.iter().all(|group| group.category.is_none()));
    }

    #[test]
    fn single_word_members_are_searched_with_the_main_topic() {
        let chip = InterestChip {
            key: "chess".into(),
            label: "Chess".into(),
            topics: vec!["chess".into(), "opening".into(), "magnus carlsen".into()],
            category: None,
            parts: Vec::new(),
        };
        assert_eq!(
            interest_queries(&chip),
            ["chess magnus carlsen", "chess opening"]
        );
    }
}
