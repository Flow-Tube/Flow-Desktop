//! The object envelope shared by log objects and live messages (spec/store.md).

use std::collections::BTreeMap;

use subtle::ConstantTimeEq;

use super::array;
use super::curve::{sign, verify};
use super::epoch::Purpose;
use super::kdf::{sha256, tag};
use super::sealed::{BOX_OVERHEAD, open, seal, seal_with_salt};
use super::{Error, Result};

const MAGIC: [u8; 4] = *b"FS2\0";
pub const SUITE: u8 = 0x01;
pub const HEADER_SIZE: usize = 82;
const SIGNATURE_SIZE: usize = 64;
pub const MIN_OBJECT_SIZE: usize = HEADER_SIZE + BOX_OVERHEAD + 256 + SIGNATURE_SIZE;
pub const MAX_OBJECT_SIZE: usize = 4 * 1024 * 1024;
pub const ZERO_HASH: [u8; 32] = [0; 32];
/// The largest `seq` every implementation reads exactly.
const MAX_SEQ: u64 = (1 << 53) - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectType {
    Changes = 0x01,
    Snapshot = 0x02,
    Ack = 0x03,
    Login = 0x04,
    Live = 0x10,
}

impl ObjectType {
    fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            0x01 => Some(Self::Changes),
            0x02 => Some(Self::Snapshot),
            0x03 => Some(Self::Ack),
            0x04 => Some(Self::Login),
            0x10 => Some(Self::Live),
            _ => None,
        }
    }

    pub fn purpose(self) -> Purpose {
        match self {
            Self::Changes => Purpose::Changes,
            Self::Snapshot => Purpose::Snapshot,
            Self::Ack => Purpose::Ack,
            Self::Login => Purpose::Store,
            Self::Live => Purpose::Live,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub object_type: ObjectType,
    pub group: [u8; 16],
    pub epoch: u32,
    pub sender: [u8; 16],
    pub seq: u64,
    pub prev: [u8; 32],
}

impl Header {
    fn encode(&self) -> Vec<u8> {
        [
            &MAGIC[..],
            &[self.object_type as u8, SUITE],
            &self.group,
            &self.epoch.to_be_bytes(),
            &self.sender,
            &self.seq.to_be_bytes(),
            &self.prev,
        ]
        .concat()
    }
}

pub struct ParsedObject<'a> {
    pub header: Header,
    header_bytes: &'a [u8],
    sealed: &'a [u8],
    signature: &'a [u8],
    pub hash: [u8; 32],
}

fn signed_bytes(header: &[u8], sealed: &[u8]) -> Vec<u8> {
    [&tag("object"), header, sealed].concat()
}

pub fn seal_object(
    header: &Header,
    purpose_key: &[u8],
    payload: &[u8],
    sig_seed: &[u8; 32],
) -> Vec<u8> {
    let header_bytes = header.encode();
    finish(
        &header_bytes,
        &seal(purpose_key, &header_bytes, payload),
        sig_seed,
    )
}

/// Only for reproducing test vectors; production objects take a fresh random salt.
pub fn seal_object_with_salt(
    header: &Header,
    purpose_key: &[u8],
    payload: &[u8],
    sig_seed: &[u8; 32],
    salt: &[u8; 32],
) -> Vec<u8> {
    let header_bytes = header.encode();
    finish(
        &header_bytes,
        &seal_with_salt(purpose_key, &header_bytes, payload, salt),
        sig_seed,
    )
}

fn finish(header: &[u8], sealed: &[u8], sig_seed: &[u8; 32]) -> Vec<u8> {
    let signature = sign(sig_seed, &signed_bytes(header, sealed));
    [header, sealed, &signature].concat()
}

/// Structural checks only; the caller then finds the sender, verifies, and opens the box.
pub fn parse_object<'a>(bytes: &'a [u8], group: &[u8]) -> Result<ParsedObject<'a>> {
    if !(MIN_OBJECT_SIZE..=MAX_OBJECT_SIZE).contains(&bytes.len()) {
        return Err(Error::Length);
    }
    if bytes[..4] != MAGIC {
        return Err(Error::Magic);
    }
    let object_type = ObjectType::from_byte(bytes[4])
        .filter(|_| bytes[5] == SUITE)
        .ok_or(Error::Suite)?;
    let header = Header {
        object_type,
        group: array(&bytes[6..22]),
        epoch: u32::from_be_bytes(array(&bytes[22..26])),
        sender: array(&bytes[26..42]),
        seq: u64::from_be_bytes(array(&bytes[42..50])),
        prev: array(&bytes[50..82]),
    };
    if header.group[..] != *group {
        return Err(Error::Group);
    }
    if header.seq > MAX_SEQ {
        return Err(Error::Range);
    }
    Ok(ParsedObject {
        header,
        header_bytes: &bytes[..HEADER_SIZE],
        sealed: &bytes[HEADER_SIZE..bytes.len() - SIGNATURE_SIZE],
        signature: &bytes[bytes.len() - SIGNATURE_SIZE..],
        hash: sha256(bytes),
    })
}

pub fn verify_object(object: &ParsedObject<'_>, sig_public: &[u8]) -> Result<()> {
    if verify(
        sig_public,
        &signed_bytes(object.header_bytes, object.sealed),
        object.signature,
    ) {
        Ok(())
    } else {
        Err(Error::Signature)
    }
}

pub fn open_object(object: &ParsedObject<'_>, purpose_key: &[u8]) -> Result<Vec<u8>> {
    open(purpose_key, object.header_bytes, object.sealed)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StreamPosition {
    pub seq: u64,
    pub hash: [u8; 32],
}

/// Advances a sender's log stream; a sender never read before starts before `seq` 1, so a store
/// can't hide the beginning of a log.
pub fn next_in_stream(
    last: Option<&StreamPosition>,
    object: &ParsedObject<'_>,
) -> Result<StreamPosition> {
    let Header { seq, prev, .. } = &object.header;
    let (last_seq, last_hash) = last.map_or((0, &ZERO_HASH), |l| (l.seq, &l.hash));
    if *seq <= last_seq {
        return Err(Error::Replay);
    }
    if *seq > last_seq + 1 {
        return Err(Error::Gap);
    }
    if !bool::from(prev.ct_eq(last_hash)) {
        return Err(Error::Prev);
    }
    Ok(StreamPosition {
        seq: *seq,
        hash: object.hash,
    })
}

/// Walks a removed sender's log down from its cut to `stop_seq` (spec/store.md, A removed sender's
/// chain), so nothing is applied from a chain that doesn't reach the hash the removal names. With
/// `stop_hash`, the walk must arrive at it. Returns the hash each object must have when it is then
/// read forward.
pub async fn cut_chain<E, F, Fut>(
    cut: (u64, [u8; 32]),
    stop_seq: u64,
    stop_hash: Option<&[u8; 32]>,
    group: &[u8; 16],
    mut read: F,
) -> std::result::Result<BTreeMap<u64, [u8; 32]>, E>
where
    E: From<Error>,
    F: FnMut(u64) -> Fut,
    Fut: Future<Output = std::result::Result<Option<Vec<u8>>, E>>,
{
    let (top, mut wanted) = cut;
    let mut hashes = BTreeMap::new();
    for seq in (stop_seq + 1..=top).rev() {
        let bytes = read(seq).await?.ok_or(Error::Gap)?;
        if !bool::from(sha256(&bytes).ct_eq(&wanted)) {
            return Err(Error::Prev.into());
        }
        hashes.insert(seq, wanted);
        wanted = parse_object(&bytes, group)?.header.prev;
    }
    if top > stop_seq && stop_hash.is_some_and(|hash| !bool::from(wanted.ct_eq(hash))) {
        return Err(Error::Prev.into());
    }
    Ok(hashes)
}

/// Live messages carry a counter instead of a chain.
pub fn next_live_counter(last: Option<u64>, object: &ParsedObject<'_>) -> Result<u64> {
    if object.header.prev != ZERO_HASH {
        return Err(Error::Prev);
    }
    match last {
        Some(last) if object.header.seq <= last => Err(Error::Replay),
        _ => Ok(object.header.seq),
    }
}
