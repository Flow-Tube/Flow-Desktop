use zeroize::{Zeroize, ZeroizeOnDrop};

use super::curve::{agreement_public_key, signing_public_key};
use super::kdf::labeled_id;

/// A member's key pairs: this device's own, or the recovery key while it is in use.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct MemberSecrets {
    pub sig_seed: [u8; 32],
    pub kem_secret: [u8; 32],
    #[zeroize(skip)]
    pub sig_public: [u8; 32],
    #[zeroize(skip)]
    pub kem_public: [u8; 32],
    #[zeroize(skip)]
    pub did: [u8; 16],
}

pub fn member_id(sig_public: &[u8; 32], kem_public: &[u8; 32]) -> [u8; 16] {
    labeled_id("device", &[&sig_public[..], &kem_public[..]].concat())
}

pub fn member_secrets(sig_seed: [u8; 32], kem_secret: [u8; 32]) -> MemberSecrets {
    let sig_public = signing_public_key(&sig_seed);
    let kem_public = agreement_public_key(&kem_secret);
    MemberSecrets {
        sig_seed,
        kem_secret,
        sig_public,
        kem_public,
        did: member_id(&sig_public, &kem_public),
    }
}
