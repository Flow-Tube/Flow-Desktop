//! The engine's own word lists, read into keys by the brain's key spec, since a list written in
//! words never matches a stemmed key ("science" is keyed "scienc"). Built once per key spec.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::flow_neuro::keyspec::{KeySpec, tables::tables};

/// Words so broad that a title naming them says little about its subject.
const GENERIC_WORDS: [&str; 26] = [
    "day",
    "video",
    "new",
    "best",
    "top",
    "latest",
    "music",
    "song",
    "build",
    "make",
    "game",
    "science",
    "technology",
    "tech",
    "sport",
    "food",
    "news",
    "show",
    "thing",
    "stuff",
    "way",
    "part",
    "level",
    "review",
    "reaction",
    "guide",
];

/// Pairs that are an interest on their own from the first title (Android `compoundTerms`).
const COMPOUND_TERMS: [&str; 70] = [
    "train model",
    "train ai",
    "machine learn",
    "deep learn",
    "neural network",
    "train data",
    "fine tune",
    "train network",
    "train system",
    "build model",
    "build ai",
    "build network",
    "model train",
    "model ai",
    "model build",
    "react native",
    "react component",
    "react hook",
    "react app",
    "react tutorial",
    "react project",
    "build system",
    "build tool",
    "build project",
    "run test",
    "run code",
    "run server",
    "run script",
    "design pattern",
    "design system",
    "web design",
    "game design",
    "sound design",
    "power plant",
    "plant base",
    "plant based",
    "fire base",
    "fire wall",
    "fire fight",
    "spring boot",
    "spring framework",
    "spring board",
    "stream deck",
    "stream lab",
    "stream setup",
    "film make",
    "film edit",
    "film score",
    "scale model",
    "block chain",
    "block list",
    "host server",
    "host name",
    "web development",
    "web app",
    "web site",
    "net work",
    "net worth",
    "bass guitar",
    "bass boost",
    "bass drop",
    "drum track",
    "sound track",
    "race track",
    "lofi hip hop",
    "game laptop",
    "speed run",
    "play through",
    "build guide",
    "build order",
];

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

/// The lists above, keyed by one key spec.
pub struct KeyedLists {
    generic: HashSet<String>,
    known_phrases: HashSet<String>,
}

impl KeyedLists {
    fn build(spec: &KeySpec) -> Self {
        let known_phrases = COMPOUND_TERMS
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
        Self {
            generic: GENERIC_WORDS.iter().map(|word| spec.key_of(word)).collect(),
            known_phrases,
        }
    }

    /// Whether `key` is a single word too broad to describe a video by itself.
    #[must_use]
    pub fn is_generic(&self, key: &str) -> bool {
        !key.contains(' ') && self.generic.contains(key)
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
        assert!(lists.is_generic(&KeySpec::default().key_of("science")));
        assert!(lists.is_known_phrase("hip hop"));
        assert!(lists.is_known_phrase(&KeySpec::default().rekey("machine learn")[0]));
        assert!(!lists.is_known_phrase("review after"));
    }
}
