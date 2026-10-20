//! The kinds of search one generation adds, each rooted in the viewer's own evidence.

use std::collections::{HashMap, HashSet};

use super::words::{
    FRESHNESS_WORDS, GENERIC_TITLE_VERBS, LONG_FORM_WORDS, SHORT_FORM_WORDS, whitespace_words,
};
use super::{Discovery, DiscoveryQuery, MatureTopic, Maturity, Selection, Strategy, words};
use crate::flow_neuro::features::is_noise_topic;
use crate::flow_neuro::formats;
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::scoring::{FlowPersona, strip_domain_tag};

/// A topic the vector knows less than this is one exploration may suggest.
const EXPLORATION_SCORE_THRESHOLD: f64 = 0.1;
/// How much a viewer must take to a format before searches ask for it.
const FORMAT_QUERY_MIN_AFFINITY: f64 = 0.2;

fn query(
    query: String,
    strategy: Strategy,
    confidence: f64,
    cluster_key: Option<String>,
) -> DiscoveryQuery {
    DiscoveryQuery {
        query,
        strategy,
        confidence,
        cluster_key,
    }
}

fn confidence(topic: &MatureTopic) -> f64 {
    let base = match topic.maturity {
        Maturity::Core => 0.90,
        Maturity::Established => 0.75,
        Maturity::Developing => 0.55,
        Maturity::Emerging => 0.35,
    };
    #[allow(clippy::cast_precision_loss)]
    let support = (topic.category_support as f64 * 0.03).min(0.10);
    let time = if topic.has_time_context { 0.05 } else { 0.0 };
    (base + support + time).clamp(0.20, 0.95)
}

fn ranked(map: &HashMap<String, f64>) -> Vec<(&String, f64)> {
    let mut entries: Vec<(&String, f64)> = map.iter().map(|(k, &v)| (k, v)).collect();
    entries.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    entries
}

impl Discovery<'_> {
    /// Every served cluster's own query; load-more digs a branch of it instead of repeating it.
    pub(super) fn add_direct(
        &self,
        queries: &mut Vec<DiscoveryQuery>,
        selection: &Selection,
        depth: usize,
    ) {
        for (index, choice) in selection.choices.iter().enumerate() {
            let topic = &choice.topic;
            if !self.is_eligible(topic) {
                continue;
            }
            let anchor = strip_domain_tag(&topic.name);
            let text = match (&choice.combo_with, &choice.specific_query) {
                (Some(branch), _) => format!("{anchor} {branch}"),
                (None, Some(specific)) => specific.clone(),
                (None, None) => self.natural_query(&topic.name),
            };
            #[allow(clippy::cast_precision_loss)]
            let digging = depth as f64 * 0.02;
            let secondary = if index == 0 { 0.0 } else { 0.05 };
            queries.push(query(
                text,
                Strategy::DeepDive,
                confidence(topic) - secondary - digging,
                topic.cluster_key.clone(),
            ));
        }
    }

    /// Two of the viewer's interests together.
    pub(super) fn add_combinations(
        &self,
        queries: &mut Vec<DiscoveryQuery>,
        selection: &Selection,
    ) {
        let Some(primary) = selection.primary().filter(|topic| self.is_eligible(topic)) else {
            return;
        };
        let secondary: Vec<&MatureTopic> = selection
            .secondary()
            .filter(|topic| self.is_eligible(topic))
            .collect();
        if secondary.is_empty() {
            return;
        }
        let primary_name = strip_domain_tag(&primary.name);
        for other in secondary.iter().take(2) {
            queries.push(query(
                format!("{primary_name} {}", strip_domain_tag(&other.name)),
                Strategy::CrossTopic,
                0.60,
                other.cluster_key.clone(),
            ));
        }
        if let [first, second, ..] = secondary.as_slice() {
            queries.push(query(
                format!(
                    "{} {}",
                    strip_domain_tag(&first.name),
                    strip_domain_tag(&second.name)
                ),
                Strategy::CrossTopic,
                0.50,
                first.cluster_key.clone(),
            ));
        }
        if let Some(cross) = selection.cross_category.first() {
            queries.push(query(
                format!("{primary_name} {}", strip_domain_tag(&cross.name)),
                Strategy::CrossTopic,
                0.45,
                cross.cluster_key.clone(),
            ));
        }
    }

    /// Topics the viewer watches together.
    pub(super) fn add_affinities(&self, queries: &mut Vec<DiscoveryQuery>) {
        for (key, score) in ranked(&self.brain.topic_affinities)
            .into_iter()
            .filter(|(_, score)| *score > 0.15)
            .take(3)
        {
            let Some((a, b)) = key.split_once('|') else {
                continue;
            };
            if self.is_substantial(a) && self.is_substantial(b) {
                queries.push(query(
                    format!("{a} {b}"),
                    Strategy::CrossTopic,
                    0.55 + score * 0.25,
                    None,
                ));
            }
        }
    }

    /// What this viewer watches at this time of day, confirmed by their lasting interests.
    pub(super) fn add_time_context(
        &self,
        queries: &mut Vec<DiscoveryQuery>,
        selection: &Selection,
    ) {
        let confirmed: Vec<String> = self
            .time_topics()
            .into_iter()
            .filter(|topic| {
                self.brain
                    .global_vector
                    .topics
                    .get(topic)
                    .copied()
                    .unwrap_or(0.0)
                    > 0.10
                    && self.has_evidence(topic)
            })
            .collect();
        let Some(first) = confirmed.first() else {
            return;
        };
        if Some(first) != selection.primary().map(|topic| &topic.name) {
            queries.push(query(first.clone(), Strategy::Contextual, 0.60, None));
        }
        if let [first, second, ..] = confirmed.as_slice()
            && first != second
        {
            queries.push(query(
                format!("{first} {second}"),
                Strategy::Contextual,
                0.50,
                None,
            ));
        }
    }

    /// The topics of channels the viewer rates highly, to find creators like them.
    pub(super) fn add_channels(&self, queries: &mut Vec<DiscoveryQuery>) {
        let brain = self.brain;
        for (channel, score) in ranked(&brain.channel_scores)
            .into_iter()
            .filter(|(_, score)| *score > 0.5)
            .take(3)
        {
            let Some(profile) = brain.channel_topic_profiles.get(channel) else {
                continue;
            };
            if profile.len() < 2 {
                continue;
            }
            let top: Vec<&String> = ranked(profile)
                .into_iter()
                .take(2)
                .map(|(topic, _)| topic)
                .filter(|topic| self.is_substantial(topic) && self.has_evidence(topic))
                .collect();
            if let [first, second] = top.as_slice() {
                queries.push(query(
                    format!("{first} {second}"),
                    Strategy::ChannelDiscovery,
                    0.50 + score * 0.15,
                    None,
                ));
            }
        }
        let mut niche: HashMap<&String, f64> = HashMap::new();
        for profile in brain.channel_topic_profiles.values() {
            for (topic, weight) in profile {
                *niche.entry(topic).or_insert(0.0) += weight;
            }
        }
        let top_niche = niche
            .into_iter()
            .filter(|(topic, _)| self.is_substantial(topic) && self.has_evidence(topic))
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(a.0)));
        if let Some((topic, _)) = top_niche {
            queries.push(query(topic.clone(), Strategy::ChannelDiscovery, 0.50, None));
        }
    }

    /// An established interest's newest videos.
    pub(super) fn add_fresh(&self, queries: &mut Vec<DiscoveryQuery>, selection: &Selection) {
        let established = selection
            .all_topics()
            .into_iter()
            .filter(|topic| topic.maturity >= Maturity::Established && self.is_eligible(topic))
            .take(FRESHNESS_WORDS.len());
        for (topic, word) in established.zip(FRESHNESS_WORDS) {
            queries.push(query(
                format!("{} {word}", self.natural_query(&topic.name)),
                Strategy::Trending,
                confidence(topic) - 0.05,
                topic.cluster_key.clone(),
            ));
        }
    }

    /// The main interest in the format the viewer watches, once there is a clear one.
    pub(super) fn add_format(&mut self, queries: &mut Vec<DiscoveryQuery>, selection: &Selection) {
        let Some(primary) = selection.primary().filter(|topic| self.is_eligible(topic)) else {
            return;
        };
        let duration = self.brain.global_vector.duration;
        let favourite = self
            .brain
            .format_affinity
            .iter()
            .filter(|(_, affinity)| **affinity >= FORMAT_QUERY_MIN_AFFINITY)
            .max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(a.0)))
            .map(|(format, _)| format.clone());
        let word = if let Some(favourite) = favourite {
            formats::search_word(&favourite).to_string()
        } else if duration > 0.75
            || matches!(self.persona, FlowPersona::DeepDiver | FlowPersona::Scholar)
        {
            LONG_FORM_WORDS[self.chance.below(LONG_FORM_WORDS.len())].to_string()
        } else if duration < 0.30 || self.persona == FlowPersona::Skimmer {
            SHORT_FORM_WORDS[self.chance.below(SHORT_FORM_WORDS.len())].to_string()
        } else {
            return;
        };
        queries.push(query(
            format!("{} {word}", primary.name),
            Strategy::FormatDriven,
            0.55,
            primary.cluster_key.clone(),
        ));
    }

    /// A topic next to the viewer's interests that the vector barely knows; one slot is always
    /// kept, so the feed never closes in on itself.
    pub(super) fn add_exploration(&mut self, queries: &mut Vec<DiscoveryQuery>) {
        let budget = if self.brain.total_interactions > 80 {
            1
        } else {
            2
        };
        let mut topics = self.exploration_topics();
        self.chance.shuffle(&mut topics);
        for topic in topics.into_iter().take(budget) {
            queries.push(query(
                self.natural_query(&topic),
                Strategy::AdjacentExploration,
                0.35,
                None,
            ));
        }
    }

    fn global_score(&self, base: &str) -> f64 {
        let topics = &self.brain.global_vector.topics;
        topics.get(base).copied().unwrap_or_else(|| {
            topics
                .iter()
                .find(|(key, _)| strip_domain_tag(key) == base)
                .map_or(0.0, |(_, &value)| value)
        })
    }

    /// The strongest adjacent topics: watched together with a real interest, or taught by
    /// channels the viewer rates well.
    fn exploration_topics(&self) -> Vec<String> {
        let brain = self.brain;
        let mut weights: HashMap<String, f64> = HashMap::new();
        for (key, &affinity) in &brain.topic_affinities {
            let Some((a, b)) = key.split_once('|') else {
                continue;
            };
            for (anchor, partner) in [(a, b), (b, a)] {
                let anchor_score = self.global_score(anchor);
                if self.is_substantial(partner)
                    && anchor_score >= 0.15
                    && self.global_score(partner) < EXPLORATION_SCORE_THRESHOLD
                {
                    *weights.entry(partner.to_string()).or_insert(0.0) += affinity * anchor_score;
                }
            }
        }
        for (channel, profile) in &brain.channel_topic_profiles {
            let Some(&quality) = brain.channel_scores.get(channel) else {
                continue;
            };
            if quality < 0.55 {
                continue;
            }
            for (topic, weight) in ranked(profile).into_iter().take(4) {
                let base = strip_domain_tag(topic);
                if self.is_substantial(&base)
                    && self.global_score(&base) < EXPLORATION_SCORE_THRESHOLD
                {
                    *weights.entry(base).or_insert(0.0) += weight * quality;
                }
            }
        }
        // Channels that taught "resident evil" go on teaching "evil".
        let blocked = &brain.blocked_topics;
        let blocked_phrase_words: HashSet<String> = blocked
            .iter()
            .filter(|b| b.contains(' '))
            .flat_map(|b| self.spec.chunk(b).words())
            .collect();
        // A word that needs a qualifier or is only a title's verb names no subject alone.
        let names_subject = |topic: &str| {
            topic.contains(' ')
                || !(words::AMBIGUOUS.contains(topic)
                    || self.lists.is_polysemous(topic)
                    || GENERIC_TITLE_VERBS.contains(topic))
        };
        let mut picks: Vec<(String, f64)> = weights
            .into_iter()
            .filter(|(topic, _)| {
                let key = self.key_of(topic);
                names_subject(topic)
                    && !blocked
                        .iter()
                        .any(|b| topic.contains(b.as_str()) || key.contains(b.as_str()))
                    && !blocked_phrase_words.contains(&key)
                    && !is_noise_topic(topic, &self.spec)
            })
            .collect();
        picks.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        picks.into_iter().take(6).map(|(topic, _)| topic).collect()
    }

    /// The viewer's own picks that no query covers yet.
    pub(super) fn add_preferred_anchors(&mut self, queries: &mut Vec<DiscoveryQuery>) {
        if self.brain.preferred_topics.is_empty() {
            return;
        }
        let covered: HashSet<String> = queries
            .iter()
            .flat_map(|q| {
                whitespace_words(&q.query.to_lowercase())
                    .filter(|word| is_topic_sized(word))
                    .map(|word| self.key_of(word))
                    .collect::<Vec<_>>()
            })
            .collect();
        let blocked = &self.brain.blocked_topics;
        let mut missing: Vec<String> = self
            .brain
            .preferred_topics
            .iter()
            .map(|pick| pick.trim().to_string())
            .filter(|pick| {
                let key = self.key_of(pick);
                is_topic_sized(&key)
                    && !covered.contains(&key)
                    && !blocked.iter().any(|b| key.contains(b.as_str()))
            })
            .collect();
        missing.sort();
        self.chance.shuffle(&mut missing);
        for pick in missing.into_iter().take(3) {
            queries.push(query(pick, Strategy::DeepDive, 0.45, None));
        }
    }
}
