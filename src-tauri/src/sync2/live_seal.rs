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

/// The most a live message or a notice may hold, on any transport (spec/store.md, Untrusted input).
pub const MAX_LIVE_MESSAGE: usize = 64 * 1024;

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
    pub fn of<S: Store>(session: &Session<'_, S>) -> Result<Self> {
        session.may_seal()?;
        let me = hex::encode(session.device().did);
        let state = session.roster();
        Ok(Self {
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
        })
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
        if bytes.len() > MAX_LIVE_MESSAGE {
            return Err(Error::Length.into());
        }
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

#[cfg(test)]
mod tests {
    use std::sync::LazyLock;

    use proptest::prelude::*;

    use super::*;
    use crate::sync2::fuzz::{json, member, mutations, seq};
    use crate::sync2::live_message::{Answer, DeviceKind};
    use crate::sync2::sealed::random_bytes;

    fn random_bytes_of(len: usize) -> Vec<u8> {
        std::iter::repeat_with(random_bytes::<32>)
            .flatten()
            .take(len)
            .collect()
    }

    /// Two devices of one group, each with the other's signing key.
    static PAIR: LazyLock<(LiveKeys, LiveKeys)> = LazyLock::new(|| {
        let (a, b) = (member(), member());
        let keys = |device: &MemberSecrets, other: &MemberSecrets| LiveKeys {
            group: [7; 16],
            epoch: 2,
            live_key: vec![5; 32],
            device: device.clone(),
            others: BTreeMap::from([(hex::encode(other.did), other.sig_public)]),
        };
        (keys(&a, &b), keys(&b, &a))
    });

    fn presence() -> LiveMessage {
        LiveMessage::Presence {
            can: Vec::new(),
            kind: DeviceKind::Desktop,
        }
    }

    fn message() -> impl Strategy<Value = LiveMessage> {
        prop_oneof![
            Just(presence()),
            (
                any::<String>(),
                any::<u64>(),
                any::<bool>(),
                any::<Option<String>>()
            )
                .prop_map(|(to, reference, ok, reason)| LiveMessage::Result(Answer {
                    to,
                    reference,
                    ok,
                    reason,
                })),
        ]
    }

    #[test]
    fn a_live_message_over_the_limit_is_refused_on_any_transport() {
        let (a, b) = &*PAIR;
        let with_reason = |bytes: usize| {
            a.seal(
                1,
                &LiveMessage::Result(Answer {
                    to: b.me(),
                    reference: 1,
                    ok: false,
                    reason: Some(hex::encode(random_bytes_of(bytes))),
                }),
            )
            .unwrap()
        };
        let small = with_reason(1024);
        assert!(b.open(&small).is_ok());
        let large = with_reason(128 * 1024);
        assert!(large.len() > MAX_LIVE_MESSAGE);
        assert!(b.open(&large).is_err());
    }

    proptest! {
        #[test]
        fn live_messages_round_trip(seq in seq(), message in message()) {
            let (a, b) = &*PAIR;
            let received = b.open(&a.seal(seq, &message).unwrap()).unwrap();
            prop_assert_eq!(received, Received { from: a.me(), seq, message });
        }

        #[test]
        fn any_change_to_a_live_message_is_refused(
            changed in mutations(PAIR.0.seal(1, &presence()).unwrap()),
        ) {
            prop_assert!(PAIR.1.open(&changed).is_err());
        }

        #[test]
        fn arbitrary_live_messages_are_refused(
            bytes in prop::collection::vec(any::<u8>(), 0..1024),
        ) {
            prop_assert!(PAIR.1.open(&bytes).is_err());
        }

        #[test]
        fn sealed_json_that_is_no_valid_message_is_refused(value in json()) {
            let (a, b) = &*PAIR;
            let header = Header {
                object_type: ObjectType::Live,
                group: a.group,
                epoch: a.epoch,
                sender: a.device.did,
                seq: 1,
                prev: [0; 32],
            };
            let payload = encode_payload(&to_canonical_json(&value)).unwrap();
            let opened = b.open(&seal_object(&header, &a.live_key, &payload, &a.device.sig_seed));
            let valid = serde_json::from_value::<LiveMessage>(value).is_ok_and(|m| m.is_valid());
            prop_assert_eq!(opened.is_ok(), valid);
        }
    }
}
