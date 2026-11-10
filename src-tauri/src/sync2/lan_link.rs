//! A LAN session between two members (spec/live.md, Session and Requests): the three-message
//! hello under the group's LAN key, then sealed, numbered frames carrying requests both ways.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use super::curve::{sign, verify};
use super::engine::{EngineError, Result, Session, verify_logged};
use super::envelope::MAX_OBJECT_SIZE;
use super::epoch::{Purpose, purpose_key};
use super::gc::bounded_vv;
use super::held::HeldStore;
use super::keys::MemberSecrets;
use super::lan::{LanRole, lan_frame_aad, lan_hello_aad, lan_session_keys, lan_transcript};
use super::paths::parse_log_path;
use super::payload::{decode_payload, encode_payload};
use super::roster::{Entry, Role, Sender, parse_entry};
use super::sealed::{open, random_bytes, seal};
use super::store::Store;
use super::{Error, array};
use crate::sync::canonical::to_canonical_json;
use crate::sync::transport::WsChannel;

pub const SESSION_PATH: &str = "/flow-sync/2";
/// A whole object with its header line (spec/live.md, Requests).
const MAX_CONTENT: usize = MAX_OBJECT_SIZE + 64 * 1024;
/// Room for the content's gzip, padding (at most 1/32 at this size), box and `seq`.
const MAX_FRAME: usize = MAX_OBJECT_SIZE + MAX_OBJECT_SIZE / 16;
const NONCE_SIZE: usize = 32;
/// Once this side has no more requests, the session closes when the peer stops sending.
pub const IDLE: Duration = Duration::from_secs(3);
/// How long a peer that hasn't proved itself gets for each hello message.
pub const HELLO_WITHIN: Duration = Duration::from_secs(3);
/// How long a member gets to answer one request, which can carry a full object.
const ASK_WITHIN: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Roster {
        after: i64,
    },
    Key {
        epoch: u32,
        kc: String,
        name: String,
    },
    List {
        #[serde(deserialize_with = "bounded_vv")]
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
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "parsed_entries"
    )]
    pub entries: Option<Vec<Entry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blobs: Option<Vec<String>>,
}

/// A peer's entry that doesn't parse is ignored like a losing fork candidate (spec/store.md,
/// Untrusted input).
fn parsed_entries<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Vec<Entry>>, D::Error> {
    let values = Option::<Vec<Value>>::deserialize(deserializer)?;
    Ok(values.map(|values| values.iter().filter_map(|v| parse_entry(v).ok()).collect()))
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
        if content.len() > MAX_CONTENT {
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
        if content.len() > MAX_CONTENT {
            return Err(Error::Length.into());
        }
        self.received += 1;
        Ok(content)
    }
}

/// What a LAN WebSocket reads before it gives up on a message.
pub(super) fn lan_socket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME))
        .max_frame_size(Some(MAX_FRAME))
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

/// The connecting side: says hello under `epoch`, whose key is `epoch_key`, with the port it listens
/// on, and checks the advertiser. [`EngineError::LanUnreachable`] when the advertiser didn't answer.
pub async fn hello_as_client<S, T>(
    mut socket: WsChannel<S>,
    session: &Session<'_, T>,
    device: &MemberSecrets,
    (epoch, epoch_key): (u32, &[u8]),
    listening: Option<u16>,
) -> Result<(Framed<S>, String)>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
    T: Store,
{
    let lan_key = purpose_key(epoch_key, session.group(), epoch, Purpose::Lan);
    let me = hex::encode(device.did);
    let client_nonce = random_bytes::<NONCE_SIZE>();
    let mut hello = json!({ "did": me, "n": URL_SAFE_NO_PAD.encode(client_nonce) });
    if let Some(port) = listening {
        hello["p"] = port.into();
    }
    socket
        .send_binary(hello_frame(epoch, &lan_key, 1, &hello)?)
        .await?;

    let reply = timeout(HELLO_WITHIN, socket.recv_binary())
        .await
        .map_err(|_| EngineError::TimedOut)?
        .map_err(|_| EngineError::LanUnreachable)?;
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

/// The advertising side: answers `first`, the peer's first message, under any epoch this device
/// has a key for. Returns the peer and the port it listens on, when it said.
pub async fn hello_as_server<S, T>(
    mut socket: WsChannel<S>,
    first: &[u8],
    session: &mut Session<'_, T>,
    device: &MemberSecrets,
) -> Result<(Framed<S>, String, Option<u16>)>
where
    S: AsyncRead + AsyncWrite + Unpin + Send,
    T: Store,
{
    let epoch = frame_epoch(first)?;
    if epoch > session.roster().epoch {
        return Err(EngineError::Unexpected);
    }
    let epoch_key = session.epoch_key(epoch).await?;
    let lan_key = purpose_key(&epoch_key, session.group(), epoch, Purpose::Lan);
    let hello = open_hello(first, &lan_key, 1)?;
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

    let finish = timeout(HELLO_WITHIN, socket.recv_binary())
        .await
        .map_err(|_| EngineError::TimedOut)??;
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
    pub senders: BTreeMap<String, Sender>,
    pub live: LiveSink,
}

impl Holder {
    pub fn of<T: Store>(store: HeldStore, session: &Session<'_, T>, live: LiveSink) -> Self {
        Self {
            store,
            group: *session.group(),
            senders: session.senders().clone(),
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
            Request::Roster { after } => (
                Response {
                    ok: true,
                    entries: Some(self.store.candidates_after(after).await?),
                    ..Response::default()
                },
                Vec::new(),
            ),
            Request::Key { epoch, kc, name } => match self.store.key(epoch, &kc, &name).await? {
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
                    verify_logged(bytes, &self.group, &self.senders, &did, seq).is_ok()
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
        timeout(ASK_WITHIN, answer)
            .await
            .map_err(|_| EngineError::TimedOut)?
            .map_err(|_| EngineError::LanUnreachable)?
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

    pub async fn roster(&self, after: i64) -> Result<Vec<Entry>> {
        let (response, _) = self.ask(Request::Roster { after }).await?;
        response.entries.ok_or(EngineError::Unexpected)
    }

    pub async fn key(&self, epoch: u32, kc: &str, name: &str) -> Result<Option<Vec<u8>>> {
        self.bytes(Request::Key {
            epoch,
            kc: kc.to_owned(),
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
    use std::cell::RefCell;
    use std::sync::LazyLock;

    use proptest::prelude::*;
    use proptest::test_runner::TestRunner;
    use tokio::io::{DuplexStream, duplex};
    use tokio_tungstenite::WebSocketStream;
    use tokio_tungstenite::tungstenite::protocol::Role;

    use super::*;
    use crate::sync2::fuzz::{json, mutations};

    const LAN_KEY: [u8; 32] = [3; 32];

    /// A frame sealed by one side of a session, and the other side that opens it.
    fn sealed_frame() -> (Vec<u8>, Framed<DuplexStream>) {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (a, b) = duplex(1 << 16);
            let (a, b) = tokio::join!(
                WebSocketStream::from_raw_socket(a, Role::Client, None),
                WebSocketStream::from_raw_socket(b, Role::Server, None),
            );
            let framed = |socket, send_key: [u8; 32], receive_key: [u8; 32]| Framed {
                socket: WsChannel::new(socket),
                send_key: send_key.to_vec(),
                receive_key: receive_key.to_vec(),
                sent: 0,
                received: 0,
            };
            let (mut sender, mut receiver) =
                (framed(a, [1; 32], [2; 32]), framed(b, [2; 32], [1; 32]));
            sender.send(br#"{"id":0,"op":"live"}"#).await.unwrap();
            (receiver.socket.recv_binary().await.unwrap(), receiver)
        })
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_the_peer_never_answers_ends() {
        let (a, _silent) = duplex(1 << 16);
        let framed = Framed {
            socket: WsChannel::new(WebSocketStream::from_raw_socket(a, Role::Client, None).await),
            send_key: vec![1; 32],
            receive_key: vec![2; 32],
            sent: 0,
            received: 0,
        };
        let pool = sqlx::SqlitePool::connect_lazy("sqlite::memory:").unwrap();
        let holder = Holder {
            store: HeldStore::new(pool),
            group: [0; 16],
            senders: BTreeMap::new(),
            live: Arc::new(|_| {}),
        };
        let link = Link::spawn(framed, holder);
        assert!(matches!(link.roster(-1).await, Err(EngineError::TimedOut)));
    }

    #[test]
    fn any_change_to_a_session_frame_is_refused() {
        let (frame, receiver) = sealed_frame();
        let receiver = RefCell::new(receiver);
        let frames = prop_oneof![
            mutations(frame.clone()),
            prop::collection::vec(any::<u8>(), 0..256)
        ];
        TestRunner::default()
            .run(&frames, |changed| {
                prop_assert!(receiver.borrow_mut().open(&changed).is_err());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            receiver.borrow_mut().open(&frame).unwrap(),
            br#"{"id":0,"op":"live"}"#
        );
    }

    static HELLO: LazyLock<Vec<u8>> =
        LazyLock::new(|| hello_frame(4, &LAN_KEY, 1, &json!({ "did": "ab", "n": "cd" })).unwrap());

    proptest! {
        /// The epoch in front of a hello picks the key; the box is what must not change.
        #[test]
        fn any_change_to_a_hello_box_is_refused(changed in mutations(HELLO.clone())) {
            prop_assert!(open_hello(&changed, &LAN_KEY, 1).is_err() || changed[4..] == HELLO[4..]);
        }

        #[test]
        fn arbitrary_hellos_are_refused(
            frame in prop::collection::vec(any::<u8>(), 0..256),
            message: u8,
        ) {
            prop_assert!(open_hello(&frame, &LAN_KEY, message).is_err());
            let epoch = frame.first_chunk().map(|e| u32::from_be_bytes(*e));
            prop_assert_eq!(frame_epoch(&frame).ok(), epoch);
        }

        #[test]
        fn hello_fields_are_read_only_at_their_length(body in json(), name: String, did: String) {
            let expected = body[&name]
                .as_str()
                .and_then(|v| URL_SAFE_NO_PAD.decode(v).ok())
                .filter(|b| b.len() == 32);
            prop_assert_eq!(field::<32>(&body, &name).ok().map(Vec::from), expected);
            let expected = hex::decode(&did).ok().filter(|b| b.len() == 16);
            prop_assert_eq!(did_bytes(&did).ok().map(Vec::from), expected);
        }

        #[test]
        fn frame_contents_round_trip(
            header: BTreeMap<String, String>,
            bytes in prop::collection::vec(any::<u8>(), 0..64),
        ) {
            let content = frame_content(&header, &bytes);
            let (read, rest) = split_content(&content).unwrap();
            prop_assert_eq!((read, rest), (json!(header), bytes.as_slice()));
        }

        #[test]
        fn arbitrary_requests_are_read_without_panicking(
            content in prop::collection::vec(any::<u8>(), 0..256),
            header in json(),
        ) {
            let _ = split_content(&content);
            let _ = serde_json::from_value::<Request>(header.clone());
            let _ = serde_json::from_value::<Response>(header);
        }
    }

    #[tokio::test]
    async fn a_frame_whose_payload_inflates_past_the_limit_is_refused() {
        let key = [1; 32];
        let (near, _far) = tokio::io::duplex(64);
        let mut framed = Framed {
            socket: WsChannel::new(
                WebSocketStream::from_raw_socket(near, Role::Client, None).await,
            ),
            send_key: key.to_vec(),
            receive_key: key.to_vec(),
            sent: 0,
            received: 0,
        };
        let frame = |len| {
            let payload = encode_payload(&vec![0; len]).unwrap();
            [
                &0u64.to_be_bytes()[..],
                &seal(&key, &lan_frame_aad(0), &payload),
            ]
            .concat()
        };
        assert!(framed.open(&frame(MAX_CONTENT + 1)).is_err());
        assert_eq!(framed.open(&frame(MAX_CONTENT)).unwrap().len(), MAX_CONTENT);
    }

    /// Both ends of a session over sockets with the LAN limits.
    async fn session_pair() -> (Framed<DuplexStream>, Framed<DuplexStream>) {
        let (a, b) = duplex(1 << 16);
        let (a, b) = tokio::join!(
            WebSocketStream::from_raw_socket(a, Role::Client, Some(lan_socket_config())),
            WebSocketStream::from_raw_socket(b, Role::Server, Some(lan_socket_config())),
        );
        let framed = |socket, send_key: [u8; 32], receive_key: [u8; 32]| Framed {
            socket: WsChannel::new(socket),
            send_key: send_key.to_vec(),
            receive_key: receive_key.to_vec(),
            sent: 0,
            received: 0,
        };
        (framed(a, [1; 32], [2; 32]), framed(b, [2; 32], [1; 32]))
    }

    #[tokio::test]
    async fn a_get_answer_with_a_whole_object_crosses_a_session() {
        let (mut sender, mut receiver) = session_pair().await;
        let object: Vec<u8> = (0..MAX_OBJECT_SIZE / 32)
            .flat_map(|_| random_bytes::<32>())
            .collect();
        let answer = frame_content(&json!({ "re": 0, "ok": true }), &object);
        let receiving =
            tokio::time::timeout(Duration::from_secs(30), receiver.socket.recv_binary());
        let (sent, frame) = tokio::join!(sender.send(&answer), receiving);
        sent.unwrap();
        let content = receiver.open(&frame.unwrap().unwrap()).unwrap();
        let (header, bytes) = split_content(&content).unwrap();
        assert_eq!(header, json!({ "re": 0, "ok": true }));
        assert_eq!(bytes, object.as_slice());
    }

    #[tokio::test]
    async fn content_past_an_object_and_its_header_is_not_sent() {
        let (mut sender, _receiver) = session_pair().await;
        assert!(sender.send(&vec![0; MAX_CONTENT + 1]).await.is_err());
    }

    #[test]
    fn a_listing_request_naming_a_seq_above_2_53_is_refused() {
        let list = |seq: u64| {
            serde_json::from_str::<Request>(&format!(r#"{{"op":"list","vv":{{"a":{seq}}}}}"#))
        };
        assert!(list((1 << 53) - 1).is_ok());
        assert!(list(1 << 53).is_err());
    }

    #[test]
    fn a_peer_entry_that_does_not_parse_is_left_out() {
        let entry = |v: u8| {
            json!({"group": "00".repeat(16), "op": "rename", "prev": "00".repeat(32), "seq": 1,
                "signer": "11".repeat(16), "sigs": {}, "v": v})
        };
        let response =
            json!({"entries": [entry(2), {"seq": "one"}, entry(3)], "ok": true, "re": 0});
        let response: Response = serde_json::from_value(response).unwrap();
        let entries = response.entries.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].v, 2);
    }

    #[test]
    fn headers_are_canonical_json_lines() {
        let roster = request_header(&Request::Roster { after: -1 }, 0);
        assert_eq!(
            frame_content(&roster, &[]),
            br#"{"after":-1,"id":0,"op":"roster"}"#
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
