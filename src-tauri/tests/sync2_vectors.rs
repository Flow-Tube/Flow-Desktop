//! FLOW-SYNC/2 shared test vectors. The fixtures come unchanged from `Flow-Tube/flow-sync`
//! (`spec/vectors/`); the reference library, the server and both apps must all pass them.

use std::convert::Infallible;
use std::path::PathBuf;

use flow_desktop_lib::sync::canonical::to_canonical_json;
use flow_desktop_lib::sync2::blob::open_blob;
use flow_desktop_lib::sync2::curve::{agreement_public_key, is_valid_signing_key, verify};
use flow_desktop_lib::sync2::envelope::{
    ObjectType, StreamPosition, next_in_stream, next_live_counter, open_object, parse_object,
    verify_object,
};
use flow_desktop_lib::sync2::epoch::{
    Purpose, check_epoch_key, epoch_commitment, open_chain, purpose_key,
};
use flow_desktop_lib::sync2::kdf::{derive, labeled_hash};
use flow_desktop_lib::sync2::keys::member_secrets;
use flow_desktop_lib::sync2::lan::{
    LanRole, lan_frame_aad, lan_hello_aad, lan_session_keys, lan_tag, lan_transcript,
};
use flow_desktop_lib::sync2::pairing::{pairing_aad, pairing_keys, pairing_slot};
use flow_desktop_lib::sync2::payload::{decode_payload, padded_size};
use flow_desktop_lib::sync2::recovery::{recovery_keys, recovery_secret, recovery_words};
use flow_desktop_lib::sync2::sealed::{open, seal_with_salt};
use flow_desktop_lib::sync2::wrap::{unwrap_epoch_key, wrap_epoch_key_with_rng};
use flow_desktop_lib::sync2::{Error, Result};
use hpke::rand_core::{TryCryptoRng, TryRng};
use serde_json::Value;

fn load(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/flow-sync-2")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture exists"))
        .expect("fixture is JSON")
}

fn bytes(value: &Value) -> Vec<u8> {
    hex::decode(value.as_str().expect("hex string")).expect("valid hex")
}

fn array<const N: usize>(value: &Value) -> [u8; N] {
    bytes(value).try_into().expect("fixed-size field")
}

fn text(value: &Value) -> &str {
    value.as_str().expect("string")
}

fn number<T: TryFrom<u64>>(value: &Value) -> T {
    T::try_from(value.as_u64().expect("number"))
        .ok()
        .expect("in range")
}

fn assert_code<T: std::fmt::Debug>(result: Result<T>, code: &Value) {
    assert_eq!(result.expect_err("must be rejected").code(), text(code));
}

/// Feeds HPKE the vector's `ikmE`, so the ephemeral key and the wrap reproduce exactly.
struct FixedRng(Vec<u8>);

impl TryRng for FixedRng {
    type Error = Infallible;
    fn try_next_u32(&mut self) -> std::result::Result<u32, Infallible> {
        unreachable!("HPKE only asks for bytes")
    }
    fn try_next_u64(&mut self) -> std::result::Result<u64, Infallible> {
        unreachable!("HPKE only asks for bytes")
    }
    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> std::result::Result<(), Infallible> {
        let rest = self.0.split_off(dst.len());
        dst.copy_from_slice(&self.0);
        self.0 = rest;
        Ok(())
    }
}

impl TryCryptoRng for FixedRng {}

#[test]
fn canonical_json() {
    for case in load("canonical")["cases"].as_array().unwrap() {
        assert_eq!(
            String::from_utf8(to_canonical_json(&case["input"])).unwrap(),
            text(&case["canonical"])
        );
    }
}

#[test]
fn labelled_derivation_and_hash() {
    let v = load("derive");
    for c in v["cases"].as_array().unwrap() {
        let (ikm, salt, context) = (bytes(&c["ikm"]), bytes(&c["salt"]), bytes(&c["context"]));
        let label = text(&c["label"]);
        let okm = match number::<usize>(&c["length"]) {
            76 => derive::<76>(&ikm, &salt, label, &context).to_vec(),
            32 => derive::<32>(&ikm, &salt, label, &context).to_vec(),
            4 => derive::<4>(&ikm, &salt, label, &context).to_vec(),
            other => panic!("no vector length {other}"),
        };
        assert_eq!(okm, bytes(&c["okm"]));
    }
    for h in v["hashes"].as_array().unwrap() {
        assert_eq!(
            labeled_hash(text(&h["label"]), &bytes(&h["data"])).to_vec(),
            bytes(&h["hash"])
        );
    }
}

#[test]
fn ed25519_strict_verification() {
    let v = load("ed25519");
    for c in v["cases"].as_array().unwrap() {
        let valid = verify(
            &bytes(&c["publicKey"]),
            &bytes(&c["message"]),
            &bytes(&c["signature"]),
        );
        assert_eq!(valid, c["valid"].as_bool().unwrap(), "{}", c["name"]);
    }
    for key in v["weakKeys"]
        .as_array()
        .unwrap()
        .iter()
        .chain(v["nonCanonicalKeys"].as_array().unwrap())
    {
        assert!(!is_valid_signing_key(&bytes(key)), "{key}");
    }
}

#[test]
fn boxes() {
    let v = load("box");
    for c in v["cases"].as_array().unwrap() {
        let (key, aad, plaintext) = (bytes(&c["key"]), bytes(&c["aad"]), bytes(&c["plaintext"]));
        assert_eq!(
            seal_with_salt(&key, &aad, &plaintext, &array(&c["salt"])),
            bytes(&c["box"])
        );
        assert_eq!(open(&key, &aad, &bytes(&c["box"])).unwrap(), plaintext);
    }
    for n in v["negatives"].as_array().unwrap() {
        assert_code(
            open(&bytes(&n["key"]), &bytes(&n["aad"]), &bytes(&n["box"])),
            &n["error"],
        );
    }
}

#[test]
fn payloads() {
    let v = load("payload");
    for s in v["sizes"].as_array().unwrap() {
        assert_eq!(
            padded_size(number(&s["length"])),
            number::<usize>(&s["padded"])
        );
    }
    for c in v["cases"].as_array().unwrap() {
        assert_eq!(
            decode_payload(&bytes(&c["payload"])).unwrap(),
            bytes(&c["content"])
        );
    }
    for n in v["negatives"].as_array().unwrap() {
        assert_code(decode_payload(&bytes(&n["payload"])), &n["error"]);
    }
}

#[test]
fn member_ids_epoch_keys_and_wraps() {
    let v = load("keys");
    for m in v["members"].as_array().unwrap() {
        let derived = member_secrets(array(&m["sigSeed"]), array(&m["kemSecret"]));
        assert_eq!(derived.sig_public.to_vec(), bytes(&m["sigPublic"]));
        assert_eq!(derived.kem_public.to_vec(), bytes(&m["kemPublic"]));
        assert_eq!(derived.did.to_vec(), bytes(&m["did"]));
    }
    let e = &v["epoch"];
    let (key, group, epoch) = (
        bytes(&e["key"]),
        bytes(&e["group"]),
        number::<u32>(&e["epoch"]),
    );
    assert_eq!(
        epoch_commitment(&key, &group, epoch),
        bytes(&e["commitment"])
    );
    let purposes = [
        Purpose::Roster,
        Purpose::Changes,
        Purpose::Snapshot,
        Purpose::Ack,
        Purpose::Live,
        Purpose::Lan,
        Purpose::Chain,
    ];
    for purpose in purposes {
        assert_eq!(
            purpose_key(&key, &group, epoch, purpose),
            bytes(&e["purposes"][purpose.label()])
        );
    }

    let w = &v["wrap"];
    let (wgroup, wepoch, did) = (
        bytes(&w["group"]),
        number::<u32>(&w["epoch"]),
        bytes(&w["did"]),
    );
    let wrapped = wrap_epoch_key_with_rng(
        &bytes(&w["kemPublic"]),
        &wgroup,
        wepoch,
        &did,
        &bytes(&w["key"]),
        &mut FixedRng(bytes(&w["ikmE"])),
    )
    .unwrap();
    assert_eq!(wrapped, bytes(&w["wrap"]));
    let unwrapped =
        unwrap_epoch_key(&bytes(&w["kemSecret"]), &wgroup, wepoch, &did, &wrapped).unwrap();
    assert_eq!(unwrapped, bytes(&w["key"]));
    check_epoch_key(&unwrapped, &wgroup, wepoch, &bytes(&e["commitment"])).unwrap();
    assert_eq!(
        check_epoch_key(&unwrapped, &wgroup, 2, &bytes(&e["commitment"])),
        Err(Error::KeyCommitment)
    );
    for n in w["negatives"].as_array().unwrap() {
        let result = unwrap_epoch_key(
            &bytes(&w["kemSecret"]),
            &wgroup,
            number(&n["epoch"]),
            &bytes(&n["did"]),
            &wrapped,
        );
        assert_code(result, &n["error"]);
    }

    let c = &v["chain"];
    let previous = open_chain(
        &bytes(&c["key"]),
        &bytes(&c["group"]),
        number(&c["epoch"]),
        &bytes(&c["box"]),
    )
    .unwrap();
    assert_eq!(previous, bytes(&c["previousKey"]));
}

#[test]
fn recovery() {
    let v = load("recovery");
    for c in v["cases"].as_array().unwrap() {
        let secret: [u8; 32] = array(&c["secret"]);
        assert_eq!(recovery_words(&secret), text(&c["words"]));
        assert_eq!(recovery_secret(text(&c["words"])), Some(secret));
        assert_eq!(recovery_keys(&secret).did.to_vec(), bytes(&c["did"]));
    }
    for words in v["invalidWords"].as_array().unwrap() {
        assert_eq!(recovery_secret(text(words)), None);
    }
}

/// The reading order from store.md, as the app implements it.
fn read(v: &Value, object: &[u8], last: Option<&Value>) -> Result<Vec<u8>> {
    let group = bytes(&v["group"]);
    let parsed = parse_object(object, &group)?;
    let sender = v["members"]
        .get(hex::encode(parsed.header.sender))
        .ok_or(Error::Sender)?;
    verify_object(&parsed, &bytes(sender))?;
    if parsed.header.object_type == ObjectType::Live {
        next_live_counter(None, &parsed)?;
    } else {
        let last = last.map(|l| StreamPosition {
            seq: l["seq"].as_u64().unwrap(),
            hash: array(&l["hash"]),
        });
        next_in_stream(last.as_ref(), &parsed)?;
    }
    let epoch = parsed.header.epoch;
    let epoch_key = bytes(&v["epochKeys"][epoch.to_string()]);
    let key = purpose_key(
        &epoch_key,
        &group,
        epoch,
        parsed.header.object_type.purpose(),
    );
    decode_payload(&open_object(&parsed, &key)?)
}

#[test]
fn envelopes_open_in_stream_order() {
    let v = load("envelope");
    for c in v["cases"].as_array().unwrap() {
        assert_eq!(
            read(&v, &bytes(&c["object"]), c.get("last")).unwrap(),
            bytes(&c["content"])
        );
    }
    for n in v["negatives"].as_array().unwrap() {
        assert_eq!(
            read(&v, &bytes(&n["object"]), n.get("last"))
                .unwrap_err()
                .code(),
            text(&n["error"]),
            "{}",
            n["name"]
        );
    }
}

#[test]
fn snapshot_blobs() {
    let v = load("envelope");
    let b = &v["blob"];
    let group = bytes(&v["group"]);
    let key = purpose_key(&bytes(&v["epochKeys"]["0"]), &group, 0, Purpose::Snapshot);
    let open_with = |blob: &Value| {
        open_blob(
            &key,
            &group,
            0,
            &bytes(&b["sender"]),
            &bytes(blob),
            &bytes(&b["hash"]),
        )
    };
    assert_eq!(
        decode_payload(&open_with(&b["blob"]).unwrap()).unwrap(),
        bytes(&b["content"])
    );
    for n in b["negatives"].as_array().unwrap() {
        assert_code(open_with(&n["blob"]), &n["error"]);
    }
}

#[test]
fn pairing() {
    let v = load("pairing");
    let token = bytes(&v["token"]);
    let (shower, scanner) = (bytes(&v["showerPublic"]), bytes(&v["scannerPublic"]));
    let a = pairing_keys(
        &array(&v["showerSecret"]),
        &scanner,
        &token,
        &shower,
        &scanner,
    )
    .unwrap();
    let b = pairing_keys(
        &array(&v["scannerSecret"]),
        &shower,
        &token,
        &shower,
        &scanner,
    )
    .unwrap();
    assert_eq!(
        (&a.shower_key, &a.scanner_key, &a.sas),
        (&b.shower_key, &b.scanner_key, &b.sas)
    );
    assert_eq!(a.shower_key, bytes(&v["showerKey"]));
    assert_eq!(a.scanner_key, bytes(&v["scannerKey"]));
    assert_eq!(a.sas, text(&v["sas"]));
    assert_eq!(
        agreement_public_key(&array(&v["showerSecret"])).to_vec(),
        shower
    );
    assert_eq!(pairing_slot(&token).to_vec(), bytes(&v["slot"]));
    let m = &v["message"];
    assert_eq!(pairing_aad(&token, 0), bytes(&m["aad"]));
    let content =
        decode_payload(&open(&a.scanner_key, &bytes(&m["aad"]), &bytes(&m["box"])).unwrap())
            .unwrap();
    assert_eq!(String::from_utf8(content).unwrap(), text(&m["content"]));
}

#[test]
fn lan() {
    let v = load("lan");
    let key = bytes(&v["lanKey"]);
    let ids = [
        bytes(&v["clientNonce"]),
        bytes(&v["serverNonce"]),
        bytes(&v["clientDid"]),
        bytes(&v["serverDid"]),
    ];
    assert_eq!(
        lan_tag(&key, v["tag"]["unixSeconds"].as_u64().unwrap()),
        bytes(&v["tag"]["tag"])
    );
    for (i, aad) in v["helloAad"].as_array().unwrap().iter().enumerate() {
        assert_eq!(lan_hello_aad(u8::try_from(i + 1).unwrap()), bytes(aad));
    }
    assert_eq!(
        lan_transcript(LanRole::Server, &ids[0], &ids[1], &ids[2], &ids[3]),
        bytes(&v["serverTranscript"])
    );
    assert_eq!(
        lan_transcript(LanRole::Client, &ids[0], &ids[1], &ids[2], &ids[3]),
        bytes(&v["clientTranscript"])
    );
    let session = lan_session_keys(&key, &ids[0], &ids[1], &ids[2], &ids[3]);
    assert_eq!(session.client_to_server, bytes(&v["clientToServer"]));
    assert_eq!(session.server_to_client, bytes(&v["serverToClient"]));
    assert_eq!(lan_frame_aad(5), bytes(&v["frameAad"]));
}
