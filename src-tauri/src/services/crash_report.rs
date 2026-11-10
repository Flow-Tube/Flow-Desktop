//! Keeps a report when the backend panics, for the next launch to offer. The release profile
//! aborts on panic, so the hook is the last thing that runs and writes synchronously. A report
//! stays on this computer unless someone chooses to send it, and everything in it is scrubbed
//! first: panic messages can quote URLs, tokens or keys.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const PENDING_FILE: &str = "pending_report.txt";
const LAST_FILE: &str = "last_report.txt";
const MAX_REPORT_BYTES: usize = 32 * 1024;
/// A run of ID characters this long with a digit in it is treated as a token or a hash.
const MIN_TOKEN_CHARS: usize = 32;
const REDACTED: &str = "[redacted]";

/// Names whose value never goes in a report, in `name=value` or `name: value` form.
const SECRET_NAMES: [&str; 20] = [
    "pot",
    "potoken",
    "po_token",
    "token",
    "access_token",
    "refresh_token",
    "key",
    "api_key",
    "secret",
    "password",
    "passwd",
    "visitordata",
    "visitor_data",
    "authorization",
    "cookie",
    "sapisid",
    "signature",
    "sig",
    "session",
    "mnemonic",
];

/// Where reports live: under the app data folder, shared by every profile.
pub fn folder(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("crash")
}

/// Installs the panic hook. First in `run()`, so a panic during startup is kept too.
pub fn install_hook(dir: PathBuf, version: String) {
    let previous = std::panic::take_hook();
    // Later panics are usually fallout from the first, which says what went wrong.
    let saved = AtomicBool::new(false);
    std::panic::set_hook(Box::new(move |info| {
        if !saved.swap(true, Ordering::SeqCst) {
            let thread = std::thread::current();
            let message = info
                .payload()
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_default();
            let report = build_report(&ReportParts {
                version: &version,
                time: &chrono::Utc::now().to_rfc3339(),
                thread: thread.name().unwrap_or("unnamed"),
                message: &message,
                location: &info.location().map(ToString::to_string).unwrap_or_default(),
                backtrace: &std::backtrace::Backtrace::force_capture().to_string(),
            });
            if std::fs::create_dir_all(&dir).is_ok() {
                let _ = std::fs::write(dir.join(PENDING_FILE), report);
            }
        }
        previous(info);
    }));
}

struct ReportParts<'a> {
    version: &'a str,
    time: &'a str,
    thread: &'a str,
    message: &'a str,
    location: &'a str,
    backtrace: &'a str,
}

fn build_report(parts: &ReportParts) -> String {
    let report = format!(
        "Flow crash report\nVersion: {}\nOS: {} {}\nTime: {}\nThread: {}\nMessage: {}\nWhere: {}\n\nBacktrace:\n{}\n",
        parts.version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        parts.time,
        parts.thread,
        parts.message,
        parts.location,
        parts.backtrace,
    );
    truncate(scrub(&report, dirs::home_dir().as_deref()))
}

fn truncate(mut text: String) -> String {
    if text.len() > MAX_REPORT_BYTES {
        let mut end = MAX_REPORT_BYTES;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}

/// Takes out what could identify someone or unlock something: the home folder, named secrets
/// and anything shaped like a token.
pub fn scrub(text: &str, home: Option<&Path>) -> String {
    let without_home = match home.and_then(Path::to_str).filter(|home| !home.is_empty()) {
        Some(home) => text.replace(home, "~"),
        None => text.to_owned(),
    };
    redact_tokens(&redact_named_secrets(&without_home))
}

fn is_name_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-'
}

fn redact_named_secrets(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        let character = chars[index];
        out.push(character);
        index += 1;
        if character != '=' && character != ':' {
            continue;
        }
        let name_end = index - 1;
        let mut name_start = name_end;
        while name_start > 0 && is_name_char(chars[name_start - 1]) {
            name_start -= 1;
        }
        let name: String = chars[name_start..name_end].iter().collect();
        if !SECRET_NAMES.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        while chars
            .get(index)
            .is_some_and(|next| *next == ' ' || *next == '"' || *next == '\'')
        {
            index += 1;
        }
        while chars.get(index).is_some_and(|next| {
            !next.is_whitespace() && !matches!(next, '&' | '"' | '\'' | ',' | ';' | ')' | '}')
        }) {
            index += 1;
        }
        out.push_str(REDACTED);
    }
    out
}

fn redact_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        if run.chars().count() >= MIN_TOKEN_CHARS && run.chars().any(|c| c.is_ascii_digit()) {
            out.push_str(REDACTED);
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for character in text.chars() {
        if is_name_char(character) {
            run.push(character);
        } else {
            flush(&mut run, &mut out);
            out.push(character);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// The report the last crash left, and whether anyone has answered it yet.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub report: String,
    pub pending: bool,
}

/// Reports on disk, kept in app state for the commands.
pub struct CrashReports {
    dir: PathBuf,
}

impl CrashReports {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn read(&self) -> Option<CrashReport> {
        let read = |file: &str| std::fs::read_to_string(self.dir.join(file)).ok();
        read(PENDING_FILE)
            .map(|report| CrashReport {
                report,
                pending: true,
            })
            .or_else(|| {
                read(LAST_FILE).map(|report| CrashReport {
                    report,
                    pending: false,
                })
            })
    }

    /// Stops offering the report, which stays readable on the Diagnostics page.
    pub fn dismiss(&self) -> std::io::Result<()> {
        let pending = self.dir.join(PENDING_FILE);
        if pending.exists() {
            std::fs::rename(pending, self.dir.join(LAST_FILE))?;
        }
        Ok(())
    }

    pub fn delete(&self) -> std::io::Result<()> {
        for file in [PENDING_FILE, LAST_FILE] {
            let path = self.dir.join(file);
            if path.exists() {
                std::fs::remove_file(path)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "flow-crash-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn named_secrets_never_reach_a_report() {
        let scrubbed = scrub(
            "bad url https://rr1.googlevideo.com/x?pot=abc&itag=18&key=hunter2 with token: \"s3cret\", Visitor_Data = ZZZ and password=p,q",
            None,
        );
        assert!(!scrubbed.contains("abc&"), "{scrubbed}");
        assert!(!scrubbed.contains("hunter2"), "{scrubbed}");
        assert!(!scrubbed.contains("s3cret"), "{scrubbed}");
        assert!(scrubbed.contains("pot=[redacted]&itag=18"), "{scrubbed}");
        assert!(scrubbed.contains("password=[redacted],q"), "{scrubbed}");
    }

    #[test]
    fn token_shaped_text_is_taken_out_but_code_paths_stay() {
        let token = "CgtYaW5kR0JTc2xOayiAkq3YBjIKCgJVUxIEGgAgOQ";
        let scrubbed = scrub(
            &format!(
                "minted {token} at src/services/crash_report.rs:12:3 in a_long_function_name_without_any_digits_in_it"
            ),
            None,
        );
        assert!(!scrubbed.contains(token), "{scrubbed}");
        assert!(
            scrubbed.contains("src/services/crash_report.rs:12:3"),
            "{scrubbed}"
        );
        assert!(
            scrubbed.contains("a_long_function_name_without_any_digits_in_it"),
            "{scrubbed}"
        );
    }

    #[test]
    fn the_home_folder_is_hidden() {
        let scrubbed = scrub(
            "could not open /Users/someone/Library/flow.db",
            Some(Path::new("/Users/someone")),
        );
        assert_eq!(scrubbed, "could not open ~/Library/flow.db");
    }

    #[test]
    fn a_report_says_what_and_where_within_its_size_limit() {
        let report = build_report(&ReportParts {
            version: "1.2.3",
            time: "2026-11-06T00:00:00Z",
            thread: "main",
            message: "index out of bounds",
            location: "src/lib.rs:1:2",
            backtrace: &"é".repeat(MAX_REPORT_BYTES),
        });
        assert!(report.starts_with("Flow crash report\nVersion: 1.2.3\n"));
        assert!(report.contains("Message: index out of bounds\nWhere: src/lib.rs:1:2\n"));
        assert!(report.len() <= MAX_REPORT_BYTES);
    }

    #[test]
    fn a_pending_report_is_offered_until_dismissed_then_stays_readable() {
        let dir = temp_dir("dismiss");
        let reports = CrashReports::new(dir.clone());
        assert_eq!(reports.read(), None);
        std::fs::write(dir.join(PENDING_FILE), "boom").unwrap();
        assert_eq!(
            reports.read(),
            Some(CrashReport {
                report: "boom".into(),
                pending: true
            })
        );
        reports.dismiss().unwrap();
        assert_eq!(
            reports.read(),
            Some(CrashReport {
                report: "boom".into(),
                pending: false
            })
        );
        reports.delete().unwrap();
        assert_eq!(reports.read(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
