//! Session keys, tokens and the listener's own Last.fm key live in the OS keychain, never in the
//! settings table, so sync, backups and settings exports can never carry them.

use serde::{Deserialize, Serialize};

use super::models::{Account, Service};

const KEYCHAIN_SERVICE: &str = "io.github.aedev.flow.desktop.scrobbling";
const OWN_KEY_ENTRY: &str = "LASTFM_OWN_KEY";

/// Why the keychain could not be used. Carries no secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct CredentialError(pub &'static str);

/// The listener's own Last.fm API key, used instead of the build's when enabled.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnKey {
    pub enabled: bool,
    pub api_key: String,
    pub secret: String,
}

impl std::fmt::Debug for OwnKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OwnKey")
            .field("enabled", &self.enabled)
            .field("api_key", &self.api_key)
            .field("secret", &"<redacted>")
            .finish()
    }
}

pub trait CredentialStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError>;
    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError>;
    fn remove(&self, name: &str) -> Result<(), CredentialError>;
}

pub fn read_account(
    store: &dyn CredentialStore,
    service: Service,
) -> Result<Option<Account>, CredentialError> {
    Ok(store
        .read(service.as_str())?
        .and_then(|value| serde_json::from_str::<Account>(&value).ok())
        .filter(|account| !account.secret.is_empty()))
}

pub fn write_account(
    store: &dyn CredentialStore,
    service: Service,
    account: Option<&Account>,
) -> Result<(), CredentialError> {
    match account {
        Some(account) => {
            let value = serde_json::to_string(account)
                .map_err(|_| CredentialError("Could not encode the account"))?;
            store.write(service.as_str(), &value)
        }
        None => store.remove(service.as_str()),
    }
}

pub fn read_own_key(store: &dyn CredentialStore) -> Result<OwnKey, CredentialError> {
    Ok(store
        .read(OWN_KEY_ENTRY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub fn write_own_key(store: &dyn CredentialStore, key: &OwnKey) -> Result<(), CredentialError> {
    let value =
        serde_json::to_string(key).map_err(|_| CredentialError("Could not encode the key"))?;
    store.write(OWN_KEY_ENTRY, &value)
}

/// The platform keychain through the `keyring` crate.
pub struct Keychain;

impl Keychain {
    fn entry(name: &str) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|error| describe(&error))
    }
}

impl CredentialStore for Keychain {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
        match Self::entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(&error)),
        }
    }

    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|error| describe(&error))
    }

    fn remove(&self, name: &str) -> Result<(), CredentialError> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(&error)),
        }
    }
}

/// A fixed description per failure: the keyring errors can carry the stored bytes.
fn describe(error: &keyring::Error) -> CredentialError {
    CredentialError(match error {
        keyring::Error::NoStorageAccess(_) => "The system keychain is locked or refused access",
        keyring::Error::NoDefaultStore | keyring::Error::NotSupportedByStore(_) => {
            "No system keychain is available"
        }
        _ => "The system keychain failed",
    })
}

#[cfg(test)]
pub mod memory {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{CredentialError, CredentialStore};

    /// An in-memory stand-in for the keychain in tests.
    #[derive(Default)]
    pub struct MemoryStore(pub Mutex<HashMap<String, String>>);

    impl CredentialStore for MemoryStore {
        fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
            Ok(self.0.lock().unwrap().get(name).cloned())
        }

        fn write(&self, name: &str, value: &str) -> Result<(), CredentialError> {
            self.0
                .lock()
                .unwrap()
                .insert(name.to_string(), value.to_string());
            Ok(())
        }

        fn remove(&self, name: &str) -> Result<(), CredentialError> {
            self.0.lock().unwrap().remove(name);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::memory::MemoryStore;
    use super::*;

    #[test]
    fn accounts_round_trip_and_sign_out_removes_them() {
        let store = MemoryStore::default();
        let account = Account {
            user_name: "listener".into(),
            secret: "SK".into(),
        };
        write_account(&store, Service::LastFm, Some(&account)).unwrap();
        assert_eq!(
            read_account(&store, Service::LastFm).unwrap(),
            Some(account)
        );
        assert_eq!(read_account(&store, Service::LibreFm).unwrap(), None);
        write_account(&store, Service::LastFm, None).unwrap();
        assert_eq!(read_account(&store, Service::LastFm).unwrap(), None);
    }

    #[test]
    fn an_account_never_prints_its_secret() {
        let account = Account {
            user_name: "listener".into(),
            secret: "SESSION-KEY".into(),
        };
        assert!(!format!("{account:?}").contains("SESSION-KEY"));
    }

    #[test]
    fn a_missing_own_key_reads_as_disabled() {
        let store = MemoryStore::default();
        assert_eq!(read_own_key(&store).unwrap(), OwnKey::default());
    }
}
