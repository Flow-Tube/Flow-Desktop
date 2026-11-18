//! The OS keychain behind a small trait, so features keep secrets out of the settings table and
//! tests can use memory instead.

use std::sync::{Arc, Mutex, PoisonError};

use keyring_core::{CredentialStore as PlatformStore, Error as KeyringError};
use serde::Serialize;

/// What kept the keychain from answering, so the app can say what to do about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeychainProblem {
    /// Another read is waiting on access, for example on the macOS prompt.
    Waiting,
    /// The keychain is there but locked, or access was refused.
    Locked,
    /// No keychain answered: on Linux, no Secret Service is running.
    Unavailable,
    /// Anything else, a damaged item included.
    Failed,
}

/// Why the keychain could not be used. Carries no secret material.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct CredentialError {
    pub problem: KeychainProblem,
    pub message: &'static str,
}

impl CredentialError {
    pub const fn new(problem: KeychainProblem, message: &'static str) -> Self {
        Self { problem, message }
    }

    pub const fn failed(message: &'static str) -> Self {
        Self::new(KeychainProblem::Failed, message)
    }
}

const UNAVAILABLE: CredentialError = CredentialError::new(
    KeychainProblem::Unavailable,
    "No system keychain is available",
);

pub trait CredentialStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError>;
    fn write(&self, name: &str, value: &str) -> Result<(), CredentialError>;
    fn remove(&self, name: &str) -> Result<(), CredentialError>;
}

/// Runs a keychain call on a blocking thread: on macOS it waits for as long as an access prompt
/// stays open, which must never hold an async worker.
pub async fn off_thread<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, CredentialError> + Send + 'static,
) -> Result<T, CredentialError> {
    tokio::task::spawn_blocking(job)
        .await
        .unwrap_or(Err(CredentialError::failed("The keychain call failed")))
}

/// The platform store, opened on first use. A store that failed to open is not kept, so the next
/// call tries again: on Linux the Secret Service can start after Flow does.
static STORE: Mutex<Option<Arc<PlatformStore>>> = Mutex::new(None);

fn platform_store() -> Result<Arc<PlatformStore>, CredentialError> {
    let mut slot = STORE.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(store) = slot.as_ref() {
        return Ok(Arc::clone(store));
    }
    let store = open_platform_store().map_err(|error| {
        // Opening reads no item, so the error has no secret in it.
        tracing::warn!(target: "flow::keychain", %error, "system keychain could not be opened");
        UNAVAILABLE
    })?;
    *slot = Some(Arc::clone(&store));
    Ok(store)
}

#[cfg(target_os = "macos")]
fn open_platform_store() -> keyring_core::Result<Arc<PlatformStore>> {
    Ok(apple_native_keyring_store::keychain::Store::new()?)
}

#[cfg(windows)]
fn open_platform_store() -> keyring_core::Result<Arc<PlatformStore>> {
    Ok(windows_native_keyring_store::Store::new()?)
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "ios", target_os = "android"))
))]
fn open_platform_store() -> keyring_core::Result<Arc<PlatformStore>> {
    Ok(zbus_secret_service_keyring_store::Store::new()?)
}

#[cfg(not(any(windows, all(unix, not(any(target_os = "ios", target_os = "android"))))))]
fn open_platform_store() -> keyring_core::Result<Arc<PlatformStore>> {
    Err(KeyringError::NoDefaultStore)
}

/// The platform keychain: Keychain Services, the Windows Credential Manager or the Secret Service.
pub struct Keychain {
    service: &'static str,
}

impl Keychain {
    pub const fn new(service: &'static str) -> Self {
        Self { service }
    }

    fn entry(&self, name: &str) -> Result<keyring_core::Entry, CredentialError> {
        platform_store()?
            .build(self.service, name, None)
            .map_err(|error| describe(&error))
    }
}

impl CredentialStore for Keychain {
    fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
        match self.entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
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
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(describe(&error)),
        }
    }
}

/// A fixed description per failure: the keyring errors can carry the stored bytes.
fn describe(error: &KeyringError) -> CredentialError {
    match error {
        KeyringError::NoStorageAccess(_) => CredentialError::new(
            KeychainProblem::Locked,
            "The system keychain is locked or refused access",
        ),
        KeyringError::NoDefaultStore | KeyringError::NotSupportedByStore(_) => UNAVAILABLE,
        KeyringError::PlatformFailure(_) => {
            // The connection may be gone, for example after the Secret Service restarted.
            *STORE.lock().unwrap_or_else(PoisonError::into_inner) = None;
            CredentialError::failed("The system keychain failed")
        }
        _ => CredentialError::failed("The system keychain failed"),
    }
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
    use super::*;

    #[test]
    fn each_failure_names_what_went_wrong() {
        let platform = || -> keyring_core::error::PlatformError { "dbus".into() };
        assert_eq!(
            describe(&KeyringError::NoStorageAccess(platform())).problem,
            KeychainProblem::Locked
        );
        assert_eq!(
            describe(&KeyringError::NoDefaultStore).problem,
            KeychainProblem::Unavailable
        );
        assert_eq!(
            describe(&KeyringError::BadEncoding(b"secret".to_vec())),
            CredentialError::failed("The system keychain failed")
        );
    }

    #[test]
    fn a_failed_connection_is_opened_again_on_the_next_call() {
        let mock: Arc<PlatformStore> = keyring_core::mock::Store::new().unwrap();
        *STORE.lock().unwrap() = Some(mock);
        describe(&KeyringError::NoStorageAccess("locked".into()));
        assert!(STORE.lock().unwrap().is_some());
        describe(&KeyringError::PlatformFailure("gone".into()));
        assert!(STORE.lock().unwrap().is_none());
    }
}
