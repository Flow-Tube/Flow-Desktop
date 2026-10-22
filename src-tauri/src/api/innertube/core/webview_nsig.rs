//! The `n` solver run in a hidden web view ([`super::hidden_webview`]), so
//! packaged builds need no Node: the page loads the cached player script from the
//! proxy, evaluates it, and asks the player's own URL class for the solved `n`,
//! as `sidecar/nsig.cjs` does under Node.

use std::collections::HashMap;
use std::time::Duration;

// Evaluating a 3 MB player takes well under a second; a WebView that has not
// answered by then is broken, and Node is tried next.
const SOLVE_TIMEOUT: Duration = Duration::from_secs(8);

/// `n` solved by player `player_id`, or None without a GUI or a result in time.
pub async fn solve(player_id: &str, n: &str) -> Option<String> {
    let result = super::hidden_webview::run(
        "flow-n-solver",
        "/nsolve",
        &[("player", player_id), ("n", n)],
        SOLVE_TIMEOUT,
    )
    .await?;
    let solved: HashMap<String, String> = serde_json::from_str(result.get("results")?).ok()?;
    solved
        .get(n)
        .filter(|solved| !solved.is_empty() && *solved != n)
        .cloned()
}

/// The solver page the proxy serves at `/nsolve`. Its CSP lets the player run
/// (`eval`) but reach nothing except the local proxy.
pub const SOLVE_PAGE_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src http://127.0.0.1:*;">
</head><body><script>
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = params.get('id');
  var player = params.get('player');
  var challenge = params.get('n');
  // `jox=function(u){try{var y=(new g.CJ(u,!0)).get("n")…`: the URL class
  // whose constructor solves `n` when its second argument is true.
  var URL_CLASS_PATTERNS = [
    /[A-Za-z0-9_$]+\s*=\s*function\(([A-Za-z0-9_$]+)\)\s*\{\s*try\s*\{\s*var\s+[A-Za-z0-9_$]+\s*=\s*\(new\s+g\.([A-Za-z0-9_$]+)\(\1\s*,\s*!0\)\)\.get\("n"\)/,
    /\(new\s+g\.([A-Za-z0-9_$]+)\([A-Za-z0-9_$]+\s*,\s*!0\)\)\.get\("n"\)/
  ];

  function report(query) { try { fetch('/webviewresult?id=' + encodeURIComponent(id) + '&' + query); } catch (e) {} }
  function fail(message) { report('error=' + encodeURIComponent(message)); }

  function urlClass(source) {
    for (var i = 0; i < URL_CLASS_PATTERNS.length; i++) {
      var match = source.match(URL_CLASS_PATTERNS[i]);
      if (match) return match[match.length - 1];
    }
    return null;
  }

  (async function () {
    if (!id || !player || !challenge) { fail('missing params'); return; }
    var source;
    try {
      var response = await fetch('/nsolve/player.js?player=' + encodeURIComponent(player));
      if (!response.ok) { fail('player script ' + response.status); return; }
      source = await response.text();
    } catch (e) { fail('player script unavailable'); return; }
    var name = urlClass(source);
    if (!name) { fail('n-solving URL class not found'); return; }
    try {
      (0, eval)(source + '\n;window.__flowPlayer = _yt_player;');
    } catch (e) {
      // A late initializer can throw after every class is defined; only a
      // missing class below is fatal.
    }
    var UrlClass = window.__flowPlayer && window.__flowPlayer[name];
    if (typeof UrlClass !== 'function') { fail('player class unavailable'); return; }
    var results = {};
    try {
      var url = 'https://rr1---sn-flow.googlevideo.com/videoplayback?expire=0&n=' + encodeURIComponent(challenge);
      var solved = new UrlClass(url, true).get('n');
      if (typeof solved === 'string' && solved.length > 0 && solved !== challenge) results[challenge] = solved;
    } catch (e) {}
    if (!results[challenge]) { fail('n not solved'); return; }
    report('results=' + encodeURIComponent(JSON.stringify(results)));
  })();
})();
</script></body></html>"#;
