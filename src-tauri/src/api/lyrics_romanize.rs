//! A Latin-script line for lyrics in other scripts, made on this computer when the lyrics source has
//! none. Android uses ICU's `Any-Latin; Latin-ASCII`; `deunicode` covers the same scripts here.

const MIN_JAPANESE_KANA: usize = 2;
/// Below this are the scripts' own vowel signs and marks; from here up, symbols stay as they are.
const FIRST_SYMBOL: u32 = 0x2000;

fn is_latin(c: char) -> bool {
    matches!(u32::from(c),
        0x41..=0x5A | 0x61..=0x7A | 0xC0..=0x24F | 0x1E00..=0x1EFF | 0x2C60..=0x2C7F | 0xA720..=0xA7FF | 0xFF21..=0xFF3A | 0xFF41..=0xFF5A)
}

fn is_cjk_punctuation(c: char) -> bool {
    matches!(u32::from(c), 0x3000..=0x303F | 0xFF01..=0xFF20 | 0xFF3B..=0xFF40 | 0xFF5B..=0xFF65)
}

fn needs_romanization(text: &str) -> bool {
    text.chars().any(|c| c.is_alphabetic() && !is_latin(c))
}

/// One line in Latin letters, or `None` when it has nothing to romanize. Letters of another script
/// next to a Latin one get a space, which transliteration would otherwise run together.
#[must_use]
pub fn romanize_line(text: &str) -> Option<String> {
    if !needs_romanization(text) {
        return None;
    }
    let mut out = String::with_capacity(text.len() * 2);
    let mut previous: Option<char> = None;
    for c in text.chars() {
        if let Some(prev) = previous
            && prev.is_alphabetic()
            && c.is_alphabetic()
            && is_latin(prev) != is_latin(c)
        {
            out.push(' ');
        }
        if is_latin(c) || c.is_ascii() {
            out.push(c);
        } else if c.is_alphanumeric() || u32::from(c) < FIRST_SYMBOL || is_cjk_punctuation(c) {
            if let Some(latin) = deunicode::deunicode_char(c) {
                out.push_str(&latin.to_lowercase());
            }
        } else {
            out.push(c);
        }
        previous = Some(c);
    }
    let line = out.split_whitespace().collect::<Vec<_>>().join(" ");
    (!line.is_empty() && line != text).then_some(line)
}

/// Whether lyrics are Japanese, decided once for the whole song: many Japanese lines are kanji alone,
/// which transliteration reads as Mandarin. A stray の in Chinese lyrics does not count.
#[must_use]
pub fn is_japanese_lyrics(lines: &[String]) -> bool {
    let (mut kana, mut han) = (0usize, 0usize);
    for c in lines.iter().flat_map(|line| line.chars()) {
        match u32::from(c) {
            0x3040..=0x30FF | 0xFF66..=0xFF9D => kana += 1,
            0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0x20000..=0x2FFFF => han += 1,
            _ => {}
        }
    }
    kana >= MIN_JAPANESE_KANA && kana * 4 >= han
}

/// A Latin line per lyric line. Japanese lyrics get none, as on Android.
#[must_use]
pub fn romanize_lines(lines: &[String]) -> Vec<Option<String>> {
    if is_japanese_lyrics(lines) {
        return vec![None; lines.len()];
    }
    lines.iter().map(|line| romanize_line(line)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(all: &[&str]) -> Vec<String> {
        all.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn the_scripts_android_covers_come_out_in_lower_case_latin() {
        assert_eq!(romanize_line("사랑해").as_deref(), Some("saranghae"));
        assert_eq!(romanize_line("你好").as_deref(), Some("ni hao"));
        assert_eq!(romanize_line("Привет").as_deref(), Some("privet"));
        assert_eq!(romanize_line("γειά").as_deref(), Some("geia"));
        assert!(romanize_line("مرحبا").is_some_and(|line| line.is_ascii()));
        assert!(romanize_line("नमस्ते").is_some_and(|line| line.is_ascii()));
        assert!(romanize_line("שלום").is_some_and(|line| line.is_ascii()));
        assert!(romanize_line("สวัสดี").is_some_and(|line| line.is_ascii()));
    }

    #[test]
    fn latin_lines_are_left_alone() {
        assert_eq!(romanize_line("hello there"), None);
        assert_eq!(romanize_line("café déjà vu"), None);
        assert_eq!(romanize_line("123 ♪"), None);
        assert_eq!(romanize_line("사랑 ♪").as_deref(), Some("sarang ♪"));
        assert_eq!(romanize_line(""), None);
    }

    #[test]
    fn mixed_lines_keep_their_latin_words_apart() {
        assert_eq!(romanize_line("love사랑").as_deref(), Some("love sarang"));
        assert_eq!(
            romanize_line("Love you, 사랑해!").as_deref(),
            Some("Love you, saranghae!")
        );
    }

    #[test]
    fn japanese_is_decided_for_the_whole_song() {
        let japanese = lines(&["愛してる", "空"]);
        assert!(is_japanese_lyrics(&japanese));
        assert_eq!(romanize_lines(&japanese), vec![None, None]);

        let chinese = lines(&["我爱你我爱你我爱你我爱你", "の"]);
        assert!(!is_japanese_lyrics(&chinese));
        assert!(romanize_lines(&chinese)[0].is_some());
    }
}
