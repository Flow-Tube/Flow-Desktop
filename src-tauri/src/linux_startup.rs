//! Linux-only startup GPU/Wayland workarounds with a self-healing launch record.
//!
//! WebKitGTK's GPU rendering paths abort or render a blank window on a range of
//! Linux setups (NVIDIA proprietary + Wayland, some Mesa stacks). WebKit declined
//! to detect and work around this itself — bug 262607 is RESOLVED WONTFIX, with
//! reports still landing against 2.46 — so the remedies have to live here. But
//! every one of them costs something, so none is applied until a launch has
//! actually failed to render, except where the failure is already known:
//!
//! * Tier 0 (default): nothing. Upstream defaults are the fast path.
//! * Tier 1: disable explicit sync, and move rendered frames through shared
//!   memory instead of DMABUF (`WEBKIT_DMABUF_RENDERER_FORCE_SHM`).
//! * Tier 2: also disable the DMABUF renderer and compositing, which is CPU
//!   rendering.
//! * Tier 3: also fall back to X11 (XWayland), when an X server is reachable.
//!
//! From WebKitGTK 2.44 the DMABUF renderer is the only accelerated path: with
//! `WEBKIT_DISABLE_DMABUF_RENDERER` set, `canUseHardwareAcceleration()` is false
//! and compositing goes with it. Tier 1 used to set exactly that, so the NVIDIA
//! preset below put those machines on the CPU, which is what makes scrolling
//! stutter. Shared memory keeps GPU rendering and only changes how finished
//! frames reach the UI process. Older WebKitGTK still had separate Wayland and
//! X11 backends, so it keeps the old tier 1 (DMABUF off only).
//!
//! The order follows Tauri's Linux graphics guide, which lists these remedies
//! "in order. The earlier ones keep hardware acceleration" — and warns: "Only
//! ship an unconditional override like this if you have verified your app is
//! affected. It disables a faster path for everyone, including users on working
//! setups."
//!
//! A state file remembers the tier of the last launch that confirmed a render
//! and counts launches since that never did. Each failed launch adds a tier on
//! top of the remembered one; a confirmed render records the tier that worked.
//! Deleting the record on success instead (as this module once did) sends a
//! machine that needs tier 1 back to tier 0 on every other launch.
//!
//! The frontend confirms a render once React mounts. A window that stays blank
//! while its page runs still confirms, so the sentinel can't see that failure.
//! Two things cover it: NVIDIA proprietary on Wayland, the known case, starts at
//! tier 1 (Debian and Gentoo patch the same rule into their own WebKitGTK), and
//! `--safe-graphics` / `FLOW_SAFE_GRAPHICS=1` forces tier 3 for one launch. A
//! render confirmed under it is remembered like any other, so the next normal
//! launch keeps working. The user can also set a floor in Settings.
//!
//! A new app version may ship a WebKitGTK that fixed the machine, so the first
//! launch of a version tries one tier below the remembered one, never below the
//! NVIDIA or user floor. If that fails, the next launch climbs back.
//!
//! `__NV_DISABLE_EXPLICIT_SYNC` shares tier 1 rather than occupying its own rung.
//! It is the cheapest remedy — Tauri notes it "often fixes the Wayland `Error 71`
//! crash without a performance cost" — and it is inert outside the NVIDIA driver.
//!
//! Every variable stays user-overridable (only set when unset), so an explicit
//! `WEBKIT_DISABLE_DMABUF_RENDERER=0` from the user still wins.

use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::Path;

const STATE_FILE: &str = "startup_state.json";
/// The bare failure counter this module used before the state file.
const LEGACY_SENTINEL_FILE: &str = "startup_sentinel";
/// Highest tier we escalate to; also caps the failure count so an unfixable
/// machine (e.g. an AppImage packaging fault) stops climbing.
const MAX_TIER: u8 = 3;
/// First WebKitGTK release where the DMABUF renderer is the only accelerated
/// path and `WEBKIT_DMABUF_RENDERER_FORCE_SHM` exists.
const SHM_TRANSPORT_SINCE: (u32, u32) = (2, 44);
#[cfg(target_os = "linux")]
const SAFE_GRAPHICS_ARG: &str = "--safe-graphics";
#[cfg(any(target_os = "linux", test))]
const LOCK_FILE: &str = "startup.lock";

/// The user's choice in Settings, applied as a minimum tier.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GraphicsMode {
    #[default]
    Automatic,
    Compatible,
    Safe,
}

impl GraphicsMode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Compatible => "compatible",
            Self::Safe => "safe",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        [Self::Automatic, Self::Compatible, Self::Safe]
            .into_iter()
            .find(|mode| mode.as_str() == value)
    }

    fn floor(self) -> u8 {
        match self {
            Self::Automatic => 0,
            Self::Compatible => 1,
            Self::Safe => MAX_TIER,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
struct StartupState {
    /// Tier of the last launch that confirmed a render.
    good_tier: Option<u8>,
    /// App version of that launch.
    good_version: Option<String>,
    /// Launches since then that never confirmed a render.
    failed_boots: u8,
    /// Tier the current, or last unconfirmed, launch used.
    pending_tier: u8,
    mode: GraphicsMode,
}

/// What this machine and this launch ask for, read once before GTK starts.
#[derive(Clone, Copy, Debug, Default)]
struct LaunchFacts {
    nvidia_wayland: bool,
    user_set_dmabuf: bool,
    safe_graphics: bool,
}

impl LaunchFacts {
    fn nvidia_preset(self) -> bool {
        self.nvidia_wayland && !self.user_set_dmabuf
    }
}

impl StartupState {
    fn choose_tier(&self, version: &str, facts: LaunchFacts) -> u8 {
        if facts.safe_graphics {
            return MAX_TIER;
        }
        let floor = u8::from(facts.nvidia_preset()).max(self.mode.floor());
        let base = match self.good_tier {
            Some(good) if self.good_version.as_deref() == Some(version) => good,
            Some(good) => good.saturating_sub(1),
            None => 0,
        };
        base.saturating_add(self.failed_boots)
            .max(floor)
            .min(MAX_TIER)
    }

    /// Recorded before the webview is built, so a crash or abort is remembered.
    fn launched(&mut self, tier: u8) {
        self.pending_tier = tier;
        // One past MAX_TIER is enough; further crashes can't escalate.
        self.failed_boots = self.failed_boots.saturating_add(1).min(MAX_TIER + 1);
    }

    fn confirmed(&mut self, version: &str) {
        self.good_tier = Some(self.pending_tier);
        self.good_version = Some(version.to_owned());
        self.failed_boots = 0;
    }

    fn crash_looped(&mut self) {
        self.failed_boots = self.failed_boots.saturating_add(1).min(MAX_TIER + 1);
    }
}

/// What [`begin`] applied this launch, logged once tracing is live.
#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug)]
pub struct BootReport {
    pub tier: u8,
    pub failed_boots: u8,
    pub nvidia_preset: bool,
    pub safe_graphics: bool,
    pub mode: GraphicsMode,
}

#[cfg(any(target_os = "linux", test))]
impl BootReport {
    /// Why this launch used its tier, for the About tab and bug reports.
    #[must_use]
    pub fn tier_reason(self) -> &'static str {
        if self.safe_graphics {
            "safe-graphics-launch"
        } else if self.tier == 0 {
            "default"
        } else if self.mode != GraphicsMode::Automatic && self.tier == self.mode.floor() {
            "settings"
        } else if self.failed_boots > 0 {
            "failed-launches"
        } else if self.nvidia_preset && self.tier == 1 {
            "nvidia-wayland"
        } else {
            "remembered"
        }
    }
}

#[cfg(target_os = "linux")]
static BOOT_REPORT: std::sync::OnceLock<BootReport> = std::sync::OnceLock::new();

/// What this launch applied, once [`begin`] ran.
#[cfg(target_os = "linux")]
#[must_use]
pub fn boot_report() -> Option<BootReport> {
    BOOT_REPORT.get().copied()
}

/// Mirrors Tauri's `app_data_dir()` on Linux (`$XDG_DATA_HOME` or
/// `~/.local/share`, joined with the bundle identifier) so the state file lives
/// beside the rolling logs, and the commands — which resolve the same path from
/// the running app's identifier — read and write exactly this file.
#[cfg(target_os = "linux")]
fn data_dir(identifier: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join(identifier))
}

fn load_state(dir: &Path) -> StartupState {
    if let Some(state) = std::fs::read_to_string(dir.join(STATE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
    {
        return state;
    }
    let legacy = dir.join(LEGACY_SENTINEL_FILE);
    let failed_boots = std::fs::read_to_string(&legacy)
        .ok()
        .and_then(|raw| raw.trim().parse::<u8>().ok())
        .unwrap_or(0);
    let _ = std::fs::remove_file(legacy);
    StartupState {
        failed_boots,
        ..StartupState::default()
    }
}

fn write_state(dir: &Path, state: &StartupState) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let raw = serde_json::to_string(state).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(STATE_FILE), raw)
}

/// For the launch path, where a read-only data dir must not stop the app.
fn save_state(dir: &Path, state: &StartupState) {
    let _ = write_state(dir, state);
}

/// The variables a tier applies. Split out from [`apply_tier`] so the escalation
/// ladder can be asserted without mutating this process's environment.
fn tier_vars(
    tier: u8,
    x11_available: bool,
    shm_transport: bool,
) -> Vec<(&'static str, &'static str)> {
    // Tier 0 deliberately yields nothing — see the module docs.
    let mut vars = Vec::new();
    if tier >= 1 {
        vars.push(("__NV_DISABLE_EXPLICIT_SYNC", "1"));
        if shm_transport {
            vars.push(("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"));
        } else {
            vars.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
        }
    }
    if tier >= 2 {
        if shm_transport {
            vars.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
        }
        vars.push(("WEBKIT_DISABLE_COMPOSITING_MODE", "1"));
    }
    if tier >= 3 && x11_available {
        vars.push(("GDK_BACKEND", "x11"));
    }
    vars
}

fn has_shm_transport(version: Option<(u32, u32)>) -> bool {
    version.is_some_and(|version| version >= SHM_TRANSPORT_SINCE)
}

/// The WebKitGTK library this process loaded, not the one it was built against.
/// These calls only read constants, so they are safe before GTK starts.
#[cfg(target_os = "linux")]
fn webkit_version() -> Option<(u32, u32)> {
    // SAFETY: plain getters with no arguments and no preconditions.
    let (major, minor) = unsafe {
        (
            webkit2gtk::ffi::webkit_get_major_version(),
            webkit2gtk::ffi::webkit_get_minor_version(),
        )
    };
    (major > 0).then_some((major, minor))
}

/// Forcing X11 without an X server leaves GTK unable to open any window. That
/// is the case on a Wayland session without Xwayland, and inside a Flatpak with
/// `--socket=fallback-x11`, which hides the X socket whenever Wayland is up.
fn x11_available(display: Option<&OsStr>) -> bool {
    display.is_some_and(|display| !display.is_empty())
}

/// GTK's Wayland input module segfaults under X11, so a session that exported
/// `GTK_IM_MODULE=wayland` would crash in the X11 fallback meant to rescue it.
fn drops_im_module(gdk_backend: Option<&str>, im_module: Option<&str>) -> bool {
    gdk_backend == Some("x11") && im_module.is_some_and(|module| module.starts_with("wayland"))
}

#[cfg(target_os = "linux")]
impl LaunchFacts {
    fn read() -> Self {
        let nvidia = Path::new("/proc/driver/nvidia/version").exists()
            || Path::new("/sys/module/nvidia_drm").exists();
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("GDK_BACKEND").map_or(true, |backend| backend.contains("wayland"));
        let user_set_dmabuf = [
            "WEBKIT_DISABLE_DMABUF_RENDERER",
            "WEBKIT_FORCE_DMABUF_RENDERER",
            "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
        ]
        .iter()
        .any(|key| std::env::var_os(key).is_some());
        let safe_graphics = std::env::args_os().any(|arg| arg == SAFE_GRAPHICS_ARG)
            || std::env::var_os("FLOW_SAFE_GRAPHICS").is_some_and(|value| value == "1");
        Self {
            nvidia_wayland: nvidia && wayland,
            user_set_dmabuf,
            safe_graphics,
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_tier(tier: u8, shm_transport: bool) {
    // SAFETY (every env write below): called at the very start of `run()`,
    // before the Tauri builder spawns any threads or initializes GTK/WebKitGTK.
    let x11 = x11_available(std::env::var_os("DISPLAY").as_deref());
    for (key, value) in tier_vars(tier, x11, shm_transport) {
        if std::env::var_os(key).is_none() {
            unsafe { std::env::set_var(key, value) };
        }
    }
    let backend = std::env::var("GDK_BACKEND").ok();
    let im_module = std::env::var("GTK_IM_MODULE").ok();
    if drops_im_module(backend.as_deref(), im_module.as_deref()) {
        unsafe { std::env::remove_var("GTK_IM_MODULE") };
    }
}

/// Held by the instance that recorded its launch, until it exits or relaunches.
#[cfg(target_os = "linux")]
static LAUNCH_LOCK: std::sync::Mutex<Option<std::fs::File>> = std::sync::Mutex::new(None);

#[cfg(any(target_os = "linux", test))]
#[derive(Debug)]
enum LaunchLock {
    Held(std::fs::File),
    /// Another instance holds it.
    Busy,
    /// No lock file could be opened or locked.
    Unavailable,
}

/// Whether this process may record a launch. A second launch while Flow runs (a
/// `flow://` link, the launcher, a desktop action) is handed to the running
/// window by the single-instance plugin and exits, so it never renders. That
/// plugin only starts after this module, so without the lock every second
/// launch counted as a failed startup and pushed the next cold start a tier up.
#[cfg(any(target_os = "linux", test))]
fn try_launch_lock(dir: &Path) -> LaunchLock {
    let _ = std::fs::create_dir_all(dir);
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_FILE))
    else {
        return LaunchLock::Unavailable;
    };
    match file.try_lock() {
        Ok(()) => LaunchLock::Held(file),
        Err(std::fs::TryLockError::WouldBlock) => LaunchLock::Busy,
        Err(std::fs::TryLockError::Error(_)) => LaunchLock::Unavailable,
    }
}

/// Keeps the lock for this process's lifetime. Without a lock at all, records
/// as before: a data dir that can't hold a lock can't hold the state file either.
#[cfg(target_os = "linux")]
fn take_launch_lock(dir: &Path) -> bool {
    match try_launch_lock(dir) {
        LaunchLock::Held(file) => {
            if let Ok(mut held) = LAUNCH_LOCK.lock() {
                *held = Some(file);
            }
            true
        }
        LaunchLock::Busy => false,
        LaunchLock::Unavailable => true,
    }
}

/// Lets the process [`crate::relaunch`] starts record its own launch. It starts
/// while this one is still exiting.
#[cfg(target_os = "linux")]
pub fn release_launch_lock() {
    if let Ok(mut held) = LAUNCH_LOCK.lock() {
        held.take();
    }
}

/// Picks and applies this launch's tier, then records the launch *before* the
/// webview is built so a startup crash/abort is remembered. Call once, first
/// thing in `run()` and before any GTK init.
#[cfg(target_os = "linux")]
pub fn begin(identifier: &str, version: &str) -> BootReport {
    let dir = data_dir(identifier);
    let mut state = dir.as_deref().map(load_state).unwrap_or_default();
    let facts = LaunchFacts::read();
    let tier = state.choose_tier(version, facts);
    apply_tier(tier, has_shm_transport(webkit_version()));
    let first_instance = dir.as_deref().is_none_or(take_launch_lock);

    let report = BootReport {
        tier,
        failed_boots: state.failed_boots,
        nvidia_preset: facts.nvidia_preset(),
        safe_graphics: facts.safe_graphics,
        mode: state.mode,
    };
    let _ = BOOT_REPORT.set(report);
    if first_instance {
        state.launched(tier);
        if let Some(dir) = dir {
            save_state(&dir, &state);
        }
    }
    report
}

/// Called when the web process keeps crashing after the page already rendered,
/// so the confirmed tier is not enough on this machine. The next launch starts
/// one tier higher, as after a launch that never rendered.
#[cfg(target_os = "linux")]
pub fn record_crash_loop(identifier: &str) {
    let Some(dir) = data_dir(identifier) else {
        return;
    };
    let mut state = load_state(&dir);
    state.crash_looped();
    save_state(&dir, &state);
}

/// Records that this launch rendered, so the next one starts from its tier.
/// Invoked from the `startup_render_ok` command.
#[cfg(target_os = "linux")]
pub fn confirm_render(identifier: &str, version: &str) {
    let Some(dir) = data_dir(identifier) else {
        return;
    };
    let mut state = load_state(&dir);
    state.confirmed(version);
    save_state(&dir, &state);
}

#[cfg(target_os = "linux")]
pub fn graphics_mode(identifier: &str) -> GraphicsMode {
    data_dir(identifier).map_or_else(GraphicsMode::default, |dir| load_state(&dir).mode)
}

/// Takes effect on the next launch: GTK is already running.
#[cfg(target_os = "linux")]
pub fn set_graphics_mode(identifier: &str, mode: GraphicsMode) -> std::io::Result<()> {
    let dir = data_dir(identifier)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no data directory"))?;
    let mut state = load_state(&dir);
    state.mode = mode;
    write_state(&dir, &state)
}

#[cfg(test)]
mod tests {
    use super::{
        BootReport, GraphicsMode, LaunchFacts, LaunchLock, MAX_TIER, StartupState, drops_im_module,
        has_shm_transport, load_state, save_state, tier_vars, try_launch_lock, x11_available,
    };
    use std::ffi::OsStr;

    const V1: &str = "0.1.0-beta3";
    const V2: &str = "0.1.0-beta4";

    /// The ladder for WebKitGTK older than 2.44.
    fn keys(tier: u8) -> Vec<&'static str> {
        shm_keys_if(tier, false)
    }

    /// The ladder for WebKitGTK 2.44 and later.
    fn shm_keys(tier: u8) -> Vec<&'static str> {
        shm_keys_if(tier, true)
    }

    fn shm_keys_if(tier: u8, shm: bool) -> Vec<&'static str> {
        tier_vars(tier, true, shm)
            .into_iter()
            .map(|(key, _)| key)
            .collect()
    }

    fn nvidia_wayland() -> LaunchFacts {
        LaunchFacts {
            nvidia_wayland: true,
            ..LaunchFacts::default()
        }
    }

    /// Runs one launch: pick a tier, record it, and confirm a render if `renders`.
    fn launch(state: &mut StartupState, version: &str, facts: LaunchFacts, renders: bool) -> u8 {
        let tier = state.choose_tier(version, facts);
        state.launched(tier);
        if renders {
            state.confirmed(version);
        }
        tier
    }

    /// The point of the ladder: a machine that renders fine is left alone.
    #[test]
    fn tier_0_applies_nothing() {
        assert!(tier_vars(0, true, false).is_empty());
        assert!(tier_vars(0, true, true).is_empty());
    }

    /// Disabling the DMABUF renderer on 2.44+ disables GPU rendering outright,
    /// so the first rung keeps the GPU and only changes the frame transport.
    #[test]
    fn tier_1_keeps_the_gpu_on_current_webkit() {
        assert_eq!(
            shm_keys(1),
            vec![
                "__NV_DISABLE_EXPLICIT_SYNC",
                "WEBKIT_DMABUF_RENDERER_FORCE_SHM"
            ],
        );
    }

    #[test]
    fn tier_2_is_cpu_rendering_on_current_webkit() {
        let tier_2 = shm_keys(2);
        assert!(tier_2.contains(&"WEBKIT_DISABLE_DMABUF_RENDERER"));
        assert!(tier_2.contains(&"WEBKIT_DISABLE_COMPOSITING_MODE"));
        assert!(!shm_keys(1).contains(&"WEBKIT_DISABLE_DMABUF_RENDERER"));
    }

    #[test]
    fn shared_memory_transport_starts_at_webkitgtk_2_44() {
        assert!(!has_shm_transport(None));
        assert!(!has_shm_transport(Some((2, 42))));
        assert!(has_shm_transport(Some((2, 44))));
        assert!(has_shm_transport(Some((2, 52))));
        assert!(has_shm_transport(Some((3, 0))));
    }

    #[test]
    fn tier_1_drops_the_gpu_paths_that_blank_the_window() {
        assert_eq!(
            keys(1),
            vec![
                "__NV_DISABLE_EXPLICIT_SYNC",
                "WEBKIT_DISABLE_DMABUF_RENDERER"
            ],
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

    #[test]
    fn the_x11_fallback_needs_an_x_server() {
        for shm in [false, true] {
            let without_x = tier_vars(MAX_TIER, false, shm);
            assert!(without_x.iter().all(|(key, _)| *key != "GDK_BACKEND"));
            assert_eq!(without_x, tier_vars(2, false, shm));
        }
    }

    #[test]
    fn an_x_server_is_only_assumed_when_display_is_set() {
        assert!(x11_available(Some(OsStr::new(":0"))));
        assert!(!x11_available(Some(OsStr::new(""))));
        assert!(!x11_available(None));
    }

    /// Escalation must only ever add remedies: a higher tier that dropped one
    /// could un-fix a machine the tier below had already rescued.
    #[test]
    fn each_tier_is_a_superset_of_the_one_below() {
        for shm in [false, true] {
            for tier in 1..=MAX_TIER {
                let lower = shm_keys_if(tier - 1, shm);
                let higher = shm_keys_if(tier, shm);
                assert!(
                    lower.iter().all(|key| higher.contains(key)),
                    "tier {tier} dropped a variable set by tier {}",
                    tier - 1,
                );
                assert!(higher.len() > lower.len(), "tier {tier} added nothing");
            }
        }
    }

    #[test]
    fn tiers_are_capped_at_the_last_resort() {
        assert_eq!(keys(MAX_TIER), keys(MAX_TIER + 5));
        assert_eq!(shm_keys(MAX_TIER), shm_keys(MAX_TIER + 5));
    }

    /// A page that keeps crashing after it rendered means the confirmed tier
    /// is not enough, so the next launch climbs one.
    #[test]
    fn a_crash_loop_after_rendering_climbs_one_tier() {
        let mut state = StartupState::default();
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), true), 0);
        state.crash_looped();
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), true), 1);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), true), 1);
    }

    /// The bug this state file fixes: deleting the record on success sent a
    /// tier-1 machine back to tier 0 every other launch.
    #[test]
    fn a_tier_that_worked_is_kept() {
        let mut state = StartupState::default();
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), false), 0);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), true), 1);
        for _ in 0..5 {
            assert_eq!(launch(&mut state, V1, LaunchFacts::default(), true), 1);
        }
    }

    #[test]
    fn crashes_climb_from_the_remembered_tier_and_stop_at_the_top() {
        let mut state = StartupState::default();
        launch(&mut state, V1, LaunchFacts::default(), false);
        launch(&mut state, V1, LaunchFacts::default(), true);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), false), 1);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), false), 2);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), false), 3);
        assert_eq!(launch(&mut state, V1, LaunchFacts::default(), false), 3);
    }

    #[test]
    fn a_new_version_steps_down_once_and_climbs_back_if_it_fails() {
        let mut state = StartupState {
            good_tier: Some(2),
            good_version: Some(V1.into()),
            ..StartupState::default()
        };
        assert_eq!(launch(&mut state, V2, LaunchFacts::default(), false), 1);
        assert_eq!(launch(&mut state, V2, LaunchFacts::default(), true), 2);
        assert_eq!(launch(&mut state, V2, LaunchFacts::default(), true), 2);
    }

    #[test]
    fn a_new_version_that_renders_lower_keeps_the_lower_tier() {
        let mut state = StartupState {
            good_tier: Some(2),
            good_version: Some(V1.into()),
            ..StartupState::default()
        };
        assert_eq!(launch(&mut state, V2, LaunchFacts::default(), true), 1);
        assert_eq!(launch(&mut state, V2, LaunchFacts::default(), true), 1);
    }

    #[test]
    fn nvidia_on_wayland_starts_at_tier_1_and_never_steps_below_it() {
        let mut state = StartupState::default();
        assert_eq!(launch(&mut state, V1, nvidia_wayland(), true), 1);
        assert_eq!(launch(&mut state, V2, nvidia_wayland(), true), 1);
    }

    #[test]
    fn a_user_dmabuf_choice_disables_the_nvidia_preset() {
        let facts = LaunchFacts {
            nvidia_wayland: true,
            user_set_dmabuf: true,
            ..LaunchFacts::default()
        };
        assert_eq!(StartupState::default().choose_tier(V1, facts), 0);
    }

    #[test]
    fn the_settings_mode_is_a_floor() {
        let compatible = StartupState {
            mode: GraphicsMode::Compatible,
            ..StartupState::default()
        };
        assert_eq!(compatible.choose_tier(V1, LaunchFacts::default()), 1);
        let safe = StartupState {
            mode: GraphicsMode::Safe,
            ..StartupState::default()
        };
        assert_eq!(safe.choose_tier(V1, LaunchFacts::default()), MAX_TIER);
    }

    /// A blank-but-alive window can't be detected, so a render confirmed under
    /// safe graphics is what lets the next normal launch work.
    #[test]
    fn a_safe_graphics_launch_that_renders_is_remembered() {
        let mut state = StartupState::default();
        let safe = LaunchFacts {
            safe_graphics: true,
            ..LaunchFacts::default()
        };
        assert_eq!(launch(&mut state, V1, safe, true), MAX_TIER);
        assert_eq!(
            launch(&mut state, V1, LaunchFacts::default(), true),
            MAX_TIER
        );
    }

    #[test]
    fn the_x11_fallback_drops_a_wayland_input_module() {
        assert!(drops_im_module(Some("x11"), Some("wayland")));
        assert!(!drops_im_module(Some("x11"), Some("ibus")));
        assert!(!drops_im_module(Some("wayland"), Some("wayland")));
        assert!(!drops_im_module(None, Some("wayland")));
    }

    #[test]
    fn graphics_modes_round_trip_through_their_names() {
        for mode in [
            GraphicsMode::Automatic,
            GraphicsMode::Compatible,
            GraphicsMode::Safe,
        ] {
            assert_eq!(GraphicsMode::parse(mode.as_str()), Some(mode));
        }
        assert_eq!(GraphicsMode::parse("fast"), None);
    }

    #[test]
    fn the_old_sentinel_becomes_failed_boots_and_is_removed() {
        let dir = std::env::temp_dir().join(format!("flow-startup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(super::LEGACY_SENTINEL_FILE), "2").unwrap();

        let state = load_state(&dir);
        assert_eq!(state.failed_boots, 2);
        assert_eq!(state.good_tier, None);
        assert!(!dir.join(super::LEGACY_SENTINEL_FILE).exists());

        save_state(&dir, &state);
        assert_eq!(load_state(&dir), state);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_the_first_instance_holds_the_launch_lock() {
        let dir = std::env::temp_dir().join(format!("flow-launch-lock-{}", std::process::id()));
        let LaunchLock::Held(first) = try_launch_lock(&dir) else {
            panic!("the first instance should take the lock");
        };
        assert!(matches!(try_launch_lock(&dir), LaunchLock::Busy));
        drop(first);
        assert!(matches!(try_launch_lock(&dir), LaunchLock::Held(_)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn says_why_a_launch_used_its_tier() {
        let report = |tier, failed_boots, nvidia_preset, safe_graphics, mode| BootReport {
            tier,
            failed_boots,
            nvidia_preset,
            safe_graphics,
            mode,
        };
        let auto = GraphicsMode::Automatic;
        assert_eq!(report(0, 0, false, false, auto).tier_reason(), "default");
        assert_eq!(
            report(3, 0, false, true, auto).tier_reason(),
            "safe-graphics-launch"
        );
        assert_eq!(
            report(1, 0, false, false, GraphicsMode::Compatible).tier_reason(),
            "settings"
        );
        assert_eq!(
            report(2, 1, false, false, GraphicsMode::Compatible).tier_reason(),
            "failed-launches"
        );
        assert_eq!(
            report(1, 0, true, false, auto).tier_reason(),
            "nvidia-wayland"
        );
        assert_eq!(report(2, 0, false, false, auto).tier_reason(), "remembered");
    }
}
