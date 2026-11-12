//! What kind of Linux system Flow runs on, for advice the user can act on:
//! which command installs video decoders here, and whether the install
//! carries its own (`AppImage`, Flatpak) so the system's don't matter.

use serde::Serialize;

/// How this system installs the `GStreamer` video decoders.
#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodecSource {
    /// Debian, Ubuntu and their family.
    Apt,
    /// Fedora and its family, whose own packages leave out a usable H.264 decoder.
    Dnf,
    /// Arch, Manjaro and their family.
    Pacman,
    /// The `AppImage` bundles its decoders; the system's are not used.
    Appimage,
    /// The Flatpak runtime brings its decoders.
    Flatpak,
    Other,
}

/// `ID` and `ID_LIKE` from an os-release file, lower case, unquoted.
#[cfg(any(target_os = "linux", test))]
fn os_ids(os_release: &str) -> Vec<String> {
    os_release
        .lines()
        .filter_map(|line| {
            line.strip_prefix("ID=")
                .or_else(|| line.strip_prefix("ID_LIKE="))
        })
        .flat_map(|value| {
            value
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .split_whitespace()
                .map(str::to_ascii_lowercase)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(any(target_os = "linux", test))]
pub fn codec_source(os_release: &str, appimage: bool, flatpak: bool) -> CodecSource {
    if flatpak {
        return CodecSource::Flatpak;
    }
    if appimage {
        return CodecSource::Appimage;
    }
    for id in os_ids(os_release) {
        match id.as_str() {
            "debian" | "ubuntu" => return CodecSource::Apt,
            "fedora" | "rhel" | "centos" => return CodecSource::Dnf,
            "arch" | "archlinux" => return CodecSource::Pacman,
            _ => {}
        }
    }
    CodecSource::Other
}

#[cfg(target_os = "linux")]
#[must_use]
pub fn detect_codec_source() -> CodecSource {
    let os_release = std::fs::read_to_string("/etc/os-release")
        .or_else(|_| std::fs::read_to_string("/usr/lib/os-release"))
        .unwrap_or_default();
    let flatpak =
        std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists();
    codec_source(&os_release, std::env::var_os("APPIMAGE").is_some(), flatpak)
}

/// The graphics facts a Linux bug report needs and the page cannot see.
/// Nothing in it identifies the user.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphicsReport {
    /// The startup tier this launch used (0 to 3), see `linux_startup`.
    pub tier: u8,
    pub tier_reason: &'static str,
    /// Graphics compatibility in Settings.
    pub mode: &'static str,
    /// `XDG_SESSION_TYPE`: "wayland", "x11", or empty when unset.
    pub session: String,
    /// Drawn through X11 although the session may be Wayland (tier 3 or the user's own setting).
    pub x11_backend: bool,
    pub packaging: &'static str,
    pub webkitgtk: String,
    /// The startup decoder probe, until it finishes `None`.
    pub decoders: Option<String>,
}

#[cfg(target_os = "linux")]
fn packaging() -> &'static str {
    use tauri::utils::config::BundleType;
    match detect_codec_source() {
        CodecSource::Flatpak => "flatpak",
        CodecSource::Appimage => "appimage",
        _ => match tauri::utils::platform::bundle_type() {
            Some(BundleType::Deb) => "deb",
            Some(BundleType::Rpm) => "rpm",
            Some(_) => "package",
            None => "unbundled",
        },
    }
}

#[cfg(target_os = "linux")]
#[must_use]
pub fn graphics_report() -> Option<GraphicsReport> {
    let boot = crate::linux_startup::boot_report()?;
    // SAFETY: plain getters of the loaded WebKitGTK library's version numbers.
    let webkitgtk = unsafe {
        format!(
            "{}.{}.{}",
            webkit2gtk::ffi::webkit_get_major_version(),
            webkit2gtk::ffi::webkit_get_minor_version(),
            webkit2gtk::ffi::webkit_get_micro_version()
        )
    };
    Some(GraphicsReport {
        tier: boot.tier,
        tier_reason: boot.tier_reason(),
        mode: boot.mode.as_str(),
        session: std::env::var("XDG_SESSION_TYPE").unwrap_or_default(),
        x11_backend: std::env::var("GDK_BACKEND").is_ok_and(|backend| backend == "x11"),
        packaging: packaging(),
        webkitgtk,
        decoders: crate::codec_probe::summary(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_family_from_id_and_id_like() {
        let fedora = "NAME=\"Fedora Linux\"\nID=fedora\nVERSION_ID=44\n";
        let mint = "ID=linuxmint\nID_LIKE=\"ubuntu debian\"\n";
        let manjaro = "ID=manjaro\nID_LIKE=arch\n";
        let nobara = "ID=nobara\nID_LIKE=\"rhel centos fedora\"\n";
        let devuan = "ID=devuan\nID_LIKE=debian\n";
        assert_eq!(codec_source(fedora, false, false), CodecSource::Dnf);
        assert_eq!(codec_source(mint, false, false), CodecSource::Apt);
        assert_eq!(codec_source(manjaro, false, false), CodecSource::Pacman);
        assert_eq!(codec_source(nobara, false, false), CodecSource::Dnf);
        assert_eq!(codec_source(devuan, false, false), CodecSource::Apt);
        assert_eq!(
            codec_source("ID=gentoo\n", false, false),
            CodecSource::Other
        );
        assert_eq!(codec_source("", false, false), CodecSource::Other);
    }

    #[test]
    fn a_bundle_brings_its_own_decoders() {
        let fedora = "ID=fedora\n";
        assert_eq!(codec_source(fedora, true, false), CodecSource::Appimage);
        assert_eq!(codec_source(fedora, true, true), CodecSource::Flatpak);
    }

    #[test]
    fn version_id_is_not_mistaken_for_id() {
        assert_eq!(
            codec_source("VERSION_ID=arch\nID=debian\n", false, false),
            CodecSource::Apt
        );
    }
}
