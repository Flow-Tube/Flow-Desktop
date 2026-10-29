//! The Flow sync server as a store (spec/api.md). Requests are signed in with this member's
//! roster key; the server never sees anything but sealed objects.

use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::{Client, Method, StatusCode, Url, redirect};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use super::curve::sign;
use super::kdf::tag;
use super::keys::MemberSecrets;
use super::mailbox::Mailbox;
use super::roster::{Entry, parse_entry};
use super::store::Store;
use crate::sync::qr::is_local_ip;

/// Refresh a token this long before it expires.
const TOKEN_MARGIN_MS: u64 = 60_000;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("the server must use HTTPS unless it is on a private network")]
    Insecure,
    #[error("could not reach the server")]
    Network(#[source] reqwest::Error),
    #[error("the server refused the request: {code} ({status})")]
    Refused { status: u16, code: String },
    #[error("this is not the server instance this device paired with")]
    InstanceChanged,
    #[error("this server already has a group")]
    AlreadyClaimed,
    #[error("this device's copy of the group could not be read")]
    Local(#[source] sqlx::Error),
    #[error("the server sent an invalid response")]
    Malformed,
    #[error(transparent)]
    Protocol(#[from] super::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Whether an append landed, or lost to another device's append at the same head.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Appended {
    Done,
    Conflict { head: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ChangedObject {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Default)]
struct Session {
    instance: Option<String>,
    group: Option<String>,
    token: Option<(String, u64)>,
}

pub struct ServerStore {
    base: Url,
    client: Client,
    /// HTTP/1.1 only, with no overall timeout, for the live channel's WebSocket upgrade.
    pub(super) live: Client,
    member: MemberSecrets,
    session: Mutex<Session>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// HTTPS anywhere; plain HTTP only to a private address or a `.local` name, whose addresses are
/// all checked and then pinned so DNS can't move the connection afterwards.
async fn transport_for(url: &Url) -> Result<Option<(String, SocketAddr)>> {
    match url.scheme() {
        "https" => return Ok(None),
        "http" => {}
        _ => return Err(StoreError::Insecure),
    }
    let host = url
        .host_str()
        .ok_or(StoreError::Insecure)?
        .trim_matches(['[', ']']);
    if host.parse::<IpAddr>().is_ok_and(is_local_ip) {
        return Ok(None);
    }
    if !host.to_ascii_lowercase().ends_with(".local") {
        return Err(StoreError::Insecure);
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| StoreError::Insecure)?
        .collect();
    match addresses.first() {
        Some(first) if addresses.iter().all(|a| is_local_ip(a.ip())) => {
            Ok(Some((host.to_owned(), *first)))
        }
        _ => Err(StoreError::Insecure),
    }
}

impl ServerStore {
    /// Prepares a connection to `url` for `member`. `instance` and `group` are the ids pinned at
    /// pairing; a device restoring from its recovery key doesn't know them yet.
    pub async fn connect(
        url: &str,
        member: MemberSecrets,
        instance: Option<String>,
        group: Option<String>,
    ) -> Result<Self> {
        let base = Url::parse(url).map_err(|_| StoreError::Insecure)?;
        let pinned = transport_for(&base).await?;
        let builder = || {
            let builder = Client::builder()
                .tls_backend_rustls()
                .redirect(redirect::Policy::none())
                .user_agent(concat!("FlowDesktop/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(10));
            match &pinned {
                Some((host, address)) => builder.resolve(host, *address),
                None => builder,
            }
        };
        Ok(Self {
            base,
            client: builder()
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(StoreError::Network)?,
            live: builder()
                .http1_only()
                .build()
                .map_err(StoreError::Network)?,
            member,
            session: Mutex::new(Session {
                instance,
                group,
                token: None,
            }),
        })
    }

    pub(super) fn url(&self, path: &str) -> Result<Url> {
        self.base.join(path).map_err(|_| StoreError::Malformed)
    }

    async fn post_json(&self, path: &str, body: &Value) -> Result<Value> {
        let response = self
            .client
            .post(self.url(path)?)
            .json(body)
            .send()
            .await
            .map_err(StoreError::Network)?;
        decode(response).await
    }

    async fn sign_in(&self, session: &mut Session) -> Result<String> {
        let did = hex::encode(self.member.did);
        let challenge = self
            .post_json("v1/auth/challenge", &json!({ "did": did }))
            .await?;
        let field = |name: &str| {
            challenge[name]
                .as_str()
                .map(str::to_owned)
                .ok_or(StoreError::Malformed)
        };
        let (instance, group, nonce) = (field("instance")?, field("group")?, field("challenge")?);
        if session
            .instance
            .as_ref()
            .is_some_and(|pinned| *pinned != instance)
            || session
                .group
                .as_ref()
                .is_some_and(|pinned| *pinned != group)
        {
            return Err(StoreError::InstanceChanged);
        }
        let bytes = |text: &str| hex::decode(text).map_err(|_| StoreError::Malformed);
        let nonce_bytes = URL_SAFE_NO_PAD
            .decode(&nonce)
            .map_err(|_| StoreError::Malformed)?;
        let message = [tag("auth"), bytes(&instance)?, bytes(&group)?, nonce_bytes].concat();
        let sig = URL_SAFE_NO_PAD.encode(sign(&self.member.sig_seed, &message));
        let token = self
            .post_json(
                "v1/auth/token",
                &json!({ "did": did, "challenge": nonce, "sig": sig }),
            )
            .await?;
        let value = token["token"]
            .as_str()
            .ok_or(StoreError::Malformed)?
            .to_owned();
        let expires = token["expires"].as_u64().ok_or(StoreError::Malformed)?;
        *session = Session {
            instance: Some(instance),
            group: Some(group),
            token: Some((value.clone(), expires)),
        };
        Ok(value)
    }

    pub(super) async fn token(&self, renew: bool) -> Result<String> {
        let mut session = self.session.lock().await;
        match &session.token {
            Some((token, expires)) if !renew && *expires > now_ms() + TOKEN_MARGIN_MS => {
                Ok(token.clone())
            }
            _ => self.sign_in(&mut session).await,
        }
    }

    /// The instance and group ids, once signed in; the caller stores them to pin later sessions.
    pub async fn identity(&self) -> (Option<String>, Option<String>) {
        let session = self.session.lock().await;
        (session.instance.clone(), session.group.clone())
    }

    /// Sends an authenticated request, signing in again once if the token was refused.
    pub(super) async fn authorized(
        &self,
        method: Method,
        path: &str,
        body: Option<Body>,
    ) -> Result<reqwest::Response> {
        let url = self.url(path)?;
        for renew in [false, true] {
            let token = self.token(renew).await?;
            let mut request = self
                .client
                .request(method.clone(), url.clone())
                .bearer_auth(token);
            request = match &body {
                Some(Body::Json(value)) => request.json(value),
                Some(Body::Bytes(bytes)) => request
                    .header("content-type", "application/octet-stream")
                    .body(bytes.clone()),
                Some(Body::Append { value, head }) => request
                    .json(value)
                    .header("if-match", format!("\"{head}\"")),
                None => request,
            };
            let response = request.send().await.map_err(StoreError::Network)?;
            if response.status() != StatusCode::UNAUTHORIZED || renew {
                return Ok(response);
            }
        }
        unreachable!("the loop returns on its second pass")
    }

    /// A request with the operator's admin token instead of a device token.
    pub(super) fn as_admin(
        &self,
        method: Method,
        path: &str,
        admin_token: &str,
    ) -> Result<reqwest::RequestBuilder> {
        Ok(self
            .client
            .request(method, self.url(path)?)
            .bearer_auth(admin_token))
    }

    /// Creates the group on an unclaimed server with the operator's admin token.
    pub async fn claim(
        &self,
        admin_token: &str,
        genesis: &Entry,
        wraps: &BTreeMap<String, String>,
    ) -> Result<()> {
        let response = self
            .as_admin(Method::POST, "v1/claim", admin_token)?
            .json(&json!({ "entry": genesis, "wraps": wraps }))
            .send()
            .await
            .map_err(StoreError::Network)?;
        if response.status() == StatusCode::CONFLICT {
            return Err(StoreError::AlreadyClaimed);
        }
        decode_empty(response).await
    }

    async fn get_bytes(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let response = self.authorized(Method::GET, path, None).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let response = check(response).await?;
        Ok(Some(
            response
                .bytes()
                .await
                .map_err(StoreError::Network)?
                .to_vec(),
        ))
    }
}

impl Store for ServerStore {
    async fn roster_after(&self, after: i64) -> Result<Vec<Entry>> {
        let response = self
            .authorized(Method::GET, &format!("v1/roster?after={after}"), None)
            .await?;
        let value = decode(response).await?;
        let entries = value["entries"].as_array().ok_or(StoreError::Malformed)?;
        Ok(entries
            .iter()
            .map(parse_entry)
            .collect::<std::result::Result<_, _>>()?)
    }
    async fn append_roster(
        &self,
        head: &str,
        entry: &Entry,
        wraps: &BTreeMap<String, String>,
        chain: Option<&str>,
    ) -> Result<Appended> {
        let mut value = json!({ "entry": entry, "wraps": wraps });
        if let Some(chain) = chain {
            value["chain"] = json!(chain);
        }
        let body = Body::Append {
            value,
            head: head.to_owned(),
        };
        let response = self
            .authorized(Method::POST, "v1/roster", Some(body))
            .await?;
        if response.status() == StatusCode::CONFLICT {
            let value: Value = response.json().await.map_err(|_| StoreError::Malformed)?;
            let head = value["head"]
                .as_str()
                .ok_or(StoreError::Malformed)?
                .to_owned();
            return Ok(Appended::Conflict { head });
        }
        decode_empty(response).await.map(|()| Appended::Done)
    }
    async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.get_bytes(&format!("v1/keys/{epoch:08x}/{name}.k"))
            .await
    }
    async fn put_object(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        let response = self
            .authorized(
                Method::PUT,
                &format!("v1/objects/{path}"),
                Some(Body::Bytes(bytes)),
            )
            .await?;
        decode_empty(response).await
    }
    async fn get_object(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.get_bytes(&format!("v1/objects/{path}")).await
    }
    async fn delete_object(&self, path: &str) -> Result<()> {
        let response = self
            .authorized(Method::DELETE, &format!("v1/objects/{path}"), None)
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }
        decode_empty(response).await
    }
    /// Objects that arrived after `cursor`, and the cursor to pass next time.
    async fn changes(&self, cursor: u64) -> Result<(Vec<ChangedObject>, u64)> {
        let response = self
            .authorized(Method::GET, &format!("v1/changes?after={cursor}"), None)
            .await?;
        let value = decode(response).await?;
        let objects =
            serde_json::from_value(value["objects"].clone()).map_err(|_| StoreError::Malformed)?;
        let next = value["cursor"]
            .as_str()
            .and_then(|c| c.parse().ok())
            .ok_or(StoreError::Malformed)?;
        Ok((objects, next))
    }
}

/// Writing and reading messages needs no token: the new device has none yet, and only someone
/// who read the QR code can derive the slot id.
impl Mailbox for ServerStore {
    async fn open_slot(&self, slot: &str) -> Result<()> {
        let body = Body::Json(json!({ "slot": slot }));
        decode_empty(self.authorized(Method::POST, "v1/pair", Some(body)).await?).await
    }

    async fn put_message(&self, slot: &str, name: &str, bytes: Vec<u8>) -> Result<()> {
        let request = self
            .client
            .put(self.url(&format!("v1/pair/{slot}/{name}"))?);
        let response = request
            .header("content-type", "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(StoreError::Network)?;
        decode_empty(response).await
    }

    async fn get_message(&self, slot: &str, name: &str) -> Result<Option<Vec<u8>>> {
        let url = self.url(&format!("v1/pair/{slot}/{name}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(StoreError::Network)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(
            check(response)
                .await?
                .bytes()
                .await
                .map_err(StoreError::Network)?
                .to_vec(),
        ))
    }

    async fn close_slot(&self, slot: &str) -> Result<()> {
        decode_empty(
            self.authorized(Method::DELETE, &format!("v1/pair/{slot}"), None)
                .await?,
        )
        .await
    }
}

pub(super) enum Body {
    Json(Value),
    Bytes(Vec<u8>),
    Append { value: Value, head: String },
}

async fn check(response: reqwest::Response) -> Result<reqwest::Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let code = response
        .json::<Value>()
        .await
        .ok()
        .and_then(|v| v["error"].as_str().map(str::to_owned));
    Err(StoreError::Refused {
        status,
        code: code.unwrap_or_else(|| "unknown".to_owned()),
    })
}

pub(super) async fn decode(response: reqwest::Response) -> Result<Value> {
    check(response)
        .await?
        .json()
        .await
        .map_err(|_| StoreError::Malformed)
}

pub(super) async fn decode_empty(response: reqwest::Response) -> Result<()> {
    check(response).await.map(drop)
}
