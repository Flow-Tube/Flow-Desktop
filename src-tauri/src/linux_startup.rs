//! Linux-only startup GPU/Wayland workarounds with a self-healing crash sentinel.
//!
//! WebKitGTK's GPU rendering paths abort or render a blank window on a range of
//! Linux setups (NVIDIA proprietary + Wayland, some Mesa stacks). A single fixed
//! set of `WEBKIT_*`/`GDK_*` env vars either under-covers the crashiest machines
//! or forces slow software compositing on healthy ones — and users on issues #29
//! and #31 already report software-rendering scroll lag. So we escalate through
//! tiers only when a launch actually fails to render:
//!
//! * Tier 0 (always): disable the DMABUF renderer — the most common culprit, and
//!   confirmed by an issue #31 retest not to regress UI smoothness.
//! * Tier 1 (after 1 failed boot): also force software compositing.
//! * Tier 2 (after 2 failed boots): also fall back to X11 (XWayland).
//!
//! A sentinel file counts consecutive boots that never reported a successful
//! render. The frontend calls `startup_render_ok` once mounted, which clears it;
//! a crash/abort before that leaves the count incremented so the next launch
//! escalates. Every variable stays user-overridable (only set when unset), so an
//! explicit `WEBKIT_DISABLE_COMPOSITING_MODE=0` from the user still wins.

use std::path::PathBuf;

const SENTINEL_FILE: &str = "startup_sentinel";
/// Highest tier we escalate to; also caps the persisted counter so an
/// unfixable machine (e.g. an AppImage packaging fault) stops climbing.
const MAX_TIER: u8 = 2;

/// What [`begin`] applied this launch, logged once tracing is live.
#[derive(Clone, Copy)]
pub struct BootReport {
    pub tier: u8,
    pub failed_boots: u8,
}

/// Mirrors Tauri's `app_data_dir()` on Linux (`$XDG_DATA_HOME` or
/// `~/.local/share`, joined with the bundle identifier) so the sentinel lives
/// beside the rolling logs, and the `startup_render_ok` command — which resolves
/// the same path from the running app's identifier — clears exactly this file.
fn data_dir(identifier: &str) -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join(identifier))
}

fn sentinel_path(identifier: &str) -> Option<PathBuf> {
    Some(data_dir(identifier)?.join(SENTINEL_FILE))
}

fn set_var_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        // SAFETY: called at the very start of `run()`, before the Tauri builder
        // spawns any threads or initializes GTK/WebKitGTK.
        unsafe { std::env::set_var(key, value) };
    }
}

fn apply_tier(tier: u8) {
    set_var_if_unset("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    if tier >= 1 {
        set_var_if_unset("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    if tier >= 2 {
        set_var_if_unset("GDK_BACKEND", "x11");
    }
}

/// Reads the crash sentinel, applies the matching workaround tier, then persists
/// an incremented count *before* the webview is built so a startup crash/abort is
/// remembered. Call once, first thing in `run()` and before any GTK init.
pub fn begin(identifier: &str) -> BootReport {
    let failed_boots = sentinel_path(identifier)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| raw.trim().parse::<u8>().ok())
        .unwrap_or(0);
    let tier = failed_boots.min(MAX_TIER);
    apply_tier(tier);

    if let Some(path) = sentinel_path(identifier) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // Cap the stored value one past MAX_TIER; further crashes can't escalate.
        let next = failed_boots.saturating_add(1).min(MAX_TIER + 1);
        let _ = std::fs::write(path, next.to_string());
    }

    BootReport { tier, failed_boots }
}

/// Clears the sentinel after a confirmed successful render, resetting the tier
/// for the next launch. Invoked from the `startup_render_ok` command.
pub fn clear(identifier: &str) {
    if let Some(path) = sentinel_path(identifier) {
        let _ = std::fs::remove_file(path);
    }
}
