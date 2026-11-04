//! This device's roster keys. They live in the OS keychain, one item for every profile, because a
//! device is one roster member however many profiles it has. They belong to one membership
//! (spec/crypto.md, Device keys): fresh for each group joined, deleted once it is left.

use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::keys::{MemberSecrets, member_secrets};
use super::sealed::random_bytes;
use crate::security::keychain::{CredentialError, CredentialStore, Keychain, off_thread};

const KEYCHAIN_SERVICE: &str = if cfg!(debug_assertions) {
    "io.github.aedev.flow.desktop.sync.dev"
} else {
    "io.github.aedev.flow.desktop.sync"
};
const DEVICE_ENTRY: &str = "DEVICE";

const fn keychain() -> Keychain {
    Keychain::new(KEYCHAIN_SERVICE)
}

/// Runs `job` on the keychain, off the async workers.
pub async fn with_keychain<T: Send + 'static>(
    job: impl FnOnce(&Keychain) -> Result<T, CredentialError> + Send + 'static,
) -> Result<T, CredentialError> {
    off_thread(move || job(&keychain())).await
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
fn device_keys(store: &dyn CredentialStore) -> Result<MemberSecrets, CredentialError> {
    match store.read(DEVICE_ENTRY)? {
        Some(value) => decode(&value).ok_or(CredentialError(
            "The device keys in the keychain are damaged",
        )),
        None => renew_device_keys(store),
    }
}

/// Replaces the keys with fresh ones, for a group this device is about to create or join.
fn renew_device_keys(store: &dyn CredentialStore) -> Result<MemberSecrets, CredentialError> {
    let keys = member_secrets(random_bytes(), random_bytes());
    store.write(DEVICE_ENTRY, &encode(&keys)?)?;
    Ok(keys)
}

fn forget_device_keys(store: &dyn CredentialStore) -> Result<(), CredentialError> {
    store.remove(DEVICE_ENTRY)
}

/// Returned to a caller while another one's read waits on the keychain, for example on the macOS
/// access prompt.
pub const WAITING: CredentialError = CredentialError("Waiting for access to the keychain");

enum Slot {
    Unread,
    Reading,
    Loaded(MemberSecrets),
    /// Kept until [`DeviceKeys::retry`], so background syncs don't raise the prompt again.
    Refused(CredentialError),
}

fn lock(slot: &Mutex<Slot>) -> MutexGuard<'_, Slot> {
    slot.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The device keys, read from the keychain once a launch and then kept in memory.
pub struct DeviceKeys {
    store: Arc<dyn CredentialStore>,
    slot: Arc<Mutex<Slot>>,
}

pub static DEVICE_KEYS: LazyLock<DeviceKeys> =
    LazyLock::new(|| DeviceKeys::new(Arc::new(keychain())));

impl DeviceKeys {
    fn new(store: Arc<dyn CredentialStore>) -> Self {
        Self {
            store,
            slot: Arc::new(Mutex::new(Slot::Unread)),
        }
    }

    /// The keys, creating them on first use. One read at a time: other callers get [`WAITING`]
    /// rather than a prompt each.
    pub async fn get(&self) -> Result<MemberSecrets, CredentialError> {
        {
            let mut slot = lock(&self.slot);
            match &*slot {
                Slot::Loaded(keys) => return Ok(keys.clone()),
                Slot::Reading => return Err(WAITING),
                Slot::Refused(error) => return Err(error.clone()),
                Slot::Unread => *slot = Slot::Reading,
            }
        }
        let (store, slot) = (Arc::clone(&self.store), Arc::clone(&self.slot));
        // Settled on the blocking thread, so a caller that stops waiting can't leave it reading.
        off_thread(move || {
            let read = device_keys(store.as_ref());
            *lock(&slot) = match &read {
                Ok(keys) => Slot::Loaded(keys.clone()),
                Err(error) => Slot::Refused(error.clone()),
            };
            read
        })
        .await
    }

    /// Replaces the keys with fresh ones, for a group this device is about to create or join.
    pub async fn renew(&self) -> Result<MemberSecrets, CredentialError> {
        if matches!(*lock(&self.slot), Slot::Reading) {
            return Err(WAITING);
        }
        let store = Arc::clone(&self.store);
        let keys = off_thread(move || renew_device_keys(store.as_ref())).await?;
        *lock(&self.slot) = Slot::Loaded(keys.clone());
        Ok(keys)
    }

    pub async fn forget(&self) -> Result<(), CredentialError> {
        let store = Arc::clone(&self.store);
        off_thread(move || forget_device_keys(store.as_ref())).await?;
        *lock(&self.slot) = Slot::Unread;
        Ok(())
    }

    /// The keys in memory, without asking the keychain.
    pub fn loaded(&self) -> Option<MemberSecrets> {
        match &*lock(&self.slot) {
            Slot::Loaded(keys) => Some(keys.clone()),
            _ => None,
        }
    }

    /// Whether syncing waits on the keychain: a read waits for access, or access was refused.
    pub fn blocked(&self) -> bool {
        matches!(*lock(&self.slot), Slot::Reading | Slot::Refused(_))
    }

    /// Forgets a refusal, so the next read asks the keychain again.
    pub fn retry(&self) {
        let mut slot = lock(&self.slot);
        if matches!(*slot, Slot::Refused(_)) {
            *slot = Slot::Unread;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc;

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
    fn each_membership_gets_fresh_keys_and_leaving_deletes_them() {
        let store = MemoryStore::default();
        let first = device_keys(&store).unwrap();
        let renewed = renew_device_keys(&store).unwrap();
        assert_ne!(first.did, renewed.did);
        assert_eq!(device_keys(&store).unwrap().did, renewed.did);
        forget_device_keys(&store).unwrap();
        assert_eq!(store.read(DEVICE_ENTRY).unwrap(), None);
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

    /// Counts reads; the first can be held open, as an access prompt does, and reads can be
    /// refused.
    #[derive(Default)]
    struct Prompting {
        inner: MemoryStore,
        reads: AtomicUsize,
        refuse: AtomicBool,
        prompt: Mutex<Option<mpsc::Receiver<()>>>,
    }

    impl CredentialStore for Prompting {
        fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let prompt = self.prompt.lock().unwrap().take();
            if let Some(answered) = prompt {
                let _ = answered.recv();
            }
            if self.refuse.load(Ordering::SeqCst) {
                return Err(CredentialError("refused"));
            }
            self.inner.read(name)
        }
        fn write(&self, name: &str, value: &str) -> Result<(), CredentialError> {
            self.inner.write(name, value)
        }
        fn remove(&self, name: &str) -> Result<(), CredentialError> {
            self.inner.remove(name)
        }
    }

    #[tokio::test]
    async fn one_read_a_launch_and_callers_meanwhile_are_told_to_wait() {
        let (answer, answered) = mpsc::channel();
        let store = Arc::new(Prompting::default());
        *store.prompt.lock().unwrap() = Some(answered);
        let keys = Arc::new(DeviceKeys::new(store.clone()));

        let first = tokio::spawn({
            let keys = Arc::clone(&keys);
            async move { keys.get().await }
        });
        while store.reads.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        assert_eq!(keys.get().await.err(), Some(WAITING));
        assert!(keys.blocked());

        answer.send(()).unwrap();
        let read = first.await.unwrap().unwrap();
        assert_eq!(keys.get().await.unwrap().did, read.did);
        assert_eq!(store.reads.load(Ordering::SeqCst), 1);
        assert!(!keys.blocked());
    }

    #[tokio::test]
    async fn a_refusal_is_kept_until_retried() {
        let store = Arc::new(Prompting::default());
        store.refuse.store(true, Ordering::SeqCst);
        let keys = DeviceKeys::new(store.clone());

        assert!(keys.get().await.is_err());
        assert!(keys.get().await.is_err());
        assert_eq!(store.reads.load(Ordering::SeqCst), 1);
        assert!(keys.blocked());

        store.refuse.store(false, Ordering::SeqCst);
        keys.retry();
        assert!(keys.get().await.is_ok());
        assert_eq!(store.reads.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn renewing_and_forgetting_change_the_keys_in_memory() {
        let keys = DeviceKeys::new(Arc::new(MemoryStore::default()));
        let first = keys.get().await.unwrap();
        let renewed = keys.renew().await.unwrap();
        assert_ne!(first.did, renewed.did);
        assert_eq!(keys.loaded().unwrap().did, renewed.did);

        keys.forget().await.unwrap();
        assert!(keys.loaded().is_none());
        assert_ne!(keys.get().await.unwrap().did, renewed.did);
    }
}
