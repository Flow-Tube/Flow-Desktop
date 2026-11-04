use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use x25519_dalek::{PublicKey, StaticSecret};

use super::{Error, Result};

/// Rejects non-canonical encodings and small-order keys (spec/crypto.md, Ed25519 checks).
pub fn is_valid_signing_key(public_key: &[u8]) -> bool {
    <[u8; 32]>::try_from(public_key)
        .ok()
        .filter(canonical_y)
        .and_then(|bytes| VerifyingKey::from_bytes(&bytes).ok())
        .is_some_and(|key| !key.is_weak())
}

/// `VerifyingKey::from_bytes` accepts y ≥ p, so the encoding is checked directly.
fn canonical_y(bytes: &[u8; 32]) -> bool {
    let mut y = *bytes;
    y[31] &= 0x7f;
    let p_minus_1: [u8; 32] = {
        let mut p = [0xff; 32];
        p[0] = 0xec;
        p[31] = 0x7f;
        p
    };
    y.iter().rev().cmp(p_minus_1.iter().rev()) != std::cmp::Ordering::Greater
}

pub fn signing_public_key(seed: &[u8; 32]) -> [u8; 32] {
    SigningKey::from_bytes(seed).verifying_key().to_bytes()
}

pub fn sign(seed: &[u8; 32], message: &[u8]) -> [u8; 64] {
    SigningKey::from_bytes(seed).sign(message).to_bytes()
}

pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    let (Ok(key), Ok(signature)) = (
        <[u8; 32]>::try_from(public_key),
        Signature::from_slice(signature),
    ) else {
        return false;
    };
    is_valid_signing_key(&key)
        && VerifyingKey::from_bytes(&key)
            .is_ok_and(|key| key.verify_strict(message, &signature).is_ok())
}

pub fn agreement_public_key(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

pub fn agree(secret: &[u8; 32], public_key: &[u8]) -> Result<[u8; 32]> {
    let public = <[u8; 32]>::try_from(public_key).map_err(|_| Error::X25519)?;
    let shared = StaticSecret::from(*secret).diffie_hellman(&PublicKey::from(public));
    if shared.was_contributory() {
        Ok(shared.to_bytes())
    } else {
        Err(Error::X25519)
    }
}
