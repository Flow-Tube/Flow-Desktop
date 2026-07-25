//! Linux-only startup probe of the system GStreamer video decoders WebKitGTK
//! uses. A minimal install often ships the audio decoders but not H.264/VP9/AV1,
//! so audio plays while video hangs (issue #29). Logging the result at startup
//! makes every future "video frozen" report diagnosable from the logs alone,
//! even before the user plays anything and independently of the in-player probe.

use std::process::Command;

/// `gst-inspect-1.0 <element>` exits 0 when the element exists. `None` means we
/// couldn't check (the tool isn't installed) — we never claim "absent" then.
fn probe(element: &str) -> Option<bool> {
    match Command::new("gst-inspect-1.0").arg(element).output() {
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

/// Probes decoders and logs the result at INFO. Best-effort; call once at
/// startup (on a detached thread — it shells out to `gst-inspect-1.0`).
pub fn log_probe() {
    let h264 = any_present(&["avdec_h264"]);
    let vp9 = any_present(&["vp9dec", "avdec_vp9"]);
    let av1 = any_present(&["dav1ddec", "av1dec", "avdec_av1"]);

    tracing::info!(
        avdec_h264 = label(h264),
        vp9 = label(vp9),
        av1 = label(av1),
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
