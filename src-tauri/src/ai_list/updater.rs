//! One update run of the client contract (Flow-Tube/AIlist README, "Update procedure"), as Flow
//! for Android runs it. Every failure leaves the stored list exactly as it was.

use std::collections::{HashMap, HashSet};
use std::future::Future;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::envelope;
use super::formats::{AI_LIST_SCHEMA, AiListKind, DeltaFile, Manifest, SnapshotFile, StoredAiList};
use super::source::AiListSource;
use super::store::AiListStorage;

const HTTP_OK: u16 = 200;
const HTTP_NOT_MODIFIED: u16 = 304;
const HTTP_TOO_MANY_REQUESTS: u16 = 429;
const HTTP_SERVER_ERROR: u16 = 500;

pub struct AiListResponse {
    pub status: u16,
    pub body: Option<Vec<u8>>,
    pub etag: Option<String>,
}

/// One GET under the list's base URL; `Err` when the request did not complete.
pub trait AiListFetcher {
    fn get(
        &self,
        path: &str,
        etag: Option<&str>,
    ) -> impl Future<Output = Result<AiListResponse, String>> + Send;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiListOutcome {
    NotModified,
    UpToDate,
    Snapshot,
    Deltas,
    FallbackSnapshot,
    /// Signature, schema, rollback or hash: retrying cannot fix it, so the next daily run tries
    /// again.
    Refused,
    /// The network or the server failed; worth a retry with backoff.
    Retry,
}

impl AiListOutcome {
    /// A new list was stored.
    #[must_use]
    pub fn committed(self) -> bool {
        matches!(self, Self::Snapshot | Self::Deltas | Self::FallbackSnapshot)
    }
}

pub struct AiListUpdate {
    pub outcome: AiListOutcome,
    pub list: Option<StoredAiList>,
    pub reason: Option<String>,
}

/// A file the manifest names that cannot be used; `status` is its HTTP status when it had one.
struct Rejected {
    reason: String,
    status: u16,
}

impl Rejected {
    fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            status: 0,
        }
    }
}

enum FileError {
    Network(String),
    Rejected(Rejected),
}

pub async fn run<F: AiListFetcher, S: AiListStorage>(
    fetcher: &F,
    storage: &S,
    source: &AiListSource,
    kind: AiListKind,
    now_ms: i64,
) -> AiListUpdate {
    let list_id = kind.id();
    let source_id = source.id();
    let default_id = AiListSource::default().id();
    let stored = storage
        .load()
        .filter(|list| list.source.as_deref().unwrap_or(&default_id) == source_id);
    let base = format!("v1/{list_id}/");
    let response = match fetcher
        .get(
            &format!("{base}manifest.json"),
            stored.as_ref().and_then(|s| s.etag.as_deref()),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => return update(AiListOutcome::Retry, stored, Some(error)),
    };
    if response.status == HTTP_NOT_MODIFIED {
        return update(AiListOutcome::NotModified, stored, None);
    }
    let Some(body) = response
        .body
        .as_deref()
        .filter(|_| response.status == HTTP_OK)
    else {
        return failed_status(response.status, stored);
    };

    let payload = match envelope::open(body, |key_id| source.key_for(key_id)) {
        Ok(payload) => payload,
        Err(reason) => return refused(stored, reason),
    };
    let Ok(manifest) = serde_json::from_slice::<Manifest>(&payload) else {
        return refused(stored, "manifest payload does not parse");
    };
    if manifest.schema > AI_LIST_SCHEMA {
        return refused(stored, format!("schema {}", manifest.schema));
    }
    if manifest.list != list_id {
        return refused(stored, format!("list {}", manifest.list));
    }
    if let Some(stored) = stored.as_ref() {
        if manifest.version < stored.version {
            return refused(Some(stored.clone()), "older version");
        }
        if manifest.version == stored.version {
            return update(AiListOutcome::UpToDate, Some(stored.clone()), None);
        }
    }

    let mut outcome = AiListOutcome::Snapshot;
    let mut next = None;
    if let Some(current) = stored.as_ref().filter(|s| uses_deltas(s, &manifest)) {
        match apply_deltas(fetcher, &base, list_id, current.clone(), &manifest).await {
            Ok(list) => {
                next = Some(list);
                outcome = AiListOutcome::Deltas;
            }
            Err(FileError::Network(error)) => {
                return update(AiListOutcome::Retry, stored, Some(error));
            }
            Err(FileError::Rejected(_)) => outcome = AiListOutcome::FallbackSnapshot,
        }
    }
    let next = match next {
        Some(list) => list,
        None => match take_snapshot(fetcher, &base, list_id, &manifest).await {
            Ok(list) => list,
            Err(FileError::Network(error)) => {
                return update(AiListOutcome::Retry, stored, Some(error));
            }
            Err(FileError::Rejected(rejected)) if rejected.status >= HTTP_SERVER_ERROR => {
                return update(AiListOutcome::Retry, stored, Some(rejected.reason));
            }
            Err(FileError::Rejected(rejected)) => return refused(stored, rejected.reason),
        },
    };

    let committed = StoredAiList {
        etag: response.etag,
        updated_at_ms: now_ms,
        source: Some(source_id),
        ..next
    };
    if let Err(error) = storage.commit(&committed) {
        return update(AiListOutcome::Retry, stored, Some(error.to_string()));
    }
    update(outcome, Some(committed), None)
}

fn uses_deltas(stored: &StoredAiList, manifest: &Manifest) -> bool {
    let steps = manifest.version - stored.version;
    if steps > manifest.max_delta_chain {
        return false;
    }
    let available: HashSet<i64> = manifest.deltas.iter().map(|delta| delta.to).collect();
    (stored.version + 1..=manifest.version).all(|version| available.contains(&version))
}

async fn apply_deltas<F: AiListFetcher>(
    fetcher: &F,
    base: &str,
    list_id: &str,
    stored: StoredAiList,
    manifest: &Manifest,
) -> Result<StoredAiList, FileError> {
    let refs: HashMap<i64, _> = manifest
        .deltas
        .iter()
        .map(|delta| (delta.to, delta))
        .collect();
    let mut working = stored;
    for version in working.version + 1..=manifest.version {
        let reference = refs
            .get(&version)
            .ok_or_else(|| FileError::Rejected(Rejected::new(format!("no delta {version}"))))?;
        let bytes = fetch_verified(fetcher, base, &reference.path, &reference.sha256).await?;
        let delta: DeltaFile = parse(&bytes)?;
        if delta.list != list_id || delta.from != version - 1 || delta.to != version {
            return Err(FileError::Rejected(Rejected::new(format!(
                "delta {version} has the wrong range"
            ))));
        }
        working = working.applying(&delta);
    }
    Ok(working)
}

async fn take_snapshot<F: AiListFetcher>(
    fetcher: &F,
    base: &str,
    list_id: &str,
    manifest: &Manifest,
) -> Result<StoredAiList, FileError> {
    let bytes = fetch_verified(
        fetcher,
        base,
        &manifest.snapshot.path,
        &manifest.snapshot.sha256,
    )
    .await?;
    let snapshot: SnapshotFile = parse(&bytes)?;
    if snapshot.list != list_id || snapshot.version != manifest.version {
        return Err(FileError::Rejected(Rejected::new(
            "snapshot does not match the manifest",
        )));
    }
    Ok(StoredAiList {
        version: snapshot.version,
        block: snapshot.block,
        warn: snapshot.warn,
        ..StoredAiList::default()
    })
}

async fn fetch_verified<F: AiListFetcher>(
    fetcher: &F,
    base: &str,
    path: &str,
    sha256: &str,
) -> Result<Vec<u8>, FileError> {
    if path.starts_with('/') || path.contains("..") || path.contains("://") {
        return Err(FileError::Rejected(Rejected::new(format!(
            "{path} is not a list path"
        ))));
    }
    let file = fetcher
        .get(&format!("{base}{path}"), None)
        .await
        .map_err(FileError::Network)?;
    let Some(body) = file.body.filter(|_| file.status == HTTP_OK) else {
        return Err(FileError::Rejected(Rejected {
            reason: format!("{path}: status {}", file.status),
            status: file.status,
        }));
    };
    if hex::encode(Sha256::digest(&body)) != sha256.to_ascii_lowercase() {
        return Err(FileError::Rejected(Rejected::new(format!(
            "{path}: hash mismatch"
        ))));
    }
    Ok(body)
}

fn parse<T: for<'de> serde::Deserialize<'de>>(bytes: &[u8]) -> Result<T, FileError> {
    serde_json::from_slice(bytes)
        .map_err(|_| FileError::Rejected(Rejected::new("file does not parse")))
}

fn failed_status(status: u16, stored: Option<StoredAiList>) -> AiListUpdate {
    let reason = format!("manifest status {status}");
    if status >= HTTP_SERVER_ERROR || status == HTTP_TOO_MANY_REQUESTS {
        update(AiListOutcome::Retry, stored, Some(reason))
    } else {
        refused(stored, reason)
    }
}

fn refused(stored: Option<StoredAiList>, reason: impl Into<String>) -> AiListUpdate {
    update(AiListOutcome::Refused, stored, Some(reason.into()))
}

fn update(
    outcome: AiListOutcome,
    list: Option<StoredAiList>,
    reason: Option<String>,
) -> AiListUpdate {
    AiListUpdate {
        outcome,
        list,
        reason,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::io;
    use std::sync::Mutex;

    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    use super::*;
    use crate::ai_list::formats::Entries;

    const SEED: [u8; 32] = [7; 32];

    fn own_source() -> AiListSource {
        AiListSource {
            base_url: "https://lists.example/".to_string(),
            public_key: Some(
                SigningKey::from_bytes(&SEED)
                    .verifying_key()
                    .to_bytes()
                    .to_vec(),
            ),
        }
    }

    fn signed(payload: &serde_json::Value, seed: [u8; 32]) -> Vec<u8> {
        let payload = payload.to_string().into_bytes();
        let sig = SigningKey::from_bytes(&seed).sign(&payload).to_bytes();
        json!({ "key_id": "test", "payload": STANDARD.encode(&payload), "sig": STANDARD.encode(sig) })
            .to_string()
            .into_bytes()
    }

    fn sha(bytes: &[u8]) -> String {
        hex::encode(Sha256::digest(bytes))
    }

    #[derive(Default)]
    struct FakeServer {
        files: Mutex<HashMap<String, (u16, Vec<u8>)>>,
        offline: bool,
        etag: Option<String>,
        requests: Mutex<Vec<String>>,
    }

    impl FakeServer {
        fn put(&self, path: &str, body: Vec<u8>) {
            self.files
                .lock()
                .unwrap()
                .insert(format!("v1/aislist/{path}"), (200, body));
        }

        fn put_status(&self, path: &str, status: u16) {
            self.files
                .lock()
                .unwrap()
                .insert(format!("v1/aislist/{path}"), (status, Vec::new()));
        }

        fn requested(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }
    }

    impl AiListFetcher for FakeServer {
        fn get(
            &self,
            path: &str,
            etag: Option<&str>,
        ) -> impl Future<Output = Result<AiListResponse, String>> + Send {
            self.requests.lock().unwrap().push(path.to_string());
            let result = if self.offline {
                Err("offline".to_string())
            } else if etag.is_some() && etag == self.etag.as_deref() {
                Ok(AiListResponse {
                    status: 304,
                    body: None,
                    etag: None,
                })
            } else {
                let files = self.files.lock().unwrap();
                Ok(match files.get(path) {
                    Some((status, body)) => AiListResponse {
                        status: *status,
                        body: (*status == 200).then(|| body.clone()),
                        etag: self.etag.clone(),
                    },
                    None => AiListResponse {
                        status: 404,
                        body: None,
                        etag: None,
                    },
                })
            };
            std::future::ready(result)
        }
    }

    #[derive(Default)]
    struct MemoryStore {
        list: RefCell<Option<StoredAiList>>,
        commits: RefCell<usize>,
    }

    impl AiListStorage for MemoryStore {
        fn load(&self) -> Option<StoredAiList> {
            self.list.borrow().clone()
        }

        fn commit(&self, list: &StoredAiList) -> io::Result<()> {
            *self.list.borrow_mut() = Some(list.clone());
            *self.commits.borrow_mut() += 1;
            Ok(())
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(ToString::to_string).collect()
    }

    /// A server at `version` with a snapshot and the deltas `deltas` (to-versions).
    fn server(version: i64, handles: &[&str], deltas: &[(i64, serde_json::Value)]) -> FakeServer {
        let server = FakeServer {
            etag: Some(format!("\"v{version}\"")),
            ..FakeServer::default()
        };
        let snapshot =
            json!({ "list": "aislist", "version": version, "block": { "handles": handles } })
                .to_string()
                .into_bytes();
        let mut refs = Vec::new();
        for (to, delta) in deltas {
            let bytes = delta.to_string().into_bytes();
            refs.push(
                json!({ "to": to, "path": format!("delta/{to}.json"), "sha256": sha(&bytes) }),
            );
            server.put(&format!("delta/{to}.json"), bytes);
        }
        let manifest = json!({
            "schema": 1, "list": "aislist", "version": version,
            "snapshot": { "path": format!("snapshot/{version}.json"), "sha256": sha(&snapshot) },
            "deltas": refs, "max_delta_chain": 14,
        });
        server.put(&format!("snapshot/{version}.json"), snapshot);
        server.put("manifest.json", signed(&manifest, SEED));
        server
    }

    fn stored(version: i64, handles: &[&str]) -> StoredAiList {
        StoredAiList {
            version,
            etag: Some("\"old\"".to_string()),
            updated_at_ms: 1,
            source: Some(own_source().id()),
            block: Entries {
                handles: strings(handles),
                ids: Vec::new(),
            },
            warn: Entries::default(),
        }
    }

    fn run_now(server: &FakeServer, store: &MemoryStore) -> AiListUpdate {
        run_list(server, store, AiListKind::Channels)
    }

    fn run_list(server: &FakeServer, store: &MemoryStore, kind: AiListKind) -> AiListUpdate {
        tauri::async_runtime::block_on(run(server, store, &own_source(), kind, 99))
    }

    #[test]
    fn the_first_run_takes_the_snapshot_and_stores_it_with_the_manifest_etag() {
        let server = server(4, &["drew"], &[]);
        let store = MemoryStore::default();
        let update = run_now(&server, &store);
        assert_eq!(update.outcome, AiListOutcome::Snapshot);
        let list = store.load().unwrap();
        assert_eq!(list.version, 4);
        assert_eq!(list.block.handles, strings(&["drew"]));
        assert_eq!(list.etag.as_deref(), Some("\"v4\""));
        assert_eq!(list.updated_at_ms, 99);
        assert_eq!(list.source, Some(own_source().id()));
    }

    #[test]
    fn a_later_run_applies_each_delta_removing_before_adding() {
        let server = server(
            4,
            &["unused"],
            &[
                (
                    3,
                    json!({ "list": "aislist", "from": 2, "to": 3, "block": { "handles": { "add": ["c"], "remove": ["a"] } } }),
                ),
                (
                    4,
                    json!({ "list": "aislist", "from": 3, "to": 4, "block": { "handles": { "add": ["d"] } } }),
                ),
            ],
        );
        let store = MemoryStore::default();
        store.commit(&stored(2, &["a", "b"])).unwrap();
        let update = run_now(&server, &store);
        assert_eq!(update.outcome, AiListOutcome::Deltas);
        assert_eq!(
            store.load().unwrap().block.handles,
            strings(&["b", "c", "d"])
        );
        assert!(
            !server
                .requested()
                .iter()
                .any(|path| path.contains("snapshot"))
        );
    }

    #[test]
    fn an_unchanged_manifest_answers_304_and_nothing_is_written() {
        let mut server = server(4, &["drew"], &[]);
        server.etag = Some("\"old\"".to_string());
        let store = MemoryStore::default();
        store.commit(&stored(4, &["drew"])).unwrap();
        assert_eq!(run_now(&server, &store).outcome, AiListOutcome::NotModified);
        assert_eq!(*store.commits.borrow(), 1);
    }

    #[test]
    fn a_missing_delta_falls_back_to_the_snapshot_in_the_same_run() {
        let server = server(
            4,
            &["fresh"],
            &[
                (3, json!({ "list": "aislist", "from": 2, "to": 3 })),
                (4, json!({})),
            ],
        );
        server.put_status("delta/4.json", 404);
        let store = MemoryStore::default();
        store.commit(&stored(2, &["a"])).unwrap();
        assert_eq!(
            run_now(&server, &store).outcome,
            AiListOutcome::FallbackSnapshot
        );
        assert_eq!(store.load().unwrap().block.handles, strings(&["fresh"]));
    }

    #[test]
    fn a_hash_mismatch_leaves_the_stored_list_exactly_as_it_was() {
        let server = server(4, &["drew"], &[]);
        server.put(
            "snapshot/4.json",
            b"{\"list\":\"aislist\",\"version\":4}".to_vec(),
        );
        let store = MemoryStore::default();
        let before = stored(1, &["a"]);
        store.commit(&before).unwrap();
        let update = run_now(&server, &store);
        assert_eq!(update.outcome, AiListOutcome::Refused);
        assert_eq!(store.load(), Some(before));
    }

    #[test]
    fn a_newer_schema_another_list_or_an_older_version_is_refused() {
        for manifest in [
            json!({ "schema": 2, "list": "aislist", "version": 5, "snapshot": { "path": "s", "sha256": "0" } }),
            json!({ "schema": 1, "list": "other", "version": 5, "snapshot": { "path": "s", "sha256": "0" } }),
            json!({ "schema": 1, "list": "aislist", "version": 1, "snapshot": { "path": "s", "sha256": "0" } }),
        ] {
            let server = FakeServer::default();
            server.put("manifest.json", signed(&manifest, SEED));
            let store = MemoryStore::default();
            store.commit(&stored(2, &["a"])).unwrap();
            assert_eq!(run_now(&server, &store).outcome, AiListOutcome::Refused);
            assert_eq!(store.load().unwrap().version, 2);
        }
    }

    #[test]
    fn the_music_list_is_read_from_its_own_folder_and_another_lists_manifest_is_refused_there() {
        let server = server(1, &["alpha"], &[]);
        let store = MemoryStore::default();
        assert_eq!(
            run_list(&server, &store, AiListKind::Music).outcome,
            AiListOutcome::Refused
        );
        assert_eq!(
            server.requested(),
            vec!["v1/aimusic/manifest.json".to_string()]
        );

        let copies: Vec<_> = server
            .files
            .lock()
            .unwrap()
            .iter()
            .map(|(path, file)| (path.replace("v1/aislist/", "v1/aimusic/"), file.clone()))
            .collect();
        server.files.lock().unwrap().extend(copies);
        let update = run_list(&server, &store, AiListKind::Music);
        assert_eq!(update.outcome, AiListOutcome::Refused);
        assert_eq!(update.reason.as_deref(), Some("list aislist"));
        assert_eq!(*store.commits.borrow(), 0);
        assert_eq!(store.load(), None);
    }

    #[test]
    fn a_manifest_signed_with_an_untrusted_key_is_refused() {
        let server = server(4, &["drew"], &[]);
        let manifest = json!({ "schema": 1, "list": "aislist", "version": 4, "snapshot": { "path": "s", "sha256": "0" } });
        server.put("manifest.json", signed(&manifest, [9; 32]));
        let store = MemoryStore::default();
        let update = run_now(&server, &store);
        assert_eq!(update.outcome, AiListOutcome::Refused);
        assert_eq!(update.reason.as_deref(), Some("signature does not verify"));
        assert_eq!(store.load(), None);
    }

    #[test]
    fn a_list_from_another_source_is_not_built_on() {
        let server = server(
            4,
            &["fresh"],
            &[(4, json!({ "list": "aislist", "from": 3, "to": 4 }))],
        );
        let store = MemoryStore::default();
        let mut other = stored(3, &["a"]);
        other.source = Some(AiListSource::default().id());
        store.commit(&other).unwrap();
        assert_eq!(run_now(&server, &store).outcome, AiListOutcome::Snapshot);
        assert_eq!(store.load().unwrap().block.handles, strings(&["fresh"]));
    }

    #[test]
    fn an_offline_computer_retries_later_and_keeps_its_list() {
        let server = FakeServer {
            offline: true,
            ..FakeServer::default()
        };
        let store = MemoryStore::default();
        let before = stored(2, &["a"]);
        store.commit(&before).unwrap();
        let update = run_now(&server, &store);
        assert_eq!(update.outcome, AiListOutcome::Retry);
        assert_eq!(update.list, Some(before.clone()));
        assert_eq!(store.load(), Some(before));
    }

    #[test]
    fn a_server_error_is_retried_and_a_missing_manifest_is_refused() {
        let busy = FakeServer::default();
        busy.put_status("manifest.json", 503);
        let store = MemoryStore::default();
        assert_eq!(run_now(&busy, &store).outcome, AiListOutcome::Retry);
        assert_eq!(
            run_now(&FakeServer::default(), &store).outcome,
            AiListOutcome::Refused
        );
    }

    #[test]
    fn a_path_outside_the_list_is_never_fetched() {
        let snapshot = b"{}".to_vec();
        let manifest = json!({ "schema": 1, "list": "aislist", "version": 1,
            "snapshot": { "path": "../secret.json", "sha256": sha(&snapshot) } });
        let server = FakeServer::default();
        server.put("manifest.json", signed(&manifest, SEED));
        assert_eq!(
            run_now(&server, &MemoryStore::default()).outcome,
            AiListOutcome::Refused
        );
        assert_eq!(
            server.requested(),
            vec!["v1/aislist/manifest.json".to_string()]
        );
    }
}
