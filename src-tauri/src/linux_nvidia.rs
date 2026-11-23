//! Painting the page on the processor where NVIDIA's driver leaks on the GPU path.
//!
//! The 580 driver branch leaks a `sync_file` on the fence waits the web view makes for each part
//! of the page it paints on the GPU (bug 332147 at bugs.webkit.org, worked around after 2.52). A
//! reporter's GTX 1060 on 580.178.04 went from 169 open files to 1023 by resizing the window.
//! With `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` the count stayed near 130 and video was no choppier:
//! the page is painted on the processor and the GPU still puts the layers together. A reporter on
//! 615 and 620 does not see the leak, so only the 580 branch gets it.

#[cfg(target_os = "linux")]
use std::path::Path;

#[cfg(target_os = "linux")]
const CPU_PAINTING_VAR: &str = "WEBKIT_SKIA_ENABLE_CPU_RENDERING";

/// The driver branch the leak is reported on, as 580.142 and 580.178.04.
const LEAKING_BRANCH: u32 = 580;

/// The first number of the driver version in `/proc/driver/nvidia/version` or
/// `/sys/module/nvidia/version`, such as 580 for "580.178.04".
fn driver_branch(text: &str) -> Option<u32> {
    text.split_whitespace().find_map(|word| {
        let (branch, rest) = word.split_once('.')?;
        let numeric = !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit() || c == '.');
        if numeric { branch.parse().ok() } else { None }
    })
}

/// Whether Flow asks for processor painting. A value the user set, 0 or 1, is left alone.
fn paints_on_processor(branch: Option<u32>, user_set: bool) -> bool {
    !user_set && branch == Some(LEAKING_BRANCH)
}

/// Turns processor painting on for the leaking driver branch. Call before the web view exists,
/// while this is the only thread. Returns whether Flow set it.
#[cfg(target_os = "linux")]
pub fn apply() -> bool {
    let branch = ["/proc/driver/nvidia/version", "/sys/module/nvidia/version"]
        .iter()
        .find_map(|path| std::fs::read_to_string(Path::new(path)).ok())
        .and_then(|text| driver_branch(&text));
    let chosen = paints_on_processor(branch, std::env::var_os(CPU_PAINTING_VAR).is_some());
    if chosen {
        // SAFETY: called at the very start of `run()`, before the Tauri builder spawns any
        // threads or initializes GTK/WebKitGTK.
        unsafe { std::env::set_var(CPU_PAINTING_VAR, "1") };
    }
    chosen
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_branch_from_both_version_files() {
        assert_eq!(driver_branch("580.178.04\n"), Some(580));
        assert_eq!(
            driver_branch(
                "NVRM version: NVIDIA UNIX x86_64 Kernel Module  580.178.04  Tue Sep  9 21:28:03 UTC 2026\nGCC version:  gcc version 15.2.0\n"
            ),
            Some(580)
        );
        assert_eq!(
            driver_branch(
                "NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  620.70.06  Release Build  (dvs-builder@U22-I3)\n"
            ),
            Some(620)
        );
        assert_eq!(driver_branch("580.142"), Some(580));
    }

    #[test]
    fn finds_no_branch_in_text_without_a_version() {
        assert_eq!(driver_branch(""), None);
        assert_eq!(
            driver_branch("NVRM version: NVIDIA UNIX x86_64 Kernel Module"),
            None
        );
        assert_eq!(driver_branch("x86_64. v.1"), None);
    }

    #[test]
    fn paints_on_the_processor_only_on_the_leaking_branch() {
        assert!(paints_on_processor(Some(580), false));
        assert!(!paints_on_processor(Some(615), false));
        assert!(!paints_on_processor(Some(620), false));
        assert!(!paints_on_processor(Some(570), false));
        assert!(!paints_on_processor(None, false));
    }

    #[test]
    fn leaves_a_value_the_user_set_alone() {
        assert!(!paints_on_processor(Some(580), true));
    }
}
