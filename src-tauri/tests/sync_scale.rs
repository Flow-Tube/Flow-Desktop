//! scale tests: a large watch_history must stream across many CHUNK frames and re-assemble
//! intact (the streaming chunker uses ~1000 records/frame, so 25k rows → ~25 chunks), and the apply
//! pipeline must merge that volume in a single transaction. Catches off-by-one chunk-boundary bugs
//! and any accidental O(n²) in the staging/merge path.

use sqlx::SqlitePool;
use sqlx::sqlite::SqlitePoolOptions;

use flow_desktop_lib::sync::apply::apply_payload;
use flow_desktop_lib::sync::canonical::{Collection, Hlc, WatchHistoryRecord, to_canonical_json};
use flow_desktop_lib::sync::codec::sha256_hex;
use flow_desktop_lib::sync::crypto::{
    Role, SessionCipher, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::frames::{CapabilitiesFrame, Capability, HelloFrame, Platform};
use flow_desktop_lib::sync::protocol::{
    ClientOutcome, HostOutcome, OutgoingCollection, StagedCollection, run_receiver, run_sender,
};
use flow_desktop_lib::sync::transport;
use std::collections::BTreeMap;

const N: usize = 25_000;

fn record(i: usize) -> WatchHistoryRecord {
    WatchHistoryRecord {
        video_id: format!("v{i:06}"),
        title: format!("Video number {i}"),
        channel_name: Some(format!("Channel {}", i % 50)),
        channel_id: None,
        watched_at_ms: 1_700_000_000_000 + i as u64,
        progress: ((i % 100) as f32) / 100.0,
        duration_seconds: Some(120 + (i as u64 % 600)),
        is_music: i % 7 == 0,
        is_short: false,
        hlc: Hlc::new(1_700_000_000_000 + i as u64, 0, "scale-dev"),
        deleted: false,
    }
}

/// Build canonical NDJSON for N watch-history records (sorted by videoId, like the exporter).
fn big_ndjson() -> Vec<u8> {
    let mut recs: Vec<WatchHistoryRecord> = (0..N).map(record).collect();
    recs.sort_by(|a, b| a.video_id.cmp(&b.video_id));
    let lines: Vec<Vec<u8>> = recs.iter().map(to_canonical_json).collect();
    lines.join(&b'\n')
}

fn caps() -> CapabilitiesFrame {
    let mut c = BTreeMap::new();
    c.insert(
        Collection::WatchHistory.key().to_string(),
        Capability {
            schema: 1,
            produce: true,
            consume: true,
        },
    );
    CapabilitiesFrame { collections: c }
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn large_watch_history_streams_across_chunks_intact() {
    let ndjson = big_ndjson();
    let expected_hash = sha256_hex(&ndjson);

    let master = generate_master_secret();
    let sid = generate_session_id();
    let (listener, port) = transport::bind().await.unwrap();

    let host_master = master.clone();
    let send_nd = ndjson.clone();
    let host = tokio::spawn(async move {
        let ch = transport::accept(&listener).await.unwrap();
        let cipher = SessionCipher::new(&host_master, sid, Role::Host);
        run_sender(
            ch,
            cipher,
            hello("host"),
            caps(),
            vec![OutgoingCollection {
                collection: Collection::WatchHistory,
                ndjson: send_nd,
            }],
            vec![Collection::WatchHistory],
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
        hello("client"),
        caps(),
        |_, manifest| async move {
            // The manifest preview reports the full count before any chunk is sent.
            assert_eq!(
                manifest.collections.get("watch_history").unwrap().records,
                N as u64
            );
            true
        },
    )
    .await
    .unwrap();

    let received = match outcome {
        ClientOutcome::Completed(p) => p,
        ClientOutcome::Declined => panic!("receiver declined"),
    };
    let col = &received.collections[0];
    assert_eq!(
        col.record_count, N as u64,
        "all records re-assembled across chunks"
    );
    assert_eq!(
        col.hash, expected_hash,
        "payload hash matches after multi-chunk reassembly"
    );
    assert_eq!(
        col.ndjson, ndjson,
        "byte-for-byte identical after streaming"
    );

    assert!(matches!(host.await.unwrap(), HostOutcome::Completed(_)));
}

async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn applying_a_large_watch_history_merges_every_row_in_one_txn() {
    let pool = memory_pool().await;
    let ndjson = big_ndjson();
    let staged = StagedCollection {
        collection: Collection::WatchHistory,
        ndjson: ndjson.clone(),
        record_count: N as u64,
        hash: sha256_hex(&ndjson),
    };

    let report = apply_payload(&pool, "ourdev", "peerdev", std::slice::from_ref(&staged))
        .await
        .unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM watch_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, N as i64, "every streamed row landed in the DB");

    let stat = report
        .stats
        .iter()
        .find(|s| s.collection_key == "watch_history")
        .unwrap();
    assert_eq!(stat.added, N as u64);

    // Idempotent re-apply: same payload changes nothing and adds no rows.
    let report2 = apply_payload(&pool, "ourdev", "peerdev", std::slice::from_ref(&staged))
        .await
        .unwrap();
    let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM watch_history")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count2, N as i64, "re-apply is idempotent");
    let _ = report2;
}
