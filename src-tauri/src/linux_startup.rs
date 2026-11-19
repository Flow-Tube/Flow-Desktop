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
//! A remembered tier can also be wrong: a launch that was closed early or a
//! page that crashed for its own reasons looks like a graphics failure. Every
//! tier above 0 costs speed. On WebKitGTK's GTK 3 port shared memory reads the
//! whole frame back and repaints the whole view for every frame, and tiers 2
//! and 3 render on the CPU. So the record keeps why its tier was reached, and
//! a tier can be tried again from below: a trial launch runs a lower tier and
//! asks the user to keep it. A blank window can't answer, so the trial ends on
//! a clock kept here, and Flow restarts on the tier it had. A record written
//! before reasons existed gets one such trial by itself, the user can ask for
//! one in Settings, and a trial nobody kept is not repeated on the same
//! WebKitGTK.
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
/// First WebKitGTK release that can fail on the NVIDIA proprietary driver once the GPU is taken
/// away from it: 2.52 can crash as soon as a page needs a compositing layer (Ubuntu's
/// LP #2168736) and 2.54 can leave the window black (WebKit bug 329288, seen on a reporter's
/// RTX 5090). It is not every machine: a reporter's GTX 1060 drew correctly that way on 2.52.6.
const NVIDIA_SOFTWARE_UNRELIABLE_SINCE: (u32, u32) = (2, 52);
/// The record version that carries reasons and trials. An older record can hold
/// a tier that was raised by launches that only looked like failures.
const SCHEMA: u8 = 2;
/// A trial launch whose page never mounts gives up after this long.
#[cfg(target_os = "linux")]
const TRIAL_MOUNT_SECS: u64 = 45;
/// How long the user has to keep a trial once its question is on screen.
#[cfg(target_os = "linux")]
const TRIAL_KEEP_SECS: u64 = 15;
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

/// Why a launch used its tier. Kept with the remembered tier, so About and bug
/// reports can say where it came from, and so a floor is not mistaken for a need.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TierReason {
    Default,
    Settings,
    FailedLaunches,
    CrashLoop,
    NvidiaWayland,
    Remembered,
    SafeGraphicsLaunch,
    Trial,
    TrialKept,
    /// The user set a WebKitGTK renderer variable for this launch.
    OwnVariables,
}

impl TierReason {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Settings => "settings",
            Self::FailedLaunches => "failed-launches",
            Self::CrashLoop => "crash-loop",
            Self::NvidiaWayland => "nvidia-wayland",
            Self::Remembered => "remembered",
            Self::SafeGraphicsLaunch => "safe-graphics-launch",
            Self::Trial => "trial",
            Self::TrialKept => "trial-kept",
            Self::OwnVariables => "own-variables",
        }
    }

    /// A floor applies itself on every launch while it holds, so the tier it
    /// produced says nothing about what the machine needs.
    fn is_floor(self) -> bool {
        matches!(self, Self::Settings | Self::NvidiaWayland)
    }
}

/// How a tier gets the page to the screen, in the words About uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderPath {
    Gpu,
    /// GPU rendering, with every frame read back and copied through shared memory.
    SharedMemory,
    Software,
    /// The user's own renderer variables decide it, and Flow does not second-guess them.
    OwnVariables,
}

impl RenderPath {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gpu => "gpu",
            Self::SharedMemory => "shared-memory",
            Self::Software => "software",
            Self::OwnVariables => "own-variables",
        }
    }

    fn of(tier: u8, shm_transport: bool) -> Self {
        match tier {
            0 => Self::Gpu,
            // Before 2.44 the DMABUF renderer was one of several accelerated paths.
            1 if shm_transport => Self::SharedMemory,
            1 => Self::Gpu,
            _ => Self::Software,
        }
    }
}

/// What a faster-graphics trial can do for a launch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FasterGraphics {
    /// Nothing faster to try from this tier.
    None,
    /// This launch is the trial, waiting to be kept.
    Trial,
    /// A trial has somewhere to go, if the user asks for one.
    Available,
    /// Available, and the tier is not the user's own choice, so worth saying.
    Suggested,
}

impl FasterGraphics {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Trial => "trial",
            Self::Available => "available",
            Self::Suggested => "suggested",
        }
    }
}

/// A launch at a lower tier that only becomes the remembered one if the user
/// keeps it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Trial {
    tier: u8,
    /// False while it waits for the relaunch that runs it.
    running: bool,
}

/// The last trial nobody kept, and the WebKitGTK it ran on. A newer WebKitGTK
/// may behave differently, so it is worth another try.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct FailedTrial {
    webkit: String,
    tier: u8,
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
    /// Where `good_tier` came from. `None` in a record older than [`SCHEMA`].
    reason: Option<TierReason>,
    /// Why the current, or last unconfirmed, launch used `pending_tier`.
    pending_reason: Option<TierReason>,
    /// The page kept crashing since the last confirmed render.
    crash_looped: bool,
    trial: Option<Trial>,
    trial_failed: Option<FailedTrial>,
    schema: u8,
}

/// What this machine and this launch ask for, read once before GTK starts.
#[derive(Clone, Copy, Debug, Default)]
struct LaunchFacts {
    nvidia_wayland: bool,
    user_set_dmabuf: bool,
    safe_graphics: bool,
    /// The NVIDIA proprietary driver with a WebKitGTK that may not draw on it without the GPU.
    software_unreliable: bool,
}

impl LaunchFacts {
    fn nvidia_preset(self) -> bool {
        self.nvidia_wayland && !self.user_set_dmabuf
    }

    /// The user set a renderer variable for this launch and did not ask for safe graphics,
    /// so the variables decide how the page is drawn.
    fn own_variables(self) -> bool {
        self.user_set_dmabuf && !self.safe_graphics
    }

    /// The highest tier Flow moves to by itself. Tiers 2 and 3 turn the GPU off, and where
    /// that may blank the window they are no rescue: a blank window whose page still runs counts
    /// as rendered, so a machine that climbed there would stay blank for good. The user can still
    /// choose them, and on some machines must: after Ubuntu moved NVIDIA to shared memory, a
    /// reporter's GTX 1060 showed a green video on every path that keeps the GPU.
    fn climb_limit(self) -> u8 {
        if self.software_unreliable {
            1
        } else {
            MAX_TIER
        }
    }
}

/// What one launch does, decided before GTK starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LaunchPlan {
    tier: u8,
    reason: TierReason,
    trial: bool,
}

impl StartupState {
    /// The lowest tier a launch or a trial may use: the user's choice in Settings, and shared
    /// memory on NVIDIA with Wayland. A trial stops there too. The direct GPU path was tried on
    /// a reporter's GTX 1060: the page drew, the video was green and the web process crashed on
    /// close, none of which a question asked at launch could have shown.
    fn floor(&self, facts: LaunchFacts) -> u8 {
        u8::from(facts.nvidia_preset()).max(self.mode.floor())
    }

    fn choose_tier(&self, version: &str, facts: LaunchFacts) -> u8 {
        if facts.safe_graphics {
            return MAX_TIER;
        }
        let floor = self.floor(facts);
        let base = match self.good_tier {
            // Remembered only as far as the floor that produced it still reaches.
            Some(good) if self.reason.is_some_and(TierReason::is_floor) => good.min(floor),
            Some(good) if self.good_version.as_deref() == Some(version) => good,
            Some(good) => good.saturating_sub(1),
            None => 0,
        };
        // The floor comes last: the user's own choice may pass the limit on climbing.
        base.saturating_add(self.failed_boots)
            .min(facts.climb_limit())
            .max(floor)
    }

    /// Call before [`Self::launched`], which counts this launch as failed until it renders.
    fn reason_for(&self, tier: u8, facts: LaunchFacts) -> TierReason {
        if facts.safe_graphics {
            TierReason::SafeGraphicsLaunch
        } else if tier == 0 {
            TierReason::Default
        } else if self.mode != GraphicsMode::Automatic && tier == self.mode.floor() {
            TierReason::Settings
        } else if self.failed_boots > 0 {
            if self.crash_looped {
                TierReason::CrashLoop
            } else {
                TierReason::FailedLaunches
            }
        } else if facts.nvidia_preset() && tier == 1 {
            TierReason::NvidiaWayland
        } else {
            TierReason::Remembered
        }
    }

    /// What About shows: a remembered tier is described by where it came from.
    fn shown_reason(&self, reason: TierReason, tier: u8) -> TierReason {
        match reason {
            TierReason::Remembered => self.reason.unwrap_or(reason),
            TierReason::Default if self.kept(tier) => TierReason::TrialKept,
            other => other,
        }
    }

    fn kept(&self, tier: u8) -> bool {
        self.reason == Some(TierReason::TrialKept) && self.good_tier == Some(tier)
    }

    /// Recorded before the webview is built, so a crash or abort is remembered.
    fn launched(&mut self, tier: u8, reason: TierReason) {
        self.pending_tier = tier;
        self.pending_reason = Some(reason);
        // One past MAX_TIER is enough; further crashes can't escalate.
        self.failed_boots = self.failed_boots.saturating_add(1).min(MAX_TIER + 1);
    }

    fn confirmed(&mut self, version: &str) {
        let reason = self.pending_reason.unwrap_or(TierReason::Remembered);
        if reason == TierReason::Remembered {
            self.reason = self.reason.or(Some(reason));
        } else if !self.kept(self.pending_tier) {
            self.reason = Some(reason);
        }
        self.good_tier = Some(self.pending_tier);
        self.good_version = Some(version.to_owned());
        self.failed_boots = 0;
        self.crash_looped = false;
    }

    fn crash_looped(&mut self) {
        self.failed_boots = self.failed_boots.saturating_add(1).min(MAX_TIER + 1);
        self.crash_looped = true;
    }

    /// The tier a faster-graphics trial would use from `current`, if one is
    /// worth running: never below `floor`, and above a tier nobody kept on this
    /// WebKitGTK.
    fn trial_target(&self, current: u8, floor: u8, webkit: &str) -> Option<u8> {
        let target = self
            .trial_failed
            .as_ref()
            .filter(|failed| failed.webkit == webkit)
            .map_or(floor, |failed| failed.tier.saturating_add(1).max(floor));
        (target < current).then_some(target)
    }

    /// Queues a trial for the next launch, down to `floor` at the lowest.
    fn request_trial(&mut self, current: u8, floor: u8, webkit: &str) -> bool {
        let Some(tier) = self.trial_target(current, floor, webkit) else {
            return false;
        };
        self.trial = Some(Trial {
            tier,
            running: false,
        });
        true
    }

    fn keep_trial(&mut self, version: &str) {
        let Some(trial) = self.trial.take() else {
            return;
        };
        self.good_tier = Some(trial.tier);
        self.good_version = Some(version.to_owned());
        self.pending_tier = trial.tier;
        self.pending_reason = Some(TierReason::TrialKept);
        self.reason = Some(TierReason::TrialKept);
        self.failed_boots = 0;
        self.crash_looped = false;
    }

    fn fail_trial(&mut self, webkit: &str) {
        if let Some(trial) = self.trial.take() {
            self.trial_failed = Some(FailedTrial {
                webkit: webkit.to_owned(),
                tier: trial.tier,
            });
        }
    }

    /// A launch under the user's own renderer variables. Everything Flow chose by itself
    /// steps aside, so the variables decide the path, and nothing is recorded: a reporter's
    /// tests of the GPU path crashed, were counted as failed launches, and the tier that
    /// raised then overrode the same variables on the next try. The choice in Settings is
    /// the user's too, and stays.
    fn own_variables_launch(&self) -> LaunchPlan {
        let tier = self.mode.floor();
        LaunchPlan {
            tier,
            reason: if tier == 0 {
                TierReason::OwnVariables
            } else {
                TierReason::Settings
            },
            trial: false,
        }
    }

    /// Decides this launch and records it. A trial launch is not counted as a
    /// failed startup: if it dies, only the trial failed.
    fn plan_launch(&mut self, version: &str, webkit: &str, facts: LaunchFacts) -> LaunchPlan {
        if facts.own_variables() {
            return self.own_variables_launch();
        }
        // Still running when the last launch ended: nobody kept it.
        if self.trial.is_some_and(|trial| trial.running) {
            self.fail_trial(webkit);
        }
        let requested = self.trial.take().map(|trial| trial.tier);
        let tier = self.choose_tier(version, facts);
        let reason = self.reason_for(tier, facts);

        // An older record gets one trial of its own, on a launch that follows a
        // confirmed render, so a tier raised by false alarms can come back down.
        let older_record = self.schema < SCHEMA && self.failed_boots == 0;
        if older_record {
            self.schema = SCHEMA;
        }
        let trial_tier = if facts.safe_graphics {
            None
        } else {
            requested.filter(|target| *target < tier).or_else(|| {
                older_record
                    .then(|| self.trial_target(tier, self.floor(facts), webkit))
                    .flatten()
            })
        };

        if let Some(tier) = trial_tier {
            self.trial = Some(Trial {
                tier,
                running: true,
            });
            return LaunchPlan {
                tier,
                reason: TierReason::Trial,
                trial: true,
            };
        }
        self.launched(tier, reason);
        LaunchPlan {
            tier,
            reason: self.shown_reason(reason, tier),
            trial: false,
        }
    }

    /// The same decision for a second launch while Flow runs, which is handed
    /// to the running window and must leave the record alone.
    fn peek_launch(&self, version: &str, facts: LaunchFacts) -> LaunchPlan {
        if facts.own_variables() {
            return self.own_variables_launch();
        }
        let tier = self.choose_tier(version, facts);
        LaunchPlan {
            tier,
            reason: self.shown_reason(self.reason_for(tier, facts), tier),
            trial: false,
        }
    }

    /// What a trial can do for `plan`. It is suggested only where a faster tier
    /// is untried on this WebKitGTK and the current one is not the user's choice.
    fn faster_graphics(
        &self,
        plan: LaunchPlan,
        facts: LaunchFacts,
        webkit: &str,
    ) -> FasterGraphics {
        if plan.trial {
            return FasterGraphics::Trial;
        }
        if facts.safe_graphics
            || facts.own_variables()
            || self
                .trial_target(plan.tier, self.floor(facts), webkit)
                .is_none()
        {
            return FasterGraphics::None;
        }
        let tried = self
            .trial_failed
            .as_ref()
            .is_some_and(|failed| failed.webkit == webkit);
        // A tier the user asked for by name is theirs to change, not news.
        let chosen = matches!(
            plan.reason,
            TierReason::Settings | TierReason::SafeGraphicsLaunch
        );
        if tried || chosen {
            FasterGraphics::Available
        } else {
            FasterGraphics::Suggested
        }
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
    /// Why this launch used its tier, for the About tab and bug reports.
    pub reason: TierReason,
    pub render_path: RenderPath,
    pub faster: FasterGraphics,
    /// The lowest tier a trial asked for later may use.
    pub floor: u8,
    /// This launch runs under the user's own renderer variables and is not recorded.
    pub own_variables: bool,
}

#[cfg(any(target_os = "linux", test))]
impl BootReport {
    fn new(
        state: &StartupState,
        plan: LaunchPlan,
        facts: LaunchFacts,
        failed_boots: u8,
        webkit: &str,
        shm_transport: bool,
    ) -> Self {
        Self {
            tier: plan.tier,
            failed_boots,
            nvidia_preset: facts.nvidia_preset(),
            safe_graphics: facts.safe_graphics,
            mode: state.mode,
            reason: plan.reason,
            render_path: if facts.own_variables() {
                RenderPath::OwnVariables
            } else {
                RenderPath::of(plan.tier, shm_transport)
            },
            faster: state.faster_graphics(plan, facts, webkit),
            floor: state.floor(facts),
            own_variables: facts.own_variables(),
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

/// A launch under the user's own renderer variables says nothing about the tier Flow chose,
/// so what happens in it is not written to the record.
#[cfg(target_os = "linux")]
fn runs_on_own_variables() -> bool {
    boot_report().is_some_and(|report| report.own_variables)
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

/// The variables that choose between the direct path, shared memory and no GPU buffers.
const TRANSPORT_VARS: [&str; 3] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
];

/// What this launch sets. Where the user set one of [`TRANSPORT_VARS`], Flow sets none of
/// them: its `FORCE_SHM=1` beside the user's `DISABLE_DMABUF_RENDERER=0` kept shared memory
/// on and made the user's value do nothing.
fn launch_vars(
    tier: u8,
    x11_available: bool,
    shm_transport: bool,
    user_set_transport: bool,
) -> Vec<(&'static str, &'static str)> {
    let mut vars = tier_vars(tier, x11_available, shm_transport);
    if user_set_transport {
        vars.retain(|(key, _)| !TRANSPORT_VARS.contains(key));
    }
    vars
}

/// An unknown WebKitGTK is treated as an older one, which keeps the whole ladder.
fn nvidia_software_unreliable(nvidia: bool, version: Option<(u32, u32)>) -> bool {
    nvidia && version.is_some_and(|version| version >= NVIDIA_SOFTWARE_UNRELIABLE_SINCE)
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

/// The loaded WebKitGTK as "2.52.6", the key a failed trial is remembered under.
#[cfg(target_os = "linux")]
#[must_use]
pub fn webkit_string() -> String {
    // SAFETY: plain getters with no arguments and no preconditions.
    unsafe {
        format!(
            "{}.{}.{}",
            webkit2gtk::ffi::webkit_get_major_version(),
            webkit2gtk::ffi::webkit_get_minor_version(),
            webkit2gtk::ffi::webkit_get_micro_version()
        )
    }
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
        let user_set_dmabuf = TRANSPORT_VARS
            .iter()
            .any(|key| std::env::var_os(key).is_some());
        let safe_graphics = std::env::args_os().any(|arg| arg == SAFE_GRAPHICS_ARG)
            || std::env::var_os("FLOW_SAFE_GRAPHICS").is_some_and(|value| value == "1");
        Self {
            nvidia_wayland: nvidia && wayland,
            user_set_dmabuf,
            safe_graphics,
            software_unreliable: nvidia_software_unreliable(nvidia, webkit_version()),
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_tier(tier: u8, shm_transport: bool, user_set_transport: bool) {
    // SAFETY (every env write below): called at the very start of `run()`,
    // before the Tauri builder spawns any threads or initializes GTK/WebKitGTK.
    let x11 = x11_available(std::env::var_os("DISPLAY").as_deref());
    for (key, value) in launch_vars(tier, x11, shm_transport, user_set_transport) {
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

/// Where a running trial stands. The page can run while the window shows
/// nothing, so the clock that ends an unanswered trial lives on this side.
#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
enum TrialClock {
    /// The page has not mounted yet.
    Launching { gives_up: std::time::Instant },
    /// Mounted, but the question is not on screen: the window may be hidden.
    Waiting,
    /// The question is showing.
    Asking { reverts: std::time::Instant },
}

#[cfg(target_os = "linux")]
static TRIAL_CLOCK: std::sync::Mutex<Option<TrialClock>> = std::sync::Mutex::new(None);

#[cfg(target_os = "linux")]
fn trial_clock() -> std::sync::MutexGuard<'static, Option<TrialClock>> {
    TRIAL_CLOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Picks and applies this launch's tier, then records the launch *before* the
/// webview is built so a startup crash/abort is remembered. Call once, first
/// thing in `run()` and before any GTK init.
#[cfg(target_os = "linux")]
pub fn begin(identifier: &str, version: &str) -> BootReport {
    let dir = data_dir(identifier);
    let mut state = dir.as_deref().map(load_state).unwrap_or_default();
    let facts = LaunchFacts::read();
    let webkit = webkit_string();
    let shm_transport = has_shm_transport(webkit_version());
    let failed_boots = state.failed_boots;
    let first_instance = dir.as_deref().is_none_or(take_launch_lock);

    let plan = if first_instance {
        state.plan_launch(version, &webkit, facts)
    } else {
        state.peek_launch(version, facts)
    };
    apply_tier(plan.tier, shm_transport, facts.user_set_dmabuf);
    if plan.trial {
        *trial_clock() = Some(TrialClock::Launching {
            gives_up: std::time::Instant::now() + std::time::Duration::from_secs(TRIAL_MOUNT_SECS),
        });
    }

    let report = BootReport::new(&state, plan, facts, failed_boots, &webkit, shm_transport);
    let _ = BOOT_REPORT.set(report);
    if first_instance && let Some(dir) = dir {
        save_state(&dir, &state);
    }
    report
}

/// Called when the web process keeps crashing after the page already rendered,
/// so the confirmed tier is not enough on this machine. The next launch starts
/// one tier higher, as after a launch that never rendered. During a trial the
/// crashes only end the trial.
#[cfg(target_os = "linux")]
pub fn record_crash_loop(identifier: &str) {
    if runs_on_own_variables() {
        return;
    }
    let Some(dir) = data_dir(identifier) else {
        return;
    };
    let mut state = load_state(&dir);
    if trial_clock().take().is_some() {
        state.fail_trial(&webkit_string());
    } else {
        state.crash_looped();
    }
    save_state(&dir, &state);
}

/// Records that this launch rendered, so the next one starts from its tier.
/// Invoked from the `startup_render_ok` command. A trial launch is only
/// remembered once the user keeps it, so there it just notes the page is up.
#[cfg(target_os = "linux")]
pub fn confirm_render(identifier: &str, version: &str) {
    if runs_on_own_variables() {
        return;
    }
    {
        let mut clock = trial_clock();
        if let Some(current) = *clock {
            if matches!(current, TrialClock::Launching { .. }) {
                *clock = Some(TrialClock::Waiting);
            }
            return;
        }
    }
    let Some(dir) = data_dir(identifier) else {
        return;
    };
    let mut state = load_state(&dir);
    state.confirmed(version);
    save_state(&dir, &state);
}

/// The trial's question is on screen: starts the countdown and returns the
/// seconds left. `None` when this launch is not a trial.
#[cfg(target_os = "linux")]
pub fn trial_shown() -> Option<u64> {
    let mut clock = trial_clock();
    let now = std::time::Instant::now();
    let reverts = match (*clock)? {
        TrialClock::Asking { reverts } => reverts,
        TrialClock::Launching { .. } | TrialClock::Waiting => {
            now + std::time::Duration::from_secs(TRIAL_KEEP_SECS)
        }
    };
    *clock = Some(TrialClock::Asking { reverts });
    Some(reverts.saturating_duration_since(now).as_secs())
}

/// The user saw the trial render and kept it.
#[cfg(target_os = "linux")]
pub fn keep_trial(identifier: &str, version: &str) -> bool {
    if trial_clock().take().is_none() {
        return false;
    }
    let Some(dir) = data_dir(identifier) else {
        return false;
    };
    let mut state = load_state(&dir);
    state.keep_trial(version);
    save_state(&dir, &state);
    true
}

/// Ends a trial nobody kept. True when there was one, and Flow should restart
/// on the tier it had before.
#[cfg(target_os = "linux")]
pub fn end_trial(identifier: &str) -> bool {
    if trial_clock().take().is_none() {
        return false;
    }
    if let Some(dir) = data_dir(identifier) {
        let mut state = load_state(&dir);
        state.fail_trial(&webkit_string());
        save_state(&dir, &state);
    }
    true
}

/// Queues a faster-graphics trial for the next launch. False when this launch
/// is already as fast as the record and Settings allow.
#[cfg(target_os = "linux")]
pub fn request_trial(identifier: &str) -> bool {
    let (Some(report), Some(dir)) = (boot_report(), data_dir(identifier)) else {
        return false;
    };
    let mut state = load_state(&dir);
    if !state.request_trial(report.tier, report.floor, &webkit_string()) {
        return false;
    }
    write_state(&dir, &state).is_ok()
}

/// Restarts Flow on its earlier tier when a trial gets no answer in time. A
/// blank window can't answer, and its page may still be running, so this does
/// not wait for the page.
#[cfg(target_os = "linux")]
pub fn watch_trial(app: tauri::AppHandle) {
    if trial_clock().is_none() {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let deadline = match *trial_clock() {
                None => return,
                Some(TrialClock::Waiting) => continue,
                Some(TrialClock::Launching { gives_up }) => gives_up,
                Some(TrialClock::Asking { reverts }) => reverts,
            };
            if std::time::Instant::now() >= deadline {
                break;
            }
        }
        if end_trial(&app.config().identifier) {
            tracing::warn!("graphics_trial_not_kept");
            crate::relaunch::request();
            app.exit(0);
        }
    });
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
        BootReport, FailedTrial, FasterGraphics, GraphicsMode, LaunchFacts, LaunchLock, MAX_TIER,
        RenderPath, SCHEMA, StartupState, TierReason, drops_im_module, has_shm_transport,
        launch_vars, load_state, nvidia_software_unreliable, save_state, tier_vars,
        try_launch_lock, x11_available,
    };
    use std::ffi::OsStr;

    const V1: &str = "0.1.0-beta3";
    const V2: &str = "0.1.0-beta4";
    const WEBKIT: &str = "2.52.6";
    const NEWER_WEBKIT: &str = "2.54.2";

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
        state.launched(tier, state.reason_for(tier, facts));
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

    /// A record this build wrote: no trial of its own.
    fn current() -> StartupState {
        StartupState {
            schema: SCHEMA,
            ..StartupState::default()
        }
    }

    /// A record from before reasons existed, remembering `tier` from `version`.
    fn older_record(tier: u8, version: &str) -> StartupState {
        StartupState {
            good_tier: Some(tier),
            good_version: Some(version.into()),
            ..StartupState::default()
        }
    }

    /// One real launch through `plan_launch`, confirmed if `renders` and not a trial.
    fn start(state: &mut StartupState, facts: LaunchFacts, renders: bool) -> (u8, bool) {
        let plan = state.plan_launch(V2, WEBKIT, facts);
        if renders && !plan.trial {
            state.confirmed(V2);
        }
        (plan.tier, plan.trial)
    }

    #[test]
    fn says_why_a_launch_used_its_tier() {
        let reason = |state: &StartupState, facts: LaunchFacts| {
            let tier = state.choose_tier(V1, facts);
            state.shown_reason(state.reason_for(tier, facts), tier)
        };
        let none = LaunchFacts::default();
        assert_eq!(reason(&current(), none), TierReason::Default);
        let safe = LaunchFacts {
            safe_graphics: true,
            ..none
        };
        assert_eq!(reason(&current(), safe), TierReason::SafeGraphicsLaunch);
        let compatible = StartupState {
            mode: GraphicsMode::Compatible,
            ..current()
        };
        assert_eq!(reason(&compatible, none), TierReason::Settings);
        let failed = StartupState {
            failed_boots: 2,
            ..compatible
        };
        assert_eq!(reason(&failed, none), TierReason::FailedLaunches);
        assert_eq!(
            reason(&current(), nvidia_wayland()),
            TierReason::NvidiaWayland
        );
        assert_eq!(
            reason(&older_record(2, V1), none),
            TierReason::Remembered,
            "an older record has no origin to show"
        );
    }

    /// A remembered tier is described by what first put the machine there.
    #[test]
    fn a_remembered_tier_shows_where_it_came_from() {
        let mut state = current();
        assert_eq!(start(&mut state, LaunchFacts::default(), false), (0, false));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, false));
        let plan = state.plan_launch(V2, WEBKIT, LaunchFacts::default());
        assert_eq!((plan.tier, plan.reason), (1, TierReason::FailedLaunches));
    }

    #[test]
    fn a_crash_loop_is_named_as_the_reason() {
        let mut state = current();
        start(&mut state, LaunchFacts::default(), true);
        state.crash_looped();
        let plan = state.plan_launch(V2, WEBKIT, LaunchFacts::default());
        assert_eq!((plan.tier, plan.reason), (1, TierReason::CrashLoop));
    }

    /// The beta3 bug left healthy machines on tier 2 or 3, and beta4 only took
    /// one tier off. The first launch that can tell tries the floor instead.
    #[test]
    fn an_older_record_above_the_floor_gets_one_trial() {
        let mut state = older_record(2, V2);
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, true));
        assert_eq!(state.failed_boots, 0, "a trial is not a failed startup");
        assert_eq!(state.good_tier, Some(2), "nothing is remembered until kept");

        state.keep_trial(V2);
        assert_eq!(state.reason, Some(TierReason::TrialKept));
        for _ in 0..3 {
            assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, false));
        }
        assert_eq!(state.reason, Some(TierReason::TrialKept));
    }

    /// A trial that was still running when its launch ended was a blank window,
    /// a crash or a user who went back. The old tier returns and stays.
    #[test]
    fn a_trial_nobody_kept_returns_to_the_old_tier_and_is_not_repeated() {
        let mut state = older_record(2, V2);
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, true));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (2, false));
        assert_eq!(
            state.trial_failed,
            Some(FailedTrial {
                webkit: WEBKIT.into(),
                tier: 0
            })
        );
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (2, false));
    }

    #[test]
    fn an_older_record_at_its_floor_is_left_alone() {
        let mut healthy = older_record(0, V2);
        assert_eq!(
            start(&mut healthy, LaunchFacts::default(), true),
            (0, false)
        );
        let mut nvidia = older_record(1, V2);
        assert_eq!(start(&mut nvidia, nvidia_wayland(), true), (1, false));
        let mut chosen = StartupState {
            mode: GraphicsMode::Compatible,
            ..older_record(1, V2)
        };
        assert_eq!(start(&mut chosen, LaunchFacts::default(), true), (1, false));
    }

    /// The last launch of an older record may have failed for real, so its
    /// trial waits for a launch that follows a confirmed render.
    #[test]
    fn an_older_record_with_a_failed_launch_waits_for_a_clean_one() {
        let mut state = StartupState {
            failed_boots: 1,
            ..older_record(1, V2)
        };
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (2, false));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, true));
    }

    /// Asked for in Settings: each trial nobody kept moves the next one up a
    /// tier, until there is nothing left below the current tier.
    #[test]
    fn a_requested_trial_steps_up_past_tiers_nobody_kept() {
        let mut state = StartupState {
            reason: Some(TierReason::FailedLaunches),
            ..older_record(2, V2)
        };
        state.schema = SCHEMA;
        assert!(state.request_trial(2, 0, WEBKIT));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, true));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (2, false));

        assert!(state.request_trial(2, 0, WEBKIT));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, true));
        state.keep_trial(V2);
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, false));
        assert!(!state.request_trial(1, 0, WEBKIT));
    }

    #[test]
    fn a_newer_webkitgtk_is_worth_another_trial() {
        let mut state = StartupState {
            trial_failed: Some(FailedTrial {
                webkit: WEBKIT.into(),
                tier: 0,
            }),
            ..current()
        };
        assert_eq!(state.trial_target(1, 0, WEBKIT), None);
        assert_eq!(state.trial_target(1, 0, NEWER_WEBKIT), Some(0));
        assert!(state.request_trial(1, 0, NEWER_WEBKIT));
    }

    #[test]
    fn a_trial_never_goes_below_the_settings_floor() {
        let mut state = StartupState {
            mode: GraphicsMode::Compatible,
            ..older_record(3, V2)
        };
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, true));
        state.keep_trial(V2);
        let floor = state.floor(LaunchFacts::default());
        assert!(!state.request_trial(1, floor, WEBKIT));
    }

    #[test]
    fn a_safe_graphics_launch_drops_a_waiting_trial() {
        let mut state = older_record(2, V2);
        state.schema = SCHEMA;
        assert!(state.request_trial(2, 0, WEBKIT));
        let safe = LaunchFacts {
            safe_graphics: true,
            ..LaunchFacts::default()
        };
        assert_eq!(start(&mut state, safe, true), (MAX_TIER, false));
        assert_eq!(state.trial, None);
    }

    /// NVIDIA on a current WebKitGTK: the proprietary driver, where drawing without the GPU
    /// may fail.
    fn nvidia_current() -> LaunchFacts {
        LaunchFacts {
            software_unreliable: true,
            ..nvidia_wayland()
        }
    }

    /// The direct GPU path showed a green video and crashed on a reporter's NVIDIA machine,
    /// which a question asked at launch can't show. So a trial stops at shared memory.
    #[test]
    fn nvidia_is_offered_nothing_below_shared_memory() {
        let mut state = current();
        assert_eq!(start(&mut state, nvidia_current(), true), (1, false));
        let floor = state.floor(nvidia_current());
        assert_eq!(floor, 1);
        assert!(!state.request_trial(1, floor, WEBKIT));

        let plan = state.plan_launch(V2, WEBKIT, nvidia_current());
        let report = BootReport::new(&state, plan, nvidia_current(), 0, WEBKIT, true);
        assert_eq!((report.tier, report.floor), (1, 1));
        assert_eq!(report.faster, FasterGraphics::None);
    }

    /// Without the GPU, a current WebKitGTK may crash or draw nothing on NVIDIA. A blank window
    /// still confirms its render, so a machine that climbed there would stay blank.
    #[test]
    fn nvidia_never_climbs_by_itself_to_the_tiers_that_turn_the_gpu_off() {
        let mut state = current();
        assert_eq!(start(&mut state, nvidia_current(), false), (1, false));
        assert_eq!(start(&mut state, nvidia_current(), false), (1, false));
        assert_eq!(start(&mut state, nvidia_current(), true), (1, false));
    }

    /// One reporter's NVIDIA machine showed a green video on every path that keeps the GPU, so
    /// the tiers without it stay within the user's reach.
    #[test]
    fn nvidia_still_reaches_the_tiers_without_the_gpu_when_the_user_asks() {
        let mut safe_mode = StartupState {
            mode: GraphicsMode::Safe,
            ..current()
        };
        assert_eq!(safe_mode.floor(nvidia_current()), MAX_TIER);
        assert_eq!(
            safe_mode.reason_for(MAX_TIER, nvidia_current()),
            TierReason::Settings
        );
        assert_eq!(
            start(&mut safe_mode, nvidia_current(), true),
            (MAX_TIER, false)
        );
        // Failed launches under the user's choice don't pull it back down.
        assert_eq!(
            start(&mut safe_mode, nvidia_current(), false),
            (MAX_TIER, false)
        );
        assert_eq!(
            start(&mut safe_mode, nvidia_current(), true),
            (MAX_TIER, false)
        );

        // Back on Automatic, the tier that Safe produced is not remembered.
        safe_mode.mode = GraphicsMode::Automatic;
        assert_eq!(start(&mut safe_mode, nvidia_current(), true), (1, false));

        let safe_launch = LaunchFacts {
            safe_graphics: true,
            ..nvidia_current()
        };
        assert_eq!(current().choose_tier(V2, safe_launch), MAX_TIER);
    }

    /// A record that climbed to tier 2 or 3 on such a machine may be a blank window today.
    #[test]
    fn an_nvidia_record_above_shared_memory_comes_straight_back_down() {
        for stuck in [2, MAX_TIER] {
            let mut state = older_record(stuck, V2);
            assert_eq!(start(&mut state, nvidia_current(), true), (1, false));
            assert_eq!(state.good_tier, Some(1));
        }
    }

    #[test]
    fn the_limit_on_climbing_only_applies_where_software_rendering_may_fail() {
        assert!(nvidia_software_unreliable(true, Some((2, 52))));
        assert!(nvidia_software_unreliable(true, Some((2, 54))));
        assert!(!nvidia_software_unreliable(true, Some((2, 50))));
        assert!(!nvidia_software_unreliable(true, None));
        assert!(!nvidia_software_unreliable(false, Some((2, 54))));

        // An older WebKitGTK on NVIDIA keeps the whole ladder.
        let mut older = current();
        assert_eq!(start(&mut older, nvidia_wayland(), false), (1, false));
        assert_eq!(start(&mut older, nvidia_wayland(), false), (1, false));
        assert_eq!(start(&mut older, nvidia_wayland(), false), (2, false));
        assert_eq!(start(&mut older, nvidia_wayland(), true), (3, false));

        let x11_session = LaunchFacts {
            software_unreliable: true,
            ..LaunchFacts::default()
        };
        let mut state = current();
        assert_eq!(start(&mut state, x11_session, false), (0, false));
        assert_eq!(start(&mut state, x11_session, false), (1, false));
        assert_eq!(start(&mut state, x11_session, true), (1, false));
    }

    /// A floor applies itself. Once it is gone, the tier it produced is too.
    #[test]
    fn a_floor_is_not_remembered_after_it_is_lifted() {
        let mut state = StartupState {
            mode: GraphicsMode::Compatible,
            ..current()
        };
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, false));
        state.mode = GraphicsMode::Automatic;
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, false));

        let mut nvidia = current();
        assert_eq!(start(&mut nvidia, nvidia_wayland(), true), (1, false));
        // The same machine in an X11 session, where the preset does not apply.
        assert_eq!(start(&mut nvidia, LaunchFacts::default(), true), (0, false));
    }

    fn own_variables() -> LaunchFacts {
        LaunchFacts {
            user_set_dmabuf: true,
            ..nvidia_current()
        }
    }

    /// A reporter's tests of the GPU path crashed, raised the tier, and the raised tier then
    /// overrode the variables they were testing with.
    #[test]
    fn a_launch_on_the_users_own_variables_sets_aside_what_flow_chose() {
        let mut state = StartupState {
            failed_boots: 2,
            reason: Some(TierReason::FailedLaunches),
            ..older_record(2, V2)
        };
        state.schema = SCHEMA;
        let before = state.clone();

        let plan = state.plan_launch(V2, WEBKIT, own_variables());
        assert_eq!((plan.tier, plan.trial), (0, false));
        assert_eq!(plan.reason, TierReason::OwnVariables);
        assert_eq!(plan, state.peek_launch(V2, own_variables()));
        // Nothing is recorded, so a crash here can't raise the tier of a later launch.
        assert_eq!(state, before);

        let report = BootReport::new(&state, plan, own_variables(), 2, WEBKIT, true);
        assert!(report.own_variables);
        assert_eq!(report.render_path, RenderPath::OwnVariables);
        assert_eq!(report.faster, FasterGraphics::None);
        assert_eq!(report.reason.as_str(), "own-variables");
        assert_eq!(report.render_path.as_str(), "own-variables");

        // Without the variables, the record decides again.
        assert_eq!(start(&mut state, LaunchFacts::default(), true).0, 3);
    }

    #[test]
    fn a_trial_waits_while_the_users_own_variables_are_in_charge() {
        let mut state = older_record(1, V2);
        state.schema = SCHEMA;
        assert!(state.request_trial(1, 0, WEBKIT));
        let queued = state.clone();
        assert_eq!(start(&mut state, own_variables(), false), (0, false));
        assert_eq!(state, queued);
        assert_eq!(start(&mut state, LaunchFacts::default(), false), (0, true));
    }

    /// The choice in Settings and a safe graphics launch are the user's own too.
    #[test]
    fn the_users_own_variables_leave_their_other_choices_alone() {
        let safe_mode = StartupState {
            mode: GraphicsMode::Safe,
            ..current()
        };
        let plan = safe_mode.peek_launch(V2, own_variables());
        assert_eq!((plan.tier, plan.reason), (MAX_TIER, TierReason::Settings));

        let safe_launch = LaunchFacts {
            safe_graphics: true,
            ..own_variables()
        };
        assert!(!safe_launch.own_variables());
        let mut state = current();
        let plan = state.plan_launch(V2, WEBKIT, safe_launch);
        assert_eq!(
            (plan.tier, plan.reason),
            (MAX_TIER, TierReason::SafeGraphicsLaunch)
        );
        assert_eq!(state.failed_boots, 1);
    }

    #[test]
    fn flow_sets_no_transport_variable_beside_one_the_user_set() {
        let keys = |tier, user_set| -> Vec<&str> {
            launch_vars(tier, true, true, user_set)
                .into_iter()
                .map(|(key, _)| key)
                .collect()
        };
        assert_eq!(keys(1, true), ["__NV_DISABLE_EXPLICIT_SYNC"]);
        assert_eq!(
            keys(MAX_TIER, true),
            [
                "__NV_DISABLE_EXPLICIT_SYNC",
                "WEBKIT_DISABLE_COMPOSITING_MODE",
                "GDK_BACKEND"
            ]
        );
        for tier in 0..=MAX_TIER {
            assert_eq!(
                launch_vars(tier, true, true, false),
                tier_vars(tier, true, true)
            );
            assert_eq!(
                launch_vars(tier, true, false, false),
                tier_vars(tier, true, false)
            );
        }
        assert_eq!(
            launch_vars(1, true, false, true),
            [("__NV_DISABLE_EXPLICIT_SYNC", "1")]
        );
    }

    #[test]
    fn a_failed_launch_still_climbs_from_a_floor() {
        let mut state = StartupState {
            mode: GraphicsMode::Compatible,
            ..current()
        };
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (1, false));
        assert_eq!(start(&mut state, LaunchFacts::default(), false), (1, false));
        assert_eq!(start(&mut state, LaunchFacts::default(), true), (2, false));
    }

    /// A second launch while Flow runs must leave the record as it is.
    #[test]
    fn a_second_instance_reads_without_recording() {
        let state = older_record(2, V2);
        let before = state.clone();
        let plan = state.peek_launch(V2, LaunchFacts::default());
        assert_eq!((plan.tier, plan.trial), (2, false));
        assert_eq!(state, before);
    }

    #[test]
    fn the_report_offers_and_suggests_a_trial_only_where_one_can_help() {
        let report = |state: &mut StartupState, facts: LaunchFacts| {
            let failed_boots = state.failed_boots;
            let plan = state.plan_launch(V2, WEBKIT, facts);
            BootReport::new(state, plan, facts, failed_boots, WEBKIT, true)
        };
        let healthy = report(&mut current(), LaunchFacts::default());
        assert_eq!(healthy.faster, FasterGraphics::None);
        assert_eq!(healthy.render_path, RenderPath::Gpu);

        let nvidia = report(&mut current(), nvidia_wayland());
        assert_eq!(nvidia.faster, FasterGraphics::None);
        assert_eq!(nvidia.render_path, RenderPath::SharedMemory);

        // Raised by failed launches on another GPU: worth saying once.
        let mut raised = StartupState {
            reason: Some(TierReason::FailedLaunches),
            ..older_record(1, V2)
        };
        raised.schema = SCHEMA;
        assert_eq!(
            report(&mut raised, LaunchFacts::default()).faster,
            FasterGraphics::Suggested
        );
        assert_eq!((nvidia.tier, nvidia.failed_boots), (1, 0));
        assert!(nvidia.nvidia_preset && !nvidia.safe_graphics);
        assert_eq!(nvidia.mode, GraphicsMode::Automatic);

        let mut safe = StartupState {
            mode: GraphicsMode::Safe,
            ..current()
        };
        let safe = report(&mut safe, LaunchFacts::default());
        assert_eq!(safe.faster, FasterGraphics::None);
        assert_eq!(safe.render_path, RenderPath::Software);

        let mut compatible = StartupState {
            mode: GraphicsMode::Compatible,
            reason: Some(TierReason::Settings),
            ..older_record(1, V2)
        };
        compatible.schema = SCHEMA;
        compatible.mode = GraphicsMode::Automatic;
        assert_eq!(
            report(&mut compatible, LaunchFacts::default()).faster,
            FasterGraphics::None,
            "the floor is gone, and so is the tier"
        );

        let mut tried = StartupState {
            reason: Some(TierReason::FailedLaunches),
            trial_failed: Some(FailedTrial {
                webkit: WEBKIT.into(),
                tier: 0,
            }),
            ..older_record(2, V2)
        };
        tried.schema = SCHEMA;
        assert_eq!(
            report(&mut tried, LaunchFacts::default()).faster,
            FasterGraphics::Available,
            "tier 1 is still untried, but the user is not asked again"
        );

        let mut safe_before = StartupState {
            reason: Some(TierReason::SafeGraphicsLaunch),
            ..older_record(MAX_TIER, V2)
        };
        safe_before.schema = SCHEMA;
        assert_eq!(
            report(&mut safe_before, LaunchFacts::default()).faster,
            FasterGraphics::Available,
            "a tier from Start with safe graphics is the user's to change"
        );

        let trial = report(&mut older_record(2, V2), LaunchFacts::default());
        assert_eq!(trial.faster, FasterGraphics::Trial);
        assert_eq!(trial.reason, TierReason::Trial);

        let launched_safe = LaunchFacts {
            safe_graphics: true,
            ..LaunchFacts::default()
        };
        assert_eq!(
            report(&mut current(), launched_safe).faster,
            FasterGraphics::None
        );
    }

    /// `src/lib/graphicsReport.ts` turns these names into the About line.
    #[test]
    fn reasons_and_render_paths_keep_the_names_the_page_knows() {
        let names: Vec<_> = [
            TierReason::Default,
            TierReason::Settings,
            TierReason::FailedLaunches,
            TierReason::CrashLoop,
            TierReason::NvidiaWayland,
            TierReason::Remembered,
            TierReason::SafeGraphicsLaunch,
            TierReason::Trial,
            TierReason::TrialKept,
        ]
        .into_iter()
        .map(TierReason::as_str)
        .collect();
        assert_eq!(
            names,
            [
                "default",
                "settings",
                "failed-launches",
                "crash-loop",
                "nvidia-wayland",
                "remembered",
                "safe-graphics-launch",
                "trial",
                "trial-kept"
            ]
        );
        assert_eq!(RenderPath::Gpu.as_str(), "gpu");
        assert_eq!(RenderPath::SharedMemory.as_str(), "shared-memory");
        assert_eq!(RenderPath::Software.as_str(), "software");
        assert_eq!(FasterGraphics::None.as_str(), "none");
        assert_eq!(FasterGraphics::Trial.as_str(), "trial");
        assert_eq!(FasterGraphics::Available.as_str(), "available");
        assert_eq!(FasterGraphics::Suggested.as_str(), "suggested");
    }

    #[test]
    fn the_render_path_follows_the_tier_and_the_webkit_version() {
        assert_eq!(RenderPath::of(0, true), RenderPath::Gpu);
        assert_eq!(RenderPath::of(1, true), RenderPath::SharedMemory);
        assert_eq!(RenderPath::of(1, false), RenderPath::Gpu);
        assert_eq!(RenderPath::of(2, true), RenderPath::Software);
        assert_eq!(RenderPath::of(3, false), RenderPath::Software);
    }

    #[test]
    fn a_record_from_an_older_build_loads_and_a_new_one_round_trips() {
        let dir = std::env::temp_dir().join(format!("flow-startup-schema-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(super::STATE_FILE),
            r#"{"good_tier":2,"good_version":"0.1.0-beta4","failed_boots":0,"pending_tier":2,"mode":"automatic"}"#,
        )
        .unwrap();
        let mut state = load_state(&dir);
        assert_eq!(state, older_record(2, V2).with_pending(2));

        assert_eq!(start(&mut state, LaunchFacts::default(), true), (0, true));
        state.fail_trial(WEBKIT);
        state.crash_looped();
        save_state(&dir, &state);
        assert_eq!(load_state(&dir), state);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    impl StartupState {
        fn with_pending(mut self, tier: u8) -> Self {
            self.pending_tier = tier;
            self
        }
    }
}
