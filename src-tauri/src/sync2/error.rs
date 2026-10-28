/// Every way an object, key or message can be rejected. `code()` matches the error codes the
/// shared test vectors name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("wrong length")]
    Length,
    #[error("not a FLOW-SYNC/2 object")]
    Magic,
    #[error("unsupported type or suite")]
    Suite,
    #[error("object belongs to another group")]
    Group,
    #[error("sender is not a member")]
    Sender,
    #[error("signature does not verify")]
    Signature,
    #[error("object was already read")]
    Replay,
    #[error("objects are missing before this one")]
    Gap,
    #[error("object does not follow the previous one")]
    Prev,
    #[error("box key commitment does not match")]
    Commitment,
    #[error("decryption failed")]
    Decrypt,
    #[error("malformed payload")]
    Payload,
    #[error("blob does not match its hash")]
    BlobHash,
    #[error("epoch key does not match the roster")]
    KeyCommitment,
    #[error("invalid X25519 key agreement")]
    X25519,
}

impl Error {
    pub fn code(self) -> &'static str {
        match self {
            Self::Length => "length",
            Self::Magic => "magic",
            Self::Suite => "suite",
            Self::Group => "group",
            Self::Sender => "sender",
            Self::Signature => "signature",
            Self::Replay => "replay",
            Self::Gap => "gap",
            Self::Prev => "prev",
            Self::Commitment => "commitment",
            Self::Decrypt => "decrypt",
            Self::Payload => "payload",
            Self::BlobHash => "blob-hash",
            Self::KeyCommitment => "key-commitment",
            Self::X25519 => "x25519",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
