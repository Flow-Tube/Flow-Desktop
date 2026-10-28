//! Resident `MusicBrain` store. Mirrors `flow_neuro::brain_store::BrainStore`:
//! one in-memory brain under an `RwLock`, writes coalesced to disk by a debounced
//! background flush. Adds ephemeral, non-persisted session state to dedup the
//! per-second playback firehose into one counted listen per play.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sqlx::SqlitePool;
use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use tracing::warn;

use crate::db::settings;
use crate::errors::AppResult;

use super::backfill::backfill_if_needed;
use super::learn::{
    MusicSignal, SESSION_GAP_MS, apply_music_dislike, apply_music_signal, block_music_artist,
    newly_crossed, unblock_music_artist,
};
use super::model::MusicBrain;

const FLUSH_INTERVAL: Duration = Duration::from_secs(3);
const SETTINGS_KEY: &str = "user_music_brain";
const LIVE_PROGRESS_MAX: usize = 256;
/// Progress dropping below this while previously high marks a restarted (fresh) listen.
const RESTART_PROGRESS: f32 = 0.10;

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}

pub struct MusicBrainStore {
    pool: SqlitePool,
    brain: RwLock<MusicBrain>,
    dirty: AtomicBool,
    /// Per-track max progress within the current listen (ephemeral; for dedup).
    live_progress: Mutex<HashMap<String, f32>>,
    /// Last counted (artist_key, timestamp) for session co-occurrence (ephemeral).
    last_counted: Mutex<Option<(String, u64)>>,
}

pub struct MusicBrainWriteGuard<'a> {
    guard: RwLockWriteGuard<'a, MusicBrain>,
    dirty: &'a AtomicBool,
}

impl std::ops::Deref for MusicBrainWriteGuard<'_> {
    type Target = MusicBrain;
    fn deref(&self) -> &MusicBrain {
        &self.guard
    }
}

impl std::ops::DerefMut for MusicBrainWriteGuard<'_> {
    fn deref_mut(&mut self) -> &mut MusicBrain {
        &mut self.guard
    }
}

impl Drop for MusicBrainWriteGuard<'_> {
    fn drop(&mut self) {
        self.dirty.store(true, Ordering::Relaxed);
    }
}

impl MusicBrainStore {
    pub async fn load(pool: SqlitePool) -> AppResult<Arc<Self>> {
        let mut brain = get_or_create(&pool).await?;
        // One-time warm start from existing music watch history.
        if let Err(error) = backfill_if_needed(&pool, &mut brain).await {
            warn!(%error, "[MusicBrain] backfill failed; starting cold");
        }
        save(&pool, &brain).await?;

        let store = Arc::new(Self {
            pool,
            brain: RwLock::new(brain),
            dirty: AtomicBool::new(false),
            live_progress: Mutex::new(HashMap::new()),
            last_counted: Mutex::new(None),
        });
        store.clone().spawn_flush_loop();
        Ok(store)
    }

    pub async fn read(&self) -> RwLockReadGuard<'_, MusicBrain> {
        self.brain.read().await
    }

    pub async fn write(&self) -> MusicBrainWriteGuard<'_> {
        MusicBrainWriteGuard {
            guard: self.brain.write().await,
            dirty: &self.dirty,
        }
    }

    /// Records one playback signal. Most ticks are no-ops (no milestone crossed),
    /// so the brain is only locked/dirtied when something is actually learned.
    #[allow(clippy::too_many_arguments)]
    pub async fn record_interaction(
        &self,
        track_id: &str,
        artist_key: &str,
        artist_display: Option<&str>,
        title: Option<&str>,
        thumbnail: Option<&str>,
        genre: Option<&str>,
        percent_played: f32,
        is_explicit_like: bool,
    ) {
        let now = now_ms();
        let next = percent_played.clamp(0.0, 1.0);

        // Resolve previous progress this listen (restart detection) without holding the
        // lock across an await.
        let prev = {
            let live = self.live_progress.lock().unwrap();
            let stored = live.get(track_id).copied().unwrap_or(0.0);
            if next < RESTART_PROGRESS && stored > 0.5 {
                0.0 // track was restarted → a fresh listen
            } else {
                stored
            }
        };

        let crossed = newly_crossed(prev, next);
        if crossed.is_empty() && !is_explicit_like {
            // Pure progress tick — update ephemeral state only, no brain write/flush.
            self.touch_live(track_id, prev.max(next));
            return;
        }

        let co_artist = {
            let lc = self.last_counted.lock().unwrap();
            match &*lc {
                Some((a, ts)) if now.saturating_sub(*ts) < SESSION_GAP_MS && a != artist_key => {
                    Some(a.clone())
                }
                _ => None,
            }
        };

        let sig = MusicSignal {
            track_id: track_id.to_string(),
            artist_key: artist_key.to_string(),
            genre: genre.map(str::to_string),
            is_explicit_like,
            title: title.map(str::to_string),
            artist_display: artist_display.map(str::to_string),
            thumbnail: thumbnail.map(str::to_string),
        };

        let counted = {
            let mut brain = self.write().await;
            apply_music_signal(&mut brain, &sig, &crossed, now, co_artist.as_deref())
        };

        self.touch_live(track_id, prev.max(next));
        if counted && !artist_key.is_empty() {
            *self.last_counted.lock().unwrap() = Some((artist_key.to_string(), now));
        }
    }

    pub async fn dislike(&self, artist_key: &str) {
        let now = now_ms();
        let mut brain = self.write().await;
        apply_music_dislike(&mut brain, artist_key, now);
    }

    /// Hard-block an artist ("don't recommend this artist") — a permanent denylist entry.
    pub async fn block_artist(&self, artist_key: &str) {
        let mut brain = self.write().await;
        block_music_artist(&mut brain, artist_key);
    }

    /// Lift a hard block, allowing the artist to be recommended again.
    pub async fn unblock_artist(&self, artist_key: &str) {
        let mut brain = self.write().await;
        unblock_music_artist(&mut brain, artist_key);
    }

    /// Snapshot of the currently hard-blocked artist keys (for the management UI).
    pub async fn blocked_artists(&self) -> Vec<String> {
        self.brain
            .read()
            .await
            .blocked_artists
            .iter()
            .cloned()
            .collect()
    }

    pub async fn snapshot(&self) -> MusicBrain {
        self.brain.read().await.clone()
    }

    pub async fn reset(&self) -> AppResult<()> {
        {
            let mut brain = self.write().await;
            *brain = MusicBrain::default();
        }
        self.live_progress.lock().unwrap().clear();
        *self.last_counted.lock().unwrap() = None;
        // Allow backfill to run again on next load.
        settings::set_setting(&self.pool, "music_brain_backfilled", "0").await?;
        self.flush().await
    }

    fn touch_live(&self, track_id: &str, progress: f32) {
        let mut live = self.live_progress.lock().unwrap();
        live.insert(track_id.to_string(), progress);
        if live.len() > LIVE_PROGRESS_MAX {
            // Drop an arbitrary entry; this is throwaway session state.
            if let Some(k) = live.keys().next().cloned() {
                live.remove(&k);
            }
        }
    }

    pub async fn flush(&self) -> AppResult<()> {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return Ok(());
        }
        let snapshot = self.brain.read().await.clone();
        if let Err(error) = save(&self.pool, &snapshot).await {
            self.dirty.store(true, Ordering::Relaxed);
            return Err(error);
        }
        Ok(())
    }

    /// Replace the resident brain with the latest copy persisted in the DB (after the sync merge
    /// wrote `user_music_brain` directly). Clears dirty + ephemeral session state.
    pub async fn reload(&self) -> AppResult<()> {
        let fresh = get_or_create(&self.pool).await?;
        *self.brain.write().await = fresh;
        self.dirty.store(false, Ordering::Relaxed);
        self.live_progress.lock().unwrap().clear();
        *self.last_counted.lock().unwrap() = None;
        Ok(())
    }

    fn spawn_flush_loop(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
            loop {
                ticker.tick().await;
                if let Err(error) = self.flush().await {
                    tracing::error!(%error, "[MusicBrain] failed to flush");
                }
            }
        });
    }
}

async fn get_or_create(pool: &SqlitePool) -> AppResult<MusicBrain> {
    if let Some(json) = settings::get_setting(pool, SETTINGS_KEY).await? {
        match serde_json::from_str::<MusicBrain>(&json) {
            Ok(mut brain) => {
                brain.schema_version = super::model::MUSIC_SCHEMA_VERSION;
                return Ok(brain);
            }
            Err(error) => {
                warn!(%error, "[MusicBrain] stored brain failed to deserialize; starting fresh");
                return Ok(MusicBrain::default());
            }
        }
    }
    Ok(MusicBrain::default())
}

async fn save(pool: &SqlitePool, brain: &MusicBrain) -> AppResult<()> {
    let json = serde_json::to_string(brain).unwrap();
    settings::set_setting(pool, SETTINGS_KEY, &json).await
}
