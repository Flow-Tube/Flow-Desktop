//! Session keys, tokens and the listener's own Last.fm key live in the OS keychain, never in the
//! settings table, so sync, backups and settings exports can never carry them.
//!
//! On macOS every read of an item another build wrote raises a password prompt, so everything
//! lives in one item: loading the credentials asks at most once.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::models::{Account, Service};

// Debug builds keep their own item, so a dev build and an installed Flow never take turns asking
// for each other's.
const KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    "io.github.aedev.flow.desktop.scrobbling.dev"
} else {
    "io.github.aedev.flow.desktop.scrobbling"
};
const CREDENTIALS_ENTRY: &str = "CREDENTIALS";
/// Before one item held everything, each account (by service name) and the own key had their own.
const LEGACY_OWN_KEY_ENTRY: &str = "LASTFM_OWN_KEY";

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

/// Everything the keychain item holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Credentials {
    pub accounts: HashMap<Service, Account>,
    pub own_key: OwnKey,
}

impl Credentials {
    fn is_empty(&self) -> bool {
        self.accounts.is_empty() && self.own_key == OwnKey::default()
    }

    fn without_blank_accounts(mut self) -> Self {
        self.accounts
            .retain(|_, account| !account.secret.is_empty());
        self
    }
}

pub trait CredentialStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError>;
    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError>;
    fn remove(&self, name: &str) -> Result<(), CredentialError>;
}

/// Reads the one item, moving the older per-account items into it the first time.
pub fn load(store: &dyn CredentialStore) -> Result<Credentials, CredentialError> {
    if let Some(value) = store.read(CREDENTIALS_ENTRY)? {
        return Ok(serde_json::from_str::<Credentials>(&value)
            .unwrap_or_default()
            .without_blank_accounts());
    }
    let legacy = load_legacy(store)?;
    if !legacy.is_empty() {
        save(store, &legacy)?;
        for name in legacy_entries() {
            if store.remove(name).is_err() {
                tracing::warn!(
                    entry = name,
                    "Could not remove an old scrobbling keychain item"
                );
            }
        }
    }
    Ok(legacy)
}

/// Writes the one item; with nothing left to keep, the item is removed instead.
pub fn save(store: &dyn CredentialStore, credentials: &Credentials) -> Result<(), CredentialError> {
    if credentials.is_empty() {
        return store.remove(CREDENTIALS_ENTRY);
    }
    let value = serde_json::to_string(credentials)
        .map_err(|_| CredentialError("Could not encode the credentials"))?;
    store.write(CREDENTIALS_ENTRY, &value)
}

fn legacy_entries() -> impl Iterator<Item = &'static str> {
    Service::ALL
        .into_iter()
        .map(Service::as_str)
        .chain([LEGACY_OWN_KEY_ENTRY])
}

fn load_legacy(store: &dyn CredentialStore) -> Result<Credentials, CredentialError> {
    let mut accounts = HashMap::new();
    for service in Service::ALL {
        if let Some(account) = store
            .read(service.as_str())?
            .and_then(|value| serde_json::from_str::<Account>(&value).ok())
        {
            accounts.insert(service, account);
        }
    }
    let own_key = store
        .read(LEGACY_OWN_KEY_ENTRY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    Ok(Credentials { accounts, own_key }.without_blank_accounts())
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

    fn account(secret: &str) -> Account {
        Account {
            user_name: "listener".into(),
            secret: secret.into(),
        }
    }

    #[test]
    fn credentials_round_trip_through_one_item() {
        let store = MemoryStore::default();
        let mut credentials = Credentials::default();
        credentials.accounts.insert(Service::LastFm, account("SK"));
        credentials.own_key.api_key = "key".into();
        save(&store, &credentials).unwrap();

        assert_eq!(store.0.lock().unwrap().len(), 1);
        assert_eq!(load(&store).unwrap(), credentials);
    }

    #[test]
    fn nothing_to_keep_removes_the_item() {
        let store = MemoryStore::default();
        let mut credentials = Credentials::default();
        credentials
            .accounts
            .insert(Service::ListenBrainz, account("token"));
        save(&store, &credentials).unwrap();
        save(&store, &Credentials::default()).unwrap();
        assert!(store.0.lock().unwrap().is_empty());
    }

    #[test]
    fn the_old_items_move_into_one_and_are_removed() {
        let store = MemoryStore::default();
        store
            .write("LASTFM", &serde_json::to_string(&account("SK")).unwrap())
            .unwrap();
        store
            .write("LIBREFM", &serde_json::to_string(&account("")).unwrap())
            .unwrap();
        store
            .write(
                LEGACY_OWN_KEY_ENTRY,
                r#"{"enabled":true,"apiKey":"abc","secret":"s"}"#,
            )
            .unwrap();

        let loaded = load(&store).unwrap();
        assert_eq!(loaded.accounts.len(), 1);
        assert_eq!(loaded.accounts[&Service::LastFm], account("SK"));
        assert!(loaded.own_key.enabled);
        let items = store.0.lock().unwrap();
        assert_eq!(items.keys().collect::<Vec<_>>(), [CREDENTIALS_ENTRY]);
    }

    #[test]
    fn an_account_never_prints_its_secret() {
        let account = account("SESSION-KEY");
        assert!(!format!("{account:?}").contains("SESSION-KEY"));
        let mut credentials = Credentials::default();
        credentials.accounts.insert(Service::LastFm, account);
        credentials.own_key.secret = "OWN-SECRET".into();
        let printed = format!("{credentials:?}");
        assert!(!printed.contains("SESSION-KEY") && !printed.contains("OWN-SECRET"));
    }

    #[test]
    fn a_missing_item_reads_as_signed_out() {
        assert_eq!(
            load(&MemoryStore::default()).unwrap(),
            Credentials::default()
        );
    }
}
