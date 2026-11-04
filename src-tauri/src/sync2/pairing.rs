use super::Result;
use super::curve::agree;
use super::kdf::{derive, labeled_id, tag};

pub struct PairingKeys {
    /// Seals messages from the device showing the code.
    pub shower_key: Vec<u8>,
    /// Seals messages from the scanner.
    pub scanner_key: Vec<u8>,
    pub sas: String,
}

pub fn pairing_keys(
    own_secret: &[u8; 32],
    peer_public: &[u8],
    token: &[u8],
    shower_public: &[u8],
    scanner_public: &[u8],
) -> Result<PairingKeys> {
    let shared = agree(own_secret, peer_public)?;
    let transcript = [shower_public, scanner_public].concat();
    let sas =
        (u32::from_be_bytes(derive(&shared, token, "sas", &transcript)) & 0x7fff_ffff) % 1_000_000;
    Ok(PairingKeys {
        shower_key: derive::<32>(&shared, token, "pair a2b", &transcript).to_vec(),
        scanner_key: derive::<32>(&shared, token, "pair b2a", &transcript).to_vec(),
        sas: format!("{sas:06}"),
    })
}

pub fn pairing_aad(token: &[u8], seq: u64) -> Vec<u8> {
    [&tag("pair"), token, &seq.to_be_bytes()].concat()
}

pub fn pairing_slot(token: &[u8]) -> [u8; 16] {
    labeled_id("pair", token)
}
