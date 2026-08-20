//! SABR (Server Adaptive Bit Rate) streaming engine.
//!
//! YouTube is migrating playback away from direct media URLs / DASH / HLS toward
//! SABR, where the client POSTs a protobuf `VideoPlaybackAbrRequest` and the
//! server streams back media wrapped in UMP (Universal Media Protocol) frames.
//! This module implements that protocol in Rust, behind the local media proxy,
//! and exposes plain local HTTP endpoints (a DASH manifest + init/segment URLs)
//! that the existing dash.js-based player can consume without knowing SABR exists.
//!
//! Layering (bottom-up):
//!   - `pb`       — minimal protobuf wire codec (no protoc/prost dependency)
//!   - `ump`      — UMP varint + streaming frame parser
//!   - `messages` — typed SABR request/response messages
//!   - `errors`   — error taxonomy + retry/reload classification
//!   - `selector` — codec/browser-aware format selection
//!   - `session`  — per-request state machine + request builder + part dispatch
//!   - `engine`   — async network loop, bounded segment buffer, lifecycle
//!   - `manifest` — local DASH manifest generation

pub mod errors;
pub mod messages;
pub mod pb;
pub mod selector;
pub mod ump;

pub mod engine;
pub mod manifest;
pub mod session;

pub use errors::{SabrError, SabrResult};
pub use selector::{CodecSupport, SabrFormat, SelectedFormats};

use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

use crate::api::innertube::core::clients;
use engine::{SabrEngine, SabrEngineConfig};

// Immutable inputs needed to drive a SABR session, assembled by extraction.
#[derive(Debug, Clone)]
pub struct SabrSessionDescriptor {
    pub video_id: String,
    pub server_abr_streaming_url: String,
    pub visitor_data: Option<String>,
    pub po_token: Option<String>,
    // Base64-decoded `videoPlaybackUstreamerConfig`.
    pub ustreamer_config: Vec<u8>,
    pub client_profile: ClientProfile,
    pub duration_ms: u64,
    pub formats: Vec<SabrFormat>,
}

// The InnerTube client identity that produced the player response, echoed back
// in SABR requests so the server keeps serving the same session.
#[derive(Debug, Clone)]
pub struct ClientProfile {
    pub client_name_id: i32,
    pub client_version: String,
    pub user_agent: String,
    pub device_make: String,
    pub device_model: String,
    pub os_name: String,
    pub os_version: String,
}

impl ClientProfile {
    /// Derive the SABR identity from the registry entry of the client whose player
    /// response opened the session, so the two can never disagree.
    #[must_use]
    pub fn from_client(client: &clients::YouTubeClient) -> Self {
        Self {
            client_name_id: client.client_name_id(),
            client_version: client.version.to_string(),
            user_agent: client.user_agent.to_string(),
            device_make: client.device_make.unwrap_or_default().to_string(),
            device_model: client.device_model.unwrap_or_default().to_string(),
            os_name: client.os_name.unwrap_or_default().to_string(),
            os_version: client.os_version.unwrap_or_default().to_string(),
        }
    }

    /// Resolve by InnerTube client name, for callers that only have the name a
    /// media URL carries. Unknown names fall back to WEB, which is what an
    /// unrecognized `c=` parameter most likely is.
    #[must_use]
    pub fn from_client_name(client_name: &str) -> Self {
        Self::from_client(clients::by_name(client_name).unwrap_or(&clients::WEB))
    }

    #[cfg(test)]
    pub fn ios() -> Self {
        Self::from_client(&clients::IOS)
    }
}

// Which track a proxy route refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SabrTrack {
    Audio,
    Video,
}

impl SabrTrack {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "audio" => Some(SabrTrack::Audio),
            "video" => Some(SabrTrack::Video),
            _ => None,
        }
    }
}

// A live SABR session: handle to its engine plus bookkeeping.
pub struct SabrSessionHandle {
    pub session_id: String,
    pub video_id: String,
    pub engine: Arc<SabrEngine>,
    created_at: Instant,
    last_access: Mutex<Instant>,
    expires_in_seconds: u64,
}

impl SabrSessionHandle {
    fn touch(&self) {
        if let Ok(mut last) = self.last_access.lock() {
            *last = Instant::now();
        }
    }

    fn is_expired(&self, idle_ttl: Duration) -> bool {
        let hard_cap = Duration::from_secs(self.expires_in_seconds.max(60).min(3600));
        if self.created_at.elapsed() > hard_cap {
            return true;
        }
        match self.last_access.lock() {
            Ok(last) => last.elapsed() > idle_ttl,
            Err(_) => false,
        }
    }
}

// Owns SABR sessions. Descriptors are *prepared* cheaply (no network) when a
// stream is resolved, then *activated* lazily — the engine only starts hitting
// YouTube once the player actually fetches the manifest/segments. This keeps
// SABR a zero-cost fallback until it is genuinely used.
#[derive(Clone)]
pub struct SabrSessionManager {
    sessions: Arc<Mutex<HashMap<String, Arc<SabrSessionHandle>>>>,
    prepared: Arc<Mutex<HashMap<String, (SabrSessionDescriptor, CodecSupport)>>>,
    counter: Arc<AtomicU64>,
    config: SabrEngineConfig,
    idle_ttl: Duration,
    max_active: usize,
    max_prepared: usize,
}

impl Default for SabrSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SabrSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            prepared: Arc::new(Mutex::new(HashMap::new())),
            counter: Arc::new(AtomicU64::new(1)),
            config: SabrEngineConfig::default(),
            idle_ttl: Duration::from_secs(10 * 60),
            max_active: 4,
            max_prepared: 32,
        }
    }

    // Register a descriptor for lazy activation. Returns the session id to embed
    // in the manifest URL. No engine is started yet.
    pub fn prepare(&self, descriptor: SabrSessionDescriptor, support: CodecSupport) -> String {
        // Reuse an existing session for the same video. The frontend may resolve a
        // stream more than once (re-mount / double-fetch); two concurrent SABR
        // sessions for one video share a pot/visitor and trip YouTube's attestation.
        {
            let prepared = self.prepared.lock().unwrap();
            if let Some((id, _)) = prepared
                .iter()
                .find(|(_, (d, _))| d.video_id == descriptor.video_id)
            {
                return id.clone();
            }
        }
        {
            let sessions = self.sessions.lock().unwrap();
            if let Some(handle) = sessions
                .values()
                .find(|h| h.video_id == descriptor.video_id)
            {
                return handle.session_id.clone();
            }
        }

        let id = format!("s{}", self.counter.fetch_add(1, Ordering::Relaxed));
        let mut prepared = self.prepared.lock().unwrap();
        if prepared.len() >= self.max_prepared {
            // Drop an arbitrary stale prepared descriptor (bounded memory).
            if let Some(k) = prepared.keys().next().cloned() {
                prepared.remove(&k);
            }
        }
        prepared.insert(id.clone(), (descriptor, support));
        id
    }

    // Get a live session, or lazily create + spawn its engine from a prepared
    // descriptor on first access.
    pub fn activate(&self, session_id: &str) -> SabrResult<Arc<SabrSessionHandle>> {
        self.prune_expired();

        if let Some(handle) = self.get(session_id) {
            return Ok(handle);
        }

        let (descriptor, support) = {
            let prepared = self.prepared.lock().unwrap();
            prepared.get(session_id).cloned()
        }
        .ok_or(SabrError::Cancelled)?;

        let selected = selector::select_formats(&descriptor.formats, Some(480), support)
            .ok_or(SabrError::NoPlayableFormats)?;

        let engine = Arc::new(SabrEngine::new(
            session_id.to_string(),
            descriptor.clone(),
            selected,
            self.config.clone(),
        ));
        engine.clone().spawn();

        let handle = Arc::new(SabrSessionHandle {
            session_id: session_id.to_string(),
            video_id: descriptor.video_id.clone(),
            engine,
            created_at: Instant::now(),
            last_access: Mutex::new(Instant::now()),
            expires_in_seconds: 3600,
        });

        let mut sessions = self.sessions.lock().unwrap();
        if sessions.len() >= self.max_active {
            if let Some(oldest) = sessions
                .values()
                .min_by_key(|h| *h.last_access.lock().unwrap())
                .map(|h| h.session_id.clone())
            {
                if let Some(removed) = sessions.remove(&oldest) {
                    removed.engine.cancel();
                }
            }
        }
        sessions.insert(session_id.to_string(), handle.clone());
        Ok(handle)
    }

    pub fn get(&self, session_id: &str) -> Option<Arc<SabrSessionHandle>> {
        let sessions = self.sessions.lock().unwrap();
        let handle = sessions.get(session_id).cloned();
        if let Some(h) = &handle {
            h.touch();
        }
        handle
    }

    pub fn remove(&self, session_id: &str) {
        if let Some(removed) = self.sessions.lock().unwrap().remove(session_id) {
            removed.engine.cancel();
        }
        self.prepared.lock().unwrap().remove(session_id);
    }

    fn prune_expired(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        let idle_ttl = self.idle_ttl;
        let expired: Vec<String> = sessions
            .iter()
            .filter(|(_, h)| h.is_expired(idle_ttl))
            .map(|(k, _)| k.clone())
            .collect();
        for key in expired {
            if let Some(removed) = sessions.remove(&key) {
                removed.engine.cancel();
            }
        }
    }
}
