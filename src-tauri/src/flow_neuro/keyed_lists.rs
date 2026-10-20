//! The engine's own word lists, read into keys by the brain's key spec, since a list written in
//! words never matches a stemmed key ("science" is keyed "scienc"). Built once per key spec.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::flow_neuro::feature_tables::feature_tables;
use crate::flow_neuro::keyspec::{KeySpec, tables::tables};
use crate::flow_neuro::topic_catalog::onboarding_topics;

/// The onboarding catalog's topics of more than one word (Android `NeuroTopicCatalog`); one that
/// reads as a single chunk is a phrase from the first title.
const CATALOG_PHRASES: [&str; 49] = [
    "Call of Duty",
    "League of Legends",
    "PC Gaming",
    "Game Reviews",
    "Indie Games",
    "Retro Gaming",
    "Mobile Games",
    "Apex Legends",
    "Pop Music",
    "Hip Hop",
    "Indie Music",
    "Music Production",
    "Music Theory",
    "Album Reviews",
    "Web Development",
    "App Development",
    "Machine Learning",
    "PC Building",
    "Tech Reviews",
    "Cloud Computing",
    "TV Shows",
    "Star Wars",
    "Stand-up Comedy",
    "Film Analysis",
    "Movie Reviews",
    "Behind the Scenes",
    "Award Shows",
    "Fan Theories",
    "Language Learning",
    "Study Tips",
    "Weight Loss",
    "Healthy Eating",
    "Mental Health",
    "Self Improvement",
    "Daily Vlog",
    "Home Decor",
    "Interior Design",
    "Digital Art",
    "3D Modeling",
    "Graphic Design",
    "Video Editing",
    "Fashion Design",
    "Marine Life",
    "World News",
    "Tech News",
    "Sports News",
    "Entertainment News",
    "Business News",
    "Current Events",
];

/// Words that mean different things in different subjects, so a search needs context with them
/// (Android `NeuroTokenizer.polysemousWords`).
const POLYSEMOUS_WORDS: [&str; 51] = [
    "train", "model", "build", "plant", "stream", "react", "design", "film", "run", "play", "cook",
    "fire", "spring", "match", "cell", "power", "drive", "board", "frame", "scale", "lead",
    "light", "block", "drop", "track", "craft", "host", "mine", "pitch", "wave", "bass", "bow",
    "clip", "dart", "fan", "gear", "jam", "kit", "lab", "log", "net", "pad", "port", "rig", "set",
    "tap", "tip", "web", "metal", "rock", "bar",
];

/// Subjects too broad for one rejected video to say the viewer dislikes them.
const REJECTION_BROAD_TOPICS: [&str; 21] = [
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
];

/// What a music-led profile's keys hold.
const MUSIC_WORDS: [&str; 7] = [
    "music",
    "song",
    "lyrics",
    "remix",
    "lofi",
    "playlist",
    "official audio",
];

/// The lists above, keyed by one key spec.
pub struct KeyedLists {
    known_phrases: HashSet<String>,
    polysemous: HashSet<String>,
    broad_topics: HashSet<String>,
    catalog: HashSet<String>,
    music: Vec<String>,
}

impl KeyedLists {
    fn build(spec: &KeySpec) -> Self {
        let known_phrases = feature_tables()
            .compound_terms
            .iter()
            .flat_map(|term| spec.rekey(term))
            .chain(CATALOG_PHRASES.iter().filter_map(|topic| {
                let chunks = spec.chunk(topic).chunks;
                match chunks.as_slice() {
                    [only] if only.len() >= 2 => Some(only.join(" ")),
                    _ => None,
                }
            }))
            .chain(tables().expressions.values().cloned())
            .collect();
        let keyed = |words: &[&str]| -> HashSet<String> {
            words.iter().flat_map(|word| spec.keys_of(word)).collect()
        };
        Self {
            known_phrases,
            polysemous: keyed(&POLYSEMOUS_WORDS),
            broad_topics: keyed(&REJECTION_BROAD_TOPICS),
            catalog: onboarding_topics()
                .flat_map(|topic| spec.keys_of(topic))
                .collect(),
            // "feat" marks a song title's featured artist.
            music: keyed(&MUSIC_WORDS)
                .into_iter()
                .chain(std::iter::once("feat".to_string()))
                .collect(),
        }
    }

    #[must_use]
    pub fn is_polysemous(&self, key: &str) -> bool {
        self.polysemous.contains(key)
    }

    /// Whether a key is one the onboarding catalog offers, an interest by definition.
    #[must_use]
    pub fn is_catalog_key(&self, key: &str) -> bool {
        self.catalog.contains(key)
    }

    #[must_use]
    pub fn is_broad_topic(&self, key: &str) -> bool {
        self.broad_topics.contains(key)
    }

    /// Whether a key names music, by holding one of the music words.
    #[must_use]
    pub fn is_music(&self, key: &str) -> bool {
        self.music.iter().any(|word| key.contains(word.as_str()))
    }

    /// Whether a run is an interest without the viewer's own counts saying so.
    #[must_use]
    pub fn is_known_phrase(&self, run: &str) -> bool {
        self.known_phrases.contains(run)
    }
}

type Cached = Option<(KeySpec, Arc<KeyedLists>)>;

static CACHE: Mutex<Cached> = Mutex::new(None);

/// The lists for `spec`; one brain is resident, so one spec is cached.
#[must_use]
pub fn keyed_lists(spec: &KeySpec) -> Arc<KeyedLists> {
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((cached, lists)) = cache.as_ref()
        && cached == spec
    {
        return Arc::clone(lists);
    }
    let lists = Arc::new(KeyedLists::build(spec));
    *cache = Some((spec.clone(), Arc::clone(&lists)));
    lists
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_are_read_as_keys() {
        let lists = keyed_lists(&KeySpec::default());
        assert!(lists.is_known_phrase("hip hop"));
        assert!(lists.is_known_phrase(&KeySpec::default().rekey("machine learn")[0]));
        assert!(!lists.is_known_phrase("review after"));
        let spec = KeySpec::default();
        assert!(lists.is_broad_topic(&spec.key_of("entertainment")));
        assert!(lists.is_polysemous(&spec.key_of("models")));
        assert!(lists.is_music(&spec.key_of("lyrics")));
        assert!(!lists.is_music("guitar"));
    }
}
