//! Which languages a brain reads titles in (Android `FlowNeuroEngine.withLanguageProfile`). The
//! profile starts at the system language and follows what the viewer watches; the key language is
//! the profile the brain started with and never moves, so a word keeps one key, and a synced peer
//! that stems for another language is a peer whose keys this brain cannot read.

use crate::flow_neuro::keyspec::{KeySpec, languages};
use crate::flow_neuro::scoring::UserBrain;

const FALLBACK_LANGUAGE: &str = "en";

/// The system language, normalized the way Android normalizes `Locale.getDefault().language`.
#[must_use]
pub fn system_language() -> String {
    let language = tauri_plugin_os::locale()
        .map(|locale| languages::normalize(&locale))
        .unwrap_or_default();
    if language.is_empty() {
        FALLBACK_LANGUAGE.to_string()
    } else {
        language
    }
}

impl UserBrain {
    /// Gives the brain a profile and key language the first time, from `default_language`.
    /// Returns whether anything changed.
    pub fn settle_languages(&mut self, default_language: &str) -> bool {
        let profile = self
            .language_profile
            .clone()
            .unwrap_or_else(|| languages::normalize(default_language));
        let key_language = self.key_language.clone().unwrap_or_else(|| profile.clone());
        let changed = self.language_profile.as_deref() != Some(profile.as_str())
            || self.key_language.as_deref() != Some(key_language.as_str());
        self.language_profile = Some(profile);
        self.key_language = Some(key_language);
        changed
    }

    /// How this brain reads text into keys.
    #[must_use]
    pub fn key_spec(&self) -> KeySpec {
        let profile = self
            .language_profile
            .as_deref()
            .unwrap_or(FALLBACK_LANGUAGE);
        KeySpec::new(profile, self.key_language.as_deref().unwrap_or(profile))
    }

    /// Counts a watched video's language toward the profile, which moves once one language holds
    /// most of a full window of votes.
    pub fn vote_language(&mut self, title: &str, description: Option<&str>) {
        let first_line = description
            .and_then(|text| text.lines().find(|line| !line.trim().is_empty()))
            .unwrap_or_default();
        let detected = languages::detect_text(&format!("{title}\n{first_line}"));
        let profile = self.key_spec().language_profile;
        let (next, votes) = languages::vote(&profile, &self.language_votes, detected);
        if next != profile {
            tracing::debug!(from = %profile, to = %next, "[FlowNeuro] language profile moved");
        }
        self.language_profile = Some(next);
        self.language_votes = votes;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_brain_takes_the_system_language_for_both() {
        let mut brain = UserBrain::default();
        assert!(brain.settle_languages("pt-BR"));
        assert_eq!(brain.key_spec(), KeySpec::new("pt", "pt"));
        assert!(!brain.settle_languages("de"));
    }

    #[test]
    fn the_key_language_stays_when_the_profile_moves() {
        let mut brain = UserBrain::default();
        brain.settle_languages("en");
        for _ in 0..languages::PROFILE_WINDOW {
            brain.vote_language("Обзор нового iPhone 17", None);
        }
        assert_eq!(brain.language_profile.as_deref(), Some("ru"));
        assert_eq!(brain.key_language.as_deref(), Some("en"));
        assert!(brain.language_votes.is_empty());
    }
}
