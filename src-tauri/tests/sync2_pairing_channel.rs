//! The clear start of pairing (spec/protocol.md, Channel): each side is bound to its key before it
//! sees the other's, and a code reveals its key once.

mod sync2_common;

use std::time::Duration;

use flow_desktop_lib::sync2::codes::{Offer, StoreLocation, new_offer, read_code};
use flow_desktop_lib::sync2::curve::agreement_public_key;
use flow_desktop_lib::sync2::engine::{EngineError, Session};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::linking::{DeviceMeta, add_device, join};
use flow_desktop_lib::sync2::mailbox::Mailbox;
use flow_desktop_lib::sync2::pairing::{pairing_commit, pairing_proof, pairing_slot};
use flow_desktop_lib::sync2::paths::pair_message_name;
use flow_desktop_lib::sync2::pipe::listen_on;
use flow_desktop_lib::sync2::sealed::random_bytes;
use futures_util::{SinkExt, StreamExt};
use sync2_common::{MemoryStore, device_pool, empty_pool, group, head, memory_welcome};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn meta() -> DeviceMeta {
    DeviceMeta {
        app: "app-new".into(),
        name: "New desktop".into(),
        platform: "linux".into(),
    }
}

async fn lan_offer() -> Offer {
    new_offer(
        Some(StoreLocation::server("memory")),
        "Desktop A",
        Some(listen_on(vec!["127.0.0.1".into()]).await.unwrap()),
    )
}

fn mailbox_offer() -> Offer {
    new_offer(Some(StoreLocation::server("memory")), "Desktop A", None)
}

fn slot(offer: &Offer) -> String {
    hex::encode(pairing_slot(&offer.token))
}

fn first_message(token: &[u8; 16], key: &[u8; 32]) -> Vec<u8> {
    [&key[..], &pairing_proof(token, key)[..]].concat()
}

fn url(offer: &Offer) -> String {
    let address = &offer.listening.as_ref().unwrap().addresses[0];
    format!("ws://{}:{}/flow-sync/2/pair", address.a, address.p)
}

async fn say(socket: &mut Socket, bytes: Vec<u8>) {
    socket.send(Message::Binary(bytes.into())).await.unwrap();
}

/// The next binary frame, or `None` once the connection ends without one.
async fn frame(socket: &mut Socket) -> Option<Vec<u8>> {
    while let Some(Ok(message)) = socket.next().await {
        if let Message::Binary(bytes) = message {
            return Some(bytes.to_vec());
        }
    }
    None
}

async fn file(store: &&MemoryStore, slot: &str, direction: char, seq: u64) -> Option<Vec<u8>> {
    let name = pair_message_name(direction, seq);
    store.get_message(slot, &name).await.unwrap()
}

/// Polls until the mailbox has the file. Waiting has an end, so a missing file fails the test.
async fn wait_for(store: &&MemoryStore, slot: &str, direction: char, seq: u64) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(bytes) = file(store, slot, direction, seq).await {
                return bytes;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a_shower_key_that_does_not_match_the_code_stops_the_scanner() {
    let g = group().await;
    let store = &g.store;
    let offer = mailbox_offer();
    let code = read_code(&offer.qr).unwrap();
    let slot = slot(&offer);
    store.open_slot(&slot).await.unwrap();
    let other = agreement_public_key(&random_bytes());
    let name = pair_message_name('a', 0);
    store
        .put_message(&slot, &name, other.to_vec())
        .await
        .unwrap();

    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool = empty_pool().await;
    let shown = |_: String| async { panic!("no digits before the key is checked") };
    let joined = join(&pool, &store, &code, &newcomer, meta(), shown).await;

    assert!(matches!(joined, Err(EngineError::Declined)));
    assert_eq!(file(&store, &slot, 'b', 0).await.unwrap().len(), 48);
    assert!(file(&store, &slot, 'b', 1).await.is_none());
}

#[tokio::test]
async fn a_second_scanner_on_the_lan_gets_nothing_after_a_reveal() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let offer = lan_offer().await;
    let (token, public, url) = (offer.token, offer.public, url(&offer));
    let scanners = async {
        let (mut first, _) = connect_async(&url).await.unwrap();
        say(&mut first, first_message(&token, &[1; 32])).await;
        assert_eq!(frame(&mut first).await.unwrap(), public);
        // The listener has gone, so a late scanner can't connect, or connects to nothing.
        if let Ok((mut second, _)) = connect_async(&url).await {
            say(&mut second, first_message(&token, &[2; 32])).await;
            assert_eq!(frame(&mut second).await, None);
        }
        say(&mut first, vec![0; 64]).await;
    };
    let (added, ()) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanners,
    );
    assert!(added.is_err());
}

#[tokio::test]
async fn a_second_scanner_in_the_mailbox_gets_nothing_after_a_reveal() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = mailbox_offer();
    let (token, public, slot) = (offer.token, offer.public, slot(&offer));
    let scanner = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let name = pair_message_name('b', 0);
        let first = first_message(&token, &[1; 32]);
        store.put_message(&slot, &name, first).await.unwrap();
        let revealed = wait_for(&store, &slot, 'a', 0).await;
        // A box that doesn't open ends the offer.
        let name = pair_message_name('b', 1);
        store.put_message(&slot, &name, vec![0; 64]).await.unwrap();
        revealed
    };
    let (added, revealed) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanner,
    );
    assert!(added.is_err());
    assert_eq!(revealed, public);
    assert!(file(&store, &slot, 'a', 1).await.is_none());
}

#[tokio::test]
async fn a_reveal_over_the_lan_leaves_the_mailbox_unanswered() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = lan_offer().await;
    let (token, public, url, slot) = (offer.token, offer.public, url(&offer), slot(&offer));
    let scanners = async {
        let (mut lan, _) = connect_async(&url).await.unwrap();
        say(&mut lan, first_message(&token, &[1; 32])).await;
        assert_eq!(frame(&mut lan).await.unwrap(), public);
        let name = pair_message_name('b', 0);
        let second = first_message(&token, &[2; 32]);
        store.put_message(&slot, &name, second).await.unwrap();
        tokio::time::sleep(Duration::from_secs(3)).await;
        let answered = file(&store, &slot, 'a', 0).await;
        say(&mut lan, vec![0; 64]).await;
        answered
    };
    let (added, answered) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanners,
    );
    assert!(added.is_err());
    assert_eq!(answered, None);
}

#[tokio::test]
async fn a_reveal_in_the_mailbox_leaves_the_lan_unanswered() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = lan_offer().await;
    let (token, public, url, slot) = (offer.token, offer.public, url(&offer), slot(&offer));
    let scanners = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let name = pair_message_name('b', 0);
        let first = first_message(&token, &[1; 32]);
        store.put_message(&slot, &name, first).await.unwrap();
        assert_eq!(wait_for(&store, &slot, 'a', 0).await, public);
        if let Ok((mut lan, _)) = connect_async(&url).await {
            say(&mut lan, first_message(&token, &[2; 32])).await;
            assert_eq!(frame(&mut lan).await, None);
        }
        let name = pair_message_name('b', 1);
        store.put_message(&slot, &name, vec![0; 64]).await.unwrap();
    };
    let (added, ()) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanners,
    );
    assert!(added.is_err());
}

#[tokio::test]
async fn a_bad_proof_gets_no_reveal_and_the_real_scanner_still_pairs() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = lan_offer().await;
    let code = read_code(&offer.qr).unwrap();
    let url = url(&offer);
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let scanner = async {
        let (mut stranger, _) = connect_async(&url).await.unwrap();
        say(&mut stranger, first_message(&[9; 16], &[1; 32])).await;
        assert_eq!(frame(&mut stranger).await, None);
        join(&pool_n, &store, &code, &newcomer, meta(), |_| async {
            true
        })
        .await
    };
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanner,
    );
    joined.unwrap();
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
}

#[tokio::test]
async fn a_bad_proof_in_the_mailbox_leaves_the_lan_open() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = lan_offer().await;
    let code = read_code(&offer.qr).unwrap();
    let slot = slot(&offer);
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let scanner = async {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let name = pair_message_name('b', 0);
        let bad = first_message(&[9; 16], &[1; 32]);
        store.put_message(&slot, &name, bad).await.unwrap();
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(file(&store, &slot, 'a', 0).await.is_none());
        join(&pool_n, &store, &code, &newcomer, meta(), |_| async {
            true
        })
        .await
    };
    let (added, joined) = tokio::join!(
        add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
        scanner,
    );
    joined.unwrap();
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
}

#[tokio::test]
async fn a_silent_connection_does_not_hold_up_the_real_scanner() {
    let g = group().await;
    let pool_a = device_pool(&g).await;
    let session = Session::open(&pool_a, &g.store, &g.a).await.unwrap();
    let store = &g.store;
    let offer = lan_offer().await;
    let code = read_code(&offer.qr).unwrap();
    let address = offer.listening.as_ref().unwrap().addresses[0].clone();
    let newcomer = member_secrets(random_bytes(), random_bytes());
    let pool_n = empty_pool().await;
    let silent = TcpStream::connect((address.a.as_str(), address.p))
        .await
        .unwrap();
    let scanner = join(&pool_n, &store, &code, &newcomer, meta(), |_| async {
        true
    });
    let (added, joined) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(
            add_device(&session, offer, &g.a, memory_welcome(), |_| async { true }),
            scanner,
        )
    })
    .await
    .unwrap();
    joined.unwrap();
    assert_eq!(added.unwrap().0, hex::encode(newcomer.did));
    assert!(
        head(&g.store)
            .members
            .contains_key(&hex::encode(newcomer.did))
    );
    drop(silent);
}

#[test]
fn a_code_with_the_key_in_it_is_refused() {
    let offer = mailbox_offer();
    let c = base64_of(&pairing_commit(&offer.public));
    let e = base64_of(&offer.public);
    assert!(read_code(&offer.qr).is_ok());
    let with_key = offer
        .qr
        .replace(&format!(r#""c":"{c}""#), &format!(r#""e":"{e}""#));
    assert!(matches!(read_code(&with_key), Err(EngineError::Unexpected)));
}

fn base64_of(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
