//! FLOW-SYNC/2: linked devices over an untrusted store. The specification and the shared test
//! vectors live in the `Flow-Tube/flow-sync` repository; this module follows them byte for byte.

#![allow(clippy::must_use_candidate)]

pub mod actions;
pub mod batches;
pub mod blob;
pub mod bootstrap;
pub mod codes;
pub mod curve;
pub mod device;
pub mod engine;
pub mod entries;
pub mod envelope;
pub mod epoch;
pub mod error;
pub mod gc;
pub mod group_store;
pub mod held;
pub mod http;
pub mod join_requests;
pub mod kdf;
pub mod keys;
pub mod lan;
pub mod lan_link;
pub mod lan_runtime;
pub mod lan_sync;
pub mod link_task;
pub mod linking;
pub mod live;
pub mod mailbox;
pub mod membership;
pub mod meta;
pub mod names;
pub mod pairing;
pub mod paths;
pub mod payload;
pub mod pipe;
pub mod plain;
pub mod recovery;
pub mod recovery_flow;
pub mod roster;
pub mod sealed;
pub mod server;
pub mod service;
pub mod setup;
pub mod snapshot;
pub mod state;
pub mod store;
pub mod webdav;
pub mod wrap;

pub use error::{Error, Result};

/// Copies a slice whose length the caller has already fixed.
fn array<const N: usize>(bytes: &[u8]) -> [u8; N] {
    let mut out = [0; N];
    out.copy_from_slice(bytes);
    out
}
