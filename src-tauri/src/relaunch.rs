//! Restarts Flow without Tauri's restart, which re-runs the original command line: a link Flow
//! was opened with would be opened again, in whatever profile comes up. Here the new process gets
//! no arguments and the environment Flow was launched with, before this process changed it.

use std::ffi::OsString;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

static LAUNCH_ENV: OnceLock<Vec<(OsString, OsString)>> = OnceLock::new();
static REQUESTED: AtomicBool = AtomicBool::new(false);

/// First thing in `run()`, before the Linux startup tiers set their variables.
pub fn capture_launch_env() {
    let _ = LAUNCH_ENV.set(std::env::vars_os().collect());
}

/// Relaunch once this process has exited normally. Call before `AppHandle::exit`, so the exit
/// path still flushes the brains and releases the single-instance lock first.
pub fn request() {
    REQUESTED.store(true, Ordering::SeqCst);
}

/// From `RunEvent::Exit`, which runs after the plugins have released the single-instance lock.
pub fn on_exit(env: &tauri::Env) {
    if REQUESTED.load(Ordering::SeqCst)
        && let Err(error) = spawn(env)
    {
        tracing::error!(%error, "could not relaunch Flow");
    }
}

fn spawn(env: &tauri::Env) -> std::io::Result<()> {
    let binary = tauri::process::current_binary(env)?;
    #[cfg(target_os = "macos")]
    if let Some(bundle) = macos_bundle(&binary) {
        // LaunchServices owns the new process and gives it a fresh environment.
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-n")
            .arg(bundle)
            .stdin(std::process::Stdio::null())
            .status()?;
        return if status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(format!("open exited with {status}")))
        };
    }
    std::process::Command::new(binary)
        .env_clear()
        .envs(child_env())
        .spawn()
        .map(drop)
}

fn child_env() -> Vec<(OsString, OsString)> {
    let launched = LAUNCH_ENV
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::vars_os().collect());
    crate::appimage::without_bundle(launched)
}

/// `Flow.app` for a binary at `Flow.app/Contents/MacOS/flow`.
#[cfg(target_os = "macos")]
fn macos_bundle(binary: &std::path::Path) -> Option<&std::path::Path> {
    let macos = binary.parent()?;
    let contents = macos.parent()?;
    (macos.file_name()? == "MacOS" && contents.file_name()? == "Contents")
        .then(|| contents.parent())
        .flatten()
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn finds_the_app_bundle_only_inside_one() {
        use std::path::Path;
        assert_eq!(
            super::macos_bundle(Path::new("/Applications/Flow.app/Contents/MacOS/flow")),
            Some(Path::new("/Applications/Flow.app"))
        );
        assert_eq!(
            super::macos_bundle(Path::new("/tmp/target/debug/flow")),
            None
        );
    }

    #[test]
    fn the_child_keeps_the_launch_environment() {
        super::capture_launch_env();
        let env = super::child_env();
        assert!(env.iter().any(|(key, _)| key == "PATH"));
    }
}
