//! Pairing (spec/protocol.md, Pairing): one device shows a code and the other answers it, both
//! users confirm the six digits, and the member adds the new device to the roster. Messages travel
//! through the store's mailbox or over the LAN ([`super::pipe`]).

use std::collections::BTreeMap;
use std::future::Future;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::Error;
use super::codes::{Code, Offer, b64_key};
use super::curve::{agreement_public_key, sign};
use super::engine::{EngineError, Result, Session};
use super::entries::{Draft, build_entry, member_subject};
use super::keys::{MemberSecrets, member_id};
use super::mailbox::Mailbox;
use super::meta::seal_device_meta;
use super::pairing::{pairing_aad, pairing_keys, pairing_slot};
use super::payload::{decode_payload, encode_payload};
use super::pipe::{AnyPipe, KEY_SIZE, MailboxPipe, Pipe, dial};
use super::roster::{Entry, Op, Role, Subject, apply_entry, replay_roster, signing_bytes};
use super::sealed::{open, random_bytes, seal};
use super::state::{GroupRecord, add_roster_entries, save_group};
use super::store::Store;
use super::wrap::wrap_epoch_key;
use crate::sync::canonical::to_canonical_json;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceMeta {
    pub app: String,
    pub name: String,
    pub platform: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WelcomeStore {
    pub k: String,
    pub u: String,
    pub i: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Message {
    Join {
        sig: String,
        kem: String,
        meta: DeviceMeta,
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
    },
    Done,
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
/// lists LAN addresses, on the LAN too. Returns the new device's id.
pub async fn add_device<S, F>(
    session: &Session<'_, S>,
    mut offer: Offer,
    device: &MemberSecrets,
    confirm: impl FnOnce(String) -> F,
) -> Result<String>
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
            let pipe = lan.map_or(AnyPipe::Mailbox(mailbox), AnyPipe::Lan);
            match Channel::shower(pipe, &offer, &key) {
                Ok((channel, sas)) => member_side(session, channel, sas, device, confirm).await,
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
    confirm: impl FnOnce(String) -> F,
) -> Result<String>
where
    S: Store,
    F: Future<Output = bool>,
{
    let Code::New { lan, .. } = code else {
        return Err(EngineError::Unexpected);
    };
    let pipe = dial(lan).await.ok_or(EngineError::LanUnreachable)?;
    let (channel, sas) = Channel::scanner(pipe, code).await?;
    member_side(session, channel, sas, device, confirm).await
}

async fn member_side<S, P, F>(
    session: &Session<'_, S>,
    mut channel: Channel<P>,
    sas: String,
    device: &MemberSecrets,
    confirm: impl FnOnce(String) -> F,
) -> Result<String>
where
    S: Store,
    P: Pipe,
    F: Future<Output = bool>,
{
    let Message::Join { sig, kem, meta } = channel.receive().await? else {
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
    let wrap = wrap_epoch_key(&kem_public, group, state.epoch, &did, session.current_key())?;
    let wraps = BTreeMap::from([(hex::encode(did), URL_SAFE_NO_PAD.encode(wrap))]);
    if session
        .store()
        .append_roster(&state.head, &entry, &wraps, None)
        .await?
        != super::server::Appended::Done
    {
        return Err(Error::RosterChain.into());
    }

    let record = session.record();
    let welcome = Message::Welcome {
        group: record.group_id.clone(),
        head: after.head,
        seq: after.seq,
        link: record.link.clone(),
        store: WelcomeStore {
            k: "server".into(),
            u: record.store_url.clone(),
            i: record.instance.clone().unwrap_or_default(),
        },
    };
    channel.send(&welcome).await?;
    match channel.receive().await? {
        Message::Done => Ok(hex::encode(did)),
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
}

/// A new device that was welcomed and has yet to check the roster and say it is done.
pub struct Welcomed<P> {
    channel: Channel<P>,
    me: Subject,
    pub welcome: Welcome,
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
    } = channel.receive().await?
    else {
        return Err(EngineError::Unexpected);
    };
    if group != entry.group || store.k != "server" {
        return Err(EngineError::Unexpected);
    }
    Ok(Welcomed {
        channel,
        me,
        welcome: Welcome {
            group,
            head,
            seq,
            link,
            store,
        },
    })
}

/// Saves the group once the roster on `store` verifies up to the head the member named.
pub async fn finish_join<S: Store, P: Pipe>(
    pool: &SqlitePool,
    store: &S,
    welcomed: Welcomed<P>,
) -> Result<()> {
    let Welcomed {
        mut channel,
        me,
        welcome,
    } = welcomed;
    let roster = store.roster_after(-1).await?;
    let pinned = roster
        .iter()
        .position(|e| e.seq == welcome.seq)
        .map(|end| replay_roster(&roster[..=end]))
        .transpose()?;
    if pinned.is_none_or(|state| state.head != welcome.head)
        || !replay_roster(&roster)?.members.contains_key(&me.did)
    {
        return Err(Error::RosterChain.into());
    }
    add_roster_entries(pool, &roster).await?;
    let record = GroupRecord::new(
        welcome.group,
        welcome.store.u,
        Some(welcome.store.i),
        welcome.link,
    );
    save_group(pool, &record).await?;
    channel.send(&Message::Done).await
}

/// The new device's side, on a member's code: tries the LAN addresses it lists, then the store's
/// mailbox, and saves the group once accepted.
pub async fn join<S, F>(
    pool: &SqlitePool,
    store: &S,
    code: &Code,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<()>
where
    S: Store + Mailbox + Sync,
    F: Future<Output = bool>,
{
    let Code::Member { store_url, lan, .. } = code else {
        return Err(EngineError::Unexpected);
    };
    let pipe = if let Some(pipe) = dial(lan).await {
        AnyPipe::Lan(pipe)
    } else {
        let slot = hex::encode(pairing_slot(&code.token()?));
        AnyPipe::Mailbox(MailboxPipe::new(store, slot, false))
    };
    let (channel, sas) = Channel::scanner(pipe, code).await?;
    let welcomed = new_side(channel, sas, device, meta, confirm).await?;
    if welcomed.welcome.store.u != *store_url {
        return Err(EngineError::Unexpected);
    }
    finish_join(pool, store, welcomed).await
}

/// The new device's side, on the code it shows: waits on the LAN for a member to scan it. The
/// caller connects to the welcome's store and calls [`finish_join`].
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
