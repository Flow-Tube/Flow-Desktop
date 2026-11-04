//! Joining a server group with the admin token (spec/protocol.md, Joining with the admin token):
//! a new device posts a request, a member that accepts answers it with the code it would have
//! shown, and the two pair through the mailbox as usual. The six digits still decide.

use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::codes::{Code, read_code};
use super::engine::{EngineError, Result};
use super::sealed::random_bytes;
use super::server::{self, Body, ServerStore, StoreError};

const POLL_EVERY: Duration = Duration::from_secs(2);
const REQUEST_LIFETIME: Duration = Duration::from_secs(180);
const NAME_LIMIT: usize = 64;

/// A device waiting to join, as the server lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JoinRequest {
    pub id: String,
    pub name: String,
    pub expires: i64,
}

impl ServerStore {
    pub async fn ask_to_join(&self, admin_token: &str, id: &str, name: &str) -> server::Result<()> {
        let name: String = name.chars().take(NAME_LIMIT).collect();
        let body = json!({ "id": id, "name": name });
        let response = self
            .as_admin(Method::POST, "v1/join", admin_token, Some(&body))
            .await?;
        server::decode_empty(response).await
    }

    /// The code a member answered with, or `None` while no member has.
    pub async fn join_answer(&self, admin_token: &str, id: &str) -> server::Result<Option<String>> {
        let response = self
            .as_admin(Method::GET, &format!("v1/join/{id}"), admin_token, None)
            .await?;
        match response.status() {
            StatusCode::NOT_FOUND => return Ok(None),
            StatusCode::GONE => return Err(StoreError::JoinDeclined),
            _ => {}
        }
        let answer = server::decode(response).await?;
        Ok(answer["code"].as_str().map(str::to_owned))
    }

    pub async fn join_requests(&self) -> server::Result<Vec<JoinRequest>> {
        let response = self.authorized(Method::GET, "v1/join", None).await?;
        serde_json::from_value(server::decode(response).await?["requests"].take())
            .map_err(|_| StoreError::Malformed)
    }

    pub async fn answer_join(&self, id: &str, code: &str) -> server::Result<()> {
        let body = Body::Json(json!({ "code": code }));
        let path = format!("v1/join/{id}");
        server::decode_empty(self.authorized(Method::PUT, &path, Some(body)).await?).await
    }

    pub async fn decline_join(&self, id: &str) -> server::Result<()> {
        let path = format!("v1/join/{id}");
        server::decode_empty(self.authorized(Method::DELETE, &path, None).await?).await
    }
}

/// Posts a join request under `name` and waits for a member's code.
pub async fn wait_for_code(store: &ServerStore, admin_token: &str, name: &str) -> Result<Code> {
    let id = hex::encode(random_bytes::<16>());
    store.ask_to_join(admin_token, &id, name).await?;
    let deadline = tokio::time::Instant::now() + REQUEST_LIFETIME;
    loop {
        if let Some(code) = store.join_answer(admin_token, &id).await? {
            return read_code(&code);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(EngineError::TimedOut);
        }
        tokio::time::sleep(POLL_EVERY).await;
    }
}
