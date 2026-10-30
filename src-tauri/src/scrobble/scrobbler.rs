//! Sends what the music player plays to every signed-in service. Counted listens are queued first
//! and sent by the worker, so a listen survives going offline or quitting.
//!
//! The keychain is read only to send, at most once per launch, and a refusal is remembered until
//! the listener retries: on macOS each read of an item another build wrote is a password prompt.

use std::sync::Arc;

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::{Mutex, Notify};

use super::SignInError;
use super::audioscrobbler::{self, Client, Keys};
use super::credentials::{self, Credentials, OwnKey};
use super::index::{self, Index};
use super::listenbrainz;
use super::models::{Account, ScrobbleEntry, SendOutcome, Service};
use super::queue::{self, Table};
use super::rules::{self, TrackInfo};
use crate::errors::{AppError, AppResult};
use crate::security::keychain::{CredentialError, CredentialStore, off_thread};

const LAST_FM: Client = Client::new(audioscrobbler::LASTFM_URL);
const LIBRE_FM: Client = Client::new(audioscrobbler::LIBREFM_URL);

enum Cache {
    Unread,
    Loaded(Credentials),
    /// Why the keychain could not be read; kept so later sends do not ask again.
    Refused(String),
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
    /// Set when the system keychain cannot be used, so nothing can sign in or send.
    pub keychain_error: Option<String>,
}

pub struct Scrobbler {
    pool: SqlitePool,
    store: Arc<dyn CredentialStore>,
    /// Held across a keychain read, so two callers never raise two prompts.
    cache: Mutex<Cache>,
    flush_lock: Mutex<()>,
    pub(super) wake: Notify,
}

impl Scrobbler {
    pub fn new(pool: SqlitePool, store: Arc<dyn CredentialStore>) -> Self {
        Self {
            pool,
            store,
            cache: Mutex::new(Cache::Unread),
            flush_lock: Mutex::new(()),
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
        off_thread(move || job(store.as_ref()))
            .await
            .map_err(|error| AppError::Keychain(error.to_string()))
    }

    /// The credentials, reading the keychain only if this launch has not yet.
    async fn loaded(&self, cache: &mut Cache) -> AppResult<Credentials> {
        match cache {
            Cache::Loaded(credentials) => return Ok(credentials.clone()),
            Cache::Refused(reason) => return Err(AppError::Keychain(reason.clone())),
            Cache::Unread => {}
        }
        match self.blocking(credentials::load).await {
            Ok(loaded) => {
                index::rebuild(&self.pool, &loaded).await?;
                *cache = Cache::Loaded(loaded.clone());
                Ok(loaded)
            }
            Err(AppError::Keychain(reason)) => {
                tracing::warn!(%reason, "Scrobbling keychain unavailable until retried");
                *cache = Cache::Refused(reason.clone());
                Err(AppError::Keychain(reason))
            }
            Err(error) => Err(error),
        }
    }

    async fn credentials(&self) -> AppResult<Credentials> {
        let mut cache = self.cache.lock().await;
        self.loaded(&mut cache).await
    }

    /// Who is signed in. Reads the keychain only the first time ever, before the index exists.
    async fn index(&self) -> AppResult<Index> {
        if let Some(index) = index::read(&self.pool).await? {
            return Ok(index);
        }
        self.credentials().await?;
        Ok(index::read(&self.pool).await?.unwrap_or_default())
    }

    /// Forgets a refused keychain and reads it again, as the listener asked.
    pub async fn retry_keychain(&self) -> AppResult<()> {
        let mut cache = self.cache.lock().await;
        if matches!(*cache, Cache::Refused(_)) {
            *cache = Cache::Unread;
        }
        self.loaded(&mut cache).await?;
        drop(cache);
        self.wake.notify_one();
        Ok(())
    }

    /// Applies `change` to the credentials and writes them back to the keychain and the index.
    async fn update(
        &self,
        change: impl FnOnce(&mut Credentials),
    ) -> AppResult<(Credentials, Credentials)> {
        let mut cache = self.cache.lock().await;
        let before = self.loaded(&mut cache).await?;
        let mut after = before.clone();
        change(&mut after);
        let stored = after.clone();
        self.blocking(move |store| credentials::save(store, &stored))
            .await?;
        index::rebuild(&self.pool, &after).await?;
        *cache = Cache::Loaded(after.clone());
        Ok((before, after))
    }

    pub async fn status(&self) -> AppResult<ScrobbleStatus> {
        let (index, keychain_error) = match self.index().await {
            Ok(index) => {
                let refused = match &*self.cache.lock().await {
                    Cache::Refused(reason) => Some(reason.clone()),
                    _ => None,
                };
                (index, refused)
            }
            Err(AppError::Keychain(reason)) => (Index::default(), Some(reason)),
            Err(error) => return Err(error),
        };
        let mut services = Vec::new();
        for service in Service::ALL {
            let user_name = index.user_name(service);
            services.push(ServiceStatus {
                service,
                signed_in: user_name.is_some(),
                user_name: user_name
                    .filter(|name| !name.is_empty())
                    .map(str::to_string),
                waiting: queue::waiting(&self.pool, service).await?,
            });
        }
        let own_key = index.own_key;
        Ok(ScrobbleStatus {
            services,
            last_fm_ready: if own_key.enabled {
                own_key.usable
            } else {
                Keys::bundled_last_fm().is_usable()
            },
            own_key_enabled: own_key.enabled,
            own_key_hint: own_key.hint,
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
        self.update(|creds| match account {
            Some(account) => {
                creds.accounts.insert(service, account);
            }
            None => {
                creds.accounts.remove(&service);
            }
        })
        .await?;
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
        let (before, after) = self
            .update(|creds| {
                let own_key = &mut creds.own_key;
                own_key.enabled = enabled;
                if let Some(key) = api_key {
                    own_key.api_key = key.trim().to_string();
                }
                if let Some(secret) = secret {
                    own_key.secret = secret.trim().to_string();
                }
            })
            .await?;
        let (before, next) = (before.own_key, after.own_key);
        let changed = before.enabled != next.enabled
            || (next.enabled && (before.api_key != next.api_key || before.secret != next.secret));
        if changed && after.accounts.contains_key(&Service::LastFm) {
            self.sign_out(Service::LastFm).await?;
        }
        Ok(())
    }

    /// Shows the song as now playing on every signed-in service.
    pub async fn now_playing(&self, track: &TrackInfo) -> AppResult<()> {
        let Some(entry) = rules::entry_for(track, now_ms()) else {
            return Ok(());
        };
        if self.index().await?.accounts.is_empty() {
            return Ok(());
        }
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
        let index = self.index().await?;
        if index.accounts.is_empty() {
            return Ok(false);
        }
        for service in index.services() {
            queue::enqueue(&self.pool, service, &entry).await?;
        }
        self.wake.notify_one();
        Ok(true)
    }

    /// Mirrors a like or unlike as a love on the services that have one.
    pub async fn love(&self, track: &TrackInfo, loved: bool) -> AppResult<()> {
        let Some(love) = rules::love_for(track, loved) else {
            return Ok(());
        };
        let index = self.index().await?;
        let mut queued = false;
        for service in index.services().filter(|s| s.takes_loves()) {
            queue::enqueue_love(&self.pool, service, &love).await?;
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;
    use crate::security::keychain::memory::MemoryStore;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Counts reads, and can refuse them as a denied macOS prompt does.
    #[derive(Default)]
    struct CountingStore {
        inner: MemoryStore,
        reads: AtomicUsize,
        refuse: AtomicBool,
    }

    impl CredentialStore for CountingStore {
        fn read(&self, name: &str) -> Result<Option<String>, CredentialError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
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

    impl CountingStore {
        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
    }

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn scrobbler() -> Scrobbler {
        Scrobbler::new(pool().await, Arc::new(MemoryStore::default()))
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

    #[tokio::test]
    async fn a_new_launch_with_nobody_signed_in_never_reads_the_keychain() {
        let pool = pool().await;
        let store = Arc::new(CountingStore::default());
        Scrobbler::new(pool.clone(), store.clone())
            .status()
            .await
            .unwrap();
        let first_launch = store.reads();

        let scrobbler = Scrobbler::new(pool, store.clone());
        scrobbler.status().await.unwrap();
        scrobbler.now_playing(&track(200_000)).await.unwrap();
        assert!(
            !scrobbler
                .listened(&track(200_000), 150_000, 0)
                .await
                .unwrap()
        );
        scrobbler.love(&track(200_000), true).await.unwrap();
        assert!(scrobbler.flush().await.unwrap());
        assert_eq!(store.reads(), first_launch);
    }

    #[tokio::test]
    async fn a_signed_in_launch_reads_the_keychain_once() {
        let pool = pool().await;
        let store = Arc::new(CountingStore::default());
        Scrobbler::new(pool.clone(), store.clone())
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();

        let scrobbler = Scrobbler::new(pool, store.clone());
        let before = store.reads();
        let status = scrobbler.status().await.unwrap();
        assert!(status.services[0].signed_in);
        assert_eq!(status.services[0].user_name.as_deref(), Some("listener"));
        assert!(
            scrobbler
                .listened(&track(200_000), 150_000, 0)
                .await
                .unwrap()
        );
        assert_eq!(store.reads(), before, "status and queueing use the index");

        for _ in 0..5 {
            scrobbler.credentials().await.unwrap();
        }
        assert_eq!(store.reads(), before + 1);
    }

    #[tokio::test]
    async fn a_refused_keychain_is_not_asked_again_until_retried() {
        let pool = pool().await;
        let store = Arc::new(CountingStore::default());
        Scrobbler::new(pool.clone(), store.clone())
            .set_account(Service::ListenBrainz, Some(account()))
            .await
            .unwrap();

        let scrobbler = Scrobbler::new(pool, store.clone());
        store.refuse.store(true, Ordering::SeqCst);
        let before = store.reads();
        assert!(matches!(
            scrobbler.credentials().await,
            Err(AppError::Keychain(_))
        ));
        for _ in 0..3 {
            assert!(scrobbler.credentials().await.is_err());
            assert!(scrobbler.flush().await.unwrap());
        }
        assert_eq!(store.reads(), before + 1);

        let status = scrobbler.status().await.unwrap();
        assert!(status.services[2].signed_in, "the index still knows");
        assert!(status.keychain_error.is_some());
        assert_eq!(store.reads(), before + 1);

        store.refuse.store(false, Ordering::SeqCst);
        scrobbler.retry_keychain().await.unwrap();
        assert_eq!(store.reads(), before + 2);
        assert!(scrobbler.status().await.unwrap().keychain_error.is_none());
    }

    #[tokio::test]
    async fn the_first_launch_after_the_update_moves_old_items_into_one() {
        let store = Arc::new(CountingStore::default());
        store
            .inner
            .write("LIBREFM", &serde_json::to_string(&account()).unwrap())
            .unwrap();
        let scrobbler = Scrobbler::new(pool().await, store.clone());

        let status = scrobbler.status().await.unwrap();
        assert!(status.services[1].signed_in);
        let items = store.inner.0.lock().unwrap();
        assert_eq!(items.keys().collect::<Vec<_>>(), ["CREDENTIALS"]);
    }

    #[tokio::test]
    async fn signing_out_of_everything_removes_the_keychain_item() {
        let store = Arc::new(CountingStore::default());
        let scrobbler = Scrobbler::new(pool().await, store.clone());
        scrobbler
            .set_account(Service::LastFm, Some(account()))
            .await
            .unwrap();
        assert!(!store.inner.0.lock().unwrap().is_empty());
        scrobbler.sign_out(Service::LastFm).await.unwrap();
        assert!(store.inner.0.lock().unwrap().is_empty());
    }
}
