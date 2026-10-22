//! The optional remote signature and `n` decoder: the public decoder of the
//! `PipePipe` app, as Flow for Android uses it.
//!
//! A signed stream URL needs the player's signature transform, which current
//! players inline behind runtime-indexed string arrays, so no local extractor can
//! find it. The decoder runs it server side. It is off unless the user turns on
//! "Remote signature fallback": it is a third-party round trip that receives the
//! signature and `n` strings and a player id, never a video id.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

/// The setting that turns the decoder on.
pub const SETTING_KEY: &str = "remote_signature_fallback";

const LATEST_PLAYER_URL: &str = "https://api.pipepipe.dev/decoder/latest-player";
const DECODE_URL: &str = "https://api.pipepipe.dev/decoder/decode";
// The decoder answers only its own client's User-Agent.
const USER_AGENT: &str = "PipePipe/4.9.0";
const PLAYER_TTL: Duration = Duration::from_hours(24);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const CACHE_CAPACITY: usize = 512;

static ENABLED: AtomicBool = AtomicBool::new(false);

/// Turn the decoder on or off, from the saved setting.
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

#[must_use]
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Whether a saved setting value turns the decoder on.
#[must_use]
pub fn enabled_from_setting(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.eq_ignore_ascii_case("true"))
}

/// The decoder's current player, whose signature timestamp a request must carry
/// for its signatures to be solvable.
#[derive(Clone, Debug)]
pub struct DecoderPlayer {
    pub id: String,
    pub signature_timestamp: Option<i64>,
}

fn player_slot() -> &'static Mutex<Option<(DecoderPlayer, Instant)>> {
    static SLOT: OnceLock<Mutex<Option<(DecoderPlayer, Instant)>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn get_json(url: &str) -> Option<Value> {
    let response = crate::api::http::shared_client()
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

/// The decoder's current player, cached for a day. None while the decoder is off.
pub async fn latest_player() -> Option<DecoderPlayer> {
    if !is_enabled() {
        return None;
    }
    if let Some((player, at)) = player_slot().lock().ok()?.clone()
        && at.elapsed() < PLAYER_TTL
    {
        return Some(player);
    }
    let body = get_json(LATEST_PLAYER_URL).await?;
    let player = DecoderPlayer {
        id: body["player"]
            .as_str()
            .filter(|id| !id.is_empty())?
            .to_string(),
        signature_timestamp: body["signatureTimestamp"].as_i64().filter(|sts| *sts != 0),
    };
    if let Ok(mut slot) = player_slot().lock() {
        *slot = Some((player.clone(), Instant::now()));
    }
    Some(player)
}

/// What a decode request asks to solve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Challenge {
    Signature,
    N,
}

impl Challenge {
    const fn param(self) -> &'static str {
        match self {
            Self::Signature => "sig",
            Self::N => "n",
        }
    }
}

/// The decoder's `{ "responses": [ { "data": { "<challenge>": "<solved>" } } ] }`.
fn parse_decoded(body: &Value) -> HashMap<String, String> {
    body["responses"][0]["data"]
        .as_object()
        .map(|data| {
            data.iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .filter(|(_, value)| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Solve `values` against `player`. Signatures and `n` go in separate requests:
/// a combined request came back with only the `n` solved.
pub async fn decode(
    player: &DecoderPlayer,
    kind: Challenge,
    values: &[String],
) -> HashMap<String, String> {
    if !is_enabled() || values.is_empty() {
        return HashMap::new();
    }
    let key = |value: &str| format!("{}:{}:{value}", player.id, kind.param());
    let missing: Vec<&String> = {
        let Ok(cache) = cache().lock() else {
            return HashMap::new();
        };
        values
            .iter()
            .filter(|value| !cache.contains_key(&key(value)))
            .collect()
    };
    if !missing.is_empty() {
        let joined = missing
            .iter()
            .map(|value| url_encode(value))
            .collect::<Vec<_>>()
            .join(",");
        let url = format!(
            "{DECODE_URL}?player={}&{}={joined}",
            player.id,
            kind.param()
        );
        if let Some(body) = get_json(&url).await
            && let Ok(mut cache) = cache().lock()
        {
            if cache.len() >= CACHE_CAPACITY {
                cache.clear();
            }
            for (challenge, solved) in parse_decoded(&body) {
                cache.insert(key(&challenge), solved);
            }
        }
    }
    let Ok(cache) = cache().lock() else {
        return HashMap::new();
    };
    values
        .iter()
        .filter_map(|value| Some((value.clone(), cache.get(&key(value))?.clone())))
        .collect()
}

fn solved_urls() -> &'static Mutex<std::collections::HashSet<String>> {
    static SOLVED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    SOLVED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Remember that `url` carries a solved `n`, so the stream validator, which
/// otherwise refuses any URL with `n`, lets it through.
pub fn note_solved_url(url: &str) {
    if let Ok(mut solved) = solved_urls().lock() {
        if solved.len() >= CACHE_CAPACITY * 4 {
            solved.clear();
        }
        solved.insert(url.to_string());
    }
}

/// Whether `url` came out of a decoder rewrite.
#[must_use]
pub fn was_solved(url: &str) -> bool {
    solved_urls()
        .lock()
        .is_ok_and(|solved| solved.contains(url))
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decoded_values_are_read_from_the_first_response() {
        let body = json!({ "responses": [ { "data": { "AbC": "solved", "empty": "" } } ] });
        let decoded = parse_decoded(&body);
        assert_eq!(decoded.get("AbC").map(String::as_str), Some("solved"));
        assert!(!decoded.contains_key("empty"));
        assert!(parse_decoded(&json!({})).is_empty());
    }

    #[test]
    fn only_a_true_setting_turns_it_on() {
        assert!(enabled_from_setting(Some("true")));
        assert!(!enabled_from_setting(Some("false")));
        assert!(!enabled_from_setting(None));
    }

    #[test]
    fn challenges_are_url_encoded() {
        assert_eq!(url_encode("a=b/c+d"), "a%3Db%2Fc%2Bd");
    }
}
