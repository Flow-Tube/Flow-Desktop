//! HPKE wraps of epoch keys (RFC 9180 base mode, X25519, HKDF-SHA256, AES-256-GCM).

use hpke::aead::AesGcm256;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::rand_core::{CryptoRng, UnwrapErr};
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use rand::rngs::SysRng;

use super::kdf::tag;
use super::{Error, Result};

type Suite = X25519HkdfSha256;
type PublicKey = <Suite as Kem>::PublicKey;
type PrivateKey = <Suite as Kem>::PrivateKey;
type EncappedKey = <Suite as Kem>::EncappedKey;

pub const WRAP_SIZE: usize = 80;
const ENC_SIZE: usize = 32;

fn info(group: &[u8], epoch: u32, did: &[u8]) -> Vec<u8> {
    [&tag("wrap"), group, &epoch.to_be_bytes(), did].concat()
}

pub fn wrap_epoch_key(
    kem_public: &[u8],
    group: &[u8],
    epoch: u32,
    did: &[u8],
    epoch_key: &[u8],
) -> Result<Vec<u8>> {
    wrap_epoch_key_with_rng(
        kem_public,
        group,
        epoch,
        did,
        epoch_key,
        &mut UnwrapErr(SysRng),
    )
}

/// The RNG supplies the 32 bytes the ephemeral key is derived from; tests pass a fixed one.
pub fn wrap_epoch_key_with_rng(
    kem_public: &[u8],
    group: &[u8],
    epoch: u32,
    did: &[u8],
    epoch_key: &[u8],
    rng: &mut impl CryptoRng,
) -> Result<Vec<u8>> {
    let recipient = PublicKey::from_bytes(kem_public).map_err(|_| Error::X25519)?;
    let (enc, ciphertext) = hpke::single_shot_seal_with_rng::<AesGcm256, HkdfSha256, Suite>(
        &OpModeS::Base,
        &recipient,
        &info(group, epoch, did),
        epoch_key,
        &[],
        rng,
    )
    .map_err(|_| Error::X25519)?;
    Ok([enc.to_bytes().as_slice(), &ciphertext].concat())
}

pub fn unwrap_epoch_key(
    kem_secret: &[u8],
    group: &[u8],
    epoch: u32,
    did: &[u8],
    wrap: &[u8],
) -> Result<Vec<u8>> {
    if wrap.len() != WRAP_SIZE {
        return Err(Error::Length);
    }
    let secret = PrivateKey::from_bytes(kem_secret).map_err(|_| Error::X25519)?;
    let enc = EncappedKey::from_bytes(&wrap[..ENC_SIZE]).map_err(|_| Error::Decrypt)?;
    hpke::single_shot_open::<AesGcm256, HkdfSha256, Suite>(
        &OpModeR::Base,
        &secret,
        &enc,
        &info(group, epoch, did),
        &wrap[ENC_SIZE..],
        &[],
    )
    .map_err(|_| Error::Decrypt)
}
