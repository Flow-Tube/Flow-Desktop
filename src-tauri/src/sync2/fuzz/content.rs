//! What sealed objects carry once opened: change batches, snapshot manifests, acks, profile
//! names and live messages.

use std::collections::BTreeMap;

use proptest::prelude::*;

use super::{json, mutations};
use crate::sync::canonical::{Hlc, to_canonical_json};
use crate::sync2::batches::{batch_content, parse_batch};
use crate::sync2::bootstrap::position;
use crate::sync2::gc::{Ack, Facts, Logged};
use crate::sync2::live_message::LiveMessage;
use crate::sync2::profile_names::{self, ProfileRecord};
use crate::sync2::snapshot::{Manifest, Tip};

fn line() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(any::<u8>().prop_filter("one line", |b| *b != b'\n'), 0..64)
}

fn dids() -> impl Strategy<Value = String> {
    prop::sample::select(vec!["a", "b", "c"]).prop_map(str::to_owned)
}

fn seq() -> impl Strategy<Value = u64> {
    prop_oneof![Just(u64::MAX), 0..10u64, any::<u64>()]
}

fn version_vector() -> impl Strategy<Value = BTreeMap<String, u64>> {
    prop::collection::btree_map(dids(), seq(), 0..3)
}

fn manifest() -> impl Strategy<Value = Logged> {
    let tip = seq().prop_map(|seq| Tip {
        hash: String::new(),
        seq,
    });
    (
        dids(),
        seq(),
        proptest::option::of(dids()),
        prop::collection::btree_map(dids(), tip, 0..3),
    )
        .prop_map(|(did, seq, link, vv)| Logged {
            did,
            seq,
            manifest: Manifest {
                head: String::new(),
                link,
                parts: Vec::new(),
                vv,
            },
        })
}

fn profile() -> impl Strategy<Value = ProfileRecord> {
    (
        any::<bool>(),
        any::<u64>(),
        any::<u32>(),
        "[a-f0-9]{8}",
        any::<String>(),
        any::<String>(),
    )
        .prop_map(|(deleted, ms, counter, device, link, name)| ProfileRecord {
            deleted,
            hlc: Hlc::new(ms, counter, device),
            link,
            name,
        })
}

proptest! {
    #[test]
    fn batches_round_trip(
        collection: String,
        head: String,
        link: Option<String>,
        records in prop::collection::vec(line(), 0..8),
    ) {
        let content = batch_content(&collection, &head, link.as_deref(), &records);
        let batch = parse_batch(&content).unwrap();
        prop_assert_eq!(batch.records(), records.join(&b'\n'));
        prop_assert_eq!((batch.head, batch.link), (head, link));
    }

    #[test]
    fn changed_or_arbitrary_batches_are_read_without_panicking(
        content in prop_oneof![
            mutations(batch_content("likes", "ab", Some("link"), &[b"{\"id\":\"x\"}"])),
            prop::collection::vec(any::<u8>(), 0..512),
        ],
    ) {
        let _ = parse_batch(&content).map(|batch| profile_names::parse(&[batch]));
    }

    #[test]
    fn profile_records_round_trip(records in prop::collection::vec(profile(), 0..6)) {
        let lines: Vec<Vec<u8>> = records.iter().map(to_canonical_json).collect();
        let content = batch_content(profile_names::PROFILES, "ab", None, &lines);
        let batch = parse_batch(&content).unwrap();
        prop_assert_eq!(profile_names::parse(&[batch]), records);
    }

    #[test]
    fn decrypted_json_is_read_without_panicking(value in json()) {
        let _ = serde_json::from_value::<Manifest>(value.clone());
        let _ = serde_json::from_value::<Ack>(value.clone());
        let _ = serde_json::from_value::<ProfileRecord>(value.clone());
        if let Ok(message) = serde_json::from_value::<LiveMessage>(value) {
            let _ = (message.is_valid(), message.to());
        }
    }

    #[test]
    fn a_snapshot_tip_names_a_32_byte_hash(
        hash in prop_oneof![any::<String>(), "[0-9a-fA-F]{0,70}"],
        seq: u64,
    ) {
        let expected = hex::decode(&hash).ok().filter(|h| h.len() == 32);
        let read = position(&Tip { hash, seq }).ok();
        prop_assert_eq!(read.map(|p| (p.hash.to_vec(), p.seq)), expected.map(|h| (h, seq)));
    }

    /// Acks and manifests come from other devices; what this device collected stays in `i64`.
    #[test]
    fn garbage_collection_plans_within_what_every_device_acked(
        current in prop::collection::btree_set(dids(), 0..3),
        collectable in prop::collection::btree_set(dids(), 0..3),
        links in prop::collection::btree_set(proptest::option::of(dids()), 0..3),
        acks in prop::collection::btree_map(dids(), version_vector(), 0..3),
        manifests in prop::collection::vec(manifest(), 0..4),
        collected in prop::collection::btree_map(dids(), 0..=i64::MAX as u64, 0..3),
    ) {
        let plan = Facts {
            current: &current,
            collectable: &collectable,
            links: &links,
            acks: &acks,
            manifests: &manifests,
            collected: &collected,
        }
        .plan();
        for (did, (from, through)) in &plan.logs {
            prop_assert!(collectable.contains(did) && from <= through);
        }
        for (did, seq) in &plan.manifests {
            prop_assert!(manifests.iter().any(|m| m.did == *did && m.seq == *seq));
        }
    }
}
