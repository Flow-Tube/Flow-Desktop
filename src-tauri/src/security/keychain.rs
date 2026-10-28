//! The OS keychain behind a small trait, so features keep secrets out of the settings table and
//! tests can use memory instead.

/// Why the keychain could not be used. Carries no secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct CredentialError(pub &'static str);

pub trait CredentialStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError>;
    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError>;
    fn remove(&self, name: &str) -> Result<(), CredentialError>;
}

/// The platform keychain through the `keyring` crate.
pub struct Keychain {
    service: &'static str,
}

impl Keychain {
    pub const fn new(service: &'static str) -> Self {
        Self { service }
    }

    fn entry(&self, name: &str) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(self.service, name).map_err(|error| describe(&error))
    }
}

impl CredentialStore for Keychain {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
        match self.entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(describe(&error)),
        }
    }

    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError> {
        self.entry(name)?
            .set_password(value)
            .map_err(|error| describe(&error))
    }

    fn remove(&self, name: &str) -> Result<(), CredentialError> {
        match self.entry(name)?.delete_credential() {
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
