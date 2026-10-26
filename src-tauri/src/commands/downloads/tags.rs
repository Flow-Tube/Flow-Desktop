//! What Flow writes into a downloaded file. Field names and the `io.github.aedev.flow`
//! freeform keys match the Android app's `DownloadTags` and `FlowTagFields`, so either
//! app can recognise a file the other saved.

use serde::{Deserialize, Serialize};

pub const TAG_NAMESPACE: &str = "io.github.aedev.flow";
pub const TAG_SCHEMA_VERSION: u32 = 1;
pub const DESCRIPTION_MAX_UTF16: usize = 2_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TagKind {
    #[default]
    Video,
    Music,
    Short,
}

impl TagKind {
    fn name(self) -> &'static str {
        match self {
            Self::Video => "VIDEO",
            Self::Music => "MUSIC",
            Self::Short => "SHORT",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadTags {
    pub kind: TagKind,
    pub video_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub album: Option<String>,
    pub album_id: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub playlist_id: Option<String>,
    /// An ISO date (`YYYY-MM-DD`) or a year.
    pub release_date: Option<String>,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub view_count: Option<u64>,
    pub like_count: Option<u64>,
    pub thumbnail_url: Option<String>,
    /// LRC text when synced, otherwise plain lines. Travels only in `©lyr`.
    pub lyrics: Option<String>,
}

impl DownloadTags {
    /// The artist line players show: the distinct credited artists, or the channel
    /// with the auto-generated " - Topic" suffix removed.
    #[must_use]
    pub fn display_artist(&self) -> Option<String> {
        let mut seen: Vec<String> = Vec::new();
        let mut credited: Vec<&str> = Vec::new();
        for artist in self.artists.iter().map(|name| name.trim()) {
            if artist.is_empty() {
                continue;
            }
            let key = artist.to_lowercase();
            if !seen.contains(&key) {
                seen.push(key);
                credited.push(artist);
            }
        }
        if !credited.is_empty() {
            return Some(credited.join(", "));
        }
        self.channel_name
            .as_deref()
            .map(strip_topic_suffix)
            .filter(|name| !name.is_empty())
    }

    #[must_use]
    pub fn source_url(&self) -> Option<String> {
        let id = self.video_id.trim();
        if id.is_empty() {
            return None;
        }
        Some(match self.kind {
            TagKind::Music => format!("https://music.youtube.com/watch?v={id}"),
            TagKind::Short => format!("https://www.youtube.com/shorts/{id}"),
            TagKind::Video => format!("https://www.youtube.com/watch?v={id}"),
        })
    }

    #[must_use]
    pub fn truncated_description(&self) -> Option<String> {
        self.description
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| truncate_utf16(text, DESCRIPTION_MAX_UTF16))
    }

    /// The flat Flow key/value pairs, in Android's order. Lyrics are left out.
    #[must_use]
    pub fn flow_fields(&self) -> Vec<(&'static str, String)> {
        let mut fields = vec![
            ("schema", TAG_SCHEMA_VERSION.to_string()),
            ("kind", self.kind.name().to_string()),
            ("videoId", self.video_id.clone()),
            ("title", self.title.clone()),
        ];
        let artists: Vec<&str> = self
            .artists
            .iter()
            .map(String::as_str)
            .filter(|name| !name.trim().is_empty())
            .collect();
        if !artists.is_empty() {
            fields.push((
                "artists",
                serde_json::to_string(&artists).unwrap_or_default(),
            ));
        }
        let optional: [(&'static str, Option<String>); 15] = [
            ("channelId", self.channel_id.clone()),
            ("channelName", self.channel_name.clone()),
            ("album", self.album.clone()),
            ("albumId", self.album_id.clone()),
            ("albumArtist", self.album_artist.clone()),
            ("trackNumber", self.track_number.map(|n| n.to_string())),
            ("trackTotal", self.track_total.map(|n| n.to_string())),
            ("playlistId", self.playlist_id.clone()),
            ("releaseDate", self.release_date.clone()),
            ("description", self.truncated_description()),
            ("sourceUrl", self.source_url()),
            ("viewCount", self.view_count.map(|n| n.to_string())),
            ("likeCount", self.like_count.map(|n| n.to_string())),
            ("thumbnailUrl", self.thumbnail_url.clone()),
            ("genre", self.genre.clone()),
        ];
        fields.extend(
            optional
                .into_iter()
                .filter_map(|(key, value)| value.filter(|v| !v.is_empty()).map(|v| (key, v))),
        );
        fields
    }
}

fn strip_topic_suffix(name: &str) -> String {
    let trimmed = name.trim();
    let Some(head) = trimmed.strip_suffix("Topic") else {
        return trimmed.to_string();
    };
    let head = head.trim_end();
    let Some(head) = head.strip_suffix('-') else {
        return trimmed.to_string();
    };
    if head.is_empty() || head.ends_with(char::is_whitespace) {
        head.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// Cuts `text` to at most `max` UTF-16 units without splitting a character.
#[must_use]
pub fn truncate_utf16(text: &str, max: usize) -> String {
    let mut units = 0;
    let mut end = text.len();
    for (index, character) in text.char_indices() {
        units += character.len_utf16();
        if units > max {
            end = index;
            break;
        }
    }
    text[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::{DownloadTags, TagKind, truncate_utf16};

    #[test]
    fn display_artist_prefers_distinct_credits() {
        let tags = DownloadTags {
            artists: vec!["M83".into(), " m83 ".into(), "Zola Jesus".into()],
            channel_name: Some("M83 - Topic".into()),
            ..DownloadTags::default()
        };
        assert_eq!(tags.display_artist().as_deref(), Some("M83, Zola Jesus"));
    }

    #[test]
    fn display_artist_strips_topic_channels() {
        let tags = DownloadTags {
            channel_name: Some("M83 - Topic".into()),
            ..DownloadTags::default()
        };
        assert_eq!(tags.display_artist().as_deref(), Some("M83"));
        let plain = DownloadTags {
            channel_name: Some("Hot-Topic".into()),
            ..DownloadTags::default()
        };
        assert_eq!(plain.display_artist().as_deref(), Some("Hot-Topic"));
    }

    #[test]
    fn source_url_follows_the_kind() {
        let mut tags = DownloadTags {
            video_id: "abc".into(),
            kind: TagKind::Music,
            ..DownloadTags::default()
        };
        assert_eq!(
            tags.source_url().as_deref(),
            Some("https://music.youtube.com/watch?v=abc")
        );
        tags.kind = TagKind::Video;
        assert_eq!(
            tags.source_url().as_deref(),
            Some("https://www.youtube.com/watch?v=abc")
        );
    }

    #[test]
    fn truncation_never_splits_a_surrogate_pair() {
        let text = "ab\u{1F600}c";
        assert_eq!(truncate_utf16(text, 3), "ab");
        assert_eq!(truncate_utf16(text, 4), "ab\u{1F600}");
        assert_eq!(truncate_utf16(text, 10), text);
    }

    #[test]
    fn flow_fields_start_with_identity_and_skip_empties() {
        let tags = DownloadTags {
            kind: TagKind::Music,
            video_id: "id1".into(),
            title: "Song".into(),
            artists: vec!["A".into(), "B".into()],
            track_number: Some(2),
            ..DownloadTags::default()
        };
        let fields = tags.flow_fields();
        assert_eq!(fields[0], ("schema", "1".to_string()));
        assert_eq!(fields[1], ("kind", "MUSIC".to_string()));
        assert!(fields.contains(&("artists", r#"["A","B"]"#.to_string())));
        assert!(fields.contains(&("trackNumber", "2".to_string())));
        assert!(!fields.iter().any(|(key, _)| *key == "album"));
    }
}
