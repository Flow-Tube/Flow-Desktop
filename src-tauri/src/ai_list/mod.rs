//! The AiSList channel filter, ported from Flow for Android (`data/contentfilter/aislist`): a
//! signed list of channels that publish AI-generated videos, downloaded about once a day while the
//! viewer has it on, which hides or labels those channels' videos. Reports go to AiSList itself.

// AiSList and YouTube read as code to this lint.
#![allow(clippy::doc_markdown)]

pub mod envelope;
pub mod fetcher;
pub mod formats;
pub mod handle;
pub mod handle_index;
pub mod matcher;
pub mod reporter;
pub mod service;
pub mod source;
pub mod store;
pub mod updater;

pub use service::AiListService;
