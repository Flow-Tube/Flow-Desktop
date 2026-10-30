//! The user name and password of the group's `WebDAV` folder, kept only in the OS keychain next to
//! the device keys.

use super::webdav::WebDavLogin;
use crate::security::keychain::{CredentialError, CredentialStore};

const WEBDAV_ENTRY: &str = "WEBDAV";

pub fn save_login(store: &dyn CredentialStore, login: &WebDavLogin) -> Result<(), CredentialError> {
    let value = serde_json::to_string(login)
        .map_err(|_| CredentialError("Could not encode the WebDAV login"))?;
    store.write(WEBDAV_ENTRY, &value)
}

pub fn load_login(store: &dyn CredentialStore) -> Result<WebDavLogin, CredentialError> {
    store
        .read(WEBDAV_ENTRY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .ok_or(CredentialError("No WebDAV login is saved"))
}

pub fn forget_login(store: &dyn CredentialStore) -> Result<(), CredentialError> {
    store.remove(WEBDAV_ENTRY)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::keychain::memory::MemoryStore;

    #[test]
    fn a_login_is_saved_read_back_and_forgotten() {
        let store = MemoryStore::default();
        assert!(load_login(&store).is_err());
        let login = WebDavLogin {
            user: "me".into(),
            password: "secret".into(),
        };
        save_login(&store, &login).unwrap();
        assert_eq!(load_login(&store).unwrap(), login);
        forget_login(&store).unwrap();
        assert!(load_login(&store).is_err());
    }
}
