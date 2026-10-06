//! isolation tests for Flow Local Sync: device identity / HLC, payload crypto, and the
//! QR handshake. These run in an integration test (the crate links Tauri's cdylib; in-crate unit
//! tests can't launch on Windows — see the note in `src/sync/canonical.rs`).

use flow_desktop_lib::sync::canonical::{Hlc, short_device_id};
use flow_desktop_lib::sync::crypto::{
    CryptoError, Role, SessionCipher, compute_sas, generate_master_secret, generate_session_id,
};
use flow_desktop_lib::sync::frames::FrameType;
use flow_desktop_lib::sync::identity::{HlcClock, default_device_name, new_device_id};
use flow_desktop_lib::sync::qr::{QrError, QrPayload};

// --------------------------------------------------------------------------------------------
// Identity & HLC
// --------------------------------------------------------------------------------------------

#[test]
fn device_ids_are_unique_and_name_is_friendly() {
    assert_ne!(new_device_id(), new_device_id());
    assert!(default_device_name().starts_with("Flow Desktop ("));
}

#[test]
fn hlc_tick_is_monotonic_and_breaks_ties_with_counter() {
    let mut clock = HlcClock::new("device-aaa");

    let a = clock.tick(1000);
    let b = clock.tick(1000); // same wall ms -> counter increments
    let c = clock.tick(1001); // wall advances -> counter resets, physical advances

    assert!(a < b, "ties at equal physical time advance the counter");
    assert_eq!(b.physical_ms, 1000);
    assert_eq!(b.counter, a.counter + 1);
    assert!(b < c);
    assert_eq!(c.physical_ms, 1001);
    assert_eq!(c.counter, 0, "counter resets when physical time advances");
    // the HLC carries the short device-id (hyphen-stripped, lowercased, 8 chars).
    assert_eq!(c.device_id, short_device_id("device-aaa"));
}

#[test]
fn hlc_uses_the_short_device_id_form() {
    // `<physicalMs>:<counter>:<deviceIdShort>`, deviceIdShort = first 8 hyphenless lowercase chars.
    let h = Hlc::new(1_700_000_000_000, 3, "75DBC20B-69FA-4DD7-9CD2-C169DCD17749");
    assert_eq!(h.device_id, "75dbc20b");
    assert_eq!(h.to_string(), "1700000000000:3:75dbc20b");
    // Round-trips, and parsing normalizes a non-conformant full id to the same short form.
    let parsed: Hlc = "1700000000000:3:75dbc20b".parse().unwrap();
    assert_eq!(parsed, h);
    assert_eq!(
        short_device_id("ab"),
        "ab",
        "ids shorter than 8 are kept as-is"
    );
}

#[test]
fn hlc_never_goes_backwards_when_wall_clock_regresses() {
    let mut clock = HlcClock::new("d1");
    let a = clock.tick(5000);
    let b = clock.tick(4000); // wall clock jumped backwards
    assert!(b > a, "HLC must not regress even if the wall clock does");
    assert_eq!(b.physical_ms, 5000);
}

#[test]
fn hlc_observe_merges_a_remote_ahead_stamp() {
    let mut clock = HlcClock::new("local");
    clock.tick(1000);
    let remote = Hlc::new(2000, 4, "remote");
    let merged = clock.observe(&remote, 1500);
    assert_eq!(merged.physical_ms, 2000, "adopts the highest physical time");
    assert_eq!(merged.counter, 5, "remote.counter + 1");
    assert_eq!(merged.device_id, "local");
}

// --------------------------------------------------------------------------------------------
// Crypto: seal / open across roles
// --------------------------------------------------------------------------------------------

fn host_client() -> (SessionCipher, SessionCipher) {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let host = SessionCipher::new(&master, sid, Role::Host);
    let client = SessionCipher::new(&master, sid, Role::Client);
    (host, client)
}

#[test]
fn seal_open_roundtrips_in_both_directions() {
    let (host, client) = host_client();
    let ft = FrameType::Chunk.to_u8();
    let msg = b"the quick brown fox \x00\x01\x02 jumps";

    let from_host = host.seal(ft, 1, msg).unwrap();
    assert_eq!(client.open(ft, 1, &from_host).unwrap(), msg);

    let from_client = client.seal(ft, 2, msg).unwrap();
    assert_eq!(host.open(ft, 2, &from_client).unwrap(), msg);
}

#[test]
fn directional_keys_are_independent() {
    // A frame sealed host->client must NOT open with the host's own receive key (client->host).
    let (host, _client) = host_client();
    let ft = FrameType::Manifest.to_u8();
    let wire = host.seal(ft, 1, b"secret").unwrap();
    let err = host.open(ft, 1, &wire).unwrap_err();
    assert!(matches!(err, CryptoError::AuthFailed));
}

#[test]
fn aad_binds_frame_type_and_sequence() {
    let (host, client) = host_client();
    let wire = host.seal(FrameType::Chunk.to_u8(), 7, b"payload").unwrap();

    // Wrong sequence number -> auth fails (replay/reorder defense).
    assert!(matches!(
        client.open(FrameType::Chunk.to_u8(), 8, &wire),
        Err(CryptoError::AuthFailed)
    ));
    // Wrong frame type -> auth fails.
    assert!(matches!(
        client.open(FrameType::Manifest.to_u8(), 7, &wire),
        Err(CryptoError::AuthFailed)
    ));
    // Correct AAD -> ok.
    assert_eq!(
        client.open(FrameType::Chunk.to_u8(), 7, &wire).unwrap(),
        b"payload"
    );
}

#[test]
fn tampering_with_ciphertext_is_detected() {
    let (host, client) = host_client();
    let ft = FrameType::Chunk.to_u8();
    let mut wire = host.seal(ft, 1, b"important data").unwrap();
    let last = wire.len() - 1;
    wire[last] ^= 0x01; // flip a bit in the tag
    assert!(matches!(
        client.open(ft, 1, &wire),
        Err(CryptoError::AuthFailed)
    ));
}

#[test]
fn nonces_are_unique_per_frame() {
    let (host, client) = host_client();
    let ft = FrameType::Chunk.to_u8();
    let a = host.seal(ft, 1, b"same plaintext").unwrap();
    let b = host.seal(ft, 1, b"same plaintext").unwrap();
    assert_ne!(&a[..12], &b[..12], "each frame gets a fresh random nonce");
    assert_ne!(a, b, "identical plaintext yields different ciphertext");
    // both still decrypt
    assert_eq!(client.open(ft, 1, &a).unwrap(), b"same plaintext");
    assert_eq!(client.open(ft, 1, &b).unwrap(), b"same plaintext");
}

#[test]
fn a_short_frame_is_rejected_cleanly() {
    let (_host, client) = host_client();
    let err = client
        .open(FrameType::Chunk.to_u8(), 1, &[0u8; 10])
        .unwrap_err();
    assert!(matches!(err, CryptoError::FrameTooShort(10, _)));
}

#[test]
fn wrong_master_secret_cannot_decrypt() {
    let sid = generate_session_id();
    let m1 = generate_master_secret();
    let m2 = generate_master_secret();
    let host = SessionCipher::new(&m1, sid, Role::Host);
    let impostor = SessionCipher::new(&m2, sid, Role::Client);
    let wire = host.seal(FrameType::Chunk.to_u8(), 1, b"x").unwrap();
    assert!(matches!(
        impostor.open(FrameType::Chunk.to_u8(), 1, &wire),
        Err(CryptoError::AuthFailed)
    ));
}

// --------------------------------------------------------------------------------------------
// SAS
// --------------------------------------------------------------------------------------------

#[test]
fn sas_is_deterministic_six_digits_and_agrees_across_devices() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let a = compute_sas(&master, &sid);
    let b = compute_sas(&master, &sid);
    assert_eq!(a, b, "SAS is deterministic");
    assert_eq!(a.len(), 6);
    assert!(a.chars().all(|c| c.is_ascii_digit()), "SAS is all digits");
}

// --------------------------------------------------------------------------------------------
// QR handshake (end-to-end)
// --------------------------------------------------------------------------------------------

#[test]
fn qr_payload_json_roundtrips() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let qr = QrPayload::new(
        &sid,
        &master,
        "192.168.1.42",
        49210,
        "Flow Desktop (Windows)",
        1_781_512_700,
    );
    let parsed = QrPayload::from_json(&qr.to_json()).unwrap();
    assert_eq!(parsed, qr);
    assert_eq!(parsed.ip, "192.168.1.42");
    assert_eq!(parsed.p, 49210);
}

#[test]
fn scanning_the_qr_reconstructs_keys_and_sas() {
    // Host side: fresh material + QR.
    let master = generate_master_secret();
    let sid = generate_session_id();
    let qr_json = QrPayload::new(
        &sid,
        &master,
        "10.0.0.5",
        5050,
        "Flow Desktop (Linux)",
        9_999_999_999,
    )
    .to_json();

    // Client side: parse the scanned QR and rebuild the session.
    let scanned = QrPayload::from_json(&qr_json).unwrap();
    let c_sid = scanned.session_id().unwrap();
    let c_master = scanned.master().unwrap();
    assert_eq!(c_sid, sid);
    assert_eq!(c_master.as_bytes(), master.as_bytes());

    let host = SessionCipher::new(&master, sid, Role::Host);
    let client = SessionCipher::new(&c_master, c_sid, Role::Client);

    // The two ends now share keys: host seals, client opens.
    let ft = FrameType::Hello.to_u8();
    let wire = host.seal(ft, 1, b"handshake hello").unwrap();
    assert_eq!(client.open(ft, 1, &wire).unwrap(), b"handshake hello");

    // ...and the SAS each computes independently agrees.
    assert_eq!(compute_sas(&master, &sid), compute_sas(&c_master, &c_sid));
}

#[test]
fn desktop_qr_carries_a_host_lease_and_never_expires_on_the_scanners_clock() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let qr = QrPayload::new(&sid, &master, "192.168.1.4", 1, "x", 1000);
    assert!(qr.to_json().contains(r#""lease":"host""#));
    // A scanner whose clock runs far ahead must still accept it: the host's listener decides.
    assert!(!qr.is_expired(1_000_000));
}

#[test]
fn leaseless_qr_expires_after_a_clock_skew_grace() {
    // An Android phone host: no lease, expiry is the phone's clock.
    let json = r#"{"v":1,"sid":"AAAAAAAAAAAAAAAAAAAAAA","k":"AAAA","ip":"192.168.1.20","p":4000,"d":"Pixel","exp":1000,"role":"sender"}"#;
    let qr = QrPayload::from_json(json).unwrap();
    assert!(
        !qr.is_expired(1000),
        "a PC clock a little ahead must not reject a live code"
    );
    assert!(!qr.is_expired(1599));
    assert!(qr.is_expired(1600));
}

#[test]
fn qr_only_accepts_local_network_addresses() {
    let base = |ip: &str| {
        format!(r#"{{"v":1,"sid":"AAAA","k":"AAAA","ip":"{ip}","p":4000,"d":"x","exp":1}}"#)
    };
    for ok in [
        "192.168.1.4",
        "10.0.0.2",
        "172.20.1.1",
        "169.254.3.4",
        "100.101.1.1",
        "127.0.0.1",
        "fd12::1",
    ] {
        assert!(
            QrPayload::from_json(&base(ok)).is_ok(),
            "{ok} should be accepted"
        );
    }
    for bad in [
        "8.8.8.8",
        "example.com",
        "192.168.1.4/evil",
        "attacker@192.168.1.4",
        "2001:db8::1",
        "",
    ] {
        assert!(
            matches!(QrPayload::from_json(&base(bad)), Err(QrError::Address(_))),
            "{bad} should be refused"
        );
    }
    // A public fallback address poisons the whole code.
    let with_bad_fallback = r#"{"v":1,"sid":"AAAA","k":"AAAA","ip":"192.168.1.4","p":4000,"d":"x","exp":1,"ips":["8.8.8.8"]}"#;
    assert!(matches!(
        QrPayload::from_json(with_bad_fallback),
        Err(QrError::Address(_))
    ));
}

#[test]
fn qr_fallback_addresses_are_dialled_after_the_primary() {
    let master = generate_master_secret();
    let sid = generate_session_id();
    let qr = QrPayload::new(&sid, &master, "192.168.1.4", 1, "x", 1000).with_fallback_ips([
        "192.168.1.4".to_string(),
        "10.0.0.7".to_string(),
        "10.0.0.7".to_string(),
    ]);
    let parsed = QrPayload::from_json(&qr.to_json()).unwrap();
    assert_eq!(parsed.dial_addresses(), vec!["192.168.1.4", "10.0.0.7"]);
}

#[test]
fn qr_rejects_wrong_version_and_bad_base64() {
    // Unsupported version.
    let bad_version = r#"{"v":2,"sid":"AAAA","k":"AAAA","ip":"192.168.1.4","p":1,"d":"x","exp":1}"#;
    assert!(matches!(
        QrPayload::from_json(bad_version),
        Err(QrError::UnsupportedVersion(2))
    ));

    // Valid JSON & version, but `sid` is not valid base64url for 16 bytes.
    let bad_sid = r#"{"v":1,"sid":"!!!!","k":"AAAA","ip":"192.168.1.4","p":1,"d":"x","exp":1}"#;
    let parsed = QrPayload::from_json(bad_sid).unwrap();
    assert!(parsed.session_id().is_err());
}
