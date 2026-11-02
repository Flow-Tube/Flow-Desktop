use proptest::prelude::*;

use super::mutations;
use crate::sync2::paths::{log_path, parse_log_path};

proptest! {
    #[test]
    fn log_paths_round_trip(did: [u8; 16], seq: u64) {
        let did = hex::encode(did);
        prop_assert_eq!(parse_log_path(&log_path(&did, seq)), Some((did, seq)));
    }

    #[test]
    fn only_the_path_of_a_log_object_is_read(
        path in prop_oneof![
            any::<String>(),
            mutations(log_path(&"ab".repeat(16), 1025).into_bytes())
                .prop_map(|b| String::from_utf8_lossy(&b).into_owned()),
        ],
    ) {
        if let Some((did, seq)) = parse_log_path(&path) {
            prop_assert_eq!(log_path(&did, seq), path);
        }
    }
}
