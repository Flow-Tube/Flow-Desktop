//! Gathers what a download is tagged with while its bytes transfer: the video's
//! details (description, date, channel, chapters) and its cover. Each lookup has a
//! deadline, and a miss only leaves that field out.

use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::ProgressEmitter;
use super::cover::{self, CoverShape};
use super::tags::{DownloadTags, TagKind};
use crate::models::video::{VideoChapter, VideoDetails};
use crate::services::youtube_service::YoutubeService;

/// Android's watch-page deadline; past it the file is tagged with what is known.
const DETAILS_TIMEOUT: Duration = Duration::from_secs(8);
const COVER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Default)]
pub struct PreparedMetadata {
    pub tags: DownloadTags,
    /// A JPEG under 1 MB, shaped for the kind.
    pub cover: Option<Vec<u8>>,
    pub chapters: Vec<VideoChapter>,
}

pub async fn prepare(
    app: AppHandle,
    mut tags: DownloadTags,
    thumbnail_url: Option<String>,
    emitter: ProgressEmitter,
) -> PreparedMetadata {
    let wants_details = tags.kind != TagKind::Music
        && !tags.video_id.is_empty()
        && (tags.release_date.is_none() || tags.description.is_none() || tags.channel_id.is_none());
    let details = async {
        if !wants_details {
            return None;
        }
        let service = app.try_state::<YoutubeService>()?.inner().clone();
        match tokio::time::timeout(DETAILS_TIMEOUT, service.get_video_details(&tags.video_id)).await
        {
            Ok(Ok(details)) => Some(details),
            Ok(Err(error)) => {
                emitter.log(format!(
                    "Could not load the video details for its tags: {error}"
                ));
                None
            }
            Err(_) => {
                emitter.log("Video details took too long; tagging with what is known");
                None
            }
        }
    };
    let shape = CoverShape::for_kind(tags.kind);
    let video_id = (!tags.video_id.is_empty()).then(|| tags.video_id.clone());
    let cover = async {
        match tokio::time::timeout(
            COVER_TIMEOUT,
            cover::fetch_cover(shape, video_id.as_deref(), thumbnail_url.as_deref()),
        )
        .await
        {
            Ok(Ok(jpeg)) => Some(jpeg),
            Ok(Err(error)) => {
                emitter.log(format!("Could not prepare the cover: {error}"));
                None
            }
            Err(_) => {
                emitter.log("The cover took too long to load");
                None
            }
        }
    };
    let (details, cover) = tokio::join!(details, cover);
    let chapters = details
        .map(|details| apply_details(&mut tags, details))
        .unwrap_or_default();
    PreparedMetadata {
        tags,
        cover,
        chapters,
    }
}

/// Fills the gaps in `tags` from the video's details and returns its chapters.
fn apply_details(tags: &mut DownloadTags, details: VideoDetails) -> Vec<VideoChapter> {
    if tags.description.is_none() {
        tags.description = details.description.filter(|text| !text.trim().is_empty());
    }
    if tags.channel_id.is_none() {
        tags.channel_id = details.channel_id;
    }
    if tags.channel_name.as_deref().is_none_or(str::is_empty) && !details.channel_name.is_empty() {
        tags.channel_name = Some(details.channel_name);
    }
    if tags.release_date.is_none() {
        tags.release_date = details.published_text.as_deref().and_then(published_date);
    }
    if tags.genre.is_none() {
        tags.genre = details.category;
    }
    if tags.view_count.is_none() {
        tags.view_count = details.view_count_text.as_deref().and_then(plain_count);
    }
    if tags.like_count.is_none() {
        tags.like_count = details.like_count_text.as_deref().and_then(plain_count);
    }
    details.chapters
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// An ISO date from "Mar 12, 2026", "12 Mar 2026", "Premiered Mar 12, 2026" or
/// "2026-03-12"; the year alone when the month or day cannot be read.
pub fn published_date(text: &str) -> Option<String> {
    let words: Vec<String> = text
        .split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == '/')
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    if let Some(iso) = words.iter().find_map(|word| iso_date(word)) {
        return Some(iso);
    }
    let year = words.iter().find_map(|word| {
        word.parse::<u32>()
            .ok()
            .filter(|year| (1900..=2200).contains(year))
    })?;
    let month = words.iter().find_map(|word| {
        MONTHS
            .iter()
            .position(|month| word.starts_with(month))
            .map(|index| index + 1)
    });
    let day = words.iter().find_map(|word| {
        word.parse::<u32>()
            .ok()
            .filter(|day| (1..=31).contains(day) && *day != year)
    });
    Some(match (month, day) {
        (Some(month), Some(day)) => format!("{year:04}-{month:02}-{day:02}"),
        _ => format!("{year:04}"),
    })
}

fn iso_date(word: &str) -> Option<String> {
    let mut parts = word.split('-');
    let year = parts.next()?.parse::<u32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    ((1900..=2200).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day))
        .then(|| format!("{year:04}-{month:02}-{day:02}"))
}

/// "1,234,567 views" → 1234567. Abbreviated counts ("1.2M") are skipped: a file tag
/// should not hold a guess.
fn plain_count(text: &str) -> Option<u64> {
    let number: String = text
        .split_whitespace()
        .next()?
        .chars()
        .filter(|c| *c != ',' && *c != '.' && *c != '\u{a0}')
        .collect();
    if number.is_empty() || !number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let first = text.split_whitespace().next()?;
    if first.contains('.') && !first.contains(',') {
        return None;
    }
    number.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::{apply_details, plain_count, published_date};
    use crate::commands::downloads::tags::DownloadTags;
    use crate::models::video::VideoDetails;

    #[test]
    fn reads_common_published_formats() {
        assert_eq!(
            published_date("Mar 12, 2026").as_deref(),
            Some("2026-03-12")
        );
        assert_eq!(published_date("12 Mar 2026").as_deref(), Some("2026-03-12"));
        assert_eq!(
            published_date("Premiered Jan 3, 2025").as_deref(),
            Some("2025-01-03")
        );
        assert_eq!(
            published_date("Streamed live on Sep 30, 2024").as_deref(),
            Some("2024-09-30")
        );
        assert_eq!(published_date("2023-07-08").as_deref(), Some("2023-07-08"));
        assert_eq!(
            published_date("12 mars 2026").as_deref(),
            Some("2026-03-12")
        );
        assert_eq!(published_date("2026年3月12日").as_deref(), None);
        assert_eq!(published_date("3 weeks ago"), None);
    }

    #[test]
    fn counts_are_only_exact_numbers() {
        assert_eq!(plain_count("1,234,567 views"), Some(1_234_567));
        assert_eq!(plain_count("987 views"), Some(987));
        assert_eq!(plain_count("1.2M views"), None);
        assert_eq!(plain_count("No views"), None);
    }

    #[test]
    fn details_fill_only_missing_tags() {
        let mut tags = DownloadTags {
            description: Some("Kept".into()),
            ..DownloadTags::default()
        };
        let details = VideoDetails {
            description: Some("Replaced?".into()),
            channel_id: Some("UC1".into()),
            channel_name: "Channel".into(),
            published_text: Some("Mar 12, 2026".into()),
            category: Some("Education".into()),
            ..VideoDetails::default()
        };
        apply_details(&mut tags, details);
        assert_eq!(tags.description.as_deref(), Some("Kept"));
        assert_eq!(tags.channel_id.as_deref(), Some("UC1"));
        assert_eq!(tags.channel_name.as_deref(), Some("Channel"));
        assert_eq!(tags.release_date.as_deref(), Some("2026-03-12"));
        assert_eq!(tags.genre.as_deref(), Some("Education"));
    }
}
