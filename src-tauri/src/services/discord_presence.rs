//! Discord Rich Presence over the local Discord IPC socket. The frontend pushes
//! now-playing snapshots; a dedicated worker thread owns the socket, reconnecting
//! with backoff and clearing a stale paused presence.

use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{
    Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

/// Flow's public Discord application id (`SET_ACTIVITY` needs no token).
const CLIENT_ID: &str = "1526515771021328514";

const APP_NAME: &str = "Flow";
const PAUSED_TEXT: &str = "⏸\u{fe0e} Paused";
const LIVE_TEXT: &str = "🔴 LIVE";

const MAX_FIELD_LEN: usize = 128;
/// Pads text to Discord's two-character field minimum.
const MIN_FIELD_FILLER: char = '\u{2800}'; // braille blank
const RECONNECT_BACKOFF: Duration = Duration::from_secs(5);
/// Clear a paused presence after this long idle.
const IDLE_CLEAR: Duration = Duration::from_secs(10 * 60);
/// Worker wake cadence while active; it blocks instead of spinning when idle.
const TICK: Duration = Duration::from_secs(5);
/// Re-send an unchanged presence this often. The crate can't tell when Discord
/// drops the socket silently, so a static presence would otherwise stay gone after
/// a Discord restart until the next change; the periodic write surfaces the drop.
const HEARTBEAT: Duration = Duration::from_secs(15);

/// Now-playing snapshot from the frontend (`kind` is `video | music | live`).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub kind: String,
    #[serde(default)]
    pub title: Option<String>,
    /// Channel (video/live) or artist(s) (music).
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub elapsed_seconds: Option<f64>,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
    #[serde(default)]
    pub is_paused: bool,
    #[serde(default)]
    pub url: Option<String>,
    /// Localized on the frontend; a button needs both a label and a url.
    #[serde(default)]
    pub button_label: Option<String>,
}

enum Msg {
    Set(PresencePayload),
    Clear,
}

/// Handle to the presence worker thread, held as Tauri managed state.
pub struct DiscordPresence {
    tx: Mutex<Sender<Msg>>,
}

impl DiscordPresence {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        if let Err(error) = thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || worker(rx))
        {
            // A failed spawn leaves sends as no-ops — the feature is inert, not fatal.
            tracing::warn!(%error, "failed to spawn discord presence worker");
        }
        Self { tx: Mutex::new(tx) }
    }

    pub fn set(&self, payload: PresencePayload) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(Msg::Set(payload));
        }
    }

    pub fn clear(&self) {
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(Msg::Clear);
        }
    }
}

impl Default for DiscordPresence {
    fn default() -> Self {
        Self::new()
    }
}

/// Desired presence with timestamps anchored at receive time, so a passive tick
/// never re-sends a drifting progress bar.
struct Desired {
    payload: PresencePayload,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    /// When this changes, the paused idle-clear countdown restarts.
    ident: String,
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Trim, cap length, and pad to Discord's two-character minimum. `None` when empty.
fn sanitize(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out: String = trimmed.chars().take(MAX_FIELD_LEN).collect();
    if out.chars().count() < 2 {
        out.push(MIN_FIELD_FILLER);
    }
    Some(out)
}

fn is_https(url: &str) -> bool {
    url.starts_with("https://")
}

/// Anchor progress-bar timestamps at arrival; live counts up, paused has none.
fn compute_timestamps(p: &PresencePayload) -> (Option<i64>, Option<i64>) {
    if p.is_paused {
        return (None, None);
    }
    let elapsed = p.elapsed_seconds.unwrap_or(0.0).max(0.0) as i64;
    let start = unix_now() - elapsed;
    if p.kind == "live" {
        return (Some(start), None);
    }
    match p.duration_seconds {
        Some(duration) if duration > 0.0 => (Some(start), Some(start + duration as i64)),
        _ => (Some(start), None),
    }
}

fn make_desired(payload: PresencePayload) -> Desired {
    let (start_ts, end_ts) = compute_timestamps(&payload);
    let ident = format!(
        "{}|{}|{}|{}",
        payload.kind,
        payload.title.as_deref().unwrap_or(""),
        payload.subtitle.as_deref().unwrap_or(""),
        payload.is_paused,
    );
    Desired {
        payload,
        start_ts,
        end_ts,
        ident,
    }
}

/// Identity of the applied activity, to skip redundant updates (Discord rate limit).
fn signature(d: &Desired) -> String {
    let p = &d.payload;
    format!(
        "{}|{}|{}|{}|{}|{}|{:?}|{:?}|{}",
        p.kind,
        p.title.as_deref().unwrap_or(""),
        p.subtitle.as_deref().unwrap_or(""),
        p.album.as_deref().unwrap_or(""),
        p.artwork_url.as_deref().unwrap_or(""),
        p.is_paused,
        d.start_ts,
        d.end_ts,
        p.button_label.as_deref().unwrap_or(""),
    )
}

/// Music is a Listening activity with the song as the headline (Details); video and
/// live Watch with the app name.
fn activity_kind(kind: &str) -> (ActivityType, StatusDisplayType) {
    if kind == "music" {
        (ActivityType::Listening, StatusDisplayType::Details)
    } else {
        (ActivityType::Watching, StatusDisplayType::Name)
    }
}

/// Artwork hover text: pause indicator, then live badge, then album (music) or
/// channel (video).
fn large_text_for(p: &PresencePayload) -> Option<String> {
    if p.is_paused {
        Some(PAUSED_TEXT.to_string())
    } else if p.kind == "live" {
        Some(LIVE_TEXT.to_string())
    } else if p.kind == "music" {
        sanitize(p.album.as_deref())
    } else {
        sanitize(p.subtitle.as_deref())
    }
}

/// The large image is the raw artwork URL, only when https (Discord rejects others).
fn large_image_for(p: &PresencePayload) -> Option<String> {
    p.artwork_url
        .as_deref()
        .filter(|url| is_https(url))
        .map(str::to_string)
}

/// The single presence button needs both a label and an https deep link.
fn button_for(p: &PresencePayload) -> Option<(String, String)> {
    match (sanitize(p.button_label.as_deref()), p.url.as_deref()) {
        (Some(label), Some(url)) if is_https(url) => Some((label, url.to_string())),
        _ => None,
    }
}

/// Map a snapshot to a Discord activity; owned strings avoid the builder's `Cow` lifetimes.
fn build_activity(d: &Desired) -> Activity<'static> {
    let p = &d.payload;
    let (activity_type, status) = activity_kind(&p.kind);

    let mut activity = Activity::new()
        .name(APP_NAME)
        .activity_type(activity_type)
        .status_display_type(status);

    if let Some(title) = sanitize(p.title.as_deref()) {
        activity = activity.details(title);
    }
    if let Some(subtitle) = sanitize(p.subtitle.as_deref()) {
        activity = activity.state(subtitle);
    }

    let large_text = large_text_for(p);
    let large_image = large_image_for(p);
    if large_image.is_some() || large_text.is_some() {
        let mut assets = Assets::new();
        if let Some(image) = large_image {
            assets = assets.large_image(image);
        }
        if let Some(text) = large_text {
            assets = assets.large_text(text);
        }
        activity = activity.assets(assets);
    }

    if d.start_ts.is_some() || d.end_ts.is_some() {
        let mut timestamps = Timestamps::new();
        if let Some(start) = d.start_ts {
            timestamps = timestamps.start(start);
        }
        if let Some(end) = d.end_ts {
            timestamps = timestamps.end(end);
        }
        activity = activity.timestamps(timestamps);
    }

    if let Some((label, url)) = button_for(p) {
        activity = activity.buttons(vec![Button::new(label, url)]);
    }

    activity
}

/// Whether to (re)send the activity this pass: on a real change, or as a periodic
/// heartbeat once an unchanged presence has gone `HEARTBEAT` without a write.
fn should_send(sig_changed: bool, has_target: bool, since_last: Option<Duration>) -> bool {
    sig_changed || (has_target && since_last.map_or(true, |d| d >= HEARTBEAT))
}

fn worker(rx: Receiver<Msg>) {
    let mut client = DiscordIpcClient::new(CLIENT_ID);
    let mut connected = false;
    let mut next_connect_attempt = Instant::now();

    let mut desired: Option<Desired> = None;
    let mut applied_sig: Option<String> = None;
    let mut last_apply: Option<Instant> = None;
    let mut paused_since: Option<Instant> = None;
    let mut idle_cleared = false;

    loop {
        // Tick (for reconnect/idle-clear) only while there is state; else block idle.
        let active = connected || desired.is_some();
        let received = if active {
            match rx.recv_timeout(TICK) {
                Ok(msg) => Some(msg),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(msg) => Some(msg),
                Err(_) => break,
            }
        };

        match received {
            Some(Msg::Set(payload)) => {
                let next = make_desired(payload);
                let changed =
                    desired.as_ref().map(|d| d.ident.as_str()) != Some(next.ident.as_str());
                if changed {
                    // A real item/pause change restarts the idle-clear countdown.
                    paused_since = if next.payload.is_paused {
                        Some(Instant::now())
                    } else {
                        None
                    };
                    idle_cleared = false;
                }
                desired = Some(next);
            }
            Some(Msg::Clear) => {
                desired = None;
                paused_since = None;
                idle_cleared = false;
            }
            None => {}
        }

        // Promote a long-paused presence to cleared.
        if !idle_cleared {
            if let (Some(d), Some(since)) = (desired.as_ref(), paused_since) {
                if d.payload.is_paused && since.elapsed() >= IDLE_CLEAR {
                    idle_cleared = true;
                }
            }
        }

        // What we want Discord to show right now (None = clear the activity).
        let target: Option<&Desired> = match desired.as_ref() {
            Some(d) if !(d.payload.is_paused && idle_cleared) => Some(d),
            _ => None,
        };
        let want_sig = target.map(signature);

        if !connected {
            // Connect lazily — only once there is something to show.
            if want_sig.is_some() && Instant::now() >= next_connect_attempt {
                match client.connect() {
                    Ok(()) => {
                        connected = true;
                        applied_sig = None; // force a fresh apply after (re)connect
                    }
                    Err(error) => {
                        next_connect_attempt = Instant::now() + RECONNECT_BACKOFF;
                        tracing::debug!(%error, "discord presence connect failed; will retry");
                    }
                }
            }
        }

        let sig_changed = applied_sig != want_sig;
        if connected
            && should_send(
                sig_changed,
                target.is_some(),
                last_apply.map(|t| t.elapsed()),
            )
        {
            let result = match target {
                Some(d) => client.set_activity(build_activity(d)),
                None => client.clear_activity(),
            };
            match result {
                Ok(()) => {
                    applied_sig = want_sig;
                    last_apply = Some(Instant::now());
                }
                Err(error) => {
                    // A failed write means Discord dropped the socket; reconnect next pass.
                    connected = false;
                    applied_sig = None;
                    next_connect_attempt = Instant::now() + RECONNECT_BACKOFF;
                    tracing::debug!(%error, "discord presence update failed; will reconnect");
                }
            }
        }
    }

    if connected {
        let _ = client.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(kind: &str) -> PresencePayload {
        PresencePayload {
            kind: kind.to_string(),
            title: Some("Some Title".to_string()),
            subtitle: Some("Some Creator".to_string()),
            album: Some("Some Album".to_string()),
            artwork_url: Some("https://example.com/a.jpg".to_string()),
            elapsed_seconds: Some(30.0),
            duration_seconds: Some(200.0),
            is_paused: false,
            url: Some("https://youtube.com/watch?v=abc".to_string()),
            button_label: Some("Watch on YouTube".to_string()),
        }
    }

    #[test]
    fn music_gets_a_countdown() {
        let d = make_desired(payload("music"));
        assert!(
            d.start_ts.is_some() && d.end_ts.is_some(),
            "a finite music track has a start and an end"
        );
    }

    #[test]
    fn activity_kind_maps_by_kind() {
        assert!(matches!(
            activity_kind("music"),
            (ActivityType::Listening, StatusDisplayType::Details)
        ));
        assert!(matches!(
            activity_kind("video"),
            (ActivityType::Watching, StatusDisplayType::Name)
        ));
        assert!(matches!(
            activity_kind("live"),
            (ActivityType::Watching, StatusDisplayType::Name)
        ));
    }

    #[test]
    fn large_text_precedence() {
        let mut paused = payload("music");
        paused.is_paused = true;
        assert_eq!(large_text_for(&paused).as_deref(), Some(PAUSED_TEXT));

        assert_eq!(large_text_for(&payload("live")).as_deref(), Some(LIVE_TEXT));
        assert_eq!(
            large_text_for(&payload("music")).as_deref(),
            Some("Some Album")
        );
        assert_eq!(
            large_text_for(&payload("video")).as_deref(),
            Some("Some Creator")
        );
    }

    #[test]
    fn large_image_requires_https() {
        assert!(large_image_for(&payload("music")).is_some());
        let mut insecure = payload("music");
        insecure.artwork_url = Some("http://example.com/a.jpg".to_string());
        assert!(large_image_for(&insecure).is_none());
    }

    #[test]
    fn button_requires_label_and_https() {
        let (label, url) = button_for(&payload("video")).expect("button");
        assert_eq!(label, "Watch on YouTube");
        assert!(url.starts_with("https://"));

        let mut insecure = payload("video");
        insecure.url = Some("http://youtube.com/watch?v=abc".to_string());
        assert!(button_for(&insecure).is_none());

        let mut no_label = payload("video");
        no_label.button_label = None;
        assert!(button_for(&no_label).is_none());
    }

    #[test]
    fn live_counts_up_without_end() {
        let mut p = payload("live");
        p.duration_seconds = None;
        let d = make_desired(p);
        assert!(d.start_ts.is_some(), "live has a start");
        assert!(d.end_ts.is_none(), "live has no end (count-up)");
    }

    #[test]
    fn paused_drops_timestamps() {
        let mut p = payload("video");
        p.is_paused = true;
        let d = make_desired(p);
        assert!(d.start_ts.is_none() && d.end_ts.is_none());
    }

    #[test]
    fn sanitize_pads_and_caps() {
        assert_eq!(sanitize(Some("  ")), None);
        assert_eq!(sanitize(Some("a")).unwrap().chars().count(), 2);
        assert_eq!(
            sanitize(Some(&"x".repeat(500))).unwrap().chars().count(),
            MAX_FIELD_LEN
        );
    }

    #[test]
    fn heartbeat_resends_a_static_presence() {
        // A real change always sends.
        assert!(should_send(true, true, Some(Duration::from_secs(0))));
        // Unchanged but a heartbeat has elapsed → resend (surfaces a dropped socket).
        assert!(should_send(false, true, Some(HEARTBEAT)));
        // Unchanged and still within the heartbeat window → stay quiet.
        assert!(!should_send(false, true, Some(Duration::from_secs(1))));
        // Nothing to show → never heartbeat.
        assert!(!should_send(false, false, Some(HEARTBEAT * 2)));
    }
}
