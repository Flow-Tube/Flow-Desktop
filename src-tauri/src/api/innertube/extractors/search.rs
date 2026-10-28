use crate::api::http::shared_client;
use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::short_video_summary_from_item;
use crate::api::innertube::json::continuation::continuation_token;
use crate::api::innertube::json::text::text_of;
use crate::api::innertube::json::thumbnail::{largest_url, normalize_youtube_image_url};
use crate::api::innertube::renderers::lockup::{lockup_item, related_to_video};
use crate::api::innertube::renderers::video::video_from_renderer;
use crate::errors::{AppError, AppResult};
use crate::models::channel::PlaylistSummary;
use crate::models::search::{
    SearchChannel, SearchCorrection, SearchShelf, SearchSuggestion, SearchVideosRequest,
    SearchVideosResponse, SuggestionEntity,
};
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

fn put_message_field(buf: &mut Vec<u8>, field: u64, message: &[u8]) {
    put_varint(buf, (field << 3) | 2);
    put_varint(buf, message.len() as u64);
    buf.extend_from_slice(message);
}

/// The boolean field each feature filter sets.
fn feature_field(feature: &str) -> Option<u64> {
    Some(match feature.trim() {
        "hd" => 4,
        "subtitles" | "cc" => 5,
        "creative_commons" => 6,
        "3d" => 7,
        "live" => 8,
        "4k" => 14,
        "360" => 15,
        "location" => 23,
        "hdr" => 25,
        "vr180" => 26,
        _ => return None,
    })
}

/// The `params` token search filters with. The field numbers and values are the
/// ones the site's own filter dialog ships (decoded by Flow for Android), so any
/// combination encodes the way a single filter does. None for an unfiltered
/// relevance search.
fn build_search_params(request: &SearchVideosRequest) -> Option<String> {
    // Only relevance and view count reorder anything; recency is an upload-date filter.
    let sort = matches!(
        request.sort_by.as_deref().map(str::trim),
        Some("views" | "view_count")
    )
    .then_some(3u64);
    let upload = match request.upload_date.as_deref().map(str::trim) {
        Some("hour") => Some(1u64),
        Some("today") => Some(2),
        Some("week") => Some(3),
        Some("month") => Some(4),
        Some("year") => Some(5),
        _ => None,
    };
    let content_type = match request.content_type.as_deref().map(str::trim) {
        Some("video") => Some(1u64),
        Some("channel") => Some(2),
        Some("playlist") => Some(3),
        Some("movie") => Some(4),
        Some("shorts") => Some(9),
        _ => None,
    };
    let duration = match request.duration.as_deref().map(str::trim) {
        Some("short") => Some(4u64),
        Some("medium") => Some(5),
        Some("long") => Some(2),
        _ => None,
    };
    let mut features: Vec<u64> = request
        .features
        .iter()
        .filter_map(|f| feature_field(f))
        .collect();
    features.sort_unstable();
    features.dedup();

    let mut filters = Vec::new();
    if let Some(upload) = upload {
        put_varint_field(&mut filters, 1, upload);
    }
    if let Some(content_type) = content_type {
        put_varint_field(&mut filters, 2, content_type);
    }
    if let Some(duration) = duration {
        put_varint_field(&mut filters, 3, duration);
    }
    for field in features {
        put_varint_field(&mut filters, field, 1);
    }

    let mut buf = Vec::new();
    if let Some(sort) = sort {
        put_varint_field(&mut buf, 1, sort);
    }
    if !filters.is_empty() {
        put_message_field(&mut buf, 2, &filters);
    }
    if request.exact {
        // `{ 1: 1 }` under field 8 turns spelling correction off.
        put_message_field(&mut buf, 8, &[0x08, 0x01]);
    }
    if buf.is_empty() {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(custom_url_encode(&b64))
}

/// A channel card. Its two count labels are not reliably in the field their
/// name implies (a live response puts the handle under `subscriberCountText`
/// and the subscribers under `videoCountText`), so each is sorted by what it says.
fn search_channel(channel: &Value) -> Option<SearchChannel> {
    let channel_id = channel["channelId"].as_str().filter(|id| !id.is_empty())?;
    let labels: Vec<String> = [&channel["subscriberCountText"], &channel["videoCountText"]]
        .into_iter()
        .filter_map(text_of)
        .collect();
    let is_video_count = |label: &&String| label.to_lowercase().contains("video");
    Some(SearchChannel {
        channel_id: channel_id.to_string(),
        name: text_of(&channel["title"])?,
        handle: labels
            .iter()
            .find(|label| label.starts_with('@'))
            .cloned()
            .or_else(|| {
                channel["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"]
                    .as_str()
                    .and_then(|url| url.strip_prefix('/'))
                    .filter(|handle| handle.starts_with('@'))
                    .map(ToOwned::to_owned)
            }),
        avatar_url: largest_url(&channel["thumbnail"]["thumbnails"])
            .map(|url| normalize_youtube_image_url(&url)),
        subscriber_count_text: labels
            .iter()
            .find(|label| !label.starts_with('@') && !is_video_count(label))
            .cloned(),
        video_count_text: labels.iter().find(is_video_count).cloned(),
        description: text_of(&channel["descriptionSnippet"]),
        is_verified: channel["ownerBadges"].as_array().is_some_and(|badges| {
            badges.iter().any(|badge| {
                badge["metadataBadgeRenderer"]["style"]
                    .as_str()
                    .is_some_and(|style| style.starts_with("BADGE_STYLE_TYPE_VERIFIED"))
            })
        }),
    })
}

fn correction(renderer: &Value, applied: bool) -> Option<SearchCorrection> {
    let query = renderer["correctedQueryEndpoint"]["searchEndpoint"]["query"]
        .as_str()
        .map(ToOwned::to_owned)
        .or_else(|| text_of(&renderer["correctedQuery"]))?;
    Some(SearchCorrection {
        query,
        original: text_of(&renderer["originalQuery"]),
        applied,
    })
}

fn read_items(items: &[Value], page: &mut SearchVideosResponse) {
    for item in items {
        if let Some(inner) = item["itemSectionRenderer"]["contents"].as_array() {
            read_items(inner, page);
        } else if let Some(video) = item.get("videoRenderer").and_then(video_from_renderer) {
            page.items.push(video);
        } else if let Some(channel) = item.get("channelRenderer").and_then(search_channel) {
            page.channels.push(channel);
        } else if let Some(lockup) = item.get("lockupViewModel").and_then(lockup_item) {
            if lockup.item_type == "video" {
                page.items.push(related_to_video(lockup));
            } else if let Some(playlist_id) = lockup.playlist_id.clone() {
                page.playlists.push(PlaylistSummary {
                    id: playlist_id,
                    title: lockup.title,
                    thumbnail_url: lockup.thumbnail_url,
                    video_count_text: lockup.view_count_text,
                });
            }
        } else if let Some(shelf) = item.get("shelfRenderer") {
            let content = &shelf["content"];
            let videos: Vec<_> = content["verticalListRenderer"]["items"]
                .as_array()
                .or_else(|| content["horizontalListRenderer"]["items"].as_array())
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.get("videoRenderer").and_then(video_from_renderer))
                .collect();
            if let Some(title) = text_of(&shelf["title"]).filter(|_| !videos.is_empty()) {
                page.shelves.push(SearchShelf { title, videos });
            }
        } else if let Some(grid) = item.get("gridShelfViewModel") {
            page.shorts.extend(
                grid["contents"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(short_video_summary_from_item),
            );
        } else if let Some(shelf) = item.get("reelShelfRenderer") {
            page.shorts.extend(
                shelf["items"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(short_video_summary_from_item),
            );
        } else if let Some(renderer) = item.get("showingResultsForRenderer") {
            page.correction = correction(renderer, true).or(page.correction.take());
        } else if let Some(renderer) = item.get("didYouMeanRenderer") {
            page.correction = correction(renderer, false).or(page.correction.take());
        } else if page.next_page_token.is_none() {
            page.next_page_token = continuation_token(item);
        }
    }
}

/// A page of search results: the first, or a continuation.
#[must_use]
pub fn parse_innertube_search(val: &Value) -> SearchVideosResponse {
    let mut page = SearchVideosResponse {
        source: "innertube".to_string(),
        ..SearchVideosResponse::default()
    };
    if let Some(sections) =
        val["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]["sectionListRenderer"]
            ["contents"]
            .as_array()
    {
        read_items(sections, &mut page);
    }
    for key in ["onResponseReceivedCommands", "onResponseReceivedActions"] {
        for command in val[key].as_array().into_iter().flatten() {
            let items = command["appendContinuationItemsAction"]["continuationItems"]
                .as_array()
                .or_else(|| {
                    command["reloadContinuationItemsCommand"]["continuationItems"].as_array()
                });
            if let Some(items) = items {
                read_items(items, &mut page);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    page.items.retain(|video| seen.insert(video.id.clone()));
    let mut seen = std::collections::HashSet::new();
    page.shorts.retain(|short| seen.insert(short.id.clone()));
    page
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
            if let Some(params) = build_search_params(&request) {
                payload["params"] = Value::String(params);
            }
            payload
        };

        let res = self
            .post_innertube("search", &clients::WEB, &mut payload)
            .await?;
        Ok(parse_innertube_search(&res))
    }

    /// Suggestions for `query`, for the viewer's region (`gl`) when one is set.
    pub async fn get_search_suggestions(
        &self,
        query: &str,
        region: Option<&str>,
    ) -> AppResult<Vec<SearchSuggestion>> {
        let encoded_query = custom_url_encode(query);
        let region = region
            .map(str::trim)
            .filter(|region| region.len() == 2 && region.chars().all(|c| c.is_ascii_alphabetic()))
            .map(|region| format!("&gl={}", region.to_ascii_uppercase()))
            .unwrap_or_default();
        // `oe=utf-8` is load-bearing: without it this endpoint answers in
        // ISO-8859-1, and every suggestion carrying an accent, a curly quote or
        // any non-Latin script comes back as mojibake.
        let url = format!(
            "https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&xhr=t&ie=utf-8&oe=utf-8&hl=en{region}&q={encoded_query}"
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
        Ok(parse_suggestions(&val))
    }
}

/// Reads the suggest endpoint's `[query, [[text, 0, [..], {entity}], ..], ..]` answer.
/// The entity keys are terse: `zao` names it, `zaf` describes it, `zai` is its picture.
fn parse_suggestions(val: &Value) -> Vec<SearchSuggestion> {
    let mut suggestions: Vec<SearchSuggestion> = Vec::new();
    let Some(rows) = val.get(1).and_then(Value::as_array) else {
        return suggestions;
    };
    for row in rows {
        let text = row
            .as_str()
            .or_else(|| row.get(0).and_then(Value::as_str))
            .map(str::trim)
            .unwrap_or_default();
        // The endpoint repeats entries that differ only by casing or spacing.
        if text.is_empty()
            || suggestions
                .iter()
                .any(|existing| existing.text.eq_ignore_ascii_case(text))
        {
            continue;
        }
        let entity = row
            .as_array()
            .and_then(|parts| parts.iter().find(|part| part.is_object()))
            .and_then(suggestion_entity);
        suggestions.push(SearchSuggestion {
            text: text.to_string(),
            entity,
        });
    }
    suggestions
}

fn suggestion_entity(card: &Value) -> Option<SuggestionEntity> {
    let field = |key: &str| {
        card[key]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    Some(SuggestionEntity {
        title: field("zao")?,
        description: field("zaf"),
        image: field("zai").filter(|url| url.starts_with("https://")),
    })
}

#[cfg(test)]
mod tests {
    use super::{build_search_params, parse_innertube_search, parse_suggestions};
    use crate::models::search::SearchVideosRequest;

    fn params(request: &SearchVideosRequest) -> Option<String> {
        build_search_params(request)
    }

    fn with(build: impl FnOnce(&mut SearchVideosRequest)) -> Option<String> {
        let mut request = SearchVideosRequest::default();
        build(&mut request);
        params(&request)
    }

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
        let page = parse_innertube_search(&val);
        assert_eq!(
            page.items.len(),
            1,
            "video inside itemSectionRenderer must be parsed"
        );
        assert_eq!(page.items[0].id, "abc12345678");
        assert_eq!(page.next_page_token.as_deref(), Some("NEXT_TOKEN"));
    }

    #[test]
    fn shelves_shorts_channels_and_corrections_are_kept() {
        let val = serde_json::json!({
            "contents": { "twoColumnSearchResultsRenderer": { "primaryContents": {
                "sectionListRenderer": { "contents": [{ "itemSectionRenderer": { "contents": [
                    { "showingResultsForRenderer": {
                        "correctedQueryEndpoint": { "searchEndpoint": { "query": "linus tech tips" } },
                        "originalQuery": { "simpleText": "linus tehc tips" }
                    } },
                    { "channelRenderer": {
                        "channelId": "UCXuqSBlHAE6Xw-yeJA0Tunw",
                        "title": { "simpleText": "Linus Tech Tips" },
                        "subscriberCountText": { "simpleText": "@LinusTechTips" },
                        "videoCountText": { "simpleText": "16.9M subscribers" },
                        "ownerBadges": [{ "metadataBadgeRenderer": { "style": "BADGE_STYLE_TYPE_VERIFIED" } }]
                    } },
                    { "shelfRenderer": {
                        "title": { "simpleText": "Latest from Linus Tech Tips" },
                        "content": { "verticalListRenderer": { "items": [
                            { "videoRenderer": { "videoId": "shelf000001", "title": { "runs": [{ "text": "A" }] } } }
                        ] } }
                    } },
                    { "gridShelfViewModel": { "contents": [
                        { "shortsLockupViewModel": {
                            "onTap": { "innertubeCommand": { "reelWatchEndpoint": { "videoId": "short000001" } } },
                            "overlayMetadata": { "primaryText": { "content": "A Short" } }
                        } }
                    ] } }
                ] } }] }
            } } }
        });
        let page = parse_innertube_search(&val);
        let correction = page.correction.expect("correction");
        assert!(correction.applied);
        assert_eq!(correction.query, "linus tech tips");
        assert_eq!(correction.original.as_deref(), Some("linus tehc tips"));
        let channel = &page.channels[0];
        assert_eq!(channel.handle.as_deref(), Some("@LinusTechTips"));
        assert_eq!(
            channel.subscriber_count_text.as_deref(),
            Some("16.9M subscribers")
        );
        assert!(channel.is_verified);
        assert_eq!(page.shelves[0].title, "Latest from Linus Tech Tips");
        assert_eq!(page.shelves[0].videos.len(), 1);
        assert_eq!(page.shorts[0].id, "short000001");
        assert!(
            page.items.is_empty(),
            "shelf videos and Shorts stay out of the video list"
        );
    }

    #[test]
    fn an_unfiltered_relevance_search_sends_no_params() {
        assert_eq!(params(&SearchVideosRequest::default()), None);
        assert_eq!(
            with(|r| {
                r.sort_by = Some("relevance".into());
                r.upload_date = Some("any".into());
                r.duration = Some("any".into());
            }),
            None
        );
        // Recency is not a sort YouTube honours.
        assert_eq!(with(|r| r.sort_by = Some("date".into())), None);
    }

    // Every expected token is one YouTube's filter dialog ships (Flow for
    // Android's YouTubeSearchParamsTest), so these double as a spec.
    #[test]
    fn builds_the_type_tokens() {
        for (kind, token) in [
            ("video", "EgIQAQ%3D%3D"),
            ("shorts", "EgIQCQ%3D%3D"),
            ("channel", "EgIQAg%3D%3D"),
            ("playlist", "EgIQAw%3D%3D"),
            ("movie", "EgIQBA%3D%3D"),
        ] {
            assert_eq!(
                with(|r| r.content_type = Some(kind.into())).as_deref(),
                Some(token)
            );
        }
    }

    #[test]
    fn builds_the_duration_tokens_youtube_now_ships() {
        assert_eq!(
            with(|r| r.duration = Some("short".into())).as_deref(),
            Some("EgIYBA%3D%3D")
        );
        assert_eq!(
            with(|r| r.duration = Some("medium".into())).as_deref(),
            Some("EgIYBQ%3D%3D")
        );
        assert_eq!(
            with(|r| r.duration = Some("long".into())).as_deref(),
            Some("EgIYAg%3D%3D")
        );
    }

    #[test]
    fn builds_the_upload_date_and_feature_tokens() {
        assert_eq!(
            with(|r| r.upload_date = Some("today".into())).as_deref(),
            Some("EgIIAg%3D%3D")
        );
        for (feature, token) in [
            ("live", "EgJAAQ%3D%3D"),
            ("4k", "EgJwAQ%3D%3D"),
            ("hd", "EgIgAQ%3D%3D"),
            ("subtitles", "EgIoAQ%3D%3D"),
            ("creative_commons", "EgIwAQ%3D%3D"),
            ("360", "EgJ4AQ%3D%3D"),
            ("vr180", "EgPQAQE%3D"),
            ("3d", "EgI4AQ%3D%3D"),
            ("hdr", "EgPIAQE%3D"),
            ("location", "EgO4AQE%3D"),
        ] {
            assert_eq!(
                with(|r| r.features = vec![feature.into()]).as_deref(),
                Some(token),
                "{feature}"
            );
        }
    }

    #[test]
    fn combines_a_sort_with_filters_and_orders_features() {
        assert_eq!(
            with(|r| r.sort_by = Some("views".into())).as_deref(),
            Some("CAM%3D")
        );
        assert_eq!(
            with(|r| {
                r.sort_by = Some("views".into());
                r.content_type = Some("video".into());
                r.duration = Some("long".into());
                r.upload_date = Some("year".into());
            })
            .as_deref(),
            Some("CAMSBggFEAEYAg%3D%3D")
        );
        let ordered = with(|r| r.features = vec!["4k".into(), "hd".into(), "subtitles".into()]);
        let reversed = with(|r| r.features = vec!["subtitles".into(), "hd".into(), "4k".into()]);
        assert_eq!(ordered, reversed);
    }

    #[test]
    fn exact_searches_turn_correction_off() {
        assert_eq!(with(|r| r.exact = true).as_deref(), Some("QgIIAQ%3D%3D"));
    }

    #[test]
    fn suggestions_keep_the_knowledge_card_and_drop_repeats() {
        let answer = serde_json::json!([
            "linus tor",
            [
                ["linus torvalds", 0, [512, 433, 47], {
                    "zae": "/m/04gnf",
                    "zaf": "Finnish-American software engineer",
                    "zai": "https://encrypted-tbn3.gstatic.com/images?q=tbn:abc",
                    "zao": "Linus Torvalds",
                    "zaq": "https://www.britannica.com/biography/Linus-Torvalds"
                }],
                ["linus torvalds interview", 0, [512, 433]],
                ["Linus Torvalds Interview ", 0, [512]],
                ["blank card", 0, [512], { "zao": " ", "zai": "http://insecure.example/x.jpg" }],
                "plain string row"
            ],
            { "k": 1 }
        ]);
        let suggestions = parse_suggestions(&answer);
        let texts: Vec<&str> = suggestions.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "linus torvalds",
                "linus torvalds interview",
                "blank card",
                "plain string row"
            ]
        );
        let card = suggestions[0].entity.as_ref().unwrap();
        assert_eq!(card.title, "Linus Torvalds");
        assert_eq!(
            card.description.as_deref(),
            Some("Finnish-American software engineer")
        );
        assert!(
            card.image
                .as_deref()
                .unwrap()
                .starts_with("https://encrypted-tbn3")
        );
        assert!(suggestions[1].entity.is_none());
        assert!(
            suggestions[2].entity.is_none(),
            "a card without a name is dropped"
        );
    }
}
