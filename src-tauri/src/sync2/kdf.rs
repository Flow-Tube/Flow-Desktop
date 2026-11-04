use hkdf::Hkdf;
use sha2::{Digest, Sha256};

const PREFIX: &[u8] = b"FLOW-SYNC/2 ";

/// The protocol prefix for labels used as AAD or signature context.
pub fn tag(label: &str) -> Vec<u8> {
    [PREFIX, label.as_bytes()].concat()
}

/// `HKDF-Expand(HKDF-Extract(salt, ikm), "FLOW-SYNC/2 " ‖ label ‖ 0x00 ‖ context, N)`.
///
/// # Panics
/// Never for the protocol's lengths, which are far below HKDF's 8160-byte limit.
pub fn derive<const N: usize>(ikm: &[u8], salt: &[u8], label: &str, context: &[u8]) -> [u8; N] {
    let info = [&tag(label), &[0][..], context].concat();
    let mut okm = [0; N];
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(&info, &mut okm)
        .expect("protocol lengths are far below the HKDF limit");
    okm
}

pub fn labeled_hash(label: &str, data: &[u8]) -> [u8; 32] {
    Sha256::new()
        .chain_update(tag(label))
        .chain_update([0])
        .chain_update(data)
        .finalize()
        .into()
}

/// The first N bytes of a labelled hash, used for ids.
pub fn labeled_id<const N: usize>(label: &str, data: &[u8]) -> [u8; N] {
    super::array(&labeled_hash(label, data)[..N])
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}
