use subtle::ConstantTimeEq;

use super::kdf::{sha256, tag};
use super::sealed::{open, seal};
use super::{Error, Result};

fn blob_aad(group: &[u8], epoch: u32, did: &[u8]) -> Vec<u8> {
    [&tag("blob"), group, &epoch.to_be_bytes(), did].concat()
}

/// Seals a snapshot blob; its name is the SHA-256 of the result.
pub fn seal_blob(
    snapshot_key: &[u8],
    group: &[u8],
    epoch: u32,
    did: &[u8],
    payload: &[u8],
) -> Vec<u8> {
    seal(snapshot_key, &blob_aad(group, epoch, did), payload)
}

pub fn open_blob(
    snapshot_key: &[u8],
    group: &[u8],
    epoch: u32,
    did: &[u8],
    blob: &[u8],
    expected_hash: &[u8],
) -> Result<Vec<u8>> {
    if !bool::from(sha256(blob).ct_eq(expected_hash)) {
        return Err(Error::BlobHash);
    }
    open(snapshot_key, &blob_aad(group, epoch, did), blob)
}
