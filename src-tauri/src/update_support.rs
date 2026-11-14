//! Decides whether this install may update itself. Flatpak, distro packages
//! and unbundled binaries are updated by something else (or not at all), and
//! the updater plugin would otherwise offer them a release package that
//! cannot install over a read-only, package-managed tree.

use std::path::Path;

use serde::Serialize;
use tauri::utils::config::BundleType;

/// Packagers install this empty file in the resource dir to say the package
/// manager owns updates.
const DISTRO_MANAGED_MARKER: &str = "distro-managed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateBlock {
    Flatpak,
    PackageManager,
    Unbundled,
    /// macOS: the app runs from a read-only place, its disk image or the copy macOS makes of an
    /// app opened straight from Downloads (App Translocation). The updater replaces the app where
    /// it runs, so it can't there; moved to Applications, the same app updates itself.
    ReadOnlyLocation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSupport {
    pub supported: bool,
    pub reason: Option<UpdateBlock>,
}

impl UpdateSupport {
    /// Whether Flow writes its own user-level `flow://` handler at startup. Only an `AppImage`
    /// and an unbundled binary need one: Flatpak, `.deb`, `.rpm` and the AUR packages install a
    /// desktop entry that already takes the link (`%u`), and a runtime handler would shadow it
    /// with an absolute path that breaks when an upgrade renames the binary.
    pub fn registers_link_handler(self, bundle: Option<&BundleType>) -> bool {
        match self.reason {
            Some(UpdateBlock::Flatpak | UpdateBlock::PackageManager) => false,
            Some(UpdateBlock::Unbundled) => true,
            Some(UpdateBlock::ReadOnlyLocation) | None => {
                matches!(bundle, Some(BundleType::AppImage))
            }
        }
    }
}

fn decide(
    flatpak: bool,
    marker: bool,
    bundle: Option<&BundleType>,
    read_only: bool,
) -> UpdateSupport {
    let reason = if flatpak {
        Some(UpdateBlock::Flatpak)
    } else if marker {
        Some(UpdateBlock::PackageManager)
    } else if bundle.is_none() {
        Some(UpdateBlock::Unbundled)
    } else if read_only {
        Some(UpdateBlock::ReadOnlyLocation)
    } else {
        None
    };
    UpdateSupport {
        supported: reason.is_none(),
        reason,
    }
}

fn has_marker(resource_dir: Option<&Path>) -> bool {
    resource_dir.is_some_and(|dir| dir.join(DISTRO_MANAGED_MARKER).is_file())
}

/// The `.app` folder an executable belongs to.
#[cfg(any(target_os = "macos", test))]
fn app_bundle(executable: &Path) -> Option<&Path> {
    executable
        .ancestors()
        .find(|dir| dir.extension().is_some_and(|ext| ext == "app"))
}

/// Whether `path` is on a volume mounted read-only, as a disk image and a translocated app are.
#[cfg(target_os = "macos")]
fn on_read_only_volume(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;

    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: `path` is NUL-terminated and `stats` is written in full when statfs returns 0.
    if unsafe { libc::statfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return false;
    }
    // SAFETY: statfs succeeded, so it initialised `stats`.
    let flags = unsafe { stats.assume_init() }.f_flags;
    flags & libc::MNT_RDONLY.cast_unsigned() != 0
}

#[cfg(target_os = "macos")]
fn runs_from_read_only_location() -> bool {
    std::env::current_exe()
        .ok()
        .as_deref()
        .and_then(app_bundle)
        .is_some_and(on_read_only_volume)
}

#[cfg(not(target_os = "macos"))]
fn runs_from_read_only_location() -> bool {
    false
}

pub fn detect(resource_dir: Option<&Path>) -> UpdateSupport {
    let flatpak = std::env::var_os("FLATPAK_ID").is_some() || Path::new("/.flatpak-info").exists();
    decide(
        flatpak,
        has_marker(resource_dir),
        tauri::utils::platform::bundle_type().as_ref(),
        runs_from_read_only_location(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_installs_update_themselves() {
        for bundle in [
            BundleType::AppImage,
            BundleType::Deb,
            BundleType::Rpm,
            BundleType::Nsis,
            BundleType::Msi,
            BundleType::App,
        ] {
            assert!(
                decide(false, false, Some(&bundle), false).supported,
                "{bundle:?}"
            );
        }
    }

    #[test]
    fn flatpak_wins_over_everything() {
        let support = decide(true, true, Some(&BundleType::Deb), false);
        assert_eq!(support.reason, Some(UpdateBlock::Flatpak));
        assert!(!support.supported);
    }

    #[test]
    fn marker_blocks_a_repackaged_deb() {
        let support = decide(false, true, Some(&BundleType::Deb), false);
        assert_eq!(support.reason, Some(UpdateBlock::PackageManager));
    }

    #[test]
    fn a_raw_binary_is_unbundled() {
        let support = decide(false, false, None, false);
        assert_eq!(support.reason, Some(UpdateBlock::Unbundled));
    }

    #[test]
    fn only_appimages_and_raw_binaries_register_links_at_runtime() {
        let appimage = Some(&BundleType::AppImage);
        assert!(decide(false, false, appimage, false).registers_link_handler(appimage));
        assert!(decide(false, false, None, false).registers_link_handler(None));
        for bundle in [BundleType::Deb, BundleType::Rpm] {
            let bundle = Some(&bundle);
            assert!(!decide(false, false, bundle, false).registers_link_handler(bundle));
        }
    }

    #[test]
    fn packaged_installs_keep_their_own_desktop_entry() {
        // The AUR repackages the .deb and the Flatpak runs a raw cargo build.
        let deb = Some(&BundleType::Deb);
        assert!(!decide(false, true, deb, false).registers_link_handler(deb));
        assert!(!decide(true, false, None, false).registers_link_handler(None));
        let appimage = Some(&BundleType::AppImage);
        assert!(!decide(false, true, appimage, false).registers_link_handler(appimage));
    }

    #[test]
    fn a_mac_app_on_a_read_only_volume_waits_to_be_moved() {
        let app = Some(&BundleType::App);
        let support = decide(false, false, app, true);
        assert_eq!(support.reason, Some(UpdateBlock::ReadOnlyLocation));
        assert!(!support.supported);
        assert!(decide(false, false, app, false).supported);
    }

    #[test]
    fn finds_the_app_bundle_around_the_executable() {
        assert_eq!(
            app_bundle(Path::new("/Volumes/Flow/Flow.app/Contents/MacOS/flow")),
            Some(Path::new("/Volumes/Flow/Flow.app"))
        );
        assert_eq!(app_bundle(Path::new("/usr/bin/flow")), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn tells_a_read_only_volume_from_a_writable_one() {
        // macOS mounts the sealed system volume read-only.
        assert!(on_read_only_volume(Path::new("/System")));
        assert!(!on_read_only_volume(&std::env::temp_dir()));
    }

    #[test]
    fn marker_is_read_from_the_resource_dir() {
        let dir = std::env::temp_dir().join(format!("flow-update-support-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let before = has_marker(Some(&dir));
        std::fs::write(dir.join(DISTRO_MANAGED_MARKER), b"").unwrap();
        let after = has_marker(Some(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!before);
        assert!(after);
        assert!(!has_marker(None));
    }

    #[test]
    fn serializes_for_the_frontend() {
        let json =
            serde_json::to_string(&decide(false, true, Some(&BundleType::Deb), false)).unwrap();
        assert_eq!(json, r#"{"supported":false,"reason":"package-manager"}"#);
        let json =
            serde_json::to_string(&decide(false, false, Some(&BundleType::Deb), false)).unwrap();
        assert_eq!(json, r#"{"supported":true,"reason":null}"#);
    }
}
