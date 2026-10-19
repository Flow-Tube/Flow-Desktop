//! AppImage-only loader setup that must run before GTK/WebKitGTK start.
//!
//! `scripts/postprocess-appimage.sh` moves the bundled libva into
//! `usr/lib/libva-fallback`: the bundled copy only searches the build distro's
//! driver directory and can't load drivers built for a newer VA-API, so it kept
//! hardware decoding off on most hosts (issue #74). The host's own libva is the
//! right one wherever it exists. A host with none still needs the bundled copy,
//! because the bundled `FFmpeg` links it, so only there does the fallback join
//! the loader path. The child processes that decode video (the web process and
//! the plugin scanner) inherit it; the main process never loads libva (the
//! post-processing script checks).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

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

#[cfg(test)]
mod tests {
    use super::{LIBVA_FALLBACK_DIR, library_path_with_fallback};
    use std::ffi::OsString;
    use std::path::Path;

    const APPDIR: &str = "/tmp/.mount_Flow_abc123";

    fn fallback() -> String {
        format!("{APPDIR}/{LIBVA_FALLBACK_DIR}")
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
}
