//! Linux-only startup GPU/Wayland workarounds with a self-healing crash sentinel.
//!
//! WebKitGTK's GPU rendering paths abort or render a blank window on a range of
//! Linux setups (NVIDIA proprietary + Wayland, some Mesa stacks). WebKit declined
//! to detect and work around this itself — bug 262607 is RESOLVED WONTFIX, with
//! reports still landing against 2.46 — so the remedies have to live here. But
//! every one of them costs something, so none is applied until a launch has
//! actually failed to render:
//!
//! * Tier 0 (default): nothing. Upstream defaults are the fast path.
//! * Tier 1 (after 1 failed boot): disable explicit sync and the DMABUF renderer.
//! * Tier 2 (after 2 failed boots): also force software compositing.
//! * Tier 3 (after 3 failed boots): also fall back to X11 (XWayland).
//!
//! The order follows Tauri's Linux graphics guide, which lists these remedies
//! "in order. The earlier ones keep hardware acceleration" — and warns: "Only
//! ship an unconditional override like this if you have verified your app is
//! affected. It disables a faster path for everyone, including users on working
//! setups." `WEBKIT_DISABLE_DMABUF_RENDERER` used to be tier 0 here, which is
//! exactly the shape that warning describes: it removes "the faster rendering
//! path" from every Linux user to protect the minority whose GPU stack needs it.
//! The sentinel already identifies that minority, so it now gates the remedy.
//!
//! The cost of the move is bounded and one-sided: a machine that genuinely needs
//! the workaround renders blank once, then self-heals on the next launch. A
//! healthy machine gets accelerated rendering permanently instead of never.
//!
//! `__NV_DISABLE_EXPLICIT_SYNC` shares tier 1 rather than occupying its own rung.
//! It is the cheapest remedy — Tauri notes it "often fixes the Wayland `Error 71`
//! crash without a performance cost" — and it is inert outside the NVIDIA driver,
//! so pairing it with the DMABUF fallback costs a non-NVIDIA machine nothing
//! while sparing an affected one a second blank launch.
//!
//! A sentinel file counts consecutive boots that never reported a successful
//! render. The frontend calls `startup_render_ok` once mounted, which clears it;
//! a crash/abort before that leaves the count incremented so the next launch
//! escalates. Every variable stays user-overridable (only set when unset), so an
//! explicit `WEBKIT_DISABLE_DMABUF_RENDERER=0` from the user still wins.

use std::path::PathBuf;

const SENTINEL_FILE: &str = "startup_sentinel";
/// Highest tier we escalate to; also caps the persisted counter so an
/// unfixable machine (e.g. an AppImage packaging fault) stops climbing.
const MAX_TIER: u8 = 3;

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

/// The variables a tier applies. Split out from [`apply_tier`] so the escalation
/// ladder can be asserted without mutating this process's environment.
fn tier_vars(tier: u8) -> Vec<(&'static str, &'static str)> {
    // Tier 0 deliberately yields nothing — see the module docs.
    let mut vars = Vec::new();
    if tier >= 1 {
        vars.push(("__NV_DISABLE_EXPLICIT_SYNC", "1"));
        vars.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    if tier >= 2 {
        vars.push(("WEBKIT_DISABLE_COMPOSITING_MODE", "1"));
    }
    if tier >= 3 {
        vars.push(("GDK_BACKEND", "x11"));
    }
    vars
}

fn apply_tier(tier: u8) {
    for (key, value) in tier_vars(tier) {
        set_var_if_unset(key, value);
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

#[cfg(test)]
mod tests {
    use super::{MAX_TIER, tier_vars};

    fn keys(tier: u8) -> Vec<&'static str> {
        tier_vars(tier).into_iter().map(|(key, _)| key).collect()
    }

    /// The point of the ladder: a machine that renders fine is left alone. This
    /// was previously tier 0's job to *not* do, and it did it anyway.
    #[test]
    fn tier_0_applies_nothing() {
        assert!(tier_vars(0).is_empty());
    }

    #[test]
    fn tier_1_drops_the_gpu_paths_that_blank_the_window() {
        assert_eq!(
            keys(1),
            vec!["__NV_DISABLE_EXPLICIT_SYNC", "WEBKIT_DISABLE_DMABUF_RENDERER"],
        );
    }

    #[test]
    fn tier_2_adds_software_compositing() {
        assert!(keys(2).contains(&"WEBKIT_DISABLE_COMPOSITING_MODE"));
        assert!(!keys(1).contains(&"WEBKIT_DISABLE_COMPOSITING_MODE"));
    }

    #[test]
    fn tier_3_adds_the_x11_fallback() {
        assert!(keys(3).contains(&"GDK_BACKEND"));
        assert!(!keys(2).contains(&"GDK_BACKEND"));
    }

    /// Escalation must only ever add remedies: a higher tier that dropped one
    /// could un-fix a machine the tier below had already rescued.
    #[test]
    fn each_tier_is_a_superset_of_the_one_below() {
        for tier in 1..=MAX_TIER {
            let lower = keys(tier - 1);
            let higher = keys(tier);
            assert!(
                lower.iter().all(|key| higher.contains(key)),
                "tier {tier} dropped a variable set by tier {}",
                tier - 1,
            );
            assert!(higher.len() > lower.len(), "tier {tier} added nothing");
        }
    }

    /// Everything above MAX_TIER collapses to the same last-resort set, so a
    /// machine that can never render stops climbing instead of looping.
    #[test]
    fn tiers_are_capped_at_the_last_resort() {
        assert_eq!(keys(MAX_TIER), keys(MAX_TIER + 5));
    }
}
