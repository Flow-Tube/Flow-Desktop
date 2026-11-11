//! Clients googlevideo has started refusing for this viewer.
//!
//! A refused media URL says which client minted it in its `c=` parameter. When
//! the URL was fresh and had not expired, the refusal is about that client: Flow
//! for Android measured these walls lasting for a while per visitor, so the
//! client is tried last for 30 minutes instead of first. Both the video and the
//! music ladders read this.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const GATE_TTL: Duration = Duration::from_mins(30);

/// googlevideo ties a link to the viewer's IP, so a VPN or network change gets
/// every older link refused, including those of the one client that lasts. Only
/// a link refused this soon after it was issued says something about its client.
const FRESH_LINK: Duration = Duration::from_mins(5);

/// Why googlevideo refused a URL.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Denial {
    /// The URL's own `expire` time had passed; a fresh lookup fixes it.
    Expired,
    /// The URL was older than a few minutes; a fresh lookup fixes it.
    Stale,
    /// The URL was fresh and still valid, so the client that minted it is walled.
    Gated,
}

fn gates() -> &'static Mutex<HashMap<String, Instant>> {
    static GATES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    GATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn query_value(url: &str, key: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()?
        .query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

/// Seconds since the epoch.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// When a googlevideo URL stops working, from its `expire` parameter.
#[must_use]
pub fn url_expiry_secs(url: &str) -> Option<u64> {
    query_value(url, "expire")?.parse().ok()
}

#[must_use]
pub fn classify_denial(url: &str, now_secs: u64, link_age: Duration) -> Denial {
    match url_expiry_secs(url) {
        Some(expire) if expire <= now_secs => Denial::Expired,
        _ if link_age > FRESH_LINK => Denial::Stale,
        _ => Denial::Gated,
    }
}

/// Remember that googlevideo refused `url`, issued `link_age` ago, gating the
/// client that minted it unless the link was expired or old.
/// The app clients googlevideo walls per visitor rather than per client: a fresh visitor is
/// served on them again, so a gate on one asks for a new identity as well (Flow for Android #921).
const VISITOR_WALLED_CLIENTS: [&str; 2] = ["VISIONOS", "ANDROID_VR"];

static IDENTITY_WALLED: AtomicBool = AtomicBool::new(false);

pub fn record_refused_url(url: &str, link_age: Duration) {
    if classify_denial(url, now_secs(), link_age) != Denial::Gated {
        return;
    }
    let Some(client) = query_value(url, "c") else {
        return;
    };
    tracing::info!(client = %client, "googlevideo refused a live URL; trying this client last for a while");
    gate(&client);
    if VISITOR_WALLED_CLIENTS.contains(&client.to_ascii_uppercase().as_str()) {
        IDENTITY_WALLED.store(true, Ordering::SeqCst);
    }
}

/// Puts `client` last in every ladder for a while.
pub fn gate(client: &str) {
    if let Ok(mut gates) = gates().lock() {
        gates.insert(client.to_ascii_uppercase(), Instant::now() + GATE_TTL);
    }
}

/// Whether googlevideo walled the visitor identity since this was last asked. The caller is
/// expected to re-roll the identity, then [`forget_gates`].
#[must_use]
pub fn take_identity_walled() -> bool {
    IDENTITY_WALLED.swap(false, Ordering::SeqCst)
}

/// Drops every demotion. A gate is googlevideo's verdict on one visitor identity, so once that
/// identity is replaced the verdict says nothing about the new one.
pub fn forget_gates() {
    if let Ok(mut gates) = gates().lock() {
        gates.clear();
    }
}

/// Whether `client_name` is currently gated.
#[must_use]
pub fn is_gated(client_name: &str) -> bool {
    let Ok(mut gates) = gates().lock() else {
        return false;
    };
    let now = Instant::now();
    gates.retain(|_, until| *until > now);
    gates.contains_key(&client_name.to_ascii_uppercase())
}

/// `ladder` with every gated client moved to the end, keeping the order of
/// each group, so a gated client is still the last resort.
#[must_use]
pub fn gated_last<T>(ladder: impl IntoIterator<Item = T>, name: impl Fn(&T) -> &str) -> Vec<T> {
    let (open, gated): (Vec<T>, Vec<T>) = ladder
        .into_iter()
        .partition(|client| !is_gated(name(client)));
    open.into_iter().chain(gated).collect()
}

#[cfg(test)]
pub(crate) fn clear() {
    forget_gates();
    IDENTITY_WALLED.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRESH: Duration = Duration::from_secs(30);

    /// The gates are process-wide, so tests that change them take turns.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[test]
    fn expired_urls_are_not_a_wall() {
        let url = "https://rr1.googlevideo.com/videoplayback?expire=1000&c=VISIONOS";
        assert_eq!(classify_denial(url, 2000, FRESH), Denial::Expired);
        assert_eq!(classify_denial(url, 500, FRESH), Denial::Gated);
        assert_eq!(url_expiry_secs(url), Some(1000));
    }

    #[test]
    fn old_links_are_not_a_wall() {
        let url = "https://rr1.googlevideo.com/videoplayback?expire=10000&c=VISIONOS";
        assert_eq!(classify_denial(url, 500, FRESH_LINK), Denial::Gated);
        assert_eq!(
            classify_denial(url, 500, FRESH_LINK + Duration::from_secs(1)),
            Denial::Stale
        );
    }

    #[test]
    fn a_refused_client_goes_last() {
        let _turn = serial();
        clear();
        let far = now_secs() + 3600;
        record_refused_url(
            &format!("https://rr1.googlevideo.com/videoplayback?expire={far}&c=TESTCLIENT"),
            FRESH,
        );
        assert!(is_gated("TestClient"));
        let ladder = ["TESTCLIENT", "OTHER", "THIRD"];
        assert_eq!(
            gated_last(ladder, |name| name),
            ["OTHER", "THIRD", "TESTCLIENT"]
        );
        clear();
        assert!(!is_gated("TESTCLIENT"));
    }

    #[test]
    fn a_walled_visionos_asks_for_a_new_identity_once() {
        let _turn = serial();
        let far = now_secs() + 3600;
        record_refused_url(
            &format!("https://rr1.googlevideo.com/videoplayback?expire={far}&c=VISIONOS"),
            FRESH,
        );
        assert!(is_gated("VISIONOS"));
        assert!(take_identity_walled());
        assert!(!take_identity_walled());
    }

    #[test]
    fn a_new_identity_lifts_every_demotion() {
        let _turn = serial();
        gate("LIFTEDCLIENT");
        assert!(is_gated("LIFTEDCLIENT"));
        forget_gates();
        assert!(!is_gated("LIFTEDCLIENT"));
    }

    #[test]
    fn a_refused_old_link_benches_nobody() {
        let _turn = serial();
        let far = now_secs() + 3600;
        record_refused_url(
            &format!("https://rr1.googlevideo.com/videoplayback?expire={far}&c=STALECLIENT"),
            Duration::from_mins(40),
        );
        assert!(!is_gated("STALECLIENT"));
    }
}
