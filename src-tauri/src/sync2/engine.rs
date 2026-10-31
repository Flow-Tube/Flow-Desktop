//! One sync with a store: verify the roster, push this device's changes, pull everyone else's.
//! It holds no secrets beyond the session: epoch keys are unwrapped from the store each time.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::batches::{IncomingBatch, mark_sent, outgoing_batches, parse_batch};
use super::bootstrap::Snapshot;
use super::envelope::{
    Header, ObjectType, ParsedObject, StreamPosition, next_in_stream, open_object, parse_object,
    seal_object, verify_object,
};
use super::epoch::{check_epoch_key, open_chain, purpose_key};
use super::gc::{Ack, Logged, VersionVector, record_ack, record_links, record_manifest};
use super::kept::{Kept, keep};
use super::keys::MemberSecrets;
use super::paths::{log_path, parse_log_path};
use super::payload::{decode_payload, encode_payload};
use super::profile_links::{Reading, link_profile};
use super::roster::{Entry, RosterState, apply_entry, replay_roster};
use super::server::StoreError;
use super::snapshot::{Manifest, note_merged};
use super::state::{
    Floors, GroupRecord, add_roster_entries, floors, load_group, roster_entries, save_floors,
    save_group, save_streams, streams,
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
    #[error("the other device couldn't be reached on this network")]
    LanUnreachable,
    #[error("the code names another WebDAV folder")]
    OtherFolder,
}

impl EngineError {
    /// A stable name the interface turns into a translated message.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Store(StoreError::Insecure) => "linkedInsecure",
            Self::Store(StoreError::Network(_)) => "linkedUnreachable",
            // A server reset to an empty database no longer has the group.
            Self::Store(StoreError::Refused { code, .. }) if code == "unclaimed" => {
                "linkedGroupMissing"
            }
            Self::Store(StoreError::Refused { .. }) => "linkedRefused",
            Self::Store(StoreError::InstanceChanged) => "linkedInstanceChanged",
            Self::Store(StoreError::AlreadyClaimed) => "linkedAlreadyClaimed",
            Self::Store(StoreError::AdminRefused) => "linkedAdminRefused",
            Self::Store(StoreError::AdminBanned) => "linkedAdminBanned",
            Self::Store(StoreError::SignInRefused) => "linkedSignInRefused",
            Self::Store(StoreError::JoinDeclined) => "linkedJoinDeclined",
            Self::Store(StoreError::Unauthorized) => "linkedStoreUnauthorized",
            Self::Store(StoreError::Local(_)) | Self::Settings(_) => "linkedLocal",
            Self::Keychain(_) => "linkedKeychain",
            Self::Store(_) | Self::Protocol(_) | Self::Unexpected => "linkedProtocol",
            Self::Local(error) => error.kind(),
            Self::NotLinked => "linkedNotLinked",
            Self::Removed => "linkedRemoved",
            Self::Declined => "linkedDeclined",
            Self::TimedOut => "linkedTimedOut",
            Self::WrongWords => "linkedWrongWords",
            Self::RecoveryUsed => "linkedRecoveryUsed",
            Self::AlreadyLinked => "linkedAlreadyLinked",
            Self::LanUnreachable => "linkedLanUnreachable",
            Self::OtherFolder => "linkedOtherFolder",
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
    /// The running profile's batches, by sender, to apply before [`Session::finish`].
    pub batches: BTreeMap<String, Vec<IncomingBatch>>,
    /// Batches of linked profiles that aren't running, kept by [`Session::finish`].
    pub kept: Vec<Kept>,
    /// Where the snapshots started from stop including each link's batches.
    floors: Floors,
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

impl Pulled {
    /// Takes the records of a snapshot this device starts from, as a batch of its writer's.
    fn start_from(&mut self, me: &str, snapshot: Snapshot, reading: Option<&Reading>) {
        self.links.push(snapshot.manifest.link.clone());
        let Some(link) = snapshot.manifest.link else {
            return;
        };
        for (did, tip) in snapshot.manifest.vv.iter().filter(|(did, _)| *did != me) {
            self.floors.insert((link.clone(), did.clone()), tip.seq);
        }
        let writer = snapshot.writer;
        match reading {
            Some(reading) if reading.active.as_deref() != Some(link.as_str()) => {
                for (part, batch) in (1..).zip(snapshot.batches) {
                    self.kept.push(Kept {
                        link: link.clone(),
                        sender: writer.clone(),
                        seq: snapshot.seq,
                        part,
                        batch,
                    });
                }
            }
            _ => self
                .batches
                .entry(writer)
                .or_default()
                .extend(snapshot.batches),
        }
    }

    /// Takes a batch `did` wrote at `seq`: to apply, to keep, or to skip, as `reading` asks.
    fn take(
        &mut self,
        did: String,
        seq: u64,
        batch: IncomingBatch,
        reading: Option<&Reading>,
        floors: &Floors,
    ) {
        let Some(reading) = reading else {
            self.batches.entry(did).or_default().push(batch);
            return;
        };
        let Some(link) = batch.link.clone() else {
            return;
        };
        if floors
            .get(&(link.clone(), did.clone()))
            .is_some_and(|floor| seq <= *floor)
        {
            return;
        }
        if reading.active.as_deref() == Some(link.as_str()) {
            self.batches.entry(did).or_default().push(batch);
        } else if reading.kept.contains(&link) {
            self.kept.push(Kept {
                link,
                sender: did,
                seq,
                part: 0,
                batch,
            });
        }
    }
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
    reading: Reading,
}

fn decode_b64(value: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| Error::RosterFormat.into())
}

/// The signing key of every device the roster ever added, by `did`.
pub fn signing_keys(entries: &[Entry]) -> Result<BTreeMap<String, [u8; 32]>> {
    let mut keys = BTreeMap::new();
    for subject in entries.iter().flat_map(|e| e.add.iter().flatten()) {
        keys.insert(subject.did.clone(), array(&decode_b64(&subject.sig)?));
    }
    Ok(keys)
}

/// Steps 1 to 3 of reading an envelope (spec/store.md): structure, sender, signature, for the
/// object at `did`'s `seq`.
pub fn verify_logged<'b>(
    bytes: &'b [u8],
    group: &[u8; 16],
    signing_keys: &BTreeMap<String, [u8; 32]>,
    did: &str,
    seq: u64,
) -> std::result::Result<ParsedObject<'b>, Error> {
    let object = parse_object(bytes, group)?;
    verify_object(&object, signing_keys.get(did).ok_or(Error::Sender)?)?;
    if hex::encode(object.header.sender) != did || object.header.seq != seq {
        return Err(Error::Replay);
    }
    Ok(object)
}

impl<'a, S: Store> Session<'a, S> {
    /// Brings the roster up to date, unwraps the current epoch key, and starts the next epoch
    /// when a device left.
    pub async fn open(pool: &SqlitePool, store: S, device: &'a MemberSecrets) -> Result<Self> {
        let mut session = Self::open_as_peer(pool, store, device).await?;
        session.rotate_if_due(pool).await?;
        Ok(session)
    }

    /// Like [`Session::open`], but never appends: a LAN session of a group on a store must leave
    /// roster changes to the store.
    pub async fn open_as_peer(
        pool: &SqlitePool,
        store: S,
        device: &'a MemberSecrets,
    ) -> Result<Self> {
        let record = load_group(pool).await?.ok_or(EngineError::NotLinked)?;
        let group = array(&hex::decode(&record.group_id).map_err(|_| Error::Group)?);
        let entries = roster_entries(pool).await?;
        let mut session = Self {
            store,
            device,
            reading: Reading::single(&record.link),
            record,
            group,
            state: replay_roster(&entries)?,
            entries,
            signing_keys: BTreeMap::new(),
            commitments: BTreeMap::new(),
            keys: BTreeMap::new(),
        };
        session.refresh(pool).await?;
        Ok(session)
    }

    /// Reads and checks the roster entries appended since, and unwraps the key of the epoch in
    /// force.
    pub(super) async fn refresh(&mut self, pool: &SqlitePool) -> Result<()> {
        let after = i64::try_from(self.state.seq).map_err(|_| Error::RosterChain)?;
        let fresh = self.store.roster_after(after).await?;
        let mut state = self.state.clone();
        for entry in &fresh {
            state = apply_entry(Some(&state), entry)?;
        }
        add_roster_entries(pool, &fresh).await?;
        self.state = state;
        self.entries.extend(fresh);
        if !self
            .state
            .members
            .contains_key(&hex::encode(self.device.did))
        {
            return Err(EngineError::Removed);
        }
        self.signing_keys = signing_keys(&self.entries)?;
        for epoch in self.entries.iter().filter_map(|e| e.epoch.as_ref()) {
            self.commitments.insert(epoch.n, decode_b64(&epoch.kc)?);
        }
        if !self.keys.contains_key(&self.state.epoch) {
            self.unwrap_current().await?;
        }
        Ok(())
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

    /// The links this session pushes, applies and keeps; at first only the link Default joined.
    pub fn reading(&self) -> &Reading {
        &self.reading
    }

    pub fn set_reading(&mut self, reading: Reading) {
        self.reading = reading;
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

    /// Uploads what changed in `exported`, the running profile's data, since the last upload.
    pub async fn push(
        &mut self,
        pool: &SqlitePool,
        exported: Vec<OutgoingCollection>,
    ) -> Result<usize> {
        let Some(link) = self.reading.active.clone() else {
            return Ok(0);
        };
        let outgoing = outgoing_batches(pool, exported, &self.state.head, &link, now_ms()).await?;
        for batch in &outgoing.batches {
            self.write(pool, ObjectType::Changes, &batch.content)
                .await?;
        }
        mark_sent(pool, &outgoing).await?;
        let bytes = outgoing.batches.iter().map(|b| b.content.len()).sum();
        note_merged(pool, &link, bytes).await?;
        Ok(outgoing.batches.len())
    }

    /// Reads other devices' new objects in stream order, checking each one. Nothing is applied:
    /// the caller applies [`Pulled::batches`] and then calls [`Session::finish`].
    pub async fn pull(&mut self, pool: &SqlitePool) -> Result<Pulled> {
        let reading = self.reading.clone();
        self.read_new(pool, Some(&reading)).await
    }

    /// Links a restored device's profile `own` (spec/protocol.md, Recovery): to the link other
    /// devices' batches name, or to its own id when they name none. False while the logs can't be
    /// read to the end yet; nothing may be pushed or pulled until this returns true.
    pub async fn adopt_link(&mut self, pool: &SqlitePool, own: &str) -> Result<bool> {
        if !self.record.link.is_empty() {
            return Ok(true);
        }
        let read = self.read_new(pool, None).await?;
        if read.stalled {
            return Ok(false);
        }
        let link = read
            .links
            .into_iter()
            .flatten()
            .next()
            .unwrap_or_else(|| own.to_owned());
        link_profile(pool, own, &link).await?;
        self.record.link.clone_from(&link);
        save_group(pool, &self.record).await?;
        self.reading.active = Some(link);
        Ok(true)
    }

    /// The batches `reading` asks for, or every batch when it is `None`.
    async fn read_new(&mut self, pool: &SqlitePool, reading: Option<&Reading>) -> Result<Pulled> {
        let me = hex::encode(self.device.did);
        let mut pulled = Pulled {
            positions: streams(pool).await?,
            cursor: self.record.cursor,
            ..Pulled::default()
        };
        let links = reading.map(|r| r.links().map(str::to_owned).collect::<BTreeSet<_>>());
        if pulled.positions.is_empty()
            && pulled.cursor == 0
            && let Some(start) = self.bootstrap(links.as_ref()).await?
        {
            for snapshot in start.snapshots {
                pulled.start_from(&me, snapshot, reading);
            }
            pulled.positions = start.positions;
        }
        let mut floors = floors(pool).await?;
        floors.extend(pulled.floors.clone());
        loop {
            let cursor = u64::try_from(pulled.cursor).unwrap_or(0);
            let read: BTreeMap<String, u64> = pulled
                .positions
                .iter()
                .map(|(did, position)| (did.clone(), position.seq))
                .collect();
            let (changes, next) = self.store.new_objects(cursor, &read).await?;
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
                            if !matches!(content, Content::Ack(_)) {
                                pulled.consumed += 1;
                            }
                            match content {
                                Content::Batch(batch) => {
                                    pulled.links.push(batch.link.clone());
                                    pulled.take(did, seq, batch, reading, &floors);
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
        Ok(verify_logged(
            bytes,
            &self.group,
            &self.signing_keys,
            did,
            seq,
        )?)
    }

    pub(super) fn signing_keys(&self) -> &BTreeMap<String, [u8; 32]> {
        &self.signing_keys
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

    /// Keeps the batches of profiles that aren't running, saves how far reading got, after the
    /// caller applied the running profile's, and acknowledges it.
    pub async fn finish(&mut self, pool: &SqlitePool, pulled: Pulled) -> Result<()> {
        keep(pool, &pulled.kept).await?;
        save_floors(pool, &pulled.floors).await?;
        save_streams(pool, &pulled.positions, pulled.cursor).await?;
        if let Some(link) = &self.reading.active {
            let merged = pulled.batches.values().flatten().map(|b| b.size).sum();
            note_merged(pool, link, merged).await?;
        }
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
