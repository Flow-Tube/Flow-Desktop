//! Property tests for what other devices, stores and the LAN send: valid input round-trips, and
//! changed or arbitrary input is refused with an error, never a panic.

mod boxes;
mod codes;
mod content;
mod envelope;
mod paths;
mod payload;
mod recovery;
mod roster;

use proptest::prelude::*;
use serde_json::Value;

use super::keys::{MemberSecrets, member_secrets};
use super::sealed::random_bytes;

/// The largest `seq` the protocol allows (spec/store.md).
pub(super) const MAX_PROTOCOL_SEQ: u64 = (1 << 53) - 1;

/// A `seq` the protocol allows, edges included.
pub(super) fn seq() -> impl Strategy<Value = u64> {
    prop_oneof![Just(0), Just(MAX_PROTOCOL_SEQ), 0..=MAX_PROTOCOL_SEQ]
}

pub(super) fn member() -> MemberSecrets {
    member_secrets(random_bytes(), random_bytes())
}

/// One-bit flips, truncations and extensions of `valid`.
pub(super) fn mutations(valid: Vec<u8>) -> impl Strategy<Value = Vec<u8>> {
    let len = valid.len();
    let (flip, cut) = (valid.clone(), valid.clone());
    prop_oneof![
        (0..len, 0..8u8).prop_map(move |(at, bit)| {
            let mut changed = flip.clone();
            changed[at] ^= 1 << bit;
            changed
        }),
        (0..len).prop_map(move |n| cut[..n].to_vec()),
        prop::collection::vec(any::<u8>(), 1..64)
            .prop_map(move |extra| [valid.as_slice(), &extra].concat()),
    ]
}

pub(super) fn json() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::from),
        any::<i64>().prop_map(Value::from),
        any::<u64>().prop_map(Value::from),
        any::<f64>().prop_filter_map("finite", |f| serde_json::Number::from_f64(f)
            .map(Value::Number)),
        any::<String>().prop_map(Value::from),
    ];
    leaf.prop_recursive(3, 24, 4, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..4).prop_map(Value::from),
            prop::collection::btree_map(any::<String>(), inner, 0..4)
                .prop_map(|fields| Value::Object(fields.into_iter().collect())),
        ]
    })
}
