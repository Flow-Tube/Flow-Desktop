//! transport + protocol tests: a full `FLOW-SYNC/1` one-way session over a real loopback
//! WebSocket (host ⇄ client in-process), covering the happy path, capability filtering, and both
//! consent-denial paths.

use std::collections::BTreeMap;

use flow_desktop_lib::sync::canonical::Collection::{self, Likes, WatchHistory};
use flow_desktop_lib::sync::crypto::{
    Role, SessionCipher, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::frames::{CapabilitiesFrame, Capability, HelloFrame, Platform};
use flow_desktop_lib::sync::protocol::{
    ClientOutcome, HostOutcome, OutgoingCollection, run_client_sender, run_host_receiver,
    run_receiver, run_sender,
};
use flow_desktop_lib::sync::transport;

fn hello(id: &str, name: &str) -> HelloFrame {
    HelloFrame {
        device_id: id.into(),
        device_name: name.into(),
        platform: Platform::Desktop,
        app_version: "0.1.0".into(),
        protocol: 1,
    }
}

fn caps(entries: &[(Collection, bool, bool)]) -> CapabilitiesFrame {
    let mut collections = BTreeMap::new();
    for (c, produce, consume) in entries {
        collections.insert(
            c.key().to_string(),
            Capability {
                schema: 1,
                produce: *produce,
                consume: *consume,
            },
        );
    }
    CapabilitiesFrame { collections }
}

fn oc(c: Collection, data: &[u8]) -> OutgoingCollection {
    OutgoingCollection {
        collection: c,
        ndjson: data.to_vec(),
    }
}

const WH_NDJSON: &[u8] = b"{\"videoId\":\"a\",\"p\":0.5}\n{\"videoId\":\"b\",\"p\":1.0}";
const LIKES_NDJSON: &[u8] = b"{\"id\":\"a\",\"state\":\"liked\"}";

#[tokio::test]
async fn one_way_transfer_succeeds_for_all_selected_collections() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_sender(
            ch,
            cipher,
            hello("host-1", "Flow Desktop (Windows)"),
            caps(&[(WatchHistory, true, true), (Likes, true, true)]),
            vec![oc(WatchHistory, WH_NDJSON), oc(Likes, LIKES_NDJSON)],
            vec![WatchHistory, Likes],
            false,
            || async {},
        )
        .await
        .unwrap()
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let cipher = SessionCipher::new(&master, sid, Role::Client);
    let outcome = run_receiver(
        ch,
        cipher,
        hello("client-1", "Pixel 8"),
        caps(&[(WatchHistory, true, true), (Likes, true, true)]),
        |peer, manifest| async move {
            assert_eq!(peer.device_id, "host-1");
            assert_eq!(manifest.collections.len(), 2);
            true
        },
    )
    .await
    .unwrap();

    let host_outcome = host.await.unwrap();

    let payload = match outcome {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => panic!("receiver unexpectedly declined"),
    };
    assert_eq!(payload.peer.device_id, "host-1");
    assert_eq!(payload.collections.len(), 2);

    let wh = payload
        .collections
        .iter()
        .find(|c| c.collection == WatchHistory)
        .unwrap();
    assert_eq!(
        wh.ndjson, WH_NDJSON,
        "payload survives compression+encryption intact"
    );
    assert_eq!(wh.record_count, 2);

    let lk = payload
        .collections
        .iter()
        .find(|c| c.collection == Likes)
        .unwrap();
    assert_eq!(lk.ndjson, LIKES_NDJSON);
    assert_eq!(lk.record_count, 1);

    match host_outcome {
        HostOutcome::Completed(s) => {
            assert_eq!(s.peer.device_id, "client-1");
            assert_eq!(
                s.results.collections.len(),
                2,
                "one apply-result entry per collection"
            );
            assert_eq!(
                s.results.collections.values().map(|e| e.added).sum::<u64>(),
                3
            );
        }
        HostOutcome::Declined => panic!("sender unexpectedly declined"),
    }
}

/// Regression: the sender must stream in sorted key order whatever order the caller selects. We
/// route chunks by SELECTION order, Android by the sorted-BTreeMap MANIFEST — any other stream
/// order misroutes on one side (the "Field 'videoId' is required" desktop→mobile bug).
#[tokio::test]
async fn sender_streams_collections_in_sorted_key_order() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_sender(
            ch,
            cipher,
            hello("host-1", "Flow Desktop"),
            caps(&[(WatchHistory, true, true), (Likes, true, true)]),
            vec![oc(WatchHistory, WH_NDJSON), oc(Likes, LIKES_NDJSON)],
            vec![WatchHistory, Likes], // unsorted on purpose
            false,
            || async {},
        )
        .await
        .unwrap()
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let cipher = SessionCipher::new(&master, sid, Role::Client);
    let outcome = run_receiver(
        ch,
        cipher,
        hello("client-1", "Pixel 8"),
        caps(&[(WatchHistory, true, true), (Likes, true, true)]),
        |_, manifest| async move {
            // MANIFEST is a sorted BTreeMap — the order Android routes by.
            let keys: Vec<&str> = manifest.collections.keys().map(String::as_str).collect();
            assert_eq!(keys, ["likes", "watch_history"]);
            true
        },
    )
    .await
    .unwrap();

    let received = match outcome {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => panic!("receiver declined"),
    };

    // run_receiver stages in wire order (= SELECTION = stream); it must equal the sorted MANIFEST.
    let stream_order: Vec<&str> = received
        .collections
        .iter()
        .map(|c| c.collection.key())
        .collect();
    assert_eq!(
        stream_order,
        ["likes", "watch_history"],
        "stream order must match the sorted manifest so both receiver implementations agree"
    );

    // …and payloads landed under the right names.
    let wh = received
        .collections
        .iter()
        .find(|c| c.collection == WatchHistory)
        .unwrap();
    assert_eq!(wh.ndjson, WH_NDJSON);
    let lk = received
        .collections
        .iter()
        .find(|c| c.collection == Likes)
        .unwrap();
    assert_eq!(lk.ndjson, LIKES_NDJSON);

    assert!(matches!(host.await.unwrap(), HostOutcome::Completed(_)));
}

#[tokio::test]
async fn capability_negotiation_skips_collections_the_peer_cannot_consume() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_sender(
            ch,
            cipher,
            hello("host-1", "Host"),
            caps(&[(WatchHistory, true, true), (Likes, true, true)]),
            vec![oc(WatchHistory, WH_NDJSON), oc(Likes, LIKES_NDJSON)],
            vec![WatchHistory, Likes],
            false,
            || async {},
        )
        .await
        .unwrap()
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let cipher = SessionCipher::new(&master, sid, Role::Client);
    // Client can only consume watch_history -> likes must be filtered out of the selection.
    let outcome = run_receiver(
        ch,
        cipher,
        hello("client-1", "Phone"),
        caps(&[(WatchHistory, true, true), (Likes, true, false)]),
        |_, manifest| async move {
            assert_eq!(
                manifest.collections.len(),
                1,
                "only the consumable collection is offered"
            );
            true
        },
    )
    .await
    .unwrap();
    host.await.unwrap();

    let payload = match outcome {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => panic!("declined"),
    };
    assert_eq!(payload.collections.len(), 1);
    assert_eq!(payload.collections[0].collection, WatchHistory);
}

/// The camera-less-desktop direction: the **host receives** (it showed a `role:"receiver"` QR) and the
/// **client sends** (it scanned). Same data must arrive, proving the protocol is role-symmetric.
#[tokio::test]
async fn host_receives_while_client_sends() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    // Host = receiver.
    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_host_receiver(
            ch,
            cipher,
            hello("host-1", "Flow Desktop"),
            caps(&[(WatchHistory, true, true), (Likes, true, true)]),
            false,
            |peer, manifest| async move {
                assert_eq!(peer.device_id, "client-1");
                assert_eq!(manifest.collections.len(), 2);
                true
            },
        )
        .await
        .unwrap()
    });

    // Client = sender.
    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let cipher = SessionCipher::new(&master, sid, Role::Client);
    let send_outcome = run_client_sender(
        ch,
        cipher,
        hello("client-1", "Pixel 8"),
        caps(&[(WatchHistory, true, true), (Likes, true, true)]),
        vec![oc(WatchHistory, WH_NDJSON), oc(Likes, LIKES_NDJSON)],
        vec![WatchHistory, Likes],
        || async {},
    )
    .await
    .unwrap();

    let received = match host.await.unwrap() {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => panic!("host receiver declined"),
    };
    assert_eq!(received.peer.device_id, "client-1");
    assert_eq!(received.collections.len(), 2);
    let wh = received
        .collections
        .iter()
        .find(|c| c.collection == WatchHistory)
        .unwrap();
    assert_eq!(
        wh.ndjson, WH_NDJSON,
        "payload survives the reversed direction"
    );

    match send_outcome {
        HostOutcome::Completed(s) => assert_eq!(s.peer.device_id, "host-1"),
        HostOutcome::Declined => panic!("client sender declined"),
    }
}

#[tokio::test]
async fn receiver_decline_aborts_both_sides_cleanly() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    let host_master = master.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_sender(
            ch,
            cipher,
            hello("host-1", "Host"),
            caps(&[(WatchHistory, true, true)]),
            vec![oc(WatchHistory, WH_NDJSON)],
            vec![WatchHistory],
            false,
            || async {},
        )
        .await
        .unwrap()
    });

    let ch = transport::connect("127.0.0.1", port).await.unwrap();
    let cipher = SessionCipher::new(&master, sid, Role::Client);
    let outcome = run_receiver(
        ch,
        cipher,
        hello("client-1", "Phone"),
        caps(&[(WatchHistory, true, true)]),
        |_, _| async { false }, // user taps "Cancel" on the merge prompt
    )
    .await
    .unwrap();

    assert!(matches!(outcome, ClientOutcome::Declined));
    assert!(matches!(host.await.unwrap(), HostOutcome::Declined));
}
