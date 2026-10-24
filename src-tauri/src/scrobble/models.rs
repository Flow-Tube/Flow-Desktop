use std::fmt;

use serde::{Deserialize, Serialize};

/// The services Flow can scrobble to. The names are stored, so never rename them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Service {
    #[serde(rename = "LASTFM")]
    LastFm,
    #[serde(rename = "LIBREFM")]
    LibreFm,
    #[serde(rename = "LISTENBRAINZ")]
    ListenBrainz,
}

impl Service {
    pub const ALL: [Service; 3] = [Service::LastFm, Service::LibreFm, Service::ListenBrainz];

    pub fn as_str(self) -> &'static str {
        match self {
            Service::LastFm => "LASTFM",
            Service::LibreFm => "LIBREFM",
            Service::ListenBrainz => "LISTENBRAINZ",
        }
    }

    /// Loves need `MusicBrainz` ids on `ListenBrainz`, so only the Audioscrobbler services take them.
    pub fn takes_loves(self) -> bool {
        self != Service::ListenBrainz
    }
}

/// One counted listen, as every service needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScrobbleEntry {
    pub artist: String,
    pub title: String,
    pub album: String,
    pub duration_sec: u32,
    pub timestamp_sec: i64,
    pub from_youtube: bool,
}

/// A like or unlike to mirror as a love on Last.fm and Libre.fm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoveEntry {
    pub artist: String,
    pub title: String,
    pub loved: bool,
}

/// A signed-in account: the name to show and the session key or token the service gave.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub user_name: String,
    pub secret: String,
}

impl fmt::Debug for Account {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Account")
            .field("user_name", &self.user_name)
            .field("secret", &"<redacted>")
            .finish()
    }
}

/// What one attempt to send left behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    /// Network trouble or the service is down; keep the entries and try later.
    Retry,
    /// The service no longer accepts the account; the listener has to sign in again.
    SignedOut,
}
