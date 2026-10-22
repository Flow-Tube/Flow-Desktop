//! Sending one request: a bounded wait, the status read before the body, and a
//! couple of spaced retries when the failure looks transient.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::error::{TransportError, parse_retry_after, snippet};
use super::request::RequestSpec;

/// The longest any one attempt may take. Player requests sit inside the ladder's
/// own shorter budget; this is what stops a stalled browse from hanging forever.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_RETRIES: u32 = 2;
/// A timed-out attempt already cost the whole budget, so it is repeated once.
const MAX_TIMEOUT_RETRIES: u32 = 1;

fn classify(error: &reqwest::Error) -> TransportError {
    if error.is_timeout() {
        TransportError::Timeout
    } else {
        TransportError::Connect(error.to_string())
    }
}

/// One attempt, with no retry.
pub async fn send_once(
    http: &reqwest::Client,
    spec: &RequestSpec<'_>,
    payload: &Value,
    visitor: Option<&str>,
) -> Result<Value, TransportError> {
    let mut request = http.post(spec.url()).timeout(REQUEST_TIMEOUT).json(payload);
    for (name, value) in spec.headers(visitor) {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|error| classify(&error))?;
    let status = response.status();
    if status.as_u16() == 429 {
        let retry_after = parse_retry_after(
            response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok()),
        );
        return Err(TransportError::RateLimited { retry_after });
    }
    let body = response.text().await.map_err(|error| classify(&error))?;
    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| value["error"]["message"].as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| snippet(&body));
        return Err(TransportError::Status {
            code: status.as_u16(),
            message,
        });
    }
    serde_json::from_str(&body).map_err(|_| TransportError::NotJson(snippet(&body)))
}

/// [`send_once`], repeated after a short, growing pause while the failure looks
/// transient and the request may be repeated.
pub async fn send(
    http: &reqwest::Client,
    spec: &RequestSpec<'_>,
    payload: &Value,
    visitor: Option<&str>,
) -> Result<Value, TransportError> {
    let mut retries = 0;
    loop {
        match send_once(http, spec, payload, visitor).await {
            Err(error) if spec.is_retryable() && retries < retry_limit(&error) => {
                retries += 1;
                tracing::debug!(endpoint = spec.endpoint, retries, %error, "retrying request");
                tokio::time::sleep(backoff(retries)).await;
            }
            result => return result,
        }
    }
}

fn retry_limit(error: &TransportError) -> u32 {
    match error {
        TransportError::Timeout => MAX_TIMEOUT_RETRIES,
        error if error.is_transient() => MAX_RETRIES,
        _ => 0,
    }
}

/// 400 ms, then 800 ms, each with up to 200 ms of jitter so parallel requests
/// that failed together do not retry together.
fn backoff(retry: u32) -> Duration {
    let base = 400u64 << retry.saturating_sub(1).min(4);
    let jitter = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::from(elapsed.subsec_nanos()) % 200);
    Duration::from_millis(base + jitter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_limits_by_failure() {
        assert_eq!(retry_limit(&TransportError::Timeout), 1);
        assert_eq!(retry_limit(&TransportError::Connect("reset".into())), 2);
        assert_eq!(
            retry_limit(&TransportError::Status {
                code: 500,
                message: String::new()
            }),
            2
        );
        assert_eq!(
            retry_limit(&TransportError::Status {
                code: 404,
                message: String::new()
            }),
            0
        );
        assert_eq!(
            retry_limit(&TransportError::RateLimited { retry_after: None }),
            0
        );
    }

    #[test]
    fn backoff_grows() {
        let first = backoff(1).as_millis();
        let second = backoff(2).as_millis();
        assert!((400..600).contains(&first));
        assert!((800..1000).contains(&second));
    }
}
