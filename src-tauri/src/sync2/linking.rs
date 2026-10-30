//! Pairing (spec/protocol.md, Pairing): one device shows a code and the other answers it, both
//! users confirm the six digits, and the member adds the new device to the roster. Messages travel
//! through the store's mailbox or over the LAN ([`super::pipe`]).

use std::collections::BTreeMap;
use std::future::Future;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::codes::{Code, Offer, b64_key};
use super::curve::{agreement_public_key, sign};
use super::engine::{EngineError, Result, Session};
use super::entries::{Draft, build_entry, member_subject};
use super::epoch::check_epoch_key;
use super::held::HeldStore;
use super::keys::{MemberSecrets, member_id};
use super::lan_peers::service_port;
use super::mailbox::Mailbox;
use super::meta::seal_device_meta;
use super::pairing::{pairing_aad, pairing_keys, pairing_slot};
use super::payload::{decode_payload, encode_payload};
use super::pipe::{AnyPipe, KEY_SIZE, MailboxPipe, Pipe, dial};
use super::roster::{
    Entry, Op, Role, RosterState, Subject, apply_entry, replay_roster, signing_bytes,
};
use super::sealed::{open, random_bytes, seal};
use super::state::{GroupRecord, add_roster_entries, save_group};
use super::store::Store;
use super::wrap::{unwrap_epoch_key, wrap_epoch_key};
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceMeta {
    pub app: String,
    pub name: String,
    pub platform: String,
}

/// Where the group lives, as `welcome` names it: `{"k":"server","u":url,"i":instance}`,
/// `{"k":"webdav","u":url,"n":user,"w":password}` or `{"k":"lan"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "lowercase", deny_unknown_fields)]
pub enum WelcomeStore {
    Server { u: String, i: String },
    WebDav { u: String, n: String, w: String },
    Lan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Message {
    Join {
        sig: String,
        kem: String,
        meta: DeviceMeta,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        p: Option<u16>,
    },
    Entry {
        entry: Box<Entry>,
    },
    Accept {
        sig: String,
    },
    Welcome {
        group: String,
        head: String,
        seq: u64,
        link: String,
        store: WelcomeStore,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        entries: Option<Vec<Entry>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        wrap: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        p: Option<u16>,
    },
    Done,
}

/// The other device of a pairing over the LAN, and where its LAN service listens, so the two can
/// meet again where mDNS doesn't reach (spec/protocol.md, Messages).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reach {
    pub did: String,
    pub address: (String, u16),
}

/// Sealed pairing messages over a pipe, numbered from 0 in each direction.
struct Channel<P> {
    pipe: P,
    token: [u8; 16],
    /// The key this side seals with, then the key it opens with.
    keys: (Vec<u8>, Vec<u8>),
    sent: u64,
    received: u64,
}

impl<P: Pipe> Channel<P> {
    /// The side that showed `offer`, once the scanner's key arrived. Returns the six digits too.
    fn shower(pipe: P, offer: &Offer, scanner: &[u8; KEY_SIZE]) -> Result<(Self, String)> {
        let keys = pairing_keys(&offer.secret, scanner, &offer.token, &offer.public, scanner)?;
        let channel = Self {
            pipe,
            token: offer.token,
            keys: (keys.shower_key, keys.scanner_key),
            sent: 0,
            received: 0,
        };
        Ok((channel, keys.sas))
    }

    /// The side that read `code`: sends its key first.
    async fn scanner(mut pipe: P, code: &Code) -> Result<(Self, String)> {
        let (token, shower) = (code.token()?, code.shower_key()?);
        let secret = random_bytes::<KEY_SIZE>();
        let public = agreement_public_key(&secret);
        let keys = pairing_keys(&secret, &shower, &token, &shower, &public)?;
        pipe.send_key(public).await?;
        let channel = Self {
            pipe,
            token,
            keys: (keys.scanner_key, keys.shower_key),
            sent: 0,
            received: 0,
        };
        Ok((channel, keys.sas))
    }

    /// The port of this device's LAN service, sent only over the LAN.
    fn own_port(&self) -> Option<u16> {
        self.pipe.peer().and(service_port())
    }

    /// Where `did` can be reached, from the `p` it sent over the LAN.
    fn reach(&self, did: String, p: Option<u16>) -> Option<Reach> {
        let address = (self.pipe.peer()?, p?);
        Some(Reach { did, address })
    }

    async fn send(&mut self, message: &Message) -> Result<()> {
        let payload = encode_payload(&to_canonical_json(message))?;
        let sealed = seal(&self.keys.0, &pairing_aad(&self.token, self.sent), &payload);
        self.pipe.send(sealed).await?;
        self.sent += 1;
        Ok(())
    }

    async fn receive(&mut self) -> Result<Message> {
        let sealed = self.pipe.receive().await?;
        let payload = open(
            &self.keys.1,
            &pairing_aad(&self.token, self.received),
            &sealed,
        )?;
        self.received += 1;
        serde_json::from_slice(&decode_payload(&payload)?).map_err(|_| EngineError::Unexpected)
    }
}

/// The member's side, on a code it shows: waits for the scanner on the mailbox and, when the code
/// lists LAN addresses, on the LAN too. Returns the new device's id, and where it can be reached
/// when it paired over the LAN.
pub async fn add_device<S, F>(
    session: &Session<'_, S>,
    mut offer: Offer,
    device: &MemberSecrets,
    store: WelcomeStore,
    confirm: impl FnOnce(String) -> F,
) -> Result<(String, Option<Reach>)>
where
    S: Store + Mailbox + Sync,
    F: Future<Output = bool>,
{
    let slot = hex::encode(pairing_slot(&offer.token));
    session.store().open_slot(&slot).await?;
    let mut mailbox = MailboxPipe::new(session.store(), slot.clone(), true);
    let first = match offer.listening.take() {
        Some(listening) => tokio::select! {
            key = mailbox.receive_key() => key.map(|key| (None, key)),
            lan = listening.accept() => lan.map(|(pipe, key)| (Some(pipe), key)),
        },
        None => mailbox.receive_key().await.map(|key| (None, key)),
    };
    let result = match first {
        Ok((lan, key)) => {
            let pipe = lan.map_or(AnyPipe::Mailbox(mailbox), |lan| AnyPipe::Lan(Box::new(lan)));
            match Channel::shower(pipe, &offer, &key) {
                Ok((channel, sas)) => {
                    member_side(session, channel, sas, device, store, confirm).await
                }
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    };
    if let Err(error) = session.store().close_slot(&slot).await {
        tracing::warn!(%error, "could not close the pairing slot; it expires on its own");
    }
    result
}

/// The member's side, on a new device's code: reaches it over the LAN.
pub async fn add_scanned<S, F>(
    session: &Session<'_, S>,
    code: &Code,
    device: &MemberSecrets,
    store: WelcomeStore,
    confirm: impl FnOnce(String) -> F,
) -> Result<(String, Option<Reach>)>
where
    S: Store,
    F: Future<Output = bool>,
{
    let Code::New { lan, .. } = code else {
        return Err(EngineError::Unexpected);
    };
    let pipe = dial(lan).await.ok_or(EngineError::LanUnreachable)?;
    let (channel, sas) = Channel::scanner(pipe, code).await?;
    member_side(session, channel, sas, device, store, confirm).await
}

/// `store` is where the group lives, as the welcome names it to the new device.
async fn member_side<S, P, F>(
    session: &Session<'_, S>,
    mut channel: Channel<P>,
    sas: String,
    device: &MemberSecrets,
    store: WelcomeStore,
    confirm: impl FnOnce(String) -> F,
) -> Result<(String, Option<Reach>)>
where
    S: Store,
    P: Pipe,
    F: Future<Output = bool>,
{
    let Message::Join { sig, kem, meta, p } = channel.receive().await? else {
        return Err(EngineError::Unexpected);
    };
    if !confirm(sas).await {
        return Err(EngineError::Declined);
    }

    let (sig_public, kem_public) = (b64_key(&sig)?, b64_key(&kem)?);
    let did = member_id(&sig_public, &kem_public);
    let state = session.roster();
    let group = session.group();
    let sealed_meta = seal_device_meta(
        session.current_key(),
        group,
        state.epoch,
        state.seq + 1,
        &did,
        &to_canonical_json(&meta),
    )?;
    let draft = Draft {
        op: Op::Add,
        signer: hex::encode(device.did),
        add: Some(vec![member_subject(&sig_public, &kem_public, Role::Device)]),
        remove: None,
        epoch: None,
        meta: Some(BTreeMap::from([(
            hex::encode(did),
            URL_SAFE_NO_PAD.encode(sealed_meta),
        )])),
    };
    let mut entry = build_entry(group, Some(state), draft, &[device]);
    channel
        .send(&Message::Entry {
            entry: Box::new(entry.clone()),
        })
        .await?;

    let Message::Accept { sig } = channel.receive().await? else {
        return Err(EngineError::Unexpected);
    };
    entry.sigs.insert(hex::encode(did), sig);
    let after = apply_entry(Some(state), &entry)?;
    let wrap = URL_SAFE_NO_PAD.encode(wrap_epoch_key(
        &kem_public,
        group,
        state.epoch,
        &did,
        session.current_key(),
    )?);
    let wraps = BTreeMap::from([(hex::encode(did), wrap.clone())]);
    if session
        .store()
        .append_roster(&state.head, &entry, &wraps, None)
        .await?
        != super::server::Appended::Done
    {
        return Err(Error::RosterChain.into());
    }

    let record = session.record();
    // A LAN group has no store to read from, so the new device gets the roster and its wrap here.
    let (entries, wrap) = if store == WelcomeStore::Lan {
        (Some(session.store().roster_after(-1).await?), Some(wrap))
    } else {
        (None, None)
    };
    let welcome = Message::Welcome {
        group: record.group_id.clone(),
        head: after.head,
        seq: after.seq,
        link: record.link.clone(),
        store,
        entries,
        wrap,
        p: channel.own_port(),
    };
    channel.send(&welcome).await?;
    let done = channel.receive().await?;
    channel.pipe.close().await;
    let did = hex::encode(did);
    match done {
        Message::Done => Ok((did.clone(), channel.reach(did, p))),
        _ => Err(EngineError::Unexpected),
    }
}

/// What the member sent once the new device was added: the group, the roster head to pin, the
/// profile link and the store.
pub struct Welcome {
    pub group: String,
    pub head: String,
    pub seq: u64,
    pub link: String,
    pub store: WelcomeStore,
    /// For a LAN group: the roster up to `head`, and this device's wrap of the current epoch.
    pub entries: Option<Vec<Entry>>,
    pub wrap: Option<String>,
}

/// A new device that was welcomed and has yet to check the roster and say it is done.
pub struct Welcomed<P> {
    channel: Channel<P>,
    me: Subject,
    pub welcome: Welcome,
    /// Where the member's LAN service listens, when it said over the LAN.
    pub reach: Option<Reach>,
}

async fn new_side<P, F>(
    mut channel: Channel<P>,
    sas: String,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<Welcomed<P>>
where
    P: Pipe,
    F: Future<Output = bool>,
{
    let join = Message::Join {
        sig: URL_SAFE_NO_PAD.encode(device.sig_public),
        kem: URL_SAFE_NO_PAD.encode(device.kem_public),
        meta,
        p: channel.own_port(),
    };
    channel.send(&join).await?;
    if !confirm(sas).await {
        return Err(EngineError::Declined);
    }

    let Message::Entry { entry } = channel.receive().await? else {
        return Err(EngineError::Unexpected);
    };
    let me = member_subject(&device.sig_public, &device.kem_public, Role::Device);
    if entry.op != Op::Add || entry.add.as_deref() != Some(std::slice::from_ref(&me)) {
        return Err(EngineError::Unexpected);
    }
    channel
        .send(&Message::Accept {
            sig: URL_SAFE_NO_PAD.encode(sign(&device.sig_seed, &signing_bytes(&entry))),
        })
        .await?;

    let Message::Welcome {
        group,
        head,
        seq,
        link,
        store,
        entries,
        wrap,
        p,
    } = channel.receive().await?
    else {
        return Err(EngineError::Unexpected);
    };
    if group != entry.group {
        return Err(EngineError::Unexpected);
    }
    Ok(Welcomed {
        reach: channel.reach(entry.signer.clone(), p),
        channel,
        me,
        welcome: Welcome {
            group,
            head,
            seq,
            link,
            store,
            entries,
            wrap,
        },
    })
}

/// Checks that `roster` reaches the head the member named and lists this device.
fn check_pinned(roster: &[Entry], welcome: &Welcome, me: &Subject) -> Result<RosterState> {
    let pinned = roster
        .iter()
        .position(|e| e.seq == welcome.seq)
        .map(|end| replay_roster(&roster[..=end]))
        .transpose()?;
    let state = replay_roster(roster)?;
    if pinned.is_none_or(|pinned| pinned.head != welcome.head)
        || !state.members.contains_key(&me.did)
    {
        return Err(Error::RosterChain.into());
    }
    Ok(state)
}

async fn say_done<P: Pipe>(mut channel: Channel<P>) -> Result<()> {
    channel.send(&Message::Done).await?;
    channel.pipe.close().await;
    Ok(())
}

/// Saves a server or `WebDAV` group once the roster on `store` verifies up to the head the member
/// named.
pub async fn finish_join<S: Store, P: Pipe>(
    pool: &SqlitePool,
    store: &S,
    welcomed: Welcomed<P>,
) -> Result<()> {
    let Welcomed {
        channel,
        me,
        welcome,
        ..
    } = welcomed;
    let roster = store.roster_after(-1).await?;
    check_pinned(&roster, &welcome, &me)?;
    let record = match welcome.store {
        WelcomeStore::Server { u, i } => GroupRecord::new(welcome.group, u, Some(i), welcome.link),
        WelcomeStore::WebDav { u, .. } => GroupRecord::on_webdav(welcome.group, u, welcome.link),
        WelcomeStore::Lan => return Err(EngineError::Unexpected),
    };
    add_roster_entries(pool, &roster).await?;
    save_group(pool, &record).await?;
    say_done(channel).await
}

/// Saves a LAN group from what `welcome` carried: the roster, checked from genesis to the head,
/// and this device's wrap, checked against the epoch commitment. Its objects arrive when the
/// devices next meet on the LAN.
pub async fn finish_lan_join<P: Pipe>(
    pool: &SqlitePool,
    device: &MemberSecrets,
    welcomed: Welcomed<P>,
) -> Result<()> {
    let Welcomed {
        channel,
        me,
        welcome,
        ..
    } = welcomed;
    let (WelcomeStore::Lan, Some(roster), Some(wrap)) =
        (&welcome.store, &welcome.entries, &welcome.wrap)
    else {
        return Err(EngineError::Unexpected);
    };
    let state = check_pinned(roster, &welcome, &me)?;
    let group: [u8; 16] = array(&hex::decode(&welcome.group).map_err(|_| Error::Group)?);
    let wrap = URL_SAFE_NO_PAD
        .decode(wrap)
        .map_err(|_| EngineError::Unexpected)?;
    let commitment = URL_SAFE_NO_PAD
        .decode(&state.kc)
        .map_err(|_| Error::RosterFormat)?;
    let key = unwrap_epoch_key(&device.kem_secret, &group, state.epoch, &device.did, &wrap)?;
    check_epoch_key(&key, &group, state.epoch, &commitment)?;

    let held = HeldStore::new(pool.clone());
    for entry in roster {
        held.hold_entry(entry).await?;
    }
    held.hold_key(state.epoch, &me.did, &wrap).await?;
    add_roster_entries(pool, roster).await?;
    save_group(pool, &GroupRecord::on_lan(welcome.group, welcome.link)).await?;
    say_done(channel).await
}

/// The new device's side, on a member's code: tries the LAN addresses it lists, then the mailbox
/// of the store the code names, and saves the group once accepted. Returns where the member can be
/// reached when they paired over the LAN.
pub async fn join<S, F>(
    pool: &SqlitePool,
    store: &S,
    code: &Code,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<Option<Reach>>
where
    S: Store + Mailbox + Sync,
    F: Future<Output = bool>,
{
    let Code::Member {
        store: named, lan, ..
    } = code
    else {
        return Err(EngineError::Unexpected);
    };
    let pipe = if let Some(pipe) = dial(lan).await {
        AnyPipe::Lan(Box::new(pipe))
    } else {
        let slot = hex::encode(pairing_slot(&code.token()?));
        AnyPipe::Mailbox(MailboxPipe::new(store, slot, false))
    };
    let (channel, sas) = Channel::scanner(pipe, code).await?;
    let welcomed = new_side(channel, sas, device, meta, confirm).await?;
    let same = match &welcomed.welcome.store {
        WelcomeStore::Server { u, .. } => named.k == "server" && named.u.as_ref() == Some(u),
        WelcomeStore::WebDav { u, .. } => named.k == "webdav" && named.u.as_ref() == Some(u),
        WelcomeStore::Lan => false,
    };
    if !same {
        return Err(EngineError::Unexpected);
    }
    let reach = welcomed.reach.clone();
    finish_join(pool, store, welcomed).await?;
    Ok(reach)
}

/// The new device's side, on the code of a member it can reach only over the LAN: pairs there.
/// The caller then calls [`finish_lan_join`], or [`finish_join`] with the welcome's `WebDAV`
/// folder.
pub async fn join_on_lan<F>(
    code: &Code,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<Welcomed<impl Pipe>>
where
    F: Future<Output = bool>,
{
    let Code::Member { store, lan, .. } = code else {
        return Err(EngineError::Unexpected);
    };
    if store.k == "server" {
        return Err(EngineError::Unexpected);
    }
    let pipe = dial(lan).await.ok_or(EngineError::LanUnreachable)?;
    let (channel, sas) = Channel::scanner(pipe, code).await?;
    new_side(channel, sas, device, meta, confirm).await
}

/// The new device's side, on the code it shows: waits on the LAN for a member to scan it. The
/// caller then calls [`finish_join`] with the welcome's server, or [`finish_lan_join`].
pub async fn answer_shown<F>(
    mut offer: Offer,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<Welcomed<impl Pipe>>
where
    F: Future<Output = bool>,
{
    let listening = offer.listening.take().ok_or(EngineError::LanUnreachable)?;
    let (pipe, key) = listening.accept().await?;
    let (channel, sas) = Channel::shower(pipe, &offer, &key)?;
    new_side(channel, sas, device, meta, confirm).await
}
