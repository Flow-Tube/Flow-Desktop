pub mod apply;
pub mod brainmap;
pub mod canonical;
pub mod codec;
pub mod compat;
pub mod crypto;
pub mod error;
pub mod export;
pub mod frames;
pub mod identity;
pub mod ledger;
pub mod mapping;
pub mod merge;
pub mod protocol;
pub mod qr;
pub mod session;
pub mod transport;

/// `FLOW-SYNC` protocol version implemented by this build.
pub const PROTOCOL_VERSION: u8 = 1;
