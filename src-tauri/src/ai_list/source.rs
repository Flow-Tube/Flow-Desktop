//! Where the list comes from. The default is Flow's own mirror. A custom URL with no key must
//! serve files Flow's key signed (a plain mirror); a self-hosted pipeline signs with its own key,
//! which the viewer enters, and then only that key is trusted for it.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::envelope;

pub const DEFAULT_URL: &str = "https://ailist.flow-tube.org/";
const KEY_SIZE: usize = 32;
/// An Ed25519 `SubjectPublicKeyInfo`: this fixed prefix, then the raw key.
const SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiListSource {
    pub base_url: String,
    pub public_key: Option<Vec<u8>>,
}

/// A source as Settings stores it: no URL means Flow's own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSettings {
    pub url: Option<String>,
    pub key: Option<String>,
}

impl Default for AiListSource {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_URL.to_string(),
            public_key: None,
        }
    }
}

impl AiListSource {
    /// The source from stored settings; anything invalid falls back to the default.
    #[must_use]
    pub fn from_settings(url: Option<&str>, key: Option<&str>) -> Self {
        let Some(url) = url.filter(|url| !url.trim().is_empty()) else {
            return Self::default();
        };
        let Some(base_url) = normalize_url(url) else {
            return Self::default();
        };
        match key.filter(|key| !key.trim().is_empty()) {
            None => Self {
                base_url,
                public_key: None,
            },
            Some(key) => decode_key(key).map_or_else(Self::default, |public_key| Self {
                base_url,
                public_key: Some(public_key),
            }),
        }
    }

    /// Ties a stored list to the source and key it came from, so switching starts from a fresh
    /// snapshot.
    #[must_use]
    pub fn id(&self) -> String {
        let key = self.public_key.as_deref().map_or_else(
            || "builtin".to_string(),
            |key| hex::encode(Sha256::digest(key)),
        );
        format!("{}#{key}", self.base_url)
    }

    #[must_use]
    pub fn key_for(&self, key_id: &str) -> Option<Vec<u8>> {
        self.public_key
            .clone()
            .or_else(|| envelope::trusted_key(key_id))
    }
}

/// What Settings should store for a source the viewer typed, or `None` when the URL is not https
/// or the key is not an Ed25519 public key. A blank URL, or Flow's own with no key, stores nothing.
#[must_use]
pub fn settings_for(url: &str, key: &str) -> Option<SourceSettings> {
    if url.trim().is_empty() {
        return Some(SourceSettings {
            url: None,
            key: None,
        });
    }
    let normalized = normalize_url(url)?;
    let key = key.trim();
    if !key.is_empty() && decode_key(key).is_none() {
        return None;
    }
    if normalized == DEFAULT_URL && key.is_empty() {
        return Some(SourceSettings {
            url: None,
            key: None,
        });
    }
    Some(SourceSettings {
        url: Some(normalized),
        key: (!key.is_empty()).then(|| key.to_string()),
    })
}

/// An `https://` URL with a trailing slash, or `None` when `input` is not one.
#[must_use]
pub fn normalize_url(input: &str) -> Option<String> {
    let url = Url::parse(input.trim()).ok()?;
    if url.scheme() != "https" || url.host_str().is_none_or(str::is_empty) {
        return None;
    }
    if url.query().is_some() || url.fragment().is_some() {
        return None;
    }
    let text = url.to_string();
    Some(if text.ends_with('/') {
        text
    } else {
        format!("{text}/")
    })
}

/// An Ed25519 public key as the pipeline's `keys/<id>.pub.pem` holds it, or its raw 32 bytes in
/// base64.
#[must_use]
pub fn decode_key(input: &str) -> Option<Vec<u8>> {
    let body: String = input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("-----"))
        .collect();
    let bytes = STANDARD.decode(body).ok()?;
    if bytes.len() == KEY_SIZE {
        return Some(bytes);
    }
    (bytes.len() == SPKI_PREFIX.len() + KEY_SIZE && bytes.starts_with(&SPKI_PREFIX))
        .then(|| bytes[SPKI_PREFIX.len()..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    // keys/2026-11.pub.pem from Flow-Tube/AIlist, as a self-hoster would paste it.
    const PIPELINE_PEM: &str = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxak9y4JaDG+UjKfl7cDwiaJs+7FjrOM+urMW1YfSuc0=\n-----END PUBLIC KEY-----\n";

    fn key_of(byte: u8) -> String {
        STANDARD.encode([byte; 32])
    }

    #[test]
    fn the_pipelines_pem_key_and_the_raw_key_the_app_ships_are_the_same_key() {
        let from_pem = decode_key(PIPELINE_PEM);
        assert_eq!(from_pem, envelope::trusted_key("2026-11"));
        assert_eq!(
            decode_key("xak9y4JaDG+UjKfl7cDwiaJs+7FjrOM+urMW1YfSuc0="),
            from_pem
        );
    }

    #[test]
    fn anything_but_a_32_byte_ed25519_key_is_refused() {
        assert_eq!(decode_key(&STANDARD.encode([0u8; 31])), None);
        assert_eq!(decode_key("not base64!"), None);
    }

    #[test]
    fn only_https_urls_without_a_query_are_taken_and_they_end_with_a_slash() {
        assert_eq!(
            normalize_url(" https://lists.example.org/mirror ").as_deref(),
            Some("https://lists.example.org/mirror/")
        );
        assert_eq!(
            normalize_url("https://lists.example.org").as_deref(),
            Some("https://lists.example.org/")
        );
        assert_eq!(normalize_url("http://lists.example.org/"), None);
        assert_eq!(normalize_url("https://lists.example.org/?x=1"), None);
        assert_eq!(normalize_url("lists.example.org"), None);
    }

    #[test]
    fn nothing_set_or_an_invalid_setting_means_flows_own_mirror() {
        assert_eq!(
            AiListSource::from_settings(None, None),
            AiListSource::default()
        );
        assert_eq!(
            AiListSource::from_settings(Some("http://insecure.example/"), None),
            AiListSource::default()
        );
        assert_eq!(
            AiListSource::from_settings(Some("https://lists.example.org/"), Some("broken")),
            AiListSource::default()
        );
    }

    #[test]
    fn a_mirror_trusts_flows_key_and_a_source_with_its_own_key_only_that_key() {
        let mirror = AiListSource::from_settings(Some("https://mirror.example/"), None);
        let own = AiListSource::from_settings(Some("https://mirror.example/"), Some(&key_of(1)));
        assert_eq!(mirror.key_for("2026-11"), envelope::trusted_key("2026-11"));
        assert_eq!(mirror.key_for("unknown"), None);
        assert_eq!(own.key_for("anything"), Some(vec![1; 32]));
        assert_eq!(own.key_for("2026-11"), Some(vec![1; 32]));
    }

    #[test]
    fn the_same_server_with_another_key_is_another_source() {
        let a = AiListSource::from_settings(Some("https://lists.example.org/"), Some(&key_of(1)));
        let b = AiListSource::from_settings(Some("https://lists.example.org/"), Some(&key_of(2)));
        assert_ne!(a.id(), b.id());
        assert_eq!(
            AiListSource::from_settings(Some("https://lists.example.org"), None).id(),
            "https://lists.example.org/#builtin"
        );
    }

    #[test]
    fn saving_a_source_checks_it_and_flows_own_saves_as_nothing() {
        let nothing = SourceSettings {
            url: None,
            key: None,
        };
        assert_eq!(settings_for(" ", "ignored"), Some(nothing.clone()));
        assert_eq!(settings_for(DEFAULT_URL, ""), Some(nothing));
        assert_eq!(settings_for("http://x.example/", ""), None);
        assert_eq!(settings_for("https://x.example/", "broken"), None);
        assert_eq!(
            settings_for("https://x.example", &key_of(1)),
            Some(SourceSettings {
                url: Some("https://x.example/".to_string()),
                key: Some(key_of(1)),
            })
        );
    }
}
