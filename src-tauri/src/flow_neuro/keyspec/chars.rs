//! Character classes as Android reads them. Kotlin walks UTF-16 code units, so a character
//! outside the Basic Multilingual Plane is two surrogates there: never a letter, digit, mark or
//! script member, and two units long. These helpers answer exactly that way, so a title splits
//! and sizes the same on both apps.

use icu_properties::CodePointMapData;
use icu_properties::props::{GeneralCategory, Script};

fn category(c: char) -> Option<GeneralCategory> {
    is_bmp(c).then(|| CodePointMapData::<GeneralCategory>::new().get(c))
}

fn is_bmp(c: char) -> bool {
    u32::from(c) <= 0xFFFF
}

/// The character's script, or `None` outside the BMP (Java's `UnicodeScript.of` on a surrogate).
pub(crate) fn script(c: char) -> Option<Script> {
    is_bmp(c).then(|| CodePointMapData::<Script>::new().get(c))
}

/// Java `Character.isLetter`.
pub(crate) fn is_letter(c: char) -> bool {
    matches!(
        category(c),
        Some(
            GeneralCategory::UppercaseLetter
                | GeneralCategory::LowercaseLetter
                | GeneralCategory::TitlecaseLetter
                | GeneralCategory::ModifierLetter
                | GeneralCategory::OtherLetter
        )
    )
}

/// Java `Character.isDigit`: decimal digits of any script.
pub(crate) fn is_digit(c: char) -> bool {
    category(c) == Some(GeneralCategory::DecimalNumber)
}

pub(crate) fn is_letter_or_digit(c: char) -> bool {
    is_letter(c) || is_digit(c)
}

pub(crate) fn is_mark(c: char) -> bool {
    matches!(
        category(c),
        Some(
            GeneralCategory::NonspacingMark
                | GeneralCategory::SpacingMark
                | GeneralCategory::EnclosingMark
        )
    )
}

/// Kotlin `Char.isWhitespace`: Java whitespace or a space separator, line or paragraph separator.
pub(crate) fn is_whitespace(c: char) -> bool {
    matches!(c, '\t'..='\r' | '\u{1C}'..='\u{1F}')
        || matches!(
            category(c),
            Some(
                GeneralCategory::SpaceSeparator
                    | GeneralCategory::LineSeparator
                    | GeneralCategory::ParagraphSeparator
            )
        )
}

/// Kotlin `String.trim()`.
pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_whitespace)
}

/// Kotlin `String.length`: UTF-16 code units.
pub(crate) fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}
