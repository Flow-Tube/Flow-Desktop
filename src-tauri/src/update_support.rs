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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSupport {
    pub supported: bool,
    pub reason: Option<UpdateBlock>,
}

impl UpdateSupport {
    /// Flatpak and distro packages register `flow://` through their own
    /// .desktop file; registering at runtime would write a stray user-level
    /// handler (or fail inside the sandbox).
    pub fn package_owns_desktop_entry(self) -> bool {
        matches!(
            self.reason,
            Some(UpdateBlock::Flatpak | UpdateBlock::PackageManager)
        )
    }
}

fn decide(flatpak: bool, marker: bool, bundle: Option<&BundleType>) -> UpdateSupport {
    let reason = if flatpak {
        Some(UpdateBlock::Flatpak)
    } else if marker {
        Some(UpdateBlock::PackageManager)
    } else if bundle.is_none() {
        Some(UpdateBlock::Unbundled)
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

pub fn detect(resource_dir: Option<&Path>) -> UpdateSupport {
    let flatpak = std::env::var_os("FLATPAK_ID").is_some() || Path::new("/.flatpak-info").exists();
    decide(
        flatpak,
        has_marker(resource_dir),
        tauri::utils::platform::bundle_type().as_ref(),
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
            assert!(decide(false, false, Some(&bundle)).supported, "{bundle:?}");
        }
    }

    #[test]
    fn flatpak_wins_over_everything() {
        let support = decide(true, true, Some(&BundleType::Deb));
        assert_eq!(support.reason, Some(UpdateBlock::Flatpak));
        assert!(!support.supported);
    }

    #[test]
    fn marker_blocks_a_repackaged_deb() {
        let support = decide(false, true, Some(&BundleType::Deb));
        assert_eq!(support.reason, Some(UpdateBlock::PackageManager));
    }

    #[test]
    fn a_raw_binary_is_unbundled() {
        let support = decide(false, false, None);
        assert_eq!(support.reason, Some(UpdateBlock::Unbundled));
        assert!(!support.package_owns_desktop_entry());
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
        let json = serde_json::to_string(&decide(false, true, Some(&BundleType::Deb))).unwrap();
        assert_eq!(json, r#"{"supported":false,"reason":"package-manager"}"#);
        let json = serde_json::to_string(&decide(false, false, Some(&BundleType::Deb))).unwrap();
        assert_eq!(json, r#"{"supported":true,"reason":null}"#);
    }
}
