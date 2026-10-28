//! Device names and platforms, sealed inside roster entries.

use super::epoch::{Purpose, purpose_key};
use super::kdf::tag;
use super::payload::decode_payload;
use super::sealed::open;
use super::{Error, Result};

fn meta_aad(group: &[u8], seq: u64, did: &[u8]) -> Vec<u8> {
    [&tag("meta"), group, &seq.to_be_bytes(), did].concat()
}

/// Opens the `meta` box an entry carries for one device, under the epoch in force after it.
pub fn open_device_meta(
    epoch_key: &[u8],
    group: &[u8],
    epoch: u32,
    seq: u64,
    did: &[u8],
    sealed: &[u8],
) -> Result<String> {
    let key = purpose_key(epoch_key, group, epoch, Purpose::Roster);
    let content = decode_payload(&open(&key, &meta_aad(group, seq, did), sealed)?)?;
    String::from_utf8(content).map_err(|_| Error::Payload)
}
