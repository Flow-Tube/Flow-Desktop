//! A LAN session between two members (spec/live.md, Session and Requests): the three-message
//! hello under the group's LAN key, then sealed, numbered frames carrying requests both ways.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};

use super::curve::{sign, verify};
use super::engine::{EngineError, Result, Session, verify_logged};
use super::epoch::{Purpose, purpose_key};
use super::held::HeldStore;
use super::keys::MemberSecrets;
use super::lan::{LanRole, lan_frame_aad, lan_hello_aad, lan_session_keys, lan_transcript};
use super::paths::parse_log_path;
use super::payload::{decode_payload, encode_payload};
use super::roster::{Entry, Role};
use super::sealed::{open, random_bytes, seal};
use super::store::Store;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;
use crate::sync::transport::WsChannel;

pub const SESSION_PATH: &str = "/flow-sync/2";
const MAX_PAYLOAD: usize = 4 * 1024 * 1024;
const NONCE_SIZE: usize = 32;
/// Once this side has no more requests, the session closes when the peer stops sending.
pub const IDLE: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Roster {
        after: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        head: Option<String>,
    },
    Key {
        epoch: u32,
        name: String,
    },
    List {
        vv: BTreeMap<String, u64>,
    },
    Get {
        path: String,
    },
    Put {
        path: String,
    },
    Live,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Response {
    pub re: u64,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<Entry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blobs: Option<Vec<String>>,
}

fn request_header(request: &Request, id: u64) -> Value {
    let mut header = serde_json::to_value(request).unwrap_or_default();
    header["id"] = json!(id);
    header
}

/// A JSON header line, then `\n` and raw bytes when there are any.
fn frame_content(header: &impl Serialize, bytes: &[u8]) -> Vec<u8> {
    let mut content = to_canonical_json(header);
    if !bytes.is_empty() {
        content.push(b'\n');
        content.extend_from_slice(bytes);
    }
    content
}

fn split_content(content: &[u8]) -> Result<(Value, &[u8])> {
    let (header, bytes) = match content.iter().position(|&b| b == b'\n') {
        Some(at) => (&content[..at], &content[at + 1..]),
        None => (content, &content[content.len()..]),
    };
    let header = serde_json::from_slice(header).map_err(|_| EngineError::Unexpected)?;
    Ok((header, bytes))
}

/// Sealed frames after the hello, each `u64(seq) ‖ box`, numbered strictly in each direction.
pub struct Framed<S> {
    socket: WsChannel<S>,
    send_key: Vec<u8>,
    receive_key: Vec<u8>,
    sent: u64,
    received: u64,
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> Framed<S> {
    async fn send(&mut self, content: &[u8]) -> Result<()> {
        if content.len() > MAX_PAYLOAD {
            return Err(Error::Length.into());
        }
        let sealed = seal(
            &self.send_key,
            &lan_frame_aad(self.sent),
            &encode_payload(content)?,
        );
        let frame = [&self.sent.to_be_bytes()[..], &sealed].concat();
        self.socket.send_binary(frame).await?;
        self.sent += 1;
        Ok(())
    }

    fn open(&mut self, frame: &[u8]) -> Result<Vec<u8>> {
        let (seq, sealed) = frame.split_first_chunk::<8>().ok_or(Error::Length)?;
        if u64::from_be_bytes(*seq) != self.received {
            return Err(Error::Replay.into());
        }
        let content = decode_payload(&open(
            &self.receive_key,
            &lan_frame_aad(self.received),
            sealed,
        )?)?;
        self.received += 1;
        Ok(content)
    }
}

fn hello_frame(epoch: u32, lan_key: &[u8], message: u8, body: &Value) -> Result<Vec<u8>> {
    let sealed = seal(
        lan_key,
        &lan_hello_aad(message),
        &encode_payload(&to_canonical_json(body))?,
    );
    Ok([&epoch.to_be_bytes()[..], &sealed].concat())
}

fn open_hello(frame: &[u8], lan_key: &[u8], message: u8) -> Result<Value> {
    let sealed = frame.get(4..).ok_or(Error::Length)?;
    let content = decode_payload(&open(lan_key, &lan_hello_aad(message), sealed)?)?;
    serde_json::from_slice(&content).map_err(|_| EngineError::Unexpected)
}

fn frame_epoch(frame: &[u8]) -> Result<u32> {
    Ok(u32::from_be_bytes(
        *frame.first_chunk::<4>().ok_or(Error::Length)?,
    ))
}

fn field<const N: usize>(body: &Value, name: &str) -> Result<[u8; N]> {
    body[name]
        .as_str()
        .and_then(|v| URL_SAFE_NO_PAD.decode(v).ok())
        .filter(|bytes| bytes.len() == N)
        .map(|bytes| array(&bytes))
        .ok_or(EngineError::Unexpected)
}

/// The signing key of `did` when it is a current device of the group.
fn device_key<S: Store>(session: &Session<'_, S>, did: &str) -> Result<[u8; 32]> {
    session
        .roster()
        .members
        .get(did)
        .filter(|member| member.role == Role::Device)
        .map(|member| member.sig)
        .ok_or(EngineError::Removed)
}

fn did_bytes(did: &str) -> Result<[u8; 16]> {
    hex::decode(did)
        .ok()
        .filter(|bytes| bytes.len() == 16)
        .map(|bytes| array(&bytes))
        .ok_or(EngineError::Unexpected)
}

/// The connecting side: says hello under the current epoch, with the port it listens on, and
/// checks the advertiser.
pub async fn hello_as_client<S, T>(
    mut socket: WsChannel<S>,
    session: &Session<'_, T>,
    device: &MemberSecrets,
    listening: Option<u16>,
) -> Result<(Framed<S>, String)>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
    T: Store,
{
    let epoch = session.roster().epoch;
    let lan_key = purpose_key(session.current_key(), session.group(), epoch, Purpose::Lan);
    let me = hex::encode(device.did);
    let client_nonce = random_bytes::<NONCE_SIZE>();
    let mut hello = json!({ "did": me, "n": URL_SAFE_NO_PAD.encode(client_nonce) });
    if let Some(port) = listening {
        hello["p"] = port.into();
    }
    socket
        .send_binary(hello_frame(epoch, &lan_key, 1, &hello)?)
        .await?;

    let reply = socket.recv_binary().await?;
    if frame_epoch(&reply)? != epoch {
        return Err(EngineError::Unexpected);
    }
    let reply = open_hello(&reply, &lan_key, 2)?;
    let peer = reply["did"]
        .as_str()
        .ok_or(EngineError::Unexpected)?
        .to_owned();
    let server_nonce = field::<NONCE_SIZE>(&reply, "n")?;
    let (client, server) = (device.did, did_bytes(&peer)?);
    let signed = lan_transcript(
        LanRole::Server,
        &client_nonce,
        &server_nonce,
        &client,
        &server,
    );
    if !verify(
        &device_key(session, &peer)?,
        &signed,
        &field::<64>(&reply, "sig")?,
    ) {
        return Err(Error::Signature.into());
    }

    let mine = lan_transcript(
        LanRole::Client,
        &client_nonce,
        &server_nonce,
        &client,
        &server,
    );
    let finish = json!({ "sig": URL_SAFE_NO_PAD.encode(sign(&device.sig_seed, &mine)) });
    socket
        .send_binary(hello_frame(epoch, &lan_key, 3, &finish)?)
        .await?;
    let keys = lan_session_keys(&lan_key, &client_nonce, &server_nonce, &client, &server);
    let framed = Framed {
        socket,
        send_key: keys.client_to_server,
        receive_key: keys.server_to_client,
        sent: 0,
        received: 0,
    };
    Ok((framed, peer))
}

/// The advertising side: answers a hello under any epoch this device has a key for.
/// The advertising side; returns the peer and the port it listens on, when it said.
pub async fn hello_as_server<S, T>(
    mut socket: WsChannel<S>,
    session: &mut Session<'_, T>,
    device: &MemberSecrets,
) -> Result<(Framed<S>, String, Option<u16>)>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
    T: Store,
{
    let first = socket.recv_binary().await?;
    let epoch = frame_epoch(&first)?;
    if epoch > session.roster().epoch {
        return Err(EngineError::Unexpected);
    }
    let epoch_key = session.epoch_key(epoch).await?;
    let lan_key = purpose_key(&epoch_key, session.group(), epoch, Purpose::Lan);
    let hello = open_hello(&first, &lan_key, 1)?;
    let peer = hello["did"]
        .as_str()
        .ok_or(EngineError::Unexpected)?
        .to_owned();
    let peer_key = device_key(session, &peer)?;
    let client_nonce = field::<NONCE_SIZE>(&hello, "n")?;
    let listening = hello["p"].as_u64().and_then(|p| u16::try_from(p).ok());
    let (client, server) = (did_bytes(&peer)?, device.did);

    let server_nonce = random_bytes::<NONCE_SIZE>();
    let mine = lan_transcript(
        LanRole::Server,
        &client_nonce,
        &server_nonce,
        &client,
        &server,
    );
    let reply = json!({
        "did": hex::encode(device.did),
        "n": URL_SAFE_NO_PAD.encode(server_nonce),
        "sig": URL_SAFE_NO_PAD.encode(sign(&device.sig_seed, &mine)),
    });
    socket
        .send_binary(hello_frame(epoch, &lan_key, 2, &reply)?)
        .await?;

    let finish = socket.recv_binary().await?;
    let finish = open_hello(&finish, &lan_key, 3)?;
    let signed = lan_transcript(
        LanRole::Client,
        &client_nonce,
        &server_nonce,
        &client,
        &server,
    );
    if !verify(&peer_key, &signed, &field::<64>(&finish, "sig")?) {
        return Err(Error::Signature.into());
    }
    let keys = lan_session_keys(&lan_key, &client_nonce, &server_nonce, &client, &server);
    let framed = Framed {
        socket,
        send_key: keys.server_to_client,
        receive_key: keys.client_to_server,
        sent: 0,
        received: 0,
    };
    Ok((framed, peer, listening))
}

/// Where live envelopes that arrive in `live` requests go.
pub type LiveSink = Arc<dyn Fn(Vec<u8>) + Send + Sync>;

/// What a device serves: the group it holds, and the keys to check an object before taking it.
pub struct Holder {
    pub store: HeldStore,
    pub group: [u8; 16],
    pub signing_keys: BTreeMap<String, [u8; 32]>,
    pub live: LiveSink,
}

impl Holder {
    pub fn of<T: Store>(store: HeldStore, session: &Session<'_, T>, live: LiveSink) -> Self {
        Self {
            store,
            group: *session.group(),
            signing_keys: session.signing_keys().clone(),
            live,
        }
    }

    async fn answer(&self, request: Request, bytes: &[u8]) -> Result<(Response, Vec<u8>)> {
        let found = |found: bool| Response {
            ok: found,
            error: (!found).then(|| "not_found".to_owned()),
            ..Response::default()
        };
        Ok(match request {
            Request::Roster { after, head } => (
                Response {
                    ok: true,
                    entries: Some(self.store.roster_for(after, head.as_deref()).await?),
                    ..Response::default()
                },
                Vec::new(),
            ),
            Request::Key { epoch, name } => match self.store.key(epoch, &name).await? {
                Some(bytes) => (found(true), bytes),
                None => (found(false), Vec::new()),
            },
            Request::List { vv } => {
                let (paths, blobs) = self.store.listing(&vv).await?;
                let response = Response {
                    ok: true,
                    paths: Some(paths),
                    blobs: Some(blobs),
                    ..Response::default()
                };
                (response, Vec::new())
            }
            Request::Get { path } => match self.store.get_object(&path).await? {
                Some(bytes) => (found(true), bytes),
                None => (found(false), Vec::new()),
            },
            Request::Put { path } => {
                let accepted = parse_log_path(&path).is_some_and(|(did, seq)| {
                    verify_logged(bytes, &self.group, &self.signing_keys, &did, seq).is_ok()
                });
                if accepted {
                    self.store.put_object(&path, bytes.to_vec()).await?;
                }
                let response = Response {
                    ok: accepted,
                    error: (!accepted).then(|| "invalid".to_owned()),
                    ..Response::default()
                };
                (response, Vec::new())
            }
            Request::Live => unreachable!("live messages get no response"),
        })
    }
}

type Reply = oneshot::Sender<Result<(Response, Vec<u8>)>>;

/// Sends requests over a session and waits for their answers, while the session serves the
/// peer's requests from what this device holds.
#[derive(Clone)]
pub struct Link {
    outgoing: mpsc::Sender<(Request, Vec<u8>, Reply)>,
}

impl Link {
    /// Runs the session until either side closes it.
    pub fn spawn<S>(mut framed: Framed<S>, holder: Holder) -> Self
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (outgoing, mut requests) = mpsc::channel::<(Request, Vec<u8>, Reply)>(16);
        tokio::spawn(async move {
            let mut waiting: BTreeMap<u64, Reply> = BTreeMap::new();
            let mut next_id = 0u64;
            let mut done_asking = false;
            loop {
                let frame = tokio::select! {
                    frame = framed.socket.recv_binary() => frame,
                    () = tokio::time::sleep(IDLE), if done_asking => break,
                    request = requests.recv(), if !done_asking => {
                        let Some((request, bytes, reply)) = request else {
                            done_asking = true;
                            continue;
                        };
                        let header = request_header(&request, next_id);
                        if framed.send(&frame_content(&header, &bytes)).await.is_err() {
                            break;
                        }
                        if request != Request::Live {
                            waiting.insert(next_id, reply);
                        }
                        next_id += 1;
                        continue;
                    }
                };
                let Ok(frame) = frame else { break };
                let Ok(content) = framed.open(&frame) else {
                    break;
                };
                let Ok((header, bytes)) = split_content(&content) else {
                    break;
                };
                if header.get("re").is_some() {
                    let response: Option<Response> = serde_json::from_value(header).ok();
                    if let Some(response) = response
                        && let Some(reply) = waiting.remove(&response.re)
                    {
                        let _ = reply.send(Ok((response, bytes.to_vec())));
                    }
                    continue;
                }
                let id = header["id"].as_u64().unwrap_or_default();
                let answer = match serde_json::from_value::<Request>(header) {
                    Ok(Request::Live) => {
                        (holder.live)(bytes.to_vec());
                        continue;
                    }
                    Ok(request) => holder.answer(request, bytes).await,
                    Err(_) => Ok((
                        Response {
                            error: Some("invalid".to_owned()),
                            ..Response::default()
                        },
                        Vec::new(),
                    )),
                };
                let (mut response, bytes) = answer.unwrap_or_else(|_| {
                    let failed = Response {
                        error: Some("invalid".to_owned()),
                        ..Response::default()
                    };
                    (failed, Vec::new())
                });
                response.re = id;
                if framed
                    .send(&frame_content(&response, &bytes))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            framed.socket.close().await;
        });
        Self { outgoing }
    }

    async fn ask(&self, request: Request) -> Result<(Response, Vec<u8>)> {
        let (reply, answer) = oneshot::channel();
        self.outgoing
            .send((request, Vec::new(), reply))
            .await
            .map_err(|_| EngineError::LanUnreachable)?;
        answer.await.map_err(|_| EngineError::LanUnreachable)?
    }

    /// Sends a live envelope, which gets no answer.
    pub async fn live(&self, envelope: Vec<u8>) -> Result<()> {
        let (reply, _) = oneshot::channel();
        self.outgoing
            .send((Request::Live, envelope, reply))
            .await
            .map_err(|_| EngineError::LanUnreachable)
    }

    /// The bytes a `key` or `get` answered with, or `None` when the peer doesn't hold them.
    async fn bytes(&self, request: Request) -> Result<Option<Vec<u8>>> {
        let (response, bytes) = self.ask(request).await?;
        Ok(response.ok.then_some(bytes))
    }

    pub async fn roster(&self, after: i64, head: Option<String>) -> Result<Vec<Entry>> {
        let (response, _) = self.ask(Request::Roster { after, head }).await?;
        response.entries.ok_or(EngineError::Unexpected)
    }

    pub async fn key(&self, epoch: u32, name: &str) -> Result<Option<Vec<u8>>> {
        self.bytes(Request::Key {
            epoch,
            name: name.to_owned(),
        })
        .await
    }

    pub async fn list(&self, vv: BTreeMap<String, u64>) -> Result<(Vec<String>, Vec<String>)> {
        let (response, _) = self.ask(Request::List { vv }).await?;
        Ok((
            response.paths.unwrap_or_default(),
            response.blobs.unwrap_or_default(),
        ))
    }

    pub async fn get(&self, path: &str) -> Result<Option<Vec<u8>>> {
        self.bytes(Request::Get {
            path: path.to_owned(),
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_are_canonical_json_lines() {
        let roster = request_header(
            &Request::Roster {
                after: -1,
                head: None,
            },
            0,
        );
        assert_eq!(
            frame_content(&roster, &[]),
            br#"{"after":-1,"id":0,"op":"roster"}"#
        );
        let after_head = request_header(
            &Request::Roster {
                after: 1,
                head: Some("ab".into()),
            },
            1,
        );
        assert_eq!(
            frame_content(&after_head, &[]),
            br#"{"after":1,"head":"ab","id":1,"op":"roster"}"#
        );
        let get = request_header(
            &Request::Get {
                path: "dev/x".into(),
            },
            3,
        );
        assert_eq!(
            frame_content(&get, &[]),
            br#"{"id":3,"op":"get","path":"dev/x"}"#
        );
        let missing = Response {
            re: 3,
            error: Some("not_found".into()),
            ..Response::default()
        };
        assert_eq!(
            frame_content(&missing, &[]),
            br#"{"error":"not_found","ok":false,"re":3}"#
        );
        let key = Response {
            re: 1,
            ok: true,
            ..Response::default()
        };
        assert_eq!(
            frame_content(&key, b"wrap"),
            b"{\"ok\":true,\"re\":1}\nwrap"
        );
        let (header, bytes) = split_content(b"{\"ok\":true,\"re\":1}\nwrap").unwrap();
        assert_eq!((header["re"].as_u64(), bytes), (Some(1), &b"wrap"[..]));
    }
}
