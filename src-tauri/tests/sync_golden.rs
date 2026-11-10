//! golden vectors — the shared anti-drift gate between the desktop (Rust) and Android (Kotlin)
//! implementations. Each fixture under `tests/fixtures/flow-sync/` pins an input → expected-output
//! pair for one primitive (HKDF, SAS, AES-GCM seal/open, canonical JSON). Both repos check in the
//! SAME fixtures and assert equality; a divergence in either serializer/cipher fails CI here before
//! it can corrupt a live cross-platform sync. If you must change a primitive, bump the protocol
//! version  and regenerate the fixtures on BOTH sides.

use std::path::PathBuf;

use flow_desktop_lib::sync::canonical::to_canonical_json;
use flow_desktop_lib::sync::crypto::{
    MasterSecret, SessionId, compute_sas, derive_key_material_hex, open_with_key, seal_with_nonce,
};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/flow-sync")
        .join(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture {name}: {e}"))
}

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd-length hex");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
        .collect()
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("fixture missing string `{k}`"))
}

#[test]
fn hkdf_matches_the_golden_vector() {
    let f = fixture("hkdf.json");
    let master = MasterSecret::try_from_slice(&unhex(s(&f, "master_hex"))).unwrap();
    let sid = SessionId::try_from_slice(&unhex(s(&f, "session_id_hex"))).unwrap();
    let (prk, h2c, c2h) = derive_key_material_hex(&master, &sid);
    assert_eq!(prk, s(&f, "prk_hex"), "HKDF-Extract PRK drift");
    assert_eq!(h2c, s(&f, "k_h2c_hex"), "host->client key drift");
    assert_eq!(c2h, s(&f, "k_c2h_hex"), "client->host key drift");
}

#[test]
fn sas_matches_the_golden_vector() {
    let f = fixture("sas.json");
    let master = MasterSecret::try_from_slice(&unhex(s(&f, "master_hex"))).unwrap();
    let sid = SessionId::try_from_slice(&unhex(s(&f, "session_id_hex"))).unwrap();
    assert_eq!(compute_sas(&master, &sid), s(&f, "sas"));
}

#[test]
fn seal_open_matches_the_golden_vector() {
    let f = fixture("seal_open.json");
    let key: [u8; 32] = unhex(s(&f, "key_hex")).try_into().unwrap();
    let sid = SessionId::try_from_slice(&unhex(s(&f, "session_id_hex"))).unwrap();
    let nonce: [u8; 12] = unhex(s(&f, "nonce_hex")).try_into().unwrap();
    let frame_type = f.get("frame_type").and_then(Value::as_u64).unwrap() as u8;
    let seq = f.get("seq").and_then(Value::as_u64).unwrap();
    let plaintext = unhex(s(&f, "plaintext_hex"));

    // Seal reproduces the exact wire bytes (AAD + GCM layout locked).
    let wire = seal_with_nonce(&key, &sid, frame_type, seq, &nonce, &plaintext).unwrap();
    assert_eq!(hex(&wire), s(&f, "wire_hex"), "sealed wire bytes drift");

    // And the recorded wire opens back to the plaintext.
    let opened = open_with_key(&key, &sid, frame_type, seq, &unhex(s(&f, "wire_hex"))).unwrap();
    assert_eq!(opened, plaintext);

    // A bad AAD (wrong seq) must fail to open — proves the binding is real.
    assert!(open_with_key(&key, &sid, frame_type, seq + 1, &wire).is_err());
}

#[test]
fn canonical_json_matches_the_golden_vector() {
    let f = fixture("canonical_json.json");
    let input = f.get("input").expect("fixture has input");
    let out = String::from_utf8(to_canonical_json(input)).unwrap();
    assert_eq!(out, s(&f, "expected"), "canonical JSON key-ordering drift");
}

/// Android's `SyncSerialization.encodeNotes`: every field present, nulls included, keys sorted.
#[test]
fn a_note_matches_android_s_canonical_bytes() {
    let line = r#"{"channelAvatarUrl":null,"channelHandle":null,"channelId":"UCx","channelName":"A channel","deleted":false,"durationSeconds":754,"id":"video:abc123def45","kind":"Video","subscriberCountText":null,"targetId":"abc123def45","text":"12:34 the good part","thumbnailUrl":null,"title":"A video","updatedAt":1700000000000}"#;
    let note: flow_desktop_lib::sync::canonical::Note = serde_json::from_str(line).unwrap();
    assert_eq!(String::from_utf8(to_canonical_json(&note)).unwrap(), line);
}
