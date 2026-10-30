//! Live messages as envelopes of type `0x10` (spec/live.md, Live messages): sealed under the
//! epoch's live key, signed by the sender, numbered by its counter, with `prev` zero.

use std::collections::BTreeMap;

use super::Error;
use super::engine::{EngineError, Result, Session};
use super::envelope::{
    Header, ObjectType, next_live_counter, open_object, parse_object, seal_object, verify_object,
};
use super::epoch::{Purpose, purpose_key};
use super::keys::MemberSecrets;
use super::live_message::LiveMessage;
use super::payload::{decode_payload, encode_payload};
use super::roster::Role;
use super::store::Store;
use crate::sync::canonical::to_canonical_json;

/// What sealing and opening live messages needs, taken from a session when it opened.
#[derive(Clone)]
pub struct LiveKeys {
    pub group: [u8; 16],
    pub epoch: u32,
    live_key: Vec<u8>,
    device: MemberSecrets,
    /// The signing key of every current device but this one.
    others: BTreeMap<String, [u8; 32]>,
}

/// A message read from another device, with the counter it carried.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Received {
    pub from: String,
    pub seq: u64,
    pub message: LiveMessage,
}

impl LiveKeys {
    pub fn of<S: Store>(session: &Session<'_, S>) -> Self {
        let me = hex::encode(session.device().did);
        let state = session.roster();
        Self {
            group: *session.group(),
            epoch: state.epoch,
            live_key: purpose_key(
                session.current_key(),
                session.group(),
                state.epoch,
                Purpose::Live,
            ),
            device: session.device().clone(),
            others: state
                .members
                .iter()
                .filter(|(did, member)| member.role == Role::Device && **did != me)
                .map(|(did, member)| (did.clone(), member.sig))
                .collect(),
        }
    }

    pub fn me(&self) -> String {
        hex::encode(self.device.did)
    }

    pub fn seal(&self, seq: u64, message: &LiveMessage) -> Result<Vec<u8>> {
        let header = Header {
            object_type: ObjectType::Live,
            group: self.group,
            epoch: self.epoch,
            sender: self.device.did,
            seq,
            prev: [0; 32],
        };
        let payload = encode_payload(&to_canonical_json(message))?;
        Ok(seal_object(
            &header,
            &self.live_key,
            &payload,
            &self.device.sig_seed,
        ))
    }

    /// Checks and opens a message from another current device. The caller still checks that its
    /// counter is above the last one accepted from that device.
    pub fn open(&self, bytes: &[u8]) -> Result<Received> {
        let object = parse_object(bytes, &self.group)?;
        let from = hex::encode(object.header.sender);
        let key = self.others.get(&from).ok_or(Error::Sender)?;
        if object.header.object_type != ObjectType::Live {
            return Err(Error::Suite.into());
        }
        verify_object(&object, key)?;
        let seq = next_live_counter(None, &object)?;
        if object.header.epoch != self.epoch {
            return Err(Error::KeyCommitment.into());
        }
        let content = decode_payload(&open_object(&object, &self.live_key)?)?;
        let message: LiveMessage =
            serde_json::from_slice(&content).map_err(|_| EngineError::Unexpected)?;
        if !message.is_valid() {
            return Err(EngineError::Unexpected);
        }
        Ok(Received { from, seq, message })
    }
}
