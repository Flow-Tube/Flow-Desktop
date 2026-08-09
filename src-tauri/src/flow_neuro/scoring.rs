pub use crate::flow_neuro::tokenizer::{
    get_polysemous_words, get_priority_bigrams, is_generic_word, normalize_lemma, strip_domain_tag,
    tokenize, tokenize_unigrams, unigram_weight_multiplier,
};
use chrono::{Datelike, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

pub const SCHEMA_VERSION: i32 = 13;

// --- Scoring Constants ---
pub const SUBSCRIPTION_BOOST: f64 = 0.15;
pub const SERENDIPITY_BONUS: f64 = 0.10;
pub const CURIOSITY_GAP_BONUS: f64 = 0.10;

#[allow(dead_code)]
pub const CHANNEL_BOREDOM_MULTIPLIER: f64 = 0.5;
#[allow(dead_code)]
pub const CHANNEL_BOREDOM_THRESHOLD: f64 = 0.05;
pub const CHANNEL_EMA_ALPHA: f64 = 0.05;
pub const CHANNEL_EMA_DECAY: f64 = 1.0 - CHANNEL_EMA_ALPHA;
pub const MAX_CHANNEL_SCORES: usize = 500;
pub const CHANNEL_KEEP_LOW: usize = 50;
pub const CHANNEL_KEEP_HIGH: usize = 200;
pub const NOT_INTERESTED_CHANNEL_FLOOR: f64 = 0.20;
pub const CHANNEL_PROFILE_LEARNING_RATE: f64 = 0.10;
pub const CHANNEL_PROFILE_MAX_TOPICS: usize = 15;
pub const CHANNEL_PROFILE_PRUNE_THRESHOLD: f64 = 0.05;
pub const CHANNEL_PROFILE_MAX_CHANNELS: usize = 200;
pub const CHANNEL_PROFILE_BLEND_WEIGHT: f64 = 0.30;
pub const ANTI_REC_PENALTY_THRESHOLD: f64 = 0.6;
pub const ANTI_REC_PENALTY: f64 = 0.4;

pub const TOPIC_PRUNE_THRESHOLD: f64 = 0.03;
pub const ESTABLISHED_TOPIC_THRESHOLD: f64 = 0.30;
pub const DEVELOPING_TOPIC_THRESHOLD: f64 = 0.10;
pub const ESTABLISHED_DECAY_RATE: f64 = 0.998;
pub const DEVELOPING_DECAY_RATE: f64 = 0.993;
pub const EMERGING_DECAY_RATE: f64 = 0.97;

pub const MAX_CONSECUTIVE_SKIPS: i32 = 30;
pub const NOT_INTERESTED_SKIP_INCREMENT: i32 = 3;

pub const COLD_START_THRESHOLD: i32 = 30;
pub const ONBOARDING_WARMUP_INTERACTIONS: i32 = 50;
pub const ONBOARDING_MAX_BOOST: f64 = 0.15;
pub const ANCHOR_DECAY_START_INTERACTIONS: i32 = 30;
pub const ANCHOR_TOPIC_WATCH_DECAY: f64 = 0.95;

#[allow(dead_code)]
pub const ENGAGEMENT_RATE_BASELINE: f64 = 0.05;
#[allow(dead_code)]
pub const ENGAGEMENT_MAX_BOOST: f64 = 0.05;
#[allow(dead_code)]
pub const ENGAGEMENT_MIN_VIEWS: u64 = 1000;

#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_RATE: f64 = 0.01;
#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_MIN_VIEWS: u64 = 50_000;
#[allow(dead_code)]
pub const ENGAGEMENT_FLOOR_PENALTY: f64 = 0.2;

pub const BINGE_THRESHOLD: i32 = 20;
pub const BINGE_NOVELTY_FACTOR: f64 = 0.15;

pub const JITTER_COLD_START: f64 = 0.20;
pub const JITTER_NORMAL: f64 = 0.02;

pub const TITLE_SIMILARITY_STRICT: f64 = 0.55;
pub const TITLE_SIMILARITY_RELAXED: f64 = 0.60;

#[allow(dead_code)]
pub const FEATURE_CACHE_MAX: usize = 150;
pub const IDF_MIN_WEIGHT: f64 = 0.15;
// Hard cap on distinct IDF vocabulary (the one otherwise-unbounded brain structure); when
// exceeded, keep the highest-frequency (most informative) terms.
pub const IDF_MAX_KEYS: usize = 20_000;
pub const IDF_KEEP_KEYS: usize = 15_000;

pub const SESSION_TOPIC_HISTORY_MAX: usize = 50;

pub const SESSION_AFFINITY_STRONG_THRESHOLD: usize = 3;
pub const SESSION_AFFINITY_STRONG_BOOST: f64 = 0.08;
pub const SESSION_AFFINITY_MILD_THRESHOLD: usize = 2;
pub const SESSION_AFFINITY_MILD_BOOST: f64 = 0.04;

pub const AFFINITY_INCREMENT: f64 = 0.02;
pub const AFFINITY_MAX: f64 = 1.0;
pub const AFFINITY_PRUNE_THRESHOLD: f64 = 0.05;
pub const AFFINITY_MAX_ENTRIES: usize = 500;
pub const AFFINITY_KEEP_TOP: usize = 300;
pub const AFFINITY_MAX_BOOST_PER_VIDEO: f64 = 0.15;
pub const AFFINITY_BOOST_PER_PAIR: f64 = 0.05;

pub const TOPIC_SIMILARITY_WEIGHT: f64 = 0.70;
pub const DURATION_SIMILARITY_WEIGHT: f64 = 0.10;
pub const PACING_SIMILARITY_WEIGHT: f64 = 0.10;
pub const COMPLEXITY_SIMILARITY_WEIGHT: f64 = 0.10;
// When two vectors share no topic, similarity comes only from duration/pacing/complexity. Damp it
// hard so off-topic content cannot float above the relevance floor on scalar coincidence alone.
pub const SCALAR_ONLY_DAMP: f64 = 0.3;

pub const NEGATIVE_PROPORTIONAL_EXPONENT: f64 = 1.5;
pub const NEGATIVE_FLOOR_FACTOR: f64 = 0.3;
pub const NEGATIVE_SCALAR_PROPORTIONAL: f64 = 0.3;
pub const NEGATIVE_SCALAR_FLOOR: f64 = 0.1;
pub const COMPRESSION_THRESHOLD: f64 = 0.6;
pub const COMPRESSION_CEILING: f64 = 0.5;
pub const COMPRESSION_FACTOR: f64 = 0.7;

pub const CLASSIC_VIEW_THRESHOLD: u64 = 5_000_000;
pub const DIVERSITY_PHASE1_TARGET: usize = 20;

pub const COMPLEXITY_TITLE_LEN_MAX: f64 = 80.0;
pub const COMPLEXITY_TITLE_LEN_WEIGHT: f64 = 0.4;
pub const COMPLEXITY_WORD_LEN_DIVISOR: f64 = 8.0;
pub const COMPLEXITY_WORD_LEN_WEIGHT: f64 = 0.4;
pub const COMPLEXITY_CHAPTER_BONUS: f64 = 0.2;

pub const DESCRIPTION_MIN_LENGTH: usize = 20;
pub const DESCRIPTION_TAKE_CHARS: usize = 200;
pub const DESCRIPTION_TAKE_WORDS: usize = 15;
pub const DESCRIPTION_TAKE_LINES: usize = 5;
pub const DESCRIPTION_LINE_MIN_LENGTH: usize = 15;
pub const DESCRIPTION_WORD_WEIGHT: f64 = 0.2;

pub const CHANNEL_KEYWORD_WEIGHT: f64 = 1.0;
pub const TITLE_KEYWORD_WEIGHT: f64 = 0.5;
pub const BIGRAM_WEIGHT: f64 = 0.75;
pub const BIGRAM_PRIORITY_WEIGHT: f64 = 1.2;

pub const PERSONA_STABILITY_THRESHOLD: i32 = 3;
pub const PERSONA_MAX_STABILITY: i32 = 10;

// Impression fatigue
pub const IMPRESSION_CACHE_MAX: usize = 500;
pub const IMPRESSION_DECAY_RATE: f64 = 0.1;
pub const IMPRESSION_THRESHOLD_LIGHT: i32 = 1;
pub const IMPRESSION_THRESHOLD_HEAVY: i32 = 3;
pub const IMPRESSION_THRESHOLD_DROP: i32 = 5;

pub const IMPRESSION_PENALTY_LIGHT: f64 = 0.85;
pub const IMPRESSION_PENALTY_MEDIUM: f64 = 0.30;
pub const IMPRESSION_PENALTY_HEAVY: f64 = 0.05;

// Watched History already-watched penalties
pub const WATCH_HISTORY_MAX: usize = 2000;
pub const WATCHED_THRESHOLD_SAMPLED: f32 = 0.15;
pub const WATCHED_THRESHOLD_HALF: f32 = 0.50;
pub const WATCHED_THRESHOLD_FULL: f32 = 0.85;

pub const WATCHED_PENALTY_SAMPLED: f64 = 0.70;
pub const WATCHED_PENALTY_HALF: f64 = 0.30;
pub const WATCHED_PENALTY_FULL: f64 = 0.02;

pub const MUSIC_REWATCH_MAX_DURATION: u64 = 480;
pub const VIDEO_SUPPRESSION_DAYS: u64 = 30;
pub const CHANNEL_SUPPRESSION_DAYS: u64 = 14;
pub const MAX_SUPPRESSED_VIDEOS: usize = 500;
pub const MAX_SUPPRESSED_CHANNELS: usize = 100;

// Channel strike escalation: an inferred (reversible, expiring) block requires sustained,
// time-spread explicit dislikes — never two mis-taps in one session.
pub const CHANNEL_STRIKE_BLOCK_THRESHOLD: i32 = 3;
pub const CHANNEL_STRIKE_MIN_SPREAD_MS: u64 = 86_400_000;
pub const CHANNEL_INFERRED_BLOCK_DAYS: u64 = 60;
pub const MAX_CHANNEL_STRIKES: usize = 200;
pub const REJECTION_EXPIRY_DAYS: u64 = 14;
pub const REJECTION_MEMORY_MAX: usize = 200;
pub const REJECTION_PENALTY_1: f64 = 0.50;
pub const REJECTION_PENALTY_2: f64 = 0.20;
pub const REJECTION_PENALTY_3_PLUS: f64 = 0.05;
pub const FEED_HISTORY_MAX: usize = 3000;
pub const FEED_HISTORY_EXPIRY_DAYS: u64 = 14;
pub const IMPLICIT_DISINTEREST_WINDOW_HOURS: f64 = 48.0;
pub const IMPLICIT_DISINTEREST_THRESHOLD_HEAVY: i32 = 5;
pub const IMPLICIT_DISINTEREST_THRESHOLD_LIGHT: i32 = 3;
pub const IMPLICIT_DISINTEREST_PENALTY_HEAVY: f64 = 0.10;
pub const IMPLICIT_DISINTEREST_PENALTY_LIGHT: f64 = 0.30;
pub const RECENT_QUERY_TOKENS_MAX: usize = 20;
pub const QUERY_OVERLAP_THRESHOLD: f64 = 0.4;
// Rotation compares new discovery queries against only the most recent few persisted token
// sets, and never rotates the pool below a floor: comparing against the full history made
// rotation monotonic, so the persisted pool self-poisoned down to a repeating rump set and
// the Home feed's load-more starved permanently (issue #33).
pub const QUERY_ROTATION_RECENT_WINDOW: usize = 6;
pub const QUERY_ROTATION_FLOOR: usize = 5;
pub const RELEVANCE_FLOOR_MIN_INTERACTIONS: i32 = 80;
pub const RELEVANCE_FLOOR_SEVERE_THRESHOLD: f64 = 0.05;
pub const RELEVANCE_FLOOR_MODERATE_THRESHOLD: f64 = 0.10;
pub const RELEVANCE_FLOOR_SEVERE_PENALTY: f64 = 0.15;
pub const RELEVANCE_FLOOR_MODERATE_PENALTY: f64 = 0.40;
pub const TOPIC_EVIDENCE_MAX_ENTRIES: usize = 500;
pub const TOPIC_EVIDENCE_MAX_IDS: usize = 6;

// --- Data Structures ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ContentVector {
    pub topics: HashMap<String, f64>,
    pub topic_confidence: HashMap<String, f64>,
    pub anchor_topics: HashSet<String>,
    pub duration: f64,
    pub pacing: f64,
    pub complexity: f64,
    pub is_live: f64,
}

impl Default for ContentVector {
    fn default() -> Self {
        Self {
            topics: HashMap::new(),
            topic_confidence: HashMap::new(),
            anchor_topics: HashSet::new(),
            duration: 0.5,
            pacing: 0.5,
            complexity: 0.5,
            is_live: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeBucket {
    WeekdayMorning,
    WeekdayAfternoon,
    WeekdayEvening,
    WeekdayNight,
    WeekendMorning,
    WeekendAfternoon,
    WeekendEvening,
    WeekendNight,
}

impl TimeBucket {
    pub fn current() -> Self {
        let now = Local::now();
        let is_weekend = matches!(now.weekday(), Weekday::Sat | Weekday::Sun);
        Self::from_parts(now.hour(), is_weekend)
    }

    pub fn from_parts(hour: u32, is_weekend: bool) -> Self {
        if is_weekend {
            match hour {
                6..=11 => TimeBucket::WeekendMorning,
                12..=17 => TimeBucket::WeekendAfternoon,
                18..=23 => TimeBucket::WeekendEvening,
                _ => TimeBucket::WeekendNight,
            }
        } else {
            match hour {
                6..=11 => TimeBucket::WeekdayMorning,
                12..=17 => TimeBucket::WeekdayAfternoon,
                18..=23 => TimeBucket::WeekdayEvening,
                _ => TimeBucket::WeekdayNight,
            }
        }
    }

    pub fn values() -> Vec<Self> {
        vec![
            TimeBucket::WeekdayMorning,
            TimeBucket::WeekdayAfternoon,
            TimeBucket::WeekdayEvening,
            TimeBucket::WeekdayNight,
            TimeBucket::WeekendMorning,
            TimeBucket::WeekendAfternoon,
            TimeBucket::WeekendEvening,
            TimeBucket::WeekendNight,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UserBrain {
    pub time_vectors: HashMap<TimeBucket, ContentVector>,
    pub global_vector: ContentVector,
    pub channel_scores: HashMap<String, f64>,
    pub topic_affinities: HashMap<String, f64>,
    pub total_interactions: i32,
    pub consecutive_skips: i32,
    pub blocked_topics: HashSet<String>,
    pub blocked_channels: HashSet<String>,
    pub preferred_topics: HashSet<String>,
    pub has_completed_onboarding: bool,
    pub last_persona: Option<String>,
    pub persona_stability: i32,
    pub idf_word_frequency: HashMap<String, i32>,
    pub idf_total_documents: i32,
    pub watch_signal_progress: HashMap<String, f32>,
    pub watch_history_map: HashMap<String, f32>,
    pub channel_topic_profiles: HashMap<String, HashMap<String, f64>>,
    pub suppressed_video_ids: HashMap<String, u64>,
    pub suppressed_channels: HashMap<String, u64>,
    pub channel_strikes: HashMap<String, ChannelStrike>,
    pub rejection_patterns: HashMap<String, RejectionSignal>,
    pub feed_history: HashMap<String, FeedEntry>,
    pub recent_query_tokens: Vec<HashSet<String>>,
    pub topic_evidence: HashMap<String, TopicEvidence>,
    pub schema_version: i32,
}

impl Default for UserBrain {
    fn default() -> Self {
        let mut time_vectors = HashMap::new();
        for bucket in TimeBucket::values() {
            time_vectors.insert(bucket, ContentVector::default());
        }
        Self {
            time_vectors,
            global_vector: ContentVector::default(),
            channel_scores: HashMap::new(),
            topic_affinities: HashMap::new(),
            total_interactions: 0,
            consecutive_skips: 0,
            blocked_topics: HashSet::new(),
            blocked_channels: HashSet::new(),
            preferred_topics: HashSet::new(),
            has_completed_onboarding: false,
            last_persona: None,
            persona_stability: 0,
            idf_word_frequency: HashMap::new(),
            idf_total_documents: 0,
            watch_signal_progress: HashMap::new(),
            watch_history_map: HashMap::new(),
            channel_topic_profiles: HashMap::new(),
            suppressed_video_ids: HashMap::new(),
            suppressed_channels: HashMap::new(),
            channel_strikes: HashMap::new(),
            rejection_patterns: HashMap::new(),
            feed_history: HashMap::new(),
            recent_query_tokens: Vec::new(),
            topic_evidence: HashMap::new(),
            schema_version: SCHEMA_VERSION,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RejectionSignal {
    pub count: i32,
    pub last_rejected_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelStrike {
    pub count: i32,
    pub first_at: u64,
    pub last_at: u64,
}

/// A channel is inferred-blocked only when explicit dislikes are sustained, spread across
/// time, and recent — so accidental taps lapse instead of hiding a channel forever.
pub fn channel_inferred_blocked(strike: &ChannelStrike, now_ms: u64) -> bool {
    let recent = now_ms.saturating_sub(strike.last_at) < CHANNEL_INFERRED_BLOCK_DAYS * 86_400_000;
    let spread = strike.last_at.saturating_sub(strike.first_at) >= CHANNEL_STRIKE_MIN_SPREAD_MS;
    recent && spread && strike.count >= CHANNEL_STRIKE_BLOCK_THRESHOLD
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)] // tolerate brains written before `negative_signals` existed
pub struct TopicEvidence {
    pub positive_signals: i32,
    pub negative_signals: i32,
    pub watch_signals: i32,
    pub explicit_signals: i32,
    pub positive_score: f64,
    pub video_ids: HashSet<String>,
    pub channel_ids: HashSet<String>,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeedEntry {
    pub last_shown: u64,
    pub show_count: i32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicCategory {
    pub name: String,
    pub icon: String,
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FlowPersona {
    Initiate,
    Audiophile,
    Livewire,
    NightOwl,
    Binger,
    Scholar,
    DeepDiver,
    Skimmer,
    Specialist,
    Explorer,
}

impl FlowPersona {
    pub fn name(&self) -> &str {
        match self {
            Self::Initiate => "INITIATE",
            Self::Audiophile => "AUDIOPHILE",
            Self::Livewire => "LIVEWIRE",
            Self::NightOwl => "NIGHT_OWL",
            Self::Binger => "BINGER",
            Self::Scholar => "SCHOLAR",
            Self::DeepDiver => "DEEP_DIVER",
            Self::Skimmer => "SKIMMER",
            Self::Specialist => "SPECIALIST",
            Self::Explorer => "EXPLORER",
        }
    }

    pub fn title(&self) -> &str {
        match self {
            Self::Initiate => "The Initiate",
            Self::Audiophile => "The Audiophile",
            Self::Livewire => "The Livewire",
            Self::NightOwl => "The Night Owl",
            Self::Binger => "The Binger",
            Self::Scholar => "The Scholar",
            Self::DeepDiver => "The Deep Diver",
            Self::Skimmer => "The Skimmer",
            Self::Specialist => "The Specialist",
            Self::Explorer => "The Explorer",
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Self::Initiate => "Just getting started. Your profile is still forming.",
            Self::Audiophile => "You use Flow mostly for Music. The vibe is everything.",
            Self::Livewire => "You love the raw energy of Livestreams and premieres.",
            Self::NightOwl => "You thrive in the dark. Most watching happens after midnight.",
            Self::Binger => "Once you start, you can't stop. Massive content waves.",
            Self::Scholar => "High-complexity content. Here to grow, not just be entertained.",
            Self::DeepDiver => "Long-form video essays and documentaries are your world.",
            Self::Skimmer => "Fast-paced, short content. Dopamine on demand.",
            Self::Specialist => "Laser-focused on a few niches. You know what you like.",
            Self::Explorer => "Chaotic and beautiful. A bit of everything.",
        }
    }

    pub fn icon(&self) -> &str {
        match self {
            Self::Initiate => "🌱",
            Self::Audiophile => "🎧",
            Self::Livewire => "🔴",
            Self::NightOwl => "🦉",
            Self::Binger => "🍿",
            Self::Scholar => "🎓",
            Self::DeepDiver => "🤿",
            Self::Skimmer => "⚡",
            Self::Specialist => "🎯",
            Self::Explorer => "🧭",
        }
    }

    pub fn from_name(name: &str) -> Self {
        match name {
            "AUDIOPHILE" => Self::Audiophile,
            "LIVEWIRE" => Self::Livewire,
            "NIGHT_OWL" => Self::NightOwl,
            "BINGER" => Self::Binger,
            "SCHOLAR" => Self::Scholar,
            "DEEP_DIVER" => Self::DeepDiver,
            "SKIMMER" => Self::Skimmer,
            "SPECIALIST" => Self::Specialist,
            "EXPLORER" => Self::Explorer,
            _ => Self::Initiate,
        }
    }
}

// --- Tokenizer-adjacent scoring dictionaries ---

pub fn get_sponsor_line_patterns() -> &'static [&'static str] {
    &[
        "use code ",
        "% off",
        "free trial",
        "link in",
        "sponsored by",
        "brought to you",
        "check out",
        "sign up",
        "discount",
        "promo code",
        "coupon",
        "affiliate",
        "partner",
        "merch",
        "merchandise",
        "patreon",
        "ko-fi",
        "buymeacoffee",
        "buy me a coffee",
        "subscribe",
        "follow me",
        "social media",
        "instagram",
        "twitter",
        "tiktok",
        "discord",
        "join the",
        "become a member",
        "membership",
        "business inquiries",
        "business email",
        "contact:",
        "►",
        "→",
        "⬇",
        "⇩",
        "👇",
        "timestamps:",
        "chapters:",
    ]
}

pub fn get_high_pacing_words() -> &'static HashSet<&'static str> {
    static INSTANCE: OnceLock<HashSet<&'static str>> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        [
            "compilation",
            "tiktok",
            "tiktoks",
            "highlights",
            "speedrun",
            "trailer",
            "shorts",
            "montage",
            "moments",
            "best of",
            "try not to",
            "memes",
            "funny",
            "fails",
            "rapid",
            "fast",
            "quick",
            "minute",
            "seconds",
            "top 10",
            "top 5",
            "ranked",
            "tier list",
            "versus",
        ]
        .iter()
        .cloned()
        .collect()
    })
}

pub fn get_low_pacing_words() -> &'static HashSet<&'static str> {
    static INSTANCE: OnceLock<HashSet<&'static str>> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        [
            "podcast",
            "essay",
            "ambient",
            "explained",
            "study",
            "meditation",
            "sleep",
            "asmr",
            "relaxing",
            "calm",
            "deep dive",
            "analysis",
            "lecture",
            "course",
            "documentary",
            "interview",
            "conversation",
            "discussion",
            "breakdown",
            "walkthrough",
        ]
        .iter()
        .cloned()
        .collect()
    })
}

#[allow(dead_code)]
pub fn get_topic_categories() -> &'static Vec<TopicCategory> {
    static INSTANCE: OnceLock<Vec<TopicCategory>> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        vec![
            TopicCategory {
                name: "🎮 Gaming".to_string(),
                icon: "🎮".to_string(),
                keywords: vec![
                    "game".to_string(),
                    "gaming".to_string(),
                    "gameplay".to_string(),
                    "minecraft".to_string(),
                    "roblox".to_string(),
                    "ps5".to_string(),
                    "xbox".to_string(),
                    "nintendo".to_string(),
                    "steam".to_string(),
                    "zelda".to_string(),
                    "pokemon".to_string(),
                    "fortnite".to_string(),
                ],
            },
            TopicCategory {
                name: "🎵 Music".to_string(),
                icon: "🎵".to_string(),
                keywords: vec![
                    "music".to_string(),
                    "song".to_string(),
                    "lyrics".to_string(),
                    "official video".to_string(),
                    "official audio".to_string(),
                    "remix".to_string(),
                    "lofi".to_string(),
                    "playlist".to_string(),
                    "concert".to_string(),
                    "cover".to_string(),
                    "album".to_string(),
                    "acoustic".to_string(),
                ],
            },
            TopicCategory {
                name: "💻 Technology".to_string(),
                icon: "💻".to_string(),
                keywords: vec![
                    "tech".to_string(),
                    "technology".to_string(),
                    "code".to_string(),
                    "coding".to_string(),
                    "programming".to_string(),
                    "developer".to_string(),
                    "computer".to_string(),
                    "software".to_string(),
                    "iphone".to_string(),
                    "android".to_string(),
                    "ai".to_string(),
                    "artificial intelligence".to_string(),
                    "review".to_string(),
                    "gadget".to_string(),
                ],
            },
            TopicCategory {
                name: "📚 Education".to_string(),
                icon: "📚".to_string(),
                keywords: vec![
                    "learn".to_string(),
                    "study".to_string(),
                    "teach".to_string(),
                    "education".to_string(),
                    "history".to_string(),
                    "explained".to_string(),
                    "lesson".to_string(),
                    "course".to_string(),
                    "lecture".to_string(),
                    "math".to_string(),
                    "physics".to_string(),
                    "tutorial".to_string(),
                ],
            },
            TopicCategory {
                name: "🏋️ Health & Fitness".to_string(),
                icon: "🏋️".to_string(),
                keywords: vec![
                    "gym".to_string(),
                    "workout".to_string(),
                    "fitness".to_string(),
                    "exercise".to_string(),
                    "diet".to_string(),
                    "nutrition".to_string(),
                    "healthy".to_string(),
                    "muscle".to_string(),
                    "running".to_string(),
                    "cardio".to_string(),
                    "weight loss".to_string(),
                ],
            },
            TopicCategory {
                name: "🧪 Science".to_string(),
                icon: "🧪".to_string(),
                keywords: vec![
                    "science".to_string(),
                    "physics".to_string(),
                    "chemistry".to_string(),
                    "biology".to_string(),
                    "space".to_string(),
                    "astronomy".to_string(),
                    "rocket".to_string(),
                    "experiment".to_string(),
                    "research".to_string(),
                    "scientist".to_string(),
                    "engineering".to_string(),
                    "math".to_string(),
                ],
            },
            TopicCategory {
                name: "🎬 Film & Storytelling".to_string(),
                icon: "🎬".to_string(),
                keywords: vec![
                    "movie".to_string(),
                    "film".to_string(),
                    "cinema".to_string(),
                    "documentary".to_string(),
                    "screenplay".to_string(),
                    "story".to_string(),
                    "storytelling".to_string(),
                    "director".to_string(),
                    "editing".to_string(),
                    "camera".to_string(),
                    "photography".to_string(),
                    "animation".to_string(),
                ],
            },
            TopicCategory {
                name: "🏀 Sports".to_string(),
                icon: "🏀".to_string(),
                keywords: vec![
                    "sport".to_string(),
                    "football".to_string(),
                    "basketball".to_string(),
                    "soccer".to_string(),
                    "tennis".to_string(),
                    "formula 1".to_string(),
                    "racing".to_string(),
                    "mma".to_string(),
                    "boxing".to_string(),
                    "training".to_string(),
                    "highlights".to_string(),
                    "athlete".to_string(),
                ],
            },
            TopicCategory {
                name: "🛠️ DIY & Making".to_string(),
                icon: "🛠️".to_string(),
                keywords: vec![
                    "build".to_string(),
                    "maker".to_string(),
                    "diy".to_string(),
                    "woodworking".to_string(),
                    "3d printing".to_string(),
                    "electronics".to_string(),
                    "arduino".to_string(),
                    "raspberry pi".to_string(),
                    "craft".to_string(),
                    "project".to_string(),
                    "repair".to_string(),
                    "tool".to_string(),
                ],
            },
            TopicCategory {
                name: "💼 Business & Finance".to_string(),
                icon: "💼".to_string(),
                keywords: vec![
                    "business".to_string(),
                    "startup".to_string(),
                    "finance".to_string(),
                    "investing".to_string(),
                    "stocks".to_string(),
                    "economy".to_string(),
                    "marketing".to_string(),
                    "entrepreneur".to_string(),
                    "sales".to_string(),
                    "strategy".to_string(),
                    "productivity".to_string(),
                    "career".to_string(),
                ],
            },
            TopicCategory {
                name: "🌍 Travel & Culture".to_string(),
                icon: "🌍".to_string(),
                keywords: vec![
                    "travel".to_string(),
                    "culture".to_string(),
                    "city".to_string(),
                    "country".to_string(),
                    "food".to_string(),
                    "street food".to_string(),
                    "language".to_string(),
                    "documentary".to_string(),
                    "adventure".to_string(),
                    "vlog".to_string(),
                    "tour".to_string(),
                    "history".to_string(),
                ],
            },
        ]
    })
}

fn is_description_content_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.len() <= DESCRIPTION_LINE_MIN_LENGTH {
        return false;
    }

    let lower = trimmed.to_lowercase();
    if get_sponsor_line_patterns()
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return false;
    }
    if lower.contains("http") || trimmed.starts_with('#') {
        return false;
    }
    if trimmed.len() > 5 && trimmed == trimmed.to_uppercase() {
        return false;
    }

    true
}

fn extract_description_keywords(description: &str, idf: &IdfSnapshot) -> HashMap<String, f64> {
    if description.len() < DESCRIPTION_MIN_LENGTH {
        return HashMap::new();
    }

    let content_lines = description
        .lines()
        .filter(|line| is_description_content_line(line))
        .take(DESCRIPTION_TAKE_LINES)
        .collect::<Vec<&str>>()
        .join(" ");

    if content_lines.trim().is_empty() {
        return HashMap::new();
    }

    let mut result = HashMap::new();
    for word in tokenize(&content_lines)
        .into_iter()
        .take(DESCRIPTION_TAKE_WORDS)
    {
        let current_weight = *result.get(&word).unwrap_or(&0.0);
        let adjusted_weight = DESCRIPTION_WORD_WEIGHT * unigram_weight_multiplier(&word);
        result.insert(
            word.clone(),
            current_weight + calculate_idf_weight(&word, adjusted_weight, idf),
        );
    }
    result
}

pub fn extract_rejection_keys(video_vector: &ContentVector) -> Vec<String> {
    let broad_topics: HashSet<&str> = [
        "music",
        "game",
        "video",
        "sport",
        "food",
        "art",
        "tech",
        "science",
        "news",
        "show",
        "movie",
        "film",
        "learn",
        "education",
        "entertainment",
        "review",
        "react",
        "challenge",
        "build",
        "design",
        "travel",
    ]
    .iter()
    .copied()
    .collect();

    let mut top_topics: Vec<(String, f64)> = video_vector
        .topics
        .iter()
        .filter(|(topic, _)| strip_domain_tag(topic).len() >= 3)
        .map(|(topic, score)| (strip_domain_tag(topic), *score))
        .collect();
    top_topics.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top_topics: Vec<String> = top_topics
        .into_iter()
        .map(|(topic, _)| topic)
        .take(3)
        .collect();

    if top_topics.is_empty() {
        return Vec::new();
    }

    let mut keys = Vec::new();
    if let Some(primary) = top_topics
        .iter()
        .find(|topic| !broad_topics.contains(topic.as_str()))
    {
        keys.push(primary.clone());
    }
    if top_topics.len() >= 2 {
        let mut pair = [top_topics[0].clone(), top_topics[1].clone()];
        pair.sort();
        keys.push(format!("{}|{}", pair[0], pair[1]));
    }
    keys
}

pub fn calculate_rejection_pattern_penalty(
    video_vector: &ContentVector,
    rejection_patterns: &HashMap<String, RejectionSignal>,
    now_ms: u64,
) -> f64 {
    if rejection_patterns.is_empty() {
        return 1.0;
    }

    let expiry_ms = REJECTION_EXPIRY_DAYS * 86_400_000;
    let mut max_count = 0;
    for key in extract_rejection_keys(video_vector) {
        if let Some(signal) = rejection_patterns.get(&key) {
            if now_ms.saturating_sub(signal.last_rejected_at) < expiry_ms {
                max_count = max_count.max(signal.count);
            }
        }
    }

    match max_count {
        count if count >= 3 => REJECTION_PENALTY_3_PLUS,
        2 => REJECTION_PENALTY_2,
        1 => REJECTION_PENALTY_1,
        _ => 1.0,
    }
}

pub fn calculate_feed_history_penalty(
    video_id: &str,
    feed_history: &HashMap<String, FeedEntry>,
    now_ms: u64,
    candidate_pool_size: usize,
) -> f64 {
    let Some(entry) = feed_history.get(video_id) else {
        return 1.0;
    };

    let hours_since = now_ms.saturating_sub(entry.last_shown) as f64 / 3_600_000.0;
    let scarcity_relaxation = if candidate_pool_size < 10 {
        0.4
    } else if candidate_pool_size < 25 {
        0.7
    } else {
        1.0
    };
    let count_multiplier = if entry.show_count >= 5 {
        0.7
    } else if entry.show_count >= 3 {
        0.85
    } else {
        1.0
    };
    let base_penalty: f64 = if hours_since < 2.0 {
        0.05
    } else if hours_since < 8.0 {
        0.15
    } else if hours_since < 24.0 {
        0.35
    } else if hours_since < 72.0 {
        0.60
    } else if hours_since < 168.0 {
        0.80
    } else if hours_since < 336.0 {
        0.92
    } else {
        1.0
    } * count_multiplier;

    let base_penalty = base_penalty.clamp(0.0, 1.0);
    base_penalty + (1.0 - base_penalty) * (1.0 - scarcity_relaxation)
}

pub fn calculate_implicit_disinterest_penalty(
    video_id: &str,
    feed_history: &HashMap<String, FeedEntry>,
    watch_history: &HashMap<String, f32>,
    now_ms: u64,
) -> f64 {
    let Some(entry) = feed_history.get(video_id) else {
        return 1.0;
    };
    if watch_history.contains_key(video_id) {
        return 1.0;
    }

    let hours_since = now_ms.saturating_sub(entry.last_shown) as f64 / 3_600_000.0;
    if hours_since > IMPLICIT_DISINTEREST_WINDOW_HOURS {
        return 1.0;
    }

    if entry.show_count >= IMPLICIT_DISINTEREST_THRESHOLD_HEAVY {
        IMPLICIT_DISINTEREST_PENALTY_HEAVY
    } else if entry.show_count >= IMPLICIT_DISINTEREST_THRESHOLD_LIGHT {
        IMPLICIT_DISINTEREST_PENALTY_LIGHT
    } else {
        1.0
    }
}

pub fn calculate_relevance_floor(
    personality_score: f64,
    total_interactions: i32,
    is_subscription: bool,
) -> f64 {
    if is_subscription || total_interactions < RELEVANCE_FLOOR_MIN_INTERACTIONS {
        return 1.0;
    }

    if personality_score < RELEVANCE_FLOOR_SEVERE_THRESHOLD {
        RELEVANCE_FLOOR_SEVERE_PENALTY
    } else if personality_score < RELEVANCE_FLOOR_MODERATE_THRESHOLD {
        RELEVANCE_FLOOR_MODERATE_PENALTY
    } else {
        1.0
    }
}

// --- Time Decay Calculator ---

pub struct TimeDecay;

impl TimeDecay {
    pub fn calculate_multiplier(date_text: &str, is_live: bool) -> f64 {
        if is_live {
            return 1.15;
        }
        let text = date_text.to_lowercase();
        if text.contains("second") || text.contains("minute") || text.contains("hour") {
            1.15
        } else if text.contains("day") {
            1.12
        } else if text.contains("week") {
            1.08
        } else if text.contains("month") {
            let months: u32 = text
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(1);
            (1.0 / (1.0 + 0.08 * (months as f64))).max(0.75)
        } else if text.contains("year") {
            let years: u32 = text
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(1);
            1.0 / (1.0 + 0.35 * (years as f64))
        } else {
            0.85
        }
    }

    #[allow(dead_code)]
    pub fn is_older_than_24_hours(date_text: &str) -> bool {
        let text = date_text.to_lowercase();
        if text.contains("second") || text.contains("minute") || text.contains("hour") {
            false
        } else {
            true
        }
    }
}

// --- IDF Helpers ---

pub struct IdfSnapshot {
    pub word_frequencies: HashMap<String, i32>,
    pub total_documents: i32,
}

pub fn calculate_idf_weight(word: &str, base_weight: f64, idf: &IdfSnapshot) -> f64 {
    if idf.total_documents < 30 {
        return base_weight;
    }
    let freq = *idf.word_frequencies.get(word).unwrap_or(&0) as f64;
    if freq <= 0.0 {
        return base_weight * IDF_MIN_WEIGHT;
    }
    let idf_val = (1.0 + (idf.total_documents as f64 / freq).ln()).max(0.0);
    base_weight * idf_val.min(10.0)
}

// --- Feature Extraction ---

pub fn extract_features(
    title: &str,
    channel_name: &str,
    description: Option<&str>,
    duration: Option<u64>,
    is_live: bool,
    is_short: bool,
    idf: &IdfSnapshot,
) -> ContentVector {
    let mut topics = HashMap::new();

    let title_words = tokenize_unigrams(title);
    let ch_words = tokenize_unigrams(channel_name);

    for word in ch_words {
        let adjusted_weight = CHANNEL_KEYWORD_WEIGHT * unigram_weight_multiplier(&word);
        topics.insert(
            word.clone(),
            calculate_idf_weight(&word, adjusted_weight, idf),
        );
    }

    if title_words.len() >= 2 {
        for i in 0..title_words.len() - 1 {
            let bigram_phrase = format!("{} {}", title_words[i], title_words[i + 1]);
            let bigram = format!("{}_{}", title_words[i], title_words[i + 1]);
            let is_meaningful_bigram = get_priority_bigrams().contains(bigram_phrase.as_str())
                || get_polysemous_words().contains(title_words[i].as_str())
                || get_polysemous_words().contains(title_words[i + 1].as_str())
                || is_generic_word(title_words[i].as_str())
                || is_generic_word(title_words[i + 1].as_str());
            let bigram_weight = if is_meaningful_bigram {
                BIGRAM_WEIGHT * BIGRAM_PRIORITY_WEIGHT
            } else {
                BIGRAM_WEIGHT
            };
            topics.insert(
                bigram.clone(),
                calculate_idf_weight(&bigram, bigram_weight, idf),
            );
        }
    }

    for word in &title_words {
        let current_weight = *topics.get(word).unwrap_or(&0.0);
        let adjusted_weight = TITLE_KEYWORD_WEIGHT * unigram_weight_multiplier(word);
        topics.insert(
            word.clone(),
            current_weight + calculate_idf_weight(word, adjusted_weight, idf),
        );
    }

    if let Some(desc) = description {
        let limit_chars: String = desc.chars().take(DESCRIPTION_TAKE_CHARS).collect();
        for (word, weight) in extract_description_keywords(&limit_chars, idf) {
            let current_weight = *topics.get(&word).unwrap_or(&0.0);
            topics.insert(word.clone(), current_weight + weight);
        }
    }

    let normalized = if !topics.is_empty() {
        let mut magnitude = 0.0;
        for &v in topics.values() {
            magnitude += v * v;
        }
        let magnitude = magnitude.sqrt();
        if magnitude > 0.0 {
            topics
                .iter()
                .map(|(k, &v)| (k.clone(), v / magnitude))
                .collect()
        } else {
            topics
        }
    } else {
        topics
    };

    let duration_sec = match duration {
        Some(d) if d > 0 => d as f64,
        _ if is_live => 3600.0,
        _ => 300.0,
    };
    let duration_score = (1.0 + duration_sec).ln() / (7201.0_f64).ln();
    let duration_score = duration_score.clamp(0.0, 1.0);

    let title_lower = title.to_lowercase();
    let high_count = get_high_pacing_words()
        .iter()
        .filter(|&&w| title_lower.contains(w))
        .count() as f64;
    let low_count = get_low_pacing_words()
        .iter()
        .filter(|&&w| title_lower.contains(w))
        .count() as f64;

    let pacing_score = if high_count > low_count {
        (0.6 + high_count * 0.1).min(0.95)
    } else if low_count > high_count {
        (0.4 - low_count * 0.1).max(0.05)
    } else if is_short {
        0.85
    } else {
        0.5
    };

    // Chapter markers detection: count timestamps in description (e.g. 12:34 or 1:23)
    let mut has_chapters = false;
    if let Some(desc) = description {
        let mut timestamp_count = 0;
        let chars: Vec<char> = desc.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i].is_ascii_digit() {
                let mut digits_before = 0;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    digits_before += 1;
                    i += 1;
                }
                if digits_before >= 1 && digits_before <= 2 && i < chars.len() && chars[i] == ':' {
                    i += 1; // skip ':'
                    let mut digits_after = 0;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        digits_after += 1;
                        i += 1;
                    }
                    if digits_after == 2 {
                        timestamp_count += 1;
                    }
                }
            } else {
                i += 1;
            }
        }
        if timestamp_count >= 3 {
            has_chapters = true;
        }
    }

    let title_words_count = title_words.len();
    let avg_word_len = if title_words_count > 0 {
        title_words.iter().map(|w| w.len()).sum::<usize>() as f64 / title_words_count as f64
    } else {
        4.0
    };

    let title_len_factor =
        (title.len() as f64 / COMPLEXITY_TITLE_LEN_MAX).clamp(0.0, COMPLEXITY_TITLE_LEN_WEIGHT);
    let word_len_factor =
        (avg_word_len / COMPLEXITY_WORD_LEN_DIVISOR).clamp(0.0, COMPLEXITY_WORD_LEN_WEIGHT);
    let chapter_bonus = if has_chapters {
        COMPLEXITY_CHAPTER_BONUS
    } else {
        0.0
    };

    let complexity_score = (title_len_factor + word_len_factor + chapter_bonus).clamp(0.0, 1.0);

    ContentVector {
        topics: normalized,
        topic_confidence: HashMap::new(),
        anchor_topics: HashSet::new(),
        duration: duration_score,
        pacing: pacing_score,
        complexity: complexity_score,
        is_live: if is_live { 1.0 } else { 0.0 },
    }
}

// --- Cosine Similarity ---

pub fn calculate_cosine_similarity(user: &ContentVector, content: &ContentVector) -> f64 {
    let (small_map, large_map) = if user.topics.len() <= content.topics.len() {
        (&user.topics, &content.topics)
    } else {
        (&content.topics, &user.topics)
    };

    let duration_sim = 1.0 - (user.duration - content.duration).abs();
    let pacing_sim = 1.0 - (user.pacing - content.pacing).abs();
    let complexity_sim = 1.0 - (user.complexity - content.complexity).abs();

    let scalar_score = (duration_sim * DURATION_SIMILARITY_WEIGHT)
        + (pacing_sim * PACING_SIMILARITY_WEIGHT)
        + (complexity_sim * COMPLEXITY_SIMILARITY_WEIGHT);

    if small_map.is_empty() {
        return scalar_score * SCALAR_ONLY_DAMP;
    }

    // Build O(1) reverse-lookup maps for migration-compatibility matches
    let mut large_base_to_tagged: HashMap<String, (String, f64)> =
        HashMap::with_capacity(large_map.len());
    let mut large_untagged: HashMap<String, f64> = HashMap::with_capacity(large_map.len());
    for (k, &v) in large_map {
        if let Some(idx) = k.find(':') {
            let base = k[..idx].to_string();
            large_base_to_tagged
                .entry(base)
                .or_insert_with(|| (k.clone(), v));
        } else {
            large_untagged.insert(k.clone(), v);
        }
    }

    let mut dot_product = 0.0;
    let mut has_intersection = false;

    for (key, &small_val) in small_map {
        // Exact match
        if let Some(&large_val) = large_map.get(key) {
            dot_product += small_val * large_val;
            has_intersection = true;
            continue;
        }
        // Migration compatibility: untagged ↔ tagged partial match (0.3x weight)
        if !key.contains(':') {
            if let Some((_tagged_key, tagged_val)) = large_base_to_tagged.get(key) {
                dot_product += small_val * tagged_val * 0.3;
                has_intersection = true;
            }
        } else {
            let idx = key.find(':').unwrap();
            let base_word = &key[..idx];
            if let Some(&untagged_val) = large_untagged.get(base_word) {
                dot_product += small_val * untagged_val * 0.3;
                has_intersection = true;
            }
        }
    }

    if !has_intersection {
        return scalar_score * SCALAR_ONLY_DAMP;
    }

    let mut mag_a = 0.0;
    let mut mag_b = 0.0;
    for v in user.topics.values() {
        mag_a += v * v;
    }
    for v in content.topics.values() {
        mag_b += v * v;
    }

    let topic_sim = if mag_a > 0.0 && mag_b > 0.0 {
        dot_product / (mag_a.sqrt() * mag_b.sqrt())
    } else {
        0.0
    };

    (topic_sim * TOPIC_SIMILARITY_WEIGHT) + scalar_score
}

// --- Vector Adjustment ---

pub fn adjust_vector(
    current: &ContentVector,
    target: &ContentVector,
    base_rate: f64,
) -> ContentVector {
    let mut new_topics = current.topics.clone();
    let mut new_confidence = current.topic_confidence.clone();
    let is_negative = base_rate < 0.0;

    for (key, &target_val) in &target.topics {
        let current_val = *new_topics.get(key).unwrap_or(&0.0);
        let delta = if is_negative {
            let proportional =
                current_val * current_val.powf(NEGATIVE_PROPORTIONAL_EXPONENT) * base_rate;
            let absolute_floor = base_rate * NEGATIVE_FLOOR_FACTOR;
            proportional.min(absolute_floor)
        } else {
            let saturation_penalty = (1.0 - current_val).powi(2);
            let cold_topic_damping = 0.5 + 0.5 * (current_val / 0.20).min(1.0);
            let effective_rate = base_rate * saturation_penalty * cold_topic_damping;
            (target_val - current_val) * effective_rate
        };
        new_topics.insert(key.clone(), (current_val + delta).clamp(0.0, 1.0));
        new_confidence.entry(key.clone()).or_insert(0.5);
    }

    if base_rate > 0.0 {
        for (key, val) in new_topics.iter_mut() {
            if !target.topics.contains_key(key) {
                let tiered_decay = if *val >= ESTABLISHED_TOPIC_THRESHOLD {
                    ESTABLISHED_DECAY_RATE
                } else if *val >= DEVELOPING_TOPIC_THRESHOLD {
                    DEVELOPING_DECAY_RATE
                } else {
                    EMERGING_DECAY_RATE
                };
                *val *= tiered_decay;
            }
        }
    }

    new_topics.retain(|key, val| {
        let is_current_target = target.topics.contains_key(key);
        if !is_current_target && *val < TOPIC_PRUNE_THRESHOLD {
            new_confidence.remove(key);
            false
        } else {
            true
        }
    });

    if is_negative && !new_topics.is_empty() {
        let total_magnitude: f64 = new_topics.values().sum();
        let max_score = new_topics.values().cloned().fold(0.0, f64::max);

        if total_magnitude > 0.0 && max_score / total_magnitude > COMPRESSION_THRESHOLD {
            for val in new_topics.values_mut() {
                if *val > COMPRESSION_CEILING {
                    *val = COMPRESSION_CEILING + (*val - COMPRESSION_CEILING) * COMPRESSION_FACTOR;
                }
            }
        }
    }

    let update_scalar = |curr: f64, targ: f64| -> f64 {
        if is_negative {
            let proportional = curr * base_rate * NEGATIVE_SCALAR_PROPORTIONAL;
            let floor = base_rate * NEGATIVE_SCALAR_FLOOR;
            (curr + proportional.min(floor)).clamp(0.0, 1.0)
        } else {
            let saturation = (1.0 - curr).powi(2);
            (curr + (targ - curr) * base_rate * saturation).clamp(0.0, 1.0)
        }
    };

    ContentVector {
        topics: new_topics,
        topic_confidence: new_confidence,
        anchor_topics: current.anchor_topics.clone(),
        duration: update_scalar(current.duration, target.duration),
        pacing: update_scalar(current.pacing, target.pacing),
        complexity: update_scalar(current.complexity, target.complexity),
        is_live: update_scalar(current.is_live, target.is_live),
    }
}

pub fn apply_anchor_decay(vector: &mut ContentVector, total_interactions_after_watch: i32) {
    if total_interactions_after_watch <= ANCHOR_DECAY_START_INTERACTIONS {
        return;
    }

    let anchor_topics: Vec<String> = vector.anchor_topics.iter().cloned().collect();
    for topic in anchor_topics {
        let Some(value) = vector.topics.get_mut(&topic) else {
            vector.anchor_topics.remove(&topic);
            vector.topic_confidence.remove(&topic);
            continue;
        };

        *value *= ANCHOR_TOPIC_WATCH_DECAY;
        if *value < TOPIC_PRUNE_THRESHOLD {
            vector.topics.remove(&topic);
            vector.topic_confidence.remove(&topic);
            vector.anchor_topics.remove(&topic);
        }
    }
}

pub fn calculate_anti_recommendation_penalty(
    video_vector: &ContentVector,
    brain: &UserBrain,
) -> f64 {
    let negative_channels: Vec<&String> = brain
        .channel_scores
        .iter()
        .filter(|(_, score)| **score < NOT_INTERESTED_CHANNEL_FLOOR)
        .map(|(channel_id, _)| channel_id)
        .collect();

    if negative_channels.is_empty() {
        return 1.0;
    }

    let mut max_similarity = 0.0;
    for channel_id in negative_channels {
        if let Some(profile) = brain.channel_topic_profiles.get(channel_id) {
            let neg_vector = ContentVector {
                topics: profile.clone(),
                topic_confidence: HashMap::new(),
                anchor_topics: HashSet::new(),
                duration: 0.5,
                pacing: 0.5,
                complexity: 0.5,
                is_live: 0.0,
            };
            let similarity = calculate_cosine_similarity(&neg_vector, video_vector);
            if similarity > max_similarity {
                max_similarity = similarity;
            }
        }
    }

    if max_similarity > ANTI_REC_PENALTY_THRESHOLD {
        let penalty_strength = ((max_similarity - ANTI_REC_PENALTY_THRESHOLD)
            / (1.0 - ANTI_REC_PENALTY_THRESHOLD))
            .clamp(0.0, 1.0);
        1.0 - (penalty_strength * (1.0 - ANTI_REC_PENALTY))
    } else {
        1.0
    }
}

/// Additive boost when a candidate matches the learned topic profile of its channel.
pub fn calculate_channel_profile_boost(
    brain: &UserBrain,
    channel_id: &str,
    video_vector: &ContentVector,
) -> f64 {
    let Some(profile) = brain.channel_topic_profiles.get(channel_id) else {
        return 0.0;
    };
    if profile.len() < 3 {
        return 0.0;
    }

    let mut entries: Vec<(String, f64)> = profile.iter().map(|(k, v)| (k.clone(), *v)).collect();
    entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let profile_vector = ContentVector {
        topics: entries
            .into_iter()
            .take(CHANNEL_PROFILE_MAX_TOPICS)
            .collect(),
        ..ContentVector::default()
    };

    calculate_cosine_similarity(&profile_vector, video_vector) * CHANNEL_PROFILE_BLEND_WEIGHT
}

/// Multiplicative penalty that suppresses channels the user has scored below the disinterest floor.
pub fn calculate_channel_score_multiplier(brain: &UserBrain, channel_id: &str) -> f64 {
    let Some(score) = brain.channel_scores.get(channel_id) else {
        return 1.0;
    };
    if *score >= NOT_INTERESTED_CHANNEL_FLOOR {
        return 1.0;
    }
    let normalized = 1.0 / (1.0 + (-8.0 * (score - 0.35)).exp());
    0.05 + 0.95 * normalized
}

pub fn is_music_track(title: &str, channel: &str, duration_sec: Option<u64>) -> bool {
    if duration_sec.unwrap_or(0) > MUSIC_REWATCH_MAX_DURATION {
        return false;
    }
    let title_lower = title.to_lowercase();
    let channel_lower = channel.to_lowercase();
    [
        "music",
        "song",
        "lyrics",
        "remix",
        "lofi",
        "playlist",
        "official video",
        "official audio",
    ]
    .iter()
    .any(|kw| title_lower.contains(kw) || channel_lower.contains(kw))
}

// --- Smart Title Similarity ---

pub fn calculate_title_similarity(t1: &str, t2: &str) -> f64 {
    let w1: HashSet<String> = tokenize(t1).into_iter().collect();
    let w2: HashSet<String> = tokenize(t2).into_iter().collect();

    if w1.is_empty() || w2.is_empty() {
        return 0.0;
    }

    let intersection = w1.intersection(&w2).count() as f64;
    let union = w1.union(&w2).count() as f64;

    intersection / union
}

// --- Smart Diversity Reranking ---

pub struct ScoredVideo {
    pub id: String,
    pub title: String,
    pub channel_id: String,
    pub score: f64,
    pub vector: ContentVector,
}

pub fn apply_smart_diversity(mut candidates: Vec<ScoredVideo>) -> Vec<String> {
    if candidates.is_empty() {
        return Vec::new();
    }

    let mut final_playlist: Vec<(String, String, String)> = Vec::new();
    let mut channel_window = Vec::new();
    let mut topic_window = Vec::new();

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let unique_topics: Vec<String> = candidates
        .iter()
        .filter_map(|sv| {
            sv.vector
                .topics
                .iter()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(k, _)| k.clone())
        })
        .collect::<HashSet<String>>()
        .into_iter()
        .collect();

    let topic_diversity = unique_topics.len();

    let max_per_topic = if topic_diversity <= 4 { 2 } else { 3 };
    let exploration_slots = if topic_diversity <= 2 {
        6
    } else if topic_diversity <= 4 {
        4
    } else {
        2
    };

    let mut topic_sums = HashMap::new();
    for sv in &candidates {
        for (k, v) in &sv.vector.topics {
            *topic_sums.entry(k.clone()).or_insert(0.0) += v;
        }
    }
    let mut sorted_topic_sums: Vec<(String, f64)> = topic_sums.into_iter().collect();
    sorted_topic_sums.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let user_top_topics: HashSet<String> = sorted_topic_sums
        .iter()
        .take(3)
        .map(|t| t.0.clone())
        .collect();

    let top_score = candidates.first().map(|sv| sv.score).unwrap_or(0.0);

    let mut phase1_candidates = candidates;
    let mut deferred_high_quality = Vec::new();
    let mut exploration_count = 0;

    // Phase 1: Strict diversity
    let mut idx = 0;
    while idx < phase1_candidates.len() && final_playlist.len() < DIVERSITY_PHASE1_TARGET {
        let current = &phase1_candidates[idx];
        let primary_topic = current
            .vector
            .topics
            .iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| k.clone())
            .unwrap_or_default();

        let channel_count = channel_window
            .iter()
            .filter(|&&ref c| c == &current.channel_id)
            .count();
        let topic_count = topic_window
            .iter()
            .filter(|&&ref t| t == &primary_topic)
            .count();

        let is_title_similar =
            final_playlist
                .iter()
                .rev()
                .take(5)
                .any(|existing: &(String, String, String)| {
                    calculate_title_similarity(&current.title, &existing.1)
                        > TITLE_SIMILARITY_STRICT
                });

        let is_novel_topic = !primary_topic.is_empty() && !user_top_topics.contains(&primary_topic);
        let effective_topic_cap = if is_novel_topic && exploration_count < exploration_slots {
            max_per_topic + 1
        } else {
            max_per_topic
        };

        if channel_count == 0 && topic_count < effective_topic_cap && !is_title_similar {
            final_playlist.push((
                current.id.clone(),
                current.title.clone(),
                current.channel_id.clone(),
            ));
            channel_window.push(current.channel_id.clone());
            if !primary_topic.is_empty() {
                topic_window.push(primary_topic);
            }
            if is_novel_topic {
                exploration_count += 1;
            }
            phase1_candidates.remove(idx);
        } else if top_score > 0.0 && current.score > (top_score * 0.8) {
            deferred_high_quality.push(phase1_candidates.remove(idx));
        } else {
            idx += 1;
        }
    }

    // Phase 2: Deferred quality
    deferred_high_quality.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for scored in deferred_high_quality {
        let recent_channels: Vec<String> = final_playlist
            .iter()
            .rev()
            .take(7)
            .map(|t| t.2.clone())
            .collect();
        let channel_ok = recent_channels
            .iter()
            .filter(|c| *c == &scored.channel_id)
            .count()
            < 2;
        let title_ok = !final_playlist
            .iter()
            .rev()
            .take(5)
            .any(|t: &(String, String, String)| {
                calculate_title_similarity(&scored.title, &t.1) > TITLE_SIMILARITY_RELAXED
            });

        if channel_ok && title_ok {
            final_playlist.push((
                scored.id.clone(),
                scored.title.clone(),
                scored.channel_id.clone(),
            ));
        }
    }

    // Phase 3: Relaxed fill
    phase1_candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for scored in phase1_candidates {
        let recent_channels: Vec<String> = final_playlist
            .iter()
            .rev()
            .take(5)
            .map(|t| t.2.clone())
            .collect();
        let channel_spam = recent_channels
            .iter()
            .filter(|c| *c == &scored.channel_id)
            .count()
            >= 2;
        let title_similar =
            final_playlist
                .iter()
                .rev()
                .take(5)
                .any(|t: &(String, String, String)| {
                    calculate_title_similarity(&scored.title, &t.1) > TITLE_SIMILARITY_RELAXED
                });

        if !channel_spam && !title_similar {
            final_playlist.push((
                scored.id.clone(),
                scored.title.clone(),
                scored.channel_id.clone(),
            ));
        }
    }

    final_playlist.into_iter().map(|t| t.0).collect()
}

pub fn classify_persona(brain: &UserBrain) -> FlowPersona {
    if brain.total_interactions < 15 {
        return FlowPersona::Initiate;
    }

    let v = &brain.global_vector;

    let mut sorted_topics: Vec<f64> = v.topics.values().cloned().collect();
    sorted_topics.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

    let top_score = sorted_topics.first().cloned().unwrap_or(0.0);
    let diversity_index = if sorted_topics.len() >= 5 && top_score > 0.0 {
        sorted_topics[4] / top_score
    } else {
        0.0
    };

    let music_keywords = [
        "music",
        "song",
        "lyrics",
        "remix",
        "lofi",
        "playlist",
        "official audio",
    ];
    let mut music_score = 0.0;
    for (k, val) in &v.topics {
        if music_keywords.iter().any(|&kw| k.contains(kw)) || k.contains("feat") {
            music_score += val;
        }
    }

    let total_score: f64 = v.topics.values().sum();

    let mag = |cv: &ContentVector| -> f64 { cv.topics.values().sum() };

    let night_mag = mag(brain
        .time_vectors
        .get(&TimeBucket::WeekdayNight)
        .unwrap_or(&ContentVector::default()))
        + mag(brain
            .time_vectors
            .get(&TimeBucket::WeekendNight)
            .unwrap_or(&ContentVector::default()));
    let morning_mag = mag(brain
        .time_vectors
        .get(&TimeBucket::WeekdayMorning)
        .unwrap_or(&ContentVector::default()))
        + mag(brain
            .time_vectors
            .get(&TimeBucket::WeekendMorning)
            .unwrap_or(&ContentVector::default()));

    let is_nocturnal = night_mag > (morning_mag * 1.5) && night_mag > 5.0;

    let raw_persona = if total_score > 0.0 && music_score > (total_score * 0.4) {
        FlowPersona::Audiophile
    } else if v.is_live > 0.6 {
        FlowPersona::Livewire
    } else if is_nocturnal {
        FlowPersona::NightOwl
    } else if brain.total_interactions > 500 && v.pacing > 0.65 {
        FlowPersona::Binger
    } else if v.complexity > 0.75 {
        FlowPersona::Scholar
    } else if v.duration > 0.70 {
        FlowPersona::DeepDiver
    } else if v.duration < 0.35 && v.pacing > 0.60 {
        FlowPersona::Skimmer
    } else if diversity_index < 0.25 {
        FlowPersona::Specialist
    } else {
        FlowPersona::Explorer
    };

    if let Some(ref last_name) = brain.last_persona {
        let last_persona = FlowPersona::from_name(last_name);
        if raw_persona != last_persona && brain.persona_stability < PERSONA_STABILITY_THRESHOLD {
            last_persona
        } else {
            raw_persona
        }
    } else {
        raw_persona
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disjoint_topics_are_damped_below_relevance_floor() {
        let mut user = ContentVector::default();
        user.topics.insert("guitar".to_string(), 1.0);
        let mut content = ContentVector::default();
        content.topics.insert("welding".to_string(), 1.0);
        // Identical scalar features, zero topic overlap → must not clear the relevance floor.
        let sim = calculate_cosine_similarity(&user, &content);
        assert!(
            sim < RELEVANCE_FLOOR_MODERATE_THRESHOLD,
            "similarity was {sim}"
        );
    }

    #[test]
    fn shared_topic_outscores_disjoint_topic() {
        let mut user = ContentVector::default();
        user.topics.insert("guitar".to_string(), 1.0);
        let mut same = ContentVector::default();
        same.topics.insert("guitar".to_string(), 1.0);
        let mut diff = ContentVector::default();
        diff.topics.insert("welding".to_string(), 1.0);
        assert!(
            calculate_cosine_similarity(&user, &same) > calculate_cosine_similarity(&user, &diff)
        );
    }

    #[test]
    fn established_topic_decays_slower_than_emerging() {
        let mut current = ContentVector::default();
        current.topics.insert("established".to_string(), 0.5);
        current.topics.insert("emerging".to_string(), 0.05);
        let mut target = ContentVector::default();
        target.topics.insert("other".to_string(), 1.0);

        // Positive update that reinforces neither existing topic → both decay by their tier.
        let out = adjust_vector(&current, &target, 0.1);
        let established_ratio = out.topics["established"] / 0.5;
        let emerging_ratio = out.topics["emerging"] / 0.05;
        assert!(established_ratio > emerging_ratio);
    }

    #[test]
    fn diversity_caps_a_single_dominant_channel() {
        let mut candidates = Vec::new();
        for i in 0..6 {
            let mut vector = ContentVector::default();
            vector.topics.insert("guitar".to_string(), 1.0);
            candidates.push(ScoredVideo {
                id: format!("v{i}"),
                title: format!("Distinct title number {i}"),
                channel_id: "same".to_string(),
                score: 1.0 - i as f64 * 0.01,
                vector,
            });
        }
        let ordered = apply_smart_diversity(candidates);
        assert_eq!(ordered.first(), Some(&"v0".to_string()));
        assert!(
            ordered.len() < 6,
            "one channel should not fill the whole window"
        );
    }

    #[test]
    fn anchor_decay_waits_until_after_warmup_threshold() {
        let mut vector = ContentVector::default();
        vector.topics.insert("game".to_string(), 0.75);
        vector.topic_confidence.insert("game".to_string(), 1.0);
        vector.anchor_topics.insert("game".to_string());

        apply_anchor_decay(&mut vector, ANCHOR_DECAY_START_INTERACTIONS);

        assert_eq!(vector.topics.get("game").copied(), Some(0.75));
        assert!(vector.anchor_topics.contains("game"));
    }

    #[test]
    fn anchor_decay_reduces_anchor_weights_and_prunes_metadata() {
        let mut vector = ContentVector::default();
        vector.topics.insert("game".to_string(), 0.75);
        vector.topics.insert("roblox_thief".to_string(), 0.20);
        vector.topic_confidence.insert("game".to_string(), 1.0);
        vector.anchor_topics.insert("game".to_string());

        apply_anchor_decay(&mut vector, ANCHOR_DECAY_START_INTERACTIONS + 1);

        assert_eq!(
            vector.topics.get("game").copied(),
            Some(0.75 * ANCHOR_TOPIC_WATCH_DECAY)
        );
        assert_eq!(vector.topics.get("roblox_thief").copied(), Some(0.20));

        for _ in 0..80 {
            apply_anchor_decay(&mut vector, ANCHOR_DECAY_START_INTERACTIONS + 2);
        }

        assert!(!vector.topics.contains_key("game"));
        assert!(!vector.topic_confidence.contains_key("game"));
        assert!(!vector.anchor_topics.contains("game"));
        assert_eq!(vector.topics.get("roblox_thief").copied(), Some(0.20));
    }

    #[test]
    fn old_brain_json_without_topic_metadata_still_deserializes() {
        let raw = serde_json::json!({
            "global_vector": {
                "topics": { "game": 0.75 },
                "duration": 0.5,
                "pacing": 0.5,
                "complexity": 0.5,
                "is_live": 0.0
            },
            "total_interactions": 42,
            "has_completed_onboarding": true
        });

        let brain: UserBrain =
            serde_json::from_value(raw).expect("old brain schema should migrate");

        assert_eq!(brain.global_vector.topics.get("game").copied(), Some(0.75));
        assert!(brain.global_vector.topic_confidence.is_empty());
        assert!(brain.global_vector.anchor_topics.is_empty());
        assert!(brain.has_completed_onboarding);
    }
}
