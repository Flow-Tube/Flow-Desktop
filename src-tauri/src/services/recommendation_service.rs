use chrono::Datelike;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info};

use crate::db::recommendations;
use crate::errors::AppResult;
use crate::flow_neuro::brain_store::BrainStore;
use crate::flow_neuro::ranker;
use crate::flow_neuro::scoring::{
    CHANNEL_SUPPRESSION_DAYS, FEED_HISTORY_EXPIRY_DAYS, FEED_HISTORY_MAX, FeedEntry, FlowPersona,
    IMPRESSION_CACHE_MAX, IdfSnapshot, JITTER_COLD_START, JITTER_NORMAL,
    ONBOARDING_WARMUP_INTERACTIONS, QUERY_OVERLAP_THRESHOLD, QUERY_ROTATION_FLOOR,
    QUERY_ROTATION_RECENT_WINDOW, RECENT_QUERY_TOKENS_MAX,
    SESSION_TOPIC_HISTORY_MAX, ScoredVideo, TimeBucket, TopicEvidence, UserBrain,
    VIDEO_SUPPRESSION_DAYS, apply_smart_diversity, channel_inferred_blocked, classify_persona,
    extract_features, get_topic_categories, is_generic_word, is_music_track, normalize_lemma,
    strip_domain_tag, tokenize,
};
use crate::flow_neuro::signals::{InteractionType, apply_interaction};
use crate::models::video::{MusicHomeChip, MusicHomeSection, VideoSummary};
use crate::services::youtube_service::YoutubeService;

const TIME_CONTEXT_SELECTION_MULTIPLIER: f64 = 3.0;
const TIME_CONTEXT_MIN_SCORE: f64 = 0.12;
const DISCOVER_FEED_TARGET_SIZE: usize = 35;
const QUERY_BONDING_INTERACTION_THRESHOLD: i32 = 50;
const QUERY_BONDING_ANCHOR_LIMIT: usize = 4;
const QUERY_BONDING_EMERGING_LIMIT: usize = 6;
const QUERY_BONDING_QUERY_LIMIT: usize = 8;
const EMERGING_TOKEN_MAX_WEIGHT: f64 = 0.18;

pub struct RecommendationService {
    pool: SqlitePool,
    brain_store: Arc<BrainStore>,
    impression_cache: Mutex<HashMap<String, (i32, u64)>>, // video_id -> (seen_count, last_seen_timestamp)
    session_topic_history: Mutex<Vec<String>>,
    session_video_count: Mutex<i32>,
    #[allow(dead_code)]
    session_start_time: u64,
}

#[derive(Clone)]
struct DiscoveryQuery {
    query: String,
    confidence: f64,
    strategy: &'static str,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum TopicMaturity {
    Emerging,
    Developing,
    Established,
    Core,
}

#[derive(Clone)]
struct MatureTopic {
    name: String,
    score: f64,
    maturity: TopicMaturity,
    category_support: usize,
    has_time_context: bool,
    has_discovery_evidence: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedQuotas {
    pub maturity: String,
    pub total_interactions: i32,
    pub subscription_percent: f64,
    pub discovery_percent: f64,
    pub viral_percent: f64,
    pub subscription_limit: usize,
    pub discovery_limit: usize,
    pub viral_limit: usize,
}

impl RecommendationService {
    pub fn calculate_feed_quotas(total_interactions: i32, target_size: usize) -> FeedQuotas {
        let target_size = target_size.max(1);
        let (maturity, subscription_percent, discovery_percent, viral_percent) =
            if total_interactions < 30 {
                ("cold_start", 0.60, 0.35, 0.05)
            } else if total_interactions <= 100 {
                ("maturing", 0.40, 0.50, 0.10)
            } else {
                // Viral stays a small serendipity floor; personalization (subs + discovery) leads
                // for mature profiles instead of trending growing to ~29% of the feed.
                ("mature", 0.45, 0.45, 0.10)
            };

        let subscription_limit = ((target_size as f64) * subscription_percent).round() as usize;
        let mut discovery_limit = ((target_size as f64) * discovery_percent).round() as usize;
        let mut viral_limit = ((target_size as f64) * viral_percent).round() as usize;

        let rounded_total = subscription_limit + discovery_limit + viral_limit;
        if rounded_total > target_size {
            let overflow = rounded_total - target_size;
            let viral_reduction = viral_limit.min(overflow);
            viral_limit -= viral_reduction;
            let remaining_overflow = overflow - viral_reduction;
            if remaining_overflow > 0 {
                discovery_limit = discovery_limit.saturating_sub(remaining_overflow);
            }
        } else if rounded_total < target_size {
            discovery_limit += target_size - rounded_total;
        }

        FeedQuotas {
            maturity: maturity.to_string(),
            total_interactions,
            subscription_percent,
            discovery_percent,
            viral_percent,
            subscription_limit,
            discovery_limit,
            viral_limit,
        }
    }

    fn has_meaningful_brain_data(brain: &UserBrain) -> bool {
        brain.has_completed_onboarding
            || brain.total_interactions > 0
            || brain.idf_total_documents > 0
            || !brain.preferred_topics.is_empty()
            || !brain.global_vector.topics.is_empty()
            || !brain.watch_history_map.is_empty()
            || !brain.channel_scores.is_empty()
            || !brain.topic_evidence.is_empty()
    }

    fn topic_maturity_label(maturity: TopicMaturity) -> &'static str {
        match maturity {
            TopicMaturity::Emerging => "emerging",
            TopicMaturity::Developing => "developing",
            TopicMaturity::Established => "established",
            TopicMaturity::Core => "core",
        }
    }

    fn discovery_freshness_words() -> &'static [&'static str] {
        &["latest", "new"]
    }

    fn discovery_long_form_words() -> &'static [&'static str] {
        &["documentary", "deep dive", "analysis", "breakdown"]
    }

    fn discovery_short_form_words() -> &'static [&'static str] {
        &["highlights", "best moments", "compilation"]
    }

    fn discovery_noise_words() -> &'static [&'static str] {
        &[
            "prompt",
            "prompts",
            "prompting",
            "use",
            "used",
            "using",
            "guide",
            "tutorial",
            "tips",
            "tricks",
            "thing",
            "things",
            "stuff",
            "way",
            "ways",
            "type",
            "types",
            "kind",
            "level",
            "sensei",
            "guru",
            "master",
            "pro",
            "official",
            "studio",
            "studios",
            "media",
            "network",
            "viral",
            "popular",
            "meme",
            "memes",
            "tiktok",
            "tiktoks",
            "short",
            "shorts",
            "minute",
            "minutes",
            "now",
        ]
    }

    fn discovery_filler_words() -> &'static [&'static str] {
        &[
            "best",
            "new",
            "top",
            "how",
            "what",
            "why",
            "complete",
            "full",
            "advanced",
            "beginner",
            "learn",
            "understand",
            "understanding",
            "morning",
            "evening",
            "night",
            "afternoon",
            "late",
            "early",
            "chill",
            "relaxing",
            "quick",
            "fast",
            "slow",
            "must",
            "watch",
            "see",
            "latest",
        ]
    }

    fn discovery_polysemous_words() -> &'static [&'static str] {
        &[
            "code", "design", "build", "run", "play", "model", "train", "stream", "rock", "metal",
            "spring", "cell", "plant", "jam", "wave", "track", "scale", "craft", "mix", "beat",
            "sound", "flow", "space", "match",
        ]
    }

    fn broad_discovery_seed_words() -> &'static [&'static str] {
        &[
            "technology",
            "tech",
            "science",
            "music",
            "song",
            "build",
            "make",
            "game",
            "gaming",
            "basketball",
            "sport",
            "sports",
            "fitness",
            "workout",
            "food",
            "news",
            "day",
            "review",
            "tutorial",
            "guide",
        ]
    }

    fn domain_to_query_word(domain: &str) -> Option<&'static str> {
        match domain {
            "programming" => Some("programming"),
            "music" => Some("music"),
            "gaming" => Some("gaming"),
            "tech" => Some("technology"),
            "sport" => Some("sports"),
            "fitness" => Some("fitness"),
            "science" => Some("science"),
            "nature" => Some("nature"),
            "live" => Some("livestream"),
            "ai" => Some("artificial intelligence"),
            "business" => Some("business"),
            "pc" => Some("pc build"),
            "graphic" => Some("graphic design"),
            "interior" => Some("interior design"),
            "game" => Some("game design"),
            "diy" => Some("diy crafts"),
            "entertainment" => Some("movie"),
            _ => None,
        }
    }

    pub fn new(pool: SqlitePool, brain_store: Arc<BrainStore>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self {
            pool,
            brain_store,
            impression_cache: Mutex::new(HashMap::new()),
            session_topic_history: Mutex::new(Vec::new()),
            session_video_count: Mutex::new(0),
            session_start_time: now,
        }
    }

    /// Best-effort persistence of the resident brain; called on the debounce timer and on exit.
    pub async fn flush_brain(&self) -> AppResult<()> {
        self.brain_store.flush().await
    }

    /// Reload the resident brain from the database after a sync merge wrote it directly.
    pub async fn reload_brain(&self) -> AppResult<()> {
        self.brain_store.reload().await
    }

    fn get_current_time_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    pub fn parse_view_count(text: Option<&str>) -> u64 {
        let t = match text {
            Some(val) => val.to_lowercase(),
            None => return 0,
        };
        let clean: String = t
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if clean.is_empty() {
            return 0;
        }
        let num: f64 = clean.parse().unwrap_or(0.0);
        if t.contains('m') {
            (num * 1_000_000.0) as u64
        } else if t.contains('k') {
            (num * 1_000.0) as u64
        } else if t.contains('b') {
            (num * 1_000_000_000.0) as u64
        } else {
            num as u64
        }
    }

    fn has_confirmed_topic_evidence(brain: &UserBrain, topic: &str) -> bool {
        let base = strip_domain_tag(topic);
        if brain
            .preferred_topics
            .iter()
            .any(|preferred| normalize_lemma(preferred) == base)
        {
            return true;
        }

        let evidence = brain
            .topic_evidence
            .get(&base)
            .or_else(|| brain.topic_evidence.get(topic));

        matches!(
            evidence,
            Some(TopicEvidence {
                explicit_signals,
                watch_signals,
                positive_score,
                video_ids,
                ..
            }) if *explicit_signals > 0 || *watch_signals >= 2 || video_ids.len() >= 2 || *positive_score >= 1.2
        )
    }

    fn is_substantial_topic(topic: &str) -> bool {
        let lower = topic.trim().to_lowercase();
        if lower.len() < 3 {
            return false;
        }
        if Self::discovery_noise_words().contains(&lower.as_str()) {
            return false;
        }
        if !lower.chars().any(|c| c.is_ascii_alphabetic()) {
            return false;
        }
        if lower.starts_with("20") && lower.len() == 4 && lower.chars().all(|c| c.is_ascii_digit())
        {
            return false;
        }
        let base = strip_domain_tag(&lower);
        base.len() >= 3
            && base.chars().any(|c| c.is_ascii_alphabetic())
            && !base.chars().all(|c| c.is_ascii_digit())
    }

    fn needs_query_enrichment(topic: &str) -> bool {
        let base = strip_domain_tag(topic);
        Self::is_broad_singleton_query(&base)
            || base.len() < 6
            || Self::discovery_polysemous_words().contains(&base.as_str())
    }

    fn is_broad_singleton_query(query: &str) -> bool {
        let normalized = normalize_lemma(&strip_domain_tag(query).replace('_', " "));
        !normalized.contains(' ')
            && (is_generic_word(&normalized)
                || Self::broad_discovery_seed_words().contains(&normalized.as_str()))
    }

    fn build_discovery_query(topic: &str, brain: &UserBrain) -> String {
        let base = strip_domain_tag(topic);
        let normalized_base = normalize_lemma(&base);
        if !Self::needs_query_enrichment(&base) {
            return base;
        }

        if let Some((_, domain)) = topic.split_once(':') {
            return match Self::domain_to_query_word(domain) {
                Some(qualifier) => format!("{} {}", base, qualifier),
                None => format!("{} {}", base, domain),
            };
        }

        let affinity_partner = brain
            .topic_affinities
            .iter()
            .filter_map(|(key, score)| {
                if *score <= 0.10 {
                    return None;
                }
                let parts: Vec<&str> = key.split([':', '|']).collect();
                if parts.len() != 2 {
                    return None;
                }
                let left = strip_domain_tag(parts[0]);
                let right = strip_domain_tag(parts[1]);
                if left == base
                    && Self::is_substantial_topic(&right)
                    && !Self::is_broad_singleton_query(&right)
                {
                    Some((right, *score))
                } else if right == base
                    && Self::is_substantial_topic(&left)
                    && !Self::is_broad_singleton_query(&left)
                {
                    Some((left, *score))
                } else {
                    None
                }
            })
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(partner, _)| partner);

        if let Some(partner) = affinity_partner {
            return format!("{} {}", base, partner);
        }

        if let Some((co_topic, _)) = brain
            .global_vector
            .topics
            .iter()
            .filter_map(|(topic_name, score)| {
                let co_topic = strip_domain_tag(topic_name);
                if co_topic != base
                    && *score > 0.05
                    && Self::is_substantial_topic(&co_topic)
                    && !Self::is_broad_singleton_query(&co_topic)
                {
                    Some((co_topic, *score))
                } else {
                    None
                }
            })
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        {
            return format!("{} {}", base, co_topic);
        }

        if let Some(category_keyword) = get_topic_categories()
            .iter()
            .find(|category| {
                category
                    .keywords
                    .iter()
                    .any(|keyword| normalize_lemma(keyword) == normalized_base)
            })
            .and_then(|category| {
                category
                    .keywords
                    .iter()
                    .find(|keyword| {
                        let lemma = normalize_lemma(keyword);
                        lemma != normalized_base
                            && keyword.len() > 3
                            && !Self::is_broad_singleton_query(&lemma)
                    })
                    .cloned()
            })
        {
            return format!("{} {}", base, category_keyword.to_lowercase());
        }

        base
    }

    fn analyze_mature_topics(
        brain: &UserBrain,
        time_topic_scores: &HashMap<String, f64>,
    ) -> Vec<MatureTopic> {
        let mut topic_scores: HashMap<String, (f64, f64)> = HashMap::new();

        for (name, score) in &brain.global_vector.topics {
            let normalized = strip_domain_tag(name);
            if !Self::is_substantial_topic(&normalized) {
                continue;
            }
            let entry = topic_scores.entry(normalized).or_insert((0.0, 0.0));
            entry.0 = entry.0.max(*score);
        }

        for (name, score) in time_topic_scores {
            let normalized = strip_domain_tag(name);
            if !Self::is_substantial_topic(&normalized) {
                continue;
            }
            let entry = topic_scores.entry(normalized).or_insert((0.0, 0.0));
            entry.1 = entry.1.max(*score);
        }

        let mut topics: Vec<MatureTopic> = topic_scores
            .into_iter()
            .map(|(normalized, (global_score, time_score))| {
                let has_time_context =
                    time_score > 0.0 || time_topic_scores.contains_key(&normalized);
                let selection_score = if has_time_context {
                    (global_score.max(time_score).max(TIME_CONTEXT_MIN_SCORE)
                        * TIME_CONTEXT_SELECTION_MULTIPLIER)
                        .min(1.0)
                } else {
                    global_score
                };

                let maturity = if selection_score >= 0.70 {
                    TopicMaturity::Core
                } else if selection_score >= 0.40 {
                    TopicMaturity::Established
                } else if selection_score >= 0.20 {
                    TopicMaturity::Developing
                } else {
                    TopicMaturity::Emerging
                };

                let category_support = get_topic_categories()
                    .iter()
                    .filter(|category| {
                        let lemmas: Vec<String> = category
                            .keywords
                            .iter()
                            .map(|keyword| normalize_lemma(keyword))
                            .collect();
                        lemmas.contains(&normalized)
                            && lemmas
                                .iter()
                                .filter(|lemma| brain.global_vector.topics.contains_key(*lemma))
                                .count()
                                >= 2
                    })
                    .count();

                MatureTopic {
                    name: normalized.clone(),
                    score: selection_score,
                    maturity,
                    category_support,
                    has_time_context,
                    has_discovery_evidence: Self::has_confirmed_topic_evidence(brain, &normalized),
                }
            })
            .collect();

        topics.sort_by(|a, b| {
            b.maturity
                .cmp(&a.maturity)
                .then_with(|| {
                    b.score
                        .partial_cmp(&a.score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| b.has_time_context.cmp(&a.has_time_context))
                .then_with(|| b.category_support.cmp(&a.category_support))
        });
        topics
    }

    fn topic_is_discovery_eligible(topic: &MatureTopic, is_mature_brain: bool) -> bool {
        topic.has_time_context
            || topic.has_discovery_evidence
            || topic.maturity >= TopicMaturity::Developing
            || (is_mature_brain && topic.score >= 0.10)
    }

    fn calculate_discovery_confidence(topic: &MatureTopic) -> f64 {
        let maturity_base = match topic.maturity {
            TopicMaturity::Core => 0.90,
            TopicMaturity::Established => 0.75,
            TopicMaturity::Developing => 0.55,
            TopicMaturity::Emerging => 0.35,
        };
        let support_bonus = (topic.category_support as f64 * 0.03).min(0.10);
        let time_bonus = if topic.has_time_context { 0.20 } else { 0.0 };
        (maturity_base + support_bonus + time_bonus).clamp(0.20, 0.95)
    }

    fn is_invalid_singleton_query(query: &str) -> bool {
        let trimmed = query.trim();
        if trimmed.is_empty() || trimmed.split_whitespace().count() != 1 {
            return false;
        }

        let token = trimmed.to_lowercase();
        Self::discovery_noise_words().contains(&token.as_str())
            || !token.chars().any(|c| c.is_ascii_alphabetic())
            || token.chars().filter(|c| c.is_ascii_alphabetic()).count() < 3
    }

    fn sanitize_discovery_query(raw: &str) -> Option<String> {
        let mut deduped = Vec::new();
        for word in raw.split_whitespace() {
            let lower = word.trim().to_lowercase();
            if lower.is_empty() || Self::discovery_noise_words().contains(&lower.as_str()) {
                continue;
            }
            if lower.starts_with("20")
                && lower.len() == 4
                && lower.chars().all(|c| c.is_ascii_digit())
            {
                continue;
            }
            if !deduped.iter().any(|existing: &String| existing == &lower) {
                deduped.push(lower);
            }
        }

        if deduped.is_empty() {
            return None;
        }

        let result = deduped.join(" ");
        if Self::is_invalid_singleton_query(&result) {
            return None;
        }
        if result.len() > 60 {
            result[..60]
                .rsplit_once(' ')
                .map(|(head, _)| head.to_string())
                .or(Some(result[..60].to_string()))
        } else {
            Some(result)
        }
    }

    fn discovery_query_blocked(query: &str, blocked: &HashSet<String>) -> bool {
        let lower = query.to_lowercase();
        blocked
            .iter()
            .any(|blocked_term| lower.contains(&blocked_term.to_lowercase()))
    }

    fn top_anchor_topics(brain: &UserBrain) -> Vec<String> {
        let mut anchors: Vec<(String, f64, f64)> = brain
            .global_vector
            .anchor_topics
            .iter()
            .filter_map(|topic| {
                let normalized = strip_domain_tag(topic);
                if normalized.contains('_')
                    || !Self::is_substantial_topic(&normalized)
                    || brain
                        .blocked_topics
                        .iter()
                        .any(|blocked| normalized.contains(blocked))
                {
                    return None;
                }

                let weight = brain
                    .global_vector
                    .topics
                    .get(topic)
                    .copied()
                    .unwrap_or(0.0);
                let confidence = brain
                    .global_vector
                    .topic_confidence
                    .get(topic)
                    .copied()
                    .unwrap_or(0.0);
                Some((normalized, weight, confidence))
            })
            .collect();

        anchors.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
                .then_with(|| a.0.cmp(&b.0))
        });
        anchors.dedup_by(|a, b| a.0 == b.0);
        anchors
            .into_iter()
            .take(QUERY_BONDING_ANCHOR_LIMIT)
            .map(|(topic, _, _)| topic)
            .collect()
    }

    fn emerging_specific_tokens(brain: &UserBrain) -> Vec<String> {
        let mut tokens: Vec<(String, f64)> = brain
            .global_vector
            .topics
            .iter()
            .filter_map(|(topic, weight)| {
                let normalized = strip_domain_tag(topic);
                if !normalized.contains('_')
                    || brain.global_vector.anchor_topics.contains(topic)
                    || *weight <= 0.0
                    || *weight > EMERGING_TOKEN_MAX_WEIGHT
                    || brain
                        .blocked_topics
                        .iter()
                        .any(|blocked| normalized.contains(blocked))
                {
                    return None;
                }
                Some((normalized, *weight))
            })
            .collect();

        tokens.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        tokens.dedup_by(|a, b| a.0 == b.0);
        tokens
            .into_iter()
            .take(QUERY_BONDING_EMERGING_LIMIT)
            .map(|(topic, _)| topic)
            .collect()
    }

    fn build_query_bonding_candidates(brain: &UserBrain) -> Vec<DiscoveryQuery> {
        if brain.total_interactions >= QUERY_BONDING_INTERACTION_THRESHOLD {
            return Vec::new();
        }

        let anchors = Self::top_anchor_topics(brain);
        let emerging_tokens = Self::emerging_specific_tokens(brain);
        if anchors.is_empty() || emerging_tokens.is_empty() {
            return Vec::new();
        }

        let mut queries = Vec::new();
        for anchor in &anchors {
            for emerging in &emerging_tokens {
                if emerging == anchor || emerging.split('_').any(|part| part == anchor) {
                    continue;
                }
                let query = format!("{} {}", anchor, emerging);
                if Self::discovery_query_blocked(&query, &brain.blocked_topics) {
                    continue;
                }
                queries.push(DiscoveryQuery {
                    query,
                    confidence: 0.90,
                    strategy: "query_bonding",
                });
                if queries.len() >= QUERY_BONDING_QUERY_LIMIT {
                    return queries;
                }
            }
        }

        queries
    }

    fn extract_query_root(query: &str) -> Option<String> {
        let filler = Self::discovery_filler_words();
        let tokens: Vec<String> = query
            .split_whitespace()
            .filter(|token| token.len() > 2)
            .map(normalize_lemma)
            .filter(|token| !filler.contains(&token.as_str()))
            .collect();
        if tokens.is_empty() {
            return None;
        }
        let mut sorted = tokens;
        sorted.sort();
        sorted.dedup();
        Some(sorted.join("|"))
    }

    fn balance_discovery_queries(
        queries: Vec<DiscoveryQuery>,
        available_topic_count: usize,
    ) -> Vec<String> {
        let mut sorted = queries;
        sorted.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut deduped: Vec<DiscoveryQuery> = Vec::new();
        let mut seen_token_sets: Vec<HashSet<String>> = Vec::new();
        for query in sorted {
            let tokens: HashSet<String> = tokenize(&query.query).into_iter().collect();
            let is_duplicate = seen_token_sets.iter().any(|existing| {
                if existing.is_empty() || tokens.is_empty() {
                    return false;
                }
                let intersection = tokens.intersection(existing).count();
                let union = tokens.union(existing).count();
                union > 0 && (intersection as f64 / union as f64) > 0.3
            });
            if !is_duplicate {
                seen_token_sets.push(tokens);
                deduped.push(query);
            }
        }

        let min_distinct_topics = if available_topic_count >= 6 {
            4
        } else if available_topic_count >= 3 {
            3
        } else {
            available_topic_count.max(1)
        };

        let strategy_priority = [
            "query_bonding",
            "deep_dive",
            "cross_topic",
            "trending",
            "contextual",
            "channel_discovery",
            "adjacent_exploration",
            "format_driven",
        ];

        let mut balanced: Vec<DiscoveryQuery> = Vec::new();
        let mut covered_roots: HashSet<String> = HashSet::new();

        for strategy in strategy_priority {
            if let Some(best) = deduped.iter().find(|query| query.strategy == strategy) {
                let query = best.clone();
                if !balanced
                    .iter()
                    .any(|existing| existing.query == query.query)
                {
                    if let Some(root) = Self::extract_query_root(&query.query) {
                        covered_roots.insert(root);
                    }
                    balanced.push(query);
                }
            }
        }

        if covered_roots.len() < min_distinct_topics {
            let remaining: Vec<DiscoveryQuery> = deduped
                .iter()
                .filter(|query| {
                    !balanced
                        .iter()
                        .any(|existing| existing.query == query.query)
                })
                .cloned()
                .collect();
            for query in remaining {
                if let Some(root) = Self::extract_query_root(&query.query) {
                    if !covered_roots.contains(&root) {
                        covered_roots.insert(root);
                        balanced.push(query);
                    }
                }
                if covered_roots.len() >= min_distinct_topics {
                    break;
                }
            }
        }

        let mut topic_count_in_output: HashMap<String, usize> = HashMap::new();
        for query in &balanced {
            if let Some(root) = Self::extract_query_root(&query.query) {
                *topic_count_in_output.entry(root).or_insert(0) += 1;
            }
        }

        for query in deduped {
            if balanced.len() >= 12
                || balanced
                    .iter()
                    .any(|existing| existing.query == query.query)
            {
                continue;
            }
            let root = Self::extract_query_root(&query.query);
            if let Some(root_key) = root.clone() {
                if topic_count_in_output.get(&root_key).copied().unwrap_or(0) >= 2 {
                    continue;
                }
            }
            let strategy_count = balanced
                .iter()
                .filter(|existing| existing.strategy == query.strategy)
                .count();
            if strategy_count >= 3 {
                continue;
            }
            if let Some(root_key) = root {
                *topic_count_in_output.entry(root_key).or_insert(0) += 1;
            }
            balanced.push(query);
        }

        balanced.into_iter().map(|query| query.query).collect()
    }

    fn rotate_against_recent_queries(
        queries: Vec<String>,
        recent_query_tokens: &[HashSet<String>],
    ) -> (Vec<String>, bool) {
        if recent_query_tokens.is_empty() || queries.len() <= QUERY_ROTATION_FLOOR {
            return (queries, false);
        }

        let (fresh, overlapping): (Vec<String>, Vec<String>) =
            queries.iter().cloned().partition(|query| {
                let tokens: HashSet<String> = tokenize(query).into_iter().collect();
                if tokens.is_empty() {
                    return true;
                }
                !recent_query_tokens
                    .iter()
                    .take(QUERY_ROTATION_RECENT_WINDOW)
                    .any(|recent| {
                        if recent.is_empty() {
                            return false;
                        }
                        let intersection = tokens.intersection(recent).count();
                        let union = tokens.union(recent).count();
                        union > 0
                            && (intersection as f64 / union as f64) > QUERY_OVERLAP_THRESHOLD
                    })
            });

        let saturated = fresh.len() < QUERY_ROTATION_FLOOR;
        if overlapping.is_empty() {
            return (fresh, saturated);
        }

        let mut rotated = fresh;
        for query in overlapping {
            if rotated.len() >= QUERY_ROTATION_FLOOR {
                break;
            }
            rotated.push(query);
        }
        (rotated, saturated)
    }

    fn calculate_adaptive_jitter(total_interactions: i32, feed_overlap_ratio: f64) -> f64 {
        if total_interactions < ONBOARDING_WARMUP_INTERACTIONS {
            JITTER_COLD_START
        } else if feed_overlap_ratio > 0.5 {
            0.12
        } else if feed_overlap_ratio > 0.2 {
            0.06
        } else {
            JITTER_NORMAL
        }
    }

    pub async fn generate_discovery_queries(&self) -> AppResult<Vec<String>> {
        let mut brain = self.brain_store.write().await;
        let persona = classify_persona(&brain);
        let current_bucket = TimeBucket::current();
        let current_year = chrono::Local::now().year();
        let is_mature_brain = brain.total_interactions > 50;
        let time_topic_scores: HashMap<String, f64> = brain
            .time_vectors
            .get(&current_bucket)
            .map(|vector| {
                let mut topics: Vec<(String, f64)> = vector
                    .topics
                    .iter()
                    .map(|(topic, score)| (strip_domain_tag(topic), *score))
                    .filter(|(topic, _)| Self::is_substantial_topic(topic))
                    .collect();
                topics.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                topics.into_iter().take(5).collect()
            })
            .unwrap_or_default();
        let time_topics: HashSet<String> = time_topic_scores.keys().cloned().collect();
        let mature_topics = Self::analyze_mature_topics(&brain, &time_topic_scores);
        let mature_topic_snapshot: Vec<String> = mature_topics
            .iter()
            .take(8)
            .map(|topic| {
                format!(
                    "{}:{:.2}:{}:support={}:time={}:evidence={}",
                    topic.name,
                    topic.score,
                    Self::topic_maturity_label(topic.maturity),
                    topic.category_support,
                    topic.has_time_context,
                    topic.has_discovery_evidence,
                )
            })
            .collect();
        let time_topic_snapshot: Vec<String> = time_topics.iter().cloned().collect();
        info!(
            persona = ?persona,
            total_interactions = brain.total_interactions,
            preferred_topics = brain.preferred_topics.len(),
            mature_topics = mature_topics.len(),
            "[discovery] starting query generation"
        );
        // The learned taste profile (topic scores + time-bucket topics) is a
        // privacy-sensitive fingerprint of the user. Keep it out of the default
        // INFO logs that get pasted verbatim into public bug reports — DEBUG only.
        debug!(
            time_topics = ?time_topic_snapshot,
            topic_snapshot = ?mature_topic_snapshot,
            "[discovery] taste snapshot"
        );
        let mut queries: Vec<DiscoveryQuery> = Vec::new();
        let bonded_queries = Self::build_query_bonding_candidates(&brain);
        if !bonded_queries.is_empty() {
            let bonded_snapshot: Vec<String> = bonded_queries
                .iter()
                .map(|query| query.query.clone())
                .collect();
            info!(
                bonded = bonded_snapshot.len(),
                total_interactions = brain.total_interactions,
                "[discovery] added query bonding candidates"
            );
            debug!(bonded_queries = ?bonded_snapshot, "[discovery] bonding candidates");
            queries.extend(bonded_queries);
        }
        let primary = mature_topics
            .iter()
            .find(|topic| Self::topic_is_discovery_eligible(topic, is_mature_brain))
            .cloned();
        let secondary: Vec<MatureTopic> = mature_topics
            .iter()
            .filter(|topic| Self::topic_is_discovery_eligible(topic, is_mature_brain))
            .skip(1)
            .take(match persona {
                FlowPersona::Specialist => 1,
                FlowPersona::Explorer => 4,
                FlowPersona::Skimmer => 3,
                _ => 2,
            })
            .cloned()
            .collect();

        if let Some(primary_topic) = primary.clone() {
            queries.push(DiscoveryQuery {
                query: Self::build_discovery_query(&primary_topic.name, &brain),
                confidence: Self::calculate_discovery_confidence(&primary_topic),
                strategy: "deep_dive",
            });

            for topic in &secondary {
                queries.push(DiscoveryQuery {
                    query: Self::build_discovery_query(&topic.name, &brain),
                    confidence: Self::calculate_discovery_confidence(topic) - 0.05,
                    strategy: "deep_dive",
                });
            }

            for topic in secondary.iter().take(2) {
                queries.push(DiscoveryQuery {
                    query: format!(
                        "{} {}",
                        strip_domain_tag(&primary_topic.name),
                        strip_domain_tag(&topic.name)
                    ),
                    confidence: 0.60,
                    strategy: "cross_topic",
                });
            }

            if secondary.len() >= 2 {
                queries.push(DiscoveryQuery {
                    query: format!(
                        "{} {}",
                        strip_domain_tag(&secondary[0].name),
                        strip_domain_tag(&secondary[1].name)
                    ),
                    confidence: 0.50,
                    strategy: "cross_topic",
                });
            }

            let format_word = match persona {
                FlowPersona::DeepDiver | FlowPersona::Scholar => {
                    Some(Self::discovery_long_form_words()[0])
                }
                FlowPersona::Skimmer => Some(Self::discovery_short_form_words()[0]),
                _ if brain.global_vector.duration > 0.75 => {
                    Some(Self::discovery_long_form_words()[1])
                }
                _ if brain.global_vector.duration < 0.30 => {
                    Some(Self::discovery_short_form_words()[1])
                }
                _ => None,
            };
            if let Some(format_word) = format_word {
                queries.push(DiscoveryQuery {
                    query: format!("{} {}", strip_domain_tag(&primary_topic.name), format_word),
                    confidence: 0.55,
                    strategy: "format_driven",
                });
            }

            queries.push(DiscoveryQuery {
                query: format!(
                    "{} {}",
                    Self::build_discovery_query(&primary_topic.name, &brain),
                    current_year
                ),
                confidence: Self::calculate_discovery_confidence(&primary_topic) - 0.05,
                strategy: "trending",
            });
        }

        if secondary.len() >= 2 {
            queries.push(DiscoveryQuery {
                query: format!(
                    "{} {}",
                    strip_domain_tag(&secondary[0].name),
                    Self::discovery_freshness_words()[0]
                ),
                confidence: 0.50,
                strategy: "trending",
            });
        }

        let mut affinities: Vec<(String, f64)> = brain
            .topic_affinities
            .iter()
            .map(|(key, score)| (key.clone(), *score))
            .collect();
        affinities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        for (key, score) in affinities
            .into_iter()
            .filter(|(_, score)| *score > 0.15)
            .take(3)
        {
            let parts: Vec<&str> = key.split([':', '|']).collect();
            if parts.len() == 2
                && Self::is_substantial_topic(parts[0])
                && Self::is_substantial_topic(parts[1])
            {
                queries.push(DiscoveryQuery {
                    query: format!(
                        "{} {}",
                        strip_domain_tag(parts[0]),
                        strip_domain_tag(parts[1])
                    ),
                    confidence: 0.55 + (score * 0.25),
                    strategy: "cross_topic",
                });
            }
        }

        let confirmed_time_topics: Vec<String> = mature_topics
            .iter()
            .filter(|topic| topic.has_time_context)
            .take(3)
            .map(|topic| topic.name.clone())
            .collect();
        if let Some(first_time_topic) = confirmed_time_topics.first() {
            queries.push(DiscoveryQuery {
                query: Self::build_discovery_query(first_time_topic, &brain),
                confidence: 0.80,
                strategy: "contextual",
            });
        }
        if confirmed_time_topics.len() >= 2 {
            queries.push(DiscoveryQuery {
                query: format!("{} {}", confirmed_time_topics[0], confirmed_time_topics[1]),
                confidence: 0.70,
                strategy: "contextual",
            });
        }

        for (channel_id, score) in brain
            .channel_scores
            .iter()
            .filter(|(_, score)| **score > 0.5)
            .take(3)
        {
            let Some(profile) = brain.channel_topic_profiles.get(channel_id) else {
                continue;
            };
            let mut top_topics: Vec<(String, f64)> = profile
                .iter()
                .filter_map(|(topic, weight)| {
                    let normalized = strip_domain_tag(topic);
                    if Self::is_substantial_topic(&normalized)
                        && Self::has_confirmed_topic_evidence(&brain, &normalized)
                    {
                        Some((normalized, *weight))
                    } else {
                        None
                    }
                })
                .collect();
            top_topics.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            if top_topics.len() >= 2 {
                queries.push(DiscoveryQuery {
                    query: format!("{} {}", top_topics[0].0, top_topics[1].0),
                    confidence: 0.50 + (*score * 0.15),
                    strategy: "channel_discovery",
                });
            }
        }

        let top_channel_niche = brain
            .channel_topic_profiles
            .values()
            .flat_map(|profile| profile.iter())
            .fold(HashMap::<String, f64>::new(), |mut acc, (topic, weight)| {
                let normalized = strip_domain_tag(topic);
                if Self::is_substantial_topic(&normalized)
                    && Self::has_confirmed_topic_evidence(&brain, &normalized)
                {
                    *acc.entry(normalized).or_insert(0.0) += *weight;
                }
                acc
            })
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        if let Some((topic, _)) = top_channel_niche {
            queries.push(DiscoveryQuery {
                query: Self::build_discovery_query(&topic, &brain),
                confidence: 0.50,
                strategy: "channel_discovery",
            });
        }

        // Always reserve at least one exploration slot — never freeze discovery into a bubble.
        let exploration_budget = if brain.total_interactions > 80 { 1 } else { 2 };
        if exploration_budget > 0 {
            let mut underexplored: Vec<String> = get_topic_categories()
                .iter()
                .flat_map(|category| category.keywords.iter().take(3))
                .map(|topic| normalize_lemma(topic))
                .filter(|topic| {
                    brain
                        .global_vector
                        .topics
                        .get(topic)
                        .copied()
                        .unwrap_or(0.0)
                        < 0.08
                        && !brain
                            .blocked_topics
                            .iter()
                            .any(|blocked| topic.contains(blocked))
                })
                .collect();
            underexplored.sort();
            underexplored.dedup();
            for topic in underexplored.into_iter().take(exploration_budget) {
                queries.push(DiscoveryQuery {
                    query: Self::build_discovery_query(&topic, &brain),
                    confidence: 0.35,
                    strategy: "adjacent_exploration",
                });
            }
        }

        let existing_tokens: HashSet<String> = queries
            .iter()
            .flat_map(|query| tokenize(&query.query))
            .collect();
        for preferred in brain.preferred_topics.iter().take(5) {
            let lemma = normalize_lemma(preferred);
            if lemma.len() >= 3
                && !existing_tokens.contains(&lemma)
                && !brain
                    .blocked_topics
                    .iter()
                    .any(|blocked| lemma.contains(blocked))
            {
                queries.push(DiscoveryQuery {
                    query: Self::build_discovery_query(preferred.trim(), &brain),
                    confidence: 0.45,
                    strategy: "deep_dive",
                });
            }
        }

        let mut sanitized: Vec<DiscoveryQuery> = Vec::new();
        let blocked = &brain.blocked_topics;
        for query in queries {
            if blocked
                .iter()
                .any(|blocked_term| query.query.to_lowercase().contains(blocked_term))
            {
                debug!(
                    strategy = query.strategy,
                    query = %query.query,
                    "[discovery] dropped blocked query"
                );
                continue;
            }
            if let Some(sanitized_query) = Self::sanitize_discovery_query(&query.query) {
                let enriched_query = if Self::is_broad_singleton_query(&sanitized_query) {
                    let enriched = Self::build_discovery_query(&sanitized_query, &brain);
                    match Self::sanitize_discovery_query(&enriched) {
                        Some(candidate) if !Self::is_broad_singleton_query(&candidate) => candidate,
                        _ => {
                            debug!(
                                strategy = query.strategy,
                                query = %query.query,
                                "[discovery] dropped broad singleton query"
                            );
                            continue;
                        }
                    }
                } else {
                    sanitized_query
                };
                sanitized.push(DiscoveryQuery {
                    query: enriched_query,
                    confidence: query.confidence,
                    strategy: query.strategy,
                });
            } else {
                debug!(
                    strategy = query.strategy,
                    query = %query.query,
                    "[discovery] dropped empty query after sanitization"
                );
            }
        }

        let generated_snapshot: Vec<String> = sanitized
            .iter()
            .map(|query| format!("{}:{:.2}:{}", query.query, query.confidence, query.strategy))
            .collect();
        info!(
            generated = sanitized.len(),
            "[discovery] generated sanitized queries"
        );
        debug!(queries = ?generated_snapshot, "[discovery] generated query detail");

        let mut deduped = Self::balance_discovery_queries(sanitized, mature_topics.len());

        info!(balanced = deduped.len(), "[discovery] balanced query set");
        debug!(queries = ?deduped, "[discovery] balanced query detail");

        let before_rotation = deduped.len();
        let (rotated, rotation_saturated) =
            Self::rotate_against_recent_queries(deduped, &brain.recent_query_tokens);
        deduped = rotated;
        if rotation_saturated {
            brain.recent_query_tokens.clear();
        }
        if deduped.len() != before_rotation {
            info!(
                before = before_rotation,
                after = deduped.len(),
                saturated = rotation_saturated,
                "[discovery] rotated overlapping query set"
            );
            debug!(rotated_queries = ?deduped, "[discovery] rotated query detail");
        }

        let persisted_token_sets: Vec<Vec<String>> =
            deduped.iter().map(|query| tokenize(query)).collect();
        let previous_query_tokens = std::mem::take(&mut brain.recent_query_tokens);
        brain.recent_query_tokens = deduped
            .iter()
            .map(|query| tokenize(query).into_iter().collect::<HashSet<String>>())
            .chain(previous_query_tokens)
            .take(RECENT_QUERY_TOKENS_MAX)
            .collect();
        info!(
            finalized = deduped.len(),
            stored_recent_query_sets = brain.recent_query_tokens.len(),
            "[discovery] finalized query generation"
        );
        debug!(
            final_queries = ?deduped,
            final_token_sets = ?persisted_token_sets,
            "[discovery] finalized query detail"
        );

        Ok(deduped)
    }

    pub async fn rank_candidates(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
    ) -> AppResult<Vec<VideoSummary>> {
        self.rank_candidates_inner(candidates, user_subs, false)
            .await
    }

    /// Shorts ranking: keeps taste ordering and explicit blocks, but skips channel-
    /// level suppression so the high-volume feed isn't starved
    pub async fn rank_shorts_candidates(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
    ) -> AppResult<Vec<VideoSummary>> {
        self.rank_candidates_inner(candidates, user_subs, true)
            .await
    }

    async fn rank_candidates_inner(
        &self,
        candidates: Vec<VideoSummary>,
        user_subs: HashSet<String>,
        lenient: bool,
    ) -> AppResult<Vec<VideoSummary>> {
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        let candidate_count = candidates.len();

        let brain = self.brain_store.read().await;
        let now_ms = self.get_current_time_ms();
        let video_cutoff = now_ms.saturating_sub(VIDEO_SUPPRESSION_DAYS * 86_400_000);
        let channel_cutoff = now_ms.saturating_sub(CHANNEL_SUPPRESSION_DAYS * 86_400_000);

        // 1. Pre-filter blocked channels and topics
        let filtered: Vec<VideoSummary> = candidates
            .into_iter()
            .filter(|video| {
                let channel_id = video.channel_id.as_deref().unwrap_or(&video.id);
                if brain
                    .suppressed_video_ids
                    .get(&video.id)
                    .map(|ts| *ts >= video_cutoff)
                    .unwrap_or(false)
                {
                    return false;
                }
                if !lenient
                    && brain
                        .suppressed_channels
                        .get(channel_id)
                        .map(|ts| *ts >= channel_cutoff)
                        .unwrap_or(false)
                {
                    return false;
                }
                if brain.blocked_channels.contains(channel_id) {
                    return false;
                }
                if !lenient {
                    if let Some(strike) = brain.channel_strikes.get(channel_id) {
                        if channel_inferred_blocked(strike, now_ms) {
                            return false;
                        }
                    }
                }
                let title_lower = video.title.to_lowercase();
                let channel_lower = video.channel_name.to_lowercase();
                !brain
                    .blocked_topics
                    .iter()
                    .any(|blocked| title_lower.contains(blocked) || channel_lower.contains(blocked))
            })
            .collect();

        if filtered.is_empty() {
            return Ok(Vec::new());
        }

        // Snapshots of caches
        let idf_snapshot = IdfSnapshot {
            word_frequencies: brain.idf_word_frequency.clone(),
            total_documents: brain.idf_total_documents,
        };
        let impression_snap = self.impression_cache.lock().unwrap().clone();
        let session_topics = self.session_topic_history.lock().unwrap().clone();
        let session_vid_count = *self.session_video_count.lock().unwrap();
        let feed_overlap_ratio = if filtered.is_empty() || brain.feed_history.is_empty() {
            0.0
        } else {
            let candidate_ids: HashSet<String> =
                filtered.iter().map(|video| video.id.clone()).collect();
            let history_ids: HashSet<String> = brain
                .feed_history
                .iter()
                .filter(|(_, entry)| now_ms.saturating_sub(entry.last_shown) < 172_800_000)
                .map(|(video_id, _)| video_id.clone())
                .collect();
            let overlap = candidate_ids.intersection(&history_ids).count();
            overlap as f64 / candidate_ids.len() as f64
        };

        // Time context vector
        let current_bucket = TimeBucket::current();
        let time_context_vec = brain
            .time_vectors
            .get(&current_bucket)
            .cloned()
            .unwrap_or_default();

        // Boredom detection & dynamic temperatures
        let boredom_factor = (brain.consecutive_skips as f64 / 20.0).clamp(0.0, 0.5);
        let w_personality = 0.4 - (boredom_factor * 0.5);
        let w_context = 0.4 - (boredom_factor * 0.5);
        let w_novelty = 0.2 + boredom_factor;

        let is_onboarding = brain.total_interactions < ONBOARDING_WARMUP_INTERACTIONS;
        let onboarding_warmup = if is_onboarding {
            1.0 - (brain.total_interactions as f64 / ONBOARDING_WARMUP_INTERACTIONS as f64) * 0.5
        } else {
            0.5
        };

        let mut seed = now_ms;
        let mut next_random = move || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed as f64) / (u64::MAX as f64)
        };

        // Score every candidate through the normalized ranking pipeline (ranker module).
        let mut rng = next_random();
        let jitter_amount =
            Self::calculate_adaptive_jitter(brain.total_interactions, feed_overlap_ratio);

        let exploration_scale = match classify_persona(&brain) {
            FlowPersona::Specialist => 0.3,
            FlowPersona::Explorer => 1.0,
            _ => 0.6,
        };

        let rank_inputs = ranker::RankInputs {
            brain: &brain,
            time_context: &time_context_vec,
            weights: ranker::ScoringWeights {
                personality: w_personality,
                context: w_context,
                novelty: w_novelty,
            },
            now_ms,
            is_onboarding,
            onboarding_warmup,
            session_topics: &session_topics,
            session_video_count: session_vid_count,
            candidate_pool_size: candidate_count,
            exploration_scale,
        };

        let mut candidates_map: HashMap<String, VideoSummary> =
            HashMap::with_capacity(filtered.len());
        let mut scored: Vec<ScoredVideo> = Vec::with_capacity(filtered.len());

        for video in filtered {
            let channel_id = video.channel_id.clone().unwrap_or_else(|| video.id.clone());
            let is_short = video.duration_seconds.unwrap_or(0) <= 60;
            let video_vector = extract_features(
                &video.title,
                &video.channel_name,
                None, // Feeds don't carry descriptions
                video.duration_seconds,
                false,
                is_short,
                &idf_snapshot,
            );

            let candidate = ranker::Candidate {
                video_vector: &video_vector,
                video_id: &video.id,
                title: &video.title,
                channel_name: &video.channel_name,
                channel_id: &channel_id,
                duration_seconds: video.duration_seconds,
                published_text: video.published_text.as_deref().unwrap_or(""),
                view_count: Self::parse_view_count(video.view_count_text.as_deref()),
                is_subscription: user_subs.contains(&channel_id),
                impression: impression_snap.get(&video.id).copied(),
            };

            let score = ranker::score_candidate(&rank_inputs, &candidate) + rng * jitter_amount;
            rng = next_random();

            scored.push(ScoredVideo {
                id: video.id.clone(),
                title: video.title.clone(),
                channel_id,
                score,
                vector: video_vector,
            });
            candidates_map.insert(video.id.clone(), video);
        }

        let reranked_ids = apply_smart_diversity(scored);

        // Reassemble VideoSummary records in reranked order, then append any diversity drop-outs.
        let mut final_results = Vec::with_capacity(candidates_map.len());
        for id in reranked_ids {
            if let Some(video) = candidates_map.remove(&id) {
                final_results.push(video);
            }
        }
        for (_, video) in candidates_map {
            final_results.push(video);
        }

        Ok(final_results)
    }

    pub async fn log_video_interaction(
        &self,
        video_id: &str,
        title: &str,
        channel_name: &str,
        channel_id: &str,
        description: Option<&str>,
        duration_sec: Option<u64>,
        is_live: bool,
        is_short: bool,
        interaction_type: InteractionType,
        percent_watched: f32,
    ) -> AppResult<()> {
        let channel_id = channel_id.trim().trim_start_matches("channel:");
        let outcome = {
            let mut brain = self.brain_store.write().await;
            apply_interaction(
                &mut brain,
                video_id,
                title,
                channel_name,
                channel_id,
                description,
                duration_sec,
                is_live,
                is_short,
                interaction_type,
                percent_watched,
            )
        };

        let Some(learning_rate) = outcome.learning_rate else {
            return Ok(());
        };

        recommendations::log_recommendation_event(
            &self.pool,
            interaction_type.as_str(),
            Some(video_id),
            Some(channel_name),
            None,
            Some(learning_rate),
        )
        .await?;

        if matches!(
            interaction_type,
            InteractionType::Click | InteractionType::Watched
        ) {
            if let Some(primary_topic) = outcome.primary_topic {
                let mut history = self.session_topic_history.lock().unwrap();
                history.push(primary_topic);
                if history.len() > SESSION_TOPIC_HISTORY_MAX {
                    history.remove(0);
                }
                let mut count = self.session_video_count.lock().unwrap();
                *count += 1;
            }
        }

        Ok(())
    }

    pub async fn record_feed_impressions(&self, videos: Vec<VideoSummary>) -> AppResult<()> {
        if videos.is_empty() {
            return Ok(());
        }

        let now_ms = self.get_current_time_ms();
        let mut unique_videos = Vec::new();
        let mut seen = HashSet::new();
        for video in videos {
            if seen.insert(video.id.clone()) {
                unique_videos.push(video);
            }
        }

        {
            let mut cache = self.impression_cache.lock().unwrap();
            for video in &unique_videos {
                let entry = cache.entry(video.id.clone()).or_insert((0, now_ms));
                entry.0 += 1;
                entry.1 = now_ms;
            }

            if cache.len() > IMPRESSION_CACHE_MAX {
                if let Some(oldest_key) = cache.keys().next().cloned() {
                    cache.remove(&oldest_key);
                }
            }
        }

        let mut brain = self.brain_store.write().await;
        for video in &unique_videos {
            let entry = brain
                .feed_history
                .entry(video.id.clone())
                .or_insert(FeedEntry {
                    last_shown: now_ms,
                    show_count: 0,
                });
            entry.last_shown = now_ms;
            entry.show_count += 1;
        }

        let feed_cutoff = now_ms.saturating_sub(FEED_HISTORY_EXPIRY_DAYS * 86_400_000);
        brain
            .feed_history
            .retain(|_, entry| entry.last_shown >= feed_cutoff);
        if brain.feed_history.len() > FEED_HISTORY_MAX {
            let mut entries: Vec<(String, FeedEntry)> = brain
                .feed_history
                .iter()
                .map(|(video_id, entry)| (video_id.clone(), entry.clone()))
                .collect();
            entries.sort_by(|a, b| b.1.last_shown.cmp(&a.1.last_shown));
            let retained: HashSet<String> = entries
                .into_iter()
                .take(FEED_HISTORY_MAX)
                .map(|(video_id, _)| video_id)
                .collect();
            brain
                .feed_history
                .retain(|video_id, _| retained.contains(video_id));
        }

        Ok(())
    }

    pub async fn get_personality(&self) -> AppResult<FlowPersona> {
        let brain = self.brain_store.read().await;
        Ok(classify_persona(&brain))
    }

    pub async fn complete_onboarding(&self, topics: Vec<String>) -> AppResult<()> {
        let mut brain = self.brain_store.write().await;

        let mut preferred = HashSet::new();
        for (index, topic) in topics.into_iter().enumerate() {
            let trimmed = topic.trim();
            if trimmed.is_empty() {
                continue;
            }

            let weight = if index < 3 {
                0.55
            } else if index < 6 {
                0.40
            } else {
                0.30
            };
            for token in tokenize(trimmed) {
                brain.global_vector.topics.insert(token.clone(), weight);
                brain
                    .global_vector
                    .topic_confidence
                    .insert(token.clone(), 1.0);
                brain.global_vector.anchor_topics.insert(token.clone());
            }
            preferred.insert(trimmed.to_string());
        }

        brain.preferred_topics = preferred;
        brain.has_completed_onboarding = true;
        Ok(())
    }

    pub async fn get_onboarding_status(&self) -> AppResult<bool> {
        let (completed, needs_flag) = {
            let brain = self.brain_store.read().await;
            let completed = Self::has_meaningful_brain_data(&brain);
            (completed, completed && !brain.has_completed_onboarding)
        };
        if needs_flag {
            self.brain_store.write().await.has_completed_onboarding = true;
        }
        Ok(completed)
    }

    pub async fn get_cached_music_home(
        &self,
    ) -> AppResult<Option<(Vec<MusicHomeSection>, Vec<MusicHomeChip>)>> {
        let sections_rows = sqlx::query(
            "SELECT section_id, title, subtitle, tracks_json, order_by FROM music_home_sections ORDER BY order_by ASC"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(crate::errors::AppError::from)?;

        let chips_rows = sqlx::query(
            "SELECT title, browse_id, params, order_by FROM music_home_chips ORDER BY order_by ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(crate::errors::AppError::from)?;

        if sections_rows.is_empty() && chips_rows.is_empty() {
            return Ok(None);
        }

        let mut sections = Vec::new();
        for r in sections_rows {
            let section_id: String = sqlx::Row::get(&r, 0);
            let title: String = sqlx::Row::get(&r, 1);
            let subtitle: Option<String> = sqlx::Row::get(&r, 2);
            let tracks_json: String = sqlx::Row::get(&r, 3);
            let order_by: i32 = sqlx::Row::get(&r, 4);

            let tracks = serde_json::from_str(&tracks_json).unwrap_or_else(|_| Vec::new());

            sections.push(MusicHomeSection {
                section_id,
                title,
                subtitle,
                tracks,
                order_by,
            });
        }

        let mut chips = Vec::new();
        for r in chips_rows {
            let title: String = sqlx::Row::get(&r, 0);
            let browse_id: Option<String> = sqlx::Row::get(&r, 1);
            let params: Option<String> = sqlx::Row::get(&r, 2);
            let order_by: i32 = sqlx::Row::get(&r, 3);

            chips.push(MusicHomeChip {
                title,
                browse_id,
                params,
                order_by,
            });
        }

        Ok(Some((sections, chips)))
    }

    pub async fn cache_music_home(
        &self,
        sections: &[MusicHomeSection],
        chips: &[MusicHomeChip],
    ) -> AppResult<()> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(crate::errors::AppError::from)?;

        sqlx::query("DELETE FROM music_home_sections")
            .execute(&mut *tx)
            .await
            .map_err(crate::errors::AppError::from)?;

        sqlx::query("DELETE FROM music_home_chips")
            .execute(&mut *tx)
            .await
            .map_err(crate::errors::AppError::from)?;

        for section in sections {
            let tracks_json =
                serde_json::to_string(&section.tracks).map_err(crate::errors::AppError::from)?;
            sqlx::query(
                "INSERT INTO music_home_sections (section_id, title, subtitle, tracks_json, order_by) VALUES (?, ?, ?, ?, ?)"
            )
            .bind(&section.section_id)
            .bind(&section.title)
            .bind(&section.subtitle)
            .bind(tracks_json)
            .bind(section.order_by)
            .execute(&mut *tx)
            .await
            .map_err(crate::errors::AppError::from)?;
        }

        for chip in chips {
            sqlx::query(
                "INSERT INTO music_home_chips (title, browse_id, params, order_by) VALUES (?, ?, ?, ?)"
            )
            .bind(&chip.title)
            .bind(&chip.browse_id)
            .bind(&chip.params)
            .bind(chip.order_by)
            .execute(&mut *tx)
            .await
            .map_err(crate::errors::AppError::from)?;
        }

        tx.commit().await.map_err(crate::errors::AppError::from)?;
        Ok(())
    }

    pub async fn get_personalized_music_recommendations(
        &self,
        youtube_service: &YoutubeService,
        limit: usize,
    ) -> AppResult<Vec<VideoSummary>> {
        let rows = sqlx::query(
            "SELECT video_id, title, channel_name, total_duration_seconds FROM watch_history ORDER BY watch_date DESC, created_at DESC LIMIT 500"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(crate::errors::AppError::from)?;

        let mut music_seeds = Vec::new();
        for r in rows {
            let video_id: String = sqlx::Row::get(&r, 0);
            let title: String = sqlx::Row::get(&r, 1);
            let channel_name: Option<String> = sqlx::Row::get(&r, 2);
            let total_duration_seconds: Option<i64> = sqlx::Row::get(&r, 3);

            let ch_name = channel_name.as_deref().unwrap_or("");
            let duration = total_duration_seconds.map(|d| d as u64);
            if is_music_track(&title, ch_name, duration) {
                if !music_seeds.contains(&video_id) {
                    music_seeds.push(video_id);
                    if music_seeds.len() >= 10 {
                        break;
                    }
                }
            }
        }

        let mut candidates = Vec::new();

        if !music_seeds.is_empty() {
            let mut seeds = Vec::new();
            let mut lcg_seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u32;

            let count_to_pick = music_seeds.len().min(4);
            let mut indices: Vec<usize> = (0..music_seeds.len()).collect();

            for i in (1..indices.len()).rev() {
                lcg_seed = lcg_seed.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fffffff;
                let j = (lcg_seed as usize) % (i + 1);
                indices.swap(i, j);
            }

            for &idx in indices.iter().take(count_to_pick) {
                seeds.push(music_seeds[idx].clone());
            }

            let mut futures = Vec::new();
            for seed in &seeds {
                futures.push(youtube_service.get_music_related(seed));
            }

            let results = futures_util::future::join_all(futures).await;
            let mut seen_ids = HashSet::new();

            for res in results {
                if let Ok(tracks) = res {
                    for track in tracks {
                        if seen_ids.insert(track.id.clone()) {
                            candidates.push(track);
                        }
                    }
                }
            }
        }

        if candidates.is_empty() {
            if let Ok(trending_music) = youtube_service
                .search_music("trending songs", "songs")
                .await
            {
                candidates = trending_music;
            } else if let Ok(trending_fallback) =
                youtube_service.get_trending_videos(None, None).await
            {
                candidates = trending_fallback
                    .into_iter()
                    .filter(|v| is_music_track(&v.title, &v.channel_name, v.duration_seconds))
                    .collect();
            }
        }

        let mut deduped: Vec<VideoSummary> = Vec::new();
        let mut seen = HashSet::new();
        for v in candidates {
            if seen.insert(v.id.clone()) {
                deduped.push(v);
            }
        }

        if !deduped.is_empty() {
            let mut lcg_seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u32;
            for i in (1..deduped.len()).rev() {
                lcg_seed = lcg_seed.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fffffff;
                let j = (lcg_seed as usize) % (i + 1);
                deduped.swap(i, j);
            }
        }

        deduped.truncate(limit);
        Ok(deduped)
    }

    pub async fn get_subscription_rotation_feed(
        &self,
        youtube_service: &YoutubeService,
    ) -> AppResult<Vec<VideoSummary>> {
        #[derive(serde::Deserialize)]
        struct SubscribedChannel {
            id: String,
        }

        let subs_json = match crate::db::settings::get_setting(&self.pool, "subscriptions").await? {
            Some(s) => s,
            None => return Ok(Vec::new()),
        };

        let mut channel_ids = Vec::new();
        if let Ok(channels) = serde_json::from_str::<Vec<SubscribedChannel>>(&subs_json) {
            channel_ids = channels.into_iter().map(|c| c.id).collect();
        } else if let Ok(ids) = serde_json::from_str::<Vec<String>>(&subs_json) {
            channel_ids = ids;
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&subs_json) {
            if let Some(arr) = val.as_array() {
                for item in arr {
                    if let Some(id) = item.as_str() {
                        channel_ids.push(id.to_string());
                    } else if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        channel_ids.push(id.to_string());
                    }
                }
            }
        }

        if channel_ids.is_empty() {
            return Ok(Vec::new());
        }

        let cursor_str = crate::db::settings::get_setting(&self.pool, "homeSubsRotationCursor")
            .await?
            .unwrap_or_else(|| "0".to_string());
        let mut cursor: usize = cursor_str.parse().unwrap_or(0);

        let total_subs = channel_ids.len();
        if cursor >= total_subs {
            cursor = 0;
        }

        let batch_size = 5;
        let mut batch_channels = Vec::new();
        for i in 0..batch_size {
            let idx = (cursor + i) % total_subs;
            let cid = &channel_ids[idx];
            if !batch_channels.contains(cid) {
                batch_channels.push(cid.clone());
            }
        }

        let mut futures = Vec::new();
        for cid in &batch_channels {
            futures.push(youtube_service.get_channel_tab(
                cid,
                Some("EgZ2aWRlb3PyBgQKAjoA".to_string()),
                None,
                None,
            ));
        }

        let results = futures_util::future::join_all(futures).await;
        let mut candidates = Vec::new();
        let mut seen_ids = HashSet::new();

        for res in results {
            if let Ok(resp) = res {
                for item in resp.items {
                    if let crate::models::channel::ChannelItem::Video(video) = item {
                        if seen_ids.insert(video.id.clone()) {
                            candidates.push(video);
                        }
                    }
                }
            }
        }

        if !candidates.is_empty() {
            let mut lcg_seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u32;
            for i in (1..candidates.len()).rev() {
                lcg_seed = lcg_seed.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fffffff;
                let j = (lcg_seed as usize) % (i + 1);
                candidates.swap(i, j);
            }
        }

        let next_cursor = (cursor + batch_channels.len()) % total_subs;
        crate::db::settings::set_setting(
            &self.pool,
            "homeSubsRotationCursor",
            &next_cursor.to_string(),
        )
        .await?;

        Ok(candidates)
    }

    pub async fn get_brain_snapshot(&self) -> AppResult<UserBrain> {
        Ok(self.brain_store.read().await.clone())
    }

    pub async fn get_recommendation_log(
        &self,
        limit: i64,
    ) -> AppResult<Vec<recommendations::RecommendationEvent>> {
        recommendations::get_recommendation_events(&self.pool, limit).await
    }

    pub async fn get_feed_quotas(&self) -> AppResult<FeedQuotas> {
        let brain = self.brain_store.read().await;
        Ok(Self::calculate_feed_quotas(
            brain.total_interactions,
            DISCOVER_FEED_TARGET_SIZE,
        ))
    }

    pub async fn unblock_topic(&self, topic: String) -> AppResult<()> {
        let mut brain = self.brain_store.write().await;
        let topic_lower = topic.trim().to_lowercase();
        brain
            .blocked_topics
            .retain(|t| t.to_lowercase() != topic_lower);
        Ok(())
    }

    pub async fn add_blocked_topic(&self, topic: String) -> AppResult<()> {
        let normalized = topic.trim().to_lowercase();
        if normalized.is_empty() {
            return Ok(());
        }
        let lemma = normalize_lemma(&normalized);
        let mut brain = self.brain_store.write().await;
        brain.blocked_topics.insert(normalized.clone());
        brain
            .preferred_topics
            .retain(|preferred| preferred.to_lowercase() != normalized);
        brain.global_vector.topics.retain(|key, _| {
            let key_lower = key.to_lowercase();
            !key_lower.contains(&lemma) && !key_lower.contains(&normalized)
        });
        for vector in brain.time_vectors.values_mut() {
            vector.topics.retain(|key, _| {
                let key_lower = key.to_lowercase();
                !key_lower.contains(&lemma) && !key_lower.contains(&normalized)
            });
        }
        Ok(())
    }

    pub async fn add_preferred_topic(&self, topic: String) -> AppResult<()> {
        let trimmed = topic.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let normalized = trimmed.to_lowercase();
        let mut brain = self.brain_store.write().await;
        brain
            .blocked_topics
            .retain(|blocked| blocked.to_lowercase() != normalized);
        brain.preferred_topics.insert(trimmed.to_string());
        for token in tokenize(trimmed) {
            let current = *brain.global_vector.topics.get(&token).unwrap_or(&0.0);
            brain
                .global_vector
                .topics
                .insert(token.clone(), current.max(0.5));
            brain
                .global_vector
                .topic_confidence
                .insert(token.clone(), 1.0);
            brain.global_vector.anchor_topics.insert(token);
        }
        brain.has_completed_onboarding = true;
        Ok(())
    }

    pub async fn remove_preferred_topic(&self, topic: String) -> AppResult<()> {
        let topic_lower = topic.trim().to_lowercase();
        if topic_lower.is_empty() {
            return Ok(());
        }
        let mut brain = self.brain_store.write().await;
        brain
            .preferred_topics
            .retain(|preferred| preferred.to_lowercase() != topic_lower);
        Ok(())
    }

    pub async fn unblock_channel(&self, channel_id: String) -> AppResult<()> {
        let channel_id = channel_id.trim().trim_start_matches("channel:").to_string();
        let mut brain = self.brain_store.write().await;
        brain.blocked_channels.remove(&channel_id);
        brain.channel_strikes.remove(&channel_id);
        brain.suppressed_channels.remove(&channel_id);
        Ok(())
    }

    /// Explicit user "don't show this channel": permanent block plus scrubbed channel memory so
    /// stale affinity cannot survive beside the block.
    pub async fn block_channel(&self, channel_id: String) -> AppResult<()> {
        let channel_id = channel_id.trim().trim_start_matches("channel:").to_string();
        if channel_id.trim().is_empty() {
            return Ok(());
        }
        let mut brain = self.brain_store.write().await;
        brain.blocked_channels.insert(channel_id.clone());
        brain.channel_scores.remove(&channel_id);
        brain.suppressed_channels.remove(&channel_id);
        brain.channel_strikes.remove(&channel_id);
        Ok(())
    }

    pub async fn reset_brain(&self) -> AppResult<()> {
        {
            let mut brain = self.brain_store.write().await;
            *brain = UserBrain::default();
        }
        recommendations::clear_recommendation_events(&self.pool).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enriches_broad_singleton_discovery_queries() {
        let brain = UserBrain::default();

        assert_eq!(
            RecommendationService::build_discovery_query("technology", &brain),
            "technology code"
        );
        assert_eq!(
            RecommendationService::build_discovery_query("science", &brain),
            "science physics"
        );
        assert_eq!(
            RecommendationService::build_discovery_query("day", &brain),
            "day"
        );
    }

    #[test]
    fn boosts_time_context_topics_without_global_weight() {
        let brain = UserBrain::default();
        let mut time_scores = HashMap::new();
        time_scores.insert("roblox".to_string(), 0.0);

        let topics = RecommendationService::analyze_mature_topics(&brain, &time_scores);
        let roblox = topics
            .iter()
            .find(|topic| topic.name == "roblox")
            .expect("time topic should be included");

        assert!(roblox.has_time_context);
        assert!(roblox.score >= TIME_CONTEXT_MIN_SCORE * TIME_CONTEXT_SELECTION_MULTIPLIER);
        assert!(RecommendationService::topic_is_discovery_eligible(
            roblox, false
        ));
    }

    #[test]
    fn rejects_viral_and_numeric_discovery_fragments() {
        assert!(!RecommendationService::is_substantial_topic("viral"));
        assert!(!RecommendationService::is_substantial_topic("3.1"));
        assert_eq!(
            RecommendationService::sanitize_discovery_query("3.1 pro"),
            None
        );
        assert_eq!(
            RecommendationService::sanitize_discovery_query("viral"),
            None
        );
    }

    #[test]
    fn bonds_anchor_topics_to_emerging_bigrams_for_young_profiles() {
        let mut brain = UserBrain::default();
        brain.total_interactions = 12;
        brain.global_vector.topics.insert("game".to_string(), 0.75);
        brain
            .global_vector
            .topic_confidence
            .insert("game".to_string(), 1.0);
        brain.global_vector.anchor_topics.insert("game".to_string());
        brain
            .global_vector
            .topics
            .insert("roblox_thief".to_string(), 0.08);
        brain
            .global_vector
            .topics
            .insert("leg_day".to_string(), 0.12);

        let queries = RecommendationService::build_query_bonding_candidates(&brain);
        let query_text: Vec<String> = queries.into_iter().map(|query| query.query).collect();

        assert!(query_text.contains(&"game leg_day".to_string()));
        assert!(query_text.contains(&"game roblox_thief".to_string()));
    }

    #[test]
    fn skips_query_bonding_after_cold_start_window() {
        let mut brain = UserBrain::default();
        brain.total_interactions = 50;
        brain.global_vector.topics.insert("game".to_string(), 0.75);
        brain.global_vector.anchor_topics.insert("game".to_string());
        brain
            .global_vector
            .topics
            .insert("roblox_thief".to_string(), 0.08);

        let queries = RecommendationService::build_query_bonding_candidates(&brain);

        assert!(queries.is_empty());
    }

    #[test]
    fn treats_imported_non_empty_brain_as_onboarded() {
        let mut brain = UserBrain::default();
        brain.has_completed_onboarding = false;
        brain.total_interactions = 0;
        brain.global_vector.topics.insert("game".to_string(), 0.75);

        assert!(RecommendationService::has_meaningful_brain_data(&brain));

        let empty_brain = UserBrain::default();
        assert!(!RecommendationService::has_meaningful_brain_data(
            &empty_brain
        ));
    }

    #[test]
    fn calculates_dynamic_cold_start_feed_quotas() {
        let quotas = RecommendationService::calculate_feed_quotas(15, 35);

        assert_eq!(quotas.maturity, "cold_start");
        assert_eq!(quotas.subscription_limit, 21);
        assert_eq!(quotas.discovery_limit, 12);
        assert_eq!(quotas.viral_limit, 2);
    }

    #[test]
    fn calculates_dynamic_maturing_feed_quotas() {
        let quotas = RecommendationService::calculate_feed_quotas(50, 35);

        assert_eq!(quotas.maturity, "maturing");
        assert_eq!(quotas.subscription_limit, 14);
        assert_eq!(quotas.discovery_limit, 18);
        assert_eq!(quotas.viral_limit, 3);
    }

    #[test]
    fn keeps_standard_mature_feed_shape() {
        let quotas = RecommendationService::calculate_feed_quotas(150, 35);

        assert_eq!(quotas.maturity, "mature");
        assert_eq!(quotas.subscription_limit, 16);
        assert_eq!(quotas.discovery_limit, 16);
        assert_eq!(quotas.viral_limit, 3);
        assert!(quotas.viral_limit < quotas.discovery_limit);
    }

    fn rotation_queries() -> Vec<String> {
        [
            "rust programming tutorial",
            "guitar fingerstyle lesson",
            "homemade pizza dough",
            "astronomy telescope basics",
            "woodworking dovetail joints",
            "marathon training plan",
        ]
        .iter()
        .map(|query| query.to_string())
        .collect()
    }

    fn token_set(text: &str) -> HashSet<String> {
        tokenize(text).into_iter().collect()
    }

    #[test]
    fn rotation_keeps_full_set_when_memory_is_empty() {
        let queries = rotation_queries();

        let (rotated, saturated) =
            RecommendationService::rotate_against_recent_queries(queries.clone(), &[]);

        assert_eq!(rotated, queries);
        assert!(!saturated);
    }

    #[test]
    fn rotation_filters_queries_overlapping_recent_window() {
        let queries = rotation_queries();
        let recent = vec![token_set("rust programming tutorial")];

        let (rotated, saturated) =
            RecommendationService::rotate_against_recent_queries(queries, &recent);

        assert!(!rotated.contains(&"rust programming tutorial".to_string()));
        assert_eq!(rotated.len(), 5);
        assert!(!saturated);
    }

    #[test]
    fn rotation_ignores_token_sets_beyond_recent_window() {
        let queries = rotation_queries();
        let mut recent: Vec<HashSet<String>> = (0..QUERY_ROTATION_RECENT_WINDOW)
            .map(|index| token_set(&format!("carpentry birdhouse plans variant{index}")))
            .collect();
        // Oldest set fully overlaps the first query but sits outside the comparison window.
        recent.push(token_set("rust programming tutorial"));

        let (rotated, _) =
            RecommendationService::rotate_against_recent_queries(queries, &recent);

        assert!(rotated.contains(&"rust programming tutorial".to_string()));
    }

    #[test]
    fn rotation_never_shrinks_pool_below_floor_and_reports_saturation() {
        let queries = rotation_queries();
        let recent: Vec<HashSet<String>> =
            queries.iter().map(|query| token_set(query)).collect();

        let (rotated, saturated) =
            RecommendationService::rotate_against_recent_queries(queries.clone(), &recent);

        assert_eq!(rotated.len(), QUERY_ROTATION_FLOOR);
        assert_eq!(rotated, queries[..QUERY_ROTATION_FLOOR].to_vec());
        assert!(saturated);
    }

    #[test]
    fn rotation_skips_small_pools_entirely() {
        let queries: Vec<String> = rotation_queries()
            .into_iter()
            .take(QUERY_ROTATION_FLOOR)
            .collect();
        let recent: Vec<HashSet<String>> =
            queries.iter().map(|query| token_set(query)).collect();

        let (rotated, saturated) =
            RecommendationService::rotate_against_recent_queries(queries.clone(), &recent);

        assert_eq!(rotated, queries);
        assert!(!saturated);
    }
}
