//! Subtitle files that belong to a video, found the way other players and common release layouts
//! put them, and turned into `WebVTT`, the one format the player reads.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use encoding_rs::Encoding;

use super::bounds::LibraryBounds;
use super::formats::extension_of;
use super::text::decode_text;

pub const SUBTITLE_EXTENSIONS: [&str; 4] = ["srt", "vtt", "ass", "ssa"];
const SUBTITLE_FOLDERS: [&str; 4] = ["subs", "sub", "subtitles", "subtitle"];
const MAX_SUBTITLE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FOLDER_ENTRIES: usize = 2000;
// Markers players put beside the language that are not a language themselves.
const MARKERS: [&str; 13] = [
    "sdh",
    "cc",
    "forced",
    "default",
    "full",
    "auto",
    "hi",
    "hearing",
    "impaired",
    "sign",
    "signs",
    "songs",
    "commentary",
];
const REGIONS: [&str; 22] = [
    "br", "pt", "us", "gb", "uk", "mx", "es", "cn", "tw", "hk", "jp", "kr", "de", "fr", "ca", "au",
    "in", "ru", "it", "nl", "ar", "419",
];
/// ISO 639-1, ISO 639-2 and the English and native names of the languages subtitles come in.
const LANGUAGES: [(&str, &str, &str, &str); 34] = [
    ("en", "eng", "english", "english"),
    ("es", "spa", "spanish", "español"),
    ("fr", "fre", "french", "français"),
    ("de", "ger", "german", "deutsch"),
    ("it", "ita", "italian", "italiano"),
    ("pt", "por", "portuguese", "português"),
    ("nl", "dut", "dutch", "nederlands"),
    ("sv", "swe", "swedish", "svenska"),
    ("no", "nor", "norwegian", "norsk"),
    ("da", "dan", "danish", "dansk"),
    ("fi", "fin", "finnish", "suomi"),
    ("pl", "pol", "polish", "polski"),
    ("cs", "cze", "czech", "čeština"),
    ("sk", "slo", "slovak", "slovenčina"),
    ("hu", "hun", "hungarian", "magyar"),
    ("ro", "rum", "romanian", "română"),
    ("bg", "bul", "bulgarian", "български"),
    ("hr", "hrv", "croatian", "hrvatski"),
    ("sr", "srp", "serbian", "српски"),
    ("el", "gre", "greek", "ελληνικά"),
    ("tr", "tur", "turkish", "türkçe"),
    ("ru", "rus", "russian", "русский"),
    ("uk", "ukr", "ukrainian", "українська"),
    ("he", "heb", "hebrew", "עברית"),
    ("ar", "ara", "arabic", "العربية"),
    ("fa", "per", "persian", "فارسی"),
    ("hi", "hin", "hindi", "हिन्दी"),
    ("id", "ind", "indonesian", "indonesia"),
    ("ms", "may", "malay", "melayu"),
    ("th", "tha", "thai", "ไทย"),
    ("vi", "vie", "vietnamese", "tiếng việt"),
    ("zh", "chi", "chinese", "中文"),
    ("ja", "jpn", "japanese", "日本語"),
    ("ko", "kor", "korean", "한국어"),
];

/// A subtitle file near a video. `path` is relative to the video's folder; `in_video_subfolder`
/// marks a file inside `Subs/<video name>/`, which releases use to keep each episode's apart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub path: String,
    pub in_video_subfolder: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleMatch {
    pub path: String,
    /// A language tag, or blank when the file's name doesn't carry one.
    pub language: String,
}

/// A file's words, the way the file name's separators divide them.
fn normalized(stem: &str) -> Vec<String> {
    stem.to_lowercase()
        .split(|c: char| matches!(c, '.' | '_' | '-' | '[' | ']' | '(' | ')') || c.is_whitespace())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect()
}

/// `S01E02` or `1x02` anywhere in the name, not inside a longer word or number.
fn episode_of(stem: &str) -> Option<(u32, u32)> {
    let lower = stem.to_lowercase();
    let chars: Vec<char> = lower.chars().collect();
    let number = |from: usize, max: usize| -> (usize, Option<u32>) {
        let digits: String = chars[from..]
            .iter()
            .take(max + 1)
            .take_while(|c| c.is_ascii_digit())
            .collect();
        (
            digits.len(),
            if digits.is_empty() || digits.len() > max {
                None
            } else {
                digits.parse().ok()
            },
        )
    };
    for start in 0..chars.len() {
        let before_ok = |allow_letter: bool| {
            start == 0 || {
                let previous = chars[start - 1];
                !previous.is_ascii_digit() && (allow_letter || !previous.is_alphabetic())
            }
        };
        if chars[start] == 's' && before_ok(false) {
            let (season_len, season) = number(start + 1, 2);
            let Some(season) = season else { continue };
            let mut at = start + 1 + season_len;
            if chars
                .get(at)
                .is_some_and(|c| matches!(c, ' ' | '.' | '_' | '-'))
            {
                at += 1;
            }
            if chars.get(at) == Some(&'e') {
                let (episode_len, episode) = number(at + 1, 3);
                if let (Some(episode), false) = (
                    episode,
                    chars
                        .get(at + 1 + episode_len)
                        .is_some_and(char::is_ascii_digit),
                ) {
                    return Some((season, episode));
                }
            }
        } else if chars[start].is_ascii_digit() && before_ok(true) {
            let (season_len, season) = number(start, 2);
            let Some(season) = season else { continue };
            if chars.get(start + season_len) == Some(&'x') {
                let (episode_len, episode) = number(start + season_len + 1, 3);
                if let (Some(episode), true) = (episode, episode_len >= 2) {
                    return Some((season, episode));
                }
            }
        }
    }
    None
}

fn language_of_word(word: &str) -> Option<&'static str> {
    LANGUAGES
        .iter()
        .find(|(two, three, english, native)| [*two, *three, *english, *native].contains(&word))
        .map(|(two, ..)| *two)
}

fn language_by_name(word: &str) -> Option<&'static str> {
    LANGUAGES
        .iter()
        .find(|(_, _, english, native)| [*english, *native].contains(&word))
        .map(|(two, ..)| *two)
}

fn is_region(word: &str) -> bool {
    REGIONS.contains(&word)
}

/// A word that can follow a video's name in its subtitle file's name.
fn describes_track(word: &str) -> bool {
    MARKERS.contains(&word)
        || language_of_word(word).is_some()
        || is_region(word)
        || (word.len() <= 2 && word.chars().all(|c| c.is_ascii_digit()))
}

/// The language a file's name carries. A language written out counts anywhere; a code only where
/// a name puts it after the video's name, or in the last two words, so a title word is not read
/// as a language.
pub fn language_of(words: &[String], codes_anywhere: bool) -> String {
    if let Some(language) = words.iter().find_map(|word| language_by_name(word)) {
        return language.to_string();
    }
    let first = if codes_anywhere {
        0
    } else {
        words.len().saturating_sub(2)
    };
    let found = (first..words.len()).find_map(|index| {
        let word = words[index].as_str();
        if MARKERS.contains(&word) {
            return None;
        }
        language_of_word(word).map(|language| (index, language))
    });
    let Some((index, language)) = found else {
        return String::new();
    };
    match words
        .get(index + 1)
        .filter(|word| is_region(word) && !word.is_empty())
    {
        Some(region) => format!("{language}-{}", region.to_uppercase()),
        None => language.to_string(),
    }
}

fn file_stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// The subtitle files among `candidates` that belong to the video:
/// named like it, with the same episode code, inside `Subs/<video name>/`, or any file when the
/// video is the only one in its folder. A file with another episode's code never matches. Files
/// named like the video come first.
pub fn matching_subtitle_files(
    video_name: &str,
    candidates: &[Candidate],
    videos_in_folder: usize,
) -> Vec<SubtitleMatch> {
    let video_stem = file_stem(video_name);
    let video_words = normalized(video_stem);
    let video_episode = episode_of(video_stem);

    let mut found: Vec<(u8, SubtitleMatch)> = candidates
        .iter()
        .filter_map(|candidate| {
            let name = candidate.path.rsplit('/').next()?;
            if !SUBTITLE_EXTENSIONS.contains(&extension_of(Path::new(name)).as_str()) {
                return None;
            }
            let stem = file_stem(name);
            let words = normalized(stem);
            let episode = episode_of(stem);
            if episode.is_some() && video_episode.is_some() && episode != video_episode {
                return None;
            }
            let tail = words.strip_prefix(video_words.as_slice());
            // A bare number after the name is another film ("Movie 2"), not a track of this one.
            let named_like_video = tail.is_some_and(|tail| {
                tail.is_empty()
                    || (tail.iter().all(|word| describes_track(word))
                        && tail
                            .iter()
                            .any(|word| !word.chars().all(|c| c.is_ascii_digit())))
            });
            let belongs = named_like_video
                || (episode.is_some() && episode == video_episode)
                || candidate.in_video_subfolder
                || (videos_in_folder == 1 && episode.is_none());
            if !belongs {
                return None;
            }
            let language = if named_like_video {
                language_of(tail.unwrap_or_default(), true)
            } else {
                language_of(&words, false)
            };
            let rank = if named_like_video {
                0
            } else if candidate.in_video_subfolder || episode.is_some() {
                1
            } else {
                2
            };
            Some((
                rank,
                SubtitleMatch {
                    path: candidate.path.clone(),
                    language,
                },
            ))
        })
        .collect();
    found.sort_by(|(a_rank, a), (b_rank, b)| {
        a_rank
            .cmp(b_rank)
            .then_with(|| a.language.is_empty().cmp(&b.language.is_empty()).reverse())
            .then_with(|| a.path.to_lowercase().cmp(&b.path.to_lowercase()))
    });
    found.into_iter().map(|(_, found)| found).collect()
}

/// The subtitle files in a video's folder and its `Subs` folders, and how many videos sit beside it.
pub fn candidates_near(video: &Path) -> (Vec<Candidate>, usize) {
    let mut candidates = Vec::new();
    let mut videos = 0;
    let Some(folder) = video.parent() else {
        return (candidates, 1);
    };
    let video_stem = video
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let Ok(entries) = std::fs::read_dir(folder) else {
        return (candidates, 1);
    };
    for entry in entries.flatten().take(MAX_FOLDER_ENTRIES) {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() && SUBTITLE_FOLDERS.contains(&name.to_lowercase().as_str()) {
            collect_subtitle_folder(&entry.path(), &name, &video_stem, &mut candidates);
        } else if file_type.is_file() {
            if super::formats::kind_of(Path::new(&name)) == Some(super::MediaKind::Video) {
                videos += 1;
            } else if SUBTITLE_EXTENSIONS.contains(&extension_of(Path::new(&name)).as_str()) {
                candidates.push(Candidate {
                    path: name,
                    in_video_subfolder: false,
                });
            }
        }
    }
    (candidates, videos)
}

fn collect_subtitle_folder(
    folder: &Path,
    folder_name: &str,
    video_stem: &str,
    out: &mut Vec<Candidate>,
) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten().take(MAX_FOLDER_ENTRIES) {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_file()
            && SUBTITLE_EXTENSIONS.contains(&extension_of(Path::new(&name)).as_str())
        {
            out.push(Candidate {
                path: format!("{folder_name}/{name}"),
                in_video_subfolder: false,
            });
        } else if file_type.is_dir() && name.to_lowercase() == video_stem {
            let Ok(inner) = std::fs::read_dir(entry.path()) else {
                continue;
            };
            for file in inner.flatten().take(MAX_FOLDER_ENTRIES) {
                let Ok(inner_name) = file.file_name().into_string() else {
                    continue;
                };
                if SUBTITLE_EXTENSIONS.contains(&extension_of(Path::new(&inner_name)).as_str()) {
                    out.push(Candidate {
                        path: format!("{folder_name}/{name}/{inner_name}"),
                        in_video_subfolder: true,
                    });
                }
            }
        }
    }
}

/// The subtitle files that belong to `video`, resolved and checked against the library's bounds.
pub fn subtitles_for(video: &Path, bounds: &LibraryBounds) -> Vec<(PathBuf, String)> {
    let Some(folder) = video.parent() else {
        return Vec::new();
    };
    let video_name = video
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let (candidates, videos) = candidates_near(video);
    matching_subtitle_files(video_name, &candidates, videos)
        .into_iter()
        .filter_map(|found| {
            let path = bounds.sidecar(&folder.join(&found.path), &SUBTITLE_EXTENSIONS)?;
            Some((path, found.language))
        })
        .collect()
}

/// A subtitle file as `WebVTT`, or `None` when it is too large, unreadable or holds no cues.
pub fn read_as_vtt(path: &Path, legacy: Option<&'static Encoding>) -> Option<String> {
    if std::fs::metadata(path).ok()?.len() > MAX_SUBTITLE_BYTES {
        return None;
    }
    let text = decode_text(&std::fs::read(path).ok()?, legacy);
    let vtt = match extension_of(path).as_str() {
        "vtt" => text,
        "srt" => srt_to_vtt(&text),
        "ass" | "ssa" => ass_to_vtt(&text),
        _ => return None,
    };
    vtt.contains("-->").then_some(vtt)
}

pub fn srt_to_vtt(srt: &str) -> String {
    let mut out = String::with_capacity(srt.len() + 8);
    out.push_str("WEBVTT\n\n");
    for line in srt.lines() {
        if line.contains("-->") {
            out.push_str(&line.replace(',', "."));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

/// `H:MM:SS.cc` as `HH:MM:SS.mmm`.
fn ass_time(time: &str) -> Option<String> {
    let (clock, centis) = time.trim().rsplit_once('.')?;
    let mut parts = clock.split(':');
    let (hours, minutes, seconds) = (parts.next()?, parts.next()?, parts.next()?);
    let hours: u32 = hours.parse().ok()?;
    let centis: u32 = centis.parse().ok()?;
    Some(format!(
        "{hours:02}:{minutes:0>2}:{seconds:0>2}.{:03}",
        centis * 10
    ))
}

/// Keeps the words and the timing; styling and positioning have no `WebVTT` equivalent here.
fn ass_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_override = false;
    for character in text.chars() {
        match character {
            '{' => in_override = true,
            '}' => in_override = false,
            other if !in_override => out.push(other),
            _ => {}
        }
    }
    out.replace("\\N", "\n")
        .replace("\\n", "\n")
        .replace("\\h", " ")
}

pub fn ass_to_vtt(ass: &str) -> String {
    let mut out = String::from("WEBVTT\n\n");
    let mut in_events = false;
    let (mut start_at, mut end_at, mut text_at, mut fields) = (1, 2, 9, 10);
    for line in ass.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
        } else if !in_events {
        } else if let Some(format) = line.strip_prefix("Format:") {
            let names: Vec<String> = format
                .split(',')
                .map(|name| name.trim().to_lowercase())
                .collect();
            let position = |wanted: &str, fallback: usize| {
                names
                    .iter()
                    .position(|name| name == wanted)
                    .unwrap_or(fallback)
            };
            start_at = position("start", start_at);
            end_at = position("end", end_at);
            text_at = position("text", text_at);
            fields = names.len();
        } else if let Some(dialogue) = line.strip_prefix("Dialogue:") {
            let parts: Vec<&str> = dialogue.splitn(fields, ',').collect();
            let (Some(start), Some(end), Some(text)) =
                (parts.get(start_at), parts.get(end_at), parts.get(text_at))
            else {
                continue;
            };
            let (Some(start), Some(end)) = (ass_time(start), ass_time(end)) else {
                continue;
            };
            let _ = write!(out, "{start} --> {end}\n{}\n\n", ass_text(text));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(path: &str) -> Candidate {
        Candidate {
            path: path.into(),
            in_video_subfolder: false,
        }
    }

    fn matched(video: &str, candidates: &[Candidate], videos: usize) -> Vec<(String, String)> {
        matching_subtitle_files(video, candidates, videos)
            .into_iter()
            .map(|found| (found.path, found.language))
            .collect()
    }

    #[test]
    fn a_file_named_like_the_video_matches_with_its_language() {
        let found = matched(
            "Movie.2024.mkv",
            &[
                at("Movie.2024.srt"),
                at("Movie.2024.en.srt"),
                at("movie 2024 pt-BR.vtt"),
                at("Other.srt"),
            ],
            2,
        );
        assert_eq!(
            found,
            vec![
                ("Movie.2024.srt".to_string(), String::new()),
                ("movie 2024 pt-BR.vtt".to_string(), "pt-BR".to_string()),
                ("Movie.2024.en.srt".to_string(), "en".to_string()),
            ]
        );
    }

    #[test]
    fn markers_beside_the_language_still_count_as_the_video() {
        let found = matched(
            "Film.mp4",
            &[at("Film.en.forced.srt"), at("Film.English.sdh.ass")],
            2,
        );
        assert_eq!(
            found
                .iter()
                .map(|(_, language)| language.as_str())
                .collect::<Vec<_>>(),
            ["en", "en"]
        );
    }

    #[test]
    fn a_bare_number_after_the_name_is_another_film() {
        assert!(matched("Movie.mkv", &[at("Movie 2.srt")], 2).is_empty());
        assert!(matched("Movie.mkv", &[at("Movie Director Cut.srt")], 2).is_empty());
    }

    #[test]
    fn the_same_episode_code_matches_and_another_never_does() {
        let found = matched(
            "Show.S01E02.1080p.mkv",
            &[
                at("show_s1e2_en.srt"),
                at("Show.S01E03.srt"),
                at("1x02.spanish.ass"),
            ],
            5,
        );
        assert_eq!(
            found,
            vec![
                ("1x02.spanish.ass".to_string(), "es".to_string()),
                ("show_s1e2_en.srt".to_string(), "en".to_string()),
            ]
        );
    }

    #[test]
    fn a_video_alone_in_its_folder_takes_any_file_but_another_episodes() {
        let found = matched("Film.mkv", &[at("English.srt"), at("Subs/2_French.srt")], 1);
        assert_eq!(found.len(), 2);
        assert!(found.contains(&("English.srt".to_string(), "en".to_string())));
        assert!(found.contains(&("Subs/2_French.srt".to_string(), "fr".to_string())));
        assert!(matched("Film.mkv", &[at("English.srt")], 2).is_empty());
    }

    #[test]
    fn a_subfolder_named_for_the_video_belongs_to_it() {
        let candidate = Candidate {
            path: "Subs/Film/3_Eng.srt".into(),
            in_video_subfolder: true,
        };
        assert_eq!(
            matched("Film.mkv", &[candidate], 4),
            vec![("Subs/Film/3_Eng.srt".to_string(), "en".to_string())]
        );
    }

    #[test]
    fn a_title_word_is_not_read_as_a_language() {
        let words = normalized("It Was Hi There");
        assert_eq!(language_of(&words, false), "");
    }

    #[test]
    fn finds_files_on_disk_and_counts_the_videos_beside_it() {
        let dir = std::env::temp_dir().join(format!("flow-subs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("Subs/Film")).unwrap();
        let dir = std::fs::canonicalize(dir).unwrap();
        for file in [
            "Film.mkv",
            "Film.en.srt",
            "Other.mp4",
            "notes.txt",
            "Subs/fr.srt",
            "Subs/Film/3_Eng.srt",
        ] {
            std::fs::write(dir.join(file), "x").unwrap();
        }
        let (mut candidates, videos) = candidates_near(&dir.join("Film.mkv"));
        candidates.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(videos, 2);
        assert_eq!(
            candidates
                .iter()
                .map(|found| found.path.as_str())
                .collect::<Vec<_>>(),
            ["Film.en.srt", "Subs/Film/3_Eng.srt", "Subs/fr.srt"]
        );
        assert!(candidates[1].in_video_subfolder);
        let bounds = LibraryBounds::new(vec![dir.clone()], Vec::new());
        let found = subtitles_for(&dir.join("Film.mkv"), &bounds);
        assert_eq!(found.len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn subrip_becomes_webvtt() {
        let vtt = srt_to_vtt("1\r\n00:00:01,500 --> 00:00:02,000\r\nHello, there\r\n");
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:01.500 --> 00:00:02.000\nHello, there\n"));
    }

    #[test]
    fn substation_keeps_words_and_timing_only() {
        let ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,1:02:03.00,Default,,0,0,0,,{\\an8}Hello, there\\Nfriend\nComment: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,skip\n";
        let vtt = ass_to_vtt(ass);
        assert!(
            vtt.contains("00:00:01.500 --> 01:02:03.000\nHello, there\nfriend\n"),
            "{vtt}"
        );
        assert!(!vtt.contains("skip"));
    }

    #[test]
    fn a_file_with_no_cues_or_too_large_is_refused() {
        let dir = std::env::temp_dir().join(format!("flow-vtt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let empty = dir.join("a.srt");
        std::fs::write(&empty, "nothing here").unwrap();
        assert_eq!(read_as_vtt(&empty, None), None);
        let large = dir.join("b.srt");
        std::fs::write(&large, vec![b'x'; 5 * 1024 * 1024]).unwrap();
        assert_eq!(read_as_vtt(&large, None), None);
        let good = dir.join("c.vtt");
        std::fs::write(&good, "WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n").unwrap();
        assert!(read_as_vtt(&good, None).is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
