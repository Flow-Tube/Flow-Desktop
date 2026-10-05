//! The web player's script, for the two answers only it holds: the current
//! signature timestamp, and the solved form of a stream URL's `n` throttling
//! parameter. Web-family clients (`MWEB`/`WEB`) need both, and googlevideo refuses
//! their SABR endpoint outright while `n` is unsolved.
//!
//! Mirrors Flow for Android's `PlayerJsFetcher` + `CipherDeobfuscator`: the
//! script is cached on disk per player version, and `sidecar/nsig.cjs` runs the
//! script itself rather than re-implementing its transform.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use super::botguard::{node_command, sidecar_script_path};

/// How long a player version is trusted before `iframe_api` is asked again.
const PLAYER_TTL: Duration = Duration::from_hours(6);
const SOLVE_TIMEOUT: Duration = Duration::from_secs(15);
const SOLVED_N_CAPACITY: usize = 512;

struct PlayerScript {
    id: String,
    path: PathBuf,
    signature_timestamp: Option<i64>,
    fetched_at: Instant,
}

#[derive(Deserialize)]
struct SolverResponse {
    success: bool,
    #[serde(default)]
    results: HashMap<String, String>,
    #[serde(default)]
    error: Option<String>,
}

fn current_player() -> &'static Mutex<Option<Arc<PlayerScript>>> {
    static PLAYER: OnceLock<Mutex<Option<Arc<PlayerScript>>>> = OnceLock::new();
    PLAYER.get_or_init(|| Mutex::new(None))
}

/// Solved `n` values keyed by `(player id, n)`: a transform is fixed for a
/// player version, and every format of one response shares the same `n`.
fn solved_n() -> &'static std::sync::Mutex<HashMap<(String, String), String>> {
    static SOLVED: OnceLock<std::sync::Mutex<HashMap<(String, String), String>>> = OnceLock::new();
    SOLVED.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// Fetch the current player ahead of the first web-client request, so the
/// ladder never waits on a 3 MB download mid-resolve.
pub async fn prewarm() {
    let _ = player_script().await;
}

/// The live `signatureTimestamp`, or `None` when the player cannot be fetched.
pub async fn signature_timestamp() -> Option<i64> {
    player_script().await?.signature_timestamp
}

/// `url` with its `n` parameter solved. A URL without `n` is returned as is;
/// `None` means `n` is present but could not be solved, which googlevideo
/// would answer with a 403.
pub async fn solve_n_in_url(url: &str) -> Option<String> {
    let Some(n) = query_value(url, "n") else {
        return Some(url.to_string());
    };
    let player = player_script().await?;
    let key = (player.id.clone(), n.clone());

    let cached = solved_n()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&key)
        .cloned();
    let solved = if let Some(solved) = cached {
        solved
    } else {
        let solved = run_solver(&player, &n).await?;
        let mut cache = solved_n()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cache.len() >= SOLVED_N_CAPACITY {
            cache.clear();
        }
        cache.insert(key, solved.clone());
        solved
    };
    replace_query_value(url, "n", &n, &solved)
}

async fn player_script() -> Option<Arc<PlayerScript>> {
    let mut slot = current_player().lock().await;
    if let Some(player) = slot
        .as_ref()
        .filter(|player| player.fetched_at.elapsed() < PLAYER_TTL)
    {
        return Some(player.clone());
    }
    match fetch_player_script().await {
        Some(player) => {
            let player = Arc::new(player);
            *slot = Some(player.clone());
            Some(player)
        }
        // A player past its TTL still solves until YouTube actually rotates it.
        None => slot.clone(),
    }
}

async fn fetch_player_script() -> Option<PlayerScript> {
    let client = crate::api::http::shared_client();
    let iframe_api = client
        .get("https://www.youtube.com/iframe_api")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let Some(id) = player_id(&iframe_api) else {
        warn!("Player id not found in iframe_api");
        return None;
    };

    let path = std::env::temp_dir()
        .join("flow-desktop-player")
        .join(format!("{id}.js"));
    let cached = tokio::fs::read_to_string(&path)
        .await
        .ok()
        .filter(|source| signature_timestamp_in(source).is_some());
    let source = if let Some(source) = cached {
        source
    } else {
        let url = format!("https://www.youtube.com/s/player/{id}/player_ias.vflset/en_US/base.js");
        let source = client
            .get(&url)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .text()
            .await
            .ok()?;
        // Written aside and renamed, so a crash mid-write never leaves a
        // truncated script for the next launch to load.
        let staging = path.with_extension("js.part");
        tokio::fs::create_dir_all(path.parent()?).await.ok()?;
        tokio::fs::write(&staging, &source).await.ok()?;
        tokio::fs::rename(&staging, &path).await.ok()?;
        remove_other_players(&path).await;
        source
    };

    let signature_timestamp = signature_timestamp_in(&source);
    debug!(player = %id, ?signature_timestamp, "Loaded YouTube player script");
    Some(PlayerScript {
        id,
        path,
        signature_timestamp,
        fetched_at: Instant::now(),
    })
}

/// Old player versions are never loaded again once the site rotates past them.
async fn remove_other_players(current: &std::path::Path) {
    let Some(dir) = current.parent() else { return };
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.path() != current {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

async fn run_solver(player: &PlayerScript, n: &str) -> Option<String> {
    let Some(solver) = sidecar_script_path("nsig.cjs", "FLOW_NSIG_SCRIPT") else {
        warn!("nsig.cjs sidecar not found; cannot solve n");
        return None;
    };
    let output = tokio::time::timeout(
        SOLVE_TIMEOUT,
        tokio::process::Command::new(node_command())
            .arg(&solver)
            .arg(&player.path)
            .arg(n)
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let output = match output {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            warn!(%error, "Failed to spawn the n solver (is Node installed / on PATH?)");
            return None;
        }
        Err(_) => {
            warn!(player = %player.id, "n solver timed out");
            return None;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{'))?;
    let response: SolverResponse = serde_json::from_str(line).ok()?;
    if !response.success {
        warn!(
            player = %player.id,
            error = response.error.as_deref().unwrap_or("unknown"),
            "n solver failed"
        );
        return None;
    }
    response.results.get(n).cloned()
}

/// The 8-hex-digit player version from `iframe_api`, which writes the script
/// path JSON-escaped (`player\/8ab5c328\/`).
fn player_id(iframe_api: &str) -> Option<String> {
    iframe_api.match_indices("player").find_map(|(index, _)| {
        let rest = iframe_api[index + "player".len()..].trim_start_matches('\\');
        let rest = rest.strip_prefix('/')?;
        let id = rest.get(..8)?;
        let terminated = matches!(rest[8..].chars().next(), Some('/' | '\\'));
        (terminated && id.chars().all(|c| c.is_ascii_hexdigit())).then(|| id.to_string())
    })
}

fn signature_timestamp_in(source: &str) -> Option<i64> {
    ["signatureTimestamp:", "sts:"].iter().find_map(|marker| {
        source.match_indices(marker).find_map(|(index, _)| {
            let digits: String = source[index + marker.len()..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            (digits.len() == 5).then(|| digits.parse().ok()).flatten()
        })
    })
}

fn query_value(url: &str, key: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()?
        .query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

/// Swap one query value in place. Rebuilding the query through `Url` would
/// re-encode the signed parameters googlevideo checks byte for byte.
fn replace_query_value(url: &str, key: &str, old: &str, new: &str) -> Option<String> {
    for separator in ['?', '&'] {
        let needle = format!("{separator}{key}={old}");
        if let Some(index) = url.find(&needle) {
            let end = index + needle.len();
            if matches!(url[end..].chars().next(), None | Some('&' | '#')) {
                return Some(format!(
                    "{}{separator}{key}={new}{}",
                    &url[..index],
                    &url[end..]
                ));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_escaped_player_id_from_iframe_api() {
        let iframe = r"var scriptUrl = 'https:\/\/www.youtube.com\/s\/player\/8ab5c328\/www-widgetapi.vflset\/www-widgetapi.js';";
        assert_eq!(player_id(iframe).as_deref(), Some("8ab5c328"));
        assert_eq!(player_id("no player here"), None);
        assert_eq!(player_id(r"player\/xyz12345\/"), None);
    }

    #[test]
    fn reads_a_five_digit_signature_timestamp() {
        assert_eq!(
            signature_timestamp_in("a,signatureTimestamp:20725,b"),
            Some(20725)
        );
        assert_eq!(signature_timestamp_in("x={sts:20725}"), Some(20725));
        assert_eq!(signature_timestamp_in("sts:123"), None);
    }

    #[test]
    fn swaps_only_the_n_parameter_and_keeps_the_rest_byte_for_byte() {
        let url = "https://rr1.googlevideo.com/videoplayback?expire=1&sparams=a%2Cb&n=abc&sig=x";
        assert_eq!(
            replace_query_value(url, "n", "abc", "XYZ").as_deref(),
            Some("https://rr1.googlevideo.com/videoplayback?expire=1&sparams=a%2Cb&n=XYZ&sig=x")
        );
        let tail = "https://h/v?ns=1&n=abc";
        assert_eq!(
            replace_query_value(tail, "n", "abc", "XYZ").as_deref(),
            Some("https://h/v?ns=1&n=XYZ")
        );
        assert_eq!(
            replace_query_value("https://h/v?n=abcd", "n", "abc", "X"),
            None
        );
    }

    #[tokio::test]
    async fn a_url_without_n_needs_no_solving() {
        let url = "https://rr1.googlevideo.com/videoplayback?expire=1&c=VISIONOS";
        assert_eq!(solve_n_in_url(url).await.as_deref(), Some(url));
    }
}
