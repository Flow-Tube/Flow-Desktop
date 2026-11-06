//! Backup files both Flow apps can read. A backup keeps Flow for Android's layout (`app_data.json`,
//! `engine_brain.json`, `music_brain.json`, a manifest for profiles) and carries the desktop's own
//! full-fidelity export under an extra `desktop` key Android's parser skips.

// App names read as code to this lint. The casts convert between Android's millisecond and float
// fields and the desktop's, on values clamped first or far below where precision runs out.
#![allow(
    clippy::doc_markdown,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]

pub mod android_brain;
pub mod app_data;
pub mod archive;
pub mod auto;
pub mod build;
pub mod exports;
pub mod import;
pub mod reader;

/// Settings the schema marks `private`. They never enter a backup file, even if a caller asks for
/// them; `src/lib/settings/backupPrivacy.test.ts` keeps this list equal to the schema.
pub const NEVER_BACKED_UP: [&str; 4] = [
    "blocked_reveal_pin",
    "proxy_username",
    "proxy_password",
    "sponsorblock_user_id",
];

#[must_use]
pub fn is_never_backed_up(key: &str) -> bool {
    NEVER_BACKED_UP.contains(&key)
}
