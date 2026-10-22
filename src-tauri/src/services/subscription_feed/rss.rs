//! A channel's uploads feed: the one place it is fetched and parsed. RSS gives
//! exact dates, views and descriptions but no length and no kind, so Shorts are
//! marked elsewhere ([`super::reels`]).

use std::time::Duration;

use reqwest::StatusCode;

use crate::models::video::VideoSummary;

const DEFAULT_RETRY_DELAY: Duration = Duration::from_millis(1_500);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(10);
/// A publish date this far ahead is a scheduled premiere or stream, not clock skew.
const UPCOMING_MARGIN_SECS: i64 = 60;
const SNIPPET_CHARS: usize = 300;
/// Title markers of uploads only members can play. Titles only: the site's stock
/// "join this channel" call to action sits in ordinary descriptions.
const MEMBERS_ONLY_MARKERS: [&str; 6] = [
    "members only",
    "members-only",
    "member only",
    "member-only",
    "membership only",
    "requires membership",
];

fn xml_text(source: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{tag}>");
    let end_tag = format!("</{tag}>");
    let start = source.find(&start_tag)? + start_tag.len();
    let end = source[start..].find(&end_tag)? + start;
    Some(decode_xml_entities(source[start..end].trim()))
}

fn xml_attr(source: &str, tag_prefix: &str, attr: &str) -> Option<String> {
    let tag_start = source.find(tag_prefix)?;
    let tag_end = source[tag_start..].find('>')? + tag_start;
    let tag = &source[tag_start..tag_end];
    let attr_prefix = format!("{attr}=\"");
    let value_start = tag.find(&attr_prefix)? + attr_prefix.len();
    let value_end = tag[value_start..].find('"')? + value_start;
    Some(decode_xml_entities(tag[value_start..value_end].trim()))
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn plural(count: i64, unit: &str) -> String {
    format!("{count} {unit}{} ago", if count == 1 { "" } else { "s" })
}

fn format_relative_published(elapsed: chrono::TimeDelta) -> String {
    let days = elapsed.num_days();
    if days >= 365 {
        plural(days / 365, "year")
    } else if days >= 30 {
        plural(days / 30, "month")
    } else if days >= 7 {
        plural(days / 7, "week")
    } else if days >= 1 {
        plural(days, "day")
    } else if elapsed.num_hours() >= 1 {
        plural(elapsed.num_hours(), "hour")
    } else if elapsed.num_minutes() >= 1 {
        plural(elapsed.num_minutes(), "minute")
    } else {
        "Just now".to_string()
    }
}

fn with_separators(count: u64) -> String {
    let digits = count.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

#[must_use]
pub fn is_members_only_title(title: &str) -> bool {
    let title = title.to_lowercase();
    MEMBERS_ONLY_MARKERS
        .iter()
        .any(|marker| title.contains(marker))
}

/// The feed's channel name and its uploads, each with its publish time in
/// seconds for sorting.
#[must_use]
pub fn parse_rss_feed(channel_id: &str, xml: &str) -> (Option<String>, Vec<(i64, VideoSummary)>) {
    parse_rss_feed_at(channel_id, xml, chrono::Utc::now())
}

fn parse_rss_feed_at(
    channel_id: &str,
    xml: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> (Option<String>, Vec<(i64, VideoSummary)>) {
    let channel_name = xml_text(xml, "name");
    let videos = xml
        .split("<entry>")
        .skip(1)
        .filter_map(|entry| {
            let entry = entry.split("</entry>").next().unwrap_or(entry);
            let video_id = xml_text(entry, "yt:videoId")?;
            let title = xml_text(entry, "title").unwrap_or_else(|| "Untitled video".to_string());
            let published = xml_text(entry, "published")
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
                .map(|date| date.with_timezone(&chrono::Utc));
            let elapsed = published.map(|date| now.signed_duration_since(date));
            let is_upcoming =
                elapsed.is_some_and(|elapsed| elapsed.num_seconds() < -UPCOMING_MARGIN_SECS);
            let view_count = xml_attr(entry, "<media:statistics", "views")
                .and_then(|value| value.parse::<u64>().ok());
            let snippet = xml_text(entry, "media:description")
                .filter(|text| !text.is_empty())
                .map(|text| text.chars().take(SNIPPET_CHARS).collect());

            Some((
                published.map_or(0, |date| date.timestamp()),
                VideoSummary {
                    thumbnail_url: xml_attr(entry, "<media:thumbnail", "url").or_else(|| {
                        Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"))
                    }),
                    duration_seconds: xml_attr(entry, "<media:content", "duration")
                        .and_then(|value| value.parse::<u64>().ok()),
                    published_text: elapsed.filter(|_| !is_upcoming).map(|elapsed| {
                        format_relative_published(elapsed.max(chrono::TimeDelta::zero()))
                    }),
                    // A premiere has no views to speak of, and the feed writes 0.
                    view_count_text: view_count
                        .filter(|_| !is_upcoming)
                        .map(|views| format!("{} views", with_separators(views))),
                    view_count: view_count.filter(|_| !is_upcoming),
                    is_upcoming,
                    upcoming_start_ms: published
                        .filter(|_| is_upcoming)
                        .and_then(|date| u64::try_from(date.timestamp_millis()).ok()),
                    is_members_only: is_members_only_title(&title),
                    snippet,
                    channel_name: channel_name
                        .clone()
                        .unwrap_or_else(|| "Subscribed channel".to_string()),
                    channel_id: Some(channel_id.to_string()),
                    id: video_id,
                    title,
                    ..Default::default()
                },
            ))
        })
        .collect();

    (channel_name, videos)
}

/// How long to wait before the one retry, or `None` when the failure will not
/// pass on its own (a 404, a removed channel).
fn retry_delay(status: Option<StatusCode>, retry_after: Option<&str>) -> Option<Duration> {
    if let Some(status) = status
        && status != StatusCode::TOO_MANY_REQUESTS
        && !status.is_server_error()
    {
        return None;
    }
    Some(
        retry_after
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map_or(DEFAULT_RETRY_DELAY, Duration::from_secs)
            .clamp(DEFAULT_RETRY_DELAY, MAX_RETRY_DELAY),
    )
}

enum Attempt {
    Feed(String),
    Failed {
        reason: String,
        retry_after: Option<Duration>,
    },
}

async fn attempt(client: &reqwest::Client, url: &str) -> Attempt {
    let response = match client.get(url).send().await {
        Ok(response) => response,
        Err(error) => {
            return Attempt::Failed {
                reason: error.to_string(),
                retry_after: retry_delay(None, None),
            };
        }
    };
    let status = response.status();
    if !status.is_success() {
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok());
        return Attempt::Failed {
            reason: format!("HTTP {status}"),
            retry_after: retry_delay(Some(status), retry_after),
        };
    }
    match response.text().await {
        Ok(body) if !body.trim().is_empty() => Attempt::Feed(body),
        Ok(_) => Attempt::Failed {
            reason: "empty body".into(),
            retry_after: None,
        },
        Err(error) => Attempt::Failed {
            reason: error.to_string(),
            retry_after: retry_delay(None, None),
        },
    }
}

/// A channel's feed, retried once after a 429, a 5xx or a dropped connection: a
/// sweep over hundreds of channels meets the odd one, and without the retry
/// that channel's uploads vanish until the next refresh.
pub async fn fetch_rss(client: &reqwest::Client, channel_id: &str) -> Result<String, String> {
    let url = format!("https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}");
    match attempt(client, &url).await {
        Attempt::Feed(body) => Ok(body),
        Attempt::Failed {
            retry_after: Some(delay),
            ..
        } => {
            tokio::time::sleep(delay).await;
            match attempt(client, &url).await {
                Attempt::Feed(body) => Ok(body),
                Attempt::Failed { reason, .. } => Err(reason),
            }
        }
        Attempt::Failed { reason, .. } => Err(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-10-20T12:00:00+00:00";

    fn entry(id: &str, title: &str, published: &str, views: u64) -> String {
        format!(
            "<entry><yt:videoId>{id}</yt:videoId><title>{title}</title><published>{published}</published>\
             <media:group><media:description>About {id}</media:description>\
             <media:community><media:statistics views=\"{views}\"/></media:community></media:group></entry>"
        )
    }

    fn parse(entries: &[String]) -> Vec<VideoSummary> {
        let xml = format!(
            "<feed><author><name>Chan</name></author>{}</feed>",
            entries.join("")
        );
        let now = chrono::DateTime::parse_from_rfc3339(NOW)
            .unwrap()
            .with_timezone(&chrono::Utc);
        parse_rss_feed_at("UCx", &xml, now)
            .1
            .into_iter()
            .map(|(_, video)| video)
            .collect()
    }

    #[test]
    fn an_upload_reads_its_views_description_and_age() {
        let videos = parse(&[entry("a", "Hello", "2026-10-18T12:00:00+00:00", 1_234_567)]);
        assert_eq!(
            videos[0].view_count_text.as_deref(),
            Some("1,234,567 views")
        );
        assert_eq!(videos[0].view_count, Some(1_234_567));
        assert_eq!(videos[0].snippet.as_deref(), Some("About a"));
        assert_eq!(videos[0].published_text.as_deref(), Some("2 days ago"));
        assert!(!videos[0].is_upcoming);
    }

    #[test]
    fn a_future_date_is_upcoming_not_just_now() {
        let videos = parse(&[entry("b", "Premiere", "2026-10-21T18:00:00+00:00", 0)]);
        assert!(videos[0].is_upcoming);
        assert_eq!(videos[0].published_text, None);
        assert_eq!(videos[0].view_count_text, None);
        assert_eq!(videos[0].upcoming_start_ms, Some(1_792_605_600_000));
    }

    #[test]
    fn members_only_is_read_from_the_title_only() {
        let videos = parse(&[
            entry(
                "c",
                "Bonus stream (Members Only)",
                "2026-10-19T12:00:00+00:00",
                5,
            ),
            entry(
                "d",
                "Join this channel to get perks",
                "2026-10-19T12:00:00+00:00",
                5,
            ),
        ]);
        assert!(videos[0].is_members_only);
        assert!(!videos[1].is_members_only);
    }

    #[test]
    fn a_real_feed_has_its_views_and_descriptions() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/innertube/rss_ltt.xml");
        let Ok(xml) = std::fs::read_to_string(&path) else {
            eprintln!("skipped: {} is missing", path.display());
            return;
        };
        let (name, videos) = parse_rss_feed("UCXuqSBlHAE6Xw-yeJA0Tunw", &xml);
        assert_eq!(name.as_deref(), Some("Linus Tech Tips"));
        assert_eq!(videos.len(), 15);
        assert!(
            videos
                .iter()
                .all(|(seconds, video)| *seconds > 0 && video.view_count.is_some())
        );
        assert!(
            videos
                .iter()
                .filter(|(_, video)| video.snippet.is_some())
                .count()
                >= 10
        );
    }

    #[test]
    fn only_rate_limits_server_errors_and_dropped_connections_are_retried() {
        assert_eq!(retry_delay(Some(StatusCode::NOT_FOUND), None), None);
        assert_eq!(
            retry_delay(Some(StatusCode::TOO_MANY_REQUESTS), Some("4")),
            Some(Duration::from_secs(4))
        );
        assert_eq!(
            retry_delay(Some(StatusCode::BAD_GATEWAY), Some("120")),
            Some(MAX_RETRY_DELAY)
        );
        assert_eq!(retry_delay(None, None), Some(DEFAULT_RETRY_DELAY));
    }
}
