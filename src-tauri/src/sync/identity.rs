//! Device identity for Flow Local Sync.
//!
//! Each install has a stable `device_id` (UUID v4, persisted under the settings key
//! `sync_device_id`) and a human-readable `device_name`. Persistence is left to the caller so this
//! module stays pure.

#![allow(clippy::must_use_candidate)]

/// The settings key under which the stable device id is persisted.
pub const DEVICE_ID_SETTING_KEY: &str = "sync_device_id";

/// Generate a fresh, stable device id (UUID v4). Call once per install, then persist.
pub fn new_device_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// A friendly default device name with this computer's name, e.g. `"Flow Desktop (MY-PC -
/// Windows)"`, so two installs read apart in a group. A debug build adds `Dev`.
pub fn default_device_name() -> String {
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    let host = gethostname::gethostname()
        .into_string()
        .ok()
        .and_then(|name| {
            // `MacBook-Pro.local` reads as `MacBook-Pro`.
            let short = name.split('.').next().unwrap_or_default().trim().to_owned();
            (!short.is_empty() && short != "localhost").then_some(short)
        });

    let label = match (host, cfg!(debug_assertions)) {
        (Some(host), true) => format!("{host} - {os}, Dev"),
        (Some(host), false) => format!("{host} - {os}"),
        (None, true) => format!("{os}, Dev"),
        (None, false) => os.to_string(),
    };

    format!("Flow Desktop ({label})")
}

// Tests for this module live in `tests/sync_phase1.rs` (integration test) — see the note in
// `canonical.rs` on why in-crate unit tests can't run on this Tauri crate.
