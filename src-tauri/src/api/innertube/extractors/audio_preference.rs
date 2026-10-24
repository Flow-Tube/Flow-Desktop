//! Which of an audio format's twins to play: the site's stable-volume copy
//! (dynamic-range compressed, quiet and loud parts evened out) or the normal one.

use std::sync::atomic::{AtomicBool, Ordering};

/// The setting that asks for the stable-volume copy.
pub const STABLE_VOLUME_SETTING: &str = "stable_volume_enabled";

static STABLE_VOLUME: AtomicBool = AtomicBool::new(false);

pub fn set_stable_volume(enabled: bool) {
    STABLE_VOLUME.store(enabled, Ordering::Relaxed);
}

#[must_use]
pub fn prefers_stable_volume() -> bool {
    STABLE_VOLUME.load(Ordering::Relaxed)
}
