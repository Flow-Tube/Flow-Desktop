//! Lyrics and subtitle files as text. Old ones are often in a legacy code page, which strict
//! UTF-8 rejects.

use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1252};

/// The code page a non-UTF-8 text file most likely uses, from the system language. It is a guess,
/// and a wrong one only garbles letters outside ASCII.
pub fn legacy_encoding(locale: &str) -> Option<&'static Encoding> {
    let language = locale
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let label: &[u8] = match language.as_str() {
        "zh" => b"gb18030",
        "ja" => b"shift_jis",
        "ko" => b"euc-kr",
        "ru" | "uk" | "be" | "bg" | "sr" | "mk" => b"windows-1251",
        "el" => b"windows-1253",
        "tr" => b"windows-1254",
        "he" | "iw" => b"windows-1255",
        "ar" | "fa" => b"windows-1256",
        "pl" | "cs" | "sk" | "hu" | "sl" | "hr" | "ro" => b"windows-1250",
        _ => return None,
    };
    Encoding::for_label(label)
}

/// A byte-order mark first, then strict UTF-8, then the legacy guess.
pub fn decode_text(bytes: &[u8], legacy: Option<&'static Encoding>) -> String {
    if let Some((encoding, skip)) = Encoding::for_bom(bytes) {
        debug_assert!([UTF_8, UTF_16LE, UTF_16BE].contains(&encoding));
        return encoding
            .decode_without_bom_handling(&bytes[skip..])
            .0
            .into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    legacy
        .unwrap_or(WINDOWS_1252)
        .decode_without_bom_handling(bytes)
        .0
        .into_owned()
}

/// This system's guess at the code page of old text files.
pub fn system_legacy_encoding() -> Option<&'static Encoding> {
    tauri_plugin_os::locale().and_then(|locale| legacy_encoding(&locale))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_marks_utf8_and_legacy_pages() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFhi", None), "hi");
        assert_eq!(decode_text(b"\xFF\xFEh\0i\0", None), "hi");
        assert_eq!(decode_text(b"\xFE\xFF\0h\0i", None), "hi");
        assert_eq!(decode_text("Snälla".as_bytes(), None), "Snälla");
        assert_eq!(decode_text(b"Sn\xE4lla", None), "Snälla");
        assert_eq!(
            decode_text(b"\xCF\xF0\xE8", legacy_encoding("ru-RU")),
            "При"
        );
    }

    #[test]
    fn names_a_page_only_for_languages_that_had_one() {
        assert!(legacy_encoding("ja").is_some());
        assert!(legacy_encoding("zh_CN").is_some());
        assert!(legacy_encoding("en-US").is_none());
    }
}
