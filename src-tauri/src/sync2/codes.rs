//! Pairing codes (spec/protocol.md, QR code): a one-time token and an ephemeral key, shown by a
//! member with its store, or by a new device with the LAN addresses where it listens.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

use super::array;
use super::curve::agreement_public_key;
use super::engine::{EngineError, Result};
use super::pipe::{KEY_SIZE, LanAddress, Listening};
use super::sealed::random_bytes;
use crate::sync::canonical::to_canonical_json;

const NAME_LIMIT: usize = 64;

/// Where a member's group lives: `{"k":"server","u":url}`, `{"k":"webdav","u":url}` or
/// `{"k":"lan"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoreLocation {
    pub k: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
}

impl StoreLocation {
    pub fn server(url: &str) -> Self {
        Self {
            k: "server".into(),
            u: Some(url.into()),
        }
    }

    pub fn webdav(url: &str) -> Self {
        Self {
            k: "webdav".into(),
            u: Some(url.into()),
        }
    }

    pub fn lan() -> Self {
        Self {
            k: "lan".into(),
            u: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QrCode {
    pub v: u8,
    pub t: String,
    pub e: String,
    pub r: String,
    pub d: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<StoreLocation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub l: Option<Vec<LanAddress>>,
}

/// A code read from another device, checked for what this build can answer.
pub enum Code {
    /// A member's code, which a new device answers: where its group lives, and LAN addresses to
    /// try first.
    Member {
        qr: QrCode,
        store: StoreLocation,
        lan: Vec<LanAddress>,
    },
    /// A new device's code, which a member answers over the LAN.
    New { qr: QrCode, lan: Vec<LanAddress> },
}

impl Code {
    pub fn qr(&self) -> &QrCode {
        match self {
            Self::Member { qr, .. } | Self::New { qr, .. } => qr,
        }
    }

    pub fn token(&self) -> Result<[u8; 16]> {
        URL_SAFE_NO_PAD
            .decode(&self.qr().t)
            .ok()
            .filter(|t| t.len() == 16)
            .map(|t| array(&t))
            .ok_or(EngineError::Unexpected)
    }

    pub fn shower_key(&self) -> Result<[u8; KEY_SIZE]> {
        b64_key(&self.qr().e)
    }
}

pub fn b64_key(value: &str) -> Result<[u8; KEY_SIZE]> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| EngineError::Unexpected)?;
    (bytes.len() == KEY_SIZE)
        .then(|| array(&bytes))
        .ok_or(EngineError::Unexpected)
}

/// Reads a FLOW-SYNC/2 code; FLOW-SYNC/1 codes and stores this build doesn't keep are refused.
pub fn read_code(text: &str) -> Result<Code> {
    let qr: QrCode = serde_json::from_str(text.trim()).map_err(|_| EngineError::Unexpected)?;
    let lan = qr.l.clone().unwrap_or_default();
    match (qr.v, qr.r.as_str(), &qr.s) {
        (2, "m", Some(store))
            if matches!(store.k.as_str(), "server" | "webdav") && store.u.is_some()
                || store.k == "lan" && !lan.is_empty() =>
        {
            Ok(Code::Member {
                store: store.clone(),
                lan,
                qr,
            })
        }
        (2, "n", None) if !lan.is_empty() => Ok(Code::New { qr, lan }),
        _ => Err(EngineError::Unexpected),
    }
}

/// A code this device shows, valid until it stops listening.
pub struct Offer {
    pub qr: String,
    pub token: [u8; 16],
    pub secret: [u8; KEY_SIZE],
    pub public: [u8; KEY_SIZE],
    pub listening: Option<Listening>,
}

/// A member's code (with its group's `store`) or a new device's (`None`, so it must listen).
pub fn new_offer(
    store: Option<StoreLocation>,
    device_name: &str,
    listening: Option<Listening>,
) -> Offer {
    let (token, secret) = (random_bytes::<16>(), random_bytes::<KEY_SIZE>());
    let public = agreement_public_key(&secret);
    let code = QrCode {
        v: 2,
        t: URL_SAFE_NO_PAD.encode(token),
        e: URL_SAFE_NO_PAD.encode(public),
        r: if store.is_some() { "m" } else { "n" }.into(),
        d: device_name.chars().take(NAME_LIMIT).collect(),
        s: store,
        l: listening.as_ref().map(|l| l.addresses.clone()),
    };
    Offer {
        qr: String::from_utf8_lossy(&to_canonical_json(&code)).into_owned(),
        token,
        secret,
        public,
        listening,
    }
}
