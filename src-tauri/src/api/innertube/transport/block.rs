//! While Google blocks this network, background requests wait instead of adding
//! to the block.
//!
//! The unusual-traffic page blocks the whole IP address for a while, and every
//! request sent meanwhile gets the same page and can keep the block in place
//! longer. Work the viewer didn't ask for (feed fill-ins, prefetches, polls)
//! runs inside [`in_background`] and is held for 15, then 30, then 60 minutes.
//! What the viewer starts always sends, and any answer from the servers lifts
//! the pause.

use std::future::Future;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

const PAUSES: [Duration; 3] = [
    Duration::from_mins(15),
    Duration::from_mins(30),
    Duration::from_mins(60),
];

tokio::task_local! {
    static BACKGROUND: ();
}

#[derive(Debug, Default)]
struct Pause {
    until: Option<Instant>,
    /// Blocks seen in a row, each after the last pause ran out.
    strikes: usize,
}

impl Pause {
    /// A block page arrived. Returns the new pause, or `None` when one already
    /// runs: requests that were sent together come back blocked together, and
    /// count once.
    fn on_block(&mut self, now: Instant) -> Option<Duration> {
        if self.holds(now) {
            return None;
        }
        let pause = PAUSES[self.strikes.min(PAUSES.len() - 1)];
        self.strikes += 1;
        self.until = Some(now + pause);
        Some(pause)
    }

    fn on_answer(&mut self) -> bool {
        let was_paused = self.until.is_some();
        *self = Self::default();
        was_paused
    }

    fn holds(&self, now: Instant) -> bool {
        self.until.is_some_and(|until| now < until)
    }
}

fn state() -> std::sync::MutexGuard<'static, Pause> {
    static STATE: Mutex<Pause> = Mutex::new(Pause {
        until: None,
        strikes: 0,
    });
    STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs `work` as background work, which waits out a block.
pub async fn in_background<F: Future>(work: F) -> F::Output {
    BACKGROUND.scope((), work).await
}

/// Whether a request should wait instead of being sent: it is background work
/// and the network is blocked.
#[must_use]
pub fn holds_request() -> bool {
    BACKGROUND.try_with(|()| ()).is_ok() && state().holds(Instant::now())
}

/// Google answered with its unusual-traffic page.
pub fn record_block() {
    if let Some(pause) = state().on_block(Instant::now()) {
        tracing::warn!(
            minutes = pause.as_secs() / 60,
            "Google is blocking this network; background requests wait"
        );
    }
}

/// An answer arrived, so the network is not blocked anymore.
pub fn record_answer() {
    if state().on_answer() {
        tracing::info!("The network is no longer blocked; background requests resume");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: Duration = Duration::from_secs(60);

    #[test]
    fn each_block_after_a_pause_waits_longer_up_to_an_hour() {
        let mut pause = Pause::default();
        let start = Instant::now();
        assert_eq!(pause.on_block(start), Some(15 * MINUTE));
        assert!(pause.holds(start + 14 * MINUTE));
        assert!(!pause.holds(start + 15 * MINUTE));

        let second = start + 16 * MINUTE;
        assert_eq!(pause.on_block(second), Some(30 * MINUTE));
        let third = second + 31 * MINUTE;
        assert_eq!(pause.on_block(third), Some(60 * MINUTE));
        let fourth = third + 61 * MINUTE;
        assert_eq!(pause.on_block(fourth), Some(60 * MINUTE));
    }

    #[test]
    fn blocks_that_arrive_together_count_once() {
        let mut pause = Pause::default();
        let now = Instant::now();
        assert_eq!(pause.on_block(now), Some(15 * MINUTE));
        assert_eq!(pause.on_block(now + MINUTE), None);
        assert_eq!(pause.strikes, 1);
    }

    #[test]
    fn an_answer_lifts_the_pause_and_starts_over() {
        let mut pause = Pause::default();
        let now = Instant::now();
        pause.on_block(now);
        assert!(pause.on_answer());
        assert!(!pause.holds(now));
        assert!(!pause.on_answer());
        assert_eq!(pause.on_block(now), Some(15 * MINUTE));
    }

    #[tokio::test]
    async fn only_background_work_is_held() {
        assert!(!holds_request());
        assert!(!in_background(async { holds_request() }).await);
    }
}
