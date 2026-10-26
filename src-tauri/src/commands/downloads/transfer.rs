//! Moving bytes: ranged, resumable, optionally split across workers. A partial file
//! is always appended to, so a paused, interrupted or restarted download continues
//! where it stopped as long as the stream is the same.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::Ordering;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE, RETRY_AFTER, USER_AGENT};
use reqwest::{Client, StatusCode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::DownloadControl;
use super::progress::{DownloadStatus, ProgressEmitter};
use super::source::{Role, SourceSlot};
use crate::api::innertube::download::DownloadContainer;

const MIN_PARALLEL_FILE_BYTES: u64 = 4 * 1024 * 1024;
const COPY_BUFFER_BYTES: usize = 256 * 1024;
/// Network errors, 408, 429 and 5xx are retried this many times before the
/// download fails with a Retry button.
const MAX_RETRIES: u32 = 8;
const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

/// One client for every download: no transparent decompression (ranges must count
/// raw bytes), and each request names its own user agent.
fn download_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .build()
            .unwrap_or_default()
    })
}

/// One track of a job: where its bytes go and how to fetch them.
pub struct TrackFetch<'a> {
    pub source: &'a SourceSlot,
    pub role: Role,
    pub path: &'a Path,
    pub parallel: bool,
    pub threads: u8,
    pub control: &'a DownloadControl,
    pub emitter: &'a ProgressEmitter,
    pub label: &'static str,
}

/// The size of a track, asked for with a fresh link if the first one is refused.
pub async fn probe_length(fetch: &TrackFetch<'_>) -> Option<u64> {
    for _ in 0..2 {
        let source = fetch.source.current(fetch.role).await;
        let client = download_client();
        if let Ok(response) = client
            .head(&source.url)
            .header(USER_AGENT, &source.user_agent)
            .send()
            .await
        {
            if is_refusal(response.status()) {
                fetch.source.refresh(fetch.role, &source.url).await.ok()?;
                continue;
            }
            if response.status().is_success()
                && let Some(length) = response
                    .headers()
                    .get(CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
            {
                return Some(length);
            }
        }
        let response = client
            .get(&source.url)
            .header(USER_AGENT, &source.user_agent)
            .header(RANGE, "bytes=0-0")
            .send()
            .await
            .ok()?;
        if is_refusal(response.status()) {
            fetch.source.refresh(fetch.role, &source.url).await.ok()?;
            continue;
        }
        return response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit('/').next())
            .and_then(|value| value.parse::<u64>().ok());
    }
    None
}

/// Downloads a track into `fetch.path`, in parallel ranges when it is large enough.
pub async fn fetch_track(fetch: &TrackFetch<'_>, total: Option<u64>) -> Result<(), String> {
    discard_oversized(fetch.path, total).await;
    // A track assembled before the app closed is already whole.
    if let Some(total) = total
        && tokio::fs::metadata(fetch.path)
            .await
            .is_ok_and(|metadata| metadata.len() == total)
    {
        fetch.emitter.downloaded.fetch_add(total, Ordering::Relaxed);
        return Ok(());
    }
    let use_parallel = fetch.parallel
        && fetch.threads > 1
        && total.is_some_and(|bytes| bytes >= MIN_PARALLEL_FILE_BYTES);
    if use_parallel {
        download_parallel(fetch, total.unwrap_or(0)).await
    } else {
        download_range_resumable(
            fetch,
            fetch.path,
            0,
            total.map(|t| t.saturating_sub(1)),
            total,
        )
        .await
    }
}

/// A partial file larger than the stream belongs to another stream; start over.
async fn discard_oversized(path: &Path, total: Option<u64>) {
    let Some(total) = total else { return };
    if tokio::fs::metadata(path)
        .await
        .is_ok_and(|metadata| metadata.len() > total)
    {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub fn part_path(path: &Path, worker: u64) -> PathBuf {
    PathBuf::from(format!("{}.part{worker}", path.to_string_lossy()))
}

async fn download_parallel(fetch: &TrackFetch<'_>, total: u64) -> Result<(), String> {
    let worker_count = u64::from(fetch.threads).min(total.max(1));
    let chunk_size = total.div_ceil(worker_count);
    let mut ranges = Vec::new();
    for worker in 0..worker_count {
        let start = worker * chunk_size;
        if start >= total {
            break;
        }
        let end = ((worker + 1) * chunk_size).min(total) - 1;
        ranges.push((worker, start, end));
    }
    // Every worker runs inside this task, so they can share the fetch by reference.
    let results =
        futures_util::future::join_all(
            ranges.iter().map(|(worker, start, end)| {
                let part = part_path(fetch.path, *worker);
                async move {
                    download_range_resumable(fetch, &part, *start, Some(*end), Some(total)).await
                }
            }),
        )
        .await;
    for result in results {
        result?;
    }

    let mut output = tokio::fs::File::create(fetch.path)
        .await
        .map_err(|error| format!("Could not assemble the download: {error}"))?;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    for (worker, _, _) in &ranges {
        let path = part_path(fetch.path, *worker);
        let mut part = tokio::fs::File::open(&path)
            .await
            .map_err(|error| format!("Could not read a download fragment: {error}"))?;
        loop {
            let read = part
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Could not read a download fragment: {error}"))?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .await
                .map_err(|error| format!("Could not assemble the download: {error}"))?;
        }
        let _ = tokio::fs::remove_file(path).await;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("Could not flush the assembled download: {error}"))
}

fn is_refusal(status: StatusCode) -> bool {
    status == StatusCode::FORBIDDEN || status == StatusCode::GONE
}

fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

#[allow(clippy::too_many_lines)] // One request loop: refusal, retry, range checks and the copy.
async fn download_range_resumable(
    fetch: &TrackFetch<'_>,
    path: &Path,
    range_start: u64,
    range_end: Option<u64>,
    stream_total: Option<u64>,
) -> Result<(), String> {
    let label = fetch.label;
    let emitter = fetch.emitter;
    let expected_length = range_end.map(|end| end.saturating_sub(range_start) + 1);
    let mut existing = tokio::fs::metadata(path)
        .await
        .map_or(0, |metadata| metadata.len());
    if expected_length.is_some_and(|expected| existing > expected) {
        let _ = tokio::fs::remove_file(path).await;
        existing = 0;
    }
    if existing > 0 {
        emitter.downloaded.fetch_add(existing, Ordering::Relaxed);
    }
    if expected_length == Some(existing) {
        return Ok(());
    }
    if existing > 0 {
        emitter.log(format!(
            "Resuming {label} from byte {}",
            range_start + existing
        ));
    }

    let mut retry = 0_u32;
    loop {
        wait_ready(fetch.control, emitter).await?;
        let source = fetch.source.current(fetch.role).await;
        let request_start = range_start + existing;
        let range = range_end.map_or_else(
            || format!("bytes={request_start}-"),
            |end| format!("bytes={request_start}-{end}"),
        );
        let response = match download_client()
            .get(&source.url)
            .header(USER_AGENT, &source.user_agent)
            .header(RANGE, range.clone())
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                retry += 1;
                wait_for_retry(
                    fetch,
                    retry,
                    format!("{label} request failed at byte {request_start}: {error}"),
                    None,
                )
                .await?;
                continue;
            }
        };

        let status = response.status();
        if is_refusal(status) {
            emitter.log(format!(
                "{label}: the media server refused the link (HTTP {status}); asking for a fresh one"
            ));
            fetch.source.refresh(fetch.role, &source.url).await?;
            continue;
        }
        if status != StatusCode::PARTIAL_CONTENT
            && !(status.is_success() && request_start == 0 && range_end.is_none())
        {
            if is_retryable_status(status) {
                retry += 1;
                let wait = retry_after(&response);
                wait_for_retry(
                    fetch,
                    retry,
                    format!("{label} server returned HTTP {status} for {range}"),
                    wait,
                )
                .await?;
                continue;
            }
            return Err(format!(
                "{label} cannot resume: media server returned HTTP {status} for {range}"
            ));
        }
        if status == StatusCode::PARTIAL_CONTENT {
            let content_range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    format!("{label} response omitted Content-Range for requested {range}")
                })?;
            let (actual_start, actual_end, actual_total) = parse_content_range(content_range)
                .ok_or_else(|| {
                    format!("{label} returned malformed Content-Range `{content_range}`")
                })?;
            if actual_start != request_start
                || range_end.is_some_and(|requested_end| actual_end > requested_end)
            {
                return Err(format!(
                    "{label} response range mismatch: requested {range}, received `{content_range}`"
                ));
            }
            if let (Some(expected), Some(actual)) = (stream_total, actual_total)
                && expected != actual
            {
                return Err(format!(
                    "{label} changed size ({expected} to {actual} bytes) and cannot be resumed"
                ));
            }
        }

        let mut output = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .map_err(|error| format!("Could not open partial {label}: {error}"))?;
        let mut stream = response.bytes_stream();
        let mut interrupted = None;
        while let Some(chunk) = stream.next().await {
            wait_ready(fetch.control, emitter).await?;
            match chunk {
                Ok(chunk) => {
                    output
                        .write_all(&chunk)
                        .await
                        .map_err(|error| format!("Could not write {label}: {error}"))?;
                    let chunk_len = chunk.len() as u64;
                    existing += chunk_len;
                    emitter.downloaded.fetch_add(chunk_len, Ordering::Relaxed);
                    emitter.emit_downloading();
                    // A healthy stream resets the retry budget.
                    retry = 0;
                }
                Err(error) => {
                    interrupted = Some(format!(
                        "{label} stream interrupted at byte {}: {error}",
                        range_start + existing
                    ));
                    break;
                }
            }
        }
        output
            .flush()
            .await
            .map_err(|error| format!("Could not flush partial {label}: {error}"))?;

        if (expected_length.is_none() && interrupted.is_none()) || expected_length == Some(existing)
        {
            return Ok(());
        }
        if expected_length.is_some_and(|expected| existing > expected) {
            return Err(format!(
                "{label} exceeded its expected size ({existing} bytes received)"
            ));
        }
        retry += 1;
        wait_for_retry(
            fetch,
            retry,
            interrupted.unwrap_or_else(|| {
                format!(
                    "{label} ended early at byte {}; reconnecting",
                    range_start + existing
                )
            }),
            None,
        )
        .await?;
    }
}

pub fn parse_content_range(value: &str) -> Option<(u64, u64, Option<u64>)> {
    let value = value.strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((
        start.parse().ok()?,
        end.parse().ok()?,
        (total != "*").then(|| total.parse().ok()).flatten(),
    ))
}

/// Returns once the job may move bytes: not cancelled, not paused, and holding one
/// of the shared download slots. A paused job gives its slot back so the next
/// download can start. Several workers of one job wait here at once; only the one
/// that gives the slot up, or takes it back, reports it.
pub async fn wait_ready(
    control: &DownloadControl,
    emitter: &ProgressEmitter,
) -> Result<(), String> {
    let mut paused = false;
    let mut took_slot = false;
    let mut queued = false;
    loop {
        let notified = control.changed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if control.cancelled.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        if control.paused.load(Ordering::Relaxed) {
            if !paused {
                paused = true;
                if control.release_slot().await {
                    emitter.log("Download paused by the user");
                    emitter.emit(DownloadStatus::Paused, None);
                }
            }
            notified.await;
            continue;
        }
        if control.holds_slot() {
            if paused && took_slot {
                emitter.log("Download resumed");
                emitter.emit(DownloadStatus::Downloading, None);
            }
            return Ok(());
        }
        if paused && !queued {
            // Resumed, but every slot is busy: it waits its turn like a new download.
            queued = true;
            emitter.emit(DownloadStatus::Queued, None);
        }
        tokio::select! {
            permit = control.permits.clone().acquire_owned() => {
                let permit = permit.map_err(|error| format!("Download queue stopped: {error}"))?;
                took_slot = control.take_slot(permit).await;
            }
            () = &mut notified => {}
        }
    }
}

async fn wait_for_retry(
    fetch: &TrackFetch<'_>,
    attempt: u32,
    reason: String,
    retry_after: Option<Duration>,
) -> Result<(), String> {
    if attempt > MAX_RETRIES {
        return Err(format!("{reason} (gave up after {MAX_RETRIES} tries)"));
    }
    let backoff = Duration::from_secs(1 << attempt.saturating_sub(1).min(5));
    let delay = retry_after.unwrap_or(backoff).min(MAX_RETRY_DELAY);
    fetch.emitter.log(format!(
        "{reason}; retrying in {}s (try {attempt} of {MAX_RETRIES})",
        delay.as_secs()
    ));
    fetch
        .emitter
        .emit(DownloadStatus::WaitingForNetwork, Some(reason));
    tokio::select! {
        () = tokio::time::sleep(delay) => {}
        () = fetch.control.changed.notified() => {}
    }
    wait_ready(fetch.control, fetch.emitter).await?;
    fetch.emitter.emit(DownloadStatus::Downloading, None);
    Ok(())
}

/// Checks a finished track starts the way its container should, and downloads it
/// once more in a single clean stream when it does not.
pub async fn ensure_valid_track(
    fetch: &TrackFetch<'_>,
    container: DownloadContainer,
    total: Option<u64>,
) -> Result<(), String> {
    let label = fetch.label;
    let prefix = read_prefix(fetch.path).await?;
    if has_container_signature(&prefix, container) {
        return Ok(());
    }
    fetch.emitter.log(format!(
        "{label} does not start like a {} file ({}); downloading it again in one stream",
        container_name(container),
        hex_preview(&prefix, 16)
    ));
    let size = tokio::fs::metadata(fetch.path)
        .await
        .map_or(0, |metadata| metadata.len());
    fetch.emitter.downloaded.fetch_sub(
        size.min(fetch.emitter.downloaded.load(Ordering::Relaxed)),
        Ordering::Relaxed,
    );
    let _ = tokio::fs::remove_file(fetch.path).await;
    let single = TrackFetch {
        parallel: false,
        threads: 1,
        ..*fetch
    };
    fetch_track(&single, total).await?;
    let repaired = read_prefix(fetch.path).await?;
    if has_container_signature(&repaired, container) {
        Ok(())
    } else {
        Err(format!(
            "{label} is not a valid {} file after a clean retry (first bytes {})",
            container_name(container),
            hex_preview(&repaired, 32)
        ))
    }
}

async fn read_prefix(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("Could not inspect `{}`: {error}", path.display()))?;
    let mut prefix = vec![0_u8; 32];
    let read = file
        .read(&mut prefix)
        .await
        .map_err(|error| format!("Could not inspect `{}`: {error}", path.display()))?;
    prefix.truncate(read);
    Ok(prefix)
}

pub fn has_container_signature(prefix: &[u8], container: DownloadContainer) -> bool {
    match container {
        DownloadContainer::Mkv => prefix.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
        DownloadContainer::Mp4 => prefix.get(4..8).is_some_and(|box_type| box_type == b"ftyp"),
    }
}

fn container_name(container: DownloadContainer) -> &'static str {
    match container {
        DownloadContainer::Mp4 => "MP4",
        DownloadContainer::Mkv => "WebM",
    }
}

fn hex_preview(bytes: &[u8], limit: usize) -> String {
    bytes
        .iter()
        .take(limit)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{has_container_signature, parse_content_range};
    use crate::api::innertube::download::DownloadContainer;

    #[test]
    fn parses_and_validates_http_content_ranges() {
        assert_eq!(
            parse_content_range("bytes 1048576-2097151/8388608"),
            Some((1_048_576, 2_097_151, Some(8_388_608)))
        );
        assert_eq!(parse_content_range("bytes 0-99/*"), Some((0, 99, None)));
        assert_eq!(parse_content_range("garbage"), None);
    }

    #[test]
    fn recognizes_track_container_signatures() {
        assert!(has_container_signature(
            &[0x1A, 0x45, 0xDF, 0xA3, 0x9F],
            DownloadContainer::Mkv
        ));
        assert!(has_container_signature(
            &[0, 0, 0, 24, b'f', b't', b'y', b'p'],
            DownloadContainer::Mp4
        ));
        assert!(!has_container_signature(
            &[0, 0, 0, 0, 0, 0, 0, 0],
            DownloadContainer::Mkv
        ));
    }
}
