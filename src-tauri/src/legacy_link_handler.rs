//! Removes the user-level `flow://` handler that Flow 0.1.0-beta3 and earlier wrote on every
//! Linux install. The packages now take links through their own desktop entry, and once an
//! upgrade renamed `/usr/bin/flow`, that old handler pointed at nothing while it stayed the
//! default for `flow://`, so links would no longer open Flow.

/// The handler the deep-link plugin named after the old `flow` binary.
const LEGACY_HANDLER: &str = "flow-handler.desktop";
const SCHEME_KEY: &str = "x-scheme-handler/flow=";

/// The program an `Exec` line starts, when it is an absolute path (the plugin always wrote one).
fn exec_program(entry: &str) -> Option<&str> {
    let exec = entry.lines().find_map(|line| line.strip_prefix("Exec="))?;
    let program = match exec.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => exec.split_whitespace().next()?,
    };
    program.starts_with('/').then_some(program)
}

/// `mimeapps.list` without the legacy handler for `flow://`, or `None` when it has none.
fn without_handler(mimeapps: &str) -> Option<String> {
    let mut changed = false;
    let mut kept = Vec::new();
    for line in mimeapps.lines() {
        let Some(value) = line.strip_prefix(SCHEME_KEY) else {
            kept.push(line.to_owned());
            continue;
        };
        let ids: Vec<&str> = value
            .split(';')
            .filter(|id| !id.is_empty() && *id != LEGACY_HANDLER)
            .collect();
        if value.split(';').any(|id| id == LEGACY_HANDLER) {
            changed = true;
            if !ids.is_empty() {
                kept.push(format!("{SCHEME_KEY}{};", ids.join(";")));
            }
        } else {
            kept.push(line.to_owned());
        }
    }
    changed.then(|| {
        let mut out = kept.join("\n");
        if mimeapps.ends_with('\n') {
            out.push('\n');
        }
        out
    })
}

/// Deletes the old handler when the binary it starts is gone, and drops it as the `flow://`
/// default, so the package's own desktop entry takes the links again.
#[cfg(target_os = "linux")]
pub fn remove_stale(app: &tauri::AppHandle) {
    use tauri::Manager;

    let (Ok(data), Ok(config)) = (app.path().data_dir(), app.path().config_dir()) else {
        return;
    };
    let applications = data.join("applications");
    let handler = applications.join(LEGACY_HANDLER);
    let Ok(entry) = std::fs::read_to_string(&handler) else {
        return;
    };
    if exec_program(&entry).is_none_or(|program| std::path::Path::new(program).exists()) {
        return;
    }
    if let Err(error) = std::fs::remove_file(&handler) {
        tracing::warn!(%error, "could not remove the old flow:// handler");
        return;
    }
    let mimeapps = config.join("mimeapps.list");
    if let Some(updated) = std::fs::read_to_string(&mimeapps)
        .ok()
        .and_then(|list| without_handler(&list))
        && let Err(error) = std::fs::write(&mimeapps, updated)
    {
        tracing::warn!(%error, "could not drop the old flow:// default");
    }
    // The user MIME cache still lists the removed entry; the tool is optional on some distros.
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&applications)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    tracing::info!("removed the flow:// handler an older Flow left behind");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_program_the_plugin_wrote() {
        let entry = "[Desktop Entry]\nType=Application\nExec=\"/usr/bin/flow\" %u\n";
        assert_eq!(exec_program(entry), Some("/usr/bin/flow"));
        assert_eq!(
            exec_program("Exec=/opt/flow/flow %u"),
            Some("/opt/flow/flow")
        );
        assert_eq!(exec_program("Exec=flow %u"), None);
        assert_eq!(exec_program("Name=Flow"), None);
    }

    #[test]
    fn drops_only_the_legacy_default() {
        let list = "[Default Applications]\nx-scheme-handler/flow=flow-handler.desktop;\ntext/html=firefox.desktop\n\n[Added Associations]\nx-scheme-handler/flow=Flow.desktop;flow-handler.desktop;\n";
        assert_eq!(
            without_handler(list).as_deref(),
            Some(
                "[Default Applications]\ntext/html=firefox.desktop\n\n[Added Associations]\nx-scheme-handler/flow=Flow.desktop;\n"
            )
        );
    }

    #[test]
    fn leaves_other_handlers_alone() {
        let list = "[Default Applications]\nx-scheme-handler/flow=flow-desktop-handler.desktop;\n";
        assert_eq!(without_handler(list), None);
        assert_eq!(without_handler(""), None);
    }
}
