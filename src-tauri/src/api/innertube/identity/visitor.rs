//! The visitor identity every request carries.
//!
//! One identity is minted, kept on disk and reused for a week, as Flow for
//! Android does. A new identity per launch, or a new one on every bot wall, is
//! the pattern that gets a visitor flagged. Re-rolls after a wall are capped at
//! two in six hours; past that a wall is the network's, not the identity's.
//! The value is never logged and never synced.

use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const HOUR_MS: u64 = 3_600_000;
const MAX_AGE_MS: u64 = 7 * 24 * HOUR_MS;
const REROLL_LIMIT: usize = 2;
const REROLL_WINDOW_MS: u64 = 6 * HOUR_MS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    value: String,
    saved_at_ms: u64,
}

/// What a re-roll after a bot wall produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reroll {
    /// A different identity to retry with: freshly minted, or one another caller
    /// re-rolled to a moment ago.
    Fresh(String),
    /// The budget is spent, so retrying under a new identity would not help.
    BudgetSpent,
    /// Minting failed.
    Failed,
}

#[derive(Default)]
pub struct VisitorIdentity {
    current: RwLock<Option<Stored>>,
    mint_lock: tokio::sync::Mutex<()>,
    rerolls: Mutex<VecDeque<u64>>,
    file: OnceLock<PathBuf>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Whether an identity saved at `saved_at_ms` may still be used at `now_ms`.
fn is_fresh(saved_at_ms: u64, now_ms: u64) -> bool {
    now_ms >= saved_at_ms && now_ms - saved_at_ms < MAX_AGE_MS
}

/// Spend one re-roll at `now_ms` if the window has one left.
fn take_reroll(history: &mut VecDeque<u64>, now_ms: u64) -> bool {
    while history
        .front()
        .is_some_and(|&at| now_ms.saturating_sub(at) >= REROLL_WINDOW_MS)
    {
        history.pop_front();
    }
    if history.len() >= REROLL_LIMIT {
        return false;
    }
    history.push_back(now_ms);
    true
}

impl VisitorIdentity {
    /// Keep the identity in `path`, and start from the one saved there when it is
    /// still fresh. Only the first call counts.
    pub fn set_file(&self, path: PathBuf) {
        let saved = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok())
            .filter(|stored| !stored.value.is_empty() && is_fresh(stored.saved_at_ms, now_ms()));
        if self.file.set(path).is_err() {
            return;
        }
        if let (Some(saved), Ok(mut current)) = (saved, self.current.write()) {
            current.get_or_insert(saved);
        }
    }

    /// The identity in use, when there is a fresh one.
    #[must_use]
    pub fn current(&self) -> Option<String> {
        let current = self.current.read().ok()?;
        current
            .as_ref()
            .filter(|stored| is_fresh(stored.saved_at_ms, now_ms()))
            .map(|stored| stored.value.clone())
    }

    /// The identity in use, minting one with `mint` when there is none. Callers
    /// that arrive while one is being minted wait for it instead of minting their
    /// own, so a cold start does not hand out several identities at once.
    pub async fn ensure<F, Fut>(&self, mint: F) -> Option<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<String>>,
    {
        if let Some(value) = self.current() {
            return Some(value);
        }
        let _minting = self.mint_lock.lock().await;
        if let Some(value) = self.current() {
            return Some(value);
        }
        let value = mint().await.filter(|value| !value.is_empty())?;
        self.store(value.clone());
        Some(value)
    }

    /// A new identity after `walled` hit a bot wall. When another caller already
    /// replaced `walled`, its replacement is returned without spending budget.
    pub async fn reroll<F, Fut>(&self, walled: Option<&str>, mint: F) -> Reroll
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<String>>,
    {
        let _minting = self.mint_lock.lock().await;
        if let Some(current) = self
            .current()
            .filter(|current| Some(current.as_str()) != walled)
        {
            return Reroll::Fresh(current);
        }
        let allowed = self
            .rerolls
            .lock()
            .is_ok_and(|mut history| take_reroll(&mut history, now_ms()));
        if !allowed {
            return Reroll::BudgetSpent;
        }
        match mint().await.filter(|value| !value.is_empty()) {
            Some(value) => {
                self.store(value.clone());
                Reroll::Fresh(value)
            }
            None => Reroll::Failed,
        }
    }

    /// Drop `value` when it is still the identity in use, as after the server
    /// rejected it outright.
    pub fn forget_if(&self, value: &str) {
        let matches = self
            .current
            .read()
            .is_ok_and(|current| current.as_ref().is_some_and(|stored| stored.value == value));
        if matches {
            self.forget();
        }
    }

    /// Drop the identity in use and the saved copy; the next request mints anew.
    pub fn forget(&self) {
        if let Ok(mut current) = self.current.write() {
            *current = None;
        }
        if let Some(path) = self.file.get() {
            let _ = std::fs::remove_file(path);
        }
    }

    fn store(&self, value: String) {
        let stored = Stored {
            value,
            saved_at_ms: now_ms(),
        };
        if let Some(path) = self.file.get()
            && let Ok(bytes) = serde_json::to_vec(&stored)
            && let Err(error) = std::fs::write(path, bytes)
        {
            tracing::warn!(%error, "could not save the visitor identity");
        }
        if let Ok(mut current) = self.current.write() {
            *current = Some(stored);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn identities_last_a_week() {
        assert!(is_fresh(0, MAX_AGE_MS - 1));
        assert!(!is_fresh(0, MAX_AGE_MS));
        assert!(
            !is_fresh(10, 5),
            "a clock that went backwards invalidates it"
        );
    }

    #[test]
    fn two_rerolls_per_six_hours() {
        let mut history = VecDeque::new();
        assert!(take_reroll(&mut history, 0));
        assert!(take_reroll(&mut history, 1_000));
        assert!(!take_reroll(&mut history, 2_000));
        assert!(take_reroll(&mut history, REROLL_WINDOW_MS + 1));
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_mint() {
        let identity = Arc::new(VisitorIdentity::default());
        let mints = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let identity = identity.clone();
            let mints = mints.clone();
            tasks.push(tokio::spawn(async move {
                identity
                    .ensure(|| async move {
                        mints.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        Some("v1".to_string())
                    })
                    .await
            }));
        }
        for task in tasks {
            assert_eq!(task.await.unwrap().as_deref(), Some("v1"));
        }
        assert_eq!(mints.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_reroll_already_done_is_reused_and_the_budget_ends() {
        let identity = VisitorIdentity::default();
        identity.store("walled".into());
        assert_eq!(
            identity
                .reroll(Some("walled"), || async { Some("v2".to_string()) })
                .await,
            Reroll::Fresh("v2".into())
        );
        assert_eq!(
            identity
                .reroll(Some("walled"), || async { Some("never".to_string()) })
                .await,
            Reroll::Fresh("v2".into()),
            "a second caller walled on the old identity gets the new one for free"
        );
        assert_eq!(
            identity
                .reroll(Some("v2"), || async { Some("v3".to_string()) })
                .await,
            Reroll::Fresh("v3".into())
        );
        assert_eq!(
            identity
                .reroll(Some("v3"), || async { Some("v4".to_string()) })
                .await,
            Reroll::BudgetSpent
        );
    }

    #[test]
    fn saved_identity_is_restored_and_forgotten() {
        let dir = std::env::temp_dir().join(format!("flow-visitor-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("visitor_identity.json");

        let first = VisitorIdentity::default();
        first.set_file(path.clone());
        first.store("kept".into());

        let second = VisitorIdentity::default();
        second.set_file(path.clone());
        assert_eq!(second.current().as_deref(), Some("kept"));

        second.forget_if("other");
        assert_eq!(second.current().as_deref(), Some("kept"));
        second.forget_if("kept");
        assert_eq!(second.current(), None);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
