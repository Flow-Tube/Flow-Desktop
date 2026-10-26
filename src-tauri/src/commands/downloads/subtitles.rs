//! The subtitle track chosen for a video download: fetched while the stream links
//! are fresh (caption links expire within hours), kept as `WebVTT` in app data for the
//! offline player, and written beside the video as `.srt` for other players.

use std::fmt::Write as _;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::ProgressEmitter;
use crate::models::video::CaptionTrack;

const SUBTITLE_STORE_DIR: &str = "download_subtitles";
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

/// What the user asked for. Translations are never offered: the site throttles them.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleChoice {
    pub language_code: String,
    pub auto_generated: bool,
}

/// A subtitle saved with a download, as stored in `downloads.subtitles_json`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSubtitle {
    pub language_code: String,
    pub label: String,
    pub path: String,
    pub is_auto_generated: bool,
}

/// The track that matches the choice: the same kind first, then any original
/// track in that language.
pub fn pick_track<'a>(
    captions: &'a [CaptionTrack],
    choice: &SubtitleChoice,
) -> Option<&'a CaptionTrack> {
    let originals = || captions.iter().filter(|track| !track.is_translation);
    let same_language = |track: &&CaptionTrack| {
        track
            .language_code
            .eq_ignore_ascii_case(&choice.language_code)
    };
    originals()
        .filter(same_language)
        .find(|track| track.is_auto_generated == choice.auto_generated)
        .or_else(|| originals().find(same_language))
}

pub async fn save_subtitle(
    app: &AppHandle,
    id: &str,
    media_path: &Path,
    track: &CaptionTrack,
    emitter: &ProgressEmitter,
) -> Option<SavedSubtitle> {
    let vtt = match fetch(&track.url).await {
        Ok(vtt) => vtt,
        Err(error) => {
            emitter.log(format!("Could not save the subtitles: {error}"));
            return None;
        }
    };
    let dir = app.path().app_data_dir().ok()?.join(SUBTITLE_STORE_DIR);
    tokio::fs::create_dir_all(&dir).await.ok()?;
    let language = sanitize_language(&track.language_code);
    let stored = dir.join(format!("{id}.{language}.vtt"));
    tokio::fs::write(&stored, &vtt).await.ok()?;
    let srt = srt_path(media_path, &language);
    if !tokio::fs::try_exists(&srt).await.unwrap_or(true) {
        match tokio::fs::write(&srt, vtt_to_srt(&vtt)).await {
            Ok(()) => emitter.log(format!("Saved subtitles to `{}`", srt.display())),
            Err(error) => emitter.log(format!("Could not write the subtitle file: {error}")),
        }
    }
    Some(SavedSubtitle {
        language_code: track.language_code.clone(),
        label: track.label.clone(),
        path: stored.to_string_lossy().into_owned(),
        is_auto_generated: track.is_auto_generated,
    })
}

/// `Video.en.srt` beside `Video.mp4`.
pub fn srt_path(media_path: &Path, language: &str) -> std::path::PathBuf {
    media_path.with_extension(format!("{}.srt", sanitize_language(language)))
}

fn sanitize_language(code: &str) -> String {
    code.chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect()
}

async fn fetch(url: &str) -> Result<String, String> {
    let response = crate::api::http::shared_client()
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            crate::api::http::BROWSER_USER_AGENT,
        )
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("caption server returned {}", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("could not read the subtitles: {error}"))?;
    if !text.trim_start().starts_with("WEBVTT") {
        return Err("the caption server did not return WebVTT".into());
    }
    Ok(text)
}

/// Converts `WebVTT` cues to `SubRip`: numbered cues, comma decimal separators, no cue
/// settings, no inline timing or styling tags.
pub fn vtt_to_srt(vtt: &str) -> String {
    let mut out = String::new();
    let mut number = 0;
    let mut lines = vtt.lines().peekable();
    while let Some(line) = lines.next() {
        let Some((start, rest)) = line.split_once("-->") else {
            continue;
        };
        let end = rest.split_whitespace().next().unwrap_or_default();
        let (Some(start), Some(end)) = (srt_time(start.trim()), srt_time(end)) else {
            continue;
        };
        let mut text = Vec::new();
        while let Some(next) = lines.peek() {
            if next.trim().is_empty() {
                break;
            }
            let cleaned = strip_tags(next);
            if !cleaned.trim().is_empty() {
                text.push(cleaned);
            }
            lines.next();
        }
        if text.is_empty() {
            continue;
        }
        number += 1;
        let _ = write!(out, "{number}\n{start} --> {end}\n{}\n\n", text.join("\n"));
    }
    out
}

/// `01:02.500` or `00:01:02.500` → `00:01:02,500`.
fn srt_time(value: &str) -> Option<String> {
    let (clock, millis) = value.split_once('.')?;
    let parts: Vec<&str> = clock.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => ("0", *minutes, *seconds),
        [hours, minutes, seconds] => (*hours, *minutes, *seconds),
        _ => return None,
    };
    let number = |text: &str| text.parse::<u32>().ok();
    Some(format!(
        "{:02}:{:02}:{:02},{:03}",
        number(hours)?,
        number(minutes)?,
        number(seconds)?,
        number(&millis[..millis.len().min(3)])?
    ))
}

fn strip_tags(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_tag = false;
    for character in line.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(character),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

#[cfg(test)]
mod tests {
    use super::{SubtitleChoice, pick_track, srt_path, vtt_to_srt};
    use crate::models::video::CaptionTrack;
    use std::path::Path;

    fn track(code: &str, auto: bool, translation: bool) -> CaptionTrack {
        CaptionTrack {
            id: format!("{code}-{auto}-{translation}"),
            label: code.into(),
            language_code: code.into(),
            url: String::new(),
            is_auto_generated: auto,
            is_translation: translation,
        }
    }

    #[test]
    fn picks_the_same_kind_then_any_original() {
        let captions = [
            track("en", true, false),
            track("en", false, false),
            track("fr", true, true),
        ];
        let manual = SubtitleChoice {
            language_code: "en".into(),
            auto_generated: false,
        };
        assert_eq!(
            pick_track(&captions, &manual).map(|t| t.is_auto_generated),
            Some(false)
        );
        let only_auto = [track("en", true, false)];
        assert!(pick_track(&only_auto, &manual).is_some());
        let french = SubtitleChoice {
            language_code: "fr".into(),
            auto_generated: true,
        };
        assert!(pick_track(&captions, &french).is_none());
    }

    #[test]
    fn converts_webvtt_cues_to_subrip() {
        let vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:02.500 align:start position:0%\nHello <c>there</c>\n\n01:02.000 --> 01:03.250\nA &amp; B\nline two\n\n";
        assert_eq!(
            vtt_to_srt(vtt),
            "1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:01:02,000 --> 00:01:03,250\nA & B\nline two\n\n"
        );
    }

    #[test]
    fn subtitle_files_sit_beside_the_video() {
        assert_eq!(
            srt_path(Path::new("/v/Cabin.mp4"), "en-US"),
            Path::new("/v/Cabin.en-US.srt")
        );
    }
}
