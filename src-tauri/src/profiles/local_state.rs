//! `profiles_local.json`: Desktop-only state about profiles, kept out of the registry so the
//! registry stays byte-compatible with Flow for Android.

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "profiles_local.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalState {
    /// Deleted profiles whose scrobbling keychain item couldn't be removed yet.
    pub keychain_deletes: Vec<String>,
}

pub fn read(dir: &Path) -> LocalState {
    fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Read, change and write back, through a synced temporary file.
pub fn update(dir: &Path, change: impl FnOnce(&mut LocalState)) {
    let mut state = read(dir);
    change(&mut state);
    let temp = dir.join(format!("{FILE_NAME}.tmp"));
    let written = fs::File::create(&temp)
        .and_then(|mut file| {
            file.write_all(serde_json::to_string(&state).unwrap_or_default().as_bytes())?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, dir.join(FILE_NAME)));
    if let Err(error) = written {
        tracing::warn!(%error, "could not write {FILE_NAME}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_round_trips_and_a_missing_file_is_empty() {
        let dir = std::env::temp_dir().join(format!("flow-local-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(read(&dir), LocalState::default());
        update(&dir, |state| state.keychain_deletes.push("a".into()));
        assert_eq!(read(&dir).keychain_deletes, ["a"]);
        fs::remove_dir_all(dir).unwrap();
    }
}
