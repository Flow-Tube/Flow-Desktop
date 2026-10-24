//! The `ListenBrainz` submit API, signed in with the user token from the listener's settings page.

use reqwest::StatusCode;
use serde_json::{Map, Value, json};

use super::SignInError;
use super::models::{Account, ScrobbleEntry, SendOutcome};
use crate::api::http::shared_client;

pub const MAX_BATCH: usize = 100;
const BASE_URL: &str = "https://api.listenbrainz.org/1";
const PLAYING_NOW: &str = "playing_now";
const SINGLE: &str = "single";
const IMPORT: &str = "import";

/// The submit-listens body; a now-playing listen carries no timestamp.
pub fn listens_json(listen_type: &str, entries: &[ScrobbleEntry]) -> Value {
    let payload: Vec<Value> = entries
        .iter()
        .map(|entry| {
            let mut info = Map::new();
            if entry.duration_sec > 0 {
                info.insert(
                    "duration_ms".into(),
                    json!(u64::from(entry.duration_sec) * 1000),
                );
            }
            info.insert("submission_client".into(), json!("Flow Desktop"));
            info.insert(
                "submission_client_version".into(),
                json!(env!("CARGO_PKG_VERSION")),
            );
            if entry.from_youtube {
                info.insert("music_service".into(), json!("music.youtube.com"));
            }
            let mut metadata = Map::new();
            metadata.insert("artist_name".into(), json!(entry.artist));
            metadata.insert("track_name".into(), json!(entry.title));
            if !entry.album.trim().is_empty() {
                metadata.insert("release_name".into(), json!(entry.album));
            }
            metadata.insert("additional_info".into(), Value::Object(info));
            let mut listen = Map::new();
            if listen_type != PLAYING_NOW {
                listen.insert("listened_at".into(), json!(entry.timestamp_sec));
            }
            listen.insert("track_metadata".into(), Value::Object(metadata));
            Value::Object(listen)
        })
        .collect();
    json!({ "listen_type": listen_type, "payload": payload })
}

/// A bad token signs out; rate limits and outages retry; any other refusal drops the batch.
pub fn outcome_for_status(status: StatusCode) -> SendOutcome {
    if status.is_success() {
        SendOutcome::Sent
    } else if status == StatusCode::UNAUTHORIZED {
        SendOutcome::SignedOut
    } else if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        SendOutcome::Retry
    } else {
        SendOutcome::Sent
    }
}

/// The account a `validate-token` reply describes.
pub fn account_from_validation(body: &Value, token: &str) -> Result<Account, SignInError> {
    if body.get("valid").and_then(Value::as_bool) != Some(true) {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Err(SignInError::Rejected(message.to_string()));
    }
    Ok(Account {
        user_name: body
            .get("user_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        secret: token.to_string(),
    })
}

fn authorization(token: &str) -> String {
    format!("Token {token}")
}

pub async fn sign_in(token: &str) -> Result<Account, SignInError> {
    let response = shared_client()
        .get(format!("{BASE_URL}/validate-token"))
        .header(reqwest::header::AUTHORIZATION, authorization(token))
        .send()
        .await
        .map_err(|error| SignInError::Network(error.without_url().to_string()))?;
    let status = response.status();
    if status.is_server_error() {
        return Err(SignInError::Network(format!("HTTP {status}")));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| SignInError::Network(format!("HTTP {status}")))?;
    account_from_validation(&body, token)
}

pub async fn now_playing(entry: &ScrobbleEntry, account: &Account) -> SendOutcome {
    submit(PLAYING_NOW, std::slice::from_ref(entry), account).await
}

pub async fn scrobble(entries: &[ScrobbleEntry], account: &Account) -> SendOutcome {
    let batch = &entries[..entries.len().min(MAX_BATCH)];
    let listen_type = if batch.len() == 1 { SINGLE } else { IMPORT };
    submit(listen_type, batch, account).await
}

async fn submit(listen_type: &str, entries: &[ScrobbleEntry], account: &Account) -> SendOutcome {
    let result = shared_client()
        .post(format!("{BASE_URL}/submit-listens"))
        .header(
            reqwest::header::AUTHORIZATION,
            authorization(&account.secret),
        )
        .json(&listens_json(listen_type, entries))
        .send()
        .await;
    match result {
        Ok(response) => outcome_for_status(response.status()),
        Err(error) => {
            tracing::warn!(error = %error.without_url(), "ListenBrainz submit failed");
            SendOutcome::Retry
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(from_youtube: bool) -> ScrobbleEntry {
        ScrobbleEntry {
            artist: "Artist".into(),
            title: "Song".into(),
            album: "Album".into(),
            duration_sec: 200,
            timestamp_sec: 1_700_000_000,
            from_youtube,
        }
    }

    #[test]
    fn now_playing_carries_no_timestamp() {
        let body = listens_json(PLAYING_NOW, &[entry(true)]);
        let listen = &body["payload"][0];
        assert!(listen.get("listened_at").is_none());
        assert_eq!(listen["track_metadata"]["artist_name"], "Artist");
        assert_eq!(body["listen_type"], "playing_now");
    }

    #[test]
    fn a_finished_listen_has_its_time_and_its_source() {
        let body = listens_json(SINGLE, &[entry(true)]);
        let listen = &body["payload"][0];
        let info = &listen["track_metadata"]["additional_info"];
        assert_eq!(listen["listened_at"], 1_700_000_000);
        assert_eq!(info["duration_ms"], 200_000);
        assert_eq!(info["music_service"], "music.youtube.com");
        assert_eq!(listen["track_metadata"]["release_name"], "Album");
        let local = listens_json(SINGLE, &[entry(false)]);
        assert!(
            local["payload"][0]["track_metadata"]["additional_info"]
                .get("music_service")
                .is_none()
        );
    }

    #[test]
    fn statuses_map_to_outcomes() {
        assert_eq!(outcome_for_status(StatusCode::OK), SendOutcome::Sent);
        assert_eq!(
            outcome_for_status(StatusCode::UNAUTHORIZED),
            SendOutcome::SignedOut
        );
        assert_eq!(
            outcome_for_status(StatusCode::TOO_MANY_REQUESTS),
            SendOutcome::Retry
        );
        assert_eq!(
            outcome_for_status(StatusCode::BAD_GATEWAY),
            SendOutcome::Retry
        );
        assert_eq!(
            outcome_for_status(StatusCode::BAD_REQUEST),
            SendOutcome::Sent
        );
    }

    #[test]
    fn a_token_is_valid_only_when_the_service_says_so() {
        let ok = json!({"valid": true, "user_name": "listener", "code": 200});
        assert_eq!(
            account_from_validation(&ok, "tok").unwrap(),
            Account {
                user_name: "listener".into(),
                secret: "tok".into()
            }
        );
        let bad = json!({"valid": false, "message": "Invalid authorization token."});
        assert!(matches!(
            account_from_validation(&bad, "tok"),
            Err(SignInError::Rejected(message)) if message == "Invalid authorization token."
        ));
    }
}
