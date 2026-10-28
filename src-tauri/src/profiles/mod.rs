//! Profiles: one install holds up to five, each with its own database, identity and web storage.
//! Exactly one profile is loaded per process; switching restarts the app.

pub mod registry;

use std::path::{Path, PathBuf};

use registry::{Loaded, RegistryState};

/// The profile this process runs as. Read once, before the app builds, and never changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveProfile {
    pub id: String,
    pub is_default: bool,
    /// True on the first start after a switch.
    pub after_switch: bool,
}

impl ActiveProfile {
    /// Used when the registry can't be read at all: Default's data never moves, so a start
    /// never fails because of the registry.
    pub fn fallback_default() -> Self {
        Self {
            id: String::new(),
            is_default: true,
            after_switch: false,
        }
    }

    /// Where this profile's files live. Default keeps today's paths at the app data root.
    pub fn root(&self, app_data_dir: &Path) -> PathBuf {
        if self.is_default {
            app_data_dir.to_path_buf()
        } else {
            app_data_dir.join("profiles").join(&self.id)
        }
    }
}

/// Tauri's `app_data_dir()` rule, available before the app is built.
pub fn app_data_dir(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(identifier))
}

/// Reads the registry, completing and repairing it, and clears `postSwitch`. Runs before
/// logging starts, so problems come back as a warning for setup to log.
pub fn load_for_process(app_data_dir: &Path) -> (ActiveProfile, Option<String>) {
    let (stored, mut warning) = match registry::read(app_data_dir) {
        Ok(Loaded::Read(state)) => (state, None),
        Ok(Loaded::Missing) => (RegistryState::default(), None),
        Ok(Loaded::Corrupt(aside)) => (
            RegistryState::default(),
            Some(format!(
                "unreadable profile registry moved to {}",
                aside.display()
            )),
        ),
        Err(error) => {
            let warning = format!("profile registry unreadable, running as Default: {error}");
            return (ActiveProfile::fallback_default(), Some(warning));
        }
    };
    let after_switch = stored.post_switch;
    let mut state = stored.clone().completed(registry::now_ms());
    state.post_switch = false;
    if state != stored
        && let Err(error) = registry::save(app_data_dir, &state)
    {
        warning = Some(format!("could not write the profile registry: {error}"));
    }
    let active = ActiveProfile {
        id: state.active_id().to_string(),
        is_default: state.active_id() == state.default_id(),
        after_switch,
    };
    (active, warning)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("flow-profiles-{}", registry::new_id()))
    }

    #[test]
    fn first_start_creates_the_registry_and_runs_as_default() {
        let dir = temp_dir();
        let (active, warning) = load_for_process(&dir);
        assert!(warning.is_none());
        assert!(active.is_default);
        assert!(!active.after_switch);
        assert_eq!(active.root(&dir), dir);
        let Loaded::Read(state) = registry::read(&dir).unwrap() else {
            panic!("registry written")
        };
        assert_eq!(state.default_id(), active.id);
        assert_eq!(load_for_process(&dir).0, active);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_switch_is_seen_once_and_cleared() {
        let dir = temp_dir();
        let mut state = RegistryState::default().completed(1);
        let other = registry::Profile::new("study".into(), 2);
        state.profiles.push(other);
        state.active_id = Some("study".into());
        state.post_switch = true;
        registry::save(&dir, &state).unwrap();

        let (active, _) = load_for_process(&dir);
        assert_eq!(active.id, "study");
        assert!(!active.is_default && active.after_switch);
        assert_eq!(active.root(&dir), dir.join("profiles").join("study"));
        assert!(!load_for_process(&dir).0.after_switch);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
