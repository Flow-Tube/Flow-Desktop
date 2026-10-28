//! Scrobbling to Last.fm, Libre.fm and `ListenBrainz`, ported from Flow for Android's
//! `data/scrobble`. The music player reports listens; counted listens wait in SQLite and a
//! background worker sends them, so offline listening loses nothing.

pub mod audioscrobbler;
pub mod credentials;
pub mod index;
pub mod listenbrainz;
pub mod models;
pub mod queue;
pub mod rules;
pub mod scrobbler;
pub mod worker;

/// Why a sign-in did not produce an account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignInError {
    /// The service refused the credentials; the text is the service's own message, if any.
    Rejected(String),
    /// The service could not be reached.
    Network(String),
}
