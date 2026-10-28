//! Loopback bridge for the Flow browser extension.
//!
//! A tiny fixed-port HTTP server on `127.0.0.1` that lets the extension hand a
//! video off to a *running* Flow instance silently (no OS "Open Flow?" prompt)
//! and detect whether Flow is installed at all (`/flow/ping`). It is the
//! sibling of the `flow://` deep link: the deep link *launches* Flow when it is
//! closed; this server serves it while it is already open.
//!
//! Both transports converge on the same frontend handler — this server just
//! translates a validated request into the equivalent `flow://…` URL and emits
//! it on the `handoff://url` event, exactly as the deep-link plugin would.
//!
//! Security model (browser threat only — a native process can already do
//! anything): loopback bind, `Host` header must be loopback (anti DNS-rebind),
//! `Origin` (when present) must be an allow-listed YouTube origin, GET/OPTIONS
//! only, and every field is validated before it reaches any command.

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, info, warn};

use crate::security::validation::{validate_playlist_id, validate_video_id};

/// Ports probed in order — must match `BRIDGE_PORTS` in the extension.
const BRIDGE_PORTS: [u16; 3] = [47893, 47894, 47895];
const MAX_HEADER_BYTES: usize = 8 * 1024;

const ALLOWED_ORIGINS: [&str; 3] = [
    "https://www.youtube.com",
    "https://m.youtube.com",
    "https://music.youtube.com",
];

/// Bind the first free bridge port and serve until the process exits.
pub async fn start(app: AppHandle) {
    let listener = match bind_first_available().await {
        Some(listener) => listener,
        None => {
            warn!(
                "Flow extension bridge: no free port in {BRIDGE_PORTS:?}; extension silent mode disabled"
            );
            return;
        }
    };

    if let Ok(addr) = listener.local_addr() {
        info!("Flow extension bridge listening on {addr}");
    }

    loop {
        match listener.accept().await {
            Ok((socket, _)) => {
                let app = app.clone();
                tokio::spawn(async move {
                    if let Err(err) = handle_connection(socket, &app).await {
                        debug!("bridge connection error: {err}");
                    }
                });
            }
            Err(err) => {
                warn!("bridge accept failed: {err}");
                break;
            }
        }
    }
}

async fn bind_first_available() -> Option<TcpListener> {
    for port in BRIDGE_PORTS {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            return Some(listener);
        }
    }
    None
}

struct Request {
    method: String,
    path: String,
    query: String,
    origin: Option<String>,
    host: Option<String>,
}

async fn handle_connection(mut socket: TcpStream, app: &AppHandle) -> std::io::Result<()> {
    let Some(req) = read_request(&mut socket).await? else {
        return write_response(&mut socket, 400, "Bad Request", None, "{}").await;
    };

    // Anti DNS-rebinding: a browser page pointing `evil.com` at 127.0.0.1 would
    // still send `Host: evil.com`. Only loopback hosts are accepted.
    if !host_is_loopback(req.host.as_deref()) {
        return write_response(&mut socket, 403, "Forbidden", None, "{}").await;
    }

    // Reject cross-site browser callers; native callers (no Origin) pass through.
    let allowed_origin = match req.origin.as_deref() {
        Some(origin) if ALLOWED_ORIGINS.contains(&origin) => Some(origin.to_string()),
        Some(_) => return write_response(&mut socket, 403, "Forbidden", None, "{}").await,
        None => None,
    };
    let cors = allowed_origin.as_deref();

    if req.method == "OPTIONS" {
        return write_preflight(&mut socket, cors).await;
    }
    if req.method != "GET" {
        return write_response(&mut socket, 405, "Method Not Allowed", cors, "{}").await;
    }

    match req.path.as_str() {
        "/flow/ping" => {
            let body = format!(
                r#"{{"app":"flow","version":"{}"}}"#,
                env!("CARGO_PKG_VERSION")
            );
            write_response(&mut socket, 200, "OK", cors, &body).await
        }
        "/flow/watch" | "/flow/download" | "/flow/music" | "/flow/music-download" => {
            let action = &req.path["/flow/".len()..];
            match build_handoff_url(action, &req.query) {
                Some(url) => {
                    dispatch(app, url);
                    write_response(&mut socket, 200, "OK", cors, r#"{"ok":true}"#).await
                }
                None => {
                    write_response(&mut socket, 400, "Bad Request", cors, r#"{"ok":false}"#).await
                }
            }
        }
        _ => write_response(&mut socket, 404, "Not Found", cors, "{}").await,
    }
}

/// Focus the window and emit the equivalent `flow://` URL so the frontend's
/// single deep-link handler routes it (play or open the download dialog).
fn dispatch(app: &AppHandle, url: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // Only the main window routes handoffs; a broadcast would play it in every window.
    if let Err(err) = app.emit_to("main", "handoff://url", url) {
        warn!("failed to emit handoff event: {err}");
    }
}

/// Rebuild a validated `flow://action?…` URL from the request query. Every field
/// is validated; `v` is required, `t`/`list` optional. All accepted values are
/// `[A-Za-z0-9_-]`/digits, so no percent-encoding is needed.
fn build_handoff_url(action: &str, query: &str) -> Option<String> {
    let mut v = None;
    let mut t = None;
    let mut list = None;
    for (key, value) in query_pairs(query) {
        match key {
            "v" => v = Some(value),
            "t" => t = Some(value),
            "list" => list = Some(value),
            _ => {}
        }
    }

    let v = v?;
    validate_video_id(&v).ok()?;
    let mut url = format!("flow://{action}?v={v}");

    if let Some(t) = t {
        if !t.is_empty() {
            if !t.chars().all(|c| c.is_ascii_digit()) || t.len() > 9 {
                return None;
            }
            url.push_str(&format!("&t={t}"));
        }
    }
    if let Some(list) = list {
        if !list.is_empty() {
            validate_playlist_id(&list).ok()?;
            url.push_str(&format!("&list={list}"));
        }
    }
    Some(url)
}

fn query_pairs(query: &str) -> impl Iterator<Item = (&str, String)> {
    query.split('&').filter_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        Some((key, percent_decode(value)))
    })
}

/// Minimal percent-decoder — enough for `%20`-style query values. Values that
/// survive validation are ASCII-only anyway; this just keeps decoding honest.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn host_is_loopback(host: Option<&str>) -> bool {
    let Some(host) = host else { return false };
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    name == "127.0.0.1" || name == "localhost" || name == "[::1]"
}

async fn read_request(socket: &mut TcpStream) -> std::io::Result<Option<Request>> {
    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 2048];
    loop {
        if let Some(end) = find_header_end(&buf) {
            return Ok(parse_request(&buf[..end]));
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Ok(None);
        }
        let n = socket.read(&mut tmp).await?;
        if n == 0 {
            return Ok(parse_request(&buf));
        }
        buf.extend_from_slice(&tmp[..n]);
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_request(bytes: &[u8]) -> Option<Request> {
    let text = String::from_utf8_lossy(bytes);
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let target = request_line.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    let mut origin = None;
    let mut host = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            if name.eq_ignore_ascii_case("origin") {
                origin = Some(value.trim().to_string());
            } else if name.eq_ignore_ascii_case("host") {
                host = Some(value.trim().to_string());
            }
        }
    }

    Some(Request {
        method,
        path: path.to_string(),
        query: query.to_string(),
        origin,
        host,
    })
}

fn cors_header(origin: Option<&str>) -> String {
    match origin {
        Some(origin) => format!(
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\n"
        ),
        None => String::new(),
    }
}

async fn write_response(
    socket: &mut TcpStream,
    status: u16,
    reason: &str,
    origin: Option<&str>,
    body: &str,
) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
        body.len(),
        cors_header(origin),
    );
    socket.write_all(headers.as_bytes()).await?;
    socket.write_all(body.as_bytes()).await?;
    Ok(())
}

async fn write_preflight(socket: &mut TcpStream, origin: Option<&str>) -> std::io::Result<()> {
    let headers = format!(
        "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n{}Connection: close\r\n\r\n",
        cors_header(origin),
    );
    socket.write_all(headers.as_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_watch_url_with_optional_params() {
        let url = build_handoff_url("watch", "v=dQw4w9WgXcQ&t=42&list=PLabcdefghij").unwrap();
        assert_eq!(url, "flow://watch?v=dQw4w9WgXcQ&t=42&list=PLabcdefghij");
    }

    #[test]
    fn rejects_bad_video_id() {
        assert!(build_handoff_url("watch", "v=notavalidid!!").is_none());
        assert!(build_handoff_url("download", "v=short").is_none());
        assert!(build_handoff_url("watch", "t=42").is_none());
    }

    #[test]
    fn rejects_non_numeric_timestamp_and_bad_playlist() {
        assert!(build_handoff_url("watch", "v=dQw4w9WgXcQ&t=12x").is_none());
        assert!(build_handoff_url("watch", "v=dQw4w9WgXcQ&list=../etc").is_none());
    }

    #[test]
    fn download_url_ignores_watch_only_params() {
        let url = build_handoff_url("download", "v=dQw4w9WgXcQ&t=42").unwrap();
        assert_eq!(url, "flow://download?v=dQw4w9WgXcQ&t=42");
    }

    #[test]
    fn builds_music_and_music_download_urls() {
        assert_eq!(
            build_handoff_url("music", "v=dQw4w9WgXcQ").unwrap(),
            "flow://music?v=dQw4w9WgXcQ"
        );
        assert_eq!(
            build_handoff_url("music-download", "v=dQw4w9WgXcQ").unwrap(),
            "flow://music-download?v=dQw4w9WgXcQ"
        );
    }

    #[test]
    fn loopback_host_check() {
        assert!(host_is_loopback(Some("127.0.0.1:47893")));
        assert!(host_is_loopback(Some("localhost")));
        assert!(!host_is_loopback(Some("evil.com")));
        assert!(!host_is_loopback(None));
    }
}
