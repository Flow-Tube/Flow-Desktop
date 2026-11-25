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

use serde::{Deserialize, Serialize};

/// Settings > Appearance > Paint the page on the processor. Read at launch, before the web view.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PagePainting {
    /// Processor painting on the driver branch known to leak, the graphics card elsewhere.
    #[default]
    Automatic,
    Processor,
    #[serde(rename = "gpu")]
    GraphicsCard,
}

impl PagePainting {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Processor => "processor",
            Self::GraphicsCard => "gpu",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        [Self::Automatic, Self::Processor, Self::GraphicsCard]
            .into_iter()
            .find(|choice| choice.as_str() == value)
    }
}

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

/// Whether Flow asks for processor painting. A value the user set in the environment, 0 or 1,
/// is left alone, whatever Settings says.
fn paints_on_processor(choice: PagePainting, branch: Option<u32>, user_set: bool) -> bool {
    !user_set
        && match choice {
            PagePainting::Automatic => branch == Some(LEAKING_BRANCH),
            PagePainting::Processor => true,
            PagePainting::GraphicsCard => false,
        }
}

/// Turns processor painting on when Settings asks for it, or by default on the leaking driver
/// branch. Call before the web view exists, while this is the only thread. Returns whether Flow
/// set it.
#[cfg(target_os = "linux")]
pub fn apply(choice: PagePainting) -> bool {
    let branch = ["/proc/driver/nvidia/version", "/sys/module/nvidia/version"]
        .iter()
        .find_map(|path| std::fs::read_to_string(Path::new(path)).ok())
        .and_then(|text| driver_branch(&text));
    let chosen = paints_on_processor(choice, branch, std::env::var_os(CPU_PAINTING_VAR).is_some());
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

    const AUTO: PagePainting = PagePainting::Automatic;

    #[test]
    fn automatic_paints_on_the_processor_only_on_the_leaking_branch() {
        assert!(paints_on_processor(AUTO, Some(580), false));
        assert!(!paints_on_processor(AUTO, Some(615), false));
        assert!(!paints_on_processor(AUTO, Some(620), false));
        assert!(!paints_on_processor(AUTO, Some(570), false));
        assert!(!paints_on_processor(AUTO, None, false));
    }

    #[test]
    fn the_settings_choice_wins_over_the_driver() {
        assert!(paints_on_processor(PagePainting::Processor, None, false));
        assert!(paints_on_processor(
            PagePainting::Processor,
            Some(620),
            false
        ));
        assert!(!paints_on_processor(
            PagePainting::GraphicsCard,
            Some(580),
            false
        ));
    }

    #[test]
    fn leaves_a_value_the_user_set_alone() {
        assert!(!paints_on_processor(AUTO, Some(580), true));
        assert!(!paints_on_processor(PagePainting::Processor, None, true));
    }

    #[test]
    fn choices_round_trip_through_their_names() {
        for choice in [
            PagePainting::Automatic,
            PagePainting::Processor,
            PagePainting::GraphicsCard,
        ] {
            assert_eq!(PagePainting::parse(choice.as_str()), Some(choice));
            assert_eq!(
                serde_json::to_string(&choice).unwrap(),
                format!("\"{}\"", choice.as_str())
            );
        }
        assert_eq!(PagePainting::parse("bogus"), None);
    }
}
