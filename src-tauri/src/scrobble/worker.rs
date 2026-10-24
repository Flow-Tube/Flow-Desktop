//! Sends the queued listens in the background: once at launch, whenever a listen is queued, and
//! again with exponential backoff while a service is down or the network is gone.

use std::sync::Arc;
use std::time::Duration;

use super::scrobbler::Scrobbler;

const FIRST_RETRY: Duration = Duration::from_mins(5);
const LONGEST_RETRY: Duration = Duration::from_hours(6);

pub fn next_backoff(previous: Option<Duration>) -> Duration {
    previous.map_or(FIRST_RETRY, |delay| (delay * 2).min(LONGEST_RETRY))
}

pub fn spawn(scrobbler: Arc<Scrobbler>) {
    tauri::async_runtime::spawn(async move {
        let mut backoff: Option<Duration> = None;
        loop {
            let done = match scrobbler.flush().await {
                Ok(done) => done,
                Err(error) => {
                    tracing::warn!(%error, "Scrobble flush failed");
                    false
                }
            };
            backoff = if done {
                None
            } else {
                Some(next_backoff(backoff))
            };
            match backoff {
                None => scrobbler.wake.notified().await,
                Some(delay) => {
                    tokio::select! {
                        () = tokio::time::sleep(delay) => {}
                        () = scrobbler.wake.notified() => {}
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_from_five_minutes_up_to_six_hours() {
        let first = next_backoff(None);
        assert_eq!(first, FIRST_RETRY);
        assert_eq!(next_backoff(Some(first)), Duration::from_mins(10));
        assert_eq!(next_backoff(Some(LONGEST_RETRY)), LONGEST_RETRY);
    }
}
