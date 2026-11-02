use std::sync::LazyLock;

use proptest::prelude::*;

use super::{MAX_PROTOCOL_SEQ, member, mutations, seq};
use crate::sync2::envelope::{
    Header, MIN_OBJECT_SIZE, ObjectType, StreamPosition, ZERO_HASH, next_in_stream,
    next_live_counter, open_object, parse_object, seal_object, verify_object,
};
use crate::sync2::keys::MemberSecrets;
use crate::sync2::payload::{decode_payload, encode_payload};
use crate::sync2::{Error, Result};

const GROUP: [u8; 16] = [7; 16];
const KEY: [u8; 32] = [9; 32];
static SENDER: LazyLock<MemberSecrets> = LazyLock::new(member);

fn object(
    object_type: ObjectType,
    epoch: u32,
    seq: u64,
    prev: [u8; 32],
    content: &[u8],
) -> Vec<u8> {
    let header = Header {
        object_type,
        group: GROUP,
        epoch,
        sender: SENDER.did,
        seq,
        prev,
    };
    let payload = encode_payload(content).unwrap();
    seal_object(&header, &KEY, &payload, &SENDER.sig_seed)
}

fn read(bytes: &[u8]) -> Result<(Header, Vec<u8>)> {
    let object = parse_object(bytes, &GROUP)?;
    verify_object(&object, &SENDER.sig_public)?;
    let content = decode_payload(&open_object(&object, &KEY)?)?;
    Ok((object.header, content))
}

fn object_type() -> impl Strategy<Value = ObjectType> {
    prop_oneof![
        Just(ObjectType::Changes),
        Just(ObjectType::Snapshot),
        Just(ObjectType::Ack),
        Just(ObjectType::Live),
    ]
}

/// Bytes past the length, magic, suite and group checks, so the signature is what refuses them.
fn plausible() -> impl Strategy<Value = Vec<u8>> {
    (
        any::<u8>(),
        prop::collection::vec(any::<u8>(), MIN_OBJECT_SIZE - 22..MIN_OBJECT_SIZE + 256),
    )
        .prop_map(|(object_type, rest)| [&b"FS2\0"[..], &[object_type, 1], &GROUP, &rest].concat())
}

/// A sequence number around `base`, or anywhere the protocol allows.
fn seq_near(base: u64) -> impl Strategy<Value = u64> {
    prop_oneof![
        (-2i64..=2).prop_map(move |step| base.saturating_add_signed(step).min(MAX_PROTOCOL_SEQ)),
        seq()
    ]
}

fn last_position() -> impl Strategy<Value = Option<StreamPosition>> {
    proptest::option::of(
        (seq(), any::<[u8; 32]>()).prop_map(|(seq, hash)| StreamPosition { seq, hash }),
    )
}

proptest! {
    #[test]
    fn objects_round_trip(
        object_type in object_type(),
        epoch: u32,
        seq in seq(),
        prev: [u8; 32],
        content in prop::collection::vec(any::<u8>(), 0..512),
    ) {
        let (header, opened) = read(&object(object_type, epoch, seq, prev, &content)).unwrap();
        let read = (header.object_type, header.epoch, header.seq, header.prev);
        prop_assert_eq!(read, (object_type, epoch, seq, prev));
        prop_assert_eq!(opened, content);
    }

    #[test]
    fn any_change_to_a_sealed_object_is_refused(
        changed in mutations(object(ObjectType::Changes, 0, 1, ZERO_HASH, &[1; 64])),
    ) {
        prop_assert!(read(&changed).is_err());
    }

    #[test]
    fn arbitrary_bytes_are_refused(
        bytes in prop_oneof![prop::collection::vec(any::<u8>(), 0..1024), plausible()],
    ) {
        prop_assert!(read(&bytes).is_err());
    }

    #[test]
    fn a_log_object_must_follow_the_last_one_read(
        (last, seq) in last_position().prop_flat_map(|last| {
            let base = last.as_ref().map_or(0, |l| l.seq);
            (Just(last), seq_near(base))
        }),
        chained: bool,
        other: [u8; 32],
    ) {
        let (last_seq, last_hash) = last.as_ref().map_or((0, ZERO_HASH), |l| (l.seq, l.hash));
        let prev = if chained { last_hash } else { other };
        let bytes = object(ObjectType::Changes, 0, seq, prev, b"");
        let parsed = parse_object(&bytes, &GROUP).unwrap();
        let expected = if seq <= last_seq {
            Err(Error::Replay)
        } else if last_seq.checked_add(1) != Some(seq) {
            Err(Error::Gap)
        } else if prev != last_hash {
            Err(Error::Prev)
        } else {
            Ok(StreamPosition { seq, hash: parsed.hash })
        };
        prop_assert_eq!(next_in_stream(last.as_ref(), &parsed), expected);
    }

    #[test]
    fn a_live_counter_only_goes_up(
        (last, seq) in proptest::option::of(seq())
            .prop_flat_map(|last| (Just(last), seq_near(last.unwrap_or(0)))),
        prev in prop_oneof![Just(ZERO_HASH), any::<[u8; 32]>()],
    ) {
        let bytes = object(ObjectType::Live, 0, seq, prev, b"");
        let parsed = parse_object(&bytes, &GROUP).unwrap();
        let expected = if prev != ZERO_HASH {
            Err(Error::Prev)
        } else if last.is_some_and(|last| seq <= last) {
            Err(Error::Replay)
        } else {
            Ok(seq)
        };
        prop_assert_eq!(next_live_counter(last, &parsed), expected);
    }
}
