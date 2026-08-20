//! The music stream-resolution fallback order.
//!
//! Client identities themselves live in [`crate::api::innertube::core::clients`]
//! — this module only decides which of them the audio resolver walks, and in what
//! order. The desktop has **no JS cipher/n-sig solver**, so every client here must
//! return *direct* (un-ciphered, un-throttled) audio URLs; web clients are used
//! for metadata via `WEB_REMIX` but never for stream resolution.

pub use crate::api::innertube::core::clients::YouTubeClient as MusicClient;
use crate::api::innertube::core::clients::{
    ANDROID, ANDROID_CREATOR, ANDROID_VR, ANDROID_VR_1_43_32, ANDROID_VR_NO_AUTH,
    TVHTML5_SIMPLY_EMBEDDED_PLAYER, VISIONOS,
};

pub use crate::api::innertube::core::clients::WEB_REMIX;

/// Ordered fallback chain for **direct** audio stream resolution.
///
/// VISIONOS leads: it is the only direct client googlevideo still serves past the
/// first minute without a PO token, which is what used to cut tracks off mid-play
/// and stall playlists. The VR builds follow (1.43.32 first — non-ABR, smoothest
/// for music), then the Android phone/creator clients, then the embedded TV player
/// as an age-restriction bypass.
///
/// IOS and IPADOS were removed: they now return SABR-only responses carrying no
/// direct URLs at all, so every attempt cost a round trip and produced nothing.
/// They were also the two clients being handed a BotGuard token that iOSGuard
/// clients cannot use — see `AttestationPlatform`.
pub const DIRECT_AUDIO_CLIENTS: &[MusicClient] = &[
    VISIONOS,
    ANDROID_VR_1_43_32,
    ANDROID_VR,
    ANDROID_VR_NO_AUTH,
    ANDROID,
    ANDROID_CREATOR,
    TVHTML5_SIMPLY_EMBEDDED_PLAYER,
];
