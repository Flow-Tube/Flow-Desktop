use bip39::{Language, Mnemonic};

use super::kdf::derive;
use super::keys::{MemberSecrets, member_secrets};

/// # Panics
/// Never: 32 bytes is valid BIP-39 entropy.
pub fn recovery_words(secret: &[u8; 32]) -> String {
    Mnemonic::from_entropy_in(Language::English, secret)
        .expect("32 bytes is valid entropy")
        .to_string()
}

/// `None` for an unknown word, a wrong checksum, or anything but 24 words.
pub fn recovery_secret(words: &str) -> Option<[u8; 32]> {
    let normalized = words
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let mnemonic = Mnemonic::parse_in_normalized(Language::English, &normalized).ok()?;
    mnemonic.to_entropy().try_into().ok()
}

pub fn recovery_keys(secret: &[u8; 32]) -> MemberSecrets {
    let derived = |label| derive::<32>(secret, &[], label, &[]);
    member_secrets(derived("recovery sig"), derived("recovery kem"))
}
