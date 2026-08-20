use std::collections::HashSet;

use crate::api::innertube::InnertubeClient;
use crate::api::innertube::core::clients;
use crate::api::innertube::core::utils::{
    best_video_thumbnail_url, build_related_content_from_lockup, detect_video_is_live,
    extract_channel_id_from_video_renderer, extract_text_from_value, normalize_youtube_image_url,
    parse_duration_seconds, thumbnail_url_from_array,
};
use crate::errors::{AppError, AppResult};
use crate::models::video::VideoSummary;
use serde_json::{Value, json};

const TRENDING_VIDEOS_PARAMS: &str = "4gIOGgxtb3N0X3BvcHVsYXI%3D";
const GAMING_CHANNEL_ID: &str = "UCOpNcN46UbXVtpKMrmU4Abg";
const GAMING_PARAMS: &str = "Egh0cmVuZGluZw%3D%3D";
const LIVE_CHANNEL_ID: &str = "UC4R8DWoMoI7CAwX8_LjQHig";
const LIVE_PARAMS: &str = "EgdsaXZldGFikgEDCKEK";
const CHARTS_ENDPOINT: &str =
    "https://charts.youtube.com/youtubei/v1/browse?alt=json&prettyPrint=false";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrendingCategory {
    All,
    Trending,
    Gaming,
    Music,
    Movies,
    Live,
}

impl TrendingCategory {
    fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "trending" => Self::Trending,
            "gaming" | "trending_gaming" => Self::Gaming,
            "music" | "trending_music" => Self::Music,
            "movies" | "movies_and_shows" | "trending_movies_and_shows" => Self::Movies,
            "live" => Self::Live,
            _ => Self::All,
        }
    }
}

impl InnertubeClient {
    pub async fn get_trending_videos(
        &self,
        category: Option<&str>,
        region: Option<&str>,
    ) -> AppResult<Vec<VideoSummary>> {
        let category = TrendingCategory::parse(category.unwrap_or("all"));
        let region = sanitize_region(region.unwrap_or("US"));

        match category {
            TrendingCategory::All => {
                let lanes = [
                    self.fetch_trending(&region).await.unwrap_or_default(),
                    self.fetch_channel_kiosk(GAMING_CHANNEL_ID, GAMING_PARAMS, &region)
                        .await
                        .unwrap_or_default(),
                    self.fetch_charts("TRENDING_VIDEOS", &region)
                        .await
                        .unwrap_or_default(),
                    self.fetch_charts("TRENDING_MOVIES", &region)
                        .await
                        .unwrap_or_default(),
                ];
                Ok(interleave_round_robin(&lanes))
            }
            TrendingCategory::Trending => self.fetch_trending(&region).await,
            TrendingCategory::Gaming => {
                self.fetch_channel_kiosk(GAMING_CHANNEL_ID, GAMING_PARAMS, &region)
                    .await
            }
            TrendingCategory::Music => self.fetch_charts("TRENDING_VIDEOS", &region).await,
            TrendingCategory::Movies => self.fetch_charts("TRENDING_MOVIES", &region).await,
            TrendingCategory::Live => {
                self.fetch_channel_kiosk(LIVE_CHANNEL_ID, LIVE_PARAMS, &region)
                    .await
            }
        }
    }

    async fn fetch_trending(&self, region: &str) -> AppResult<Vec<VideoSummary>> {
        let mut payload = web_payload(region);
        payload["browseId"] = json!("FEtrending");
        payload["params"] = json!(TRENDING_VIDEOS_PARAMS);

        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        let mut videos = Vec::new();

        if let Some(tabs) =
            response["contents"]["twoColumnBrowseResultsRenderer"]["tabs"].as_array()
        {
            for tab in tabs {
                let renderer = &tab["tabRenderer"];
                if renderer["selected"].as_bool().unwrap_or(false) {
                    collect_videos_from_value(&renderer["content"], &mut videos);
                }
            }
        }

        Ok(dedupe_videos(videos))
    }

    async fn fetch_channel_kiosk(
        &self,
        browse_id: &str,
        params: &str,
        region: &str,
    ) -> AppResult<Vec<VideoSummary>> {
        let mut payload = web_payload(region);
        payload["browseId"] = json!(browse_id);
        payload["params"] = json!(params);

        let response = self
            .post_innertube("browse", &clients::WEB, &mut payload)
            .await?;
        let mut videos = Vec::new();

        if let Some(tabs) =
            response["contents"]["twoColumnBrowseResultsRenderer"]["tabs"].as_array()
        {
            for tab in tabs {
                collect_videos_from_value(&tab["tabRenderer"]["content"], &mut videos);
            }
        } else {
            collect_videos_from_value(&response, &mut videos);
        }

        Ok(dedupe_videos(videos))
    }

    async fn fetch_charts(&self, chart_type: &str, region: &str) -> AppResult<Vec<VideoSummary>> {
        let client = &clients::WEB_MUSIC_ANALYTICS;
        let payload = json!({
            "context": client.context(None, Some(region)),
            "browseId": "FEmusic_analytics_charts_home",
            "query": format!(
                "perspective=CHART_DETAILS&chart_params_country_code={region}&chart_params_chart_type={chart_type}"
            )
        });

        let response = self
            .client
            .post(CHARTS_ENDPOINT)
            .header(reqwest::header::USER_AGENT, client.user_agent)
            .header("X-YouTube-Client-Name", client.client_id)
            .header("X-YouTube-Client-Version", client.version)
            .header("Origin", "https://charts.youtube.com")
            .header("Referer", "https://charts.youtube.com")
            .header("Cookie", "SOCS=CAE=")
            .json(&payload)
            .send()
            .await
            .map_err(|error| AppError::Extractor(format!("Network error: {error}")))?;

        let status = response.status();
        let value = response
            .json::<Value>()
            .await
            .map_err(|error| AppError::Extractor(format!("JSON parse error: {error}")))?;

        if !status.is_success() {
            return Err(AppError::Extractor(format!(
                "YouTube Charts returned status {status}: {}",
                value["error"]["message"]
                    .as_str()
                    .unwrap_or("Unknown error")
            )));
        }

        Ok(dedupe_videos(parse_charts_videos(&value)))
    }
}

fn sanitize_region(region: &str) -> String {
    let cleaned = region.trim().to_ascii_uppercase();
    if cleaned.len() == 2 && cleaned.chars().all(|c| c.is_ascii_alphabetic()) {
        cleaned
    } else {
        "US".to_string()
    }
}

fn web_payload(region: &str) -> Value {
    json!({ "context": clients::WEB.context(None, Some(region)) })
}

fn collect_videos_from_value(value: &Value, videos: &mut Vec<VideoSummary>) {
    if let Some(video) = value
        .get("videoRenderer")
        .or_else(|| value.get("gridVideoRenderer"))
    {
        if let Some(summary) = parse_video_renderer(video) {
            videos.push(summary);
        }
        return;
    }

    if let Some(lockup) = value.get("lockupViewModel") {
        if let Some(item) = build_related_content_from_lockup(lockup) {
            if item.item_type == "video" {
                videos.push(VideoSummary {
                    id: item.video_id.unwrap_or(item.id),
                    title: item.title,
                    channel_name: item.channel_name,
                    channel_id: item.channel_id,
                    thumbnail_url: item.thumbnail_url,
                    duration_seconds: item.duration_seconds,
                    published_text: item.published_text,
                    view_count_text: item.view_count_text,
                    channel_avatar_url: None,
                    is_live: item.is_live,
                });
            }
        }
        return;
    }

    if let Some(array) = value.as_array() {
        for item in array {
            collect_videos_from_value(item, videos);
        }
        return;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            collect_videos_from_value(child, videos);
        }
    }
}

fn parse_video_renderer(video: &Value) -> Option<VideoSummary> {
    let id = video["videoId"]
        .as_str()
        .or_else(|| video["videoId"]["runs"][0]["text"].as_str())?
        .to_string();

    let title = extract_text_from_value(&video["title"])
        .or_else(|| {
            video["title"]["runs"][0]["text"]
                .as_str()
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();

    if title.is_empty() {
        return None;
    }

    let channel_name = extract_text_from_value(&video["ownerText"])
        .or_else(|| extract_text_from_value(&video["longBylineText"]))
        .or_else(|| extract_text_from_value(&video["shortBylineText"]))
        .unwrap_or_default();

    let duration_text = extract_text_from_value(&video["lengthText"]);
    let duration_seconds = duration_text
        .as_deref()
        .filter(|text| !text.is_empty())
        .map(parse_duration_seconds);

    let thumbnail_url = best_video_thumbnail_url(&id, Some(&video["thumbnail"]["thumbnails"]));

    let channel_avatar_url = video["channelThumbnailSupportedRenderers"]
        ["channelThumbnailWithLinkRenderer"]["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|items| items.last())
        .and_then(|thumb| thumb["url"].as_str())
        .map(normalize_youtube_image_url);

    Some(VideoSummary {
        id,
        title,
        channel_name,
        channel_id: extract_channel_id_from_video_renderer(video),
        thumbnail_url,
        duration_seconds,
        published_text: extract_text_from_value(&video["publishedTimeText"]),
        view_count_text: extract_text_from_value(&video["viewCountText"])
            .or_else(|| extract_text_from_value(&video["shortViewCountText"])),
        channel_avatar_url,
        is_live: detect_video_is_live(video),
    })
}

fn parse_charts_videos(response: &Value) -> Vec<VideoSummary> {
    let mut videos = Vec::new();
    collect_chart_video_views(response, &mut videos);
    videos
}

fn collect_chart_video_views(value: &Value, videos: &mut Vec<VideoSummary>) {
    if let Some(video_views) = value.get("videoViews").and_then(Value::as_array) {
        for video in video_views {
            if let Some(summary) = parse_chart_video(video) {
                videos.push(summary);
            }
        }
        return;
    }

    if let Some(array) = value.as_array() {
        for item in array {
            collect_chart_video_views(item, videos);
        }
        return;
    }

    if let Some(object) = value.as_object() {
        for child in object.values() {
            collect_chart_video_views(child, videos);
        }
    }
}

fn parse_chart_video(video: &Value) -> Option<VideoSummary> {
    let id = video["id"].as_str()?.to_string();
    let channel_id = video["externalChannelId"].as_str().map(ToOwned::to_owned);
    let duration = video["videoDuration"].as_u64();
    let thumbnail_url = thumbnail_url_from_array(&video["thumbnail"]["thumbnails"])
        .or_else(|| thumbnail_url_from_array(&video["thumbnails"]))
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{id}/hq720.jpg")));

    let published_text = video["releaseDate"].as_object().and_then(|release| {
        let year = release.get("year")?.as_i64()?;
        let month = release.get("month")?.as_i64()?;
        let day = release.get("day")?.as_i64()?;
        Some(format!("{year:04}-{month:02}-{day:02}"))
    });

    Some(VideoSummary {
        id,
        title: video["title"].as_str().unwrap_or_default().to_string(),
        channel_name: video["channelName"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        channel_id,
        thumbnail_url,
        duration_seconds: duration,
        published_text,
        view_count_text: None,
        channel_avatar_url: None,
        is_live: false,
    })
}

fn dedupe_videos(videos: Vec<VideoSummary>) -> Vec<VideoSummary> {
    let mut seen = HashSet::new();
    videos
        .into_iter()
        .filter(|video| !video.id.is_empty() && seen.insert(video.id.clone()))
        .collect()
}

fn interleave_round_robin(lanes: &[Vec<VideoSummary>]) -> Vec<VideoSummary> {
    let max_len = lanes.iter().map(Vec::len).max().unwrap_or(0);
    let mut result = Vec::new();

    for index in 0..max_len {
        for lane in lanes {
            if let Some(video) = lane.get(index) {
                result.push(video.clone());
            }
        }
    }

    dedupe_videos(result)
}
