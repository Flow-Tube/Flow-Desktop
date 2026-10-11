//! Shared error type for the Flow Local Sync transport/protocol layers.

use tokio_tungstenite::tungstenite::Error as WsError;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("connection closed by peer")]
    ConnectionClosed,
    #[error(transparent)]
    Crypto(#[from] crate::sync::crypto::CryptoError),
    #[error(transparent)]
    Qr(#[from] crate::sync::qr::QrError),
    #[error("codec: {0}")]
    Codec(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("frame out of order: expected seq {expected}, got {got}")]
    SeqMismatch { expected: u64, got: u64 },
    #[error("payload hash mismatch for collection {collection}")]
    HashMismatch { collection: String },
    #[error("db: {0}")]
    Db(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
    #[error("the other device reported an error [{code}]: {message}")]
    Peer { code: String, message: String },
    #[error("the other device uses sync protocol {0}, which this version doesn't support")]
    UnsupportedVersion(u8),
    #[error("this sync code has expired")]
    Expired,
    #[error("no device connected before the code expired")]
    NoPeer,
    #[error("a sync session is already active")]
    Busy,
    #[error("couldn't save the received data: {0}")]
    Apply(String),
}

impl SyncError {
    /// Stable camelCase kind the frontend switches on to show a translated, actionable message.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            SyncError::Qr(crate::sync::qr::QrError::Address(_)) => "syncInvalidAddress",
            SyncError::Qr(_) => "syncInvalidCode",
            SyncError::Expired => "syncExpired",
            SyncError::NoPeer => "syncNoPeer",
            SyncError::Busy => "syncBusy",
            SyncError::Transport(_) | SyncError::Io(_) => "syncUnreachable",
            SyncError::ConnectionClosed => "syncPeerClosed",
            SyncError::Timeout(_) => "syncTimeout",
            SyncError::Peer { code, .. } if code == "sas_rejected" => "syncCodeRejected",
            SyncError::Peer { .. } => "syncPeerError",
            SyncError::UnsupportedVersion(_) => "syncUnsupportedVersion",
            SyncError::HashMismatch { .. } => "syncCorrupted",
            SyncError::Apply(_) | SyncError::Db(_) => "syncApplyFailed",
            SyncError::Crypto(_)
            | SyncError::Codec(_)
            | SyncError::Json(_)
            | SyncError::Protocol(_)
            | SyncError::SeqMismatch { .. } => "syncProtocol",
        }
    }

    /// The `ERROR` frame code to send before closing, or `None` when telling the peer is pointless:
    /// it already knows (it closed or reported the error) or the channel itself is broken. Codes
    /// follow the Android client's (`sas_rejected`, `hash_mismatch`).
    #[must_use]
    pub fn wire_code(&self) -> Option<&'static str> {
        match self {
            SyncError::HashMismatch { .. } => Some("hash_mismatch"),
            SyncError::Timeout(_) => Some("timeout"),
            SyncError::UnsupportedVersion(_) => Some("unsupported_version"),
            SyncError::Apply(_) | SyncError::Db(_) => Some("apply_failed"),
            SyncError::Json(_) | SyncError::Codec(_) | SyncError::Protocol(_) => {
                Some("protocol_error")
            }
            SyncError::ConnectionClosed
            | SyncError::Peer { .. }
            | SyncError::Transport(_)
            | SyncError::Io(_)
            | SyncError::Crypto(_)
            | SyncError::SeqMismatch { .. }
            | SyncError::Qr(_)
            | SyncError::Expired
            | SyncError::NoPeer
            | SyncError::Busy => None,
        }
    }
}

impl From<sqlx::Error> for SyncError {
    fn from(e: sqlx::Error) -> Self {
        SyncError::Db(e.to_string())
    }
}

impl From<WsError> for SyncError {
    fn from(e: WsError) -> Self {
        match e {
            WsError::ConnectionClosed | WsError::AlreadyClosed => SyncError::ConnectionClosed,
            other => SyncError::Transport(other.to_string()),
        }
    }
}
