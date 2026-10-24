//! The language the site writes its text in (`hl`): titles stay as uploaded,
//! but dates, counts, labels and auto-translated titles follow it. Player
//! requests always use English, which every playability rule is written for.

use std::sync::RwLock;

/// The setting naming the content language; empty means English.
pub const CONTENT_LANGUAGE_SETTING: &str = "content_language";

static CONTENT_LANGUAGE: RwLock<String> = RwLock::new(String::new());

/// The host language the site accepts for a language tag, as Flow for Android
/// normalises it: the bare language, Brazilian and European Portuguese and the
/// three Chinese variants told apart, and English for anything unusable.
#[must_use]
pub fn normalize_host_language(tag: &str) -> String {
    let tag = tag.trim().replace('_', "-");
    let mut subtags = tag.split('-').filter(|part| !part.is_empty());
    let language = subtags.next().unwrap_or_default().to_ascii_lowercase();
    let rest: Vec<String> = subtags.map(str::to_ascii_lowercase).collect();
    let has = |value: &str| rest.iter().any(|part| part == value);
    if language.is_empty()
        || language == "und"
        || language == "system"
        || language == "kab"
        || !language.chars().all(|c| c.is_ascii_alphabetic())
    {
        return "en".to_string();
    }
    match language.as_str() {
        "pt" if has("br") => "pt-BR".to_string(),
        "zh" if has("hk") => "zh-HK".to_string(),
        "zh" if has("hant") || has("tw") || has("mo") => "zh-TW".to_string(),
        "zh" => "zh-CN".to_string(),
        _ => language,
    }
}

/// Set the content language from the saved setting; empty or missing is English.
pub fn set_content_language(setting: Option<&str>) {
    let language = setting
        .filter(|value| !value.trim().is_empty())
        .map_or_else(|| "en".to_string(), normalize_host_language);
    *CONTENT_LANGUAGE
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = language;
}

#[must_use]
pub fn content_language() -> String {
    let language = CONTENT_LANGUAGE
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if language.is_empty() {
        "en".to_string()
    } else {
        language
    }
}

/// Whether the site's text is English, which the English-only readers assume.
#[must_use]
pub fn is_english() -> bool {
    content_language() == "en"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_languages_follow_flow_for_android() {
        assert_eq!(normalize_host_language("system"), "en");
        assert_eq!(
            normalize_host_language("en-DE-u-fw-mon-ms-metric-mu-celsius"),
            "en"
        );
        assert_eq!(normalize_host_language("pt-BR"), "pt-BR");
        assert_eq!(normalize_host_language("pt-PT"), "pt");
        assert_eq!(normalize_host_language("zh-Hant-TW-u-nu-hanidec"), "zh-TW");
        assert_eq!(normalize_host_language("zh-Hant-HK"), "zh-HK");
        assert_eq!(normalize_host_language("zh"), "zh-CN");
        assert_eq!(normalize_host_language("kab"), "en");
        assert_eq!(normalize_host_language("und"), "en");
        assert_eq!(normalize_host_language("de_AT"), "de");
    }
}
