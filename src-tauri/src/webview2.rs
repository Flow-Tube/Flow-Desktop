//! WebView2 (Windows) browser arguments shared by every window.
//!
//! Setting `additionalBrowserArgs` replaces wry's defaults, which turn off
//! WebView2's out-of-process UI and SmartScreen check, so they are repeated
//! here. And WebView2 refuses to open a second webview on the same data
//! directory with different arguments, so the pop-out player and the hidden
//! poToken minter must pass exactly what the main window got from
//! `tauri.conf.json`.

pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

#[cfg(test)]
mod tests {
    use super::BROWSER_ARGS;

    #[test]
    fn the_main_window_uses_the_same_arguments() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main_window_args = config["app"]["windows"][0]["additionalBrowserArgs"].as_str();
        assert_eq!(main_window_args, Some(BROWSER_ARGS));
    }
}
