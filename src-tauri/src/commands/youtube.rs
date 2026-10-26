use tauri::State;
use tracing::{debug, info};

use crate::api::innertube::core::clients;
use crate::api::innertube::extractors::resolve::ResolvedEndpoint;
use crate::errors::ErrorResponse;
use crate::models::channel::{ChannelAbout, ChannelDetails, ChannelPage, ChannelTabResponse};
use crate::models::comment::CommentsResponse;
use crate::models::explore::{ExploreGrid, ExplorePage, ExploreTarget};
use crate::models::playlist::PlaylistDetailsResponse;
use crate::models::search::{SearchVideosRequest, SearchVideosResponse};
use crate::models::video::{RelatedPage, StreamInfo, VideoDetails, VideoSummary};
use crate::security::validation::{
    validate_browse_id, validate_channel_id, validate_page_token, validate_search_query,
    validate_video_id,
};
use crate::services::recommendation_service::RecommendationService;
use crate::services::subscription_feed::{self, SubscriptionRssFeed};
use crate::services::youtube_service::YoutubeService;

use crate::streaming::proxy::StreamingManager;

/// The channel a handle, `/c/` or `/user/` link names, through the site's own
/// router.
#[tauri::command]
pub async fn resolve_channel_id(
    url: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<String, ErrorResponse> {
    match youtube_service
        .resolve_url(&url)
        .await
        .map_err(ErrorResponse::from)?
    {
        ResolvedEndpoint::Channel(channel_id) => Ok(channel_id),
        _ => Err(ErrorResponse::from(crate::errors::AppError::Validation(
            "That link is not a channel".into(),
        ))),
    }
}

fn extract_codecs(mime_type: Option<&str>) -> Option<String> {
    let mime_type = mime_type?;
    let codecs = mime_type
        .split(';')
        .find_map(|part| {
            part.trim()
                .strip_prefix("codecs=")
                .map(|value| value.trim_matches('"').to_string())
        })
        .filter(|value| !value.is_empty())?;

    if codecs == "vp9" {
        Some("vp09.00.10.08".to_string())
    } else {
        Some(codecs)
    }
}

fn extract_base_mime_type(mime_type: Option<&str>) -> Option<&str> {
    mime_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn format_duration_xml(duration_ms: u64) -> String {
    let total_seconds = duration_ms / 1000;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let millis = duration_ms % 1000;

    let mut output = String::from("PT");
    if hours > 0 {
        output.push_str(&format!("{hours}H"));
    }
    if minutes > 0 {
        output.push_str(&format!("{minutes}M"));
    }
    if millis > 0 {
        output.push_str(&format!("{seconds}.{millis:03}S"));
    } else {
        output.push_str(&format!("{seconds}S"));
    }
    output
}

fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Build a DASH manifest for responses YouTube serves without one.
///
/// Public so `tests/dash_manifest.rs` can assert the audio contract the player
/// depends on; nothing outside this module calls it.
pub fn build_synthetic_dash_manifest(stream_info: &StreamInfo) -> Option<String> {
    let has_segment_ranges =
        |init_s: Option<u64>, init_e: Option<u64>, idx_s: Option<u64>, idx_e: Option<u64>| {
            init_s.is_some() && init_e.is_some() && idx_s.is_some() && idx_e.is_some()
        };
    let is_mp4 = |mime: Option<&str>| mime.map(|m| m.contains("mp4")).unwrap_or(false);

    let audio_tracks: Vec<_> = stream_info
        .audio_tracks
        .iter()
        .filter(|track| {
            !track.local_url.is_empty()
                && has_segment_ranges(
                    track.init_range_start,
                    track.init_range_end,
                    track.index_range_start,
                    track.index_range_end,
                )
        })
        .collect();

    if audio_tracks.is_empty() {
        return None;
    }

    let all_video_variants: Vec<_> = stream_info
        .variants
        .iter()
        .filter(|variant| {
            variant.is_video_only
                && variant.is_playable
                && !variant.local_url.is_empty()
                && has_segment_ranges(
                    variant.init_range_start,
                    variant.init_range_end,
                    variant.index_range_start,
                    variant.index_range_end,
                )
        })
        .collect();

    // Prefer H.264 outright: it's the only codec every platform can decode
    // (Linux WebKitGTK frequently lacks VP9/AV1 plugins), and AV1 also ships
    // in an MP4 container, so the container check alone doesn't exclude it.
    let is_h264 = |mime: Option<&str>| {
        mime.map(|m| m.contains("avc1") || m.contains("avc3"))
            .unwrap_or(false)
    };

    let h264_video_variants: Vec<_> = all_video_variants
        .iter()
        .copied()
        .filter(|variant| is_h264(variant.mime_type.as_deref()))
        .collect();

    let mp4_video_variants: Vec<_> = all_video_variants
        .iter()
        .copied()
        .filter(|variant| is_mp4(variant.mime_type.as_deref()))
        .collect();

    let video_variants = if !h264_video_variants.is_empty() {
        h264_video_variants
    } else if !mp4_video_variants.is_empty() {
        mp4_video_variants
    } else {
        all_video_variants
    };

    if video_variants.is_empty() {
        return None;
    }

    let duration_ms = video_variants
        .iter()
        .filter_map(|variant| variant.approx_duration_ms)
        .chain(
            audio_tracks
                .iter()
                .filter_map(|track| track.approx_duration_ms),
        )
        .max()?;

    // Log the codecs/resolutions that won selection so a "video frozen, audio
    // plays" report (a missing system decoder on Linux, issue #29) is diagnosable
    // from the logs alone — pairs with the caller's `video_id`.
    let selected_video: Vec<String> = video_variants
        .iter()
        .map(|variant| {
            format!(
                "{} {}p {}kbps",
                extract_codecs(variant.mime_type.as_deref()).unwrap_or_else(|| "?".to_string()),
                variant.height.unwrap_or(0),
                variant.bitrate.unwrap_or(0) / 1000
            )
        })
        .collect();
    let selected_audio: Vec<String> = audio_tracks
        .iter()
        .map(|track| extract_codecs(track.mime_type.as_deref()).unwrap_or_else(|| "?".to_string()))
        .collect();
    info!(
        video_reps = selected_video.len(),
        audio_reps = selected_audio.len(),
        video = ?selected_video,
        audio = ?selected_audio,
        "synthetic DASH representation selection"
    );

    let mut video_groups: Vec<(String, Vec<_>)> = Vec::new();
    for variant in &video_variants {
        let mime_type = extract_base_mime_type(variant.mime_type.as_deref())
            .unwrap_or("video/mp4")
            .to_string();

        if let Some((_, variants)) = video_groups
            .iter_mut()
            .find(|(group_mime_type, _)| *group_mime_type == mime_type)
        {
            variants.push(*variant);
        } else {
            video_groups.push((mime_type, vec![*variant]));
        }
    }

    let mut manifest = String::new();
    manifest.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    manifest.push_str(&format!(
        "<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\" profiles=\"urn:mpeg:dash:profile:isoff-on-demand:2011\" minBufferTime=\"PT1.5S\" mediaPresentationDuration=\"{}\">\n",
        format_duration_xml(duration_ms)
    ));
    manifest.push_str("  <Period id=\"flow-period-0\" start=\"PT0S\">\n");
    for audio_track in audio_tracks.iter() {
        let audio_mime_type =
            extract_base_mime_type(audio_track.mime_type.as_deref()).unwrap_or("audio/mp4");
        let audio_codecs = extract_codecs(audio_track.mime_type.as_deref())
            .unwrap_or_else(|| "mp4a.40.2".to_string());
        let audio_id = escape_xml_attr(&audio_track.id);
        let lang = escape_xml_attr(audio_track.language_code.as_deref().unwrap_or("und"));
        let label = escape_xml_attr(&audio_track.label);
        let role = if audio_track.is_default {
            "main"
        } else {
            "alternate"
        };

        manifest.push_str(&format!(
            "    <AdaptationSet id=\"audio-{}\" contentType=\"audio\" lang=\"{}\" mimeType=\"{}\" codecs=\"{}\" startWithSAP=\"1\" subsegmentAlignment=\"true\">\n",
            audio_id,
            lang,
            audio_mime_type,
            audio_codecs
        ));
        manifest.push_str(&format!(
            "      <Role schemeIdUri=\"urn:mpeg:dash:role:2011\" value=\"{}\" />\n",
            role
        ));
        manifest.push_str(&format!("      <Label>{}</Label>\n", label));
        manifest.push_str(&format!(
            "      <Representation id=\"{}\" bandwidth=\"{}\" audioSamplingRate=\"48000\">\n",
            audio_id,
            audio_track.bitrate.unwrap_or(128_000)
        ));
        manifest.push_str(&format!(
            "        <BaseURL>{}</BaseURL>\n",
            escape_xml_attr(&audio_track.local_url)
        ));
        manifest.push_str(&format!(
            "        <SegmentBase indexRange=\"{}-{}\">\n",
            audio_track.index_range_start?, audio_track.index_range_end?
        ));
        manifest.push_str(&format!(
            "          <Initialization range=\"{}-{}\" />\n",
            audio_track.init_range_start?, audio_track.init_range_end?
        ));
        manifest.push_str("        </SegmentBase>\n");
        manifest.push_str("      </Representation>\n");
        manifest.push_str("    </AdaptationSet>\n");
    }
    for (group_index, (video_mime_type, variants)) in video_groups.iter().enumerate() {
        manifest.push_str(&format!(
            "    <AdaptationSet id=\"video-{}\" contentType=\"video\" mimeType=\"{}\" startWithSAP=\"1\" subsegmentAlignment=\"true\">\n",
            group_index,
            video_mime_type
        ));

        for variant in variants {
            let codecs = extract_codecs(variant.mime_type.as_deref())
                .unwrap_or_else(|| "avc1.640028".to_string());
            manifest.push_str(&format!(
                "      <Representation id=\"{}\" bandwidth=\"{}\" width=\"{}\" height=\"{}\" frameRate=\"{}\" codecs=\"{}\">\n",
                variant.id,
                variant.bitrate.unwrap_or(1_000_000),
                variant.width.unwrap_or(0),
                variant.height.unwrap_or(0),
                variant.fps.unwrap_or(30),
                codecs
            ));
            manifest.push_str(&format!(
                "        <BaseURL>{}</BaseURL>\n",
                escape_xml_attr(&variant.local_url)
            ));
            manifest.push_str(&format!(
                "        <SegmentBase indexRange=\"{}-{}\">\n",
                variant.index_range_start?, variant.index_range_end?
            ));
            manifest.push_str(&format!(
                "          <Initialization range=\"{}-{}\" />\n",
                variant.init_range_start?, variant.init_range_end?
            ));
            manifest.push_str("        </SegmentBase>\n");
            manifest.push_str("      </Representation>\n");
        }

        manifest.push_str("    </AdaptationSet>\n");
    }
    manifest.push_str("  </Period>\n");
    manifest.push_str("</MPD>\n");
    Some(manifest)
}

#[tauri::command]
pub async fn search_videos(
    request: SearchVideosRequest,
    youtube_service: State<'_, YoutubeService>,
) -> Result<SearchVideosResponse, ErrorResponse> {
    if let Some(page_token) = request.page_token.as_deref() {
        validate_page_token(page_token).map_err(ErrorResponse::from)?;
    } else {
        validate_search_query(&request.query).map_err(ErrorResponse::from)?;
    }

    youtube_service
        .search_videos(request)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(video_id = %video_id))]
pub async fn get_video_details(
    video_id: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<VideoDetails, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    youtube_service
        .get_video_details(&video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(video_id = %video_id))]
pub async fn get_related_videos(
    video_id: String,
    youtube_service: State<'_, YoutubeService>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<RelatedPage, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    let related = youtube_service
        .get_related_videos(&video_id)
        .await
        .map_err(ErrorResponse::from)?;
    recommendation_service.note_related(&video_id, &related.items);
    Ok(related)
}

/// The video's category, for the recommendation engine. A small request of
/// its own, so the watch page asks only once playback has settled.
#[tauri::command]
pub async fn get_video_category(
    video_id: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<Option<String>, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    youtube_service
        .get_video_category(&video_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_more_related_videos(
    continuation: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<RelatedPage, ErrorResponse> {
    youtube_service
        .get_more_related_videos(&continuation)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(video_id = %video_id))]
pub async fn get_stream_info(
    video_id: String,
    refresh: Option<bool>,
    youtube_service: State<'_, YoutubeService>,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<StreamInfo, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    let refresh = refresh.unwrap_or(false);
    let mut stream_info = youtube_service
        .get_stream_info(&video_id, refresh)
        .await
        .map_err(ErrorResponse::from)?;

    let token = uuid::Uuid::new_v4().to_string();

    let parts: Vec<&str> = stream_info.expires_at.split('|').collect();
    let clean_expires_at = parts[0].to_string();
    // Extraction appends the winning client's User-Agent to `expires_at`; the
    // fallback is the client that leads the ladder, so a missing suffix still
    // fetches with an identity the registry knows rather than a stale literal.
    let dynamic_user_agent = parts
        .get(1)
        .map(|&s| s.to_string())
        .unwrap_or_else(|| clients::VISIONOS.user_agent.to_string());
    let proxy_port = streaming_manager.get_port();

    if let Some(manifest_url) = stream_info
        .dash_manifest_url
        .clone()
        .filter(|value| !value.is_empty())
    {
        let dash_token = uuid::Uuid::new_v4().to_string();
        streaming_manager.register_session(
            dash_token.clone(),
            manifest_url.clone(),
            "application/dash+xml".to_string(),
            dynamic_user_agent.clone(),
        );

        let mut local_manifest_url =
            reqwest::Url::parse(&format!("http://127.0.0.1:{proxy_port}/proxy/{dash_token}"))
                .expect("failed to build local DASH proxy URL");
        local_manifest_url
            .query_pairs_mut()
            .append_pair("url", &manifest_url);
        stream_info.dash_manifest_url = Some(local_manifest_url.to_string());
    }

    if let Some(manifest_url) = stream_info
        .hls_manifest_url
        .clone()
        .filter(|value| !value.is_empty())
    {
        let hls_token = uuid::Uuid::new_v4().to_string();
        streaming_manager.register_session(
            hls_token.clone(),
            manifest_url.clone(),
            "application/vnd.apple.mpegurl".to_string(),
            dynamic_user_agent.clone(),
        );

        let mut local_manifest_url =
            reqwest::Url::parse(&format!("http://127.0.0.1:{proxy_port}/proxy/{hls_token}"))
                .expect("failed to build local HLS proxy URL");
        local_manifest_url
            .query_pairs_mut()
            .append_pair("url", &manifest_url);
        stream_info.hls_manifest_url = Some(local_manifest_url.to_string());
    }

    // A SABR-only or manifest-only response has no progressive URL; registering
    // an empty one only hands the player a route that fails on first request.
    let has_progressive_url = !stream_info.local_url.is_empty();
    if has_progressive_url {
        streaming_manager.register_session(
            token.clone(),
            stream_info.local_url.clone(),
            "video/mp4".to_string(),
            dynamic_user_agent.clone(),
        );
    }

    for variant in &mut stream_info.variants {
        if !variant.is_playable || variant.local_url.is_empty() {
            continue;
        }

        let variant_token = uuid::Uuid::new_v4().to_string();
        let mime_type = variant
            .mime_type
            .as_deref()
            .and_then(|mime| mime.split(';').next())
            .unwrap_or("video/mp4")
            .to_string();

        streaming_manager.register_session(
            variant_token.clone(),
            variant.local_url.clone(),
            mime_type,
            dynamic_user_agent.clone(),
        );

        variant.local_url = format!("http://127.0.0.1:{}/stream/{}", proxy_port, variant_token);
    }

    for caption in &mut stream_info.captions {
        let caption_token = uuid::Uuid::new_v4().to_string();

        streaming_manager.register_session(
            caption_token.clone(),
            caption.url.clone(),
            "text/vtt; charset=utf-8".to_string(),
            crate::api::http::BROWSER_USER_AGENT.to_string(),
        );

        caption.url = format!("http://127.0.0.1:{}/stream/{}", proxy_port, caption_token);
    }

    for audio_track in &mut stream_info.audio_tracks {
        if audio_track.local_url.is_empty() {
            continue;
        }

        let audio_token = uuid::Uuid::new_v4().to_string();
        let mime_type = audio_track
            .mime_type
            .as_deref()
            .and_then(|mime| mime.split(';').next())
            .unwrap_or("audio/mp4")
            .to_string();

        streaming_manager.register_session(
            audio_token.clone(),
            audio_track.local_url.clone(),
            mime_type,
            audio_track
                .user_agent
                .clone()
                .unwrap_or_else(|| dynamic_user_agent.clone()),
        );

        audio_track.local_url = format!("http://127.0.0.1:{}/stream/{}", proxy_port, audio_token);
    }

    if let Some(descriptor) = stream_info.sabr_descriptor.take() {
        if refresh {
            streaming_manager.sabr().discard_video(&descriptor.video_id);
        }
        let session_id = streaming_manager
            .sabr()
            .prepare(descriptor, crate::streaming::sabr::CodecSupport::default());
        if let Some(sabr) = stream_info.sabr.as_mut() {
            sabr.manifest_url = Some(format!(
                "http://127.0.0.1:{}/sabr/{}/manifest.mpd",
                proxy_port, session_id
            ));
        }
        info!(video_id = %video_id, session = %session_id, "Prepared lazy SABR session (debug/future use)");
    }

    if stream_info
        .dash_manifest_url
        .as_deref()
        .unwrap_or_default()
        .is_empty()
    {
        if let Some(manifest) = build_synthetic_dash_manifest(&stream_info) {
            let manifest_token = uuid::Uuid::new_v4().to_string();
            streaming_manager.register_inline_session(
                manifest_token.clone(),
                manifest.into_bytes(),
                "application/dash+xml".to_string(),
            );
            stream_info.dash_manifest_url = Some(format!(
                "http://127.0.0.1:{}/stream/{}",
                proxy_port, manifest_token
            ));
            info!(video_id = %video_id, "Generated synthetic DASH manifest for fallback playback");
        }
    }

    // Rewrite to clean expires_at for frontend consumption
    stream_info.expires_at = clean_expires_at;

    // Rewrite to local loopback URL
    if has_progressive_url {
        stream_info.local_url = format!("http://127.0.0.1:{proxy_port}/stream/{token}");
    }

    Ok(stream_info)
}

#[tauri::command]
pub async fn get_sabr_debug_state(
    session_id: String,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<Option<crate::streaming::sabr::engine::SabrDebugState>, ErrorResponse> {
    match streaming_manager.sabr().get(&session_id) {
        Some(handle) => Ok(Some(handle.engine.debug_state().await)),
        None => Ok(None),
    }
}

/// A channel's landing page: header, tabs and Home in one request.
#[tauri::command]
pub async fn get_channel_page(
    channel_id: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ChannelPage, ErrorResponse> {
    validate_channel_id(&channel_id).map_err(ErrorResponse::from)?;
    youtube_service
        .get_channel_page(&channel_id)
        .await
        .map_err(ErrorResponse::from)
}

/// A channel's About panel, by the token its header carries.
#[tauri::command]
pub async fn get_channel_about(
    token: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ChannelAbout, ErrorResponse> {
    youtube_service
        .get_channel_about(&token)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_channel_details(
    channel_id: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ChannelDetails, ErrorResponse> {
    validate_channel_id(&channel_id).map_err(ErrorResponse::from)?;

    youtube_service
        .get_channel_details(&channel_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_channel_tab(
    channel_id: String,
    params: Option<String>,
    page_token: Option<String>,
    query: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ChannelTabResponse, ErrorResponse> {
    validate_channel_id(&channel_id).map_err(ErrorResponse::from)?;
    if let Some(token) = page_token.as_deref() {
        validate_page_token(token).map_err(ErrorResponse::from)?;
    }
    if let Some(ref q) = query {
        validate_search_query(q).map_err(ErrorResponse::from)?;
    }

    youtube_service
        .get_channel_tab(&channel_id, params, page_token, query)
        .await
        .map_err(ErrorResponse::from)
}
#[tauri::command]
pub async fn get_playlist_details(
    playlist_id: String,
    page_token: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<PlaylistDetailsResponse, ErrorResponse> {
    if playlist_id.trim().is_empty() {
        return Err(ErrorResponse::from(crate::errors::AppError::Validation(
            "Playlist ID cannot be empty".into(),
        )));
    }
    if let Some(token) = page_token.as_deref() {
        validate_page_token(token).map_err(ErrorResponse::from)?;
    }

    youtube_service
        .get_playlist_details(&playlist_id, page_token)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_comments(
    video_id: String,
    page_token: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<CommentsResponse, ErrorResponse> {
    if let Some(token) = page_token.as_deref() {
        validate_page_token(token).map_err(ErrorResponse::from)?;
    } else {
        validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    }

    youtube_service
        .get_comments(&video_id, page_token)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_post_comments(
    post_id: String,
    params: Option<String>,
    page_token: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<CommentsResponse, ErrorResponse> {
    if let Some(token) = page_token.as_deref() {
        validate_page_token(token).map_err(ErrorResponse::from)?;
    } else {
        validate_browse_id(&post_id).map_err(ErrorResponse::from)?;
        if let Some(post_params) = params.as_deref() {
            validate_page_token(post_params).map_err(ErrorResponse::from)?;
        }
    }

    youtube_service
        .get_post_comments(&post_id, params, page_token)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_live_chat(
    video_id: String,
    continuation: Option<String>,
    replay_offset_ms: Option<u64>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<crate::models::live_chat::LiveChatResponse, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    youtube_service
        .get_live_chat(&video_id, continuation, replay_offset_ms)
        .await
        .map_err(ErrorResponse::from)
}

/// One of Explore's destinations (`live`, `gaming`, `music`, `news`, `sports`,
/// `learning`, `fashion`) in `region`.
#[tauri::command]
pub async fn get_explore_destination(
    destination: String,
    region: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ExplorePage, ErrorResponse> {
    youtube_service
        .get_explore_destination(&destination, region.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// A destination's tab, by the target its page named.
#[tauri::command]
pub async fn get_explore_page(
    target: ExploreTarget,
    region: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ExplorePage, ErrorResponse> {
    youtube_service
        .get_explore_page(
            &target.browse_id,
            target.params.as_deref(),
            region.as_deref(),
        )
        .await
        .map_err(ErrorResponse::from)
}

/// A shelf's full grid: the first page from its target, later ones from a token.
#[tauri::command]
pub async fn get_explore_grid(
    target: Option<ExploreTarget>,
    continuation: Option<String>,
    region: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<ExploreGrid, ErrorResponse> {
    youtube_service
        .get_explore_grid(target.as_ref(), continuation.as_deref(), region.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_search_suggestions(
    query: String,
    region: Option<String>,
    youtube_service: State<'_, YoutubeService>,
) -> Result<Vec<String>, ErrorResponse> {
    youtube_service
        .get_search_suggestions(&query, region.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn parse_subscription_export(
    data: String,
    youtube_service: State<'_, YoutubeService>,
) -> Result<Vec<(String, String)>, ErrorResponse> {
    youtube_service
        .parse_subscription_export(&data)
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_sponsorblock_segments(
    video_id: String,
    server_url: Option<String>,
) -> Result<serde_json::Value, ErrorResponse> {
    fetch_sponsorblock_segments(&video_id, server_url.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

pub(crate) async fn fetch_sponsorblock_segments(
    video_id: &str,
    server_url: Option<&str>,
) -> crate::errors::AppResult<serde_json::Value> {
    validate_video_id(video_id)?;

    let base_url = normalize_sponsorblock_server_url(server_url)?;
    let url = format!(
        "{base_url}/api/skipSegments?videoID={video_id}&categories=[\"sponsor\",\"intro\",\"outro\",\"selfpromo\",\"interaction\",\"filler\",\"music_offtopic\",\"preview\",\"exclusive_access\"]"
    );

    let res = crate::api::http::shared_client()
        .get(&url)
        .header(reqwest::header::USER_AGENT, SPONSORBLOCK_USER_AGENT)
        .timeout(SPONSORBLOCK_TIMEOUT)
        .send()
        .await
        .map_err(|e| crate::errors::AppError::Extractor(format!("Network error: {e}")))?;

    let status = res.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(serde_json::json!([]));
    }

    if !status.is_success() {
        return Err(crate::errors::AppError::Extractor(format!(
            "SponsorBlock server returned status {status}"
        )));
    }

    res.json::<serde_json::Value>()
        .await
        .map_err(|e| crate::errors::AppError::Extractor(format!("JSON parse error: {e}")))
}

fn normalize_sponsorblock_server_url(server_url: Option<&str>) -> crate::errors::AppResult<String> {
    let raw = server_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://sponsor.ajay.app");
    let parsed = reqwest::Url::parse(raw).map_err(|_| {
        crate::errors::AppError::Validation("Invalid SponsorBlock server URL".into())
    })?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(crate::errors::AppError::Validation(
                "SponsorBlock server URL must use http or https".into(),
            ));
        }
    }

    let origin = parsed.origin().unicode_serialization();
    if origin == "null" {
        return Err(crate::errors::AppError::Validation(
            "SponsorBlock server URL must include an origin".into(),
        ));
    }
    Ok(origin)
}

const SPONSORBLOCK_USER_AGENT: &str = "FlowDesktop/1.0";
const SPONSORBLOCK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

const SPONSORBLOCK_SUBMIT_CATEGORIES: [&str; 9] = [
    "sponsor",
    "intro",
    "outro",
    "selfpromo",
    "interaction",
    "music_offtopic",
    "filler",
    "preview",
    "exclusive_access",
];

#[tauri::command]
pub async fn submit_sponsorblock_segment(
    video_id: String,
    start_time: f64,
    end_time: f64,
    category: String,
    user_id: String,
    server_url: Option<String>,
) -> Result<(), ErrorResponse> {
    submit_sponsorblock_segment_inner(
        &video_id,
        start_time,
        end_time,
        &category,
        &user_id,
        server_url.as_deref(),
    )
    .await
    .map_err(ErrorResponse::from)
}

async fn submit_sponsorblock_segment_inner(
    video_id: &str,
    start_time: f64,
    end_time: f64,
    category: &str,
    user_id: &str,
    server_url: Option<&str>,
) -> crate::errors::AppResult<()> {
    validate_video_id(video_id)?;

    if !SPONSORBLOCK_SUBMIT_CATEGORIES.contains(&category) {
        return Err(crate::errors::AppError::Validation(
            "Unsupported SponsorBlock category".into(),
        ));
    }

    if !start_time.is_finite()
        || !end_time.is_finite()
        || start_time < 0.0
        || end_time <= start_time
    {
        return Err(crate::errors::AppError::Validation(
            "Segment end time must be greater than its start time".into(),
        ));
    }

    // SponsorBlock derives a public contributor ID by hashing this private one, so it
    // must be a long, non-trivial string. Never log it — it is user-identifying.
    let user_id = user_id.trim();
    if user_id.len() < 8 {
        return Err(crate::errors::AppError::Validation(
            "A valid SponsorBlock user ID is required to submit segments".into(),
        ));
    }

    let base_url = normalize_sponsorblock_server_url(server_url)?;

    let mut url = reqwest::Url::parse(&format!("{base_url}/api/skipSegments")).map_err(|_| {
        crate::errors::AppError::Validation("Invalid SponsorBlock server URL".into())
    })?;
    url.query_pairs_mut()
        .append_pair("videoID", video_id)
        .append_pair("startTime", &start_time.to_string())
        .append_pair("endTime", &end_time.to_string())
        .append_pair("category", category)
        .append_pair("userID", user_id)
        .append_pair("userAgent", "FlowDesktop/1.0");

    let res = crate::api::http::shared_client()
        .post(url)
        .header(reqwest::header::USER_AGENT, SPONSORBLOCK_USER_AGENT)
        .timeout(SPONSORBLOCK_TIMEOUT)
        .send()
        .await
        .map_err(|e| crate::errors::AppError::Extractor(format!("Network error: {e}")))?;

    let status = res.status();
    if status.is_success() {
        return Ok(());
    }

    let body = res.text().await.unwrap_or_default();
    let detail = body.trim();
    let message = if detail.is_empty() {
        format!("SponsorBlock rejected the submission (status {status})")
    } else {
        format!("SponsorBlock rejected the submission: {detail}")
    };
    Err(crate::errors::AppError::Extractor(message))
}

#[tauri::command]
pub async fn get_dearrow_override(
    video_id: String,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<Option<crate::api::dearrow::DeArrowOverride>, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;

    // 1. Try to fetch from local dearrow_cache first.
    if let Ok(Some(cached)) = crate::db::cache::get_cached_dearrow(&pool, &video_id).await {
        if cached.title.is_none() && cached.thumbnail_url.is_none() {
            return Ok(None);
        }
        return Ok(Some(cached));
    }

    // 2. Fetch from SponsorBlock/DeArrow API
    match crate::api::dearrow::fetch_dearrow_override_api(&video_id).await {
        Ok(Some(override_data)) => {
            let _ = crate::db::cache::cache_dearrow(&pool, &video_id, &override_data).await;
            Ok(Some(override_data))
        }
        Ok(None) => {
            let empty_override = crate::api::dearrow::DeArrowOverride {
                title: None,
                thumbnail_url: None,
            };
            let _ = crate::db::cache::cache_dearrow(&pool, &video_id, &empty_override).await;
            Ok(None)
        }
        Err(e) => Err(ErrorResponse::from(e)),
    }
}

/// RYD is a graceful-degradation integration: fetch failures resolve to
/// `Ok(None)` so the frontend simply omits the dislike counter. Only an
/// invalid video ID is a real error.
#[tauri::command]
pub async fn get_return_youtube_dislike(
    video_id: String,
) -> Result<Option<crate::api::ryd::RydVotes>, ErrorResponse> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    Ok(crate::api::ryd::fetch_ryd_votes(&video_id).await)
}

#[tauri::command]
pub async fn get_subscription_rotation_feed(
    youtube_service: State<'_, YoutubeService>,
    recommendation_service: State<'_, RecommendationService>,
) -> Result<Vec<VideoSummary>, ErrorResponse> {
    recommendation_service
        .get_subscription_rotation_feed(&youtube_service)
        .await
        .map_err(ErrorResponse::from)
}

/// Feed duration fills run beside whatever the user is playing, so they stay
/// few at a time on a slow link.
const DURATION_FILL_CONCURRENCY: usize = 3;

pub(crate) async fn populate_video_durations(
    videos: &mut [VideoSummary],
    youtube_service: &YoutubeService,
    pool: &sqlx::SqlitePool,
) {
    let items: Vec<(String, String, String, Option<String>)> = videos
        .iter()
        .map(|video| {
            (
                video.id.clone(),
                video.title.clone(),
                video.channel_name.clone(),
                video.thumbnail_url.clone(),
            )
        })
        .collect();

    let results = crate::api::http::bounded_join(
        items,
        DURATION_FILL_CONCURRENCY,
        move |(video_id, title, channel_name, thumbnail_url)| {
            let youtube_service = youtube_service.clone();
            let pool = pool.clone();
            async move {
                // 1. Try cache first
                if let Ok(Some(cached)) =
                    crate::db::cache::get_cached_video_summary(&pool, &video_id).await
                {
                    if cached.duration_seconds.is_some() {
                        return (video_id, cached.duration_seconds);
                    }
                }

                // 2. Fetch from API
                if let Ok(details) = youtube_service.get_video_basics(&video_id).await {
                    let summary = VideoSummary {
                        id: video_id.clone(),
                        title,
                        channel_name,
                        channel_id: details.channel_id,
                        thumbnail_url,
                        duration_seconds: details.duration_seconds,
                        published_text: None,
                        view_count_text: None,
                        channel_avatar_url: None,
                        is_live: false,
                        ..Default::default()
                    };
                    // Cache it for 7 days
                    let _ = crate::db::cache::cache_video_summary(&pool, &summary, 604800).await;
                    (video_id, details.duration_seconds)
                } else {
                    (video_id, None)
                }
            }
        },
    )
    .await;
    let mut durations = std::collections::HashMap::new();
    for (id, dur) in results {
        if let Some(d) = dur {
            durations.insert(id, d);
        }
    }

    for video in videos.iter_mut() {
        if video.duration_seconds.is_none() {
            if let Some(dur) = durations.get(&video.id) {
                video.duration_seconds = Some(*dur);
            }
        }
    }
}

fn dedupe_channel_ids(channel_ids: Vec<String>) -> Result<Vec<String>, ErrorResponse> {
    let mut unique = Vec::new();
    for channel_id in channel_ids {
        let trimmed = channel_id.trim().trim_start_matches("channel:").to_string();
        validate_channel_id(&trimmed).map_err(ErrorResponse::from)?;
        if !unique.contains(&trimmed) {
            unique.push(trimmed);
        }
    }
    Ok(unique)
}

const SUBSCRIPTION_RSS_BATCH_SIZE: usize = 50;

#[tauri::command]
pub async fn get_subscription_rss_feed(
    channel_ids: Vec<String>,
    limit: Option<usize>,
    youtube_service: State<'_, YoutubeService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<SubscriptionRssFeed, ErrorResponse> {
    let unique_channel_ids = dedupe_channel_ids(channel_ids)?;
    let limit = limit.unwrap_or(1500).clamp(1, 1500);
    let mut uploads =
        subscription_feed::fetch_channels(&youtube_service, &unique_channel_ids).await;
    subscription_feed::sort_and_dedupe(&mut uploads.videos);
    let videos =
        subscription_feed::finish_feed(&youtube_service, &pool, uploads.videos, limit).await;
    let total = unique_channel_ids.len();
    Ok(SubscriptionRssFeed {
        videos,
        channels: uploads.channels,
        failed_channel_ids: uploads.failed_channel_ids,
        processed: total,
        total,
    })
}

/// The feed in batches of channels, each sent as it lands, then the finished
/// feed with Shorts and lengths filled in.
#[tauri::command]
pub async fn stream_subscription_rss_feed(
    channel_ids: Vec<String>,
    limit: Option<usize>,
    on_event: tauri::ipc::Channel<SubscriptionRssFeed>,
    youtube_service: State<'_, YoutubeService>,
    pool: State<'_, sqlx::SqlitePool>,
) -> Result<(), ErrorResponse> {
    let unique_channel_ids = dedupe_channel_ids(channel_ids)?;
    let limit = limit.unwrap_or(1500).clamp(1, 1500);
    let total = unique_channel_ids.len();
    let mut uploads = subscription_feed::ChannelUploads::default();
    let mut processed = 0usize;

    for batch in unique_channel_ids.chunks(SUBSCRIPTION_RSS_BATCH_SIZE) {
        let found = subscription_feed::fetch_channels(&youtube_service, batch).await;
        uploads.channels.extend(found.channels);
        uploads.videos.extend(found.videos);
        uploads.failed_channel_ids.extend(found.failed_channel_ids);
        processed = (processed + batch.len()).min(total);
        subscription_feed::sort_and_dedupe(&mut uploads.videos);
        let _ = on_event.send(SubscriptionRssFeed {
            videos: subscription_feed::partial_feed(&uploads.videos, limit),
            channels: uploads.channels.clone(),
            failed_channel_ids: uploads.failed_channel_ids.clone(),
            processed,
            total,
        });
    }

    let videos =
        subscription_feed::finish_feed(&youtube_service, &pool, uploads.videos, limit).await;
    let _ = on_event.send(SubscriptionRssFeed {
        videos,
        channels: uploads.channels,
        failed_channel_ids: uploads.failed_channel_ids,
        processed: total,
        total,
    });

    Ok(())
}

#[tauri::command]
pub async fn fetch_subtitles(
    url: String,
    streaming_manager: State<'_, StreamingManager>,
) -> Result<String, ErrorResponse> {
    debug!("[fetch_subtitles] Requested fetch for: {}", url);

    if let Ok(parsed_url) = reqwest::Url::parse(&url) {
        let path = parsed_url.path();
        if let Some(token) = path.strip_prefix("/stream/") {
            let token = token.trim_start_matches('/');
            debug!(
                "[fetch_subtitles] Local proxy URL detected. Extracted token: {}",
                token
            );
            if let Some(session) = streaming_manager.get_session(token) {
                debug!(
                    "[fetch_subtitles] Found stream session for token: {}",
                    token
                );
                match session.kind {
                    crate::streaming::proxy::StreamSessionKind::Remote { remote_url } => {
                        debug!("[fetch_subtitles] Remote URL session found: {}", remote_url);
                        let user_agent = if session.user_agent.is_empty() {
                            crate::api::http::BROWSER_USER_AGENT
                        } else {
                            debug!(
                                "[fetch_subtitles] Using session User-Agent: {}",
                                session.user_agent
                            );
                            session.user_agent.as_str()
                        };
                        let client = crate::api::http::shared_client();

                        let res = client
                            .get(&remote_url)
                            .header(reqwest::header::USER_AGENT, user_agent)
                            .send()
                            .await
                            .map_err(|e| {
                                crate::errors::AppError::Extractor(format!(
                                    "Network error fetching subtitles: {}",
                                    e
                                ))
                            })?;

                        let text = res.text().await.map_err(|e| {
                            crate::errors::AppError::Extractor(format!(
                                "Read error fetching subtitles: {}",
                                e
                            ))
                        })?;

                        debug!(
                            "[fetch_subtitles] Successfully fetched remote subtitles. Length: {} bytes",
                            text.len()
                        );
                        return Ok(text);
                    }
                    crate::streaming::proxy::StreamSessionKind::Inline { body } => {
                        debug!(
                            "[fetch_subtitles] Inline session found with {} bytes.",
                            body.len()
                        );
                        let text = String::from_utf8(body).map_err(|e| {
                            crate::errors::AppError::Extractor(format!(
                                "UTF-8 decoding error: {}",
                                e
                            ))
                        })?;
                        return Ok(text);
                    }
                    crate::streaming::proxy::StreamSessionKind::Local { path } => {
                        let text = tokio::fs::read_to_string(&path).await.map_err(|e| {
                            crate::errors::AppError::Extractor(format!(
                                "Read error reading local subtitles: {}",
                                e
                            ))
                        })?;
                        return Ok(text);
                    }
                }
            } else {
                debug!(
                    "[fetch_subtitles] No active/expired session found in StreamingManager for token: {}",
                    token
                );
            }
        }
    }

    debug!(
        "[fetch_subtitles] Falling back to direct URL fetch: {}",
        url
    );
    let client = crate::api::http::shared_client();

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| crate::errors::AppError::Extractor(format!("Network error: {}", e)))?;

    let text = res
        .text()
        .await
        .map_err(|e| crate::errors::AppError::Extractor(format!("Read error: {}", e)))?;

    debug!(
        "[fetch_subtitles] Direct fetch successful. Length: {} bytes",
        text.len()
    );
    Ok(text)
}
