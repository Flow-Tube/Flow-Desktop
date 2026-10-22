//! Real-browser poToken minter via a hidden Tauri web view.
//!
//! The headless Node sidecar ([`super::botguard`]) mints a valid token, but its
//! attestation is synthetic (a `vm` sandbox + DOM mock). The mobile app mints in
//! a real web view, so this runs the *same* bgutils flow inside a hidden web view
//! ([`super::hidden_webview`]): the proxy serves [`MINT_PAGE_HTML`] at `/potmint`,
//! and the page runs `Waa/Create` + descramble + VM snapshot + `GenerateIT` + mint
//! in the real engine (the WAA endpoints are CORS-permissive, so no Rust round
//! trip) and reports the token back. Without a GUI `mint()` returns `None` and
//! the caller falls back to the Node sidecar.

use std::time::Duration;

use tracing::debug;

// A successful in-browser mint takes ~1-2s; cap failures so a broken WebView path
// can't stall a stream resolve for long before the Node-sidecar fallback.
const MINT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct PotResult {
    pub po_token: String,
    pub integrity_token: String,
    pub ttl: u64,
}

/// Mint a poToken bound to `content_binding` (visitor data) in a hidden WebView.
/// Returns `None` if there is no GUI app handle, the proxy isn't up, or the mint
/// times out — the caller then falls back to the headless sidecar.
pub async fn mint(content_binding: &str) -> Option<PotResult> {
    let result = super::hidden_webview::run(
        "flow-pot-minter",
        "/potmint",
        &[("binding", content_binding)],
        MINT_TIMEOUT,
    )
    .await?;
    let po_token = result
        .get("poToken")
        .filter(|token| !token.is_empty())?
        .clone();
    let ttl = result
        .get("ttl")
        .and_then(|ttl| ttl.parse().ok())
        .unwrap_or(43200);
    debug!(ttl, "Minted PO token via WebView");
    Some(PotResult {
        po_token,
        integrity_token: String::new(),
        ttl,
    })
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

  function report(query) { try { fetch('/webviewresult?' + query); } catch (e) {} }
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
