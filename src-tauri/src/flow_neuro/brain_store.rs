use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use crate::db::watch_history;
use crate::errors::AppResult;
use crate::flow_neuro::key_migration::fill_gaps_from_titles;
use crate::flow_neuro::scoring::UserBrain;
use crate::flow_neuro::signals::{SPELLING_TITLES, get_or_create_brain, save_brain, settle_brain};

const FLUSH_INTERVAL: Duration = Duration::from_secs(3);

/// Owns the single resident `UserBrain`. Reads borrow it directly; writes mutate in memory and
/// are coalesced to disk by a background task, avoiding a full JSON rewrite on every interaction.
pub struct BrainStore {
    pool: SqlitePool,
    brain: RwLock<UserBrain>,
    dirty: AtomicBool,
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

    /// Persists the brain only if it changed since the last flush. The snapshot is cloned under a
    /// short read lock so the DB write never blocks readers or writers.
    pub async fn flush(&self) -> AppResult<()> {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return Ok(());
        }
        let snapshot = self.brain.read().await.clone();
        if let Err(error) = save_brain(&self.pool, &snapshot).await {
            self.dirty.store(true, Ordering::Relaxed);
            return Err(error);
        }
        Ok(())
    }

    /// Replaces the resident brain with the stored one, after a sync merge or a restore wrote it.
    /// Keys a peer brought in are spelled from the watch history that came with them.
    pub async fn reload(&self) -> AppResult<()> {
        let mut fresh = get_or_create_brain(&self.pool).await?;
        let titles = watch_history::recent_video_titles(&self.pool, SPELLING_TITLES).await?;
        let spelled = fill_gaps_from_titles(&mut fresh, &titles);
        *self.brain.write().await = fresh;
        self.dirty.store(spelled, Ordering::Relaxed);
        Ok(())
    }

    /// Makes an imported brain the resident one and saves it at once, so the next flush cannot
    /// write the old brain back over it.
    pub async fn replace(&self, mut brain: UserBrain) -> AppResult<()> {
        settle_brain(&self.pool, &mut brain).await?;
        let mut resident = self.brain.write().await;
        save_brain(&self.pool, &brain).await?;
        *resident = brain;
        self.dirty.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn spawn_flush_loop(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
            loop {
                ticker.tick().await;
                if let Err(error) = self.flush().await {
                    tracing::error!(%error, "[FlowNeuro] failed to flush brain");
                }
            }
        });
    }
}
