//! Key spec 2: how text becomes the topic keys the engine learns, ranks and syncs by. A port of
//! Flow for Android's `NeuroKeySpec` pipeline; both apps pass Android's
//! `key_spec_golden.json`, so a brain synced between them holds one key per word.
//!
//! 1. Fold: NFKC, small capitals, lowercase, one apostrophe ([`text::fold`]).
//! 2. Split at whitespace and punctuation; unspaced scripts by dictionary.
//! 3. Expressions: written variants read as one key ("lo-fi" reads "lofi").
//! 4. Possessives and French and Italian elisions come off.
//! 5. Stop words, years, bare numbers, short words and punctuation end a chunk.
//! 6. Runs of two or three words inside one chunk are candidates.
//! 7. A run becomes a key once it is a phrase, a tag or a catalog topic.
//! 8. Each word's lemma is stemmed by its script and the key language.

mod chars;
pub mod tables;
pub mod text;

/// The key spec version Android advertises in sync (`NeuroKeySpec.VERSION`).
pub const VERSION: u32 = 2;
