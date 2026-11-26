//! Registers Flow for `flow://` links from inside an `AppImage`.
//!
//! The deep-link plugin does this with `xdg-mime`, a shell script, started with the bundle's
//! library path. The host's `/bin/sh` then loads the bundled readline, fails with
//! `undefined symbol: rl_print_keybinding` and nothing is registered, so links from the browser
//! extension never reach Flow. This writes the same handler entry and runs the host's tools
//! without the bundle paths.

/// The scheme in `plugins.deep-link.desktop.schemes`.
const SCHEME: &str = "flow";

/// The handler entry, as the deep-link plugin writes it.
fn desktop_entry(name: &str, exec: &str) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName={name}\nExec=\"{exec}\" %u\nTerminal=false\nMimeType=x-scheme-handler/{SCHEME}\nNoDisplay=true\n"
    )
}

/// The entry's file name, as the plugin names it, so a handler it wrote before is replaced.
fn entry_name(binary: &str) -> String {
    format!("{binary}-handler.desktop")
}

#[cfg(target_os = "linux")]
pub fn register(app: &tauri::AppHandle) -> Result<(), String> {
    use std::process::Stdio;

    use tauri::Manager;

    use crate::appimage::host_command;

    let appimage = app
        .env()
        .appimage
        .ok_or("APPIMAGE is not set")?
        .to_string_lossy()
        .into_owned();
    let binary = tauri::utils::platform::current_exe()
        .map_err(|error| error.to_string())?
        .file_name()
        .ok_or("the executable has no file name")?
        .to_string_lossy()
        .into_owned();
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| binary.clone());
    let applications = app
        .path()
        .data_dir()
        .map_err(|error| error.to_string())?
        .join("applications");
    std::fs::create_dir_all(&applications).map_err(|error| error.to_string())?;
    let file_name = entry_name(&binary);
    let entry = desktop_entry(&name, &appimage);
    let path = applications.join(&file_name);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(entry.as_str()) {
        std::fs::write(&path, entry).map_err(|error| error.to_string())?;
    }

    // The MIME cache is only an optimisation, and the tool is missing on some distros.
    let _ = host_command("update-desktop-database")
        .arg(&applications)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let mime_type = format!("x-scheme-handler/{SCHEME}");
    let status = host_command("xdg-mime")
        .args(["default", &file_name, &mime_type])
        .status()
        .map_err(|error| format!("xdg-mime: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("xdg-mime exited with {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_opens_flow_links_with_the_appimage() {
        let entry = desktop_entry("Flow", "/home/me/Apps/Flow_0.1.0-beta5_amd64.AppImage");
        assert_eq!(
            entry,
            "[Desktop Entry]\nType=Application\nName=Flow\nExec=\"/home/me/Apps/Flow_0.1.0-beta5_amd64.AppImage\" %u\nTerminal=false\nMimeType=x-scheme-handler/flow\nNoDisplay=true\n"
        );
    }

    #[test]
    fn the_entry_replaces_the_plugin_s() {
        assert_eq!(entry_name("flow-desktop"), "flow-desktop-handler.desktop");
    }
}
