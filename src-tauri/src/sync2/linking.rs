//! Pairing (spec/protocol.md, Pairing): a member shows a QR code, a new device scans it, both
//! users confirm the six digits, and the member adds the new device to the roster.

use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::curve::{agreement_public_key, sign};
use super::engine::{EngineError, Result, Session};
use super::entries::{Draft, build_entry, member_subject};
use super::keys::{MemberSecrets, member_id};
use super::mailbox::Mailbox;
use super::meta::seal_device_meta;
use super::pairing::{pairing_aad, pairing_keys, pairing_slot};
use super::paths::pair_message_name;
use super::payload::{decode_payload, encode_payload};
use super::roster::{Entry, Op, Role, apply_entry, replay_roster, signing_bytes};
use super::sealed::{open, random_bytes, seal};
use super::state::{GroupRecord, add_roster_entries, save_group};
use super::store::Store;
use super::wrap::wrap_epoch_key;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const SLOT_LIFETIME: Duration = Duration::from_secs(180);
const KEY_SIZE: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoreLocation {
    pub k: String,
    pub u: String,
}

/// What the QR code carries: no long-term secret, only a one-time token and ephemeral key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QrCode {
    pub v: u8,
    pub t: String,
    pub e: String,
    pub r: String,
    pub d: String,
    pub s: StoreLocation,
}

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

/// A code shown by a member, valid until its slot closes.
pub struct Offer {
    pub qr: String,
    token: [u8; 16],
    secret: [u8; KEY_SIZE],
    public: [u8; KEY_SIZE],
}

pub fn new_offer(store_url: &str, device_name: &str) -> Offer {
    let (token, secret) = (random_bytes::<16>(), random_bytes::<KEY_SIZE>());
    let public = agreement_public_key(&secret);
    let code = QrCode {
        v: 2,
        t: URL_SAFE_NO_PAD.encode(token),
        e: URL_SAFE_NO_PAD.encode(public),
        r: "m".into(),
        d: device_name.chars().take(64).collect(),
        s: StoreLocation {
            k: "server".into(),
            u: store_url.into(),
        },
    };
    Offer {
        qr: String::from_utf8_lossy(&to_canonical_json(&code)).into_owned(),
        token,
        secret,
        public,
    }
}

/// One side of the mailbox: seals what it sends and opens what the other side sent, in order.
struct Channel<'m, M> {
    mailbox: &'m M,
    slot: String,
    token: [u8; 16],
    keys: (Vec<u8>, Vec<u8>),
    directions: (char, char),
    sent: u64,
    received: u64,
}

impl<M: Mailbox> Channel<'_, M> {
    async fn send(&mut self, message: &Message, prefix: &[u8]) -> Result<()> {
        let payload = encode_payload(&to_canonical_json(message))?;
        let sealed = seal(&self.keys.0, &pairing_aad(&self.token, self.sent), &payload);
        let name = pair_message_name(self.directions.0, self.sent);
        self.mailbox
            .put_message(&self.slot, &name, [prefix, &sealed].concat())
            .await?;
        self.sent += 1;
        Ok(())
    }

    async fn next_bytes(&self) -> Result<Vec<u8>> {
        let name = pair_message_name(self.directions.1, self.received);
        let deadline = tokio::time::Instant::now() + SLOT_LIFETIME;
        loop {
            if let Some(bytes) = self.mailbox.get_message(&self.slot, &name).await? {
                return Ok(bytes);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(EngineError::TimedOut);
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    fn open(&mut self, sealed: &[u8]) -> Result<Message> {
        let payload = open(
            &self.keys.1,
            &pairing_aad(&self.token, self.received),
            sealed,
        )?;
        self.received += 1;
        serde_json::from_slice(&decode_payload(&payload)?).map_err(|_| EngineError::Unexpected)
    }

    async fn receive(&mut self) -> Result<Message> {
        let bytes = self.next_bytes().await?;
        self.open(&bytes)
    }
}

fn b64_key(value: &str) -> Result<[u8; KEY_SIZE]> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| EngineError::Unexpected)?;
    (bytes.len() == KEY_SIZE)
        .then(|| array(&bytes))
        .ok_or(EngineError::Unexpected)
}

/// The member's side: waits for the scanner, shows the code through `confirm`, and adds the new
/// device once the user confirms. Returns the new device's id.
pub async fn add_device<S, F>(
    session: &Session<'_, S>,
    offer: Offer,
    device: &MemberSecrets,
    confirm: impl FnOnce(String) -> F,
) -> Result<String>
where
    S: Store + Mailbox,
    F: Future<Output = bool>,
{
    let slot = hex::encode(pairing_slot(&offer.token));
    session.store().open_slot(&slot).await?;
    let result = run_member(session, &offer, &slot, device, confirm).await;
    if let Err(error) = session.store().close_slot(&slot).await {
        tracing::warn!(%error, "could not close the pairing slot; it expires on its own");
    }
    result
}

async fn run_member<S, F>(
    session: &Session<'_, S>,
    offer: &Offer,
    slot: &str,
    device: &MemberSecrets,
    confirm: impl FnOnce(String) -> F,
) -> Result<String>
where
    S: Store + Mailbox,
    F: Future<Output = bool>,
{
    let mut channel = Channel {
        mailbox: session.store(),
        slot: slot.into(),
        token: offer.token,
        keys: (Vec::new(), Vec::new()),
        directions: ('a', 'b'),
        sent: 0,
        received: 0,
    };
    let first = channel.next_bytes().await?;
    let (scanner_public, sealed) = first
        .split_at_checked(KEY_SIZE)
        .ok_or(EngineError::Unexpected)?;
    let keys = pairing_keys(
        &offer.secret,
        scanner_public,
        &offer.token,
        &offer.public,
        scanner_public,
    )?;
    channel.keys = (keys.shower_key, keys.scanner_key);
    let Message::Join { sig, kem, meta } = channel.open(sealed)? else {
        return Err(EngineError::Unexpected);
    };
    if !confirm(keys.sas).await {
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
        .send(
            &Message::Entry {
                entry: Box::new(entry.clone()),
            },
            &[],
        )
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
    channel.send(&welcome, &[]).await?;
    match channel.receive().await? {
        Message::Done => Ok(hex::encode(did)),
        _ => Err(EngineError::Unexpected),
    }
}

/// The new device's side: answers a member's code, shows the six digits through `confirm`, and
/// once accepted saves the group with the roster verified up to the head the member named.
pub async fn join<S, F>(
    pool: &SqlitePool,
    store: &S,
    qr: &str,
    device: &MemberSecrets,
    meta: DeviceMeta,
    confirm: impl FnOnce(String) -> F,
) -> Result<()>
where
    S: Store + Mailbox,
    F: Future<Output = bool>,
{
    let code: QrCode = serde_json::from_str(qr).map_err(|_| EngineError::Unexpected)?;
    if code.v != 2 || code.r != "m" || code.s.k != "server" {
        return Err(EngineError::Unexpected);
    }
    let token: [u8; 16] = URL_SAFE_NO_PAD
        .decode(&code.t)
        .ok()
        .filter(|t| t.len() == 16)
        .map(|t| array(&t))
        .ok_or(EngineError::Unexpected)?;
    let shower_public = b64_key(&code.e)?;
    let secret = random_bytes::<KEY_SIZE>();
    let public = agreement_public_key(&secret);
    let keys = pairing_keys(&secret, &shower_public, &token, &shower_public, &public)?;
    let slot = hex::encode(pairing_slot(&token));
    let mut channel = Channel {
        mailbox: store,
        slot,
        token,
        keys: (keys.scanner_key, keys.shower_key),
        directions: ('b', 'a'),
        sent: 0,
        received: 0,
    };

    let join = Message::Join {
        sig: URL_SAFE_NO_PAD.encode(device.sig_public),
        kem: URL_SAFE_NO_PAD.encode(device.kem_public),
        meta,
    };
    channel.send(&join, &public).await?;
    if !confirm(keys.sas).await {
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
        .send(
            &Message::Accept {
                sig: URL_SAFE_NO_PAD.encode(sign(&device.sig_seed, &signing_bytes(&entry))),
            },
            &[],
        )
        .await?;

    let Message::Welcome {
        group,
        head,
        seq,
        link,
        store: location,
    } = channel.receive().await?
    else {
        return Err(EngineError::Unexpected);
    };
    if location.u != code.s.u || group != entry.group {
        return Err(EngineError::Unexpected);
    }
    let roster = store.roster_after(-1).await?;
    let pinned = roster
        .iter()
        .position(|e| e.seq == seq)
        .map(|end| replay_roster(&roster[..=end]))
        .transpose()?;
    if pinned.is_none_or(|state| state.head != head)
        || !replay_roster(&roster)?.members.contains_key(&me.did)
    {
        return Err(Error::RosterChain.into());
    }
    add_roster_entries(pool, &roster).await?;
    let record = GroupRecord {
        group_id: group,
        store_url: location.u,
        instance: Some(location.i),
        link,
        own_seq: 0,
        own_prev: hex::encode([0; 32]),
        cursor: 0,
    };
    save_group(pool, &record).await?;
    channel.send(&Message::Done, &[]).await
}
