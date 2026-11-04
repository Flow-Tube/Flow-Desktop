//! The box: AES-256-GCM under a key derived per box from a random salt, plus a key commitment.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use rand::TryRng;
use rand::rngs::SysRng;
use subtle::ConstantTimeEq;

use super::array;
use super::kdf::derive;
use super::{Error, Result};

const SALT: usize = 32;
const COMMIT: usize = 32;
const TAG: usize = 16;
pub const BOX_OVERHEAD: usize = SALT + COMMIT + TAG;

fn box_keys(key: &[u8], salt: &[u8]) -> (Aes256Gcm, [u8; 12], [u8; 32]) {
    let okm = derive::<76>(key, salt, "box", &[]);
    let aes_key: [u8; 32] = array(&okm[..32]);
    (
        Aes256Gcm::new(&aes_key.into()),
        array(&okm[32..44]),
        array(&okm[44..]),
    )
}

/// # Panics
/// If the operating system has no random source, which Flow can't run without.
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    SysRng
        .try_fill_bytes(&mut bytes)
        .expect("the OS random source is available");
    bytes
}

pub fn seal(key: &[u8], aad: &[u8], plaintext: &[u8]) -> Vec<u8> {
    seal_with_salt(key, aad, plaintext, &random_bytes::<SALT>())
}

/// Only for reproducing test vectors; production boxes take a fresh random salt.
///
/// # Panics
/// Never: AES-GCM fails only above 64 GiB of plaintext.
pub fn seal_with_salt(key: &[u8], aad: &[u8], plaintext: &[u8], salt: &[u8; SALT]) -> Vec<u8> {
    let (cipher, nonce, commit) = box_keys(key, salt);
    let sealed = cipher
        .encrypt(
            &Nonce::from(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .expect("AES-GCM encryption can't fail for these sizes");
    [&salt[..], &commit, &sealed].concat()
}

pub fn open(key: &[u8], aad: &[u8], sealed: &[u8]) -> Result<Vec<u8>> {
    if sealed.len() < BOX_OVERHEAD {
        return Err(Error::Length);
    }
    let (cipher, nonce, commit) = box_keys(key, &sealed[..SALT]);
    if !bool::from(commit.ct_eq(&sealed[SALT..SALT + COMMIT])) {
        return Err(Error::Commitment);
    }
    cipher
        .decrypt(
            &Nonce::from(nonce),
            Payload {
                msg: &sealed[SALT + COMMIT..],
                aad,
            },
        )
        .map_err(|_| Error::Decrypt)
}
