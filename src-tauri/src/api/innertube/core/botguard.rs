use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// A freshly minted attestation result from the headless BotGuard sidecar.
///
/// `po_token` is the visitorData-bound PO token used both in the `/player`
/// request body (`serviceIntegrityDimensions.poToken`) and as the SABR
/// `StreamerContext.po_token`. `integrity_token` is retained for callers that
/// need the raw GenerateIT token; `ttl` is the server-estimated lifetime.
#[derive(Debug, Clone)]
pub struct MintedToken {
    pub po_token: String,
    #[allow(dead_code)]
    pub integrity_token: String,
    pub ttl: u64,
    minted_at: Instant,
}

impl MintedToken {
    fn is_fresh(&self) -> bool {
        const REFRESH_MARGIN_SECS: u64 = 300;
        let lifetime = self.ttl.saturating_sub(REFRESH_MARGIN_SECS).max(60);
        self.minted_at.elapsed().as_secs() < lifetime
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResponse {
    success: bool,
    #[serde(default)]
    po_token: Option<String>,
    #[serde(default)]
    integrity_token: Option<String>,
    #[serde(default)]
    ttl: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

/// Cache of minted tokens keyed by content binding. The lock is only held to
/// read or write an entry, never across a mint.
fn token_cache() -> &'static Mutex<HashMap<String, MintedToken>> {
    static CACHE: OnceLock<Mutex<HashMap<String, MintedToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Mints running at once. Each opens a hidden web view or a Node process, so
/// a burst of resolves (prefetch, previews) must not start one per video.
const CONCURRENT_MINTS: usize = 2;

/// One turn at a time per binding, so concurrent requests for the same binding
/// share one mint instead of each starting the (multi-second) BotGuard VM,
/// while a request for another binding doesn't wait behind it.
fn mint_turn(binding: &str) -> Arc<Mutex<()>> {
    static TURNS: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut turns = TURNS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // Nobody else holds a turn that only this map still points to.
    turns.retain(|_, turn| Arc::strong_count(turn) > 1);
    turns.entry(binding.to_owned()).or_default().clone()
}

async fn cached_token(binding: &str) -> Option<MintedToken> {
    token_cache()
        .lock()
        .await
        .get(binding)
        .filter(|token| token.is_fresh())
        .cloned()
}

/// The cached token for `binding`, or the one `mint` makes. `mint` runs at most
/// once at a time per binding and [`CONCURRENT_MINTS`] times overall.
async fn cached_or_minted<F, Fut>(binding: &str, mint: F) -> Option<MintedToken>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Option<MintedToken>>,
{
    static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(CONCURRENT_MINTS);

    if let Some(cached) = cached_token(binding).await {
        return Some(cached);
    }
    let turn = mint_turn(binding);
    let _turn = turn.lock().await;
    // Whoever had the turn before may have minted this binding meanwhile.
    if let Some(cached) = cached_token(binding).await {
        return Some(cached);
    }
    let minted = {
        let _slot = SLOTS.acquire().await.ok()?;
        mint().await?
    };
    let mut cache = token_cache().lock().await;
    cache.retain(|_, token| token.is_fresh());
    cache.insert(binding.to_owned(), minted.clone());
    Some(minted)
}

/// Resolve the Node executable. Honors `FLOW_NODE`, else relies on PATH.
pub(crate) fn node_command() -> String {
    std::env::var("FLOW_NODE").unwrap_or_else(|_| "node".to_string())
}

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record Tauri's resource directory. Linux bundles install resources under
/// `<prefix>/lib/<productName>/`, which is not an ancestor of the executable,
/// so the walk in [`sidecar_candidates`] alone never finds them there.
pub(crate) fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Locate a bundled `sidecar/<name>` script, in packaged (Tauri resource dir,
/// next to the executable or under its `resources`) and dev (repo or
/// `src-tauri`) layouts.
pub(crate) fn sidecar_script_path(name: &str, override_var: &str) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var(override_var) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    let cwd = std::env::current_dir().ok();
    let exe = std::env::current_exe().ok();
    sidecar_candidates(
        name,
        RESOURCE_DIR.get().map(PathBuf::as_path),
        cwd.as_deref(),
        exe.as_deref(),
    )
    .into_iter()
    .find(|path| path.is_file())
}

fn sidecar_candidates(
    name: &str,
    resource_dir: Option<&Path>,
    cwd: Option<&Path>,
    exe: Option<&Path>,
) -> Vec<PathBuf> {
    let rel = Path::new("sidecar").join(name);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = resource_dir {
        candidates.push(dir.join(&rel));
    }

    candidates.push(rel.clone());
    candidates.push(Path::new("src-tauri").join(&rel));

    if let Some(cwd) = cwd {
        candidates.push(cwd.join(&rel));
        candidates.push(cwd.join("src-tauri").join(&rel));
    }

    let mut dir = exe.and_then(Path::parent);
    for _ in 0..5 {
        let Some(current) = dir else { break };
        candidates.push(current.join(&rel));
        candidates.push(current.join("resources").join(&rel));
        dir = current.parent();
    }

    candidates
}

async fn run_sidecar(content_binding: &str) -> Option<MintedToken> {
    let Some(script) = sidecar_script_path("integrity.cjs", "FLOW_INTEGRITY_SCRIPT") else {
        warn!("integrity.cjs sidecar not found; cannot mint PO token");
        return None;
    };

    let output = match crate::appimage::host_tokio_command(node_command())
        .arg(&script)
        .arg(content_binding)
        .output()
        .await
    {
        Ok(output) => output,
        Err(error) => {
            warn!(%error, "Failed to spawn Node integrity sidecar (is Node installed / on PATH?)");
            return None;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    // The sidecar writes exactly one JSON object to stdout; be tolerant of any
    // stray output by taking the last brace-delimited line.
    let json_line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{') && line.ends_with('}'))
        .unwrap_or_else(|| stdout.trim());

    let parsed: SidecarResponse = match serde_json::from_str(json_line) {
        Ok(parsed) => parsed,
        Err(error) => {
            warn!(
                %error,
                stderr = %String::from_utf8_lossy(&output.stderr).trim(),
                "Could not parse integrity sidecar output"
            );
            return None;
        }
    };

    if !parsed.success {
        warn!(
            error = parsed.error.as_deref().unwrap_or("unknown"),
            "Integrity sidecar reported failure"
        );
        return None;
    }

    let po_token = parsed.po_token?;
    if po_token.is_empty() {
        return None;
    }

    debug!(
        ttl = parsed.ttl.unwrap_or(0),
        "Minted PO token via BotGuard sidecar"
    );
    Some(MintedToken {
        po_token,
        integrity_token: parsed.integrity_token.unwrap_or_default(),
        ttl: parsed.ttl.unwrap_or(43200),
        minted_at: Instant::now(),
    })
}

/// Mint (or reuse a cached) attestation token bound to `content_binding`.
///
/// For logged-out playback `content_binding` must be the session **visitor
/// data** — the binding YouTube's `/player` and GVS/SABR servers validate. The
/// same visitor data must then be used in the requests the token accompanies.
pub async fn mint_po_token(content_binding: &str) -> Option<MintedToken> {
    if content_binding.is_empty() {
        return None;
    }

    cached_or_minted(content_binding, || async {
        // Prefer the real-browser WebView mint (highest-fidelity attestation); fall
        // back to the headless Node sidecar when there is no GUI (unit tests, dev).
        match crate::api::innertube::core::webview_pot::mint(content_binding).await {
            Some(result) => Some(MintedToken {
                po_token: result.po_token,
                integrity_token: result.integrity_token,
                ttl: result.ttl,
                minted_at: Instant::now(),
            }),
            None => run_sidecar(content_binding).await,
        }
    })
    .await
}

/// Generate a BotGuard PO token bound to `content_binding`. Thin wrapper over
/// [`mint_po_token`] kept for existing call sites that only need the token
/// string.
pub async fn generate_po_token(content_binding: &str) -> Option<String> {
    mint_po_token(content_binding)
        .await
        .map(|token| token.po_token)
}

/// Mint a new token for `content_binding`, replacing any cached one. For a SABR
/// session the server has escalated to `ATTESTATION_REQUIRED`: handing back the
/// cached token it just refused would only be refused again.
pub async fn remint_po_token(content_binding: &str) -> Option<String> {
    token_cache().lock().await.remove(content_binding);
    generate_po_token(content_binding).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn token(po_token: &str) -> MintedToken {
        MintedToken {
            po_token: po_token.into(),
            integrity_token: String::new(),
            ttl: 3600,
            minted_at: Instant::now(),
        }
    }

    #[tokio::test]
    async fn requests_for_one_binding_share_a_single_mint() {
        let mints = AtomicUsize::new(0);
        let mint = || async {
            mints.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Some(token("shared"))
        };
        let (first, second) = tokio::join!(
            cached_or_minted("test-shared-binding", mint),
            cached_or_minted("test-shared-binding", mint),
        );
        assert_eq!(first.unwrap().po_token, "shared");
        assert_eq!(second.unwrap().po_token, "shared");
        assert_eq!(mints.load(Ordering::SeqCst), 1);
    }

    /// The cache lock used to be held across the mint, so a slow mint for one
    /// video stalled every other mint, music included.
    #[tokio::test]
    async fn a_slow_mint_does_not_hold_up_another_binding() {
        let (release, held) = tokio::sync::oneshot::channel::<()>();
        let slow = tokio::spawn(cached_or_minted("test-slow-binding", || async {
            let _ = held.await;
            Some(token("slow"))
        }));
        tokio::task::yield_now().await;

        let quick = cached_or_minted("test-quick-binding", || async { Some(token("quick")) }).await;
        assert_eq!(quick.unwrap().po_token, "quick");

        release.send(()).unwrap();
        assert_eq!(slow.await.unwrap().unwrap().po_token, "slow");
    }

    #[tokio::test]
    async fn a_failed_mint_is_not_cached() {
        assert!(
            cached_or_minted("test-failing-binding", || async { None })
                .await
                .is_none()
        );
        let retried =
            cached_or_minted("test-failing-binding", || async { Some(token("retry")) }).await;
        assert_eq!(retried.unwrap().po_token, "retry");
    }

    #[test]
    fn resource_dir_is_tried_first() {
        let candidates = sidecar_candidates(
            "nsig.cjs",
            Some(Path::new("/usr/lib/Flow Beta")),
            None,
            Some(Path::new("/usr/bin/flow-desktop-beta")),
        );
        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/usr/lib/Flow Beta/sidecar/nsig.cjs"))
        );
    }

    #[test]
    fn flatpak_resource_dir_is_a_candidate() {
        let candidates = sidecar_candidates(
            "integrity.cjs",
            Some(Path::new("/app/lib/Flow")),
            None,
            Some(Path::new("/app/bin/flow")),
        );
        assert!(candidates.contains(&PathBuf::from("/app/lib/Flow/sidecar/integrity.cjs")));
    }

    #[test]
    fn executable_ancestors_are_still_walked() {
        let candidates = sidecar_candidates(
            "nsig.cjs",
            None,
            None,
            Some(Path::new("C:/Program Files/Flow/flow.exe")),
        );
        assert!(
            candidates.contains(
                &Path::new("C:/Program Files/Flow")
                    .join("sidecar")
                    .join("nsig.cjs")
            )
        );
    }

    #[test]
    fn dev_layouts_follow_the_working_directory() {
        let candidates = sidecar_candidates("integrity.cjs", None, Some(Path::new("/repo")), None);
        assert!(candidates.contains(&PathBuf::from("/repo/src-tauri/sidecar/integrity.cjs")));
    }
}
