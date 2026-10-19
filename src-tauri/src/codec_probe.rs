//! Linux-only startup probe of the GStreamer video decoders WebKitGTK uses. A
//! minimal install often ships the audio decoders but not H.264/VP9/AV1, so
//! audio plays while video hangs (issue #29). Logging the result at startup
//! makes every future "video frozen" report diagnosable from the logs alone,
//! even before the user plays anything and independently of the in-player probe.
//!
//! The AppImage bundles its own plugins, which the host's `gst-inspect-1.0`
//! can't load, so there the probe checks the bundled plugin files instead of
//! reporting every decoder "absent" (issues #70, #74, #94).

use std::path::{Path, PathBuf};

use crate::appimage::host_command;

/// `gst-inspect-1.0 <element>` exits 0 when the element exists. `None` means we
/// couldn't check (the tool isn't installed) — we never claim "absent" then.
fn probe(element: &str) -> Option<bool> {
    match host_command("gst-inspect-1.0").arg(element).output() {
        Ok(output) => Some(output.status.success()),
        Err(_) => None,
    }
}

/// True if any of the candidate decoder elements is present; `Some(false)` only
/// when the tool ran but found none; `None` when we couldn't probe at all.
fn any_present(elements: &[&str]) -> Option<bool> {
    let mut tool_ran = false;
    for element in elements {
        match probe(element) {
            Some(true) => return Some(true),
            Some(false) => tool_ran = true,
            None => {}
        }
    }
    tool_ran.then_some(false)
}

fn label(value: Option<bool>) -> &'static str {
    match value {
        Some(true) => "present",
        Some(false) => "absent",
        None => "unknown",
    }
}

fn bundled_plugin_dir() -> Option<PathBuf> {
    let appdir = PathBuf::from(std::env::var_os("APPDIR")?);
    // The AppImage's GStreamer hook points this at the bundled plugins.
    let dir = std::env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0")
        .and_then(|paths| std::env::split_paths(&paths).next())
        .filter(|dir| dir.starts_with(&appdir))
        .unwrap_or_else(|| appdir.join("usr/lib/gstreamer-1.0"));
    dir.is_dir().then_some(dir)
}

fn bundled(dir: &Path, plugins: &[&str]) -> &'static str {
    label(Some(plugins.iter().any(|plugin| dir.join(plugin).exists())))
}

/// Probes decoders and logs the result at INFO. Best-effort; call once at
/// startup (on a detached thread — it shells out to `gst-inspect-1.0`).
pub fn log_probe() {
    let libva_driver = std::env::var("LIBVA_DRIVER_NAME").ok();
    let libva_drivers_path = std::env::var("LIBVA_DRIVERS_PATH").ok();

    if let Some(dir) = bundled_plugin_dir() {
        // Hardware decoding also needs working host drivers; this only says
        // whether the bundle could use them.
        tracing::info!(
            source = "bundled",
            avdec_h264 = bundled(&dir, &["libgstlibav.so"]),
            vp9 = bundled(&dir, &["libgstvpx.so", "libgstlibav.so"]),
            av1 = bundled(&dir, &["libgstdav1d.so", "libgstaom.so"]),
            va = bundled(&dir, &["libgstva.so"]),
            nvcodec = bundled(&dir, &["libgstnvcodec.so"]),
            libva_driver = ?libva_driver,
            libva_drivers_path = ?libva_drivers_path,
            "gstreamer_decoder_probe"
        );
        return;
    }

    let h264 = any_present(&["avdec_h264"]);
    let vp9 = any_present(&["vp9dec", "avdec_vp9"]);
    let av1 = any_present(&["dav1ddec", "av1dec", "avdec_av1"]);
    let va = any_present(&["vah264dec", "vaapih264dec"]);
    let nvcodec = any_present(&["nvh264dec"]);

    tracing::info!(
        source = "host",
        avdec_h264 = label(h264),
        vp9 = label(vp9),
        av1 = label(av1),
        va = label(va),
        nvcodec = label(nvcodec),
        libva_driver = ?libva_driver,
        libva_drivers_path = ?libva_drivers_path,
        "gstreamer_decoder_probe"
    );

    if h264 == Some(false) {
        tracing::warn!(
            "System H.264 decoder (avdec_h264) not found — video may play audio \
             only. Install gstreamer1.0-libav (Debian/Ubuntu) or enable RPM Fusion \
             and install gstreamer1-libav (Fedora), or use the AppImage."
        );
    }
}
