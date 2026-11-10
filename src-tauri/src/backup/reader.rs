//! Reads any Flow backup file into the desktop's restore shape, whichever app wrote it: an Android
//! master zip, a desktop zip, or a JSON file from either. Every size is bounded before anything is
//! parsed, because a backup can come from anywhere.

use std::fs::File;
use std::io::{self, Read, Seek};
use std::path::Path;

use base64::Engine;
use serde_json::{Map, Value, json};
use zip::ZipArchive;

use crate::backup::android_brain::{
    is_android_music_brain, music_brain_from_android, user_brain_from_android,
};
use crate::backup::app_data::{DESKTOP_KEY, from_app_data, is_android_app_data};
use crate::backup::archive::{
    APP_DATA_ENTRY, AVATARS_DIR, ENGINE_ENTRY, MANIFEST_ENTRY, MUSIC_ENTRY, PROFILES_DIR,
    RECAP_ENTRY,
};
use crate::backup::import::{ImportKind, open_zip};
use crate::commands::backup::RECAP_STATS_ENTRY;
use crate::flow_neuro::scoring::UserBrain;
use crate::sync::brainmap::{musicbrain_to_snapshot, userbrain_to_snapshot};
use crate::sync::canonical::Hlc;

const MAX_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_AVATAR_BYTES: u64 = 16 * 1024 * 1024;
/// Far above a full ledger: 36 months of each kind, with every per-month list at its cap.
const MAX_RECAP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 50_000;
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
const BACKUP_DEVICE: &str = "android-backup";

/// Why a file can't be read, in a form the frontend can word.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error("the file is too large")]
    TooLarge,
    #[error("the archive has no Flow backup in it")]
    NoBackup,
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("the archive can't be read: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("the archive can't be opened")]
    Unopenable,
}

impl From<crate::backup::import::ImportError> for ReadError {
    fn from(error: crate::backup::import::ImportError) -> Self {
        match error {
            crate::backup::import::ImportError::TooLarge => Self::TooLarge,
            _ => Self::Unopenable,
        }
    }
}

/// What a picked file turned out to be.
pub enum BackupFile {
    /// The desktop's backup shape, ready for the normal restore.
    Backup(Value),
    /// Not a Flow backup: another app's export, left to the format parsers.
    Text(String),
    /// Another app's backup, for its importer.
    External(ImportKind),
}

/// Reads one zip entry, refusing more than `limit` however large its header says it is.
fn read_limited<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    limit: u64,
    budget: &mut u64,
) -> Result<Option<Vec<u8>>, ReadError> {
    let entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let allowed = limit.min(*budget);
    let mut bytes = Vec::new();
    entry.take(allowed + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > allowed {
        return Err(ReadError::TooLarge);
    }
    *budget -= bytes.len() as u64;
    Ok(Some(bytes))
}

fn read_json<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    budget: &mut u64,
) -> Result<Option<Value>, ReadError> {
    let Some(bytes) = read_limited(archive, name, MAX_ENTRY_BYTES, budget)? else {
        return Ok(None);
    };
    Ok(serde_json::from_slice(&bytes).ok())
}

/// A slice's ledger, on top of any an older file kept among its collections. One that can't be
/// parsed is left out, which keeps the device's own.
fn read_recap<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    prefix: &str,
    collections: &mut Map<String, Value>,
    budget: &mut u64,
) -> Result<(), ReadError> {
    let name = format!("{prefix}{RECAP_ENTRY}");
    let bytes = read_limited(archive, &name, MAX_RECAP_BYTES, budget)?;
    if let Some(ledger) = bytes.and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) {
        collections.insert(RECAP_STATS_ENTRY.to_string(), json!([ledger]));
    }
    Ok(())
}

fn brain_record(brain: &UserBrain, now_ms: u64) -> Option<Value> {
    serde_json::to_value(userbrain_to_snapshot(
        brain,
        BACKUP_DEVICE,
        Hlc::new(now_ms, 0, BACKUP_DEVICE),
    ))
    .ok()
}

fn has_signals(brain: &UserBrain) -> bool {
    brain.total_interactions > 0
        || !brain.preferred_topics.is_empty()
        || !brain.global_vector.topics.is_empty()
        || !brain.channel_scores.is_empty()
        || !brain.topic_evidence.is_empty()
}

fn engine_collection(engine: &Value, now_ms: u64) -> Option<Value> {
    let mut brain = user_brain_from_android(engine);
    brain.has_completed_onboarding |= has_signals(&brain);
    brain_record(&brain, now_ms)
}

/// A backup without an engine file still carries what the viewer chose to block or prefer.
fn preferences_collection(preferences: &Value, now_ms: u64) -> Option<Value> {
    let set = |key: &str| -> std::collections::HashSet<String> {
        preferences
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    let brain = UserBrain {
        preferred_topics: set("preferredTopics"),
        blocked_topics: set("blockedTopics"),
        blocked_channels: set("blockedChannels"),
        ..UserBrain::default()
    };
    (!brain.preferred_topics.is_empty()
        || !brain.blocked_topics.is_empty()
        || !brain.blocked_channels.is_empty())
    .then(|| brain_record(&brain, now_ms))
    .flatten()
}

fn music_collection(music: &Value, now_ms: u64) -> Option<Value> {
    serde_json::to_value(musicbrain_to_snapshot(
        &music_brain_from_android(music),
        BACKUP_DEVICE,
        Hlc::new(now_ms, 0, BACKUP_DEVICE),
    ))
    .ok()
}

/// One profile in the desktop's shape. A file the desktop wrote has its lossless export inside;
/// one Android wrote is converted, with its brains going through the normal CRDT restore.
fn slice_to_desktop(
    app_data: Option<&Value>,
    engine: Option<&Value>,
    music: Option<&Value>,
    now_ms: u64,
) -> (Map<String, Value>, Map<String, Value>) {
    if let Some(desktop) = app_data.and_then(|data| data.get(DESKTOP_KEY)) {
        let part = |key: &str| {
            desktop
                .get(key)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default()
        };
        return (part("settings"), part("collections"));
    }
    let (settings, mut collections) = app_data.map_or_else(Default::default, |data| {
        let slice = from_app_data(data, now_ms);
        (slice.settings, slice.collections)
    });
    let brain = engine
        .and_then(|engine| engine_collection(engine, now_ms))
        .or_else(|| {
            app_data
                .and_then(|data| data.get("contentPreferences"))
                .and_then(|preferences| preferences_collection(preferences, now_ms))
        });
    if let Some(brain) = brain {
        collections.insert("flow_neuro_brain".into(), json!([brain]));
    }
    if let Some(music) = music.and_then(|music| music_collection(music, now_ms)) {
        collections.insert("music_brain".into(), json!([music]));
    }
    (settings, collections)
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Which other app's backup an archive is, by the files only that app writes. Takeout comes first:
/// it can be far larger than anything else, and needs none of its contents read to know.
fn other_apps_archive(names: &[String]) -> Option<ImportKind> {
    let is = |wanted: &str| {
        names
            .iter()
            .any(|name| name == wanted || name.ends_with(&format!("/{wanted}")))
    };
    if names.iter().any(|name| name.starts_with("Takeout/")) {
        return Some(ImportKind::Takeout);
    }
    if is(APP_DATA_ENTRY) {
        return None;
    }
    if is("newpipe.db") {
        return Some(ImportKind::NewpipeBackup);
    }
    is("song.db").then_some(ImportKind::Metrolist)
}

fn read_archive<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    now_ms: u64,
) -> Result<BackupFile, ReadError> {
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();
    if archive.len() > MAX_ENTRIES {
        return Err(ReadError::TooLarge);
    }
    let mut budget = MAX_TOTAL_BYTES;
    let app_data = read_json(archive, APP_DATA_ENTRY, &mut budget)?;
    let engine = read_json(archive, ENGINE_ENTRY, &mut budget)?;
    let music = read_json(archive, MUSIC_ENTRY, &mut budget)?;
    if app_data.is_none() && engine.is_none() && music.is_none() {
        // A zipped export of a single JSON file, as older Flow builds made.
        let name = names
            .iter()
            .find(|name| !name.contains('/') && name.to_ascii_lowercase().ends_with(".json"))
            .ok_or(ReadError::NoBackup)?
            .clone();
        let bytes = read_limited(archive, &name, MAX_ENTRY_BYTES, &mut budget)?
            .ok_or(ReadError::NoBackup)?;
        return Ok(read_text(&bytes, now_ms));
    }

    let (settings, mut collections) =
        slice_to_desktop(app_data.as_ref(), engine.as_ref(), music.as_ref(), now_ms);
    read_recap(archive, "", &mut collections, &mut budget)?;
    let mut backup = json!({
        "schemaVersion": 2,
        "scope": "MASTER",
        "settings": settings,
        "collections": collections,
    });

    let manifest = read_json(archive, MANIFEST_ENTRY, &mut budget)?
        .filter(|manifest| manifest.get("format").and_then(Value::as_str) == Some("flow-master"));
    let Some(manifest) = manifest else {
        return Ok(BackupFile::Backup(backup));
    };

    let default_id = manifest
        .get("defaultId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let included: Vec<String> = manifest
        .get("included")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|id| is_safe_id(id) && *id != default_id)
        .map(str::to_string)
        .collect();
    let mut profiles = Map::new();
    for id in &included {
        let prefix = format!("{PROFILES_DIR}{id}/");
        let app = read_json(archive, &format!("{prefix}{APP_DATA_ENTRY}"), &mut budget)?;
        let engine = read_json(archive, &format!("{prefix}{ENGINE_ENTRY}"), &mut budget)?;
        let music = read_json(archive, &format!("{prefix}{MUSIC_ENTRY}"), &mut budget)?;
        let (settings, mut collections) =
            slice_to_desktop(app.as_ref(), engine.as_ref(), music.as_ref(), now_ms);
        read_recap(archive, &prefix, &mut collections, &mut budget)?;
        if app.is_some() || engine.is_some() || music.is_some() || !collections.is_empty() {
            profiles.insert(
                id.clone(),
                json!({ "settings": settings, "collections": collections }),
            );
        }
    }
    let mut avatars = Map::new();
    for name in &names {
        let Some(id) = name
            .strip_prefix(AVATARS_DIR)
            .and_then(|rest| rest.strip_suffix(".webp"))
            .filter(|id| is_safe_id(id))
        else {
            continue;
        };
        if let Some(photo) = read_limited(archive, name, MAX_AVATAR_BYTES, &mut budget)? {
            avatars.insert(
                id.to_string(),
                Value::String(base64::engine::general_purpose::STANDARD.encode(photo)),
            );
        }
    }
    backup["manifest"] = manifest;
    backup["profiles"] = Value::Object(profiles);
    backup["profile_avatars"] = Value::Object(avatars);
    Ok(BackupFile::Backup(backup))
}

fn read_text(bytes: &[u8], now_ms: u64) -> BackupFile {
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return BackupFile::Text(text.to_string());
    };
    if let Some(desktop) = value.get(DESKTOP_KEY) {
        return BackupFile::Backup(desktop.clone());
    }
    if value.get("localPlaylists").is_some()
        || value.get("format").and_then(Value::as_str) == Some("Piped")
    {
        return BackupFile::External(ImportKind::LibretubeBackup);
    }
    let names_a_service = value
        .get("subscriptions")
        .and_then(|subscriptions| subscriptions.get(0))
        .is_some_and(|entry| entry.get("service_id").is_some());
    if names_a_service {
        return BackupFile::External(ImportKind::NewpipeSubscriptions);
    }
    if is_android_app_data(&value) || is_android_music_brain(&value) {
        let (app, music) = if is_android_music_brain(&value) {
            (None, Some(&value))
        } else {
            (Some(&value), None)
        };
        let (settings, collections) = slice_to_desktop(app, None, music, now_ms);
        return BackupFile::Backup(json!({
            "schemaVersion": 2,
            "scope": "APP_DATA",
            "settings": settings,
            "collections": collections,
        }));
    }
    BackupFile::Text(text.to_string())
}

/// Reads a picked backup file. A zip and a plain file are told apart by their first bytes, since
/// names are the viewer's own.
pub fn read_backup_file(path: &Path, now_ms: u64) -> Result<BackupFile, ReadError> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut magic = [0_u8; 16];
    let read = file.read(&mut magic)?;
    file.rewind()?;
    if read >= 2 && magic[..2] == *b"PK" {
        let mut archive = open_zip(path)?;
        // A Takeout archive may hold many gigabytes of video it never reads.
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        if let Some(kind) = other_apps_archive(&names) {
            return Ok(BackupFile::External(kind));
        }
        if size > MAX_ARCHIVE_BYTES {
            return Err(ReadError::TooLarge);
        }
        return read_archive(&mut archive, now_ms);
    }
    if magic == *SQLITE_MAGIC {
        return Ok(BackupFile::External(ImportKind::NewpipeBackup));
    }
    if size > MAX_TEXT_BYTES {
        return Err(ReadError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
    file.read_to_end(&mut bytes)?;
    Ok(read_text(&bytes, now_ms))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::{SimpleFileOptions, ZipWriter};

    fn zip_with(name: &str, content: &[u8]) -> ZipArchive<Cursor<Vec<u8>>> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(content).unwrap();
        ZipArchive::new(zip.finish().unwrap()).unwrap()
    }

    #[test]
    fn an_entry_over_its_limit_is_refused_however_well_it_compresses() {
        let mut archive = zip_with("app_data.json", &vec![b'a'; 1024 * 1024]);
        let mut budget = u64::MAX;
        let read = read_limited(&mut archive, "app_data.json", 1024, &mut budget);
        assert!(matches!(read, Err(ReadError::TooLarge)));
    }

    #[test]
    fn entries_share_one_budget() {
        let mut archive = zip_with("a.json", &[b'a'; 100]);
        let mut budget = 150;
        assert!(read_limited(&mut archive, "a.json", 1024, &mut budget).is_ok());
        assert_eq!(budget, 50);
        let read = read_limited(&mut archive, "a.json", 1024, &mut budget);
        assert!(matches!(read, Err(ReadError::TooLarge)));
    }

    #[test]
    fn a_missing_entry_is_not_an_error() {
        let mut archive = zip_with("a.json", b"{}");
        let mut budget = 10;
        assert!(
            read_limited(&mut archive, "b.json", 1024, &mut budget)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn other_apps_archives_are_told_by_what_they_hold() {
        let names = |list: &[&str]| list.iter().map(ToString::to_string).collect::<Vec<_>>();
        assert_eq!(
            other_apps_archive(&names(&["Takeout/YouTube/x.csv"])),
            Some(ImportKind::Takeout)
        );
        assert_eq!(
            other_apps_archive(&names(&["newpipe.db", "newpipe.settings"])),
            Some(ImportKind::NewpipeBackup)
        );
        assert_eq!(
            other_apps_archive(&names(&["settings.preferences_pb", "song.db"])),
            Some(ImportKind::Metrolist)
        );
        assert_eq!(other_apps_archive(&names(&["app_data.json"])), None);
        assert_eq!(other_apps_archive(&names(&["readme.txt"])), None);
    }

    #[test]
    fn other_apps_files_are_told_by_their_fields() {
        let is_external = |text: &str, kind: ImportKind| matches!(read_text(text.as_bytes(), 0), BackupFile::External(found) if found == kind);
        assert!(is_external(
            r#"{"localPlaylists":[],"subscriptions":[]}"#,
            ImportKind::LibretubeBackup
        ));
        assert!(is_external(
            r#"{"format":"Piped","subscriptions":[]}"#,
            ImportKind::LibretubeBackup
        ));
        assert!(is_external(
            r#"{"app_version":"1","subscriptions":[{"service_id":0,"url":"u","name":"n"}]}"#,
            ImportKind::NewpipeSubscriptions
        ));
        assert!(matches!(
            read_text(br#"{"videoId":"x"}"#, 0),
            BackupFile::Text(_)
        ));
    }

    #[test]
    fn a_profile_id_cannot_climb_out_of_its_folder() {
        assert!(is_safe_id("3f2a-b_c"));
        assert!(!is_safe_id("../evil"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id(""));
    }
}
