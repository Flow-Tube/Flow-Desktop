//! AppImage-specific environment handling.
//!
//! Loader setup that must run before GTK/WebKitGTK start:
//! `scripts/postprocess-appimage.sh` moves the bundled libva into
//! `usr/lib/libva-fallback`: the bundled copy only searches the build distro's
//! driver directory and can't load drivers built for a newer VA-API, so it kept
//! hardware decoding off on most hosts (issue #74). The host's own libva is the
//! right one wherever it exists. A host with none still needs the bundled copy,
//! because the bundled `FFmpeg` links it, so only there does the fallback join
//! the loader path. The child processes that decode video (the web process and
//! the plugin scanner) inherit it; the main process never loads libva (the
//! post-processing script checks).
//!
//! Host programs: the bundle's launcher and hooks point `PATH`,
//! `LD_LIBRARY_PATH` and the media and toolkit variables into the bundle, and
//! every program Flow starts inherits them. A host program then loads bundled
//! libraries built for another distro (issue #74: the host `/bin/sh` picked up
//! the bundled readline and failed with `undefined symbol`). [`host_command`]
//! and [`host_tokio_command`] start a program with those entries removed.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

#[cfg(any(target_os = "linux", test))]
const LIBVA_FALLBACK_DIR: &str = "usr/lib/libva-fallback";

/// Where the distros the AppImage targets install libva.
#[cfg(target_os = "linux")]
const HOST_LIBVA_PATHS: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/libva.so.2",
    "/usr/lib/aarch64-linux-gnu/libva.so.2",
    "/usr/lib64/libva.so.2",
    "/usr/lib/libva.so.2",
];

/// The `LD_LIBRARY_PATH` that adds the bundled libva as a last resort, or
/// `None` when it should stay as it is.
#[cfg(any(target_os = "linux", test))]
fn library_path_with_fallback(
    appdir: &Path,
    current: Option<&OsString>,
    host_has_libva: bool,
) -> Option<OsString> {
    if host_has_libva {
        return None;
    }
    let fallback = appdir.join(LIBVA_FALLBACK_DIR);
    let mut paths: Vec<PathBuf> = current
        .map(|value| std::env::split_paths(value).collect())
        .unwrap_or_default();
    if paths.contains(&fallback) {
        return None;
    }
    // Last, so any libva the user put on the path still wins.
    paths.push(fallback);
    std::env::join_paths(paths).ok()
}

/// Puts the bundled libva on the loader path when running as an AppImage on a
/// host without libva. Returns whether it did. Call first thing in `run()`,
/// before any thread starts.
#[cfg(target_os = "linux")]
pub fn apply_libva_fallback() -> bool {
    let Some(appdir) = std::env::var_os("APPDIR").map(PathBuf::from) else {
        return false;
    };
    if !appdir.join(LIBVA_FALLBACK_DIR).is_dir() {
        return false;
    }
    let host_has_libva = HOST_LIBVA_PATHS.iter().any(|path| Path::new(path).exists());
    let current = std::env::var_os("LD_LIBRARY_PATH");
    match library_path_with_fallback(&appdir, current.as_ref(), host_has_libva) {
        Some(value) => {
            // SAFETY: called at the very start of `run()`, before the Tauri
            // builder spawns any threads or initializes GTK/WebKitGTK.
            unsafe { std::env::set_var("LD_LIBRARY_PATH", value) };
            true
        }
        None => false,
    }
}

/// Search-path variables whose host entries must survive.
const SEARCH_PATH_VARS: &[&str] = &["PATH", "LD_LIBRARY_PATH", "XDG_DATA_DIRS"];

#[derive(Debug, PartialEq, Eq)]
enum EnvChange {
    Set(OsString, OsString),
    Remove(OsString),
}

/// How a child's environment must change so it sees only the host: bundle
/// entries leave the search paths, and any other variable pointing into the
/// bundle is removed.
fn host_env_changes(
    appdir: &Path,
    vars: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<EnvChange> {
    let bundle = appdir.to_string_lossy().into_owned();
    let mut changes = Vec::new();
    for (key, value) in vars {
        if SEARCH_PATH_VARS.iter().any(|name| key == *name) {
            let entries: Vec<PathBuf> = std::env::split_paths(&value).collect();
            let host: Vec<&PathBuf> = entries
                .iter()
                .filter(|entry| !entry.starts_with(appdir))
                .collect();
            if host.len() == entries.len() {
                continue;
            }
            match std::env::join_paths(host) {
                Ok(joined) if !joined.is_empty() => changes.push(EnvChange::Set(key, joined)),
                _ => changes.push(EnvChange::Remove(key)),
            }
        } else if value.to_string_lossy().contains(&bundle) {
            changes.push(EnvChange::Remove(key));
        }
    }
    changes
}

/// An environment captured inside the bundle, minus the bundle: what a relaunched AppImage
/// starts from (its own runtime sets the bundle paths again).
pub fn without_bundle(vars: Vec<(OsString, OsString)>) -> Vec<(OsString, OsString)> {
    let appdir = vars
        .iter()
        .find(|(key, value)| key == "APPDIR" && !value.is_empty())
        .map(|(_, value)| PathBuf::from(value));
    let Some(appdir) = appdir else { return vars };
    let mut vars = vars;
    for change in host_env_changes(&appdir, vars.clone()) {
        match change {
            EnvChange::Set(key, value) => {
                if let Some(entry) = vars.iter_mut().find(|(name, _)| *name == key) {
                    entry.1 = value;
                }
            }
            EnvChange::Remove(key) => vars.retain(|(name, _)| *name != key),
        }
    }
    vars
}

fn bundle_env_changes() -> Vec<EnvChange> {
    std::env::var_os("APPDIR")
        .filter(|appdir| !appdir.is_empty())
        .map(|appdir| host_env_changes(Path::new(&appdir), std::env::vars_os()))
        .unwrap_or_default()
}

/// Whether Flow runs from an `AppImage`, whose environment points into the bundle.
#[cfg(target_os = "linux")]
pub fn in_appimage() -> bool {
    std::env::var_os("APPDIR").is_some_and(|appdir| !appdir.is_empty())
}

/// `std::process::Command::new`, minus the bundle paths.
#[cfg(target_os = "linux")]
pub fn host_command(program: impl AsRef<OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    for change in bundle_env_changes() {
        match change {
            EnvChange::Set(key, value) => command.env(key, value),
            EnvChange::Remove(key) => command.env_remove(key),
        };
    }
    command
}

/// `tokio::process::Command::new`, minus the bundle paths.
pub fn host_tokio_command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    for change in bundle_env_changes() {
        match change {
            EnvChange::Set(key, value) => command.env(key, value),
            EnvChange::Remove(key) => command.env_remove(key),
        };
    }
    command
}

#[cfg(test)]
mod tests {
    use super::{
        EnvChange, LIBVA_FALLBACK_DIR, host_env_changes, library_path_with_fallback, without_bundle,
    };
    use std::ffi::OsString;
    use std::path::Path;

    const APPDIR: &str = "/tmp/.mount_Flow_abc123";

    fn fallback() -> String {
        format!("{APPDIR}/{LIBVA_FALLBACK_DIR}")
    }

    #[test]
    fn a_relaunch_starts_from_the_host_environment() {
        let vars = [
            ("APPDIR", APPDIR.to_string()),
            ("PATH", format!("{APPDIR}/usr/bin:/usr/bin")),
            ("GST_PLUGIN_PATH", format!("{APPDIR}/usr/lib/gstreamer-1.0")),
            ("HOME", "/home/me".to_string()),
        ]
        .map(|(key, value)| (OsString::from(key), OsString::from(value)))
        .to_vec();
        let host = without_bundle(vars);
        let names: Vec<_> = host
            .iter()
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["PATH", "HOME"]);
        assert_eq!(host[0].1, OsString::from("/usr/bin"));
        let outside = vec![(OsString::from("HOME"), OsString::from("/home/me"))];
        assert_eq!(without_bundle(outside.clone()), outside);
    }

    #[test]
    fn host_libva_leaves_the_path_alone() {
        let current = OsString::from(format!("{APPDIR}/usr/lib"));
        assert_eq!(
            library_path_with_fallback(Path::new(APPDIR), Some(&current), true),
            None
        );
    }

    #[test]
    fn fallback_goes_after_the_existing_entries() {
        let current = OsString::from(format!("{APPDIR}/usr/lib:/opt/custom/lib"));
        let expected = format!("{APPDIR}/usr/lib:/opt/custom/lib:{}", fallback());
        assert_eq!(
            library_path_with_fallback(Path::new(APPDIR), Some(&current), false),
            Some(OsString::from(expected))
        );
    }

    #[test]
    fn fallback_alone_when_nothing_was_set() {
        assert_eq!(
            library_path_with_fallback(Path::new(APPDIR), None, false),
            Some(OsString::from(fallback()))
        );
    }

    #[test]
    fn fallback_is_added_once() {
        let current = OsString::from(format!("{APPDIR}/usr/lib:{}", fallback()));
        assert_eq!(
            library_path_with_fallback(Path::new(APPDIR), Some(&current), false),
            None
        );
    }

    fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(key, value)| (OsString::from(key), OsString::from(value)))
            .collect()
    }

    #[test]
    fn bundle_entries_leave_the_search_paths() {
        let changes = host_env_changes(
            Path::new(APPDIR),
            vars(&[
                ("PATH", &format!("{APPDIR}/usr/bin:/usr/local/bin:/usr/bin")),
                (
                    "LD_LIBRARY_PATH",
                    &format!("{APPDIR}/usr/lib:{}", fallback()),
                ),
            ]),
        );
        assert_eq!(
            changes,
            vec![
                EnvChange::Set("PATH".into(), "/usr/local/bin:/usr/bin".into()),
                EnvChange::Remove("LD_LIBRARY_PATH".into()),
            ]
        );
    }

    #[test]
    fn variables_pointing_into_the_bundle_are_removed() {
        let changes = host_env_changes(
            Path::new(APPDIR),
            vars(&[
                (
                    "GST_PLUGIN_SYSTEM_PATH_1_0",
                    &format!("{APPDIR}/usr/lib/gstreamer-1.0"),
                ),
                ("GIO_MODULE_DIR", &format!("{APPDIR}/usr/lib/gio/modules")),
                ("HOME", "/home/someone"),
            ]),
        );
        assert_eq!(
            changes,
            vec![
                EnvChange::Remove("GST_PLUGIN_SYSTEM_PATH_1_0".into()),
                EnvChange::Remove("GIO_MODULE_DIR".into()),
            ]
        );
    }

    #[test]
    fn a_host_only_environment_is_left_alone() {
        let changes = host_env_changes(
            Path::new(APPDIR),
            vars(&[("PATH", "/usr/bin:/bin"), ("XDG_DATA_DIRS", "/usr/share")]),
        );
        assert!(changes.is_empty());
    }
}
