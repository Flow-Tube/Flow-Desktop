use subtle::ConstantTimeEq;

use super::kdf::{derive, tag};
use super::sealed::{open, seal};
use super::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Roster,
    Changes,
    Snapshot,
    Ack,
    Live,
    Lan,
    Chain,
}

impl Purpose {
    pub fn label(self) -> &'static str {
        match self {
            Self::Roster => "roster",
            Self::Changes => "changes",
            Self::Snapshot => "snapshot",
            Self::Ack => "ack",
            Self::Live => "live",
            Self::Lan => "lan",
            Self::Chain => "chain",
        }
    }
}

pub fn epoch_commitment(epoch_key: &[u8], group: &[u8], epoch: u32) -> Vec<u8> {
    derive::<32>(epoch_key, group, "epoch", &epoch.to_be_bytes()).to_vec()
}

pub fn purpose_key(epoch_key: &[u8], group: &[u8], epoch: u32, purpose: Purpose) -> Vec<u8> {
    derive::<32>(
        epoch_key,
        group,
        &format!("key {}", purpose.label()),
        &epoch.to_be_bytes(),
    )
    .to_vec()
}

pub fn check_epoch_key(
    epoch_key: &[u8],
    group: &[u8],
    epoch: u32,
    commitment: &[u8],
) -> Result<()> {
    if bool::from(epoch_commitment(epoch_key, group, epoch).ct_eq(commitment)) {
        Ok(())
    } else {
        Err(Error::KeyCommitment)
    }
}

fn chain_aad(group: &[u8], epoch: u32) -> Vec<u8> {
    [&tag("chain"), group, &epoch.to_be_bytes()].concat()
}

/// Seals K(e-1) under epoch e so members can read older objects.
pub fn seal_chain(epoch_key: &[u8], group: &[u8], epoch: u32, previous_key: &[u8]) -> Vec<u8> {
    let key = purpose_key(epoch_key, group, epoch, Purpose::Chain);
    seal(&key, &chain_aad(group, epoch), previous_key)
}

pub fn open_chain(epoch_key: &[u8], group: &[u8], epoch: u32, sealed: &[u8]) -> Result<Vec<u8>> {
    open(
        &purpose_key(epoch_key, group, epoch, Purpose::Chain),
        &chain_aad(group, epoch),
        sealed,
    )
}
