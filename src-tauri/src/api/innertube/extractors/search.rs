use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    detect_video_is_live, extract_channel_id_from_video_renderer, extract_continuation_token,
    normalize_youtube_image_url, parse_duration_seconds,
};
use crate::api::http::shared_client;
use crate::api::innertube::parsers::parse_music_search_json;
use crate::errors::{AppError, AppResult};
use crate::models::search::{SearchVideosRequest, SearchVideosResponse};
use crate::models::video::VideoSummary;
use base64::Engine;
use serde_json::Value;

fn custom_url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char);
            }
            b' ' => {
                encoded.push('+');
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

fn put_varint(buf: &mut Vec<u8>, mut v: u64) {
    loop {
        let mut byte = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if v == 0 {
            break;
        }
    }
}

fn put_varint_field(buf: &mut Vec<u8>, field: u64, value: u64) {
    put_varint(buf, field << 3);
    put_varint(buf, value);
}

fn build_search_params(
    sort_by: Option<&str>,
    upload_date: Option<&str>,
    duration: Option<&str>,
    feature: Option<&str>,
) -> Option<String> {
    let sort = match sort_by.map(str::trim) {
        Some("rating") => Some(1u64),
        Some("date") | Some("upload_date") => Some(2u64),
        Some("views") | Some("view_count") => Some(3u64),
        _ => None, // relevance / unset
    };

    let upload = match upload_date.map(str::trim) {
        Some("hour") => Some(1u64),
        Some("today") => Some(2u64),
        Some("week") => Some(3u64),
        Some("month") => Some(4u64),
        Some("year") => Some(5u64),
        _ => None,
    };

    let dur = match duration.map(str::trim) {
        Some("short") => Some(1u64),
        Some("long") => Some(2u64),
        Some("medium") => Some(3u64),
        _ => None,
    };

    let feature_field = match feature.map(str::trim) {
        Some("live") => Some(8u64),
        Some("hd") => Some(4u64),
        Some("subtitles") | Some("cc") => Some(5u64),
        Some("creative_commons") => Some(6u64),
        Some("4k") => Some(14u64),
        Some("360") => Some(15u64),
        Some("location") => Some(23u64),
        Some("hdr") => Some(25u64),
        Some("vr180") => Some(26u64),
        _ => None,
    };

    let mut filters = Vec::new();
    if let Some(u) = upload {
        put_varint_field(&mut filters, 1, u);
    }
    if let Some(d) = dur {
        put_varint_field(&mut filters, 3, d);
    }
    if let Some(f) = feature_field {
        put_varint_field(&mut filters, f, 1);
    }

    if sort.is_none() && filters.is_empty() {
        return None;
    }

    let mut buf = Vec::new();
    if let Some(s) = sort {
        put_varint_field(&mut buf, 1, s);
    }
    if !filters.is_empty() {
        put_varint(&mut buf, (2 << 3) | 2); // field 2, wire type 2 (length-delimited)
        put_varint(&mut buf, filters.len() as u64);
        buf.extend_from_slice(&filters);
    }

    let b64 = base64::engine::general_purpose::URL_SAFE.encode(&buf);
    Some(custom_url_encode(&b64))
}

fn process_search_items(
    items_arr: &[Value],
    items: &mut Vec<VideoSummary>,
    next_page_token: &mut Option<String>,
) {
    for item in items_arr {
        {
            if let Some(inner) = item["itemSectionRenderer"]["contents"].as_array() {
                process_search_items(inner, items, next_page_token);
                continue;
            }
            if let Some(video) = item.get("videoRenderer") {
                let video_id = video["videoId"].as_str().unwrap_or_default().to_string();
                if video_id.is_empty() {
                    continue;
                }

                let title = video["title"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| video["title"]["simpleText"].as_str())
                    .unwrap_or_default()
                    .to_string();

                let channel_name = video["longBylineText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| video["ownerText"]["runs"][0]["text"].as_str())
                    .or_else(|| video["shortBylineText"]["runs"][0]["text"].as_str())
                    .or_else(|| video["longBylineText"]["simpleText"].as_str())
                    .unwrap_or_default()
                    .to_string();

                let thumbnail_url = video["thumbnail"]["thumbnails"][0]["url"]
                    .as_str()
                    .or_else(|| video["thumbnail"]["url"].as_str())
                    .map(|s| s.to_string());

                let duration_text = video["lengthText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| video["lengthText"]["simpleText"].as_str())
                    .unwrap_or_default();

                let duration_seconds = if duration_text.is_empty() {
                    None
                } else {
                    Some(parse_duration_seconds(duration_text))
                };

                let published_text = video["publishedTimeText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| video["publishedTimeText"]["simpleText"].as_str())
                    .map(|s| s.to_string());

                let view_count_text = video["viewCountText"]["runs"][0]["text"]
                    .as_str()
                    .or_else(|| video["viewCountText"]["simpleText"].as_str())
                    .or_else(|| video["shortViewCountText"]["runs"][0]["text"].as_str())
                    .or_else(|| video["shortViewCountText"]["simpleText"].as_str())
                    .map(|s| s.to_string());

                let channel_id = extract_channel_id_from_video_renderer(video);

                let channel_avatar_url =
                    video["channelThumbnailSupportedRenderers"]["channelThumbnailWithLinkRenderer"]
                        ["thumbnail"]["thumbnails"]
                        .as_array()
                        .and_then(|arr| arr.first())
                        .and_then(|t| t["url"].as_str())
                        .map(normalize_youtube_image_url);

                items.push(VideoSummary {
                    id: video_id,
                    title,
                    channel_name,
                    channel_id,
                    thumbnail_url,
                    duration_seconds,
                    published_text,
                    view_count_text,
                    channel_avatar_url,
                    is_live: detect_video_is_live(video),
                });
            } else if let Some(channel) = item.get("channelRenderer") {
                let channel_id = channel["channelId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                if !channel_id.is_empty() {
                    let title = channel["title"]["simpleText"]
                        .as_str()
                        .or_else(|| channel["title"]["runs"][0]["text"].as_str())
                        .unwrap_or_default()
                        .to_string();

                    let thumbnail_url = channel["thumbnail"]["thumbnails"][0]["url"]
                        .as_str()
                        .map(|s| s.to_string());

                    let subscriber_count_text = channel["subscriberCountText"]["simpleText"]
                        .as_str()
                        .or_else(|| channel["subscriberCountText"]["runs"][0]["text"].as_str())
                        .map(|s| s.to_string());

                    items.push(VideoSummary {
                        id: format!("channel:{}", channel_id),
                        title,
                        channel_name: "Channel".to_string(),
                        channel_id: Some(channel_id),
                        thumbnail_url: thumbnail_url.clone(),
                        duration_seconds: None,
                        published_text: subscriber_count_text,
                        view_count_text: Some("Channel".to_string()),
                        channel_avatar_url: thumbnail_url,
                        is_live: false,
                    });
                }
            } else if next_page_token.is_none() {
                *next_page_token = extract_continuation_token(item);
            }
        }
    }
}

fn parse_innertube_search(val: Value) -> (Vec<VideoSummary>, Option<String>) {
    let mut items = Vec::new();
    let mut next_page_token = None;

    if let Some(contents_arr) = val["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]
        ["sectionListRenderer"]["contents"]
        .as_array()
    {
        for section in contents_arr {
            if let Some(items_arr) = section["itemSectionRenderer"]["contents"].as_array() {
                process_search_items(items_arr, &mut items, &mut next_page_token);
            }
            if next_page_token.is_none() {
                next_page_token = extract_continuation_token(section);
            }
        }
    }

    if let Some(commands) = val["onResponseReceivedCommands"].as_array() {
        for command in commands {
            if let Some(items_arr) =
                command["appendContinuationItemsAction"]["continuationItems"].as_array()
            {
                process_search_items(items_arr, &mut items, &mut next_page_token);
            } else if let Some(items_arr) =
                command["reloadContinuationItemsCommand"]["continuationItems"].as_array()
            {
                process_search_items(items_arr, &mut items, &mut next_page_token);
            }
        }
    }

    if let Some(actions) = val["onResponseReceivedActions"].as_array() {
        for action in actions {
            if let Some(items_arr) =
                action["appendContinuationItemsAction"]["continuationItems"].as_array()
            {
                process_search_items(items_arr, &mut items, &mut next_page_token);
            } else if let Some(items_arr) =
                action["reloadContinuationItemsCommand"]["continuationItems"].as_array()
            {
                process_search_items(items_arr, &mut items, &mut next_page_token);
            }
        }
    }

    (items, next_page_token)
}

impl InnertubeClient {
    pub async fn search_videos(
        &self,
        request: SearchVideosRequest,
    ) -> AppResult<SearchVideosResponse> {
        let query = request.query.trim();
        if request.page_token.is_none() && query.is_empty() {
            return Err(AppError::Validation("Search query cannot be empty".into()));
        }

        let mut payload = if let Some(page_token) = request.page_token.as_deref() {
            serde_json::json!({
                "continuation": page_token
            })
        } else {
            let mut payload = serde_json::json!({
                "query": query
            });
            if let Some(params) = build_search_params(
                request.sort_by.as_deref(),
                request.upload_date.as_deref(),
                request.duration.as_deref(),
                request.feature.as_deref(),
            ) {
                payload["params"] = Value::String(params);
            }
            payload
        };

        let res = self
            .post_innertube("search", &clients::WEB, &mut payload)
            .await?;
        let (items, next_page_token) = parse_innertube_search(res);

        Ok(SearchVideosResponse {
            items,
            next_page_token,
            source: "innertube".to_string(),
        })
    }

    pub async fn get_search_suggestions(&self, query: &str) -> AppResult<Vec<String>> {
        let encoded_query = custom_url_encode(query);
        // `oe=utf-8` is load-bearing: without it this endpoint answers in
        // ISO-8859-1, and every suggestion carrying an accent, a curly quote or
        // any non-Latin script comes back as mojibake.
        let url = format!(
            "https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&xhr=t&ie=utf-8&oe=utf-8&q={}",
            encoded_query
        );

        let res = shared_client()
            .get(&url)
            .header("Origin", "https://www.youtube.com")
            .header("Referer", "https://www.youtube.com")
            .send()
            .await
            .map_err(|e| AppError::Extractor(format!("Network error suggestions: {}", e)))?;

        // Decoded through `text()` rather than `json()` on purpose: it honours the
        // charset the response declares, so a legacy encoding still decodes instead
        // of failing the whole request on bytes that are not valid UTF-8.
        let body = res
            .text()
            .await
            .map_err(|e| AppError::Extractor(format!("Read error suggestions: {}", e)))?;

        let val: Value = serde_json::from_str(&body)
            .map_err(|e| AppError::Extractor(format!("JSON error suggestions: {}", e)))?;

        let mut suggestions: Vec<String> = Vec::new();
        if let Some(arr) = val.get(1).and_then(|v| v.as_array()) {
            for item in arr {
                let Some(text) = item.get(0).and_then(|s| s.as_str()) else {
                    continue;
                };
                let cleaned = text.trim();
                // The endpoint repeats entries that differ only by casing or spacing.
                if cleaned.is_empty()
                    || suggestions.iter().any(|existing| existing.eq_ignore_ascii_case(cleaned))
                {
                    continue;
                }
                suggestions.push(cleaned.to_string());
            }
        }
        Ok(suggestions)
    }

    pub async fn search_music(&self, query: &str, filter: &str) -> AppResult<Vec<VideoSummary>> {
        let params = match filter {
            "songs" => Some("Eg-KAQwIARAAGAAgACgAMABqChAEEAUQAxAKEAk%3D"),
            "videos" => Some("Eg-KAQwIABABGAAgACgAMABqChAEEAUQAxAKEAk%3D"),
            "albums" => Some("Eg-KAQwIABAAGAEgACgAMABqChAEEAUQAxAKEAk%3D"),
            "playlists" => Some("Eg-KAQwIABAAGAAgACgBMABqChAEEAUQAxAKEAk%3D"),
            "artists" => Some("Eg-KAQwIABAAGAAgASgAMABqChAEEAUQAxAKEAk%3D"),
            _ => None,
        };

        let mut payload = serde_json::json!({
            "query": query,
        });
        if let Some(p) = params {
            payload["params"] = serde_json::Value::String(p.to_string());
        }

        let res = self
            .post_innertube("search", &clients::WEB_REMIX, &mut payload)
            .await?;
        let items = parse_music_search_json(&res);

        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::{build_search_params, parse_innertube_search};

    #[test]
    fn continuation_unwraps_item_section_renderer() {
        let val = serde_json::json!({
            "onResponseReceivedCommands": [{
                "appendContinuationItemsAction": {
                    "continuationItems": [
                        { "itemSectionRenderer": { "contents": [
                            { "videoRenderer": { "videoId": "abc12345678",
                                "title": { "runs": [{ "text": "Title" }] } } }
                        ]}},
                        { "continuationItemRenderer": { "continuationEndpoint": {
                            "continuationCommand": { "token": "NEXT_TOKEN" } } } }
                    ]
                }
            }]
        });
        let (items, token) = parse_innertube_search(val);
        assert_eq!(
            items.len(),
            1,
            "video inside itemSectionRenderer must be parsed"
        );
        assert_eq!(items[0].id, "abc12345678");
        assert_eq!(token.as_deref(), Some("NEXT_TOKEN"));
    }

    #[test]
    fn first_page_extracts_sibling_continuation() {
        let val = serde_json::json!({
            "contents": { "twoColumnSearchResultsRenderer": { "primaryContents": {
                "sectionListRenderer": { "contents": [
                    { "itemSectionRenderer": { "contents": [
                        { "videoRenderer": { "videoId": "vid00000001",
                            "title": { "runs": [{ "text": "X" }] } } }
                    ]}},
                    { "continuationItemRenderer": { "continuationEndpoint": {
                        "continuationCommand": { "token": "PAGE2" } } } }
                ]}
            }}}
        });
        let (items, token) = parse_innertube_search(val);
        assert_eq!(items.len(), 1);
        assert_eq!(token.as_deref(), Some("PAGE2"));
    }

    #[test]
    fn no_filters_returns_none() {
        assert_eq!(build_search_params(None, None, None, None), None);
        // "relevance"/"any" are the defaults and must also produce a bare query.
        assert_eq!(
            build_search_params(Some("relevance"), Some("any"), Some("any"), None),
            None
        );
    }

    // The expected strings below are YouTube's own documented filter params
    // (URL-safe base64 + percent-encoded `=`), so these tests double as a spec.
    #[test]
    fn duration_short_matches_youtube() {
        assert_eq!(
            build_search_params(None, None, Some("short"), None).as_deref(),
            Some("EgIYAQ%3D%3D")
        );
    }

    #[test]
    fn upload_today_matches_youtube() {
        assert_eq!(
            build_search_params(None, Some("today"), None, None).as_deref(),
            Some("EgIIAg%3D%3D")
        );
    }

    #[test]
    fn sort_by_date_matches_youtube() {
        assert_eq!(
            build_search_params(Some("date"), None, None, None).as_deref(),
            Some("CAI%3D")
        );
    }

    #[test]
    fn feature_live_matches_youtube() {
        assert_eq!(
            build_search_params(None, None, None, Some("live")).as_deref(),
            Some("EgJAAQ%3D%3D")
        );
    }

    #[test]
    fn combined_sort_and_filters() {
        // sort=view count, upload=this month, duration=long.
        assert_eq!(
            build_search_params(Some("views"), Some("month"), Some("long"), None).as_deref(),
            Some("CAMSBAgEGAI%3D")
        );
    }
}
