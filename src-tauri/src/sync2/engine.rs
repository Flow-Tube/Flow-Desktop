//! One sync with a store: verify the roster, push this device's changes, pull everyone else's.
//! It holds no secrets beyond the session: epoch keys are unwrapped from the store each time.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::batches::{IncomingBatch, mark_sent, outgoing_batches, parse_batch};
use super::envelope::{
    Header, ObjectType, ParsedObject, StreamPosition, next_in_stream, open_object, parse_object,
    seal_object, verify_object,
};
use super::epoch::{check_epoch_key, open_chain, purpose_key};
use super::gc::{Ack, Logged, VersionVector, record_ack, record_links, record_manifest};
use super::keys::MemberSecrets;
use super::paths::{log_path, parse_log_path};
use super::payload::{decode_payload, encode_payload};
use super::roster::{Entry, RosterState, apply_entry, replay_roster};
use super::server::StoreError;
use super::snapshot::{Manifest, note_merged};
use super::state::{
    GroupRecord, add_roster_entries, load_group, roster_entries, save_group, save_streams, streams,
};
use super::store::Store;
use super::wrap::unwrap_epoch_key;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;
use crate::sync::error::SyncError;
use crate::sync::protocol::OutgoingCollection;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Local(#[from] SyncError),
    #[error(transparent)]
    Protocol(#[from] Error),
    #[error(transparent)]
    Keychain(#[from] crate::security::keychain::CredentialError),
    #[error(transparent)]
    Settings(#[from] crate::errors::AppError),
    #[error("this device is not in a sync group")]
    NotLinked,
    #[error("this device was removed from its sync group")]
    Removed,
    #[error("the six-digit code was not confirmed")]
    Declined,
    #[error("the other device didn't answer in time")]
    TimedOut,
    #[error("the other device sent something unexpected")]
    Unexpected,
    #[error("these recovery words are not valid")]
    WrongWords,
    #[error("this recovery key was already used or replaced")]
    RecoveryUsed,
    #[error("this device is already in a sync group")]
    AlreadyLinked,
}

impl EngineError {
    /// A stable name the interface turns into a translated message.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Store(StoreError::Insecure) => "linkedInsecure",
            Self::Store(StoreError::Network(_)) => "linkedUnreachable",
            Self::Store(StoreError::Refused { .. }) => "linkedRefused",
            Self::Store(StoreError::InstanceChanged) => "linkedInstanceChanged",
            Self::Store(_) | Self::Protocol(_) | Self::Unexpected => "linkedProtocol",
            Self::Local(error) => error.kind(),
            Self::Keychain(_) | Self::Settings(_) => "linkedLocal",
            Self::NotLinked => "linkedNotLinked",
            Self::Removed => "linkedRemoved",
            Self::Declined => "linkedDeclined",
            Self::TimedOut => "linkedTimedOut",
            Self::WrongWords => "linkedWrongWords",
            Self::RecoveryUsed => "linkedRecoveryUsed",
            Self::AlreadyLinked => "linkedAlreadyLinked",
        }
    }
}

pub type Result<T> = std::result::Result<T, EngineError>;

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Batches read from other devices, not applied yet, and how far reading got.
#[derive(Default)]
pub struct Pulled {
    pub batches: BTreeMap<String, Vec<IncomingBatch>>,
    positions: BTreeMap<String, StreamPosition>,
    cursor: i64,
    /// Batches and snapshot manifests read. Acks aren't acknowledged, so two idle devices don't
    /// answer each other's acks forever.
    consumed: usize,
    stalled: bool,
    /// The links named by the batches and snapshot manifests read, in reading order; `None` is
    /// the `profiles` collection.
    links: Vec<Option<String>>,
    acks: BTreeMap<String, VersionVector>,
    manifests: Vec<Logged>,
}

/// What a log object carries, once checked and opened.
pub(super) enum Content {
    Batch(IncomingBatch),
    Snapshot(Manifest),
    Ack(Ack),
}

pub struct Session<'a, S> {
    store: S,
    device: &'a MemberSecrets,
    record: GroupRecord,
    group: [u8; 16],
    state: RosterState,
    entries: Vec<Entry>,
    signing_keys: BTreeMap<String, [u8; 32]>,
    commitments: BTreeMap<u32, Vec<u8>>,
    keys: BTreeMap<u32, Vec<u8>>,
}

fn decode_b64(value: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| Error::RosterFormat.into())
}

impl<'a, S: Store> Session<'a, S> {
    /// Brings the roster up to date and unwraps the current epoch key.
    pub async fn open(pool: &SqlitePool, store: S, device: &'a MemberSecrets) -> Result<Self> {
        let record = load_group(pool).await?.ok_or(EngineError::NotLinked)?;
        let group = array(&hex::decode(&record.group_id).map_err(|_| Error::Group)?);
        let mut entries = roster_entries(pool).await?;
        let mut state = replay_roster(&entries)?;
        let after = i64::try_from(state.seq).map_err(|_| Error::RosterChain)?;
        let fresh = store.roster_after(after).await?;
        for entry in &fresh {
            state = apply_entry(Some(&state), entry)?;
        }
        add_roster_entries(pool, &fresh).await?;
        entries.extend(fresh);
        if !state.members.contains_key(&hex::encode(device.did)) {
            return Err(EngineError::Removed);
        }
        let mut session = Self {
            store,
            device,
            record,
            group,
            state,
            entries: Vec::new(),
            signing_keys: BTreeMap::new(),
            commitments: BTreeMap::new(),
            keys: BTreeMap::new(),
        };
        for entry in &entries {
            for subject in entry.add.iter().flatten() {
                session
                    .signing_keys
                    .insert(subject.did.clone(), array(&decode_b64(&subject.sig)?));
            }
            if let Some(epoch) = &entry.epoch {
                session.commitments.insert(epoch.n, decode_b64(&epoch.kc)?);
            }
        }
        session.entries = entries;
        session.unwrap_current().await?;
        Ok(session)
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn roster(&self) -> &RosterState {
        &self.state
    }

    pub fn group(&self) -> &[u8; 16] {
        &self.group
    }

    pub fn record(&self) -> &GroupRecord {
        &self.record
    }

    pub fn device(&self) -> &MemberSecrets {
        self.device
    }

    /// The key of the epoch in force, unwrapped when the session opened.
    pub fn current_key(&self) -> &[u8] {
        self.keys.get(&self.state.epoch).map_or(&[], Vec::as_slice)
    }

    /// The verified roster entries, oldest first.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    async fn unwrap_current(&mut self) -> Result<()> {
        let epoch = self.state.epoch;
        let did = self.device.did;
        let wrap = self
            .store
            .key(epoch, &hex::encode(did))
            .await?
            .ok_or(Error::KeyCommitment)?;
        let key = unwrap_epoch_key(&self.device.kem_secret, &self.group, epoch, &did, &wrap)?;
        let commitment = self.commitments.get(&epoch).ok_or(Error::KeyCommitment)?;
        check_epoch_key(&key, &self.group, epoch, commitment)?;
        self.keys.insert(epoch, key);
        Ok(())
    }

    /// The key of `epoch`, walking the history chain back from the newest key this device holds.
    pub async fn epoch_key(&mut self, epoch: u32) -> Result<Vec<u8>> {
        while !self.keys.contains_key(&epoch) {
            let (&known, key) = self.keys.iter().next().ok_or(Error::KeyCommitment)?;
            if known <= epoch {
                return Err(Error::KeyCommitment.into());
            }
            let chain = self
                .store
                .key(known, "chain")
                .await?
                .ok_or(Error::KeyCommitment)?;
            let previous = open_chain(key, &self.group, known, &chain)?;
            let commitment = self
                .commitments
                .get(&(known - 1))
                .ok_or(Error::KeyCommitment)?;
            check_epoch_key(&previous, &self.group, known - 1, commitment)?;
            self.keys.insert(known - 1, previous);
        }
        Ok(self.keys[&epoch].clone())
    }

    pub(super) async fn write(
        &mut self,
        pool: &SqlitePool,
        object_type: ObjectType,
        content: &[u8],
    ) -> Result<()> {
        let seq = u64::try_from(self.record.own_seq + 1).map_err(|_| Error::Length)?;
        let epoch = self.state.epoch;
        let header = Header {
            object_type,
            group: self.group,
            epoch,
            sender: self.device.did,
            seq,
            prev: array(&hex::decode(&self.record.own_prev).map_err(|_| Error::Prev)?),
        };
        let key = purpose_key(
            &self.keys[&epoch],
            &self.group,
            epoch,
            object_type.purpose(),
        );
        let object = seal_object(
            &header,
            &key,
            &encode_payload(content)?,
            &self.device.sig_seed,
        );
        let hash = super::kdf::sha256(&object);
        self.store
            .put_object(&log_path(&hex::encode(self.device.did), seq), object)
            .await?;
        self.record.own_seq += 1;
        self.record.own_prev = hex::encode(hash);
        save_group(pool, &self.record).await?;
        Ok(())
    }

    /// Uploads what changed in `exported` since the last upload.
    pub async fn push(
        &mut self,
        pool: &SqlitePool,
        exported: Vec<OutgoingCollection>,
    ) -> Result<usize> {
        let outgoing = outgoing_batches(
            pool,
            exported,
            &self.state.head,
            &self.record.link,
            now_ms(),
        )
        .await?;
        for batch in &outgoing.batches {
            self.write(pool, ObjectType::Changes, &batch.content)
                .await?;
        }
        mark_sent(pool, &outgoing).await?;
        let bytes = outgoing.batches.iter().map(|b| b.content.len()).sum();
        note_merged(pool, &self.record.link, bytes).await?;
        Ok(outgoing.batches.len())
    }

    /// Reads other devices' new objects in stream order, checking each one. Nothing is applied:
    /// the caller applies [`Pulled::batches`] and then calls [`Session::finish`].
    pub async fn pull(&mut self, pool: &SqlitePool) -> Result<Pulled> {
        let link = self.record.link.clone();
        self.read_new(pool, Some(&link)).await
    }

    /// Links a restored device's profile (spec/protocol.md, Recovery): to the link other devices'
    /// batches name, or to `own` when they name none. False while the logs can't be read to the
    /// end yet; nothing may be pushed or pulled until this returns true.
    pub async fn adopt_link(&mut self, pool: &SqlitePool, own: &str) -> Result<bool> {
        if !self.record.link.is_empty() {
            return Ok(true);
        }
        let read = self.read_new(pool, None).await?;
        if read.stalled {
            return Ok(false);
        }
        self.record.link = read
            .links
            .into_iter()
            .flatten()
            .next()
            .unwrap_or_else(|| own.to_owned());
        save_group(pool, &self.record).await?;
        Ok(true)
    }

    /// Batches of `link` only, or every batch when `link` is `None`.
    async fn read_new(&mut self, pool: &SqlitePool, link: Option<&str>) -> Result<Pulled> {
        let me = hex::encode(self.device.did);
        let mut pulled = Pulled {
            positions: streams(pool).await?,
            cursor: self.record.cursor,
            ..Pulled::default()
        };
        if pulled.positions.is_empty()
            && pulled.cursor == 0
            && let Some(start) = self.bootstrap().await?
        {
            pulled.links.push(start.manifest.link.clone());
            if link.is_none_or(|l| start.manifest.link.as_deref() == Some(l)) {
                pulled.batches.insert(start.writer, start.batches);
            }
            pulled.positions = start.positions;
        }
        loop {
            let cursor = u64::try_from(pulled.cursor).unwrap_or(0);
            let (changes, next) = self.store.changes(cursor).await?;
            if changes.is_empty() {
                return Ok(pulled);
            }
            // Objects of one sender may be listed out of order: retry while a pass makes progress.
            let mut waiting: Vec<(String, u64, String)> = changes
                .into_iter()
                .filter_map(|change| {
                    parse_log_path(&change.path).map(|(did, seq)| (did, seq, change.path))
                })
                .filter(|(did, seq, _)| {
                    *did != me && pulled.positions.get(did).is_none_or(|p| p.seq < *seq)
                })
                .collect();
            loop {
                let before = waiting.len();
                let mut still = Vec::new();
                for (did, seq, path) in waiting {
                    match self
                        .read_object(&path, &did, seq, pulled.positions.get(&did))
                        .await?
                    {
                        Some((position, content)) => {
                            let seq = position.seq;
                            pulled.positions.insert(did.clone(), position);
                            if !matches!(content, Content::Ack) {
                                pulled.consumed += 1;
                            }
                            match content {
                                Content::Batch(batch) => {
                                    pulled.links.push(batch.link.clone());
                                    if link.is_none_or(|l| batch.link.as_deref() == Some(l)) {
                                        pulled.batches.entry(did).or_default().push(batch);
                                    }
                                }
                                Content::Snapshot(manifest) => {
                                    pulled.links.push(manifest.link.clone());
                                    pulled.manifests.push(Logged { did, seq, manifest });
                                }
                                Content::Ack(ack) => {
                                    pulled.acks.insert(did, ack.vv);
                                }
                            }
                        }
                        None => still.push((did, seq, path)),
                    }
                }
                waiting = still;
                if waiting.is_empty() || waiting.len() == before {
                    break;
                }
            }
            // A missing object means the store hasn't caught up: read this page again next time.
            if !waiting.is_empty() {
                pulled.stalled = true;
                return Ok(pulled);
            }
            pulled.cursor = i64::try_from(next).map_err(|_| Error::Length)?;
        }
    }

    /// One log object, checked in the order of spec/store.md. `None` when an earlier object of
    /// this sender is still missing.
    async fn read_object(
        &mut self,
        path: &str,
        did: &str,
        seq: u64,
        last: Option<&StreamPosition>,
    ) -> Result<Option<(StreamPosition, Content)>> {
        let Some(bytes) = self.store.get_object(path).await? else {
            return Ok(None);
        };
        let object = self.verified(&bytes, did, seq)?;
        let position = match next_in_stream(last, &object) {
            Err(Error::Gap) => return Ok(None),
            other => other?,
        };
        Ok(Some((position, self.open_content(&object).await?)))
    }

    /// Steps 1 to 3 of reading an envelope: structure, sender, signature. The caller checks its
    /// place in the stream before opening it.
    pub(super) fn verified<'b>(
        &self,
        bytes: &'b [u8],
        did: &str,
        seq: u64,
    ) -> Result<ParsedObject<'b>> {
        let object = parse_object(bytes, &self.group)?;
        let sender = self.signing_keys.get(did).ok_or(Error::Sender)?;
        verify_object(&object, sender)?;
        if hex::encode(object.header.sender) != did || object.header.seq != seq {
            return Err(Error::Replay.into());
        }
        Ok(object)
    }

    pub(super) async fn open_content(&mut self, object: &ParsedObject<'_>) -> Result<Content> {
        let epoch = object.header.epoch;
        let key = purpose_key(
            &self.epoch_key(epoch).await?,
            &self.group,
            epoch,
            object.header.object_type.purpose(),
        );
        let content = decode_payload(&open_object(object, &key)?)?;
        Ok(match object.header.object_type {
            ObjectType::Changes => Content::Batch(parse_batch(&content)?),
            ObjectType::Snapshot => {
                Content::Snapshot(serde_json::from_slice(&content).map_err(|_| Error::Payload)?)
            }
            ObjectType::Ack => {
                Content::Ack(serde_json::from_slice(&content).map_err(|_| Error::Payload)?)
            }
            ObjectType::Live => return Err(Error::Suite.into()),
        })
    }

    /// Saves how far reading got, after the caller applied the batches, and acknowledges it.
    pub async fn finish(&mut self, pool: &SqlitePool, pulled: Pulled) -> Result<()> {
        save_streams(pool, &pulled.positions, pulled.cursor).await?;
        let merged = pulled.batches.values().flatten().map(|b| b.size).sum();
        note_merged(pool, &self.record.link, merged).await?;
        self.record.cursor = pulled.cursor;
        for (did, vv) in &pulled.acks {
            record_ack(pool, did, vv).await?;
        }
        for logged in &pulled.manifests {
            record_manifest(pool, logged).await?;
        }
        record_links(pool, &pulled.links).await?;
        if pulled.consumed > 0 {
            let ack = Ack {
                vv: pulled
                    .positions
                    .iter()
                    .map(|(did, p)| (did.clone(), p.seq))
                    .collect(),
            };
            self.write(pool, ObjectType::Ack, &to_canonical_json(&ack))
                .await?;
            record_ack(pool, &hex::encode(self.device.did), &ack.vv).await?;
        }
        Ok(())
    }
}
