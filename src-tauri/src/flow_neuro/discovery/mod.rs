//! Discovery searches rooted in what the viewer has shown interest in, from Flow for Android's
//! `NeuroDiscovery`: interests grouped into clusters and served in rotation, each served cluster
//! contributing a query to every feed, load-more digging one branch deeper into each, and a few
//! combination, time-of-day, channel, fresh, format and exploration searches beside them.

mod balance;
mod strategies;
mod words;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
#[cfg(test)]
use std::sync::LazyLock;

use crate::flow_neuro::clusters::{ClusterInputs, TopicCluster, build_clusters, schedule};
use crate::flow_neuro::display_forms::search_text;
use crate::flow_neuro::keyed_lists::{KeyedLists, keyed_lists};
use crate::flow_neuro::keyspec::KeySpec;
use crate::flow_neuro::keyspec::text::is_topic_sized;
use crate::flow_neuro::scoring::{FlowPersona, TimeBucket, UserBrain, strip_domain_tag};
use crate::flow_neuro::specificity::{Specificity, specificity};
use crate::flow_neuro::topic_catalog::TOPIC_CATEGORIES;

const RECENT_QUERY_TOKENS_MAX: usize = 20;
const QUERY_OVERLAP_THRESHOLD: f64 = 0.4;
/// Fewer fresh queries than this and recently used ones fill in behind them.
const MIN_ROTATED_QUERIES: usize = 4;
const CLUSTER_ROTATION_MAX: usize = 40;
const STALE_QUERY_EXPIRY_MS: u64 = 24 * 3_600_000;
const STALE_QUERY_NOVELTY_THRESHOLD: f64 = 0.4;
const STALE_QUERY_MAX: usize = 40;
const STALE_MIN_FRESH: usize = 3;
const STALE_MIN_RESULTS: usize = 5;
const FALLBACK_PICKS: usize = 5;

/// One surface's discovery memory: Home and Shorts each keep their own, so one does not rotate
/// the other's queries away (Android A11).
#[derive(Debug, Default)]
pub struct SurfaceState {
    /// Load-more pages since the last refresh; each digs one branch deeper.
    pub depth: usize,
    pub recent_query_tokens: Vec<HashSet<String>>,
    pub cluster_rotation: HashMap<String, u64>,
}

/// The key a query is remembered as stale under: its words, sorted.
#[must_use]
pub fn stale_key(query: &str, spec: &KeySpec) -> Option<String> {
    let mut words = spec.chunk(query).words();
    if words.is_empty() {
        return None;
    }
    words.sort();
    Some(words.join("|"))
}

/// `stale` after a query's results came back with `novel_ratio` of them not shown lately; fewer
/// than five results say nothing.
pub fn note_query_novelty(
    stale: &mut HashMap<String, u64>,
    key: String,
    results: usize,
    novel_ratio: f64,
    now_ms: u64,
) {
    if results < STALE_MIN_RESULTS {
        return;
    }
    let cutoff = now_ms.saturating_sub(STALE_QUERY_EXPIRY_MS);
    stale.retain(|_, at| *at >= cutoff);
    if novel_ratio < STALE_QUERY_NOVELTY_THRESHOLD {
        stale.insert(key, now_ms);
        if stale.len() > STALE_QUERY_MAX
            && let Some(oldest) = stale
                .iter()
                .min_by_key(|(key, at)| (**at, (*key).clone()))
                .map(|(key, _)| key.clone())
        {
            stale.remove(&oldest);
        }
    } else {
        stale.remove(&key);
    }
}

/// Queries not used lately first; too few of them and the recent ones follow instead of being
/// dropped, so a run of refreshes does not shrink discovery to two searches.
fn rotate(candidates: Vec<String>, recent: &[HashSet<String>], spec: &KeySpec) -> Vec<String> {
    let is_fresh = |query: &String| {
        let tokens: HashSet<String> = spec.chunk(query).words().into_iter().collect();
        #[allow(clippy::cast_precision_loss)]
        let fresh = tokens.is_empty()
            || !recent.iter().any(|seen| {
                !seen.is_empty()
                    && tokens.intersection(seen).count() as f64 / tokens.union(seen).count() as f64
                        > QUERY_OVERLAP_THRESHOLD
            });
        fresh
    };
    let (fresh, used): (Vec<String>, Vec<String>) = candidates.into_iter().partition(is_fresh);
    if fresh.len() >= MIN_ROTATED_QUERIES {
        fresh
    } else {
        fresh.into_iter().chain(used).collect()
    }
}

/// The searches one surface runs next, with its memory brought up to date.
#[allow(clippy::too_many_arguments)]
pub fn next_queries(
    brain: &UserBrain,
    state: &mut SurfaceState,
    reset_depth: bool,
    persona: FlowPersona,
    bucket: TimeBucket,
    now_ms: u64,
    channel_edges: &HashMap<String, f64>,
) -> Vec<String> {
    if reset_depth {
        state.depth = 0;
    }
    let depth = state.depth;
    state.depth += 1;
    let spec = brain.key_spec();
    let generated = Discovery::new(
        brain,
        persona,
        bucket,
        now_ms,
        channel_edges,
        &state.cluster_rotation,
    )
    .generate(depth);
    let blocked = &brain.blocked_topics;
    let mut candidates: Vec<String> = if generated.is_empty() {
        let mut picks: Vec<String> = brain.preferred_topics.iter().cloned().collect();
        picks.sort();
        Chance(now_ms).shuffle(&mut picks);
        if picks.is_empty() {
            STARTER_QUERIES.iter().map(|q| (*q).to_string()).collect()
        } else {
            picks.into_iter().take(FALLBACK_PICKS).collect()
        }
    } else {
        generated
            .iter()
            .map(|q| q.query.clone())
            .filter(|query| {
                let lower = query.to_lowercase();
                !blocked.iter().any(|b| lower.contains(b.as_str()))
            })
            .collect()
    };
    if !state.recent_query_tokens.is_empty() && candidates.len() > 3 {
        candidates = rotate(candidates, &state.recent_query_tokens, &spec);
    }
    // Searches whose recent results were mostly shown already wait a day.
    let cutoff = now_ms.saturating_sub(STALE_QUERY_EXPIRY_MS);
    let fresh: Vec<String> = candidates
        .iter()
        .filter(|query| {
            stale_key(query, &spec)
                .and_then(|key| brain.stale_queries.get(&key))
                .is_none_or(|at| *at <= cutoff)
        })
        .cloned()
        .collect();
    if fresh.len() >= STALE_MIN_FRESH {
        candidates = fresh;
    }
    // Fallback searches were never learned, so they are not remembered either.
    if generated.is_empty() {
        return candidates;
    }
    state.recent_query_tokens.extend(
        candidates
            .iter()
            .map(|q| spec.chunk(q).words().into_iter().collect()),
    );
    let overflow = state
        .recent_query_tokens
        .len()
        .saturating_sub(RECENT_QUERY_TOKENS_MAX);
    state.recent_query_tokens.drain(..overflow);
    let served: HashSet<&String> = generated
        .iter()
        .filter(|q| candidates.contains(&q.query))
        .filter_map(|q| q.cluster_key.as_ref())
        .collect();
    for key in served {
        state.cluster_rotation.insert(key.clone(), now_ms);
    }
    if state.cluster_rotation.len() > CLUSTER_ROTATION_MAX {
        let mut by_age: Vec<(String, u64)> = state.cluster_rotation.drain().collect();
        by_age.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        state.cluster_rotation = by_age.into_iter().take(CLUSTER_ROTATION_MAX).collect();
    }
    candidates
}

/// What Home searches before anything is learned or picked; never recorded as learned.
pub const STARTER_QUERIES: [&str; 5] = ["Music", "Science", "Technology", "Education", "Nature"];
const SPECIFIC_QUERY_MAX_WORDS: usize = 4;
const QUERY_MIN_SPECIFICITY: f64 = 0.65;
/// A phrase this strong against its word alone takes the word's place in searches.
const PHRASE_SHARE: f64 = 0.5;
const MAX_CLUSTERS_PER_REFRESH: usize = 6;
const SPECIALIST_MAX_CLUSTERS: usize = 3;
/// The heaviest clusters are in every feed; rotation governs the rest.
const MAJOR_CLUSTER_SLOTS: usize = 3;
const MATURE_BRAIN_INTERACTIONS: i32 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Strategy {
    DeepDive,
    CrossTopic,
    Trending,
    AdjacentExploration,
    ChannelDiscovery,
    Contextual,
    FormatDriven,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveryQuery {
    pub query: String,
    pub strategy: Strategy,
    pub confidence: f64,
    /// The interest cluster this query serves, for rotation.
    pub cluster_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Maturity {
    Emerging,
    Developing,
    Established,
    Core,
}

#[derive(Debug, Clone)]
struct MatureTopic {
    name: String,
    score: f64,
    maturity: Maturity,
    category_support: usize,
    has_time_context: bool,
    has_evidence: bool,
    cluster_key: Option<String>,
}

/// One served cluster: its anchor, the branch load-more digs, and the narrower query a one-word
/// anchor is searched as.
struct ClusterChoice {
    topic: MatureTopic,
    combo_with: Option<String>,
    specific_query: Option<String>,
}

#[derive(Default)]
struct Selection {
    choices: Vec<ClusterChoice>,
    emerging: Vec<MatureTopic>,
    cross_category: Vec<MatureTopic>,
}

impl Selection {
    fn primary(&self) -> Option<&MatureTopic> {
        self.choices.first().map(|choice| &choice.topic)
    }

    fn secondary(&self) -> impl Iterator<Item = &MatureTopic> {
        self.choices.iter().skip(1).map(|choice| &choice.topic)
    }

    fn all_topics(&self) -> Vec<&MatureTopic> {
        let mut names: HashSet<&str> = HashSet::new();
        self.choices
            .iter()
            .map(|choice| &choice.topic)
            .chain(&self.emerging)
            .chain(&self.cross_category)
            .filter(|topic| names.insert(&topic.name))
            .collect()
    }
}

/// A seeded generator for the few choices Android leaves to chance, so one call is reproducible.
struct Chance(u64);

impl Chance {
    fn below(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        #[allow(clippy::cast_possible_truncation)]
        let pick = ((self.0 >> 33) as usize) % bound.max(1);
        pick
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            items.swap(i, self.below(i + 1));
        }
    }
}

/// Everything one generation reads.
pub struct Discovery<'a> {
    brain: &'a UserBrain,
    spec: KeySpec,
    lists: Arc<KeyedLists>,
    specificity: Arc<Specificity>,
    persona: FlowPersona,
    bucket: TimeBucket,
    now_ms: u64,
    channel_edges: &'a HashMap<String, f64>,
    rotation: &'a HashMap<String, u64>,
    chance: Chance,
}

impl<'a> Discovery<'a> {
    #[must_use]
    pub fn new(
        brain: &'a UserBrain,
        persona: FlowPersona,
        bucket: TimeBucket,
        now_ms: u64,
        channel_edges: &'a HashMap<String, f64>,
        rotation: &'a HashMap<String, u64>,
    ) -> Self {
        let spec = brain.key_spec();
        Self {
            brain,
            lists: keyed_lists(&spec),
            specificity: specificity(&spec),
            spec,
            persona,
            bucket,
            now_ms,
            channel_edges,
            rotation,
            chance: Chance(now_ms),
        }
    }

    fn key_of(&self, word: &str) -> String {
        self.spec.key_of(word)
    }

    fn is_mature_brain(&self) -> bool {
        self.brain.total_interactions > MATURE_BRAIN_INTERACTIONS
    }

    /// A topic worth searching: sized like one, no noise word or year, and specific enough that
    /// it does not search up every subject ("normal", "better").
    fn is_substantial(&self, topic: &str) -> bool {
        if !is_topic_sized(topic) {
            return false;
        }
        let lower = topic.to_lowercase();
        if words::NOISE.contains(lower.as_str())
            || words::is_year(&lower)
            || lower.chars().all(|c| c.is_ascii_digit())
        {
            return false;
        }
        // A version number ("3.1") names no subject (D10).
        lower.chars().any(char::is_alphabetic)
            && is_topic_sized(&strip_domain_tag(&lower))
            && self.specificity.of(&lower) >= QUERY_MIN_SPECIFICITY
    }

    fn has_evidence(&self, topic: &str) -> bool {
        let base = strip_domain_tag(topic);
        if self
            .brain
            .preferred_topics
            .iter()
            .any(|pick| self.key_of(pick).eq_ignore_ascii_case(&base))
        {
            return true;
        }
        self.brain
            .topic_evidence
            .get(&base)
            .or_else(|| self.brain.topic_evidence.get(topic))
            .is_some_and(|e| {
                e.explicit_signals > 0
                    || e.watch_signals >= 2
                    || e.video_ids.len() >= 2
                    || e.positive_score >= 1.2
                    || (e.positive_signals >= 2 && e.positive_score >= 0.5)
            })
    }

    fn is_eligible(&self, topic: &MatureTopic) -> bool {
        topic.has_evidence
            || topic.maturity >= Maturity::Developing
            || (self.is_mature_brain() && topic.score >= 0.10)
    }

    fn category_keys(&self) -> Vec<(&'static str, Vec<String>)> {
        TOPIC_CATEGORIES
            .iter()
            .map(|category| {
                let keys = category
                    .topics
                    .iter()
                    .map(|topic| self.key_of(topic))
                    .collect();
                (category.name, keys)
            })
            .collect()
    }

    fn category_of(&self, topic: &str) -> Option<&'static str> {
        let base = strip_domain_tag(topic);
        self.category_keys()
            .into_iter()
            .find(|(_, keys)| keys.contains(&base))
            .map(|(name, _)| name)
    }

    fn time_topics(&self) -> Vec<String> {
        let Some(vector) = self.brain.time_vectors.get(&self.bucket) else {
            return Vec::new();
        };
        let mut ranked: Vec<(&String, f64)> = vector.topics.iter().map(|(k, &v)| (k, v)).collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        ranked
            .into_iter()
            .take(5)
            .map(|(key, _)| key.clone())
            .filter(|key| self.is_substantial(key))
            .collect()
    }

    fn mature_topics(&self) -> Vec<MatureTopic> {
        let interests: HashMap<&String, f64> = self.brain.interests().collect();
        let time_topics: HashSet<String> = self.time_topics().into_iter().collect();
        let categories = self.category_keys();
        let mut topics: Vec<MatureTopic> = interests
            .iter()
            .filter(|(name, _)| self.is_substantial(name))
            .map(|(name, &score)| MatureTopic {
                name: (*name).clone(),
                score,
                maturity: match score {
                    s if s >= 0.70 => Maturity::Core,
                    s if s >= 0.40 => Maturity::Established,
                    s if s >= 0.20 => Maturity::Developing,
                    _ => Maturity::Emerging,
                },
                category_support: categories
                    .iter()
                    .filter(|(_, keys)| {
                        keys.contains(name)
                            && keys
                                .iter()
                                .filter(|key| interests.contains_key(key))
                                .count()
                                >= 2
                    })
                    .count(),
                has_time_context: time_topics.contains(*name),
                has_evidence: self.has_evidence(name),
                cluster_key: None,
            })
            .collect();
        topics.sort_by(|a, b| {
            b.maturity
                .cmp(&a.maturity)
                .then_with(|| b.score.total_cmp(&a.score))
                .then_with(|| b.category_support.cmp(&a.category_support))
                .then_with(|| a.name.cmp(&b.name))
        });
        topics
    }

    /// A one-word anchor searched alone returns the site's generic popular videos for that word,
    /// so the anchor's strongest phrase from its own cluster narrows it ("phonk" becomes "drift
    /// phonk"). Members of other clusters never qualify an anchor.
    fn specific_member(anchor_name: &str, members: &[MatureTopic]) -> Option<String> {
        let anchor = strip_domain_tag(anchor_name);
        if anchor.contains(' ') {
            return None;
        }
        let others: Vec<String> = members
            .iter()
            .skip(1)
            .map(|member| strip_domain_tag(&member.name))
            .filter(|member| {
                *member != anchor
                    && !words::NOISE.contains(member.as_str())
                    && member.split(' ').count() < SPECIFIC_QUERY_MAX_WORDS
            })
            .collect();
        others
            .iter()
            .find(|member| member.contains(' ') && member.split(' ').any(|word| word == anchor))
            .or_else(|| {
                others
                    .iter()
                    .find(|member| member.contains(' ') || is_topic_sized(member))
            })
            .cloned()
    }

    fn select(&self, topics: &[MatureTopic], depth: usize, max_clusters: usize) -> Selection {
        if topics.is_empty() {
            return Selection::default();
        }
        let scores: HashMap<String, f64> =
            topics.iter().map(|t| (t.name.clone(), t.score)).collect();
        let clusters = build_clusters(&ClusterInputs {
            topic_scores: &scores,
            affinities: &self.brain.topic_affinities,
            channel_topic_profiles: &self.brain.channel_topic_profiles,
            channel_edges: self.channel_edges,
            spec: &self.spec,
        });
        if clusters.is_empty() {
            return Selection::default();
        }
        let first_seen = |topic: &str| {
            self.brain
                .topic_evidence
                .get(topic)
                .map(|e| e.first_seen_at)
        };
        let scheduled = schedule(clusters.clone(), self.rotation, self.now_ms, &first_seen);

        let mut by_base: HashMap<String, &MatureTopic> = HashMap::new();
        for topic in topics {
            by_base
                .entry(strip_domain_tag(&topic.name))
                .or_insert(topic);
        }
        let budget = max_clusters.max(1);
        let mut heaviest = clusters;
        heaviest.sort_by(|a, b| b.mass.total_cmp(&a.mass));
        let major: HashSet<String> = heaviest
            .into_iter()
            .take(MAJOR_CLUSTER_SLOTS.min(budget))
            .filter(|cluster| cluster.mass > 0.0)
            .map(|cluster| cluster.representative)
            .collect();
        let served: Vec<&TopicCluster> = scheduled
            .iter()
            .filter(|c| major.contains(&c.representative))
            .chain(
                scheduled
                    .iter()
                    .filter(|c| !major.contains(&c.representative) && c.mass > 0.0),
            )
            .take(budget)
            .collect();

        let choices: Vec<ClusterChoice> = served
            .iter()
            .filter_map(|cluster| Self::choice(cluster, &by_base, depth))
            .collect();
        if choices.is_empty() {
            return Selection::default();
        }

        // Clusters the budget left out offer a couple of emerging and cross-category topics.
        let served_keys: HashSet<&str> = served.iter().map(|c| c.representative.as_str()).collect();
        let represented: HashSet<&str> = choices.iter().map(|c| c.topic.name.as_str()).collect();
        let leftovers: Vec<MatureTopic> = scheduled
            .iter()
            .filter(|cluster| !served_keys.contains(cluster.representative.as_str()))
            .filter_map(|cluster| {
                let topic = cluster.topics.iter().find_map(|t| by_base.get(t))?;
                Some(MatureTopic {
                    cluster_key: Some(cluster.representative.clone()),
                    ..(*topic).clone()
                })
            })
            .filter(|topic| !represented.contains(topic.name.as_str()))
            .collect();
        let emerging: Vec<MatureTopic> = leftovers.iter().take(2).cloned().collect();
        let represented_categories: HashSet<&str> = choices
            .iter()
            .map(|c| &c.topic)
            .chain(&emerging)
            .filter_map(|topic| self.category_of(&topic.name))
            .collect();
        let cross_category = leftovers
            .iter()
            .skip(emerging.len())
            .filter(|topic| {
                self.category_of(&topic.name)
                    .is_some_and(|category| !represented_categories.contains(category))
            })
            .take(2)
            .cloned()
            .collect();
        Selection {
            choices,
            emerging,
            cross_category,
        }
    }

    fn choice(
        cluster: &TopicCluster,
        by_base: &HashMap<String, &MatureTopic>,
        depth: usize,
    ) -> Option<ClusterChoice> {
        let members: Vec<MatureTopic> = cluster
            .topics
            .iter()
            .filter_map(|topic| by_base.get(topic).map(|t| (*t).clone()))
            .collect();
        let anchor = MatureTopic {
            cluster_key: Some(cluster.representative.clone()),
            ..members.first()?.clone()
        };
        let surface = Self::specific_member(&anchor.name, &members);
        let anchor_base = strip_domain_tag(&anchor.name);
        // Load-more digs the branches in turn, starting after the one the refresh's query used.
        let others: Vec<String> = members
            .iter()
            .skip(1)
            .map(|member| strip_domain_tag(&member.name))
            .filter(|member| *member != anchor_base)
            .collect();
        let branches: Vec<String> = match surface
            .as_ref()
            .and_then(|surface| others.iter().position(|other| other == surface))
        {
            Some(used) => others[used + 1..]
                .iter()
                .chain(&others[..=used])
                .cloned()
                .collect(),
            None => others,
        };
        let combo_with = (depth > 0 && !branches.is_empty())
            .then(|| branches[(depth - 1) % branches.len()].clone());
        let specific_query = if depth == 0 {
            surface.map(|member| {
                if member.split(' ').any(|word| word == anchor_base) {
                    member
                } else {
                    format!("{anchor_base} {member}")
                }
            })
        } else {
            None
        };
        Some(ClusterChoice {
            topic: anchor,
            combo_with,
            specific_query,
        })
    }

    /// The phrase a lone word is mostly met in, when that phrase weighs at least half the word:
    /// "elite" alone searches up a TV series, "elite gen" what the viewer watched.
    fn enclosing_phrase(&self, word: &str) -> Option<String> {
        let topics = &self.brain.global_vector.topics;
        let alone: f64 = topics
            .iter()
            .filter(|(key, _)| strip_domain_tag(key) == word)
            .map(|(_, value)| value)
            .sum();
        topics
            .iter()
            .map(|(key, &value)| (strip_domain_tag(key), value))
            .filter(|(key, value)| {
                key.contains(' ')
                    && key.split(' ').any(|w| w == word)
                    && *value >= alone * PHRASE_SHARE
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
            .map(|(key, _)| key)
    }

    fn needs_enrichment(&self, base: &str) -> bool {
        words::AMBIGUOUS.contains(base) || self.lists.is_polysemous(base)
    }

    /// An ambiguous topic made specific: by its domain tag, its strongest link, the strongest
    /// other interest, or another topic of its catalog category.
    fn natural_query(&self, topic: &str) -> String {
        let base = strip_domain_tag(topic);
        if !base.contains(' ')
            && let Some(phrase) = self.enclosing_phrase(&base)
        {
            return phrase;
        }
        if !self.needs_enrichment(&base) {
            return base;
        }
        if let Some((_, domain)) = topic.split_once(':') {
            return format!("{base} {}", words::domain_query_word(domain));
        }
        let partner = self
            .brain
            .topic_affinities
            .iter()
            .filter(|(_, value)| **value > 0.10)
            .filter_map(|(key, value)| {
                let (a, b) = key.split_once('|')?;
                match (a == base, b == base) {
                    (true, _) => Some((b, *value)),
                    (_, true) => Some((a, *value)),
                    _ => None,
                }
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(a.0)));
        if let Some((partner, _)) = partner
            && self.is_substantial(partner)
        {
            return format!("{base} {partner}");
        }
        let co_topic = self
            .brain
            .global_vector
            .topics
            .iter()
            .map(|(key, &value)| (strip_domain_tag(key), value))
            .filter(|(key, value)| *key != base && *value > 0.05 && self.is_substantial(key))
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)));
        if let Some((co_topic, _)) = co_topic {
            return format!("{base} {co_topic}");
        }
        let category_word = TOPIC_CATEGORIES
            .iter()
            .find(|category| category.topics.iter().any(|t| self.key_of(t) == base))
            .and_then(|category| {
                category
                    .topics
                    .iter()
                    .find(|t| self.key_of(t) != base && t.encode_utf16().count() > 3)
            });
        match category_word {
            Some(word) => format!("{base} {word}"),
            None => base,
        }
    }

    /// The discovery searches for this refresh; `depth` counts load-more pages since it.
    pub fn generate(&mut self, depth: usize) -> Vec<DiscoveryQuery> {
        let topics = self.mature_topics();
        let max_clusters = if self.persona == FlowPersona::Specialist {
            SPECIALIST_MAX_CLUSTERS
        } else {
            MAX_CLUSTERS_PER_REFRESH
        };
        let selection = self.select(&topics, depth, max_clusters);

        let mut queries: Vec<DiscoveryQuery> = Vec::new();
        self.add_direct(&mut queries, &selection, depth);
        self.add_combinations(&mut queries, &selection);
        self.add_affinities(&mut queries);
        self.add_time_context(&mut queries, &selection);
        self.add_channels(&mut queries);
        self.add_fresh(&mut queries, &selection);
        self.add_format(&mut queries, &selection);
        self.add_exploration(&mut queries);
        if self.is_mature_brain() {
            self.add_preferred_anchors(&mut queries);
        }

        let blocked = &self.brain.blocked_topics;
        let filtered: Vec<DiscoveryQuery> = queries
            .into_iter()
            .filter(|q| {
                let lower = q.query.to_lowercase();
                !blocked.iter().any(|b| lower.contains(b.as_str()))
            })
            .filter_map(|q| {
                let query =
                    words::sanitize_query(&search_text(&self.brain.display_forms, &q.query))?;
                Some(DiscoveryQuery { query, ..q })
            })
            .collect();
        let topic_count = selection.all_topics().len();
        balance::balance(filtered, topic_count, &self.spec, &mut self.chance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow_neuro::learning::{Interaction, apply_interaction};
    use crate::flow_neuro::signals::InteractionType;

    fn discovery(brain: &UserBrain) -> Discovery<'_> {
        static NONE: LazyLock<(HashMap<String, f64>, HashMap<String, u64>)> =
            LazyLock::new(|| (HashMap::new(), HashMap::new()));
        Discovery::new(
            brain,
            FlowPersona::Explorer,
            TimeBucket::WeekdayEvening,
            1_800_000_000_000,
            &NONE.0,
            &NONE.1,
        )
    }

    #[test]
    fn traces_of_a_half_watched_video_are_never_searched_for() {
        let mut brain = UserBrain::default();
        brain.global_vector.topics.insert("snapdragon".into(), 0.5);
        brain
            .global_vector
            .topics
            .insert("sourdough".into(), 0.0115);
        let names: Vec<String> = discovery(&brain)
            .mature_topics()
            .into_iter()
            .map(|topic| topic.name)
            .collect();
        assert_eq!(names, ["snapdragon"]);
    }

    #[test]
    fn topics_in_any_script_can_become_queries() {
        let brain = UserBrain::default();
        let discovery = discovery(&brain);
        for topic in ["طبخ", "кулинария", "料理", "snapdragon"] {
            assert!(discovery.is_substantial(topic), "{topic}");
        }
        for topic in ["better", "normal", "2026", "3.1"] {
            assert!(!discovery.is_substantial(topic), "{topic}");
        }
    }

    #[test]
    fn every_interest_cluster_gets_a_search_and_load_more_digs_deeper() {
        let mut brain = UserBrain {
            total_interactions: 120,
            ..UserBrain::default()
        };
        for (key, weight) in [
            ("guitar", 0.8),
            ("fingerstyle guitar", 0.5),
            ("chess", 0.6),
            ("chess opening", 0.4),
            ("sourdough", 0.5),
        ] {
            brain.global_vector.topics.insert(key.into(), weight);
        }
        brain
            .topic_affinities
            .insert("fingerstyle guitar|guitar".into(), 0.6);
        brain
            .topic_affinities
            .insert("chess|chess opening".into(), 0.6);
        let refresh: Vec<String> = discovery(&brain)
            .generate(0)
            .into_iter()
            .map(|q| q.query)
            .collect();
        for expected in ["fingerstyle guitar", "chess opening", "sourdough"] {
            assert!(
                refresh.iter().any(|q| q == expected),
                "{expected} in {refresh:?}"
            );
        }
        let deeper: Vec<String> = discovery(&brain)
            .generate(1)
            .into_iter()
            .map(|q| q.query)
            .collect();
        assert!(
            deeper
                .iter()
                .any(|q| q == "guitar fingerstyle guitar" || q == "guitar fingerstyle"),
            "{deeper:?}"
        );
    }

    #[test]
    fn searches_are_spelled_as_titles_write_them() {
        let mut brain = UserBrain::default();
        let titles = [
            "Restoring Vintage Guitars",
            "Vintage Guitars Restoration Tips",
            "Restoring Vintage Amplifiers",
        ];
        for round in 0..4 {
            for (index, title) in titles.iter().enumerate() {
                apply_interaction(
                    &mut brain,
                    &Interaction {
                        video_id: &format!("v{round}{index}"),
                        title,
                        channel_name: "Luthier Bench",
                        channel_id: "c1",
                        description: None,
                        duration_sec: Some(900),
                        is_live: false,
                        is_short: false,
                        kind: InteractionType::Watched,
                        percent_watched: 0.9,
                        seconds_since_impression: None,
                        category: None,
                    },
                );
            }
        }
        let spec = brain.key_spec();
        let stems: Vec<String> = ["restoring", "vintage", "amplifiers"]
            .iter()
            .map(|word| spec.key_of(word))
            .filter(|key| !["restoring", "vintage", "amplifiers"].contains(&key.as_str()))
            .collect();
        assert!(!stems.is_empty(), "the fixture must hold stemmed keys");
        let queries = discovery(&brain).generate(0);
        assert!(!queries.is_empty());
        for query in queries {
            let lower = query.query.to_lowercase();
            for stem in &stems {
                assert!(
                    !lower.split(' ').any(|word| word == stem),
                    "{lower} holds {stem}"
                );
            }
        }
    }

    #[test]
    fn a_stale_search_waits_a_day_and_a_novel_one_clears() {
        let mut stale = HashMap::new();
        note_query_novelty(&mut stale, "chess".into(), 10, 0.2, 1_000);
        assert!(stale.contains_key("chess"));
        note_query_novelty(&mut stale, "chess".into(), 3, 0.9, 2_000);
        assert!(stale.contains_key("chess"), "four results say nothing");
        note_query_novelty(&mut stale, "chess".into(), 10, 0.9, 3_000);
        assert!(stale.is_empty());
    }
}
