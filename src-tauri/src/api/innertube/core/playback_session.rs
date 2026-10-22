//! What ties a web `player` request to the SABR session that follows it: one
//! client playback nonce (`cpn`) on both, and the reload token the session hands
//! back when it wants a fresh player response.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use rand::TryRng;
use rand::rngs::SysRng;

const CPN_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// A 16-character client playback nonce, as the web player makes one.
#[must_use]
pub fn new_cpn() -> String {
    let mut bytes = [0u8; 16];
    if SysRng.try_fill_bytes(&mut bytes).is_err() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        bytes = nanos.to_le_bytes();
    }
    bytes
        .iter()
        .map(|byte| char::from(CPN_ALPHABET[usize::from(byte & 63)]))
        .collect()
}

/// `url` with the session's `cpn` and `alr=yes`, as the web player sends them.
#[must_use]
pub fn with_session_params(url: &str, cpn: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}alr=yes&cpn={cpn}")
}

fn reload_tokens() -> &'static Mutex<HashMap<String, String>> {
    static TOKENS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Keep the token a SABR session sent with its reload request, for the next
/// `player` request of that video.
pub fn store_reload_token(video_id: &str, token: String) {
    if let Ok(mut tokens) = reload_tokens().lock() {
        tokens.insert(video_id.to_string(), token);
    }
}

/// The reload token waiting for `video_id`, taken so it is sent once.
#[must_use]
pub fn take_reload_token(video_id: &str) -> Option<String> {
    reload_tokens().lock().ok()?.remove(video_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpn_is_sixteen_url_safe_characters() {
        let cpn = new_cpn();
        assert_eq!(cpn.len(), 16);
        assert!(cpn.bytes().all(|byte| CPN_ALPHABET.contains(&byte)));
    }

    #[test]
    fn session_params_join_the_url() {
        assert_eq!(
            with_session_params("https://x/y?a=1", "C"),
            "https://x/y?a=1&alr=yes&cpn=C"
        );
        assert_eq!(
            with_session_params("https://x/y", "C"),
            "https://x/y?alr=yes&cpn=C"
        );
    }

    #[test]
    fn a_reload_token_is_handed_out_once() {
        store_reload_token("vid-reload-test", "T".into());
        assert_eq!(take_reload_token("vid-reload-test").as_deref(), Some("T"));
        assert_eq!(take_reload_token("vid-reload-test"), None);
    }
}
