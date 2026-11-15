//! The AI content filter, ported from Flow for Android (`data/contentfilter/aislist`): signed lists
//! downloaded about once a day while the viewer has them on. AiSList names channels that publish
//! AI-generated videos, which are hidden or labelled; the AI music list names artists whose music
//! is hidden. Reports go to AiSList itself.

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
