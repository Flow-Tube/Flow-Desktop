//! One sync with a store: verify the roster, push this device's changes, pull everyone else's.
//! It holds no secrets beyond the session: epoch keys are unwrapped from the store each time.

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sqlx::SqlitePool;

use super::batches::{IncomingBatch, batch_content, mark_sent, outgoing_batches, parse_batch};
use super::bootstrap::Snapshot;
use super::envelope::{
    Header, ObjectType, ParsedObject, StreamPosition, next_in_stream, open_object, parse_object,
    seal_object, verify_object,
};
use super::epoch::{Purpose, check_epoch_key, open_chain, purpose_key};
use super::forks::{Settlement, settle_roster};
use super::gc::{Ack, Logged, VersionVector, record_ack, record_links, record_manifest};
use super::kept::{Kept, keep};
use super::keys::MemberSecrets;
use super::paths::{kc_name, log_path, parse_log_path};
use super::payload::{decode_payload, encode_payload};
use super::profile_links::{Reading, forget_link, link_profile};
use super::profile_names::{self, PROFILES};
use super::roster::{Entry, Op, Role, RosterState, entry_hash, replay_roster};
use super::server::StoreError;
use super::snapshot::{Manifest, PROFILES_KEY, note_merged};
use super::state::{
    Floors, GroupRecord, StoreKind, add_roster_entries, floors, load_group, replace_roster,
    roster_entries, roster_pins, save_floors, save_group, save_streams, streams,
};
use super::store::Store;
use super::store_login::{decode_login, encode_login, note_login, note_login_sent, note_removal};
use super::webdav::WebDavLogin;
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
    #[error("the roster that leaves this device out replaces entries it had applied")]
    RemovalUnconfirmed,
    #[error("two sides of the roster removed each other")]
    Contested,
    #[error("the store no longer shows a roster entry this device applied")]
    RosterRolledBack,
    #[error("the store changed a roster entry this device applied")]
    RosterRewritten,
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
    #[error("a device in a group keeps at least one profile synced")]
    LastProfile,
    #[error("that profile already syncs on this device")]
    ProfileTaken,
    #[error("only the running profile can start syncing")]
    NotRunning,
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
            Self::Protocol(Error::RosterGroup) => "linkedGroupOutdated",
            Self::Store(_) | Self::Protocol(_) | Self::Unexpected => "linkedProtocol",
            Self::Local(error) => error.kind(),
            Self::NotLinked => "linkedNotLinked",
            Self::Removed => "linkedRemoved",
            Self::RemovalUnconfirmed => "linkedRemovalUnconfirmed",
            Self::Contested => "linkedContested",
            Self::RosterRolledBack => "linkedRolledBack",
            Self::RosterRewritten => "linkedRosterChanged",
            Self::Declined => "linkedDeclined",
            Self::TimedOut => "linkedTimedOut",
            Self::WrongWords => "linkedWrongWords",
            Self::RecoveryUsed => "linkedRecoveryUsed",
            Self::AlreadyLinked => "linkedAlreadyLinked",
            Self::LanUnreachable => "linkedLanUnreachable",
            Self::OtherFolder => "linkedOtherFolder",
            Self::LastProfile => "linkedLastProfile",
            Self::ProfileTaken => "linkedProfileTaken",
            Self::NotRunning => "linkedProfileNotRunning",
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
    /// `profiles` batches, merged by [`Session::finish`].
    pub profiles: Vec<IncomingBatch>,
    /// Where the snapshots started from stop including each link's batches.
    floors: Floors,
    positions: BTreeMap<String, StreamPosition>,
    cursor: i64,
    /// The latest store login read, for the caller to keep as pending.
    pub login: Option<WebDavLogin>,
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
            self.profiles.extend(snapshot.batches);
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
        let Some(link) = batch.link.clone() else {
            self.profiles.push(batch);
            return;
        };
        let Some(reading) = reading else {
            self.batches.entry(did).or_default().push(batch);
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
    /// A store login this device may take; `None` when the read rule says to ignore it.
    Login(Option<WebDavLogin>),
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
    /// The commitments of entries that lost a fork and stand, by the epoch they start.
    standing: BTreeMap<u32, Vec<Vec<u8>>>,
    /// The keys of those entries unwrapped so far, by commitment.
    standing_keys: BTreeMap<Vec<u8>, Vec<u8>>,
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

/// `None` when reading an object fails a protocol check: that object is discarded, which stops
/// only its sender's log (spec/store.md, Untrusted input), not the run.
pub(super) fn contained<T>(read: Result<T>) -> Result<Option<T>> {
    match read {
        Ok(read) => Ok(Some(read)),
        Err(EngineError::Protocol(error)) => {
            if error != Error::Gap {
                tracing::warn!(target: "flow::sync2", kind = error.code(), "discarded an object");
            }
            Ok(None)
        }
        Err(error) => Err(error),
    }
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
        let mut session = Self::on_applied(pool, store, device).await?;
        session.refresh(pool).await?;
        Ok(session)
    }

    /// Like [`Session::open_as_peer`], but while this device lacks its wrap of the settled chain's
    /// epoch it stays on the chain it had: a LAN session is how it gets that wrap.
    pub async fn open_for_lan(
        pool: &SqlitePool,
        store: S,
        device: &'a MemberSecrets,
    ) -> Result<Self> {
        let mut session = Self::on_applied(pool, store, device).await?;
        match session.refresh(pool).await {
            Err(EngineError::Protocol(Error::KeyCommitment)) => session.prepare_names().await?,
            other => other?,
        }
        Ok(session)
    }

    /// The chain this device has applied, without asking the store whether it still stands.
    pub async fn on_applied(
        pool: &SqlitePool,
        store: S,
        device: &'a MemberSecrets,
    ) -> Result<Self> {
        let record = load_group(pool).await?.ok_or(EngineError::NotLinked)?;
        let group = array(&hex::decode(&record.group_id).map_err(|_| Error::Group)?);
        let entries = roster_entries(pool).await?;
        Ok(Self {
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
            standing: BTreeMap::new(),
            standing_keys: BTreeMap::new(),
        })
    }

    /// Settles the roster from the store's answer (spec/protocol.md, Forks), and unwraps the key of
    /// the epoch in force.
    pub(super) async fn refresh(&mut self, pool: &SqlitePool) -> Result<()> {
        let pins = roster_pins(pool).await?;
        self.store.use_pins(&pins);
        let view = self.store.roster_view().await?;
        let settled = settle_roster(
            &self.record.group_id,
            &self.entries,
            &view,
            &pins,
            self.store.is_linear(),
        )?;
        let (chain, standing, extends_applied) = match settled {
            Settlement::Apply {
                chain,
                standing,
                extends_applied,
            } => (chain, standing, extends_applied),
            Settlement::Contested { .. } => return Err(EngineError::Contested),
            Settlement::Rollback => return Err(EngineError::RosterRolledBack),
            Settlement::Rewritten => return Err(EngineError::RosterRewritten),
        };
        let state = replay_roster(&chain)?;
        let member = state.members.contains_key(&hex::encode(self.device.did));
        if !extends_applied && !member {
            return Err(EngineError::RemovalUnconfirmed);
        }
        // Nothing is saved until the new chain's key opens: without it the device stays where it was.
        let current = match self.keys.get(&state.epoch) {
            _ if !member => None,
            Some(key) if extends_applied => Some(key.clone()),
            _ => Some(
                self.unwrap_wrap(state.epoch, &decode_b64(&state.kc)?)
                    .await?,
            ),
        };
        if extends_applied {
            add_roster_entries(pool, &chain[self.entries.len()..]).await?;
        } else {
            replace_roster(pool, &chain).await?;
            self.keys.clear();
            self.commitments.clear();
        }
        if self.record.kind == StoreKind::WebDav {
            let known: BTreeSet<String> = self.entries.iter().map(entry_hash).collect();
            let removal = chain
                .iter()
                .filter(|e| e.op == Op::Remove && !known.contains(&entry_hash(e)))
                .filter_map(|e| e.epoch.as_ref())
                .next_back();
            if let Some(epoch) = removal {
                note_removal(pool, epoch.n).await?;
            }
        }
        self.state = state;
        self.entries = chain;
        let Some(current) = current else {
            return Err(EngineError::Removed);
        };
        self.index_entries()?;
        self.keys.insert(self.state.epoch, current);
        self.standing.clear();
        for epoch in standing.iter().filter_map(|e| e.epoch.as_ref()) {
            self.standing
                .entry(epoch.n)
                .or_default()
                .push(decode_b64(&epoch.kc)?);
        }
        Ok(())
    }

    /// Readies a session opened with [`Session::on_applied`] to read device names, as far as the
    /// store still has this device's wrap.
    pub async fn prepare_names(&mut self) -> Result<()> {
        self.index_entries()?;
        self.unwrap_current().await
    }

    /// Finds the signing keys and epoch commitments in the entries applied.
    pub(super) fn index_entries(&mut self) -> Result<()> {
        self.signing_keys = signing_keys(&self.entries)?;
        for epoch in self.entries.iter().filter_map(|e| e.epoch.as_ref()) {
            self.commitments.insert(epoch.n, decode_b64(&epoch.kc)?);
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
        let commitment = self.commitments.get(&epoch).ok_or(Error::KeyCommitment)?;
        let key = self.unwrap_wrap(epoch, commitment).await?;
        self.keys.insert(epoch, key);
        Ok(())
    }

    /// This device's key of the entry that starts `epoch` with `commitment`.
    async fn unwrap_wrap(&self, epoch: u32, commitment: &[u8]) -> Result<Vec<u8>> {
        let did = self.device.did;
        let wrap = self
            .store
            .key(epoch, &kc_name(commitment), &hex::encode(did))
            .await?
            .ok_or(Error::KeyCommitment)?;
        let key = unwrap_epoch_key(&self.device.kem_secret, &self.group, epoch, &did, &wrap)?;
        check_epoch_key(&key, &self.group, epoch, commitment)?;
        Ok(key)
    }

    /// The key of `epoch`, walking the history chain back from the newest key this device holds.
    pub async fn epoch_key(&mut self, epoch: u32) -> Result<Vec<u8>> {
        while !self.keys.contains_key(&epoch) {
            let (&known, key) = self.keys.iter().next().ok_or(Error::KeyCommitment)?;
            if known <= epoch {
                return Err(Error::KeyCommitment.into());
            }
            let known_commitment = self.commitments.get(&known).ok_or(Error::KeyCommitment)?;
            let chain = self
                .store
                .key(known, &kc_name(known_commitment), "chain")
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

    /// Opens something sealed under `epoch` with the chain's key, or else with the key of an entry
    /// that lost that epoch and stands (spec/store.md, Reading an envelope).
    pub(super) async fn open_under<T>(
        &mut self,
        epoch: u32,
        open: impl Fn(&[u8]) -> std::result::Result<T, Error>,
    ) -> Result<T> {
        let failure = match self.epoch_key(epoch).await {
            Ok(key) => match open(&key) {
                Ok(opened) => return Ok(opened),
                Err(error) => error.into(),
            },
            Err(error @ EngineError::Protocol(_)) => error,
            Err(error) => return Err(error),
        };
        for commitment in self.standing.get(&epoch).cloned().unwrap_or_default() {
            let key = match self.standing_keys.get(&commitment) {
                Some(key) => key.clone(),
                None => match self.unwrap_wrap(epoch, &commitment).await {
                    Ok(key) => key,
                    Err(EngineError::Protocol(_)) => continue,
                    Err(error) => return Err(error),
                },
            };
            self.standing_keys.insert(commitment, key.clone());
            if let Ok(opened) = open(&key) {
                return Ok(opened);
            }
        }
        Err(failure)
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

    /// Writes `login` to this device's log (spec/protocol.md, Replacing a store's login). The
    /// session was just opened, so the roster was re-read and isn't contested.
    pub async fn write_login(&mut self, pool: &SqlitePool, login: &WebDavLogin) -> Result<()> {
        self.write(pool, ObjectType::Login, &encode_login(login))
            .await?;
        note_login_sent(pool, &hex::encode(self.device.did), self.record.own_seq).await?;
        note_login(pool, self.state.epoch).await
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

    /// Uploads the `profiles` records this device changed since it last sent them.
    pub async fn push_profiles(&mut self, pool: &SqlitePool) -> Result<()> {
        let unsent = profile_names::unsent(pool).await?;
        if unsent.is_empty() {
            return Ok(());
        }
        let lines: Vec<Vec<u8>> = unsent.iter().map(to_canonical_json).collect();
        let content = batch_content(PROFILES, &self.state.head, None, &lines);
        self.write(pool, ObjectType::Changes, &content).await?;
        profile_names::mark_sent(pool, &unsent).await?;
        note_merged(pool, PROFILES_KEY, content.len()).await
    }

    /// Reads other devices' new objects in stream order, checking each one. Nothing is applied:
    /// the caller applies [`Pulled::batches`] and then calls [`Session::finish`].
    pub async fn pull(&mut self, pool: &SqlitePool) -> Result<Pulled> {
        let reading = self.reading.clone();
        self.read_new(pool, Some(&reading)).await
    }

    /// Links a restored device's profile `own` (spec/protocol.md, Recovery): to the link other
    /// devices' batches name, or to its own id when they name none. False while the logs can't be
    /// read to the end yet, or while the user has to choose among several links (whose names it
    /// keeps); nothing may be pushed or pulled until this returns true.
    pub async fn adopt_link(&mut self, pool: &SqlitePool, own: &str) -> Result<bool> {
        if !self.record.link.is_empty() {
            return Ok(true);
        }
        let read = self.read_new(pool, None).await?;
        if read.stalled {
            return Ok(false);
        }
        let deleted = profile_names::merge(pool, &profile_names::parse(&read.profiles)).await?;
        let mut links: Vec<String> = Vec::new();
        for link in read.links.iter().flatten() {
            if !links.contains(link) && !deleted.contains(link) {
                links.push(link.clone());
            }
        }
        if links.len() > 1 {
            record_links(pool, &read.links).await?;
            return Ok(false);
        }
        let link = links.pop().unwrap_or_else(|| own.to_owned());
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
                                Content::Login(login) => {
                                    pulled.login = login.or(pulled.login.take());
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
            let advanced = next > cursor
                || pulled
                    .positions
                    .iter()
                    .any(|(did, position)| read.get(did) != Some(&position.seq));
            if !advanced {
                return Ok(pulled);
            }
            pulled.cursor = i64::try_from(next).map_err(|_| Error::Length)?;
        }
    }

    /// One log object, checked in the order of spec/store.md. `None` when an earlier object of
    /// this sender is still missing, or when this one is discarded: either stops reading this
    /// sender's log here, and the other senders are still read.
    pub(super) async fn read_object(
        &mut self,
        path: &str,
        did: &str,
        seq: u64,
        last: Option<&StreamPosition>,
    ) -> Result<Option<(StreamPosition, Content)>> {
        let Some(bytes) = self.store.get_object(path).await? else {
            return Ok(None);
        };
        let read = async {
            let object = self.verified(&bytes, did, seq)?;
            let position = next_in_stream(last, &object)?;
            Ok((position, self.open_content(&object).await?))
        };
        contained(read.await)
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

    /// A store login, under its own rule (spec/store.md, Store logins): only under the chain's key
    /// of the epoch in force, from a current device, and never a reason to stop reading a log.
    fn login_in(&self, object: &ParsedObject<'_>) -> Option<WebDavLogin> {
        let epoch = object.header.epoch;
        let sender = self.state.members.get(&hex::encode(object.header.sender))?;
        if self.record.kind != StoreKind::WebDav
            || epoch != self.state.epoch
            || sender.role != Role::Device
        {
            return None;
        }
        let key = purpose_key(self.current_key(), &self.group, epoch, Purpose::Store);
        decode_login(&decode_payload(&open_object(object, &key).ok()?).ok()?)
    }

    pub(super) async fn open_content(&mut self, object: &ParsedObject<'_>) -> Result<Content> {
        if object.header.object_type == ObjectType::Login {
            return Ok(Content::Login(self.login_in(object)));
        }
        let (epoch, group) = (object.header.epoch, self.group);
        let purpose = object.header.object_type.purpose();
        let opened = self
            .open_under(epoch, |key| {
                open_object(object, &purpose_key(key, &group, epoch, purpose))
            })
            .await?;
        let content = decode_payload(&opened)?;
        Ok(match object.header.object_type {
            ObjectType::Changes => Content::Batch(parse_batch(&content)?),
            ObjectType::Snapshot => {
                Content::Snapshot(serde_json::from_slice(&content).map_err(|_| Error::Payload)?)
            }
            ObjectType::Ack => {
                Content::Ack(serde_json::from_slice(&content).map_err(|_| Error::Payload)?)
            }
            ObjectType::Live | ObjectType::Login => return Err(Error::Suite.into()),
        })
    }

    /// Keeps the batches of profiles that aren't running, saves how far reading got, after the
    /// caller applied the running profile's, and acknowledges it.
    pub async fn finish(&mut self, pool: &SqlitePool, pulled: Pulled) -> Result<()> {
        keep(pool, &pulled.kept).await?;
        save_floors(pool, &pulled.floors).await?;
        if pulled.login.is_some() {
            note_login(pool, self.state.epoch).await?;
        }
        let records = profile_names::parse(&pulled.profiles);
        for link in profile_names::merge(pool, &records).await? {
            forget_link(pool, &link).await?;
        }
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
