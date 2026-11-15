//! Channel handle normalization, step for step the same as the list pipeline and Flow for Android
//! (Flow-Tube/AIlist README, "Handle normalization"), or nothing matches. The shared vectors in
//! the tests pin it; `src/lib/aiList/handle.ts` is the same rule for the cards.

use icu_properties::CodePointMapData;
use icu_properties::props::GeneralCategory;
use unicode_normalization::UnicodeNormalization;

const MAX_LENGTH: usize = 64;
const MIN_REPORT_LENGTH: usize = 3;
const MAX_REPORT_LENGTH: usize = 30;
const FORBIDDEN: [char; 5] = ['/', '%', '?', '#', '@'];
const REPORT_PUNCTUATION: [char; 4] = ['_', '-', '.', '·'];

/// The handle without `@`, lowercased, or `None` when the input is not a usable handle.
#[must_use]
pub fn normalize(input: &str) -> Option<String> {
    let decoded = percent_decode(extract(trim_js(input)));
    let handle = decoded.nfc().collect::<String>().to_lowercase();
    if handle.is_empty() || handle.chars().count() > MAX_LENGTH {
        return None;
    }
    if handle
        .chars()
        .any(|c| is_js_whitespace(c) || FORBIDDEN.contains(&c))
    {
        return None;
    }
    Some(handle)
}

/// The handle as a report names it, `@Name` in its own case, or `None` when it is not one AiSList
/// takes: 3 to 30 letters, digits, marks, `_`, `-`, `.` or `·` after the `@`, as YouTube allows.
#[must_use]
pub fn for_report(input: &str) -> Option<String> {
    let handle: String = percent_decode(extract(trim_js(input))).nfc().collect();
    let length = handle.chars().count();
    if !(MIN_REPORT_LENGTH..=MAX_REPORT_LENGTH).contains(&length) {
        return None;
    }
    handle
        .chars()
        .all(|c| is_reportable(c) || REPORT_PUNCTUATION.contains(&c))
        .then(|| format!("@{handle}"))
}

/// Java's `Character.isLetterOrDigit` or a mark, on the whole code point.
fn is_reportable(c: char) -> bool {
    matches!(
        CodePointMapData::<GeneralCategory>::new().get(c),
        GeneralCategory::UppercaseLetter
            | GeneralCategory::LowercaseLetter
            | GeneralCategory::TitlecaseLetter
            | GeneralCategory::ModifierLetter
            | GeneralCategory::OtherLetter
            | GeneralCategory::DecimalNumber
            | GeneralCategory::NonspacingMark
            | GeneralCategory::SpacingMark
            | GeneralCategory::EnclosingMark
    )
}

/// The part after `@`, or after `/@` in a channel URL, up to the next `/`, `?` or `#`.
fn extract(text: &str) -> &str {
    let rest = if let Some(rest) = text.strip_prefix('@') {
        rest
    } else if let Some(at) = text.find("/@") {
        &text[at + 2..]
    } else {
        return text;
    };
    rest.find(['/', '?', '#']).map_or(rest, |end| &rest[..end])
}

/// `decodeURIComponent`, which the pipeline uses: `+` stays a plus. Anything it would throw on
/// keeps the input as it was.
fn percent_decode(text: &str) -> String {
    if !text.contains('%') {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let Some(byte) = hex_byte(bytes.get(i + 1..i + 3)) else {
                return text.to_string();
            };
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_string())
}

fn hex_byte(pair: Option<&[u8]>) -> Option<u8> {
    let pair = std::str::from_utf8(pair?).ok()?;
    if !pair.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u8::from_str_radix(pair, 16).ok()
}

fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// JavaScript's `\s`, which `String.trim()` and the pipeline's rejection rule use.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{D}'
            | ' '
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // The pipeline's `normalize-vectors.json`, shared with Flow for Android.
    const VECTORS: [(&str, Option<&str>); 9] = [
        ("@DPCartoon%C3%80i-v6k", Some("dpcartoonài-v6k")),
        ("@HFY_en_Español", Some("hfy_en_español")),
        ("@소소한작업실-z8d", Some("소소한작업실-z8d")),
        ("@ELTÍOFRONTAL", Some("eltíofrontal")),
        ("/@LinusTechTips/shorts", Some("linustechtips")),
        (
            "@M%C3%BAsicaB%C3%ADblicaInstrumental",
            Some("músicabíblicainstrumental"),
        ),
        (" @Some.Channel_1 ", Some("some.channel_1")),
        (
            "@Aiomo%E3%81%82%E3%81%84%E3%81%8A%E3%82%82",
            Some("aiomoあいおも"),
        ),
        ("@Bad%ZZname", None),
    ];

    #[test]
    fn every_shared_vector_normalizes_exactly_as_the_pipeline_does() {
        for (input, expected) in VECTORS {
            assert_eq!(normalize(input).as_deref(), expected, "{input}");
        }
    }

    #[test]
    fn length_is_counted_in_code_points() {
        let sixty_four = format!("{}😀", "a".repeat(63));
        assert_eq!(
            normalize(&format!("@{sixty_four}")),
            Some(sixty_four.clone())
        );
        assert_eq!(normalize(&format!("@a{sixty_four}")), None);
    }

    #[test]
    fn whitespace_follows_javascript() {
        assert_eq!(normalize("\u{A0}@Name\u{FEFF}").as_deref(), Some("name"));
        assert_eq!(normalize("@Na\u{2007}me"), None);
        assert_eq!(normalize("@Na\u{85}me").as_deref(), Some("na\u{85}me"));
        assert_eq!(normalize("@Na\u{1C}me").as_deref(), Some("na\u{1C}me"));
    }

    #[test]
    fn a_plus_sign_survives_percent_decoding() {
        assert_eq!(normalize("@a+b%2Bc").as_deref(), Some("a+b+c"));
    }

    #[test]
    fn a_broken_utf8_sequence_keeps_the_input_which_is_then_rejected() {
        assert_eq!(normalize("@caf%C3"), None);
        assert_eq!(normalize("@caf%C3%A9").as_deref(), Some("café"));
    }

    #[test]
    fn a_channel_url_path_gives_its_handle() {
        assert_eq!(
            normalize("https://www.youtube.com/@SomeOne/videos?x=1").as_deref(),
            Some("someone")
        );
        assert_eq!(normalize("/@SomeOne").as_deref(), Some("someone"));
    }

    #[test]
    fn a_report_names_the_handle_in_its_own_case_decoded() {
        assert_eq!(
            for_report("/@AweFolktales").as_deref(),
            Some("@AweFolktales")
        );
        assert_eq!(
            for_report("/@M%C3%BAsicaB%C3%ADblica").as_deref(),
            Some("@MúsicaBíblica")
        );
        assert_eq!(
            for_report("@소소한작업실-z8d").as_deref(),
            Some("@소소한작업실-z8d")
        );
    }

    #[test]
    fn a_report_refuses_what_youtube_would_not_take_as_a_handle() {
        assert_eq!(for_report("@ab"), None);
        assert_eq!(for_report(&format!("@{}", "a".repeat(31))), None);
        assert_eq!(for_report("@has space"), None);
        assert_eq!(for_report("@emoji😀"), None);
    }
}
