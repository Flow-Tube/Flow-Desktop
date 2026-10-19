//! Real-browser BotGuard poToken minter via a hidden Tauri WebView.
//!
//! The headless Node sidecar ([`super::botguard`]) mints a valid token, but its
//! attestation is synthetic (a `vm` sandbox + DOM mock). The mobile app mints in
//! a real WebView, and that real-Chromium attestation is the variable we have not
//! yet tried. This module runs the *same* bgutils flow inside a hidden WebView:
//!
//!   1. `mint()` registers a one-shot keyed by a request id and opens a hidden
//!      window at `http://127.0.0.1:<proxy>/potmint?id=…&binding=<visitorData>`.
//!   2. The local proxy serves [`MINT_PAGE_HTML`]; the page runs the full mint in
//!      real Chromium — `Waa/Create` + descramble + VM snapshot + `GenerateIT` +
//!      mint (the WAA endpoints are CORS-permissive, so no Rust round-trip).
//!   3. The page GETs `/potresult?id=…&poToken=…&ttl=…`; the proxy calls
//!      [`resolve_from_query`], which fulfils the one-shot.
//!
//! Using the existing local proxy as both page host and result sink avoids Tauri
//! custom-scheme / remote-IPC plumbing entirely. When no AppHandle is set (unit
//! tests, headless), `mint()` returns `None` and the caller falls back to the
//! Node sidecar — so this is purely additive.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::Manager;
use tokio::sync::oneshot;
use tracing::{debug, warn};

const WINDOW_LABEL: &str = "flow-pot-minter";
// A successful in-browser mint takes ~1-2s; cap failures so a broken WebView path
// can't stall a stream resolve for long before the Node-sidecar fallback.
const MINT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct PotResult {
    pub po_token: String,
    pub integrity_token: String,
    pub ttl: u64,
}

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<PotResult>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<PotResult>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record the app handle so the minter can open a hidden WebView. Called once at
/// startup; until then `mint()` is a no-op and callers use the Node sidecar.
pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// The app handle, if the GUI is running. Shared with `webview_player`.
pub fn app_handle() -> Option<tauri::AppHandle> {
    APP_HANDLE.get().cloned()
}

/// Resolve a pending mint from the proxy's `/potresult` query parameters.
pub fn resolve_from_query(id: &str, po_token: Option<&str>, ttl: Option<u64>, error: Option<&str>) {
    let Some(sender) = pending().lock().unwrap().remove(id) else {
        return;
    };
    match po_token {
        Some(token) if !token.is_empty() => {
            let _ = sender.send(PotResult {
                po_token: token.to_string(),
                integrity_token: String::new(),
                ttl: ttl.unwrap_or(43200),
            });
        }
        _ => warn!(
            error = error.unwrap_or("unknown"),
            "WebView pot mint failed"
        ),
        // Dropping `sender` makes the awaiting `recv` resolve to `Err` → `None`.
    }
}

/// Mint a poToken bound to `content_binding` (visitor data) in a hidden WebView.
/// Returns `None` if there is no GUI app handle, the proxy isn't up, or the mint
/// times out — the caller then falls back to the headless sidecar.
pub async fn mint(content_binding: &str) -> Option<PotResult> {
    let app = APP_HANDLE.get()?.clone();

    let port = {
        let manager = app.try_state::<crate::streaming::proxy::StreamingManager>()?;
        manager.get_port()
    };

    let id = uuid::Uuid::new_v4().to_string();
    let mut url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/potmint")).ok()?;
    url.query_pairs_mut()
        .append_pair("id", &id)
        .append_pair("binding", content_binding);
    let url_str = url.to_string();

    let (sender, receiver) = oneshot::channel();
    pending().lock().unwrap().insert(id.clone(), sender);

    // Open the hidden minter window on the main thread.
    let app_for_build = app.clone();
    let build = app.run_on_main_thread(move || {
        if let Some(existing) = app_for_build.get_webview_window(WINDOW_LABEL) {
            let _ = existing.close();
        }
        if let Ok(parsed) = tauri::Url::parse(&url_str) {
            let builder = tauri::WebviewWindowBuilder::new(
                &app_for_build,
                WINDOW_LABEL,
                tauri::WebviewUrl::External(parsed),
            )
            .visible(false)
            .skip_taskbar(true)
            .focused(false);
            // WebView2 won't open a second webview on the main window's data
            // directory with different arguments (see `webview2`).
            #[cfg(windows)]
            let builder = builder.additional_browser_args(crate::webview2::BROWSER_ARGS);
            match builder.build() {
                Ok(_) => debug!("Opened hidden WebView pot minter"),
                Err(error) => warn!(%error, "Failed to open WebView pot minter"),
            }
        }
    });
    if build.is_err() {
        pending().lock().unwrap().remove(&id);
        return None;
    }

    let outcome = tokio::time::timeout(MINT_TIMEOUT, receiver).await;
    pending().lock().unwrap().remove(&id);

    // Tear the hidden window down regardless of outcome.
    let app_for_close = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_close.get_webview_window(WINDOW_LABEL) {
            let _ = window.close();
        }
    });

    match outcome {
        Ok(Ok(result)) => {
            debug!(ttl = result.ttl, "Minted PO token via WebView");
            Some(result)
        }
        _ => None,
    }
}

/// The mint page served by the proxy at `/potmint`. Runs the full bgutils flow in
/// real Chromium (real DOM/crypto — no mock needed) and reports the token back to
/// the proxy. Its `<meta>` CSP permits `eval` (BotGuard is an interpreter) and the
/// CORS-permissive WAA endpoints.
pub const MINT_PAGE_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src https://jnn-pa.googleapis.com http://127.0.0.1:* http://localhost:*;">
</head><body><script>
(function () {
  'use strict';
  var REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
  var API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
  var CREATE = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create';
  var GENERATE_IT = 'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT';
  var params = new URLSearchParams(location.search);
  var id = params.get('id');
  var visitorData = params.get('binding');

  function report(query) { try { fetch('/potresult?' + query); } catch (e) {} }
  function ok(po, ttl) { report('id=' + encodeURIComponent(id) + '&poToken=' + encodeURIComponent(po) + '&ttl=' + ttl); }
  function fail(msg) { report('id=' + encodeURIComponent(id) + '&error=' + encodeURIComponent(msg || 'error')); }

  function b64ToU8(b64) {
    var m = b64;
    if (/[-_.]/.test(b64)) { m = b64.replace(/[-_.]/g, function (c) { return { '-': '+', '_': '/', '.': '=' }[c]; }); }
    var raw = atob(m); var u = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  function u8ToB64url(u8) {
    var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
  }

  async function attempt() {
    var r = await fetch(CREATE, { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': API_KEY, 'X-User-Agent': 'sap/waa/1' }, body: JSON.stringify([REQUEST_KEY, visitorData]) });
    if (!r.ok) throw new Error('Create ' + r.status);
    var raw = await r.json();
    if (!Array.isArray(raw) || typeof raw[1] !== 'string') throw new Error('bad challenge');
    var scrambled = raw[1]; var pad = scrambled.length % 4; if (pad) scrambled += '===='.slice(pad);
    var buf = b64ToU8(scrambled); var out = new Uint8Array(buf.length);
    for (var i = 0; i < buf.length; i++) out[i] = (buf[i] + 97) & 255;
    var challenge = JSON.parse(new TextDecoder().decode(out));
    var wrapped = challenge[1], program = challenge[4], globalName = challenge[5];
    var interp = null;
    if (Array.isArray(wrapped)) {
      for (var j = 0; j < wrapped.length; j++) {
        var v = wrapped[j];
        if (typeof v === 'string' && (v.indexOf('function') >= 0 || v.indexOf('window') >= 0 || v.indexOf('eval') >= 0)) { interp = v; break; }
      }
    }
    if (!interp) throw new Error('no interpreter');
    (0, eval)(interp);
    var vm = window[globalName];
    if (!vm || typeof vm.a !== 'function') throw new Error('vm init missing');
    var fns = await new Promise(function (res) { vm.a(program, function (as) { res({ as: as }); }, true, undefined, function () {}, [[], []]); });
    if (!fns.as) throw new Error('no async snapshot');
    var webPo = [];
    var bgResp = await new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('snapshot timeout')); }, 10000);
      fns.as(function (resp) { clearTimeout(t); res(resp); }, [undefined, undefined, webPo, true]);
    });
    var it = await fetch(GENERATE_IT, { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': API_KEY, 'X-User-Agent': 'grpc-web-javascript/0.1' }, body: JSON.stringify([REQUEST_KEY, bgResp]) });
    if (!it.ok) throw new Error('GenerateIT ' + it.status);
    var itj = await it.json();
    var integrityToken = itj[0], ttl = itj[1] || 43200;
    var getMinter = webPo[0];
    if (!getMinter) throw new Error('no minter');
    var mintCb = await getMinter(b64ToU8(integrityToken));
    if (typeof mintCb !== 'function') throw new Error('mint callback');
    var rawPo = await mintCb(new TextEncoder().encode(visitorData));
    if (!rawPo || rawPo.constructor.name !== 'Uint8Array') throw new Error('raw token');
    return { po: u8ToB64url(rawPo), ttl: ttl };
  }

  (async function () {
    if (!id || !visitorData) { fail('missing params'); return; }
    for (var k = 0; k < 5; k++) {
      try { var res = await attempt(); ok(res.po, res.ttl); return; } catch (e) { /* fresh challenge next loop */ }
    }
    fail('all attempts failed');
  })();
})();
</script></body></html>"#;
