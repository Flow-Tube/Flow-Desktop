use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
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

/// Cache of minted tokens keyed by content binding (visitor data). The mutex is
/// held across the mint so concurrent requests for the same binding don't each
/// spawn the (multi-second) BotGuard VM.
fn token_cache() -> &'static Mutex<HashMap<String, MintedToken>> {
    static CACHE: OnceLock<Mutex<HashMap<String, MintedToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve the Node executable. Honors `FLOW_NODE`, else relies on PATH.
pub(crate) fn node_command() -> String {
    std::env::var("FLOW_NODE").unwrap_or_else(|_| "node".to_string())
}

/// Locate a bundled `sidecar/<name>` script, in dev (repo or `src-tauri`) and
/// packaged (next to the executable or under its `resources`) layouts.
pub(crate) fn sidecar_script_path(name: &str, override_var: &str) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var(override_var) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }

    let rel = std::path::Path::new("sidecar").join(name);
    let mut candidates: Vec<PathBuf> =
        vec![rel.clone(), std::path::Path::new("src-tauri").join(&rel)];

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(&rel));
        candidates.push(cwd.join("src-tauri").join(&rel));
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            let Some(current) = dir else { break };
            candidates.push(current.join(&rel));
            candidates.push(current.join("resources").join(&rel));
            dir = current.parent().map(|p| p.to_path_buf());
        }
    }

    candidates.into_iter().find(|path| path.is_file())
}

async fn run_sidecar(content_binding: &str) -> Option<MintedToken> {
    let Some(script) = sidecar_script_path("integrity.cjs", "FLOW_INTEGRITY_SCRIPT") else {
        warn!("integrity.cjs sidecar not found; cannot mint PO token");
        return None;
    };

    let output = match tokio::process::Command::new(node_command())
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

    let mut cache = token_cache().lock().await;
    if let Some(cached) = cache.get(content_binding) {
        if cached.is_fresh() {
            return Some(cached.clone());
        }
    }

    // Prefer the real-browser WebView mint (highest-fidelity attestation); fall
    // back to the headless Node sidecar when there is no GUI (unit tests, dev).
    let minted = match crate::api::innertube::core::webview_pot::mint(content_binding).await {
        Some(result) => MintedToken {
            po_token: result.po_token,
            integrity_token: result.integrity_token,
            ttl: result.ttl,
            minted_at: Instant::now(),
        },
        None => run_sidecar(content_binding).await?,
    };
    cache.insert(content_binding.to_string(), minted.clone());
    Some(minted)
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
