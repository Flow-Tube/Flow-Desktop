//! Tauri commands for the YouTube Music subsystem.
//!
//! These are additive and independent of `commands::youtube`. The playback
//! command reuses the shared streaming proxy exactly like `get_stream_info`.

use std::collections::HashMap;

use tauri::State;
use uuid::Uuid;

use crate::errors::{AppError, ErrorResponse};
use crate::models::music::{
    AlbumItem, ArtistPage, ChartsPage, ExplorePage, MoodAndGenreItem, SongItem,
};
use crate::models::music_pages::{
    AlbumPage, MoodGenrePage, MusicHomePage, MusicPlaylistPage, MusicSearchResponse,
    MusicSearchSuggestions, QueuePage, RelatedPage, SearchSummaryPage,
};
use crate::models::music_stream::{MusicAudioQuality, MusicStreamInfo};
use crate::security::validation::{validate_search_query, validate_video_id};
use crate::services::music_service::MusicService;
use crate::streaming::proxy::StreamingManager;

type CmdResult<T> = Result<T, ErrorResponse>;

// --- Browse ---------------------------------------------------------------

#[tauri::command]
pub async fn get_music_home_page(
    continuation: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<MusicHomePage> {
    music
        .home(continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_explore_page(music: State<'_, MusicService>) -> CmdResult<ExplorePage> {
    music.explore().await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_charts_page(
    continuation: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<ChartsPage> {
    music
        .charts(continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_moods(music: State<'_, MusicService>) -> CmdResult<Vec<MoodAndGenreItem>> {
    music.moods().await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_new_releases(music: State<'_, MusicService>) -> CmdResult<Vec<AlbumItem>> {
    music.new_releases().await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_mood_genre(
    browse_id: String,
    params: Option<String>,
    continuation: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<MoodGenrePage> {
    music
        .mood_genre(&browse_id, params.as_deref(), continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

/// Artist "see all" — same browse shape as a mood/genre detail.
#[tauri::command]
pub async fn get_music_artist_items(
    browse_id: String,
    params: Option<String>,
    continuation: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<MoodGenrePage> {
    music
        .mood_genre(&browse_id, params.as_deref(), continuation.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

// --- Search ---------------------------------------------------------------

#[tauri::command]
pub async fn search_music_typed(
    query: String,
    filter: String,
    music: State<'_, MusicService>,
) -> CmdResult<MusicSearchResponse> {
    validate_search_query(&query).map_err(ErrorResponse::from)?;
    music
        .search(&query, &filter)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn search_music_continuation(
    continuation: String,
    music: State<'_, MusicService>,
) -> CmdResult<MusicSearchResponse> {
    music
        .search_continuation(&continuation)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_search_summary(
    query: String,
    music: State<'_, MusicService>,
) -> CmdResult<SearchSummaryPage> {
    validate_search_query(&query).map_err(ErrorResponse::from)?;
    music
        .search_summary(&query)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_search_suggestions(
    query: String,
    music: State<'_, MusicService>,
) -> CmdResult<MusicSearchSuggestions> {
    music
        .search_suggestions(&query)
        .await
        .map_err(ErrorResponse::from)
}

// --- Album / Artist / Playlist -------------------------------------------

#[tauri::command]
pub async fn get_music_album_page(
    browse_id: String,
    music: State<'_, MusicService>,
) -> CmdResult<AlbumPage> {
    music.album(&browse_id).await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_album_continuation(
    continuation: String,
    music: State<'_, MusicService>,
) -> CmdResult<(Vec<SongItem>, Option<String>)> {
    music
        .album_continuation(&continuation)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_artist_page(
    browse_id: String,
    music: State<'_, MusicService>,
) -> CmdResult<ArtistPage> {
    music.artist(&browse_id).await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_playlist_page(
    playlist_id: String,
    music: State<'_, MusicService>,
) -> CmdResult<MusicPlaylistPage> {
    music
        .playlist(&playlist_id)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_playlist_continuation(
    continuation: String,
    music: State<'_, MusicService>,
) -> CmdResult<(Vec<SongItem>, Option<String>)> {
    music
        .playlist_continuation(&continuation)
        .await
        .map_err(ErrorResponse::from)
}

// --- Watch / queue / lyrics ----------------------------------------------

#[tauri::command]
pub async fn get_music_watch_queue(
    video_id: Option<String>,
    playlist_id: Option<String>,
    params: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<QueuePage> {
    music
        .watch_queue(
            video_id.as_deref(),
            playlist_id.as_deref(),
            params.as_deref(),
        )
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_queue_continuation(
    continuation: String,
    music: State<'_, MusicService>,
) -> CmdResult<QueuePage> {
    music
        .queue_continuation(&continuation)
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_queue(
    video_ids: Vec<String>,
    playlist_id: Option<String>,
    music: State<'_, MusicService>,
) -> CmdResult<QueuePage> {
    music
        .get_queue(&video_ids, playlist_id.as_deref())
        .await
        .map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_related_typed(
    video_id: String,
    music: State<'_, MusicService>,
) -> CmdResult<RelatedPage> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    music.related(&video_id).await.map_err(ErrorResponse::from)
}

#[tauri::command]
pub async fn get_music_lyrics_typed(
    video_id: String,
    music: State<'_, MusicService>,
) -> CmdResult<Option<String>> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    music.lyrics(&video_id).await.map_err(ErrorResponse::from)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsHttpResponse {
    pub status: u16,
    pub body: String,
}

/// Generic HTTPS GET passthrough for the client-side lyrics engine — the lyric
/// providers are external services that the webview can't reach due to CORS.
#[tauri::command]
pub async fn lyrics_http_get(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> CmdResult<LyricsHttpResponse> {
    if !url.starts_with("https://") {
        return Err(ErrorResponse::from(AppError::Validation(
            "Only https URLs are allowed".into(),
        )));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| ErrorResponse::from(AppError::Extractor(e.to_string())))?;
    let mut req = client.get(&url);
    if let Some(h) = headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| ErrorResponse::from(AppError::Extractor(e.to_string())))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(LyricsHttpResponse { status, body })
}

// --- Playback (reuses the shared streaming proxy) -------------------------

#[tauri::command]
#[tracing::instrument(skip_all, fields(video_id = %video_id, kind = "music"))]
pub async fn get_music_stream(
    video_id: String,
    audio_quality: Option<String>,
    music: State<'_, MusicService>,
    streaming_manager: State<'_, StreamingManager>,
) -> CmdResult<MusicStreamInfo> {
    validate_video_id(&video_id).map_err(ErrorResponse::from)?;
    let audio_quality = audio_quality
        .as_deref()
        .map(str::parse::<MusicAudioQuality>)
        .transpose()
        .map_err(|message| ErrorResponse::from(AppError::Validation(message)))?
        .unwrap_or_default();

    let mut info = music
        .resolve_stream(&video_id, audio_quality)
        .await
        .map_err(ErrorResponse::from)?;

    // Register the upstream audio URL with the shared proxy and rewrite to a
    // loopback URL — identical mechanism to the video `get_stream_info`.
    let token = uuid::Uuid::new_v4().to_string();
    let content_type = info
        .mime_type
        .split(';')
        .next()
        .unwrap_or("audio/webm")
        .to_string();
    streaming_manager.register_session(
        token.clone(),
        info.audio_url.clone(),
        content_type,
        info.user_agent.clone(),
    );
    let port = streaming_manager.get_port();
    info.audio_url = format!("http://127.0.0.1:{port}/stream/{token}");
    info.user_agent = String::new();

    Ok(info)
}

fn image_content_type(url: &str) -> String {
    let lower = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else {
        "image/jpeg".to_string()
    }
}

fn google_size_param_start(url: &str) -> Option<usize> {
    ["=w", "=h", "=s"]
        .iter()
        .filter_map(|marker| url.find(marker))
        .min()
}

fn proxyable_image_url(parsed: &reqwest::Url) -> String {
    let url = parsed.as_str();
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !(host.starts_with("yt3.") || host == "yt3.googleusercontent.com" || host == "yt3.ggpht.com")
    {
        return url.to_string();
    }

    let (base_and_path, query) = url
        .split_once('?')
        .map_or((url, ""), |(base, query)| (base, query));

    if google_size_param_start(base_and_path).is_some() {
        return url.to_string();
    }

    if query.is_empty() {
        format!("{base_and_path}=s512")
    } else {
        format!("{base_and_path}=s512?{query}")
    }
}

#[tauri::command]
pub async fn proxy_image_url(
    url: String,
    streaming_manager: State<'_, StreamingManager>,
) -> CmdResult<String> {
    let trimmed = url.trim();
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| ErrorResponse::from(AppError::Validation("Invalid image URL".into())))?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(ErrorResponse::from(AppError::Validation(
                "Unsupported image URL".into(),
            )));
        }
    }

    let host = parsed.host_str().unwrap_or_default();
    if host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("127.0.0.1")
        || host.eq_ignore_ascii_case("::1")
    {
        return Err(ErrorResponse::from(AppError::Validation(
            "Local image URLs cannot be proxied".into(),
        )));
    }

    let upstream_url = proxyable_image_url(&parsed);
    let token = format!("img-{}", Uuid::new_v4());
    streaming_manager.register_session(
        token.clone(),
        upstream_url.clone(),
        image_content_type(&upstream_url),
        crate::api::http::BROWSER_USER_AGENT.to_string(),
    );

    Ok(format!(
        "http://127.0.0.1:{}/stream/{}",
        streaming_manager.get_port(),
        token
    ))
}
