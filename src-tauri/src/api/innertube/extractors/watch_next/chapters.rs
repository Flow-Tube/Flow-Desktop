//! Chapters and the "most replayed" heatmap. Both live in the watch answer:
//! the player bar's markers map holds the creator's or the generated chapters with
//! thumbnails, and an entity mutation holds the heatmap.

use serde_json::Value;

use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::largest_url;
use crate::models::video::{HeatmapMarker, VideoChapter};

/// The video's chapters and whether they were generated. The creator's
/// chapters win over generated ones.
#[must_use]
pub fn chapters(next: &Value, duration_seconds: u64) -> (Vec<VideoChapter>, bool) {
    for (key, auto) in [("DESCRIPTION_CHAPTERS", false), ("AUTO_CHAPTERS", true)] {
        let starts = marker_chapters(next, key).or_else(|| panel_chapters(next, key));
        if let Some(starts) = starts.filter(|starts| !starts.is_empty()) {
            return (with_ends(starts, duration_seconds), auto);
        }
    }
    (Vec::new(), false)
}

type ChapterStart = (u64, String, Option<String>);

fn marker_chapters(next: &Value, key: &str) -> Option<Vec<ChapterStart>> {
    let markers = next["playerOverlays"]["playerOverlayRenderer"]["decoratedPlayerBarRenderer"]
        ["decoratedPlayerBarRenderer"]["playerBar"]["multiMarkersPlayerBarRenderer"]["markersMap"]
        .as_array()?;
    let entry = markers.iter().find(|entry| entry["key"] == key)?;
    Some(
        entry["value"]["chapters"]
            .as_array()?
            .iter()
            .filter_map(|chapter| {
                let renderer = &chapter["chapterRenderer"];
                Some((
                    renderer["timeRangeStartMillis"].as_u64()? / 1000,
                    text_of(&renderer["title"])?,
                    largest_url(&renderer["thumbnail"]["thumbnails"]),
                ))
            })
            .collect(),
    )
}

/// The same chapters from the engagement panel the chapter list opens, for an
/// answer whose player bar has no markers.
fn panel_chapters(next: &Value, key: &str) -> Option<Vec<ChapterStart>> {
    let identifier = match key {
        "AUTO_CHAPTERS" => "engagement-panel-macro-markers-auto-chapters",
        _ => "engagement-panel-macro-markers-description-chapters",
    };
    let panel = next["engagementPanels"]
        .as_array()?
        .iter()
        .map(|panel| &panel["engagementPanelSectionListRenderer"])
        .find(|panel| panel["panelIdentifier"] == identifier)?;
    Some(
        panel["content"]["macroMarkersListRenderer"]["contents"]
            .as_array()?
            .iter()
            .filter_map(|item| {
                let renderer = &item["macroMarkersListItemRenderer"];
                Some((
                    renderer["onTap"]["watchEndpoint"]["startTimeSeconds"].as_u64()?,
                    text_of(&renderer["title"])?,
                    largest_url(&renderer["thumbnail"]["thumbnails"]),
                ))
            })
            .collect(),
    )
}

fn with_ends(starts: Vec<ChapterStart>, duration_seconds: u64) -> Vec<VideoChapter> {
    let ends: Vec<u64> = starts
        .iter()
        .skip(1)
        .map(|(start, _, _)| *start)
        .chain(std::iter::once(duration_seconds))
        .collect();
    starts
        .into_iter()
        .zip(ends)
        .filter(|((start, _, _), end)| end > start)
        .map(
            |((start_seconds, title, thumbnail_url), end_seconds)| VideoChapter {
                title,
                start_seconds,
                end_seconds,
                thumbnail_url,
            },
        )
        .collect()
}

/// Chapters written as timestamps in a description, under the site's own rule:
/// the first one at 0:00, at least three, in order. Anything else is a list of
/// moments, not chapters.
#[must_use]
pub fn description_chapters(description: &str, duration_seconds: u64) -> Vec<VideoChapter> {
    let starts: Vec<ChapterStart> = description
        .lines()
        .filter_map(chapter_line)
        .map(|(start, title)| (start, title, None))
        .collect();
    let in_order = starts.windows(2).all(|pair| pair[0].0 < pair[1].0);
    if starts.len() < 3 || starts[0].0 != 0 || !in_order {
        return Vec::new();
    }
    with_ends(starts, duration_seconds)
}

/// "0:00 Intro", "Intro - 1:02:03", "(12:30) Outro": the line's first timestamp
/// and the rest of it as the title.
fn chapter_line(line: &str) -> Option<(u64, String)> {
    let words: Vec<&str> = line.split_whitespace().collect();
    let (index, start) = words
        .iter()
        .enumerate()
        .find_map(|(index, word)| Some((index, parse_timestamp(word)?)))?;
    let title = words
        .iter()
        .enumerate()
        .filter(|(i, word)| *i != index && !matches!(**word, "-" | "–" | "—" | "|" | ":"))
        .map(|(_, word)| *word)
        .collect::<Vec<_>>()
        .join(" ");
    let title = title
        .trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '-' | '–' | ':' | ' '))
        .to_string();
    (!title.is_empty()).then_some((start, title))
}

fn parse_timestamp(word: &str) -> Option<u64> {
    let cleaned: String = word
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == ':')
        .collect();
    let parts: Vec<u64> = cleaned
        .split(':')
        .map(|part| (!part.is_empty()).then(|| part.parse().ok()).flatten())
        .collect::<Option<_>>()?;
    match parts.as_slice() {
        [minutes, seconds] if *seconds < 60 => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] if *minutes < 60 && *seconds < 60 => {
            Some(hours * 3600 + minutes * 60 + seconds)
        }
        _ => None,
    }
}

/// The "most replayed" graph: one marker per slice of the video.
#[must_use]
pub fn heatmap(next: &Value) -> Vec<HeatmapMarker> {
    let number = |value: &Value| value.as_u64().or_else(|| value.as_str()?.parse().ok());
    next["frameworkUpdates"]["entityBatchUpdate"]["mutations"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|mutation| &mutation["payload"]["macroMarkersListEntity"]["markersList"])
        .find(|list| list["markerType"] == "MARKER_TYPE_HEATMAP")
        .and_then(|list| list["markers"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|marker| {
            Some(HeatmapMarker {
                start_ms: number(&marker["startMillis"])?,
                duration_ms: number(&marker["durationMillis"])?,
                intensity: marker["intensityScoreNormalized"].as_f64()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chapter(title: &str, start_ms: u64) -> Value {
        json!({ "chapterRenderer": {
            "title": { "simpleText": title },
            "timeRangeStartMillis": start_ms,
            "thumbnail": { "thumbnails": [{ "url": format!("https://i.ytimg.com/{title}.jpg"), "width": 336 }] }
        } })
    }

    fn with_markers(entries: &Value) -> Value {
        json!({ "playerOverlays": { "playerOverlayRenderer": { "decoratedPlayerBarRenderer": {
            "decoratedPlayerBarRenderer": { "playerBar": { "multiMarkersPlayerBarRenderer": {
                "markersMap": entries
            } } }
        } } } })
    }

    #[test]
    fn auto_chapters_are_read_with_thumbnails_and_flagged() {
        let next = with_markers(&json!([{ "key": "AUTO_CHAPTERS", "value": {
            "chapters": [chapter("Red Light", 0), chapter("Glass", 95_000)]
        } }]));
        let (chapters, auto) = chapters(&next, 300);
        assert!(auto);
        assert_eq!(chapters.len(), 2);
        assert_eq!(
            (chapters[1].start_seconds, chapters[1].end_seconds),
            (95, 300)
        );
        assert_eq!(
            chapters[0].thumbnail_url.as_deref(),
            Some("https://i.ytimg.com/Red Light.jpg")
        );
    }

    #[test]
    fn the_creator_chapters_win_over_generated_ones() {
        let next = with_markers(&json!([
            { "key": "AUTO_CHAPTERS", "value": { "chapters": [chapter("Auto", 0)] } },
            { "key": "DESCRIPTION_CHAPTERS", "value": { "chapters": [chapter("Intro", 0)] } }
        ]));
        let (chapters, auto) = chapters(&next, 60);
        assert!(!auto);
        assert_eq!(chapters[0].title, "Intro");
    }

    #[test]
    fn panel_chapters_stand_in_for_a_bare_player_bar() {
        let next = json!({ "engagementPanels": [{ "engagementPanelSectionListRenderer": {
            "panelIdentifier": "engagement-panel-macro-markers-auto-chapters",
            "content": { "macroMarkersListRenderer": { "contents": [
                { "macroMarkersInfoItemRenderer": {} },
                { "macroMarkersListItemRenderer": { "title": { "simpleText": "Start" },
                    "onTap": { "watchEndpoint": { "startTimeSeconds": 0 } } } },
                { "macroMarkersListItemRenderer": { "title": { "simpleText": "End" },
                    "onTap": { "watchEndpoint": { "startTimeSeconds": 40 } } } }
            ] } }
        } }] });
        let (chapters, auto) = chapters(&next, 90);
        assert!(auto);
        assert_eq!(
            chapters
                .iter()
                .map(|c| c.title.as_str())
                .collect::<Vec<_>>(),
            ["Start", "End"]
        );
    }

    #[test]
    fn description_chapters_follow_the_youtube_rule() {
        let valid = "0:00 Intro\n1:30 - Setup\n(12:05) Results\nThanks for watching";
        let chapters = description_chapters(valid, 900);
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[1].title, "Setup");
        assert_eq!(
            (chapters[2].start_seconds, chapters[2].end_seconds),
            (725, 900)
        );

        assert!(description_chapters("1:30 Setup\n2:00 More\n3:00 End", 900).is_empty());
        assert!(description_chapters("0:00 Intro\n1:30 Setup", 900).is_empty());
        assert!(description_chapters("0:00 A\n3:00 B\n2:00 C", 900).is_empty());
    }

    #[test]
    fn heatmap_markers_take_string_or_number_times() {
        let next = json!({ "frameworkUpdates": { "entityBatchUpdate": { "mutations": [
            { "payload": { "likeStatusEntity": {} } },
            { "payload": { "macroMarkersListEntity": { "markersList": {
                "markerType": "MARKER_TYPE_HEATMAP",
                "markers": [
                    { "startMillis": "0", "durationMillis": "15420", "intensityScoreNormalized": 1 },
                    { "startMillis": 15420, "durationMillis": 15420, "intensityScoreNormalized": 0.25 }
                ]
            } } } }
        ] } } });
        let markers = heatmap(&next);
        assert_eq!(markers.len(), 2);
        assert_eq!(
            markers[1],
            HeatmapMarker {
                start_ms: 15420,
                duration_ms: 15420,
                intensity: 0.25
            }
        );
    }
}
