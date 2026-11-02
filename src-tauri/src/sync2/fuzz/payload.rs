use proptest::prelude::*;

use super::mutations;
use crate::sync2::payload::{decode_payload, encode_payload, padded_size};

proptest! {
    #[test]
    fn payloads_round_trip(content in prop::collection::vec(any::<u8>(), 0..4096)) {
        let payload = encode_payload(&content).unwrap();
        prop_assert_eq!(payload.len(), padded_size(payload.len()));
        prop_assert_eq!(decode_payload(&payload).unwrap(), content);
    }

    /// The box authenticates a payload, so a changed one may still read; it just never panics.
    #[test]
    fn changed_or_arbitrary_payloads_read_without_panicking(
        payload in prop_oneof![
            mutations(encode_payload(&[1; 300]).unwrap()),
            prop::collection::vec(any::<u8>(), 0..1024),
        ],
    ) {
        let _ = decode_payload(&payload);
    }
}
