use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use crate::db::watch_history;
use crate::errors::AppResult;
use crate::flow_neuro::key_migration::fill_gaps_from_titles;
use crate::flow_neuro::maintenance::migrate;
use crate::flow_neuro::scoring::UserBrain;
use crate::flow_neuro::signals::{SPELLING_TITLES, get_or_create_brain, save_brain, settle_brain};

const FLUSH_INTERVAL: Duration = Duration::from_secs(3);
/// How long bookkeeping may wait for a save. What was shown on a feed is noted every second
/// or two while scrolling, and saving the whole brain that often rewrote several hundred
/// kilobytes of JSON every three seconds for a change nothing reads until the next feed.
const BOOKKEEPING_FLUSH_INTERVAL: Duration = Duration::from_secs(60);

/// Owns the single resident `UserBrain`. Reads borrow it directly; writes mutate in memory and
/// are coalesced to disk by a background task, avoiding a full JSON rewrite on every interaction.
pub struct BrainStore {
    pool: SqlitePool,
    brain: RwLock<UserBrain>,
    dirty: AtomicBool,
    /// Changed, but only by bookkeeping that can wait [`BOOKKEEPING_FLUSH_INTERVAL`].
    dirty_later: AtomicBool,
    last_flush: std::sync::Mutex<Instant>,
    /// Set while a sync merge writes the stored brain: a flush then would write the resident
    /// brain over the merged one before the reload picks it up.
    held: AtomicBool,
}

/// Write access that marks the brain dirty on drop, so the debounced flusher persists it.
pub struct BrainWriteGuard<'a> {
    guard: RwLockWriteGuard<'a, UserBrain>,
    dirty: &'a AtomicBool,
}

impl std::ops::Deref for BrainWriteGuard<'_> {
    type Target = UserBrain;
    fn deref(&self) -> &UserBrain {
        &self.guard
    }
}

impl std::ops::DerefMut for BrainWriteGuard<'_> {
    fn deref_mut(&mut self) -> &mut UserBrain {
        &mut self.guard
    }
}

impl Drop for BrainWriteGuard<'_> {
    fn drop(&mut self) {
        self.dirty.store(true, Ordering::Relaxed);
    }
}

impl BrainStore {
    pub async fn load(pool: SqlitePool) -> AppResult<Arc<Self>> {
        let brain = get_or_create_brain(&pool).await?;
        let store = Arc::new(Self {
            pool,
            brain: RwLock::new(brain),
            dirty: AtomicBool::new(false),
            dirty_later: AtomicBool::new(false),
            last_flush: std::sync::Mutex::new(Instant::now()),
            held: AtomicBool::new(false),
        });
        store.clone().spawn_flush_loop();
        Ok(store)
    }

    pub async fn read(&self) -> RwLockReadGuard<'_, UserBrain> {
        self.brain.read().await
    }

    pub async fn write(&self) -> BrainWriteGuard<'_> {
        BrainWriteGuard {
            guard: self.brain.write().await,
            dirty: &self.dirty,
        }
    }

    /// Write access for bookkeeping, such as which videos a feed showed. It is saved within
    /// [`BOOKKEEPING_FLUSH_INTERVAL`], with the next learning change, or when Flow closes,
    /// whichever comes first.
    pub async fn write_later(&self) -> BrainWriteGuard<'_> {
        BrainWriteGuard {
            guard: self.brain.write().await,
            dirty: &self.dirty_later,
        }
    }

    /// Persists the brain only if it changed since the last flush. The snapshot is cloned under a
    /// short read lock so the DB write never blocks readers or writers.
    pub async fn flush(&self) -> AppResult<()> {
        if self.held.load(Ordering::Relaxed) {
            return Ok(());
        }
        let learned = self.dirty.swap(false, Ordering::Relaxed);
        let noted = self.dirty_later.swap(false, Ordering::Relaxed);
        if !learned && !noted {
            return Ok(());
        }
        let snapshot = self.brain.read().await.clone();
        if let Err(error) = save_brain(&self.pool, &snapshot).await {
            self.dirty.store(true, Ordering::Relaxed);
            return Err(error);
        }
        *self.last_flush_at() = Instant::now();
        Ok(())
    }

    fn last_flush_at(&self) -> std::sync::MutexGuard<'_, Instant> {
        self.last_flush
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Whether the periodic flush has anything to save now: a learning change always, and
    /// bookkeeping once it has waited long enough.
    fn flush_is_due(&self, bookkeeping_wait: Duration) -> bool {
        self.dirty.load(Ordering::Relaxed)
            || (self.dirty_later.load(Ordering::Relaxed)
                && self.last_flush_at().elapsed() >= bookkeeping_wait)
    }

    /// Saves the brain and holds further saves until [`Self::reload`], while a sync merge
    /// writes the stored brain.
    pub async fn flush_and_hold(&self) -> AppResult<()> {
        let result = self.flush().await;
        self.held.store(true, Ordering::Relaxed);
        result
    }

    /// Replaces the resident brain with the stored one, after a sync merge or a restore wrote it.
    /// Keys a peer brought in are spelled from the watch history that came with them.
    pub async fn reload(&self) -> AppResult<()> {
        let mut fresh = get_or_create_brain(&self.pool).await?;
        let titles = watch_history::recent_video_titles(&self.pool, SPELLING_TITLES).await?;
        let spelled = fill_gaps_from_titles(&mut fresh, &titles);
        *self.brain.write().await = fresh;
        self.dirty.store(spelled, Ordering::Relaxed);
        self.dirty_later.store(false, Ordering::Relaxed);
        self.held.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Makes an imported brain the resident one and saves it at once, so the next flush cannot
    /// write the old brain back over it.
    pub async fn replace(&self, mut brain: UserBrain) -> AppResult<()> {
        settle_brain(&self.pool, &mut brain).await?;
        // An imported brain may come from before the evidence horizons, whatever this device did.
        migrate(&mut brain);
        let mut resident = self.brain.write().await;
        save_brain(&self.pool, &brain).await?;
        *resident = brain;
        self.dirty.store(false, Ordering::Relaxed);
        self.dirty_later.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn spawn_flush_loop(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
            loop {
                ticker.tick().await;
                if !self.flush_is_due(BOOKKEEPING_FLUSH_INTERVAL) {
                    continue;
                }
                if let Err(error) = self.flush().await {
                    tracing::error!(%error, "[FlowNeuro] failed to flush brain");
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_held_brain_is_not_saved_over_a_merge() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let store = BrainStore::load(pool.clone()).await.unwrap();
        store.flush_and_hold().await.unwrap();
        // The merge stores its brain while learning goes on in memory.
        let mut merged = get_or_create_brain(&pool).await.unwrap();
        merged.total_interactions = 42;
        save_brain(&pool, &merged).await.unwrap();
        store.write().await.total_interactions = 7;
        store.flush().await.unwrap();
        assert_eq!(
            get_or_create_brain(&pool).await.unwrap().total_interactions,
            42
        );
        store.reload().await.unwrap();
        assert_eq!(store.read().await.total_interactions, 42);
        store.write().await.total_interactions = 43;
        store.flush().await.unwrap();
        assert_eq!(
            get_or_create_brain(&pool).await.unwrap().total_interactions,
            43
        );
    }

    async fn store() -> (SqlitePool, Arc<BrainStore>) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let store = BrainStore::load(pool.clone()).await.unwrap();
        (pool, store)
    }

    /// Feed impressions arrive every second or two while scrolling. They used to make the
    /// three-second flush rewrite the whole brain each time.
    #[tokio::test]
    async fn bookkeeping_waits_its_own_interval_and_learning_does_not() {
        let (_pool, store) = store().await;
        assert!(!store.flush_is_due(BOOKKEEPING_FLUSH_INTERVAL));

        store.write_later().await.total_interactions = 1;
        assert!(!store.flush_is_due(BOOKKEEPING_FLUSH_INTERVAL));
        assert!(store.flush_is_due(Duration::ZERO), "due once it has waited");

        store.write().await.total_interactions = 2;
        assert!(store.flush_is_due(BOOKKEEPING_FLUSH_INTERVAL));
    }

    #[tokio::test]
    async fn a_flush_saves_bookkeeping_too_as_closing_the_app_does() {
        let (pool, store) = store().await;
        store.write_later().await.total_interactions = 9;
        store.flush().await.unwrap();
        assert_eq!(
            get_or_create_brain(&pool).await.unwrap().total_interactions,
            9
        );
        assert!(!store.flush_is_due(Duration::ZERO), "nothing left to save");
    }
}
