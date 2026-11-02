//! The boxes and wraps that keys and roster names travel in.

use std::sync::LazyLock;

use proptest::prelude::*;

use super::{member, mutations};
use crate::sync2::blob::{open_blob, seal_blob};
use crate::sync2::epoch::{open_chain, seal_chain};
use crate::sync2::kdf::sha256;
use crate::sync2::keys::MemberSecrets;
use crate::sync2::meta::{open_device_meta, seal_device_meta};
use crate::sync2::sealed::{open, seal};
use crate::sync2::wrap::{unwrap_epoch_key, wrap_epoch_key};

const GROUP: [u8; 16] = [7; 16];
const KEY: [u8; 32] = [9; 32];
const AAD: &[u8] = b"aad";
static RECIPIENT: LazyLock<MemberSecrets> = LazyLock::new(member);
static BLOB: LazyLock<Vec<u8>> = LazyLock::new(|| seal_blob(&KEY, &GROUP, 3, &[1; 16], &[2; 300]));

fn bytes(max: usize) -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(any::<u8>(), 0..max)
}

fn wrap() -> Vec<u8> {
    let r = &*RECIPIENT;
    wrap_epoch_key(&r.kem_public, &GROUP, 3, &r.did, &KEY).unwrap()
}

proptest! {
    #[test]
    fn boxes_round_trip(key in bytes(64), aad in bytes(64), plaintext in bytes(512)) {
        prop_assert_eq!(open(&key, &aad, &seal(&key, &aad, &plaintext)).unwrap(), plaintext);
    }

    #[test]
    fn any_change_to_a_box_is_refused(changed in mutations(seal(&KEY, AAD, &[1; 100]))) {
        prop_assert!(open(&KEY, AAD, &changed).is_err());
    }

    #[test]
    fn arbitrary_keys_aad_and_boxes_are_refused(
        key in bytes(64),
        aad in bytes(64),
        sealed in bytes(512),
    ) {
        prop_assert!(open(&key, &aad, &sealed).is_err());
    }

    #[test]
    fn wraps_round_trip(group in bytes(32), epoch: u32, epoch_key: [u8; 32]) {
        let r = &*RECIPIENT;
        let wrapped = wrap_epoch_key(&r.kem_public, &group, epoch, &r.did, &epoch_key).unwrap();
        let unwrapped = unwrap_epoch_key(&r.kem_secret, &group, epoch, &r.did, &wrapped);
        prop_assert_eq!(unwrapped.unwrap(), epoch_key);
    }

    #[test]
    fn any_change_to_a_wrap_is_refused(changed in mutations(wrap())) {
        let r = &*RECIPIENT;
        prop_assert!(unwrap_epoch_key(&r.kem_secret, &GROUP, 3, &r.did, &changed).is_err());
    }

    #[test]
    fn arbitrary_wraps_and_keys_are_refused(
        secret in bytes(64),
        public in bytes(64),
        wrapped in prop_oneof![bytes(128), prop::collection::vec(any::<u8>(), 80)],
    ) {
        prop_assert!(unwrap_epoch_key(&secret, &GROUP, 3, &[0; 16], &wrapped).is_err());
        let _ = wrap_epoch_key(&public, &GROUP, 3, &[0; 16], &KEY);
    }

    #[test]
    fn chain_boxes_round_trip(epoch: u32, previous in bytes(64)) {
        let sealed = seal_chain(&KEY, &GROUP, epoch, &previous);
        prop_assert_eq!(open_chain(&KEY, &GROUP, epoch, &sealed).unwrap(), previous);
    }

    #[test]
    fn any_change_to_a_chain_box_is_refused(
        changed in mutations(seal_chain(&KEY, &GROUP, 3, &[1; 32])),
    ) {
        prop_assert!(open_chain(&KEY, &GROUP, 3, &changed).is_err());
    }

    #[test]
    fn any_change_to_a_blob_is_refused(changed in mutations(BLOB.clone())) {
        prop_assert!(open_blob(&KEY, &GROUP, 3, &[1; 16], &changed, &sha256(&BLOB)).is_err());
        prop_assert!(open_blob(&KEY, &GROUP, 3, &[1; 16], &changed, &sha256(&changed)).is_err());
    }

    #[test]
    fn blobs_round_trip(epoch: u32, did in bytes(16), payload in bytes(512)) {
        let blob = seal_blob(&KEY, &GROUP, epoch, &did, &payload);
        let opened = open_blob(&KEY, &GROUP, epoch, &did, &blob, &sha256(&blob));
        prop_assert_eq!(opened.unwrap(), payload);
    }

    #[test]
    fn device_names_round_trip_when_they_are_text(epoch: u32, seq: u64, content in bytes(256)) {
        let sealed = seal_device_meta(&KEY, &GROUP, epoch, seq, &[1; 16], &content).unwrap();
        let opened = open_device_meta(&KEY, &GROUP, epoch, seq, &[1; 16], &sealed);
        prop_assert_eq!(opened.ok(), String::from_utf8(content).ok());
    }

    #[test]
    fn any_change_to_a_device_name_is_refused(
        changed in mutations(seal_device_meta(&KEY, &GROUP, 0, 1, &[1; 16], b"{}").unwrap()),
    ) {
        prop_assert!(open_device_meta(&KEY, &GROUP, 0, 1, &[1; 16], &changed).is_err());
    }
}
