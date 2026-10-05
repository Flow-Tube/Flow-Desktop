use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::{Notify, OnceCell, Semaphore};

pub(crate) struct PlayerFlights<T> {
    entries: Mutex<HashMap<String, Weak<OnceCell<T>>>>,
}

impl<T> Default for PlayerFlights<T> {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> PlayerFlights<T> {
    pub fn for_video(&self, video_id: &str) -> Arc<OnceCell<T>> {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries.retain(|_, flight| flight.strong_count() > 0);
        if let Some(flight) = entries.get(video_id).and_then(Weak::upgrade) {
            return flight;
        }
        let flight = Arc::new(OnceCell::new());
        entries.insert(video_id.to_owned(), Arc::downgrade(&flight));
        flight
    }
}

pub(crate) struct PlaybackPriority {
    active: Mutex<usize>,
    idle: Notify,
    metadata: Semaphore,
}

impl Default for PlaybackPriority {
    fn default() -> Self {
        Self {
            active: Mutex::new(0),
            idle: Notify::new(),
            metadata: Semaphore::new(2),
        }
    }
}

impl PlaybackPriority {
    pub fn start_stream(&self) -> StreamPriorityGuard<'_> {
        *self
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) += 1;
        StreamPriorityGuard(self)
    }

    pub async fn start_metadata(&self) -> tokio::sync::SemaphorePermit<'_> {
        let permit = self
            .metadata
            .acquire()
            .await
            .expect("metadata semaphore stays open");
        loop {
            let idle = self.idle.notified();
            // Register before checking, including when the last stream is cancelled.
            tokio::pin!(idle);
            idle.as_mut().enable();
            if *self
                .active
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                == 0
            {
                return permit;
            }
            idle.await;
        }
    }
}

pub(crate) struct StreamPriorityGuard<'a>(&'a PlaybackPriority);

impl Drop for StreamPriorityGuard<'_> {
    fn drop(&mut self) {
        let mut active = self
            .0
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *active -= 1;
        if *active == 0 {
            self.0.idle.notify_waiters();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn shares_pending_failures_but_allows_a_later_retry() {
        let flights = PlayerFlights::default();
        let first = flights.for_video("video");
        let second = flights.for_video("video");
        let calls = AtomicUsize::new(0);
        let resolve = || async {
            calls.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Err::<(), _>("botCheckRequired")
        };
        let (a, b) = tokio::join!(first.get_or_init(resolve), second.get_or_init(resolve));
        assert_eq!(a, b);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        drop(first);
        drop(second);
        assert!(flights.for_video("video").get().is_none());
    }

    #[tokio::test]
    async fn foreground_never_waits_for_metadata_and_releases_waiters_on_drop() {
        let priority = PlaybackPriority::default();
        let existing_metadata = priority.start_metadata().await;
        let stream = priority.start_stream();
        let waiting = priority.start_metadata();
        tokio::pin!(waiting);
        assert!(futures_util::poll!(&mut waiting).is_pending());
        drop(stream);
        assert!(futures_util::poll!(&mut waiting).is_ready());
        drop(existing_metadata);
    }
}
