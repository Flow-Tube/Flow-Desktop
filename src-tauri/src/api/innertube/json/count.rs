//! Counts as cards write them: "1,234,567 views", "1.2M", "13K watching".

/// The count `text` starts with, or none when it holds no count. English text
/// is read with its K, M and B; other languages by [`localized_count`].
#[must_use]
pub fn parse_count(text: &str) -> Option<u64> {
    if crate::api::innertube::core::locale::is_english() {
        english_count(text)
    } else {
        localized_count(text)
    }
}

/// CJK multipliers written straight after the number ("587万", "1.3億", "3천").
const CJK_MULTIPLIERS: [(char, f64); 7] = [
    ('千', 1e3),
    ('万', 1e4),
    ('萬', 1e4),
    ('億', 1e8),
    ('亿', 1e8),
    ('천', 1e3),
    ('만', 1e4),
];

fn is_group_mark(c: char) -> bool {
    matches!(c, ',' | '.' | '\'' | ' ' | '\u{a0}' | '\u{202f}')
}

/// A count in a language other than English. Exact counts ("621.747 Aufrufe",
/// "22 391 vues", "5,874,003回視聴") are read whatever their grouping marks,
/// and CJK multipliers are applied. An abbreviated count in any other language
/// ("23 Mio.", "220 k", "6,3 млн") has at most three digits and words this
/// reader does not know, so a number that short is no count at all rather than
/// a wrong one.
#[must_use]
pub fn localized_count(text: &str) -> Option<u64> {
    let chars: Vec<char> = text.chars().collect();
    let start = chars.iter().position(char::is_ascii_digit)?;
    let mut end = start;
    while end < chars.len()
        && (chars[end].is_ascii_digit()
            || (is_group_mark(chars[end]) && chars.get(end + 1).is_some_and(char::is_ascii_digit)))
    {
        end += 1;
    }
    if matches!(chars.get(end), Some('/' | ':'))
        || (start > 0 && matches!(chars[start - 1], '/' | ':'))
    {
        return None;
    }
    let token: String = chars[start..end].iter().collect();
    let next = chars[end..].iter().find(|c| !c.is_whitespace()).copied();
    if let Some((_, multiplier)) = CJK_MULTIPLIERS.iter().find(|(mark, _)| Some(*mark) == next) {
        let value = read_number(&token.replace(['\'', ' ', '\u{a0}', '\u{202f}'], ""))?;
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        return Some((value * multiplier).round() as u64);
    }
    // Grouped thousands: one to three digits, then groups of exactly three.
    // "12.10.2026" is a date, and "6,3" a decimal with its multiplier unread.
    let mut groups = token.split(is_group_mark);
    let grouped = groups
        .next()
        .is_some_and(|first| (1..=3).contains(&first.len()) || !token.contains(is_group_mark))
        && groups.all(|group| group.len() == 3);
    let digits: String = token.chars().filter(char::is_ascii_digit).collect();
    (grouped && digits.len() >= 4)
        .then(|| digits.parse().ok())
        .flatten()
}

/// The number is read with its grouping or decimal mark, then a K, M or B
/// directly after it, which must end a word, so "1.2M" is a million and the "m"
/// of "min" or "PM" is not. A number joined to a slash or colon is a date or a
/// time ("10/12/26", "7:00"), never a count.
fn english_count(text: &str) -> Option<u64> {
    let chars: Vec<char> = text.chars().collect();
    let start = chars.iter().position(char::is_ascii_digit)?;
    let mut end = start;
    while end < chars.len()
        && (chars[end].is_ascii_digit()
            || (matches!(chars[end], ',' | '.')
                && chars.get(end + 1).is_some_and(char::is_ascii_digit)))
    {
        end += 1;
    }
    if matches!(chars.get(end), Some('/' | ':'))
        || (start > 0 && matches!(chars[start - 1], '/' | ':'))
    {
        return None;
    }
    let token: String = chars[start..end].iter().collect();
    let value = read_number(&token)?;
    let rest: String = chars[end..].iter().collect();
    let rest = rest.trim_start().to_ascii_lowercase();
    let multiplier = match rest.chars().next() {
        Some('k') => 1_000.0,
        Some('m') => 1_000_000.0,
        Some('b') => 1_000_000_000.0,
        _ => 1.0,
    };
    let ends_word = !rest.chars().nth(1).is_some_and(char::is_alphabetic);
    let multiplier = if multiplier > 1.0 && ends_word {
        multiplier
    } else {
        1.0
    };
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let count = (value * multiplier).round() as u64;
    Some(count)
}

/// "1,234" is grouped thousands; "1.2" and "2,4" are decimals. A grouping mark
/// is always followed by three digits, a decimal mark here never is.
fn read_number(token: &str) -> Option<f64> {
    let last_mark = token.rfind([',', '.']);
    let plain = match last_mark {
        Some(index) if token.len() - index - 1 != 3 => {
            let whole: String = token[..index]
                .chars()
                .filter(char::is_ascii_digit)
                .collect();
            format!("{whole}.{}", &token[index + 1..])
        }
        _ => token.chars().filter(char::is_ascii_digit).collect(),
    };
    plain.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_counts_are_read_in_every_grouping_and_abbreviations_left_unknown() {
        assert_eq!(localized_count("621.747 Aufrufe"), Some(621_747));
        assert_eq!(localized_count("22\u{202f}391\u{a0}vues"), Some(22_391));
        assert_eq!(localized_count("621\u{a0}747 просмотров"), Some(621_747));
        assert_eq!(localized_count("5,874,003回視聴"), Some(5_874_003));
        assert_eq!(localized_count("587万回視聴"), Some(5_870_000));
        assert_eq!(localized_count("1.3億"), Some(130_000_000));
        assert_eq!(localized_count("23\u{a0}Mio."), None);
        assert_eq!(localized_count("220\u{a0}k"), None);
        assert_eq!(localized_count("6,3\u{a0}млн"), None);
        assert_eq!(localized_count("3,8\u{a0}mil"), None);
        assert_eq!(localized_count("Premiere am 12.10.2026, 19:00"), None);
    }

    #[test]
    fn exact_and_compact_counts() {
        assert_eq!(parse_count("1,234,567 views"), Some(1_234_567));
        assert_eq!(parse_count("1.2M views"), Some(1_200_000));
        assert_eq!(parse_count("22M"), Some(22_000_000));
        assert_eq!(parse_count("13K watching"), Some(13_000));
        assert_eq!(parse_count("1.5B"), Some(1_500_000_000));
        assert_eq!(parse_count("2,4 M"), Some(2_400_000));
        assert_eq!(parse_count("No views"), None);
        assert_eq!(parse_count("197 watching now"), Some(197));
    }

    #[test]
    fn dates_times_and_words_do_not_inflate() {
        assert_eq!(parse_count("Premieres 10/12/26"), None);
        assert_eq!(parse_count("Scheduled for 10/12/26, 7:00 PM"), None);
        assert_eq!(parse_count("12 waiting"), Some(12));
        assert_eq!(
            parse_count("5 min"),
            Some(5),
            "the m of min is not a million"
        );
        assert_eq!(parse_count("3 months ago"), Some(3));
    }
}
