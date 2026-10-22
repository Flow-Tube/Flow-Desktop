//! Image URLs: picking the largest of a set, and asking the image CDNs for a
//! size that looks sharp on a large screen.

use serde_json::Value;

fn area(thumbnail: &Value) -> u64 {
    let width = thumbnail["width"].as_u64().unwrap_or(0);
    let height = thumbnail["height"].as_u64().unwrap_or(0);
    width.saturating_mul(height)
}

/// The largest image of a `thumbnails` or `sources` array, as sent apart from
/// a protocol-relative `//` prefix. Without sizes the last entry wins, which is
/// where the largest goes.
#[must_use]
pub fn largest_url(thumbnails: &Value) -> Option<String> {
    let url = thumbnails
        .as_array()?
        .iter()
        .max_by_key(|thumbnail| area(thumbnail))
        .and_then(|thumbnail| {
            thumbnail["url"]
                .as_str()
                .or_else(|| thumbnail["uri"].as_str())
        })?;
    Some(
        url.strip_prefix("//")
            .map_or_else(|| url.to_string(), |rest| format!("https://{rest}")),
    )
}

/// [`largest_url`], upgraded with [`normalize_youtube_image_url`].
#[must_use]
pub fn thumbnail_url_from_array(value: &Value) -> Option<String> {
    largest_url(value).map(|url| normalize_youtube_image_url(&url))
}

pub fn youtube_video_thumbnail_url(video_id: &str, quality: &str) -> String {
    format!("https://i.ytimg.com/vi/{video_id}/{quality}.jpg")
}

pub fn best_video_thumbnail_url(video_id: &str, thumbnails: Option<&Value>) -> Option<String> {
    thumbnails
        .and_then(thumbnail_url_from_array)
        .or_else(|| Some(youtube_video_thumbnail_url(video_id, "hq720")))
}

fn upgrade_youtube_thumbnail_url(url: String) -> String {
    let (base, query) = url
        .split_once('?')
        .map_or((url.as_str(), ""), |(base, query)| (base, query));

    if base.ends_with("maxresdefault.jpg")
        || base.ends_with("maxresdefault.webp")
        || base.ends_with("hq720.jpg")
        || base.ends_with("hq720.webp")
    {
        return url;
    }

    for suffix in [
        "mqdefault.jpg",
        "hqdefault.jpg",
        "sddefault.jpg",
        "default.jpg",
        "mqdefault.webp",
        "hqdefault.webp",
        "sddefault.webp",
        "default.webp",
    ] {
        if let Some(prefix) = base.strip_suffix(suffix) {
            return if query.is_empty() {
                format!("{prefix}hq720.jpg")
            } else {
                format!("{prefix}hq720.jpg?{query}")
            };
        }
    }

    url
}

pub fn normalize_youtube_image_url(url: &str) -> String {
    let mut normalized = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    };

    if normalized.contains("i.ytimg.com") || normalized.contains("img.youtube.com") {
        normalized = upgrade_youtube_thumbnail_url(normalized);
    } else if normalized.contains("googleusercontent.com") || normalized.contains("ggpht.com") {
        let is_yt3_avatar = normalized.contains("://yt3.")
            || normalized.contains("//yt3.")
            || normalized.contains("yt3.googleusercontent.com")
            || normalized.contains("yt3.ggpht.com");
        if let Some(eq_pos) = normalized.find('=') {
            let base = &normalized[..eq_pos];
            normalized = if is_yt3_avatar {
                format!("{base}=s512")
            } else {
                format!("{base}=w1080-h1080-p-l90-rj")
            };
        } else {
            normalized.push_str(if is_yt3_avatar {
                "=s512"
            } else {
                "=w1080-h1080-p-l90-rj"
            });
        }
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn largest_by_area_or_last() {
        let sized = json!([
            { "url": "https://i.ytimg.com/vi/a/hq720.jpg?big", "width": 720, "height": 404 },
            { "url": "https://i.ytimg.com/vi/a/hq720.jpg?small", "width": 360, "height": 202 }
        ]);
        assert_eq!(
            largest_url(&sized).as_deref(),
            Some("https://i.ytimg.com/vi/a/hq720.jpg?big")
        );
        let unsized_list =
            json!([{ "url": "//yt3.ggpht.com/a=s88" }, { "url": "//yt3.ggpht.com/a=s176" }]);
        assert_eq!(
            largest_url(&unsized_list).as_deref(),
            Some("https://yt3.ggpht.com/a=s176")
        );
        assert_eq!(largest_url(&json!([])), None);
    }

    #[test]
    fn video_thumbnails_are_upgraded_and_avatars_resized() {
        assert_eq!(
            normalize_youtube_image_url("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
            "https://i.ytimg.com/vi/abc/hq720.jpg"
        );
        assert_eq!(
            normalize_youtube_image_url("//yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj"),
            "https://yt3.ggpht.com/abc=s512"
        );
    }
}
