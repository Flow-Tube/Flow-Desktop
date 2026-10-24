//! The Audioscrobbler 2.0 API that Last.fm and Libre.fm both speak: a mobile session from a user
//! name and password, now playing, scrobbles in batches of up to [`MAX_BATCH`], and loves.

use std::collections::BTreeMap;
use std::fmt::Write;

use md5::{Digest, Md5};
use serde_json::Value;

use super::SignInError;
use super::models::{Account, LoveEntry, ScrobbleEntry, SendOutcome};
use crate::api::http::shared_client;

pub const MAX_BATCH: usize = 50;
pub const LASTFM_URL: &str = "https://ws.audioscrobbler.com/2.0/";
pub const LIBREFM_URL: &str = "https://libre.fm/2.0/";

/// Libre.fm registers no apps and takes any key; these only have to be 32 characters.
const LIBREFM_PLACEHOLDER: &str = "f10wf10wf10wf10wf10wf10wf10wf10w";

/// An app's identity on a Last.fm-compatible service.
#[derive(Clone, PartialEq, Eq)]
pub struct Keys {
    pub api_key: String,
    pub secret: String,
}

impl Keys {
    pub fn is_usable(&self) -> bool {
        !self.api_key.trim().is_empty() && !self.secret.trim().is_empty()
    }

    pub fn libre_fm() -> Self {
        Self {
            api_key: LIBREFM_PLACEHOLDER.to_string(),
            secret: LIBREFM_PLACEHOLDER.to_string(),
        }
    }

    /// The key this build was made with, from the `LASTFM_API_KEY` and `LASTFM_API_SECRET`
    /// build secrets; empty in builds without them, which leaves Last.fm sign-in off.
    pub fn bundled_last_fm() -> Self {
        Self {
            api_key: option_env!("LASTFM_API_KEY")
                .unwrap_or_default()
                .to_string(),
            secret: option_env!("LASTFM_API_SECRET")
                .unwrap_or_default()
                .to_string(),
        }
    }
}

pub type Params = BTreeMap<String, String>;

/// The documented `api_sig`: every parameter but format and callback, sorted, joined, then the
/// secret, MD5'd.
pub fn signature(params: &Params, secret: &str) -> String {
    let mut hasher = Md5::new();
    for (name, value) in params {
        if name != "format" && name != "callback" {
            hasher.update(name.as_bytes());
            hasher.update(value.as_bytes());
        }
    }
    hasher.update(secret.as_bytes());
    hasher
        .finalize()
        .iter()
        .fold(String::with_capacity(32), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// Session and key errors sign the account out; outages and rate limits retry; anything else
/// drops the batch, because sending it again would fail the same way.
pub fn outcome_of(error_code: Option<i64>) -> SendOutcome {
    match error_code {
        Some(4 | 9 | 10 | 26) => SendOutcome::SignedOut,
        Some(8 | 11 | 16 | 29) => SendOutcome::Retry,
        _ => SendOutcome::Sent,
    }
}

/// The form a call posts: its parameters plus the api key, the signature and the JSON format.
pub fn signed_form(mut params: Params, keys: &Keys) -> Vec<(String, String)> {
    params.insert("api_key".into(), keys.api_key.clone());
    let sig = signature(&params, &keys.secret);
    let mut form: Vec<(String, String)> = params.into_iter().collect();
    form.push(("api_sig".into(), sig));
    form.push(("format".into(), "json".into()));
    form
}

pub fn sign_in_params(user_name: &str, password: &str) -> Params {
    Params::from([
        ("method".into(), "auth.getMobileSession".into()),
        ("username".into(), user_name.into()),
        ("password".into(), password.into()),
    ])
}

pub fn now_playing_params(entry: &ScrobbleEntry, session_key: &str) -> Params {
    let mut params = Params::from([
        ("method".into(), "track.updateNowPlaying".into()),
        ("artist".into(), entry.artist.clone()),
        ("track".into(), entry.title.clone()),
        ("sk".into(), session_key.into()),
    ]);
    if !entry.album.trim().is_empty() {
        params.insert("album".into(), entry.album.clone());
    }
    if entry.duration_sec > 0 {
        params.insert("duration".into(), entry.duration_sec.to_string());
    }
    params
}

pub fn scrobble_params(entries: &[ScrobbleEntry], session_key: &str) -> Params {
    let mut params = Params::from([
        ("method".into(), "track.scrobble".into()),
        ("sk".into(), session_key.into()),
    ]);
    for (index, entry) in entries.iter().take(MAX_BATCH).enumerate() {
        params.insert(format!("artist[{index}]"), entry.artist.clone());
        params.insert(format!("track[{index}]"), entry.title.clone());
        params.insert(
            format!("timestamp[{index}]"),
            entry.timestamp_sec.to_string(),
        );
        if !entry.album.trim().is_empty() {
            params.insert(format!("album[{index}]"), entry.album.clone());
        }
        if entry.duration_sec > 0 {
            params.insert(format!("duration[{index}]"), entry.duration_sec.to_string());
        }
    }
    params
}

pub fn love_params(love: &LoveEntry, session_key: &str) -> Params {
    let method = if love.loved {
        "track.love"
    } else {
        "track.unlove"
    };
    Params::from([
        ("method".into(), method.into()),
        ("artist".into(), love.artist.clone()),
        ("track".into(), love.title.clone()),
        ("sk".into(), session_key.into()),
    ])
}

fn error_code(body: &Value) -> Option<i64> {
    body.get("error").and_then(Value::as_i64)
}

/// The account a successful `auth.getMobileSession` reply describes.
pub fn account_from_session(body: &Value, user_name: &str) -> Result<Account, SignInError> {
    if error_code(body).is_some() {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Err(SignInError::Rejected(message.to_string()));
    }
    let session = body
        .get("session")
        .ok_or_else(|| SignInError::Rejected(String::new()))?;
    let key = session
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| SignInError::Rejected(String::new()))?;
    Ok(Account {
        user_name: session
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(user_name)
            .to_string(),
        secret: key.to_string(),
    })
}

/// One Last.fm-compatible service.
pub struct Client {
    base_url: &'static str,
}

impl Client {
    pub const fn new(base_url: &'static str) -> Self {
        Self { base_url }
    }

    pub async fn sign_in(
        &self,
        user_name: &str,
        password: &str,
        keys: &Keys,
    ) -> Result<Account, SignInError> {
        let body = self
            .post(sign_in_params(user_name, password), keys)
            .await
            .map_err(SignInError::Network)?;
        account_from_session(&body, user_name)
    }

    pub async fn send(&self, params: Params, keys: &Keys) -> SendOutcome {
        let method = params.get("method").cloned().unwrap_or_default();
        match self.post(params, keys).await {
            Ok(body) => outcome_of(error_code(&body)),
            Err(error) => {
                tracing::warn!(method, %error, "Audioscrobbler call failed");
                SendOutcome::Retry
            }
        }
    }

    async fn post(&self, params: Params, keys: &Keys) -> Result<Value, String> {
        let response = shared_client()
            .post(self.base_url)
            .form(&signed_form(params, keys))
            .send()
            .await
            .map_err(|error| error.without_url().to_string())?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| error.without_url().to_string())?;
        serde_json::from_str(&text).map_err(|_| format!("HTTP {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(pairs: &[(&str, &str)]) -> Params {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn the_signature_follows_the_documented_recipe() {
        let p = params(&[
            ("username", "u"),
            ("method", "auth.getMobileSession"),
            ("password", "p"),
            ("api_key", "xxx"),
            ("format", "json"),
        ]);
        assert_eq!(signature(&p, "s"), "f02a24fa543d12eeed6c58ed55b6c83a");
    }

    #[test]
    fn the_form_is_signed_over_everything_but_format() {
        let keys = Keys {
            api_key: "key".into(),
            secret: "secret".into(),
        };
        let form = signed_form(sign_in_params("listener", "pw"), &keys);
        let get = |name: &str| form.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());
        assert_eq!(get("method").as_deref(), Some("auth.getMobileSession"));
        assert_eq!(get("api_key").as_deref(), Some("key"));
        assert_eq!(get("format").as_deref(), Some("json"));
        let unsigned: Params = form
            .iter()
            .filter(|(k, _)| k != "api_sig" && k != "format")
            .cloned()
            .collect();
        assert_eq!(get("api_sig"), Some(signature(&unsigned, "secret")));
    }

    #[test]
    fn a_session_reply_becomes_an_account_and_a_rejection_keeps_the_message() {
        let ok = json!({"session": {"name": "Listener", "key": "SK", "subscriber": 0}});
        assert_eq!(
            account_from_session(&ok, "listener").unwrap(),
            Account {
                user_name: "Listener".into(),
                secret: "SK".into()
            }
        );
        let rejected = json!({"error": 4, "message": "Invalid username or password"});
        match account_from_session(&rejected, "u") {
            Err(SignInError::Rejected(message)) => {
                assert_eq!(message, "Invalid username or password");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn a_batch_sends_indexed_fields() {
        let entries = [
            ScrobbleEntry {
                artist: "A".into(),
                title: "One".into(),
                album: String::new(),
                duration_sec: 0,
                timestamp_sec: 10,
                from_youtube: true,
            },
            ScrobbleEntry {
                artist: "B".into(),
                title: "Two".into(),
                album: "Record".into(),
                duration_sec: 180,
                timestamp_sec: 20,
                from_youtube: true,
            },
        ];
        let p = scrobble_params(&entries, "SK");
        assert_eq!(p["track[1]"], "Two");
        assert_eq!(p["album[1]"], "Record");
        assert!(!p.contains_key("album[0]"));
        assert!(!p.contains_key("duration[0]"));
        assert_eq!(p["timestamp[0]"], "10");
        assert_eq!(p["sk"], "SK");
    }

    #[test]
    fn session_errors_sign_out_outages_retry_and_others_drop_the_batch() {
        assert_eq!(outcome_of(None), SendOutcome::Sent);
        for code in [4, 9, 10, 26] {
            assert_eq!(outcome_of(Some(code)), SendOutcome::SignedOut, "{code}");
        }
        for code in [8, 11, 16, 29] {
            assert_eq!(outcome_of(Some(code)), SendOutcome::Retry, "{code}");
        }
        assert_eq!(outcome_of(Some(6)), SendOutcome::Sent);
    }

    #[test]
    fn a_like_becomes_track_love_and_an_unlike_track_unlove() {
        let mut love = LoveEntry {
            artist: "A".into(),
            title: "Song".into(),
            loved: true,
        };
        assert_eq!(love_params(&love, "SK")["method"], "track.love");
        love.loved = false;
        assert_eq!(love_params(&love, "SK")["method"], "track.unlove");
    }

    #[test]
    fn libre_fm_uses_a_32_character_placeholder_and_an_empty_build_key_is_unusable() {
        assert_eq!(Keys::libre_fm().api_key.len(), 32);
        assert!(Keys::libre_fm().is_usable());
        assert!(
            !Keys {
                api_key: String::new(),
                secret: "s".into()
            }
            .is_usable()
        );
    }
}
