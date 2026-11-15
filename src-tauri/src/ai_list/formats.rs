//! The AiSList file formats (Flow-Tube/AIlist README, "Files"), read the way Flow for Android
//! reads them: unknown fields are ignored and a missing list side is empty.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

/// The two lists the app follows: AiSList channels and AI music artists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AiListKind {
    Channels,
    Music,
}

impl AiListKind {
    pub const ALL: [Self; 2] = [Self::Channels, Self::Music];

    /// The list id the app asks for; it is inside each signed payload, so one list cannot stand
    /// in for another.
    #[must_use]
    pub fn id(self) -> &'static str {
        match self {
            Self::Channels => "aislist",
            Self::Music => "aimusic",
        }
    }
}

/// The highest manifest schema this client understands.
pub const AI_LIST_SCHEMA: i64 = 1;

#[derive(Debug, Deserialize)]
pub struct EnvelopeJson {
    pub key_id: Option<String>,
    pub payload: Option<String>,
    pub sig: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub schema: i64,
    pub list: String,
    pub version: i64,
    pub snapshot: FileRef,
    #[serde(default)]
    pub deltas: Vec<DeltaRef>,
    #[serde(default)]
    pub max_delta_chain: i64,
}

#[derive(Debug, Deserialize)]
pub struct FileRef {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Deserialize)]
pub struct DeltaRef {
    pub to: i64,
    pub path: String,
    pub sha256: String,
}

/// One list side: normalized handles without `@`, and `UC…` channel ids.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entries {
    #[serde(default)]
    pub handles: Vec<String>,
    #[serde(default)]
    pub ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotFile {
    pub list: String,
    pub version: i64,
    #[serde(default)]
    pub block: Entries,
    #[serde(default)]
    pub warn: Entries,
}

#[derive(Debug, Default, Deserialize)]
pub struct Changes {
    #[serde(default)]
    pub add: Vec<String>,
    #[serde(default)]
    pub remove: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct DeltaSide {
    #[serde(default)]
    pub handles: Changes,
    #[serde(default)]
    pub ids: Changes,
}

#[derive(Debug, Deserialize)]
pub struct DeltaFile {
    pub list: String,
    pub from: i64,
    pub to: i64,
    #[serde(default)]
    pub block: DeltaSide,
    #[serde(default)]
    pub warn: DeltaSide,
}

/// What the computer keeps: the last good list, its manifest `ETag`, when it was taken and which
/// source it came from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAiList {
    pub version: i64,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub block: Entries,
    #[serde(default)]
    pub warn: Entries,
}

impl StoredAiList {
    /// Counts a channel once although the list publishes both its handle and its resolved id: the
    /// larger of the two per side.
    #[must_use]
    pub fn channel_count(&self) -> usize {
        self.block.handles.len().max(self.block.ids.len())
            + self.warn.handles.len().max(self.warn.ids.len())
    }

    /// The music list names artists by channel id only, and only to hide them.
    #[must_use]
    pub fn artist_count(&self) -> usize {
        self.block.ids.len()
    }

    /// Removes first, then adds, as the contract orders; applying a delta twice changes nothing.
    #[must_use]
    pub fn applying(mut self, delta: &DeltaFile) -> Self {
        self.version = delta.to;
        self.block = self.block.applying(&delta.block);
        self.warn = self.warn.applying(&delta.warn);
        self
    }
}

impl Entries {
    fn applying(self, side: &DeltaSide) -> Self {
        Self {
            handles: apply(self.handles, &side.handles),
            ids: apply(self.ids, &side.ids),
        }
    }
}

fn apply(list: Vec<String>, changes: &Changes) -> Vec<String> {
    if changes.add.is_empty() && changes.remove.is_empty() {
        return list;
    }
    let mut result: BTreeSet<String> = list.into_iter().collect();
    for removed in &changes.remove {
        result.remove(removed);
    }
    result.extend(changes.add.iter().cloned());
    result.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn a_snapshot_parses_with_unknown_fields_and_a_missing_side() {
        let snapshot: SnapshotFile = serde_json::from_str(
            r#"{"list":"aislist","version":4,"generated_at":"x","block":{"handles":["drew"]}}"#,
        )
        .unwrap();
        assert_eq!(snapshot.version, 4);
        assert_eq!(snapshot.block.handles, strings(&["drew"]));
        assert!(snapshot.block.ids.is_empty());
        assert_eq!(snapshot.warn, Entries::default());
    }

    #[test]
    fn a_manifest_without_its_required_fields_does_not_parse() {
        assert!(serde_json::from_str::<Manifest>(r#"{"schema":1,"list":"aislist"}"#).is_err());
    }

    #[test]
    fn a_delta_removes_before_it_adds_and_applies_twice_the_same() {
        let stored = StoredAiList {
            version: 2,
            block: Entries {
                handles: strings(&["a", "b"]),
                ids: Vec::new(),
            },
            ..StoredAiList::default()
        };
        let delta: DeltaFile = serde_json::from_str(
            r#"{"list":"aislist","from":2,"to":3,
                "block":{"handles":{"add":["c","b"],"remove":["b","a"]}},
                "warn":{"ids":{"add":["UCx"]}}}"#,
        )
        .unwrap();

        let once = stored.applying(&delta);
        assert_eq!(once.version, 3);
        assert_eq!(once.block.handles, strings(&["b", "c"]));
        assert_eq!(once.warn.ids, strings(&["UCx"]));
        assert_eq!(once.channel_count(), 3);
        assert_eq!(once.clone().applying(&delta), once);
    }

    #[test]
    fn a_channel_listed_by_handle_and_resolved_id_counts_once_and_an_id_only_list_counts_its_ids() {
        let channels = StoredAiList {
            version: 1,
            block: Entries {
                handles: strings(&["a", "b", "c"]),
                ids: strings(&["UC1", "UC2"]),
            },
            warn: Entries {
                handles: strings(&["d"]),
                ids: Vec::new(),
            },
            ..StoredAiList::default()
        };
        let music = StoredAiList {
            version: 1,
            block: Entries {
                handles: Vec::new(),
                ids: strings(&["UC1", "UC2"]),
            },
            ..StoredAiList::default()
        };
        assert_eq!(channels.channel_count(), 4);
        assert_eq!(music.channel_count(), 2);
        assert_eq!(music.artist_count(), 2);
    }

    #[test]
    fn the_stored_list_keeps_androids_field_names() {
        let stored = StoredAiList {
            version: 1,
            updated_at_ms: 5,
            ..StoredAiList::default()
        };
        let json = serde_json::to_string(&stored).unwrap();
        assert!(json.contains("\"updatedAtMs\":5"));
        assert_eq!(serde_json::from_str::<StoredAiList>(&json).unwrap(), stored);
    }
}
