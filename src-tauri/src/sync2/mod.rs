//! FLOW-SYNC/2: linked devices over an untrusted store. The specification and the shared test
//! vectors live in the `Flow-Tube/flow-sync` repository; this module follows them byte for byte.

#![allow(clippy::must_use_candidate)]

pub mod actions;
pub mod batches;
pub mod blob;
pub mod curve;
pub mod device;
pub mod engine;
pub mod entries;
pub mod envelope;
pub mod epoch;
pub mod error;
pub mod kdf;
pub mod keys;
pub mod lan;
pub mod link_task;
pub mod linking;
pub mod mailbox;
pub mod membership;
pub mod meta;
pub mod names;
pub mod pairing;
pub mod paths;
pub mod payload;
pub mod recovery;
pub mod recovery_flow;
pub mod roster;
pub mod sealed;
pub mod server;
pub mod service;
pub mod setup;
pub mod state;
pub mod store;
pub mod wrap;

pub use error::{Error, Result};

/// Copies a slice whose length the caller has already fixed.
fn array<const N: usize>(bytes: &[u8]) -> [u8; N] {
    let mut out = [0; N];
    out.copy_from_slice(bytes);
    out
}
