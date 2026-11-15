//! The computer's one copy of each list, in `<app data>/ai_list/`: outside every profile folder and
//! every database, so no backup, sync or profile copy reads them, and the same for every profile.
//! A write goes to a side file and replaces the stored one only when complete, so a crash mid-write
//! keeps the previous list.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::formats::{AiListKind, StoredAiList};

pub const DIRECTORY: &str = "ai_list";
const LIST_FILE: &str = "list.json";
const MUSIC_FILE: &str = "music.json";
const INDEX_FILE: &str = "handle-index.json";
const SCHEDULE_FILE: &str = "schedule.json";

/// When the next daily check is due, kept so an app start does not move it.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub next_check_at_ms: i64,
}

/// Loads and commits one stored list; the updater only sees this.
pub trait AiListStorage {
    fn load(&self) -> Option<StoredAiList>;
    fn commit(&self, list: &StoredAiList) -> io::Result<()>;
}

#[derive(Debug, Clone)]
pub struct AiListStore {
    directory: PathBuf,
}

impl AiListStore {
    #[must_use]
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            directory: app_data_dir.join(DIRECTORY),
        }
    }

    /// One list's file.
    #[must_use]
    pub fn list(&self, kind: AiListKind) -> AiListFile {
        AiListFile {
            store: self.clone(),
            name: match kind {
                AiListKind::Channels => LIST_FILE,
                AiListKind::Music => MUSIC_FILE,
            },
        }
    }

    #[must_use]
    pub fn load_index(&self) -> Vec<(String, String)> {
        self.read(INDEX_FILE).unwrap_or_default()
    }

    pub fn save_index(&self, pairs: &[(String, String)]) -> io::Result<()> {
        self.write(INDEX_FILE, &pairs)
    }

    #[must_use]
    pub fn load_schedule(&self) -> Option<Schedule> {
        self.read(SCHEDULE_FILE)
    }

    pub fn save_schedule(&self, schedule: Schedule) -> io::Result<()> {
        self.write(SCHEDULE_FILE, &schedule)
    }

    fn read<T: for<'de> Deserialize<'de>>(&self, name: &str) -> Option<T> {
        let bytes = std::fs::read(self.directory.join(name)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn write<T: Serialize + ?Sized>(&self, name: &str, value: &T) -> io::Result<()> {
        std::fs::create_dir_all(&self.directory)?;
        let bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
        let target = self.directory.join(name);
        let side = self.directory.join(format!("{name}.new"));
        std::fs::write(&side, bytes)?;
        std::fs::rename(&side, &target).inspect_err(|_| {
            let _ = std::fs::remove_file(&side);
        })
    }
}

#[derive(Debug, Clone)]
pub struct AiListFile {
    store: AiListStore,
    name: &'static str,
}

impl AiListStorage for AiListFile {
    fn load(&self) -> Option<StoredAiList> {
        self.store.read(self.name)
    }

    fn commit(&self, list: &StoredAiList) -> io::Result<()> {
        self.store.write(self.name, list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_list::formats::Entries;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("flow-ai-list-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn a_committed_list_reads_back_and_a_broken_file_reads_as_none() {
        let dir = temp_dir();
        let store = AiListStore::new(&dir).list(AiListKind::Channels);
        assert_eq!(store.load(), None);

        let list = StoredAiList {
            version: 3,
            block: Entries {
                handles: vec!["drew".to_string()],
                ids: Vec::new(),
            },
            ..StoredAiList::default()
        };
        store.commit(&list).unwrap();
        assert_eq!(store.load(), Some(list));

        std::fs::write(dir.join(DIRECTORY).join(LIST_FILE), b"{").unwrap();
        assert_eq!(store.load(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn each_list_has_its_own_file() {
        let dir = temp_dir();
        let store = AiListStore::new(&dir);
        let music = StoredAiList {
            version: 2,
            ..StoredAiList::default()
        };
        store.list(AiListKind::Music).commit(&music).unwrap();
        assert_eq!(store.list(AiListKind::Music).load(), Some(music));
        assert_eq!(store.list(AiListKind::Channels).load(), None);
        assert!(dir.join(DIRECTORY).join(MUSIC_FILE).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_index_and_schedule_round_trip() {
        let dir = temp_dir();
        let store = AiListStore::new(&dir);
        assert!(store.load_index().is_empty());
        let pairs = vec![("UCa".to_string(), "one".to_string())];
        store.save_index(&pairs).unwrap();
        assert_eq!(store.load_index(), pairs);
        store
            .save_schedule(Schedule {
                next_check_at_ms: 42,
            })
            .unwrap();
        assert_eq!(store.load_schedule().map(|s| s.next_check_at_ms), Some(42));
        let _ = std::fs::remove_dir_all(dir);
    }
}
