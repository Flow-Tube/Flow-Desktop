//! `profiles_registry.json`: the device-level list of profiles. The JSON shape, field order and
//! defaults match Flow for Android's `ProfileRegistry.kt`, so both apps read each other's files.
//! Android treats a `null` or wrong-typed field as a corrupt file, so nothing here is ever
//! written as `null`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "profiles_registry.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAvatar {
    #[serde(default = "initial_kind")]
    pub kind: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub photo_version: i64,
}

fn initial_kind() -> String {
    "initial".into()
}

impl Default for ProfileAvatar {
    fn default() -> Self {
        Self {
            kind: initial_kind(),
            emoji: String::new(),
            photo_version: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color_key: String,
    #[serde(default)]
    pub avatar: ProfileAvatar,
    /// Unix epoch milliseconds.
    #[serde(default)]
    pub created_at: i64,
    /// Android only (its splash screen); kept so a round trip loses nothing.
    #[serde(default)]
    pub splash_tone: String,
}

impl Profile {
    pub fn new(id: String, now_ms: i64) -> Self {
        Self {
            id,
            name: String::new(),
            color_key: String::new(),
            avatar: ProfileAvatar::default(),
            created_at: now_ms,
            splash_tone: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryState {
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub default_id: Option<String>,
    #[serde(default)]
    pub active_id: Option<String>,
    /// Set together with `active_id` by a switch; cleared when the next process starts.
    #[serde(default)]
    pub post_switch: bool,
    /// Android TV only.
    #[serde(default = "yes")]
    pub ask_whos_watching: bool,
}

fn yes() -> bool {
    true
}

impl Default for RegistryState {
    fn default() -> Self {
        Self {
            profiles: Vec::new(),
            default_id: None,
            active_id: None,
            post_switch: false,
            ask_whos_watching: true,
        }
    }
}

/// Only ids like this are ever used to build a path.
pub fn is_safe_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl RegistryState {
    fn has(&self, id: Option<&str>) -> bool {
        id.is_some_and(|id| is_safe_id(id) && self.profiles.iter().any(|profile| profile.id == id))
    }

    /// Android's `completed()`: a missing Default is created first in the list, and a missing
    /// or unknown active profile falls back to Default.
    pub fn completed(mut self, now_ms: i64) -> Self {
        if !self.has(self.default_id.as_deref()) {
            let profile = Profile::new(new_id(), now_ms);
            self.default_id = Some(profile.id.clone());
            self.profiles.insert(0, profile);
        }
        if !self.has(self.active_id.as_deref()) {
            self.active_id = self.default_id.clone();
        }
        self
    }

    pub fn default_id(&self) -> &str {
        self.default_id.as_deref().unwrap_or_default()
    }

    pub fn active_id(&self) -> &str {
        self.active_id.as_deref().unwrap_or_default()
    }
}

pub fn encode(state: &RegistryState) -> String {
    serde_json::to_string(state).expect("registry state always serializes")
}

pub fn decode(raw: &str) -> Result<RegistryState, serde_json::Error> {
    if raw.trim().is_empty() {
        return Ok(RegistryState::default());
    }
    serde_json::from_str(raw)
}

/// Writes through a temporary file that is synced and then renamed over the old one, so a
/// reader never sees half a registry.
pub fn save(dir: &Path, state: &RegistryState) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let target = dir.join(FILE_NAME);
    let temp = dir.join(format!("{FILE_NAME}.tmp"));
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(encode(state).as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temp, &target)
}

pub enum Loaded {
    Read(RegistryState),
    Missing,
    /// The unreadable file was moved aside to this path.
    Corrupt(PathBuf),
}

pub fn read(dir: &Path) -> std::io::Result<Loaded> {
    let path = dir.join(FILE_NAME);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(error) => return Err(error),
    };
    if let Ok(state) = decode(&raw) {
        return Ok(Loaded::Read(state));
    }
    let aside = dir.join(format!("profiles_registry.corrupt-{}.json", now_ms()));
    fs::rename(&path, &aside)?;
    Ok(Loaded::Corrupt(aside))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_complete(state: &RegistryState) -> bool {
        state.has(state.default_id.as_deref()) && state.has(state.active_id.as_deref())
    }

    const ANDROID_SAMPLE: &str = r#"{"profiles":[{"id":"0b6f0d3c-2f1e-4b8a-9c5d-7e6f5a4b3c2d","name":"","colorKey":"","avatar":{"kind":"initial","emoji":"","photoVersion":0},"createdAt":1761650000000,"splashTone":"DARK"},{"id":"9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d","name":"Study","colorKey":"blue","avatar":{"kind":"emoji","emoji":"📚","photoVersion":0},"createdAt":1761650123456,"splashTone":""},{"id":"5c4d3e2f-1111-4aaa-8bbb-000000000002","name":"Gaming","colorKey":"purple","avatar":{"kind":"photo","emoji":"","photoVersion":1761650200000},"createdAt":1761650190000,"splashTone":"BLACK"}],"defaultId":"0b6f0d3c-2f1e-4b8a-9c5d-7e6f5a4b3c2d","activeId":"9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d","postSwitch":false,"askWhosWatching":true}"#;

    #[test]
    fn android_file_round_trips_byte_for_byte() {
        let state = decode(ANDROID_SAMPLE).unwrap();
        assert!(is_complete(&state));
        assert_eq!(state.profiles[1].avatar.emoji, "📚");
        assert_eq!(encode(&state), ANDROID_SAMPLE);
    }

    #[test]
    fn minimal_android_file_reads_with_defaults() {
        let state = decode(
            r#"{"profiles":[{"id":"d"},{"id":"study"}],"defaultId":"d","activeId":"study"}"#,
        )
        .unwrap();
        assert!(is_complete(&state));
        assert_eq!(state.profiles[1].avatar, ProfileAvatar::default());
        assert!(state.ask_whos_watching);
        assert!(!state.post_switch);
    }

    #[test]
    fn a_file_from_a_newer_version_still_reads() {
        let raw = r#"{"profiles":[{"id":"d","pin":"1234","avatar":{"kind":"hologram","frames":3}}],"defaultId":"d","activeId":"d","cloudLinked":true}"#;
        let state = decode(raw).unwrap();
        assert_eq!(state.profiles[0].avatar.kind, "hologram");
        assert!(!encode(&state).contains("cloudLinked"));
    }

    #[test]
    fn null_fields_are_corrupt_like_on_android() {
        assert!(
            decode(r#"{"profiles":[{"id":"d","name":null}],"defaultId":"d","activeId":"d"}"#)
                .is_err()
        );
    }

    #[test]
    fn first_run_creates_default_and_makes_it_active() {
        let state = RegistryState::default().completed(42);
        assert_eq!(state.profiles.len(), 1);
        assert_eq!(state.default_id(), state.profiles[0].id);
        assert_eq!(state.active_id(), state.default_id());
        assert!(is_safe_id(state.default_id()));
        assert_eq!(state.profiles[0].created_at, 42);
        assert!(!encode(&state).contains("null"));
    }

    #[test]
    fn unknown_active_profile_falls_back_to_default() {
        let state = decode(r#"{"profiles":[{"id":"d"}],"defaultId":"d","activeId":"gone"}"#)
            .unwrap()
            .completed(1);
        assert_eq!(state.active_id(), "d");
        assert_eq!(state.profiles.len(), 1);
    }

    #[test]
    fn unsafe_ids_are_rejected() {
        for id in ["", "../d", "a/b", "a b", "ü", &"x".repeat(65)] {
            assert!(!is_safe_id(id), "{id:?}");
        }
        assert!(is_safe_id("0b6f0d3c-2f1e-4b8a-9c5d-7e6f5a4b3c2d"));
        let state = decode(r#"{"profiles":[{"id":"../x"}],"defaultId":"../x","activeId":"../x"}"#)
            .unwrap()
            .completed(1);
        assert_ne!(state.default_id(), "../x");
    }

    #[test]
    fn save_and_read_round_trip_and_rescue_a_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("flow-registry-{}", new_id()));
        let state = RegistryState::default().completed(7);
        save(&dir, &state).unwrap();
        assert!(matches!(read(&dir).unwrap(), Loaded::Read(read_back) if read_back == state));
        assert!(!dir.join(format!("{FILE_NAME}.tmp")).exists());

        fs::write(dir.join(FILE_NAME), "{not json").unwrap();
        let Loaded::Corrupt(aside) = read(&dir).unwrap() else {
            panic!("expected corrupt")
        };
        assert_eq!(fs::read_to_string(aside).unwrap(), "{not json");
        assert!(matches!(read(&dir).unwrap(), Loaded::Missing));
        fs::remove_dir_all(dir).unwrap();
    }
}
