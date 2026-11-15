//! Takeout's activity files: `MyActivity.json`, the YouTube product's history JSON, and history
//! HTML. A port of Android's `YouTubeTakeoutActivityParser` and `YouTubeTakeoutHtmlReader`.

use std::collections::{HashMap, HashSet};
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

// Every Takeout activity entry sits in this cell, whatever language the archive is in.
const HTML_MARKUP: &str = "content-cell";
const HTML_ENTRY_START: &[u8] = b"<div class=\"outer-cell";
const HTML_CAPTION: &[u8] = b"mdl-typography--caption\">";
const HTML_READ: usize = 64 * 1024;
// HTML without Takeout's entry layout is read in spans of about this size, cut after a closing tag.
const HTML_MAX_SPAN: usize = 256 * 1024;
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

/// The videos a history file lists as watched, and those it lists only as ads.
#[derive(Default, Debug, PartialEq)]
pub struct TakeoutHistory {
    pub watches: Vec<Watch>,
    pub ad_video_ids: HashSet<String>,
}

fn rfind(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

/// An ad's caption has a Details block next to Products, and neither holds a link. The labels are
/// in the account's language, so the blocks are counted, not read: every other block, such as
/// "Why is this here?", links to the activity controls.
fn is_takeout_ad(entry: &[u8]) -> bool {
    let Some(start) = find_from(entry, HTML_CAPTION, 0).map(|at| at + HTML_CAPTION.len()) else {
        return false;
    };
    let Some(end) = find_from(entry, b"</div>", start) else {
        return false;
    };
    String::from_utf8_lossy(&entry[start..end])
        .split("<b>")
        .skip(1)
        .filter(|block| !block.contains("<a "))
        .count()
        >= 2
}

struct HtmlReader {
    now: u64,
    history: TakeoutHistory,
}

impl HtmlReader {
    /// One entry, or a span of HTML without Takeout's entry layout.
    fn read_span(&mut self, span: &[u8]) {
        let watched: Vec<Link> = links(span, "watch?v=")
            .into_iter()
            .filter(|link| is_video_id(link.value))
            .collect();
        if watched.is_empty() {
            return;
        }
        if is_takeout_ad(span) {
            self.history
                .ad_video_ids
                .extend(watched.iter().map(|link| link.value.to_string()));
            return;
        }
        let channels = links(span, "channel/");
        for (index, link) in watched.iter().enumerate() {
            if self.history.watches.len() >= MAX_WATCHES {
                return;
            }
            let next = watched.get(index + 1).map_or(span.len(), |next| next.start);
            let channel = channels.iter().find(|channel| {
                channel.start >= link.end
                    && channel.start < next
                    && channel.start - link.end < CHANNEL_LINK_REACH
            });
            let index = self.history.watches.len() as u64;
            self.history.watches.push(Watch {
                video_id: link.value.to_string(),
                title: clean(&unescape(&String::from_utf8_lossy(link.text))),
                channel_name: channel.map_or_else(String::new, |channel| {
                    clean(&unescape(&String::from_utf8_lossy(channel.text)))
                }),
                channel_id: channel.map_or_else(String::new, |channel| clean(channel.value)),
                watched_at: self.now.saturating_sub(index),
                is_music: link.is_music,
                ..Watch::default()
            });
        }
    }

    /// Reads every entry `pending` holds in full, and keeps the last one, which may go on in the
    /// next read.
    fn read_complete_spans(&mut self, pending: &mut Vec<u8>) {
        let Some(mut start) = find_from(pending, HTML_ENTRY_START, 0) else {
            if pending.len() >= HTML_MAX_SPAN {
                let cut = rfind(pending, b"</div>")
                    .filter(|&at| at > 0)
                    .map_or(pending.len(), |at| at + b"</div>".len());
                self.read_span(&pending[..cut]);
                pending.drain(..cut);
            }
            return;
        };
        if start > 0 {
            self.read_span(&pending[..start]);
        }
        while let Some(next) = find_from(pending, HTML_ENTRY_START, start + HTML_ENTRY_START.len())
        {
            self.read_span(&pending[start..next]);
            start = next;
        }
        pending.drain(..start);
        if pending.len() >= HTML_MAX_SPAN {
            self.read_span(pending);
            pending.clear();
        }
    }
}

/// Streams a history HTML file for the videos watched. Takeout's HTML dates are in the account's
/// language, so entries are stamped newest first from `now`, as Takeout lists them: Android's
/// approach, with the same known cost of showing as watched today. With `require_markup`, a file
/// that never shows the activity layout gives nothing, so other HTML in an archive is ignored.
///
/// Each entry is read whole, so a video's channel is never taken from the next entry and ads can
/// be told apart: Takeout gives an ad a Details block ("From Google Ads"), and its video is
/// reported among the ads instead of the watches.
pub fn read_history_html<R: Read>(
    mut reader: R,
    now: u64,
    require_markup: bool,
) -> std::io::Result<TakeoutHistory> {
    let mut markup_seen = !require_markup;
    let mut html = HtmlReader {
        now,
        history: TakeoutHistory::default(),
    };
    let mut pending: Vec<u8> = Vec::with_capacity(2 * HTML_READ);
    let mut buffer = vec![0_u8; HTML_READ];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..count]);
        if !markup_seen {
            markup_seen = find_from(&pending, HTML_MARKUP.as_bytes(), 0).is_some();
        }
        html.read_complete_spans(&mut pending);
    }
    if !pending.is_empty() {
        html.read_span(&pending);
    }
    Ok(if markup_seen {
        html.history
    } else {
        TakeoutHistory::default()
    })
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
        let watches = read_history_html(HTML.as_bytes(), 1000, true)
            .unwrap()
            .watches;
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
        assert_eq!(
            read_history_html(page.as_bytes(), 1, true).unwrap(),
            TakeoutHistory::default()
        );
        assert_eq!(
            read_history_html(page.as_bytes(), 1, false)
                .unwrap()
                .watches
                .len(),
            1
        );
    }

    const WHY: &str = "<b>Why is this here?</b><br>&emsp;This activity was saved to your Google Account.&nbsp;<a href=\"https://myaccount.google.com/activitycontrols\">here</a>.";

    /// One entry as Takeout lays it out; `details` is the block only ads carry, in any language.
    fn entry(
        video_id: &str,
        title: &str,
        channel: Option<(&str, &str)>,
        details: Option<&str>,
        products: &str,
        why: &str,
    ) -> String {
        let channel_link = channel.map_or_else(String::new, |(id, name)| {
            format!(r#"<a href="https://www.youtube.com/channel/{id}">{name}</a><br>"#)
        });
        let details_block = details.map_or_else(String::new, |label| {
            format!("<b>{label}</b><br>&emsp;From Google Ads<br>")
        });
        format!(
            r#"<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched <a href="https://www.youtube.com/watch?v={video_id}">{title}</a><br>{channel_link}Oct 4, 2026, 10:56:07 PM EEST<br></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>{products}</b><br>&emsp;YouTube<br>{details_block}{why}</div></div></div>"#
        )
    }

    fn watched(video_id: &str, title: &str, channel: Option<(&str, &str)>) -> String {
        entry(video_id, title, channel, None, "Products:", WHY)
    }

    fn ad(video_id: &str, title: &str) -> String {
        entry(video_id, title, None, Some("Details:"), "Products:", WHY)
    }

    fn page(entries: &[String]) -> String {
        format!(
            r#"<html><head><style>.outer-cell{{}}</style></head><body><div class="mdl-grid">{}</div></body></html>"#,
            entries.concat()
        )
    }

    const CHANNEL_A: &str = "UCaaaaaaaaaaaaaaaaaaaaaa";
    const CHANNEL_B: &str = "UCbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn html_ads_are_left_out_and_reported_in_any_language() {
        let german_ad = entry(
            "ccccccccccc",
            "Werbung",
            None,
            Some("Einzelheiten:"),
            "Produkte:",
            &WHY.replace("Why is this here?", "Warum wird das angezeigt?"),
        );
        let html = page(&[
            watched("aaaaaaaaaaa", "Real one", Some((CHANNEL_A, "Chan"))),
            ad("bbbbbbbbbbb", "Pizza 50%"),
            german_ad,
            watched("ddddddddddd", "Real two", Some((CHANNEL_B, "Other"))),
        ]);
        let history = read_history_html(html.as_bytes(), 1000, true).unwrap();

        let ids: Vec<&str> = history
            .watches
            .iter()
            .map(|w| w.video_id.as_str())
            .collect();
        assert_eq!(ids, ["aaaaaaaaaaa", "ddddddddddd"]);
        let stamps: Vec<u64> = history.watches.iter().map(|w| w.watched_at).collect();
        assert_eq!(stamps, [1000, 999]);
        let mut ads: Vec<&str> = history.ad_video_ids.iter().map(String::as_str).collect();
        ads.sort_unstable();
        assert_eq!(ads, ["bbbbbbbbbbb", "ccccccccccc"]);
    }

    #[test]
    fn an_html_entry_with_no_channel_never_takes_the_next_entrys() {
        let html = page(&[
            watched("aaaaaaaaaaa", "Removed video", None),
            watched("bbbbbbbbbbb", "Next", Some((CHANNEL_B, "Other"))),
        ]);
        let history = read_history_html(html.as_bytes(), 1000, true).unwrap();

        let channels: Vec<&str> = history
            .watches
            .iter()
            .map(|w| w.channel_id.as_str())
            .collect();
        assert_eq!(channels, ["", CHANNEL_B]);
    }

    #[test]
    fn html_entries_split_across_reads_are_read_whole() {
        let entries: Vec<String> = (0..400)
            .map(|i| {
                let id = format!("v{i:010}");
                if i % 10 == 3 {
                    ad(&id, &format!("Ad {i}"))
                } else {
                    let channel = format!("UC{i:022}");
                    watched(&id, &format!("Video {i}"), Some((&channel, "Channel")))
                }
            })
            .collect();
        let html = page(&entries);
        assert!(html.len() > 3 * HTML_READ);

        let history = read_history_html(html.as_bytes(), 1000, true).unwrap();

        assert_eq!(history.ad_video_ids.len(), 40);
        assert_eq!(history.watches.len(), 360);
        assert!(history.watches.iter().all(|watch| {
            let i: usize = watch.title.trim_start_matches("Video ").parse().unwrap();
            watch.channel_id == format!("UC{i:022}")
        }));
        let stamps: Vec<u64> = history.watches.iter().map(|w| w.watched_at).collect();
        assert_eq!(stamps, (0..360).map(|i| 1000 - i).collect::<Vec<u64>>());
    }

    #[test]
    fn a_caption_is_an_ad_only_with_a_second_block_that_has_no_link() {
        let id = "aaaaaaaaaaa";
        assert!(!is_takeout_ad(watched(id, "x", None).as_bytes()));
        assert!(!is_takeout_ad(
            entry(id, "x", None, None, "Products:", "").as_bytes()
        ));
        assert!(is_takeout_ad(ad(id, "x").as_bytes()));
        assert!(is_takeout_ad(
            entry(id, "x", None, Some("Details:"), "Products:", "").as_bytes()
        ));
        assert!(!is_takeout_ad(
            br#"<div class="content-cell">Watched</div>"#
        ));
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
        let watches = read_history_html(reader, 1000, true).unwrap().watches;
        assert_eq!(watches.len(), 2);
    }
}
