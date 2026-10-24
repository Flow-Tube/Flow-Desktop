//! Sends what the music player plays to every signed-in service. Counted listens are queued first
//! and sent by the worker, so a listen survives going offline or quitting.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::Notify;

use super::SignInError;
use super::audioscrobbler::{self, Client, Keys};
use super::credentials::{self, CredentialError, CredentialStore, OwnKey};
use super::listenbrainz;
use super::models::{Account, ScrobbleEntry, SendOutcome, Service};
use super::queue::{self, Table};
use super::rules::{self, TrackInfo};
use crate::errors::{AppError, AppResult};

const LAST_FM: Client = Client::new(audioscrobbler::LASTFM_URL);
const LIBRE_FM: Client = Client::new(audioscrobbler::LIBREFM_URL);
const VISIBLE_KEY_CHARS: usize = 6;

#[derive(Clone, Default)]
struct Credentials {
    accounts: HashMap<Service, Account>,
    own_key: OwnKey,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub service: Service,
    pub signed_in: bool,
    pub user_name: Option<String>,
    pub waiting: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrobbleStatus {
    pub services: Vec<ServiceStatus>,
    /// Last.fm sign-in has a key to sign with: the build's, or the listener's own.
    pub last_fm_ready: bool,
    pub own_key_enabled: bool,
    /// The first characters of the listener's own API key, never the secret.
    pub own_key_hint: Option<String>,
    /// Set when the system keychain cannot be used, so nothing can sign in.
    pub keychain_error: Option<String>,
}

pub struct Scrobbler {
    pool: SqlitePool,
    store: Arc<dyn CredentialStore>,
    cache: Mutex<Option<Credentials>>,
    flush_lock: tokio::sync::Mutex<()>,
    pub(super) wake: Notify,
}

impl Scrobbler {
    pub fn new(pool: SqlitePool, store: Arc<dyn CredentialStore>) -> Self {
        Self {
            pool,
            store,
            cache: Mutex::new(None),
            flush_lock: tokio::sync::Mutex::new(()),
            wake: Notify::new(),
        }
    }

    /// The key Last.fm calls are signed with: the listener's own when they turned it on, else the
    /// build's. `None` when neither is usable.
    fn last_fm_keys(own_key: &OwnKey) -> Option<Keys> {
        let keys = if own_key.enabled {
            Keys {
                api_key: own_key.api_key.clone(),
                secret: own_key.secret.clone(),
            }
        } else {
            Keys::bundled_last_fm()
        };
        keys.is_usable().then_some(keys)
    }

    async fn blocking<T: Send + 'static>(
        &self,
        job: impl FnOnce(&dyn CredentialStore) -> Result<T, CredentialError> + Send + 'static,
    ) -> AppResult<T> {
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || job(store.as_ref()))
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?
            .map_err(|error| AppError::Keychain(error.to_string()))
    }

    async fn credentials(&self) -> AppResult<Credentials> {
        if let Some(cached) = self.lock_cache().clone() {
            return Ok(cached);
        }
        let loaded = self
            .blocking(|store| {
                let mut accounts = HashMap::new();
                for service in Service::ALL {
                    if let Some(account) = credentials::read_account(store, service)? {
                        accounts.insert(service, account);
                    }
                }
                Ok(Credentials {
                    accounts,
                    own_key: credentials::read_own_key(store)?,
                })
            })
            .await?;
        *self.lock_cache() = Some(loaded.clone());
        Ok(loaded)
    }

    fn lock_cache(&self) -> std::sync::MutexGuard<'_, Option<Credentials>> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub async fn status(&self) -> AppResult<ScrobbleStatus> {
        let (creds, keychain_error) = match self.credentials().await {
            Ok(creds) => (creds, None),
            Err(error) => (Credentials::default(), Some(error.to_string())),
        };
        let mut services = Vec::new();
        for service in Service::ALL {
            let account = creds.accounts.get(&service);
            services.push(ServiceStatus {
                service,
                signed_in: account.is_some(),
                user_name: account
                    .map(|a| a.user_name.clone())
                    .filter(|name| !name.is_empty()),
                waiting: queue::waiting(&self.pool, service).await?,
            });
        }
        let api_key = creds.own_key.api_key.trim();
        Ok(ScrobbleStatus {
            services,
            last_fm_ready: Self::last_fm_keys(&creds.own_key).is_some(),
            own_key_enabled: creds.own_key.enabled,
            own_key_hint: (!api_key.is_empty())
                .then(|| api_key.chars().take(VISIBLE_KEY_CHARS).collect()),
            keychain_error,
        })
    }

    /// Signs in with a user name and password (Last.fm, Libre.fm) or a user token (`ListenBrainz`).
    /// The password is sent once and never kept.
    pub async fn sign_in(
        &self,
        service: Service,
        user_name: &str,
        password_or_token: &str,
    ) -> AppResult<()> {
        let creds = self.credentials().await?;
        let result = match service {
            Service::LastFm => {
                let keys = Self::last_fm_keys(&creds.own_key).ok_or_else(|| {
                    AppError::ScrobbleKeyMissing("This build has no Last.fm API key".into())
                })?;
                LAST_FM
                    .sign_in(user_name.trim(), password_or_token, &keys)
                    .await
            }
            Service::LibreFm => {
                LIBRE_FM
                    .sign_in(user_name.trim(), password_or_token, &Keys::libre_fm())
                    .await
            }
            Service::ListenBrainz => listenbrainz::sign_in(password_or_token.trim()).await,
        };
        let account = result.map_err(|error| match error {
            SignInError::Rejected(message) => AppError::ScrobbleSignInRejected(message),
            SignInError::Network(message) => AppError::Network(message),
        })?;
        self.set_account(service, Some(account)).await
    }

    async fn set_account(&self, service: Service, account: Option<Account>) -> AppResult<()> {
        let stored = account.clone();
        self.blocking(move |store| credentials::write_account(store, service, stored.as_ref()))
            .await?;
        if let Some(cache) = self.lock_cache().as_mut() {
            match account {
                Some(account) => {
                    cache.accounts.insert(service, account);
                }
                None => {
                    cache.accounts.remove(&service);
                }
            }
        }
        Ok(())
    }

    /// Signing out drops the listens still waiting for that account, as on Android.
    pub async fn sign_out(&self, service: Service) -> AppResult<()> {
        self.set_account(service, None).await?;
        queue::clear(&self.pool, service).await
    }

    /// A Last.fm session belongs to the key it was made with, so changing the key signs out.
    /// A missing key or secret keeps the stored one, so the switch alone can be flipped.
    pub async fn set_own_key(
        &self,
        enabled: bool,
        api_key: Option<String>,
        secret: Option<String>,
    ) -> AppResult<()> {
        let before = self.credentials().await?.own_key;
        let next = OwnKey {
            enabled,
            api_key: api_key.map_or_else(|| before.api_key.clone(), |key| key.trim().to_string()),
            secret: secret
                .map_or_else(|| before.secret.clone(), |secret| secret.trim().to_string()),
        };
        let stored = next.clone();
        self.blocking(move |store| credentials::write_own_key(store, &stored))
            .await?;
        if let Some(cache) = self.lock_cache().as_mut() {
            cache.own_key = next.clone();
        }
        let changed = before.enabled != next.enabled
            || (next.enabled && (before.api_key != next.api_key || before.secret != next.secret));
        if changed {
            self.sign_out(Service::LastFm).await?;
        }
        Ok(())
    }

    /// Shows the song as now playing on every signed-in service.
    pub async fn now_playing(&self, track: &TrackInfo) -> AppResult<()> {
        let Some(entry) = rules::entry_for(track, now_ms()) else {
            return Ok(());
        };
        let creds = self.credentials().await?;
        for (service, account) in &creds.accounts {
            let outcome = match service {
                Service::LastFm => match Self::last_fm_keys(&creds.own_key) {
                    Some(keys) => {
                        LAST_FM
                            .send(
                                audioscrobbler::now_playing_params(&entry, &account.secret),
                                &keys,
                            )
                            .await
                    }
                    None => continue,
                },
                Service::LibreFm => {
                    LIBRE_FM
                        .send(
                            audioscrobbler::now_playing_params(&entry, &account.secret),
                            &Keys::libre_fm(),
                        )
                        .await
                }
                Service::ListenBrainz => listenbrainz::now_playing(&entry, account).await,
            };
            if outcome == SendOutcome::SignedOut {
                tracing::warn!(
                    service = service.as_str(),
                    "Scrobbling service signed the account out"
                );
                self.sign_out(*service).await?;
            }
        }
        Ok(())
    }

    /// Queues a listen that counts for every signed-in service. True when it was queued.
    pub async fn listened(
        &self,
        track: &TrackInfo,
        played_ms: u64,
        started_at_ms: i64,
    ) -> AppResult<bool> {
        if !rules::counts(track.duration_ms, played_ms) {
            return Ok(false);
        }
        let Some(entry) = rules::entry_for(track, started_at_ms) else {
            return Ok(false);
        };
        let creds = self.credentials().await?;
        if creds.accounts.is_empty() {
            return Ok(false);
        }
        for service in creds.accounts.keys() {
            queue::enqueue(&self.pool, *service, &entry).await?;
        }
        self.wake.notify_one();
        Ok(true)
    }

    /// Mirrors a like or unlike as a love on the services that have one.
    pub async fn love(&self, track: &TrackInfo, loved: bool) -> AppResult<()> {
        let Some(love) = rules::love_for(track, loved) else {
            return Ok(());
        };
        let creds = self.credentials().await?;
        let mut queued = false;
        for service in creds.accounts.keys().filter(|s| s.takes_loves()) {
            queue::enqueue_love(&self.pool, *service, &love).await?;
            queued = true;
        }
        if queued {
            self.wake.notify_one();
        }
        Ok(())
    }

    /// Sends every queued listen and love. False when something is left to retry.
    pub async fn flush(&self) -> AppResult<bool> {
        let _guard = self.flush_lock.lock().await;
        let mut anything_waiting = false;
        for service in Service::ALL {
            anything_waiting |= queue::waiting(&self.pool, service).await? > 0;
        }
        if !anything_waiting {
            return Ok(true);
        }
        let creds = self.credentials().await?;
        let mut done = true;
        for (service, account) in &creds.accounts {
            if !self
                .flush_service(*service, account, &creds.own_key)
                .await?
            {
                done = false;
            }
        }
        Ok(done)
    }

    async fn flush_service(
        &self,
        service: Service,
        account: &Account,
        own_key: &OwnKey,
    ) -> AppResult<bool> {
        let keys = match service {
            Service::LastFm => Self::last_fm_keys(own_key),
            Service::LibreFm => Some(Keys::libre_fm()),
            Service::ListenBrainz => None,
        };
        let client = if service == Service::LibreFm {
            &LIBRE_FM
        } else {
            &LAST_FM
        };

        if service.takes_loves() {
            for love in queue::pending_loves(&self.pool, service).await? {
                let outcome = match &keys {
                    Some(keys) => {
                        client
                            .send(
                                audioscrobbler::love_params(&love.item, &account.secret),
                                keys,
                            )
                            .await
                    }
                    None => SendOutcome::SignedOut,
                };
                match outcome {
                    SendOutcome::Sent => {
                        queue::drop_sent(&self.pool, Table::Loves, std::slice::from_ref(&love))
                            .await?;
                    }
                    SendOutcome::Retry => return Ok(false),
                    SendOutcome::SignedOut => return self.signed_out(service).await,
                }
            }
        }

        let batch_size = if service == Service::ListenBrainz {
            listenbrainz::MAX_BATCH
        } else {
            audioscrobbler::MAX_BATCH
        };
        loop {
            let batch = queue::pending(&self.pool, service, batch_size).await?;
            if batch.is_empty() {
                return Ok(true);
            }
            let entries: Vec<ScrobbleEntry> = batch.iter().map(|q| q.item.clone()).collect();
            let outcome = match (service, &keys) {
                (Service::ListenBrainz, _) => listenbrainz::scrobble(&entries, account).await,
                (_, Some(keys)) => {
                    client
                        .send(
                            audioscrobbler::scrobble_params(&entries, &account.secret),
                            keys,
                        )
                        .await
                }
                (_, None) => SendOutcome::SignedOut,
            };
            match outcome {
                SendOutcome::Sent => queue::drop_sent(&self.pool, Table::Listens, &batch).await?,
                SendOutcome::Retry => return Ok(false),
                SendOutcome::SignedOut => return self.signed_out(service).await,
            }
        }
    }

    async fn signed_out(&self, service: Service) -> AppResult<bool> {
        tracing::warn!(
            service = service.as_str(),
            "Scrobbling service signed the account out"
        );
        self.sign_out(service).await?;
        Ok(true)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scrobble::credentials::memory::MemoryStore;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn scrobbler() -> Scrobbler {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        Scrobbler::new(pool, Arc::new(MemoryStore::default()))
    }

    fn track(duration_ms: u64) -> TrackInfo {
        TrackInfo {
            title: "Song".into(),
            artists: vec!["Artist - Topic".into()],
            album: None,
            duration_ms,
        }
    }

    fn account() -> Account {
        Account {
            user_name: "listener".into(),
            secret: "SK".into(),
        }
    }

    #[tokio::test]
    async fn a_counted_listen_is_queued_for_each_signed_in_service() {
        let scrobbler = scrobbler().await;
        assert!(
            !scrobbler
                .listened(&track(200_000), 150_000, 0)
                .await
                .unwrap()
        );

        scrobbler
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();
        scrobbler
            .set_account(Service::ListenBrainz, Some(account()))
            .await
            .unwrap();
        assert!(
            !scrobbler
                .listened(&track(200_000), 99_000, 0)
                .await
                .unwrap()
        );
        assert!(!scrobbler.listened(&track(20_000), 20_000, 0).await.unwrap());
        assert!(
            scrobbler
                .listened(&track(200_000), 100_000, 0)
                .await
                .unwrap()
        );

        let status = scrobbler.status().await.unwrap();
        let waiting: Vec<_> = status.services.iter().map(|s| s.waiting).collect();
        assert_eq!(waiting, [1, 0, 1]);
    }

    #[tokio::test]
    async fn loves_skip_listenbrainz_and_signing_out_drops_the_queue() {
        let scrobbler = scrobbler().await;
        scrobbler
            .set_account(Service::LibreFm, Some(account()))
            .await
            .unwrap();
        scrobbler
            .set_account(Service::ListenBrainz, Some(account()))
            .await
            .unwrap();
        scrobbler.love(&track(200_000), true).await.unwrap();
        assert_eq!(
            queue::waiting(&scrobbler.pool, Service::LibreFm)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            queue::waiting(&scrobbler.pool, Service::ListenBrainz)
                .await
                .unwrap(),
            0
        );

        scrobbler.sign_out(Service::LibreFm).await.unwrap();
        let status = scrobbler.status().await.unwrap();
        assert!(!status.services[1].signed_in);
        assert_eq!(status.services[1].waiting, 0);
    }

    #[tokio::test]
    async fn changing_the_own_key_signs_out_of_last_fm_only() {
        let scrobbler = scrobbler().await;
        scrobbler
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();
        scrobbler
            .set_account(Service::LibreFm, Some(account()))
            .await
            .unwrap();
        scrobbler
            .set_own_key(true, Some(" abcdefghij ".into()), Some("s".into()))
            .await
            .unwrap();
        let status = scrobbler.status().await.unwrap();
        assert!(!status.services[0].signed_in);
        assert!(status.services[1].signed_in);
        assert!(status.last_fm_ready);
        assert_eq!(status.own_key_hint.as_deref(), Some("abcdef"));

        // Saving the same key again keeps the session; switching back to the build's key does not.
        scrobbler
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();
        scrobbler.set_own_key(true, None, None).await.unwrap();
        assert!(scrobbler.status().await.unwrap().services[0].signed_in);
        scrobbler.set_own_key(false, None, None).await.unwrap();
        let status = scrobbler.status().await.unwrap();
        assert!(!status.services[0].signed_in);
        assert_eq!(status.own_key_hint.as_deref(), Some("abcdef"));
    }

    #[tokio::test]
    async fn a_build_without_a_key_cannot_sign_in_to_last_fm() {
        if Keys::bundled_last_fm().is_usable() {
            return;
        }
        let scrobbler = scrobbler().await;
        let error = scrobbler
            .sign_in(Service::LastFm, "u", "p")
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::ScrobbleKeyMissing(_)));
        assert!(!scrobbler.status().await.unwrap().last_fm_ready);
    }

    #[tokio::test]
    async fn flushing_an_empty_queue_never_touches_the_network() {
        let scrobbler = scrobbler().await;
        scrobbler
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();
        assert!(scrobbler.flush().await.unwrap());
    }
}
