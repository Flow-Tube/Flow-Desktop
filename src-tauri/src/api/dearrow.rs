use crate::errors::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeArrowTitle {
    pub title: String,
    pub votes: i32,
    pub locked: bool,
    pub original: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeArrowThumbnail {
    pub timestamp: Option<f32>,
    pub thumbnail: Option<String>,
    pub votes: i32,
    pub locked: bool,
    pub original: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeArrowContent {
    #[serde(default)]
    pub titles: Vec<DeArrowTitle>,
    #[serde(default)]
    pub thumbnails: Vec<DeArrowThumbnail>,
    /// Where in the video to take a frame from, 0 to 1, the same for every `DeArrow` user.
    #[serde(default)]
    pub random_time: Option<f64>,
    #[serde(default)]
    pub video_duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeArrowOverride {
    pub title: Option<String>,
    pub thumbnail_url: Option<String>,
    /// A frame to show when no thumbnail was submitted. The frontend's switch decides, so a
    /// cached answer stays good when it changes.
    #[serde(default)]
    pub random_frame_url: Option<String>,
}

/// DeArrow submitters prefix a word with `>` to keep its casing when titles are
/// auto-formatted; the marker is formatting metadata, never part of the title.
pub fn strip_case_markers(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut chars = title.chars().peekable();
    let mut at_word_start = true;
    while let Some(c) = chars.next() {
        let is_marker =
            c == '>' && at_word_start && chars.peek().is_some_and(|next| !next.is_whitespace());
        if !is_marker {
            out.push(c);
        }
        at_word_start = c.is_whitespace();
    }
    out
}

pub async fn fetch_dearrow_override_api(video_id: &str) -> AppResult<Option<DeArrowOverride>> {
    let client = crate::api::http::shared_client();

    let url = format!("https://sponsor.ajay.app/api/branding?videoID={}", video_id);
    let res = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, "FlowYouTube/1.0")
        .send()
        .await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to fetch DeArrow data for {}: {}", video_id, e);
            return Ok(None);
        }
    };

    // A video nobody has submitted for answers 404, with the random frame time in its body.
    let status = response.status();
    if !status.is_success() && status != reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let content: DeArrowContent = match response.json().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to parse DeArrow JSON for {}: {}", video_id, e);
            return Ok(None);
        }
    };

    // Filter and pick the best title
    // - Prefers locked entries over voted ones
    // - Ignores entries with negative votes (downvoted)
    // - Ignores "original" entries (keep as-is)
    let best_title = content
        .titles
        .iter()
        .filter(|t| !t.original && (t.votes >= 0 || t.locked))
        .max_by_key(|t| if t.locked { i32::MAX } else { t.votes })
        .map(|t| strip_case_markers(&t.title));

    // Filter and pick the best thumbnail
    let best_thumb = content
        .thumbnails
        .iter()
        .filter(|t| !t.original && (t.votes >= 0 || t.locked))
        .max_by_key(|t| if t.locked { i32::MAX } else { t.votes });

    let thumbnail_url = if let Some(thumb) = best_thumb {
        if let Some(t_url) = &thumb.thumbnail {
            Some(t_url.clone())
        } else if let Some(ts) = thumb.timestamp {
            Some(format!(
                "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID={}&time={}",
                video_id, ts
            ))
        } else {
            None
        }
    } else {
        None
    };

    let random_frame_url = random_frame_url(&content, video_id);
    if best_title.is_none() && thumbnail_url.is_none() && random_frame_url.is_none() {
        Ok(None)
    } else {
        Ok(Some(DeArrowOverride {
            title: best_title,
            thumbnail_url,
            random_frame_url,
        }))
    }
}

/// The frame `DeArrow` picks for a video with no usable thumbnail submission. A winning "original"
/// is a submission too: it keeps `YouTube`'s thumbnail, so it gets no frame.
fn random_frame_url(content: &DeArrowContent, video_id: &str) -> Option<String> {
    if content.thumbnails.iter().any(|t| t.votes >= 0 || t.locked) {
        return None;
    }
    let random_time = content.random_time?;
    // Live and upcoming videos have no duration here, and no frame to show yet.
    let duration = content.video_duration.filter(|duration| *duration > 0.0)?;
    Some(format!(
        "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID={}&time={}",
        video_id,
        random_time * duration
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(body: serde_json::Value) -> DeArrowContent {
        serde_json::from_value(body).unwrap()
    }

    #[test]
    fn a_video_with_no_submission_gets_a_frame_at_the_random_time() {
        let answer = content(serde_json::json!({
            "titles": [], "thumbnails": [], "randomTime": 0.25, "videoDuration": 200.0
        }));
        assert_eq!(
            random_frame_url(&answer, "abc").as_deref(),
            Some("https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=abc&time=50")
        );
    }

    #[test]
    fn a_submission_or_a_missing_duration_means_no_frame() {
        let submitted = content(serde_json::json!({
            "thumbnails": [{"timestamp": 3.0, "votes": 0, "locked": false, "original": true}],
            "randomTime": 0.25, "videoDuration": 200.0
        }));
        assert_eq!(random_frame_url(&submitted, "abc"), None);
        let live = content(serde_json::json!({ "randomTime": 0.25, "videoDuration": 0.0 }));
        assert_eq!(random_frame_url(&live, "abc"), None);
        let unknown = content(serde_json::json!({ "randomTime": 0.25, "videoDuration": null }));
        assert_eq!(random_frame_url(&unknown, "abc"), None);
    }

    #[test]
    fn strips_case_markers_at_word_starts() {
        assert_eq!(
            strip_case_markers("National >Flying >Laboratory >Centre | Tom >Scott: >England >E24"),
            "National Flying Laboratory Centre | Tom Scott: England E24"
        );
        assert_eq!(strip_case_markers(">US Supreme Court"), "US Supreme Court");
    }

    #[test]
    fn keeps_literal_greater_than_signs() {
        assert_eq!(strip_case_markers("5 > 3"), "5 > 3");
        assert_eq!(strip_case_markers("a->b >"), "a->b >");
        assert_eq!(strip_case_markers(">>Mixed"), ">Mixed");
    }
}
