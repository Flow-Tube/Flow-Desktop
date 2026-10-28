//! Progress events for the download dock: at most four a second per download, with
//! the speed over the last five seconds and the time left. Logs stay on the backend
//! and are read when the details view opens.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::{DownloadManager, DownloadMediaKind};

pub const DOWNLOAD_EVENT: &str = "download-progress";
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
const RATE_WINDOW: Duration = Duration::from_secs(5);
pub const MAX_LOG_LINES: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub title: String,
    pub media_kind: DownloadMediaKind,
    pub quality_label: String,
    pub file_path: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub status: DownloadStatus,
    pub error: Option<String>,
    /// Coarse failure category for a failed download; null otherwise.
    pub error_kind: Option<String>,
    pub video_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub collection_db_id: Option<i64>,
    pub artist: Option<String>,
    pub bytes_per_second: Option<u64>,
    pub eta_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    WaitingForNetwork,
    Muxing,
    Completed,
    Failed,
    Cancelled,
}

/// What every event of one download repeats.
pub struct ProgressInfo {
    pub id: String,
    pub title: String,
    pub media_kind: DownloadMediaKind,
    pub quality_label: String,
    pub file_path: String,
    pub video_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub collection_db_id: Option<i64>,
    pub artist: Option<String>,
}

#[derive(Default)]
struct RateState {
    last_emit: Option<Instant>,
    samples: VecDeque<(Instant, u64)>,
}

#[derive(Clone)]
pub struct ProgressEmitter {
    app: AppHandle,
    manager: DownloadManager,
    info: Arc<ProgressInfo>,
    pub downloaded: Arc<AtomicU64>,
    /// Zero while unknown.
    total: Arc<AtomicU64>,
    logs: Arc<Mutex<Vec<String>>>,
    rate: Arc<Mutex<RateState>>,
}

impl ProgressEmitter {
    pub fn new(app: &AppHandle, manager: &DownloadManager, info: ProgressInfo) -> Self {
        let logs = manager.logs_for(&info.id);
        Self {
            app: app.clone(),
            manager: manager.clone(),
            info: Arc::new(info),
            downloaded: Arc::new(AtomicU64::new(0)),
            total: Arc::new(AtomicU64::new(0)),
            logs,
            rate: Arc::new(Mutex::new(RateState::default())),
        }
    }

    pub fn set_total(&self, total: Option<u64>) {
        self.total.store(total.unwrap_or(0), Ordering::Relaxed);
    }

    pub fn log(&self, message: impl Into<String>) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(message.into());
            if logs.len() > MAX_LOG_LINES {
                logs.remove(0);
            }
        }
    }

    pub fn emit(&self, status: DownloadStatus, error: Option<String>) {
        self.send(status, error, None);
    }

    /// A terminal failure. These never cross the `AppError` boundary (they come from
    /// a background task), so they are logged here or they would leave no trace.
    pub fn emit_failure(&self, error: String, kind: &str) {
        tracing::warn!(id = %self.info.id, video_id = ?self.info.video_id, kind, error = %error, "download_failed");
        self.log(format!("Download failed: {error}"));
        self.send(DownloadStatus::Failed, Some(error), Some(kind.to_string()));
    }

    /// Sends a `Downloading` event unless one went out in the last 250 ms.
    pub fn emit_downloading(&self) {
        let now = Instant::now();
        {
            let Ok(mut rate) = self.rate.lock() else {
                return;
            };
            if rate
                .last_emit
                .is_some_and(|last| now.duration_since(last) < EMIT_INTERVAL)
            {
                return;
            }
            rate.last_emit = Some(now);
        }
        self.emit(DownloadStatus::Downloading, None);
    }

    fn send(&self, status: DownloadStatus, error: Option<String>, error_kind: Option<String>) {
        let downloaded = self.downloaded.load(Ordering::Relaxed);
        let total = Some(self.total.load(Ordering::Relaxed)).filter(|total| *total > 0);
        let (bytes_per_second, eta_seconds) = if status == DownloadStatus::Downloading {
            self.speed(downloaded, total)
        } else {
            (None, None)
        };
        let progress = DownloadProgress {
            id: self.info.id.clone(),
            title: self.info.title.clone(),
            media_kind: self.info.media_kind,
            quality_label: self.info.quality_label.clone(),
            file_path: self.info.file_path.clone(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            status,
            error,
            error_kind,
            video_id: self.info.video_id.clone(),
            thumbnail_url: self.info.thumbnail_url.clone(),
            collection_db_id: self.info.collection_db_id,
            artist: self.info.artist.clone(),
            bytes_per_second,
            eta_seconds,
        };
        self.manager.remember(progress.clone());
        let _ = self.app.emit(DOWNLOAD_EVENT, progress);
    }

    fn speed(&self, downloaded: u64, total: Option<u64>) -> (Option<u64>, Option<u64>) {
        let Ok(mut rate) = self.rate.lock() else {
            return (None, None);
        };
        let now = Instant::now();
        rate.samples.push_back((now, downloaded));
        while rate
            .samples
            .front()
            .is_some_and(|(at, _)| now.duration_since(*at) > RATE_WINDOW)
        {
            rate.samples.pop_front();
        }
        speed_from_samples(&rate.samples, downloaded, total)
    }
}

fn speed_from_samples(
    samples: &VecDeque<(Instant, u64)>,
    downloaded: u64,
    total: Option<u64>,
) -> (Option<u64>, Option<u64>) {
    let (Some((first_at, first_bytes)), Some((last_at, _))) = (samples.front(), samples.back())
    else {
        return (None, None);
    };
    let elapsed_ms = u64::try_from(last_at.duration_since(*first_at).as_millis()).unwrap_or(0);
    if elapsed_ms < 500 {
        return (None, None);
    }
    let per_second = downloaded.saturating_sub(*first_bytes) * 1000 / elapsed_ms;
    if per_second == 0 {
        return (Some(0), None);
    }
    let eta = total.map(|total| total.saturating_sub(downloaded).div_ceil(per_second));
    (Some(per_second), eta)
}

#[cfg(test)]
mod tests {
    use super::speed_from_samples;
    use std::collections::VecDeque;
    use std::time::{Duration, Instant};

    #[test]
    fn speed_and_time_left_come_from_the_window() {
        let start = Instant::now();
        let samples: VecDeque<(Instant, u64)> = [
            (start, 1_000_000),
            (start + Duration::from_secs(2), 5_000_000),
        ]
        .into_iter()
        .collect();
        let (speed, eta) = speed_from_samples(&samples, 5_000_000, Some(13_000_000));
        assert_eq!(speed, Some(2_000_000));
        assert_eq!(eta, Some(4));
    }

    #[test]
    fn too_short_a_window_reports_nothing() {
        let start = Instant::now();
        let samples: VecDeque<(Instant, u64)> =
            [(start, 0), (start + Duration::from_millis(100), 10)]
                .into_iter()
                .collect();
        assert_eq!(speed_from_samples(&samples, 10, Some(100)), (None, None));
    }
}
