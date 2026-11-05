//! The user name and password of the group's `WebDAV` folder, kept only in the OS keychain next to
//! the device keys.

use super::device::with_keychain;
use super::webdav::WebDavLogin;
use crate::security::keychain::{CredentialError, CredentialStore};

const WEBDAV_ENTRY: &str = "WEBDAV";
/// The login that replaces it once the folder refuses it (spec/protocol.md, Replacing a store's
/// login).
const PENDING_ENTRY: &str = "WEBDAV_PENDING";

pub async fn save_login(login: &WebDavLogin) -> Result<(), CredentialError> {
    let login = login.clone();
    with_keychain(move |keychain| save(keychain, &login)).await
}

pub async fn load_login() -> Result<WebDavLogin, CredentialError> {
    with_keychain(|keychain| load(keychain)).await
}

pub async fn forget_login() -> Result<(), CredentialError> {
    with_keychain(|keychain| forget(keychain)).await
}

pub async fn save_pending_login(login: &WebDavLogin) -> Result<(), CredentialError> {
    let value = encoded(login)?;
    with_keychain(move |keychain| keychain.write(PENDING_ENTRY, &value)).await
}

pub async fn load_pending_login() -> Result<Option<WebDavLogin>, CredentialError> {
    with_keychain(|keychain| {
        Ok(keychain
            .read(PENDING_ENTRY)?
            .and_then(|value| serde_json::from_str(&value).ok()))
    })
    .await
}

pub async fn forget_pending_login() -> Result<(), CredentialError> {
    with_keychain(|keychain| keychain.remove(PENDING_ENTRY)).await
}

fn encoded(login: &WebDavLogin) -> Result<String, CredentialError> {
    serde_json::to_string(login).map_err(|_| CredentialError("Could not encode the WebDAV login"))
}

fn save(store: &dyn CredentialStore, login: &WebDavLogin) -> Result<(), CredentialError> {
    store.write(WEBDAV_ENTRY, &encoded(login)?)
}

fn load(store: &dyn CredentialStore) -> Result<WebDavLogin, CredentialError> {
    store
        .read(WEBDAV_ENTRY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .ok_or(CredentialError("No WebDAV login is saved"))
}

fn forget(store: &dyn CredentialStore) -> Result<(), CredentialError> {
    store.remove(PENDING_ENTRY)?;
    store.remove(WEBDAV_ENTRY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain::memory::MemoryStore;

    #[test]
    fn a_login_is_saved_read_back_and_forgotten() {
        let store = MemoryStore::default();
        assert!(load(&store).is_err());
        let login = WebDavLogin {
            user: "me".into(),
            password: "secret".into(),
        };
        save(&store, &login).unwrap();
        assert_eq!(load(&store).unwrap(), login);
        forget(&store).unwrap();
        assert!(load(&store).is_err());
    }
}
