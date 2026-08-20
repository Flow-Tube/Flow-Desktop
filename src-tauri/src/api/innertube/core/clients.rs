//! Single source of truth for every InnerTube client identity Flow presents.
//!
//! Before this module the same client was declared in five places (the video
//! context builders, the `post_innertube` User-Agent table, the music profiles,
//! the SABR `ClientProfile`, and the media-proxy `MEDIA_UA_*` constants) and they
//! had drifted: `ANDROID` was requested as `21.03.38` but its media bytes were
//! fetched with a `19.29.37` User-Agent, `WEB_REMIX` was sent with its client *id*
//! in the version field, and SABR reported a `WEB` version two years older than
//! the one the extractor used. Every consumer now reads these definitions, so a
//! version bump is a one-line edit that cannot leave a request half-updated.
//!
//! Mirrors `Prism_Mobile`'s `YouTubeClient.kt`, including its
//! [`AttestationPlatform`] gate — see that type for why it is load-bearing.

use serde_json::{Value, json};

/// Signature timestamp sent in `playbackContext.contentPlaybackContext`.
///
/// Clients with `use_signature_timestamp` need one, and YouTube rotates the value
/// with `player_ias` releases. Flow has no JS solver to read the live value out of
/// `base.js`, so this is pinned; when signed clients start failing wholesale this
/// is the first thing to re-check.
pub const DEFAULT_SIGNATURE_TIMESTAMP: i64 = 19550;

/// Which attestation runtime mints a PO token a given client's requests will be
/// accepted with.
///
/// A PO token comes from BotGuard (web), DroidGuard (Android) or iOSGuard (iOS),
/// and one platform's token is never valid on another's. Flow can only run
/// BotGuard (`sidecar/integrity.cjs` and the hidden-WebView minter), so [`Web`] is
/// the only family it can attest for. Encoding it here is what stops a BotGuard
/// token being injected into an `IOS`/`ANDROID_VR` player request — a claim
/// googlevideo validates and rejects, making it strictly worse than sending
/// nothing.
///
/// [`Web`]: AttestationPlatform::Web
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttestationPlatform {
    /// BotGuard. The only runtime Flow owns.
    Web,
    /// DroidGuard, inside Google Play Services. Not reachable from a desktop app.
    DroidGuard,
    /// iOSGuard. Not reachable at all.
    IosGuard,
}

/// One InnerTube client profile: everything needed to make a request look like
/// that client, and the metadata that decides how it may be used.
#[derive(Clone, Copy, Debug)]
pub struct YouTubeClient {
    pub name: &'static str,
    /// Sent as `context.client.clientVersion` and `X-YouTube-Client-Version`.
    pub version: &'static str,
    /// Sent as `X-YouTube-Client-Name`, and as SABR's `streamer_context.client_name`.
    pub client_id: &'static str,
    pub user_agent: &'static str,
    pub os_name: Option<&'static str>,
    pub os_version: Option<&'static str>,
    pub device_make: Option<&'static str>,
    pub device_model: Option<&'static str>,
    pub android_sdk_version: Option<&'static str>,
    /// Whether the player request should carry a `signatureTimestamp`.
    pub use_signature_timestamp: bool,
    /// Embedded player: sends `thirdParty.embedUrl`, which bypasses age gating.
    pub is_embedded: bool,
    /// Whether a BotGuard token should be *requested* for this client. Distinct
    /// from [`Self::attestation`], which says whether one would be *valid*: the
    /// embedded TV player is web-family but is served fine without a token.
    pub use_web_po_tokens: bool,
    /// The runtime whose tokens this client's requests and URLs accept.
    pub attestation: AttestationPlatform,
}

impl YouTubeClient {
    /// Build the `context` object for this client.
    ///
    /// `gl` overrides the region for feeds that are region-scoped (the Shorts reel
    /// sequence); everything else extracts against `US` so responses are
    /// deterministic regardless of where the user is.
    #[must_use]
    pub fn context(&self, visitor_data: Option<&str>, gl: Option<&str>) -> Value {
        let mut client = json!({
            "clientName": self.name,
            "clientVersion": self.version,
            "hl": "en",
            "gl": gl.unwrap_or("US"),
            "utcOffsetMinutes": 0,
        });
        for (key, value) in [
            ("osName", self.os_name),
            ("osVersion", self.os_version),
            ("deviceMake", self.device_make),
            ("deviceModel", self.device_model),
            ("androidSdkVersion", self.android_sdk_version),
        ] {
            if let Some(value) = value {
                client[key] = json!(value);
            }
        }
        if let Some(visitor) = visitor_data.filter(|value| !value.is_empty()) {
            client["visitorData"] = json!(visitor);
        }
        json!({ "client": client })
    }

    /// The context for a player request, with the PO token attached only when this
    /// client can actually be attested by the runtime Flow owns.
    ///
    /// Callers pass whatever token they hold and let this decide; that keeps the
    /// attestation rule in one place instead of at every call site.
    #[must_use]
    pub fn player_context(
        &self,
        visitor_data: Option<&str>,
        po_token: Option<&str>,
        gl: Option<&str>,
    ) -> Value {
        let mut context = self.context(visitor_data, gl);
        if !self.accepts_web_po_token() {
            return context;
        }
        if let Some(token) = po_token.filter(|token| !token.is_empty()) {
            context["serviceIntegrityDimensions"] = json!({ "poToken": token });
        }
        context
    }

    /// Whether a BotGuard-minted token is valid for this client.
    #[must_use]
    pub fn accepts_web_po_token(&self) -> bool {
        matches!(self.attestation, AttestationPlatform::Web)
    }

    /// Numeric client id, for SABR's `streamer_context.client_name`.
    #[must_use]
    pub fn client_name_id(&self) -> i32 {
        self.client_id.parse().unwrap_or(1)
    }

    #[must_use]
    pub fn signature_timestamp(&self) -> Option<i64> {
        self.use_signature_timestamp
            .then_some(DEFAULT_SIGNATURE_TIMESTAMP)
    }
}

// ---------------------------------------------------------------------------
// Client definitions
// ---------------------------------------------------------------------------

const USER_AGENT_WEB: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// The primary direct-URL client for both video and music.
///
/// googlevideo serves its formats without a PO token and without an `n`
/// parameter, so it reaches first frame with neither an attestation nor an nsig
/// decode — the two properties `ANDROID_VR` was chosen for and lost when YouTube
/// began requiring a GVS PO token for it (yt-dlp #17261, Aug 2026).
///
/// Version-sensitive: the older `0.1`/`RealityDevice14,1` build still answers but
/// serves a stub ladder (17 formats, one audio track) where this build serves the
/// full one. Do not "simplify" these values.
pub const VISIONOS: YouTubeClient = YouTubeClient {
    name: "VISIONOS",
    version: "1.02",
    client_id: "101",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    os_name: Some("visionOS"),
    os_version: Some("26.5.23O471"),
    device_make: Some("Apple"),
    device_model: Some("RealityDevice17,1"),
    android_sdk_version: None,
    use_signature_timestamp: false,
    is_embedded: false,
    use_web_po_tokens: false,
    attestation: AttestationPlatform::IosGuard,
};

pub const ANDROID_VR: YouTubeClient = YouTubeClient {
    name: "ANDROID_VR",
    version: "1.61.48",
    client_id: "28",
    user_agent: "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)",
    os_name: Some("Android"),
    os_version: Some("12"),
    device_make: Some("Oculus"),
    device_model: Some("Quest 3"),
    android_sdk_version: Some("32"),
    use_signature_timestamp: false,
    is_embedded: false,
    use_web_po_tokens: false,
    attestation: AttestationPlatform::DroidGuard,
};

/// Non-ABR VR build — the smoothest for music, which is why it leads the audio
/// chain ahead of the newer ones.
pub const ANDROID_VR_1_43_32: YouTubeClient = YouTubeClient {
    version: "1.43.32",
    user_agent: "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)",
    ..ANDROID_VR
};

/// Same build as [`ANDROID_VR`] with the Oculus-prefixed device string. YouTube
/// answers the two differently often enough that it is kept as its own retry.
pub const ANDROID_VR_NO_AUTH: YouTubeClient = YouTubeClient {
    user_agent: "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Oculus Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)",
    ..ANDROID_VR
};

pub const ANDROID: YouTubeClient = YouTubeClient {
    name: "ANDROID",
    version: "21.03.38",
    client_id: "3",
    user_agent: "com.google.android.youtube/21.03.38 (Linux; U; Android 14) gzip",
    os_name: Some("Android"),
    os_version: Some("14"),
    device_make: Some("Google"),
    device_model: Some("Pixel 6 Pro"),
    android_sdk_version: Some("34"),
    use_signature_timestamp: true,
    is_embedded: false,
    use_web_po_tokens: false,
    attestation: AttestationPlatform::DroidGuard,
};

pub const ANDROID_CREATOR: YouTubeClient = YouTubeClient {
    name: "ANDROID_CREATOR",
    version: "25.03.101",
    client_id: "14",
    user_agent: "com.google.android.apps.youtube.creator/25.03.101 (Linux; U; Android 15; en_US; Pixel 9 Pro Fold; Build/AP3A.241005.015.A2; Cronet/132.0.6779.0)",
    os_name: Some("Android"),
    os_version: Some("15"),
    device_make: Some("Google"),
    device_model: Some("Pixel 9 Pro Fold"),
    android_sdk_version: Some("35"),
    use_signature_timestamp: true,
    is_embedded: false,
    use_web_po_tokens: false,
    attestation: AttestationPlatform::DroidGuard,
};

pub const IOS: YouTubeClient = YouTubeClient {
    name: "IOS",
    version: "19.29.1",
    client_id: "5",
    user_agent: "com.google.ios.youtube/19.29.1 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X; en_US)",
    os_name: Some("iOS"),
    os_version: Some("17.5.1"),
    device_make: Some("Apple"),
    device_model: Some("iPhone14,5"),
    android_sdk_version: None,
    use_signature_timestamp: true,
    is_embedded: false,
    use_web_po_tokens: false,
    attestation: AttestationPlatform::IosGuard,
};

pub const IPADOS: YouTubeClient = YouTubeClient {
    version: "21.03.3",
    user_agent: "com.google.ios.youtube/21.03.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)",
    os_name: Some("iPadOS"),
    os_version: Some("17.7.10.21H450"),
    device_model: Some("iPad7,6"),
    ..IOS
};

pub const WEB: YouTubeClient = YouTubeClient {
    name: "WEB",
    version: "2.20260120.01.00",
    client_id: "1",
    user_agent: USER_AGENT_WEB,
    os_name: Some("Windows"),
    os_version: Some("10.0"),
    device_make: None,
    device_model: None,
    android_sdk_version: None,
    use_signature_timestamp: true,
    is_embedded: false,
    use_web_po_tokens: true,
    attestation: AttestationPlatform::Web,
};

pub const WEB_REMIX: YouTubeClient = YouTubeClient {
    name: "WEB_REMIX",
    version: "1.20260213.01.00",
    client_id: "67",
    os_name: None,
    os_version: None,
    ..WEB
};

/// Charts backend (`charts.youtube.com`). Metadata only — it serves no streams.
pub const WEB_MUSIC_ANALYTICS: YouTubeClient = YouTubeClient {
    name: "WEB_MUSIC_ANALYTICS",
    version: "2.0",
    client_id: "31",
    use_signature_timestamp: false,
    use_web_po_tokens: false,
    ..WEB_REMIX
};

/// Embedded TV player — the age-restriction bypass, kept last in every chain.
pub const TVHTML5_SIMPLY_EMBEDDED_PLAYER: YouTubeClient = YouTubeClient {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    version: "2.0",
    client_id: "85",
    user_agent: "Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15",
    os_name: None,
    os_version: None,
    is_embedded: true,
    use_web_po_tokens: false,
    ..WEB
};

/// Every client the registry knows, for reverse lookup by name.
const ALL: &[YouTubeClient] = &[
    VISIONOS,
    ANDROID_VR,
    ANDROID,
    ANDROID_CREATOR,
    IOS,
    IPADOS,
    WEB,
    WEB_REMIX,
    WEB_MUSIC_ANALYTICS,
    TVHTML5_SIMPLY_EMBEDDED_PLAYER,
];

/// Resolve a client by its InnerTube `clientName`.
///
/// Where several builds share a name (the VR ones) this returns the canonical
/// one, which is all the callers that key off a `c=` URL parameter need — the
/// name is the only thing such a URL carries.
#[must_use]
pub fn by_name(name: &str) -> Option<&'static YouTubeClient> {
    ALL.iter()
        .find(|client| client.name.eq_ignore_ascii_case(name))
}
