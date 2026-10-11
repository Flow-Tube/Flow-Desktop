//! Cross-implementation protocol tests: the desktop drivers against a scripted peer that follows
//! Flow for Android's frame order (`SyncProtocol.kt`) rather than the desktop's own. The other
//! protocol suites pair the desktop with itself, which is how the SELECTION deadlock, the chunk
//! misrouting and the unknown-collection failure all shipped unnoticed.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{WebSocketStream, accept_async, connect_async};

use flow_desktop_lib::sync::canonical::Collection::{self, Likes, WatchHistory};
use flow_desktop_lib::sync::codec::{decode_message, encode_chunk, encode_message, sha256_hex};
use flow_desktop_lib::sync::crypto::{
    Role, SessionCipher, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::error::SyncError;
use flow_desktop_lib::sync::frames::{
    ApplyResultEntry, ApplyResultFrame, CapabilitiesFrame, Capability, ChunkHeader, FrameType,
    HelloFrame, Platform,
};
use flow_desktop_lib::sync::protocol::{
    ApplyOutput, ClientOutcome, HostOutcome, OutgoingCollection, StagedCollection, run_receiver,
    run_sender,
};
use flow_desktop_lib::sync::transport;

const WH_NDJSON: &str = "{\"videoId\":\"a\"}\n{\"videoId\":\"b\"}";
const LIKES_NDJSON: &str = "{\"id\":\"a\",\"state\":\"liked\"}";
const TEST_DEADLINE: Duration = Duration::from_secs(20);

/// One end of a session driven frame by frame, the way the Android client does it.
struct ScriptedPeer<S> {
    ws: WebSocketStream<S>,
    cipher: SessionCipher,
    send_seq: u64,
    recv_seq: u64,
}

impl<S: AsyncRead + AsyncWrite + Unpin> ScriptedPeer<S> {
    async fn send(&mut self, ft: FrameType, plaintext: &[u8]) {
        let wire = encode_message(&self.cipher, ft.to_u8(), self.send_seq, plaintext).unwrap();
        self.send_seq += 1;
        self.ws.send(Message::Binary(wire.into())).await.unwrap();
    }

    async fn send_json(&mut self, ft: FrameType, value: Value) {
        self.send(ft, &serde_json::to_vec(&value).unwrap()).await;
    }

    async fn send_chunk(&mut self, collection: &str, ndjson: &str) {
        let header = ChunkHeader {
            collection: Some(collection.to_string()),
            seq: 0,
            last: true,
        };
        self.send(FrameType::Chunk, &encode_chunk(&header, ndjson.as_bytes()))
            .await;
    }

    async fn recv(&mut self) -> (FrameType, Vec<u8>) {
        loop {
            match self.ws.next().await.expect("peer closed").unwrap() {
                Message::Binary(wire) => {
                    let (ft, seq, plaintext) = decode_message(&self.cipher, &wire).unwrap();
                    assert_eq!(seq, self.recv_seq, "frames arrive in sequence");
                    self.recv_seq += 1;
                    return (FrameType::from_u8(ft).unwrap(), plaintext);
                }
                Message::Ping(p) => self.ws.send(Message::Pong(p)).await.unwrap(),
                _ => {}
            }
        }
    }

    async fn expect(&mut self, want: FrameType) -> Value {
        let (ft, plaintext) = self.recv().await;
        assert_eq!(ft, want, "frame order");
        serde_json::from_slice(&plaintext).unwrap_or(Value::Null)
    }
}

fn hello(id: &str) -> HelloFrame {
    HelloFrame {
        device_id: id.into(),
        device_name: id.into(),
        platform: Platform::Desktop,
        app_version: "0.1.0".into(),
        protocol: 1,
    }
}

fn android_hello(id: &str) -> Value {
    json!({"deviceId": id, "deviceName": "Pixel 8", "platform": "android", "appVersion": "2.3.0", "protocol": 1})
}

fn caps(collections: &[Collection]) -> CapabilitiesFrame {
    CapabilitiesFrame {
        collections: collections
            .iter()
            .map(|c| {
                (
                    c.key().to_string(),
                    Capability {
                        schema: 1,
                        produce: true,
                        consume: true,
                    },
                )
            })
            .collect(),
    }
}

/// Android advertises `notes` and a newer brain schema; the desktop must not choke on either.
fn android_caps() -> Value {
    json!({"collections": {
        "watch_history": {"schema": 1, "produce": true, "consume": true},
        "likes": {"schema": 1, "produce": true, "consume": true},
        "flow_neuro_brain": {"schema": 13, "produce": true, "consume": true},
        "notes": {"schema": 1, "produce": true, "consume": true}
    }})
}

fn manifest_entry(ndjson: &str) -> Value {
    let records = ndjson.split('\n').filter(|l| !l.is_empty()).count();
    json!({"records": records, "bytes": ndjson.len(), "hash": sha256_hex(ndjson.as_bytes())})
}

async fn stage_only(
    _peer: HelloFrame,
    staged: Vec<StagedCollection>,
) -> ApplyOutput<Vec<StagedCollection>> {
    let mut frame = ApplyResultFrame::default();
    for c in &staged {
        frame.collections.insert(
            c.collection.key().to_string(),
            ApplyResultEntry {
                added: c.record_count,
                ..ApplyResultEntry::default()
            },
        );
    }
    Ok((frame, staged))
}

async fn loopback() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

/// An Android phone shows its "send" code and the desktop scans it to receive. The phone hosts, so
/// it reads SELECTION before sending its own (the old desktop also read first: both waited
/// forever), offers `notes`, and streams in its own order rather than sorted.
#[tokio::test]
async fn desktop_receiver_completes_against_an_android_host_sender() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = loopback().await;

    let phone_master = master.clone();
    let phone = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut phone = ScriptedPeer {
            ws: accept_async(tcp).await.unwrap(),
            cipher: SessionCipher::new(&phone_master, sid, Role::Host),
            send_seq: 0,
            recv_seq: 0,
        };
        phone.expect(FrameType::Hello).await;
        let mut ack = android_hello("phone");
        ack["sasConfirmRequired"] = json!(true);
        phone.send_json(FrameType::HelloAck, ack).await;
        phone.expect(FrameType::Capabilities).await;
        phone
            .send_json(FrameType::Capabilities, android_caps())
            .await;
        let their_selection = phone.expect(FrameType::Selection).await;
        assert!(their_selection["accept"].as_array().unwrap().len() >= 2);
        phone
            .send_json(
                FrameType::Selection,
                json!({"send": ["watch_history", "notes", "likes"], "accept": []}),
            )
            .await;
        phone
            .send_json(
                FrameType::Manifest,
                json!({"collections": {
                    "watch_history": manifest_entry(WH_NDJSON),
                    "likes": manifest_entry(LIKES_NDJSON)
                }}),
            )
            .await;
        assert_eq!(phone.expect(FrameType::Consent).await["accepted"], true);
        // Insertion order, not sorted: watch_history before likes.
        for (name, ndjson) in [("watch_history", WH_NDJSON), ("likes", LIKES_NDJSON)] {
            phone.send_chunk(name, ndjson).await;
            assert_eq!(phone.expect(FrameType::ChunkAck).await["collection"], name);
            phone
                .send_json(
                    FrameType::Complete,
                    json!({"collection": name, "recordsSent": 1, "hash": sha256_hex(ndjson.as_bytes())}),
                )
                .await;
        }
        phone.expect(FrameType::ApplyResult).await
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let outcome = tokio::time::timeout(
        TEST_DEADLINE,
        run_receiver(
            ch,
            SessionCipher::new(&master, sid, Role::Client),
            hello("desktop"),
            caps(&[WatchHistory, Likes]),
            |_, _| async { true },
            stage_only,
        ),
    )
    .await
    .expect("the session must not deadlock")
    .unwrap();

    let ClientOutcome::Completed(received) = outcome else {
        panic!("declined")
    };
    let wh = received
        .applied
        .iter()
        .find(|c| c.collection == WatchHistory)
        .unwrap();
    assert_eq!(
        wh.ndjson,
        WH_NDJSON.as_bytes(),
        "routed by name, not by position"
    );
    let lk = received
        .applied
        .iter()
        .find(|c| c.collection == Likes)
        .unwrap();
    assert_eq!(lk.ndjson, LIKES_NDJSON.as_bytes());

    let result = phone.await.unwrap();
    assert_eq!(result["collections"]["watch_history"]["added"], 2);
    assert_eq!(result["collections"]["likes"]["added"], 1);
}

/// An Android phone shows its "receive" code and the desktop scans it to send. The phone's
/// SELECTION accept list names `notes`, which the desktop doesn't know.
#[tokio::test]
async fn desktop_sender_completes_against_an_android_receiver_that_accepts_notes() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = loopback().await;

    let desktop_master = master.clone();
    let desktop = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        run_sender(
            ch,
            SessionCipher::new(&desktop_master, sid, Role::Host),
            hello("desktop"),
            caps(&[WatchHistory, Likes]),
            vec![
                OutgoingCollection {
                    collection: WatchHistory,
                    ndjson: WH_NDJSON.as_bytes().to_vec(),
                },
                OutgoingCollection {
                    collection: Likes,
                    ndjson: LIKES_NDJSON.as_bytes().to_vec(),
                },
            ],
            vec![WatchHistory, Likes],
            true,
            || async {},
        )
        .await
    });

    let (ws, _) = connect_async(format!("ws://127.0.0.1:{port}/flow-sync"))
        .await
        .unwrap();
    let mut phone = ScriptedPeer {
        ws,
        cipher: SessionCipher::new(&master, sid, Role::Client),
        send_seq: 0,
        recv_seq: 0,
    };
    phone
        .send_json(FrameType::Hello, android_hello("phone"))
        .await;
    phone.expect(FrameType::HelloAck).await;
    phone
        .send_json(FrameType::Capabilities, android_caps())
        .await;
    phone.expect(FrameType::Capabilities).await;
    phone
        .send_json(
            FrameType::Selection,
            json!({"send": [], "accept": ["watch_history", "likes", "flow_neuro_brain", "notes"]}),
        )
        .await;
    phone.expect(FrameType::Selection).await;
    let manifest = phone.expect(FrameType::Manifest).await;
    phone
        .send_json(FrameType::Consent, json!({"accepted": true}))
        .await;
    // Android walks the manifest keys in order.
    let names: Vec<String> = manifest["collections"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    for name in &names {
        let (ft, _) = phone.recv().await;
        assert_eq!(ft, FrameType::Chunk);
        phone
            .send_json(FrameType::ChunkAck, json!({"collection": name, "seq": 0}))
            .await;
        assert_eq!(phone.expect(FrameType::Complete).await["collection"], *name);
    }
    phone
        .send_json(
            FrameType::ApplyResult,
            json!({"collections": {"likes": {"added": 1, "updated": 0, "skipped": 0, "tombstoned": 0}}}),
        )
        .await;

    let outcome = tokio::time::timeout(TEST_DEADLINE, desktop)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(outcome, HostOutcome::Completed(_)));
}

/// The phone pings on a 20 s timer and drops the link if no pong comes back, so the desktop must
/// keep answering while its user reads the merge prompt.
#[tokio::test]
async fn receiver_answers_pings_while_the_user_decides() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = loopback().await;

    let phone_master = master.clone();
    let phone = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut phone = ScriptedPeer {
            ws: accept_async(tcp).await.unwrap(),
            cipher: SessionCipher::new(&phone_master, sid, Role::Host),
            send_seq: 0,
            recv_seq: 0,
        };
        phone.expect(FrameType::Hello).await;
        phone
            .send_json(FrameType::HelloAck, android_hello("phone"))
            .await;
        phone.expect(FrameType::Capabilities).await;
        phone
            .send_json(FrameType::Capabilities, android_caps())
            .await;
        phone.expect(FrameType::Selection).await;
        phone
            .send_json(
                FrameType::Selection,
                json!({"send": ["watch_history"], "accept": []}),
            )
            .await;
        phone
            .send_json(
                FrameType::Manifest,
                json!({"collections": {"watch_history": manifest_entry(WH_NDJSON)}}),
            )
            .await;
        // The desktop is now parked on its consent prompt.
        phone
            .ws
            .send(Message::Ping(b"alive?".to_vec().into()))
            .await
            .unwrap();
        let pong = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Message::Pong(p) = phone.ws.next().await.unwrap().unwrap() {
                    return p;
                }
            }
        })
        .await
        .expect("pong while the consent prompt is open");
        assert_eq!(&pong[..], b"alive?");
        assert_eq!(phone.expect(FrameType::Consent).await["accepted"], false);
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let outcome = run_receiver(
        ch,
        SessionCipher::new(&master, sid, Role::Client),
        hello("desktop"),
        caps(&[WatchHistory]),
        |_, _| async {
            tokio::time::sleep(Duration::from_secs(3)).await;
            false
        },
        stage_only,
    )
    .await
    .unwrap();
    assert!(matches!(outcome, ClientOutcome::Declined));
    phone.await.unwrap();
}

/// A receiver whose save fails must tell the sender instead of reporting success.
#[tokio::test]
async fn an_apply_failure_reaches_the_sender_as_an_error() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = loopback().await;

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        run_sender(
            ch,
            SessionCipher::new(&host_master, sid, Role::Host),
            hello("host"),
            caps(&[WatchHistory]),
            vec![OutgoingCollection {
                collection: WatchHistory,
                ndjson: WH_NDJSON.as_bytes().to_vec(),
            }],
            vec![WatchHistory],
            false,
            || async {},
        )
        .await
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let received = run_receiver(
        ch,
        SessionCipher::new(&master, sid, Role::Client),
        hello("client"),
        caps(&[WatchHistory]),
        |_, _| async { true },
        |_, _| async { Err::<(ApplyResultFrame, ()), _>(SyncError::Apply("disk full".into())) },
    )
    .await;
    assert!(matches!(received, Err(SyncError::Apply(_))));

    let sent = host.await.unwrap();
    match sent {
        Err(SyncError::Peer { code, .. }) => assert_eq!(code, "apply_failed"),
        other => panic!("expected the peer's apply error, got {other:?}"),
    }
}

/// A chunk naming a collection the manifest never announced is refused, not silently misfiled.
#[tokio::test]
async fn a_chunk_outside_the_manifest_is_refused() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = loopback().await;

    let phone_master = master.clone();
    let phone = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut phone = ScriptedPeer {
            ws: accept_async(tcp).await.unwrap(),
            cipher: SessionCipher::new(&phone_master, sid, Role::Host),
            send_seq: 0,
            recv_seq: 0,
        };
        phone.expect(FrameType::Hello).await;
        phone
            .send_json(FrameType::HelloAck, android_hello("phone"))
            .await;
        phone.expect(FrameType::Capabilities).await;
        phone
            .send_json(FrameType::Capabilities, android_caps())
            .await;
        phone.expect(FrameType::Selection).await;
        phone
            .send_json(
                FrameType::Selection,
                json!({"send": ["watch_history"], "accept": []}),
            )
            .await;
        phone
            .send_json(
                FrameType::Manifest,
                json!({"collections": {"watch_history": manifest_entry(WH_NDJSON)}}),
            )
            .await;
        phone.expect(FrameType::Consent).await;
        phone.send_chunk("likes", LIKES_NDJSON).await;
        phone.expect(FrameType::Error).await
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let outcome = run_receiver(
        ch,
        SessionCipher::new(&master, sid, Role::Client),
        hello("desktop"),
        caps(&[WatchHistory, Likes]),
        |_, _| async { true },
        stage_only,
    )
    .await;
    assert!(matches!(outcome, Err(SyncError::Protocol(_))));
    assert_eq!(phone.await.unwrap()["code"], "protocol_error");
}
