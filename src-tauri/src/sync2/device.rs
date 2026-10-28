//! This installation's roster keys. They live in the OS keychain, one item for every profile,
//! because a device is one roster member however many profiles it has.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::keys::{MemberSecrets, member_secrets};
use super::sealed::random_bytes;
use crate::security::keychain::{CredentialError, CredentialStore, Keychain};

const KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    "io.github.aedev.flow.desktop.sync.dev"
} else {
    "io.github.aedev.flow.desktop.sync"
};
const DEVICE_ENTRY: &str = "DEVICE";

pub const fn keychain() -> Keychain {
    Keychain::new(KEYCHAIN_SERVICE)
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct StoredKeys {
    sig: String,
    kem: String,
}

fn decode(value: &str) -> Option<MemberSecrets> {
    let stored: StoredKeys = serde_json::from_str(value).ok()?;
    let seed = |text: &str| URL_SAFE_NO_PAD.decode(text).ok()?.try_into().ok();
    Some(member_secrets(seed(&stored.sig)?, seed(&stored.kem)?))
}

fn encode(keys: &MemberSecrets) -> Result<String, CredentialError> {
    let stored = StoredKeys {
        sig: URL_SAFE_NO_PAD.encode(keys.sig_seed),
        kem: URL_SAFE_NO_PAD.encode(keys.kem_secret),
    };
    serde_json::to_string(&stored).map_err(|_| CredentialError("Could not encode the device keys"))
}

/// Loads the keys, creating them on first use. A damaged item is an error and is never replaced:
/// new keys would silently take this device out of its group.
pub fn device_keys(store: &dyn CredentialStore) -> Result<MemberSecrets, CredentialError> {
    if let Some(value) = store.read(DEVICE_ENTRY)? {
        return decode(&value).ok_or(CredentialError(
            "The device keys in the keychain are damaged",
        ));
    }
    let keys = member_secrets(random_bytes(), random_bytes());
    store.write(DEVICE_ENTRY, &encode(&keys)?)?;
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain::memory::MemoryStore;

    #[test]
    fn keys_are_created_once_and_read_back() {
        let store = MemoryStore::default();
        let first = device_keys(&store).unwrap();
        let again = device_keys(&store).unwrap();
        assert_eq!(first.did, again.did);
        assert_eq!(first.sig_seed, again.sig_seed);
        assert_eq!(first.kem_secret, again.kem_secret);
    }

    #[test]
    fn a_damaged_item_is_reported_and_kept() {
        let store = MemoryStore::default();
        store.write(DEVICE_ENTRY, "not json").unwrap();
        assert!(device_keys(&store).is_err());
        assert_eq!(
            store.read(DEVICE_ENTRY).unwrap().as_deref(),
            Some("not json")
        );
    }

    #[test]
    fn a_refused_keychain_is_reported() {
        struct Refusing;
        impl CredentialStore for Refusing {
            fn read(&self, _: &str) -> Result<Option<String>, CredentialError> {
                Err(CredentialError("refused"))
            }
            fn write(&self, _: &str, _: &str) -> Result<(), CredentialError> {
                Err(CredentialError("refused"))
            }
            fn remove(&self, _: &str) -> Result<(), CredentialError> {
                Err(CredentialError("refused"))
            }
        }
        assert_eq!(
            device_keys(&Refusing).err(),
            Some(CredentialError("refused"))
        );
    }
}
