//! Takeout's activity files: `MyActivity.json`, the YouTube product's history JSON, and history
//! HTML. A port of Android's `YouTubeTakeoutActivityParser` and `YouTubeTakeoutHtmlReader`.

use std::collections::HashMap;
use std::io::{BufReader, Read};

use chrono::DateTime;
use serde::Deserialize;
use serde::de::{DeserializeSeed, IgnoredAny, SeqAccess, Visitor};

use super::{MAX_WATCHES, TakenLike, Watch, channel_id_of_url, clean, is_video_id};

/// YouTube keeps at most this many videos in Liked videos, so more only bloats the likes store.
pub const MAX_IMPORTED_LIKES: usize = 5_000;
const MAX_LIKE_DECISIONS: usize = 1_000_000;

// My Activity names the action only in the account's language; no field marks a like. English only,
// by the owner's decision on Android.
const LIKED_PREFIX: &str = "Liked ";
const DISLIKED_PREFIX: &str = "Disliked ";
const WATCHED_PREFIX: &str = "Watched ";
const MUSIC_HEADER: &str = "YouTube Music";
const MUSIC_HOST: &str = "music.youtube.com";

const HTML_MARKUP: &str = "content-cell";
const HTML_WINDOW: usize = 64 * 1024;
const HTML_OVERLAP: usize = 2 * 1024;
const CHANNEL_LINK_REACH: usize = 2_000;

#[derive(Default, Debug, PartialEq)]
pub struct Activity {
    pub likes: Vec<TakenLike>,
    pub total_likes: usize,
    pub watches: Vec<Watch>,
}

#[derive(Deserialize)]
struct Record {
    header: Option<String>,
    title: Option<String>,
    #[serde(rename = "titleUrl")]
    title_url: Option<String>,
    subtitles: Option<Vec<Subtitle>>,
    details: Option<IgnoredAny>,
    time: Option<String>,
}

#[derive(Deserialize)]
struct Subtitle {
    name: Option<String>,
    url: Option<String>,
}

impl Record {
    fn video_id(&self) -> Option<String> {
        let url = self.title_url.as_deref()?;
        let at = url
            .find("v=")
            .filter(|&at| at > 0 && matches!(url.as_bytes()[at - 1], b'?' | b'&'))?;
        let id = url[at + 2..].split(['&', '#']).next()?;
        is_video_id(id).then(|| id.to_string())
    }

    fn is_music(&self) -> bool {
        self.header.as_deref() == Some(MUSIC_HEADER)
            || self
                .title_url
                .as_deref()
                .is_some_and(|url| url.contains(MUSIC_HOST))
    }

    fn channel(&self) -> (String, String) {
        let Some(first) = self.subtitles.as_ref().and_then(|subs| subs.first()) else {
            return (String::new(), String::new());
        };
        let name = first.name.as_deref().map(clean).unwrap_or_default();
        let id = first
            .url
            .as_deref()
            .filter(|url| url.contains("/channel/"))
            .map(channel_id_of_url)
            .filter(|id| super::is_channel_id(id))
            .unwrap_or_default();
        (name, id)
    }
}

struct Collector {
    keep_watches: bool,
    decisions: HashMap<String, (u64, Option<TakenLike>)>,
    watches: Vec<Watch>,
}

impl Collector {
    fn add(&mut self, record: &Record) {
        if record.details.is_some() {
            return;
        }
        let Some(title) = record.title.as_deref() else {
            return;
        };
        let Some(at) = record
            .time
            .as_deref()
            .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
            .and_then(|time| u64::try_from(time.timestamp_millis()).ok())
        else {
            return;
        };
        let is_like = title.starts_with(LIKED_PREFIX);
        if is_like || title.starts_with(DISLIKED_PREFIX) {
            self.add_like_decision(record, title, at, is_like);
        } else if self.keep_watches && self.watches.len() < MAX_WATCHES {
            self.add_watch(record, title, at);
        }
    }

    fn add_like_decision(&mut self, record: &Record, title: &str, at: u64, is_like: bool) {
        let Some(video_id) = record.video_id() else {
            return;
        };
        if let Some((seen, _)) = self.decisions.get(&video_id) {
            if *seen >= at {
                return;
            }
        } else if self.decisions.len() >= MAX_LIKE_DECISIONS {
            return;
        }
        let like = is_like.then(|| {
            let (channel_name, channel_id) = record.channel();
            TakenLike {
                video_id: video_id.clone(),
                title: clean(title.strip_prefix(LIKED_PREFIX).unwrap_or(title)),
                channel_name,
                channel_id,
                liked_at: at,
                is_music: record.is_music(),
            }
        });
        self.decisions.insert(video_id, (at, like));
    }

    fn add_watch(&mut self, record: &Record, title: &str, at: u64) {
        let Some(video_id) = record.video_id() else {
            return;
        };
        let title = clean(title.strip_prefix(WATCHED_PREFIX).unwrap_or(title));
        if title.is_empty() {
            return;
        }
        let (channel_name, channel_id) = record.channel();
        self.watches.push(Watch {
            video_id,
            title,
            channel_name,
            channel_id,
            watched_at: at,
            is_music: record.is_music(),
            ..Watch::default()
        });
    }
}

struct ActivitySeed<'a>(&'a mut Collector);

impl<'de> DeserializeSeed<'de> for ActivitySeed<'_> {
    type Value = ();
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for ActivitySeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a list of activity records")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(record) = seq.next_element::<Record>()? {
            self.0.add(&record);
        }
        Ok(())
    }
}

/// Streams one activity JSON file, record by record. A like counts only when it is the video's
/// latest like or dislike. `None` for JSON that isn't an activity file; it is skipped, not a
/// failed import.
pub fn read_activity_json<R: Read>(reader: R, keep_watches: bool) -> Option<Activity> {
    let mut collector = Collector {
        keep_watches,
        decisions: HashMap::new(),
        watches: Vec::new(),
    };
    let mut json = serde_json::Deserializer::from_reader(BufReader::new(reader));
    ActivitySeed(&mut collector).deserialize(&mut json).ok()?;
    let mut likes: Vec<TakenLike> = collector
        .decisions
        .into_values()
        .filter_map(|(_, like)| like)
        .filter(|like| !like.title.is_empty())
        .collect();
    likes.sort_by_key(|like| std::cmp::Reverse(like.liked_at));
    let total_likes = likes.len();
    likes.truncate(MAX_IMPORTED_LIKES);
    Some(Activity {
        likes,
        total_likes,
        watches: collector.watches,
    })
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
        .replace("&amp;", "&")
}

/// A link found in a window: `https://www.youtube.com/<prefix><value>">text</a>`.
struct Link<'a> {
    start: usize,
    end: usize,
    is_music: bool,
    value: &'a str,
    text: &'a [u8],
}

fn find_from(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| at + from)
}

fn links<'a>(window: &'a [u8], prefix: &str) -> Vec<Link<'a>> {
    let mut found = Vec::new();
    for (host, is_music) in [("www", false), ("music", true)] {
        let needle = format!("href=\"https://{host}.youtube.com/{prefix}");
        let mut from = 0;
        while let Some(start) = find_from(window, needle.as_bytes(), from) {
            from = start + needle.len();
            let Some(quote) = find_from(window, b"\"", from) else {
                break;
            };
            let Some(close) = find_from(window, b">", quote) else {
                break;
            };
            let Some(end) = find_from(window, b"</a>", close) else {
                break;
            };
            let Ok(value) = std::str::from_utf8(&window[from..quote]) else {
                continue;
            };
            found.push(Link {
                start,
                end: end + 4,
                is_music,
                value,
                text: &window[close + 1..end],
            });
        }
    }
    found.sort_by_key(|link| link.start);
    found
}

/// Streams a history HTML file for the videos watched. Takeout's HTML dates are in the account's
/// language, so entries are stamped newest first from `now`, as Takeout lists them: Android's
/// approach, with the same known cost of showing as watched today. With `require_markup`, a file
/// that never shows the activity layout gives nothing, so other HTML in an archive is ignored.
pub fn read_history_html<R: Read>(
    mut reader: R,
    now: u64,
    require_markup: bool,
) -> std::io::Result<Vec<Watch>> {
    let mut markup_seen = !require_markup;
    let mut watches = Vec::new();
    let mut window: Vec<u8> = Vec::with_capacity(HTML_WINDOW + HTML_OVERLAP);
    let mut buffer = vec![0_u8; HTML_WINDOW];
    let mut tail_len = 0;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        window.extend_from_slice(&buffer[..count]);
        if !markup_seen {
            markup_seen = find_from(&window, HTML_MARKUP.as_bytes(), 0).is_some();
        }
        let channels = links(&window, "channel/");
        for link in links(&window, "watch?v=") {
            if link.end <= tail_len || watches.len() >= MAX_WATCHES {
                continue;
            }
            if !is_video_id(link.value) {
                continue;
            }
            let channel = channels
                .iter()
                .find(|channel| channel.start > link.start)
                .filter(|channel| channel.start - link.end < CHANNEL_LINK_REACH);
            let title = clean(&unescape(&String::from_utf8_lossy(link.text)));
            let index = watches.len() as u64;
            watches.push(Watch {
                video_id: link.value.to_string(),
                title,
                channel_name: channel.map_or_else(String::new, |channel| {
                    clean(&unescape(&String::from_utf8_lossy(channel.text)))
                }),
                channel_id: channel.map_or_else(String::new, |channel| clean(channel.value)),
                watched_at: now.saturating_sub(index),
                is_music: link.is_music,
                ..Watch::default()
            });
        }
        let keep_from = window.len().saturating_sub(HTML_OVERLAP);
        window.drain(..keep_from);
        tail_len = window.len();
    }
    if markup_seen {
        Ok(watches)
    } else {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[allow(clippy::needless_pass_by_value)] // Reads best with the record list written in place.
    fn activity(records: serde_json::Value, keep_watches: bool) -> Activity {
        read_activity_json(records.to_string().as_bytes(), keep_watches).unwrap()
    }

    #[test]
    fn the_latest_like_or_dislike_of_a_video_wins() {
        let url = "https://www.youtube.com/watch?v=abcdefghijk";
        let parsed = activity(
            json!([
                { "title": "Disliked Song", "titleUrl": url, "time": "2024-01-02T00:00:00Z" },
                { "title": "Liked Song", "titleUrl": url, "time": "2024-01-01T00:00:00Z" },
                { "title": "Liked Other", "titleUrl": "https://www.youtube.com/watch?v=lmnopqrstuv&t=1",
                  "time": "2024-01-03T00:00:00Z", "header": "YouTube Music",
                  "subtitles": [{ "name": "Band", "url": "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" }] },
            ]),
            false,
        );
        assert_eq!(parsed.likes.len(), 1);
        let like = &parsed.likes[0];
        assert_eq!(like.video_id, "lmnopqrstuv");
        assert_eq!(like.title, "Other");
        assert!(like.is_music);
        assert_eq!(like.channel_name, "Band");
        assert_eq!(like.channel_id, "UCaaaaaaaaaaaaaaaaaaaaaa");
    }

    #[test]
    fn ads_are_skipped_and_watches_kept_when_asked() {
        let url = "https://www.youtube.com/watch?v=abcdefghijk";
        let records = json!([
            { "title": "Watched An ad", "titleUrl": url, "time": "2024-01-01T00:00:00Z",
              "details": [{ "name": "From Google Ads" }] },
            { "title": "Watched A video", "titleUrl": url, "time": "2024-01-02T00:00:00Z" },
            { "title": "Searched for x", "titleUrl": "https://www.youtube.com/results?search_query=x",
              "time": "2024-01-02T00:00:00Z" },
            { "title": "No time", "titleUrl": url },
        ]);
        let parsed = activity(records.clone(), true);
        assert_eq!(parsed.watches.len(), 1);
        assert_eq!(parsed.watches[0].title, "A video");
        assert!(activity(records, false).watches.is_empty());
    }

    #[test]
    fn likes_keep_only_the_newest() {
        let mut records = Vec::new();
        for i in 0..(MAX_IMPORTED_LIKES + 3) {
            records.push(json!({
                "title": format!("Liked {i}"),
                "titleUrl": format!("https://www.youtube.com/watch?v={i:011}"),
                "time": chrono::DateTime::from_timestamp(i64::try_from(i).unwrap(), 0).unwrap().to_rfc3339(),
            }));
        }
        let parsed = activity(json!(records), false);
        assert_eq!(parsed.total_likes, MAX_IMPORTED_LIKES + 3);
        assert_eq!(parsed.likes.len(), MAX_IMPORTED_LIKES);
        assert_eq!(parsed.likes[0].title, (MAX_IMPORTED_LIKES + 2).to_string());
    }

    #[test]
    fn other_json_is_not_an_activity_file() {
        assert!(read_activity_json(&br#"{"not":"a list"}"#[..], true).is_none());
        assert!(read_activity_json(&b"[{\"title\":"[..], true).is_none());
    }

    const HTML: &str = r#"<html><div class="content-cell">Watched
        <a href="https://www.youtube.com/watch?v=abcdefghijk">Tom &amp; Jerry</a><br>
        <a href="https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa">The Channel</a><br>Jan 1, 2024
        </div><div class="content-cell">Watched
        <a href="https://music.youtube.com/watch?v=lmnopqrstuv">A song</a><br>
        <a href="https://www.youtube.com/results?search_query=x">not a video</a></div></html>"#;

    #[test]
    fn html_history_is_stamped_newest_first_from_now() {
        let watches = read_history_html(HTML.as_bytes(), 1000, true).unwrap();
        assert_eq!(watches.len(), 2);
        assert_eq!(watches[0].title, "Tom & Jerry");
        assert_eq!(watches[0].channel_name, "The Channel");
        assert_eq!(watches[0].channel_id, "UCaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(watches[0].watched_at, 1000);
        assert_eq!(watches[1].watched_at, 999);
        assert!(watches[1].is_music);
        assert!(!watches[0].is_music);
    }

    #[test]
    fn other_html_in_an_archive_gives_nothing() {
        let page = r#"<a href="https://www.youtube.com/watch?v=abcdefghijk">Hi</a>"#;
        assert!(
            read_history_html(page.as_bytes(), 1, true)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            read_history_html(page.as_bytes(), 1, false).unwrap().len(),
            1
        );
    }

    #[test]
    fn a_link_across_a_read_boundary_is_counted_once() {
        struct Chunks<'a>(std::vec::IntoIter<&'a [u8]>);
        impl Read for Chunks<'_> {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let Some(chunk) = self.0.next() else {
                    return Ok(0);
                };
                out[..chunk.len()].copy_from_slice(chunk);
                Ok(chunk.len())
            }
        }
        let bytes = HTML.as_bytes();
        let middle = bytes.windows(9).position(|w| w == b"watch?v=a").unwrap() + 4;
        let reader = Chunks(vec![&bytes[..middle], &bytes[middle..]].into_iter());
        let watches = read_history_html(reader, 1000, true).unwrap();
        assert_eq!(watches.len(), 2);
    }
}
