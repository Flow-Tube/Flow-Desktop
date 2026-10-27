//! The user's theme file: a `custom.css` in Flow's config folder that desktop
//! shells and template tools rewrite whenever the system colours change (#81).
//! Flow only reads it; the frontend turns its `--flow-*` colours into a theme.

use serde::Serialize;
use std::io::ErrorKind;
use std::path::Path;
use std::time::SystemTime;

pub const FILE_NAME: &str = "custom.css";

/// Far more than any palette needs; a larger file is almost surely the wrong file.
pub const MAX_BYTES: u64 = 256 * 1024;

/// What Flow writes when the user asks for a starting point. It doubles as the
/// documentation, since the people who want this file are editing it by hand or
/// turning it into a template.
pub const STARTER: &str = r"/* Flow theme file. Flow reloads this file whenever it changes.
   Select it in Settings > Appearance > Theme file.

   Colours: any CSS colour works (hex, rgb(), hsl(), oklch(), color-mix()).
   Leave a line out to keep Flow's default for it.
   --flow-scheme picks light or dark controls; without it Flow decides
   from how bright --flow-background is.
   Remote url(), @import and @font-face are ignored. */
:root {
  --flow-scheme: dark;
  --flow-primary: #ff0000;
  --flow-on-primary: #ffffff;
  --flow-secondary: #aaaaaa;
  --flow-background: #0f0f0f;
  --flow-surface: #1d1d1d;
  --flow-on-surface: #f4f4f4;
  --flow-on-surface-variant: #b8b8b8;
  --flow-outline: #343434;
  --flow-error: #ef5350;

  /* Optional: Flow mixes these from the colours above when they are left out.
  --flow-surface-container-low: #171717;
  --flow-surface-container: #1d1d1d;
  --flow-surface-container-high: #242424;
  --flow-surface-container-highest: #303030;
  */
}

/* Rules below this line style Flow directly. They can stop matching
   when Flow's layout changes in an update. */
";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeFileStatus {
    Missing,
    Loaded,
    TooLarge,
    NotText,
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFileState {
    pub path: String,
    pub status: ThemeFileStatus,
    /// The file's text, only when `status` is `Loaded`.
    pub css: Option<String>,
}

pub fn read_theme_file(path: &Path) -> ThemeFileState {
    let (status, css) = match std::fs::metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => (ThemeFileStatus::Missing, None),
        Err(error) => {
            tracing::warn!(error = %error, "theme file unreadable");
            (ThemeFileStatus::Unreadable, None)
        }
        Ok(meta) if meta.len() > MAX_BYTES => (ThemeFileStatus::TooLarge, None),
        Ok(_) => match std::fs::read(path) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => (ThemeFileStatus::Loaded, Some(text)),
                Err(_) => (ThemeFileStatus::NotText, None),
            },
            // Deleted between the two calls, as an editor saving by rename can.
            Err(error) if error.kind() == ErrorKind::NotFound => (ThemeFileStatus::Missing, None),
            Err(error) => {
                tracing::warn!(error = %error, "theme file unreadable");
                (ThemeFileStatus::Unreadable, None)
            }
        },
    };
    ThemeFileState {
        path: path.to_string_lossy().into_owned(),
        status,
        css,
    }
}

/// Writes the starter file. Never replaces an existing one, so a user's own file
/// survives a stray click.
pub fn create_starter(path: &Path) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(STARTER.as_bytes())
}

/// What a write changes. Template tools replace the file by renaming a new one
/// over it, which a watch on the old file would miss; the pair changes either way.
pub type Fingerprint = Option<(Option<SystemTime>, u64)>;

pub fn fingerprint(path: &Path) -> Fingerprint {
    std::fs::metadata(path)
        .ok()
        .map(|meta| (meta.modified().ok(), meta.len()))
}

/// Decides when a polled file has a new version worth sending: once it has
/// changed since the last send and held still for one poll, so a tool that is
/// still writing never hands Flow half a file.
pub struct ChangeGate {
    sent: Fingerprint,
    seen: Fingerprint,
}

impl ChangeGate {
    pub fn new(current: Fingerprint) -> Self {
        Self {
            sent: current,
            seen: current,
        }
    }

    pub fn observe(&mut self, now: Fingerprint) -> bool {
        if now != self.seen {
            self.seen = now;
            return false;
        }
        if now == self.sent {
            return false;
        }
        self.sent = now;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("flow-theme-file-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_is_reported_with_its_path() {
        let path = temp_dir("missing").join(FILE_NAME);
        let state = read_theme_file(&path);
        assert_eq!(state.status, ThemeFileStatus::Missing);
        assert_eq!(state.css, None);
        assert!(state.path.ends_with(FILE_NAME));
    }

    #[test]
    fn a_text_file_is_loaded() {
        let path = temp_dir("loaded").join(FILE_NAME);
        std::fs::write(&path, ":root { --flow-primary: #00ff00; }").unwrap();
        let state = read_theme_file(&path);
        assert_eq!(state.status, ThemeFileStatus::Loaded);
        assert_eq!(
            state.css.as_deref(),
            Some(":root { --flow-primary: #00ff00; }")
        );
    }

    #[test]
    fn oversized_and_binary_files_are_refused() {
        let dir = temp_dir("refused");
        let big = dir.join("big.css");
        std::fs::write(&big, vec![b'a'; usize::try_from(MAX_BYTES).unwrap() + 1]).unwrap();
        assert_eq!(read_theme_file(&big).status, ThemeFileStatus::TooLarge);

        let binary = dir.join("binary.css");
        std::fs::write(&binary, [0xff, 0xfe, 0x00, 0xc3]).unwrap();
        let state = read_theme_file(&binary);
        assert_eq!(state.status, ThemeFileStatus::NotText);
        assert_eq!(state.css, None);
    }

    #[test]
    fn the_starter_never_replaces_a_users_file() {
        let path = temp_dir("starter").join("nested").join(FILE_NAME);
        create_starter(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), STARTER);

        std::fs::write(&path, "/* mine */").unwrap();
        let error = create_starter(&path).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "/* mine */");
    }

    #[test]
    fn the_gate_sends_a_change_once_it_holds_still() {
        let at = |len| Some((None, len));
        let mut gate = ChangeGate::new(at(1));
        assert!(!gate.observe(at(1)), "nothing changed");
        assert!(!gate.observe(at(5)), "still being written");
        assert!(!gate.observe(at(9)), "still being written");
        assert!(gate.observe(at(9)), "settled");
        assert!(!gate.observe(at(9)), "already sent");
        assert!(!gate.observe(None), "just deleted");
        assert!(gate.observe(None), "deletion settled");
    }

    #[test]
    fn the_fingerprint_follows_a_file_renamed_over_the_old_one() {
        let dir = temp_dir("rename");
        let path = dir.join(FILE_NAME);
        assert_eq!(fingerprint(&path), None);
        std::fs::write(&path, "a").unwrap();
        let first = fingerprint(&path);
        assert!(first.is_some());

        let staged = dir.join("custom.css.tmp");
        std::fs::write(&staged, "longer").unwrap();
        std::fs::rename(&staged, &path).unwrap();
        assert_ne!(fingerprint(&path), first);
    }
}
