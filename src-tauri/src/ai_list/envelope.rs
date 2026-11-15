//! The signed manifest envelope: `{ key_id, payload, sig }`, an Ed25519 signature over the raw
//! payload bytes. The payload is only parsed after the signature verifies.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use super::formats::EnvelopeJson;
use crate::sync2::curve;

/// The keys the list may be signed with, by `key_id`, the same ones Flow for Android trusts. A new
/// key ships here in an app release before the pipeline signs with it; it is never fetched from
/// the host it protects.
const TRUSTED_KEYS: [(&str, &str); 1] =
    [("2026-11", "xak9y4JaDG+UjKfl7cDwiaJs+7FjrOM+urMW1YfSuc0=")];

const SIGNATURE_SIZE: usize = 64;

/// The built-in public key for `key_id`.
#[must_use]
pub fn trusted_key(key_id: &str) -> Option<Vec<u8>> {
    TRUSTED_KEYS
        .iter()
        .find(|(id, _)| *id == key_id)
        .and_then(|(_, key)| STANDARD.decode(key).ok())
}

/// Verifies `envelope` and only then hands back the payload bytes; `Err` names why it was refused.
pub fn open(envelope: &[u8], key_for: impl Fn(&str) -> Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let envelope: EnvelopeJson =
        serde_json::from_slice(envelope).map_err(|_| "manifest is not an envelope".to_string())?;
    let key_id = envelope.key_id.ok_or("no key_id")?;
    let key = key_for(&key_id).ok_or_else(|| format!("unknown key_id {key_id}"))?;
    let payload = envelope
        .payload
        .as_deref()
        .and_then(decode_canonical)
        .ok_or("payload is not standard base64")?;
    let signature = envelope
        .sig
        .as_deref()
        .and_then(decode_canonical)
        .ok_or("sig is not standard base64")?;
    if signature.len() != SIGNATURE_SIZE {
        return Err(format!("sig is not {SIGNATURE_SIZE} bytes"));
    }
    if !curve::verify(&key, &payload, &signature) {
        return Err("signature does not verify".to_string());
    }
    Ok(payload)
}

/// Padded standard base64 only, as the publisher writes it.
fn decode_canonical(text: &str) -> Option<Vec<u8>> {
    let bytes = STANDARD.decode(text).ok()?;
    (STANDARD.encode(&bytes) == text).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Signed by the pipeline's own `signEnvelope` (Flow-Tube/AIlist `src/sign.js`) with a throwaway
    // key, the vector Flow for Android tests its verifier with.
    const NODE_KEY: &str = "8GY6AyR+w4a7cFsXckyieBLNl7CRVAlZ4X/aYevW3N0=";
    const NODE_PAYLOAD: &str = "eyJzY2hlbWEiOjEsImxpc3QiOiJhaXNsaXN0IiwidmVyc2lvbiI6NywiZ2VuZXJhdGVkX2F0IjoiMjAyNi0xMS0xM1QwMzoxNzowMFoiLCJzbmFwc2hvdCI6eyJwYXRoIjoic25hcHNob3QvNy5qc29uIiwic2hhMjU2IjoiMDAiLCJieXRlcyI6Mn0sImRlbHRhcyI6W10sIm1heF9kZWx0YV9jaGFpbiI6MTQsIm5vdGUiOiJub24tQVNDSUkgw6kg44GCIn0=";
    const NODE_SIG: &str =
        "LTtwN8Bclgv07otwezRsbJ4i/aqhB7jG7hEv6kSvA5q53fbh5qms95DTgPhPH3JHzRN6tg0K2RdPL4IPfGVvDg==";

    fn envelope(key_id: &str, payload: &str, sig: &str) -> Vec<u8> {
        serde_json::json!({ "key_id": key_id, "payload": payload, "sig": sig })
            .to_string()
            .into_bytes()
    }

    fn node_keys(key_id: &str) -> Option<Vec<u8>> {
        (key_id == "test-node").then(|| STANDARD.decode(NODE_KEY).unwrap())
    }

    fn flip(base64: &str, index: usize) -> String {
        let mut bytes = STANDARD.decode(base64).unwrap();
        bytes[index] ^= 1;
        STANDARD.encode(bytes)
    }

    #[test]
    fn an_envelope_signed_by_the_pipeline_verifies_and_yields_its_exact_payload() {
        let payload = open(&envelope("test-node", NODE_PAYLOAD, NODE_SIG), node_keys).unwrap();
        let text = String::from_utf8(payload).unwrap();
        assert!(text.contains("\"list\":\"aislist\""));
        assert!(text.contains("non-ASCII é あ"));
    }

    #[test]
    fn one_changed_payload_byte_fails_the_check() {
        let tampered = flip(NODE_PAYLOAD, 10);
        assert_eq!(
            open(&envelope("test-node", &tampered, NODE_SIG), node_keys),
            Err("signature does not verify".to_string())
        );
    }

    #[test]
    fn one_changed_signature_byte_fails_the_check() {
        let tampered = flip(NODE_SIG, 40);
        assert!(open(&envelope("test-node", NODE_PAYLOAD, &tampered), node_keys).is_err());
    }

    #[test]
    fn an_unknown_key_id_is_refused_without_trying_any_other_key() {
        let other = |key_id: &str| (key_id == "other").then(|| STANDARD.decode(NODE_KEY).unwrap());
        assert_eq!(
            open(&envelope("test-node", NODE_PAYLOAD, NODE_SIG), other),
            Err("unknown key_id test-node".to_string())
        );
    }

    #[test]
    fn base64_without_its_padding_is_refused() {
        let unpadded = NODE_SIG.trim_end_matches('=');
        assert!(open(&envelope("test-node", NODE_PAYLOAD, unpadded), node_keys).is_err());
    }

    #[test]
    fn something_that_is_not_an_envelope_is_refused() {
        assert_eq!(
            open(b"<html>", node_keys),
            Err("manifest is not an envelope".to_string())
        );
    }

    #[test]
    fn the_production_key_decodes_to_a_32_byte_key_and_nothing_else_is_trusted() {
        assert_eq!(trusted_key("2026-11").map(|key| key.len()), Some(32));
        assert_eq!(trusted_key("test-node"), None);
    }
}
