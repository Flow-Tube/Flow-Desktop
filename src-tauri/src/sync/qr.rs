//! The `FLOW-SYNC/1` QR-code payload — the out-of-band channel that carries the master key.
//!
//! The host serializes a [`QrPayload`] to compact JSON and renders it as a QR image (rendering is
//! done in the frontend). The client scans it, parses it here, and recovers the session id + the
//! master secret to derive the same directional keys and SAS (see `crypto.rs`).
//!
//! Binary fields are **base64url, no padding** (matching the Android decoder). The payload
//! deliberately contains **no nonce/IV** — nonces are per-frame and random (AES-GCM nonce reuse
//! is catastrophic).

#![allow(clippy::must_use_candidate)]

use std::net::IpAddr;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

use crate::sync::PROTOCOL_VERSION;
use crate::sync::crypto::{CryptoError, MasterSecret, SessionId};

#[derive(Debug, thiserror::Error)]
pub enum QrError {
    #[error("malformed QR JSON: {0}")]
    Json(String),
    #[error("unsupported protocol version {0}")]
    UnsupportedVersion(u8),
    #[error("bad base64 in field `{0}`")]
    Base64(&'static str),
    #[error("`{0}` is not an address on a local network")]
    Address(String),
    #[error(transparent)]
    Crypto(#[from] CryptoError),
}

/// The decoded contents of a Flow Sync QR code. Field names are short to keep the QR dense.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QrPayload {
    /// Protocol version.
    pub v: u8,
    /// Session id / HKDF salt, base64url(16 bytes).
    pub sid: String,
    /// Master secret, base64url(32 bytes).
    pub k: String,
    /// Host LAN IP.
    pub ip: String,
    /// Host TCP port.
    pub p: u16,
    /// Host display name.
    pub d: String,
    /// Absolute expiry, epoch **seconds**.
    pub exp: u64,
    /// The QR-shower's **data role** (the scanner takes the complement): omitted/`"sender"` = the
    /// host SENDS (scanner receives, the default); `"receiver"` = the host wants to RECEIVE, so the
    /// **scanner must SEND**. This is what lets a camera-less device receive (it shows the QR and
    /// accepts an inbound send). Any value other than `"receiver"` is treated as `"sender"`. Omitted
    /// when sending so older peers stay compatible. (Matches the Android `role` field.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// `"host"` when the host's own single-use, time-bounded listener decides freshness, so the
    /// scanner must not compare `exp` with its own clock: device clocks routinely disagree by
    /// minutes, which made valid codes look expired on arrival. (Matches the Android `lease`.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<String>,
    /// More host addresses to try, in order, when `ip` is unreachable (a second adapter, or a
    /// virtual adapter that won the ranking). Older scanners ignore it and dial `ip` only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ips: Vec<String>,
}

/// The `lease` value meaning "the host session decides freshness".
const LEASE_HOST_SESSION: &str = "host";

/// Slack for codes without a lease (Android phones), whose expiry is the phone's clock: a PC clock
/// running a few minutes ahead must not reject a code the phone is still serving.
const CLOCK_SKEW_GRACE_S: u64 = 600;

impl QrPayload {
    /// Build a QR payload for a host that will **send** (the default; `role` omitted ⇒ "sender").
    pub fn new(
        session_id: &SessionId,
        master: &MasterSecret,
        ip: impl Into<String>,
        port: u16,
        device_name: impl Into<String>,
        expires_at_epoch_s: u64,
    ) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            sid: URL_SAFE_NO_PAD.encode(session_id.as_bytes()),
            k: URL_SAFE_NO_PAD.encode(master.as_bytes()),
            ip: ip.into(),
            p: port,
            d: device_name.into(),
            exp: expires_at_epoch_s,
            role: None,
            lease: Some(LEASE_HOST_SESSION.to_string()),
            ips: Vec::new(),
        }
    }

    /// Offer extra addresses for the scanner to fall back to (deduplicated against `ip`).
    #[must_use]
    pub fn with_fallback_ips(mut self, ips: impl IntoIterator<Item = String>) -> Self {
        for ip in ips {
            if ip != self.ip && !self.ips.contains(&ip) {
                self.ips.push(ip);
            }
        }
        self
    }

    /// Build a QR payload for a host that will **receive** (`role:"receiver"`); the scanner must SEND.
    pub fn new_receiving(
        session_id: &SessionId,
        master: &MasterSecret,
        ip: impl Into<String>,
        port: u16,
        device_name: impl Into<String>,
        expires_at_epoch_s: u64,
    ) -> Self {
        Self {
            role: Some("receiver".to_string()),
            ..Self::new(
                session_id,
                master,
                ip,
                port,
                device_name,
                expires_at_epoch_s,
            )
        }
    }

    /// True if the QR-shower wants to RECEIVE (so this scanner must send). Any role other than
    /// `"receiver"` (including absent) means the shower sends and this scanner receives.
    pub fn host_receives(&self) -> bool {
        self.role.as_deref() == Some("receiver")
    }

    pub fn to_json(&self) -> String {
        // Infallible for this plain struct.
        serde_json::to_string(self).expect("serialize QrPayload")
    }

    pub fn from_json(s: &str) -> Result<Self, QrError> {
        let payload: QrPayload =
            serde_json::from_str(s).map_err(|e| QrError::Json(e.to_string()))?;
        if payload.v != PROTOCOL_VERSION {
            return Err(QrError::UnsupportedVersion(payload.v));
        }
        for ip in std::iter::once(&payload.ip).chain(&payload.ips) {
            if !is_local_address(ip) {
                return Err(QrError::Address(ip.clone()));
            }
        }
        Ok(payload)
    }

    /// Recover the session id from the `sid` field.
    pub fn session_id(&self) -> Result<SessionId, QrError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(&self.sid)
            .map_err(|_| QrError::Base64("sid"))?;
        Ok(SessionId::try_from_slice(&bytes)?)
    }

    /// Recover the master secret from the `k` field.
    pub fn master(&self) -> Result<MasterSecret, QrError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(&self.k)
            .map_err(|_| QrError::Base64("k"))?;
        MasterSecret::try_from_slice(&bytes).map_err(QrError::from)
    }

    /// Every address to dial, in order: `ip` first, then the fallbacks.
    pub fn dial_addresses(&self) -> Vec<&str> {
        std::iter::once(self.ip.as_str())
            .chain(self.ips.iter().map(String::as_str))
            .collect()
    }

    /// True if the QR has expired relative to the given wall-clock time (epoch seconds). A
    /// host-session lease never expires here: the host refuses late connections itself.
    pub fn is_expired(&self, now_epoch_s: u64) -> bool {
        self.lease.as_deref() != Some(LEASE_HOST_SESSION)
            && now_epoch_s >= self.exp.saturating_add(CLOCK_SKEW_GRACE_S)
    }
}

/// True for an IP literal on a local network: private, link-local, CGNAT (Tailscale and other
/// overlays) or loopback. Hostnames and public addresses are refused because the code carries the
/// session key: a pasted code pointing at an internet host would stream the library to it, and the
/// matching verification code proves nothing when the attacker made the key.
pub fn is_local_address(ip: &str) -> bool {
    match ip.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let [a, b, ..] = v4.octets();
            v4.is_private()
                || v4.is_link_local()
                || v4.is_loopback()
                || (a == 100 && (64..=127).contains(&b))
        }
        Ok(IpAddr::V6(v6)) => {
            // Unique-local only: a link-local fe80:: address needs a zone id a QR can't carry.
            v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00
        }
        Err(_) => false,
    }
}

// Tests for this module live in `tests/sync_phase1.rs` (integration test) — see the note in
// `canonical.rs` on why in-crate unit tests can't run on this Tauri crate.
